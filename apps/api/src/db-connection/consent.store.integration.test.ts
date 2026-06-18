import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { makeDb, type Database } from '../db/client';
import { dbConnectionConsents } from '../db/schema';
import { makeDrizzleConsentStore, type ConsentStore } from './consent.store';
import { makeDrizzleSignupStore, type SignupStore } from '../auth/signup.store';

// ---------------------------------------------------------------------------
// Live consent-store integration — env-gated on DATABASE_URL. Skips when absent.
// Run green once vs local Docker Postgres (recorded LIVE-VERIFICATION-PENDING). Throwaway
// DB, migrate (incl. 0001 db_connection_consents), exercise record/read + idempotent
// re-accept, then drop it.
// ---------------------------------------------------------------------------
const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '..', '..', 'drizzle');
const TEST_DB = 'lumen_consent_test';

function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

let n = 0;

describe.skipIf(!process.env.DATABASE_URL)('live: consent store', () => {
  let admin: Pool | undefined;
  let pool: Pool | undefined;
  let db: Database;
  let store: ConsentStore;
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
    store = makeDrizzleConsentStore(db);
    signupStore = makeDrizzleSignupStore(db);
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.end();
    }
  });

  async function freshOrgUser(): Promise<{ orgId: string; userId: string }> {
    const result = await signupStore.createTenant({
      email: `consent${n++}@example.com`,
      passwordHash: '$argon2id$placeholder',
      organizationName: 'Consent Co',
    });
    if (result.outcome !== 'created') throw new Error('failed to create tenant');
    return { orgId: result.orgId, userId: result.userId };
  }

  it('records consent scoped to the org and reads it back', async () => {
    const a = await freshOrgUser();
    const b = await freshOrgUser();
    await store.recordConsent(a.orgId, a.userId, '1');

    expect(await store.getAcceptedVersion(a.orgId)).toBe('1');
    // Org isolation: org B has no consent.
    expect(await store.getAcceptedVersion(b.orgId)).toBeNull();
  });

  it('is idempotent on re-accepting the same version (unique org+version)', async () => {
    const { orgId, userId } = await freshOrgUser();
    await store.recordConsent(orgId, userId, '1');
    await store.recordConsent(orgId, userId, '1'); // no duplicate-key error

    const rows = await db
      .select()
      .from(dbConnectionConsents)
      .where(eq(dbConnectionConsents.orgId, orgId));
    expect(rows).toHaveLength(1);
  });

  it('returns the most-recently accepted version after a version bump', async () => {
    const { orgId, userId } = await freshOrgUser();
    await store.recordConsent(orgId, userId, '1');
    await store.recordConsent(orgId, userId, '2');
    expect(await store.getAcceptedVersion(orgId)).toBe('2');
  });
});
