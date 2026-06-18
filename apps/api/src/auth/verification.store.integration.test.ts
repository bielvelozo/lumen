import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { makeDb, type Database } from '../db/client';
import { users, emailVerificationTokens } from '../db/schema';
import { makeDrizzleVerificationStore, type VerificationStore } from './verification.store';
import { makeDrizzleSignupStore, type SignupStore } from './signup.store';
import { generateToken, hashToken } from '../crypto';

// ---------------------------------------------------------------------------
// Live verification-store integration — env-gated on DATABASE_URL. Skips when absent.
// Run green once vs local Docker Postgres (recorded LIVE-VERIFICATION-PENDING).
// Throwaway DB, migrate, exercise the REAL transactions (hash-only persistence, atomic
// single-use consume, expiry, most-recent-wins reissue), then drop it.
// ---------------------------------------------------------------------------
const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '..', '..', 'drizzle');
const TEST_DB = 'lumen_verification_test';

function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

let userCounter = 0;

describe.skipIf(!process.env.DATABASE_URL)('live: verification store', () => {
  let admin: Pool | undefined;
  let pool: Pool | undefined;
  let db: Database;
  let store: VerificationStore;
  let signupStore: SignupStore;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL missing');
    admin = new Pool({ connectionString: withDatabase(url, 'postgres') });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);

    const made = makeDb(withDatabase(url, TEST_DB));
    pool = made.pool;
    db = made.db;
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    store = makeDrizzleVerificationStore(db);
    signupStore = makeDrizzleSignupStore(db);
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.end();
    }
  });

  async function freshUser(): Promise<string> {
    const email = `verify${userCounter++}@example.com`;
    const result = await signupStore.createTenant({
      email,
      passwordHash: '$argon2id$placeholder',
      organizationName: 'Verify Co',
    });
    if (result.outcome !== 'created') throw new Error('failed to create test user');
    return result.userId;
  }

  it('issue stores ONLY the hash — the raw token never lands in the DB', async () => {
    const userId = await freshUser();
    const { raw, tokenHash } = generateToken();
    const expiresAt = new Date(Date.now() + 60_000);
    await store.issue(userId, tokenHash, expiresAt);

    const rows = await db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, userId));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.tokenHash).toBe(tokenHash);
    expect(row?.tokenHash).toBe(hashToken(raw));
    expect(row?.tokenHash).not.toBe(raw); // GUARD: raw is not what's stored
    expect(row?.usedAt).toBeNull();
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('consume flips the user + sets used_at atomically, and a replay is benign', async () => {
    const userId = await freshUser();
    const { raw, tokenHash } = generateToken();
    await store.issue(userId, tokenHash, new Date(Date.now() + 60_000));

    const first = await store.consume(tokenHash, new Date());
    expect(first).toBe('verified');

    const userRows = await db.select().from(users).where(eq(users.id, userId));
    expect(userRows[0]?.emailVerified).toBe(true);
    expect(userRows[0]?.verifiedAt).not.toBeNull();
    const tokenRows = await db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.tokenHash, tokenHash));
    expect(tokenRows[0]?.usedAt).not.toBeNull();

    // Replay the consumed link: user already verified -> benign already_verified.
    expect(await store.consume(tokenHash, new Date())).toBe('already_verified');
    expect(hashToken(raw)).toBe(tokenHash);
  });

  it('an unknown token hash is invalid', async () => {
    expect(await store.consume(hashToken('never-issued'), new Date())).toBe('invalid');
  });

  it('an expired token is invalid (user not flipped)', async () => {
    const userId = await freshUser();
    const { tokenHash } = generateToken();
    await store.issue(userId, tokenHash, new Date(Date.now() - 1000)); // already expired
    expect(await store.consume(tokenHash, new Date())).toBe('invalid');
    const userRows = await db.select().from(users).where(eq(users.id, userId));
    expect(userRows[0]?.emailVerified).toBe(false);
  });

  it('reissue invalidates the prior unused token (most-recent-wins)', async () => {
    const userId = await freshUser();
    const tokenA = generateToken();
    const tokenB = generateToken();
    await store.issue(userId, tokenA.tokenHash, new Date(Date.now() + 60_000));
    await store.issue(userId, tokenB.tokenHash, new Date(Date.now() + 60_000));

    // Old link no longer verifies; the newest one does.
    expect(await store.consume(tokenA.tokenHash, new Date())).toBe('invalid');
    expect(await store.consume(tokenB.tokenHash, new Date())).toBe('verified');
  });
});
