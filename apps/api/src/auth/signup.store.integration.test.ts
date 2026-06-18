import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { makeDb, type Database } from '../db/client';
import { organizations, users } from '../db/schema';
import { makeDrizzleSignupStore, type SignupStore } from './signup.store';
import { createSignupService } from './signup.service';
import { noopVerificationTrigger } from './verification-trigger';
import { hashPassword } from '../crypto';

// ---------------------------------------------------------------------------
// Live signup-store integration — env-gated on DATABASE_URL. Skips when absent so
// `pnpm test` stays green offline; run green at least once vs local Docker Postgres
// (recorded LIVE-VERIFICATION-PENDING). Creates a throwaway database, migrates it,
// exercises the REAL transaction (atomicity + UNIQUE-email rollback), then drops it.
// ---------------------------------------------------------------------------
const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '..', '..', 'drizzle');
const TEST_DB = 'lumen_signup_test';

function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

let emailCounter = 0;
const uniqueEmail = (): string => `owner${emailCounter++}@example.com`;

describe.skipIf(!process.env.DATABASE_URL)('live: signup store (Drizzle transaction)', () => {
  let admin: Pool | undefined;
  let pool: Pool | undefined;
  let db: Database;
  let store: SignupStore;

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
    store = makeDrizzleSignupStore(db);
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.end();
    }
  });

  const countOrgs = async (): Promise<number> => (await db.select().from(organizations)).length;

  it('creates exactly one org + one owner, password stored as an argon2 hash (not raw)', async () => {
    const email = uniqueEmail();
    const password = 'a-strong-pass-9';
    const service = createSignupService({
      store,
      hashPassword, // the real argon2id hasher (spec 02)
      verificationTrigger: noopVerificationTrigger,
    });

    await service.signup({ email, password, organizationName: 'Acme Live' });

    const userRows = await db.select().from(users).where(eq(users.email, email));
    expect(userRows).toHaveLength(1);
    const user = userRows[0];
    expect(user?.role).toBe('owner');
    expect(user?.emailVerified).toBe(false);
    expect(user?.orgId).toBeTruthy();
    // GUARD: the raw password never lands in the DB — only the argon2id hash.
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user?.passwordHash).not.toBe(password);

    const orgRows = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, user?.orgId ?? ''));
    expect(orgRows).toHaveLength(1);
    expect(orgRows[0]?.name).toBe('Acme Live');
  });

  it('a duplicate email returns `duplicate` and rolls back — zero new rows', async () => {
    const email = uniqueEmail();
    const first = await store.createTenant({
      email,
      passwordHash: '$argon2id$placeholder-first',
      organizationName: 'First Co',
    });
    expect(first.outcome).toBe('created');

    const orgsBefore = await countOrgs();
    const dup = await store.createTenant({
      email,
      passwordHash: '$argon2id$placeholder-second',
      organizationName: 'Second Co',
    });
    expect(dup.outcome).toBe('duplicate');

    // The 2nd insert hit UNIQUE(email) on the owner; the whole tx rolled back, so the
    // org insert was undone too — no orphan org, exactly one user for this email.
    expect(await countOrgs()).toBe(orgsBefore);
    const leaked = await db.select().from(organizations).where(eq(organizations.name, 'Second Co'));
    expect(leaked).toHaveLength(0);
    const usersForEmail = await db.select().from(users).where(eq(users.email, email));
    expect(usersForEmail).toHaveLength(1);
  });
});
