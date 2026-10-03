import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, isNull } from 'drizzle-orm';
import { Pool } from 'pg';
import { makeDb, type Database } from '../db/client';
import { users, refreshTokens, passwordResetTokens } from '../db/schema';
import { makeDrizzlePasswordResetStore, type PasswordResetStore } from './password-reset.store';
import { makeDrizzleSignupStore, type SignupStore } from './signup.store';
import { generateToken, hashToken } from '../crypto';

// ---------------------------------------------------------------------------
// Live password-reset-store integration — env-gated on DATABASE_URL. Skips when absent.
// Throwaway DB, migrate, exercise the REAL transactions (hash-only persistence, atomic
// single-use consume, expiry, most-recent-wins reissue, and the session revocation a
// reset implies), then drop it.
// ---------------------------------------------------------------------------
const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '..', '..', 'drizzle');
const TEST_DB = 'lumen_password_reset_test';

function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

let userCounter = 0;

describe.skipIf(!process.env.DATABASE_URL)('live: password-reset store', () => {
  let admin: Pool | undefined;
  let pool: Pool | undefined;
  let db: Database;
  let store: PasswordResetStore;
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
    store = makeDrizzlePasswordResetStore(db);
    signupStore = makeDrizzleSignupStore(db);
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.end();
    }
  });

  async function freshUser(): Promise<{ id: string; email: string }> {
    const email = `reset${userCounter++}@example.com`;
    const result = await signupStore.createTenant({
      email,
      passwordHash: '$argon2id$placeholder',
      organizationName: 'Reset Co',
    });
    if (result.outcome !== 'created') throw new Error('failed to create test user');
    return { id: result.userId, email };
  }

  it('findUserIdByEmail resolves the account behind a normalized address', async () => {
    const user = await freshUser();
    expect(await store.findUserIdByEmail(user.email)).toBe(user.id);
    expect(await store.findUserIdByEmail('ninguem@example.com')).toBeNull();
  });

  it('issue stores ONLY the hash — the raw token never lands in the DB', async () => {
    const user = await freshUser();
    const { raw, tokenHash } = generateToken();
    await store.issue(user.id, tokenHash, new Date(Date.now() + 60_000));

    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(hashToken(raw));
    expect(rows[0]?.tokenHash).not.toBe(raw); // GUARD: raw is not what's stored
    expect(rows[0]?.usedAt).toBeNull();
  });

  it('consume sets the new password hash, spends the token, and a replay fails', async () => {
    const user = await freshUser();
    const { tokenHash } = generateToken();
    await store.issue(user.id, tokenHash, new Date(Date.now() + 60_000));

    expect(await store.consume(tokenHash, new Date(), '$argon2id$new')).toBe(true);

    const userRows = await db.select().from(users).where(eq(users.id, user.id));
    expect(userRows[0]?.passwordHash).toBe('$argon2id$new');
    const tokenRows = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash));
    expect(tokenRows[0]?.usedAt).not.toBeNull();

    // Single-use: the same link cannot set a second password.
    expect(await store.consume(tokenHash, new Date(), '$argon2id$again')).toBe(false);
    const after = await db.select().from(users).where(eq(users.id, user.id));
    expect(after[0]?.passwordHash).toBe('$argon2id$new');
  });

  it('a reset revokes every live refresh token of that user', async () => {
    const user = await freshUser();
    await db.insert(refreshTokens).values([
      { userId: user.id, tokenHash: 'live-a', expiresAt: new Date(Date.now() + 60_000) },
      { userId: user.id, tokenHash: 'live-b', expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const { tokenHash } = generateToken();
    await store.issue(user.id, tokenHash, new Date(Date.now() + 60_000));

    expect(await store.consume(tokenHash, new Date(), '$argon2id$rotated')).toBe(true);

    const stillLive = await db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
    expect(stillLive).toHaveLength(0);
  });

  it('an unknown or expired token is refused and the password is untouched', async () => {
    const user = await freshUser();
    expect(await store.consume(hashToken('never-issued'), new Date(), '$argon2id$x')).toBe(false);

    const { tokenHash } = generateToken();
    await store.issue(user.id, tokenHash, new Date(Date.now() - 1000)); // already expired
    expect(await store.consume(tokenHash, new Date(), '$argon2id$x')).toBe(false);

    const rows = await db.select().from(users).where(eq(users.id, user.id));
    expect(rows[0]?.passwordHash).toBe('$argon2id$placeholder');
  });

  it('reissue invalidates the prior unused token (most-recent-wins)', async () => {
    const user = await freshUser();
    const tokenA = generateToken();
    const tokenB = generateToken();
    await store.issue(user.id, tokenA.tokenHash, new Date(Date.now() + 60_000));
    await store.issue(user.id, tokenB.tokenHash, new Date(Date.now() + 60_000));

    expect(await store.consume(tokenA.tokenHash, new Date(), '$argon2id$old')).toBe(false);
    expect(await store.consume(tokenB.tokenHash, new Date(), '$argon2id$new')).toBe(true);
  });
});
