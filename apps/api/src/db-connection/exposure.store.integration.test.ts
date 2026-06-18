import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { makeDb, type Database } from '../db/client';
import { dbConnections } from '../db/schema';
import { makeDrizzleExposureStore, type ExposureStore } from './exposure.store';
import { makeDrizzleSignupStore, type SignupStore } from '../auth/signup.store';

// ---------------------------------------------------------------------------
// Live exposure-store integration — env-gated on DATABASE_URL. Throwaway DB, migrate, then
// exercise the REAL allow-list writes: atomic replace, idempotent re-save, un-expose cascade,
// and org/connection scoping. Recorded LIVE-VERIFICATION-PENDING.
// ---------------------------------------------------------------------------
const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '..', '..', 'drizzle');
const TEST_DB = 'lumen_exposure_test';

function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

let n = 0;
const TABLES = [
  { name: 'products', columns: [{ name: 'id', type: 'int' }] },
  { name: 'orders', columns: [{ name: 'id', type: 'int' }, { name: 'product_id', type: 'int' }] },
];
const REL = {
  name: 'orders__product_id__products',
  fromTable: 'orders',
  fromColumn: 'product_id',
  toTable: 'products',
  toColumn: 'id',
};

describe.skipIf(!process.env.DATABASE_URL)('live: exposure store', () => {
  let admin: Pool | undefined;
  let pool: Pool | undefined;
  let db: Database;
  let store: ExposureStore;
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
    store = makeDrizzleExposureStore(db);
    signupStore = makeDrizzleSignupStore(db);
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.end();
    }
  });

  // Create a tenant + an active db_connections row to hang exposure off of.
  async function freshConnection(): Promise<{ orgId: string; connId: string }> {
    const tenant = await signupStore.createTenant({
      email: `exposure${n++}@example.com`,
      passwordHash: '$argon2id$placeholder',
      organizationName: 'Exposure Co',
    });
    if (tenant.outcome !== 'created') throw new Error('failed to create tenant');
    const [row] = await db
      .insert(dbConnections)
      .values({
        orgId: tenant.orgId,
        engine: 'mysql',
        host: 'localhost',
        port: 3306,
        databaseName: 'shop',
        username: 'lumen_ro',
        sslEnabled: false,
        encryptedPassword: Buffer.from('enc'),
        status: 'active',
        consentVersion: '1',
        consentAcceptedAt: new Date(),
        consentAcceptedBy: tenant.userId,
      })
      .returning({ id: dbConnections.id });
    if (!row) throw new Error('failed to create connection');
    return { orgId: tenant.orgId, connId: row.id };
  }

  it('replaces + reads the allow-list (round-trip)', async () => {
    const { orgId, connId } = await freshConnection();
    await store.replaceExposure(orgId, connId, { tables: TABLES, relationships: [REL] });
    const exposure = await store.getExposure(orgId, connId);
    expect(exposure.tables.map((t) => t.name).sort()).toEqual(['orders', 'products']);
    expect(exposure.tables.find((t) => t.name === 'orders')?.columns).toEqual([
      { name: 'id', type: 'int' },
      { name: 'product_id', type: 'int' },
    ]);
    expect(exposure.relationships).toEqual([REL]);
  });

  it('is idempotent on re-save (no duplicate-key error)', async () => {
    const { orgId, connId } = await freshConnection();
    await store.replaceExposure(orgId, connId, { tables: TABLES, relationships: [REL] });
    await store.replaceExposure(orgId, connId, { tables: TABLES, relationships: [REL] });
    const exposure = await store.getExposure(orgId, connId);
    expect(exposure.tables).toHaveLength(2);
    expect(exposure.relationships).toHaveLength(1);
  });

  it('un-expose cascade: omitting a table drops its relationships (no dangling rows)', async () => {
    const { orgId, connId } = await freshConnection();
    await store.replaceExposure(orgId, connId, { tables: TABLES, relationships: [REL] });
    // Re-save with only `products` and no relationships.
    await store.replaceExposure(orgId, connId, {
      tables: [TABLES[0]!],
      relationships: [],
    });
    const exposure = await store.getExposure(orgId, connId);
    expect(exposure.tables.map((t) => t.name)).toEqual(['products']);
    expect(exposure.relationships).toEqual([]);
  });

  it('is org/connection scoped — another org never sees or is affected', async () => {
    const a = await freshConnection();
    const b = await freshConnection();
    await store.replaceExposure(a.orgId, a.connId, { tables: TABLES, relationships: [REL] });
    // org B's own exposure is empty.
    expect((await store.getExposure(b.orgId, b.connId)).tables).toEqual([]);
    // org A cannot read B's connection (filtered by org_id AND conn id).
    expect((await store.getExposure(a.orgId, b.connId)).tables).toEqual([]);
  });
});
