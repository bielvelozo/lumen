import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { createConnection, type Connection } from 'mysql2/promise';
import { makeDb } from '../db/client';
import { makeDrizzleSignupStore } from '../auth/signup.store';
import { createMysql2QueryRunner } from '../query-registry/query-runner';
import type { OrgDataAccess } from '../query-registry/allow-list';
import { makeDrizzleSalesMappingStore, type SalesMappingStore } from './sales-mapping.store';
import { createHomeMetricsService } from './home-metrics.service';

// ---------------------------------------------------------------------------
// Live, env-gated: the mapping store against the real Postgres (DATABASE_URL) and the metrics
// against the real MySQL through the real runner (MYSQL_URL). Each suite skips when its URL is
// absent. The MySQL suite pins what fakes cannot: DECIMAL figures arrive as strings, and a sale at
// 23:30 on the last day belongs to that month while 00:30 on the 1st does not.
// ---------------------------------------------------------------------------
const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '..', '..', 'drizzle');
const PG_TEST_DB = 'lumen_sales_mapping_test';
const MYSQL_TEST_DB = 'lumen_home_metrics_test';

function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

describe.skipIf(!process.env.DATABASE_URL)('live: sales mapping store', () => {
  let admin: Pool | undefined;
  let pool: Pool | undefined;
  let store: SalesMappingStore;
  const orgs: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    admin = new Pool({ connectionString: withDatabase(url, 'postgres') });
    await admin.query(`DROP DATABASE IF EXISTS ${PG_TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${PG_TEST_DB}`);
    const made = makeDb(withDatabase(url, PG_TEST_DB));
    pool = made.pool;
    await migrate(made.db, { migrationsFolder: MIGRATIONS_FOLDER });
    store = makeDrizzleSalesMappingStore(made.db);

    for (const name of ['a', 'b']) {
      const tenant = await makeDrizzleSignupStore(made.db).createTenant({
        email: `sales-mapping-${name}@example.com`,
        passwordHash: '$argon2id$placeholder',
        organizationName: `Sales Mapping ${name}`,
      });
      if (tenant.outcome !== 'created') throw new Error('failed to create test tenant');
      orgs.push(tenant.orgId);
    }
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${PG_TEST_DB} WITH (FORCE)`);
      await admin.end();
    }
  });

  it('keeps one mapping per org, replaced on save, invisible to other orgs', async () => {
    const [orgA, orgB] = orgs as [string, string];
    expect(await store.get(orgA)).toBeNull();

    await store.upsert(orgA, { table: 'pedidos', amountColumn: 'total', dateColumn: 'criado_em' });
    await store.upsert(orgA, { table: 'vendas', amountColumn: 'valor', dateColumn: 'data' });

    expect(await store.get(orgA)).toEqual({ table: 'vendas', amountColumn: 'valor', dateColumn: 'data' });
    expect(await store.get(orgB)).toBeNull();
  });
});

describe.skipIf(!process.env.MYSQL_URL)('live: home metrics against MySQL', () => {
  let admin: Connection | undefined;
  let access: OrgDataAccess;

  beforeAll(async () => {
    const url = new URL(process.env.MYSQL_URL ?? '');
    const root = {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
    admin = await createConnection({ ...root, connectTimeout: 8000 });
    await admin.query(`DROP DATABASE IF EXISTS \`${MYSQL_TEST_DB}\``);
    await admin.query(`CREATE DATABASE \`${MYSQL_TEST_DB}\``);
    await admin.query(`USE \`${MYSQL_TEST_DB}\``);
    await admin.query('CREATE TABLE pedidos (id INT PRIMARY KEY, total DECIMAL(12,2) NOT NULL, criado_em DATETIME NOT NULL)');
    await admin.query(`INSERT INTO pedidos VALUES
      (1, 100.10, '2026-06-30 23:30:00'),
      (2, 200.00, '2026-07-01 00:30:00'),
      (3, 300.25, '2026-07-31 23:30:00'),
      (4, 999.99, '2026-08-01 00:30:00'),
      (5, 50.05, '2026-08-15 12:00:00'),
      (6, 10.00, '2026-09-02 09:00:00')`);

    access = {
      connection: {
        connectionId: 'c1',
        status: 'active',
        host: root.host,
        port: root.port,
        databaseName: MYSQL_TEST_DB,
        username: root.user,
        sslEnabled: false,
        encryptedPassword: Buffer.from(root.password),
      },
      allowList: {
        tables: new Map([['pedidos', new Map([['id', 'int'], ['total', 'decimal(12,2)'], ['criado_em', 'datetime']])]]),
        relationships: [],
      },
    };
  }, 30_000);

  afterAll(async () => {
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${MYSQL_TEST_DB}\``);
      await admin.end();
    }
  });

  it('computes the last closed month and the one before, to the cent, with whole-day bounds', async () => {
    const service = createHomeMetricsService({
      store: {
        get: async () => ({ table: 'pedidos', amountColumn: 'total', dateColumn: 'criado_em' }),
        upsert: async () => undefined,
      },
      accessor: { getByOrg: async () => access },
      runner: createMysql2QueryRunner({ decrypt: (b) => b.toString('utf8') }),
      now: () => new Date('2026-09-24T15:00:00Z'),
    });

    const result = await service.getMetrics('org');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.current).toMatchObject({ month: '2026-08', orders: 2 });
    expect(Number(result.current.total)).toBeCloseTo(1050.04, 2);
    expect(Number(result.current.averageTicket)).toBeCloseTo(525.02, 2);
    expect(result.previous).toMatchObject({ month: '2026-07', orders: 2 });
    expect(Number(result.previous.total)).toBeCloseTo(500.25, 2);
    expect(typeof result.current.total).toBe('string');
  });
});
