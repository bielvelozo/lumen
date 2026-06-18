import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { makeDb, type Database } from '../db/client';
import { refreshTokens } from '../db/schema';
import { makeDrizzleSessionStore, type SessionStore } from './session.store';
import { makeDrizzleSignupStore, type SignupStore } from './signup.store';
import { generateToken, hashToken } from '../crypto';

// ---------------------------------------------------------------------------
// Live session-store integration — env-gated on DATABASE_URL. Skips when absent.
// Run green once vs local Docker Postgres (recorded LIVE-VERIFICATION-PENDING).
// Throwaway DB, migrate, exercise the REAL refresh-token lifecycle (hash-only storage,
// atomic rotation, reuse detection + family revoke), then drop it.
// ---------------------------------------------------------------------------
const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '..', '..', 'drizzle');
const TEST_DB = 'lumen_session_test';

function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

let userCounter = 0;

describe.skipIf(!process.env.DATABASE_URL)('live: session store', () => {
  let admin: Pool | undefined;
  let pool: Pool | undefined;
  let db: Database;
  let store: SessionStore;
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
    store = makeDrizzleSessionStore(db);
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
    const email = `session${userCounter++}@example.com`;
    const result = await signupStore.createTenant({
      email,
      passwordHash: '$argon2id$placeholder',
      organizationName: 'Session Co',
    });
    if (result.outcome !== 'created') throw new Error('failed to create test user');
    return { id: result.userId, email };
  }

  it('createRefreshToken stores ONLY the hash — the raw token never lands in the DB', async () => {
    const user = await freshUser();
    const { raw, tokenHash } = generateToken();
    await store.createRefreshToken(user.id, tokenHash, new Date(Date.now() + 60_000));

    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, user.id));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.tokenHash).toBe(tokenHash);
    expect(row?.tokenHash).toBe(hashToken(raw));
    expect(row?.tokenHash).not.toBe(raw); // GUARD: raw never stored
    expect(row?.revokedAt).toBeNull();
  });

  it('findUserByEmailForLogin + findSessionUser return the auth fields', async () => {
    const user = await freshUser();
    const login = await store.findUserByEmailForLogin(user.email);
    expect(login?.id).toBe(user.id);
    expect(login?.passwordHash).toBe('$argon2id$placeholder');
    expect(login?.emailVerified).toBe(false);
    const session = await store.findSessionUser(user.id);
    expect(session).toMatchObject({ userId: user.id, email: user.email });
  });

  it('rotate revokes the old row and inserts a new one', async () => {
    const user = await freshUser();
    const a = generateToken();
    const b = generateToken();
    await store.createRefreshToken(user.id, a.tokenHash, new Date(Date.now() + 60_000));

    const result = await store.rotateRefreshToken(
      a.tokenHash,
      new Date(),
      b.tokenHash,
      new Date(Date.now() + 60_000),
    );
    expect(result.outcome).toBe('rotated');
    if (result.outcome === 'rotated') expect(result.user.id).toBe(user.id);

    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, user.id));
    const byHash = Object.fromEntries(rows.map((r) => [r.tokenHash, r]));
    expect(byHash[a.tokenHash]?.revokedAt).not.toBeNull(); // old revoked
    expect(byHash[b.tokenHash]?.revokedAt).toBeNull(); // new live
  });

  it('replaying a rotated token is reuse_detected and revokes the whole family', async () => {
    const user = await freshUser();
    const a = generateToken();
    const b = generateToken();
    await store.createRefreshToken(user.id, a.tokenHash, new Date(Date.now() + 60_000));
    await store.rotateRefreshToken(a.tokenHash, new Date(), b.tokenHash, new Date(Date.now() + 60_000));

    // Present the already-rotated token A again → reuse.
    const c = generateToken();
    const replay = await store.rotateRefreshToken(
      a.tokenHash,
      new Date(),
      c.tokenHash,
      new Date(Date.now() + 60_000),
    );
    expect(replay.outcome).toBe('reuse_detected');

    // Family nuke: every token for the user is now revoked (incl. the live B).
    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, user.id));
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('an unknown token is invalid; an expired token is invalid', async () => {
    const unknown = await store.rotateRefreshToken(
      hashToken('never-issued'),
      new Date(),
      'x',
      new Date(Date.now() + 60_000),
    );
    expect(unknown.outcome).toBe('invalid');

    const user = await freshUser();
    const expired = generateToken();
    await store.createRefreshToken(user.id, expired.tokenHash, new Date(Date.now() - 1000));
    const result = await store.rotateRefreshToken(
      expired.tokenHash,
      new Date(),
      'y',
      new Date(Date.now() + 60_000),
    );
    expect(result.outcome).toBe('invalid');
  });

  it('revokeRefreshToken is idempotent', async () => {
    const user = await freshUser();
    const t = generateToken();
    await store.createRefreshToken(user.id, t.tokenHash, new Date(Date.now() + 60_000));
    await store.revokeRefreshToken(t.tokenHash, new Date());
    await store.revokeRefreshToken(t.tokenHash, new Date()); // no throw on second call
    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, t.tokenHash));
    expect(rows[0]?.revokedAt).not.toBeNull();
  });
});
