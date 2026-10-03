import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConnection, type Connection } from 'mysql2/promise';
import { executeQueryFunction } from './executor';
import { createMysql2QueryRunner } from './query-runner';
import type { AllowListAccessor, OrgDataAccess } from './allow-list';

// ---------------------------------------------------------------------------
// Live END-TO-END query execution against Docker MySQL — env-gated on MYSQL_URL (skips when
// absent). Required by spec 12 success criteria: both starter functions return EXACT,
// DB-computed numbers over a seeded fixture, through the real builder + mysql2 runner. The
// allow-list + connection are injected (Postgres not needed); the runner's `decrypt` is faked
// to return the known MySQL password. Seeds a throwaway DB and drops it after.
// ---------------------------------------------------------------------------
const TEST_DB = 'lumen_qr_e2e_test';

function rootConfig(): { host: string; port: number; user: string; password: string } {
  const url = new URL(process.env.MYSQL_URL ?? '');
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

describe.skipIf(!process.env.MYSQL_URL)('live: query-function end-to-end', () => {
  let root: ReturnType<typeof rootConfig>;
  let admin: Connection | undefined;
  let deps: { accessor: AllowListAccessor; runner: ReturnType<typeof createMysql2QueryRunner> };

  beforeAll(async () => {
    root = rootConfig();
    admin = await createConnection({ ...root, connectTimeout: 8000, multipleStatements: true });
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await admin.query(`CREATE DATABASE \`${TEST_DB}\``);
    await admin.query(`USE \`${TEST_DB}\``);
    await admin.query(
      'CREATE TABLE qr_orders (id INT PRIMARY KEY, total DECIMAL(10,2), status VARCHAR(20), created_at DATETIME)',
    );
    await admin.query(
      'CREATE TABLE qr_items (id INT PRIMARY KEY, order_id INT, line_total DECIMAL(10,2))',
    );
    await admin.query(`INSERT INTO qr_orders VALUES
      (1, 100.00, 'paid', '2026-01-15 10:00:00'),
      (2, 200.00, 'paid', '2026-01-20 10:00:00'),
      (3, 50.00, 'pending', '2026-02-10 10:00:00'),
      (4, 300.00, 'paid', '2026-02-25 10:00:00')`);
    await admin.query(`INSERT INTO qr_items VALUES
      (1, 1, 60.00), (2, 1, 40.00), (3, 3, 50.00)`);
    // Own table so the day-boundary case can't perturb the sums asserted above. The last row
    // sits late on the last day of the month — the one a midnight upper bound silently drops.
    await admin.query('CREATE TABLE qr_boundary (id INT PRIMARY KEY, created_at DATETIME)');
    await admin.query(`INSERT INTO qr_boundary VALUES
      (1, '2026-02-01 00:00:00'),
      (2, '2026-02-15 12:00:00'),
      (3, '2026-02-28 23:30:00'),
      (4, '2026-03-01 00:30:00')`);

    const access: OrgDataAccess = {
      connection: {
        connectionId: 'conn-e2e',
        status: 'active',
        host: root.host,
        port: root.port,
        databaseName: TEST_DB,
        username: root.user,
        sslEnabled: false,
        encryptedPassword: Buffer.from('not-used-decrypt-is-faked'),
      },
      allowList: {
        tables: new Map([
          ['qr_orders', new Map([['id', 'int'], ['total', 'decimal(10,2)'], ['status', 'varchar(20)'], ['created_at', 'datetime']])],
          ['qr_items', new Map([['id', 'int'], ['order_id', 'int'], ['line_total', 'decimal(10,2)']])],
          ['qr_boundary', new Map([['id', 'int'], ['created_at', 'datetime']])],
        ]),
        relationships: [
          { name: 'qr_items__order_id__qr_orders', fromTable: 'qr_items', fromColumn: 'order_id', toTable: 'qr_orders', toColumn: 'id' },
        ],
      },
    };
    deps = {
      accessor: { getByOrg: async () => access },
      runner: createMysql2QueryRunner({ decrypt: () => root.password }),
    };
  }, 30_000);

  afterAll(async () => {
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
      await admin.end();
    }
  });

  it('aggregate_over_time sums by month — exact DB-computed numbers', async () => {
    const res = await executeQueryFunction(
      {
        functionName: 'aggregate_over_time',
        rawParams: {
          table: 'qr_orders',
          metric: { agg: 'sum', column: 'total' },
          dateColumn: 'created_at',
          grain: 'month',
          from: '2026-01-01',
          to: '2026-02-28',
        },
        orgId: 'org-e2e',
      },
      deps,
    );
    expect(res.outcome).toBe('rows');
    if (res.outcome !== 'rows') return;
    const byBucket = Object.fromEntries(res.rows.map((r) => [r.bucket as string, Number(r.value)]));
    expect(byBucket).toEqual({ '2026-01': 300, '2026-02': 350 });
  });

  it('filtered_aggregate sums with a filter — exact number', async () => {
    const res = await executeQueryFunction(
      {
        functionName: 'filtered_aggregate',
        rawParams: {
          table: 'qr_orders',
          metric: { agg: 'sum', column: 'total' },
          filters: [{ column: 'status', op: 'eq', value: 'paid' }],
        },
        orgId: 'org-e2e',
      },
      deps,
    );
    expect(res.outcome).toBe('rows');
    if (res.outcome !== 'rows') return;
    expect(Number(res.rows[0]?.value)).toBe(600); // 100 + 200 + 300
  });

  it('filtered_aggregate: a bare ISO date under `lte` counts the WHOLE last day', async () => {
    const res = await executeQueryFunction(
      {
        functionName: 'filtered_aggregate',
        rawParams: {
          table: 'qr_boundary',
          metric: { agg: 'count', column: 'id' },
          filters: [
            { column: 'created_at', op: 'gte', value: '2026-02-01' },
            { column: 'created_at', op: 'lte', value: '2026-02-28' },
          ],
        },
        orgId: 'org-e2e',
      },
      deps,
    );
    expect(res.outcome).toBe('rows');
    if (res.outcome !== 'rows') return;
    // 3 of the 4 rows are in February; binding the bound as written would answer 2, dropping
    // the 23:30 row — and March 1st must stay out.
    expect(Number(res.rows[0]?.value)).toBe(3);
  });

  it('filtered_aggregate joins via the exposed relationship — group by the joined table', async () => {
    const res = await executeQueryFunction(
      {
        functionName: 'filtered_aggregate',
        rawParams: {
          table: 'qr_items',
          metric: { agg: 'sum', column: 'line_total' },
          groupBy: 'status',
          relationship: 'qr_items__order_id__qr_orders',
          joinTable: 'qr_orders',
        },
        orgId: 'org-e2e',
      },
      deps,
    );
    expect(res.outcome).toBe('rows');
    if (res.outcome !== 'rows') return;
    const byStatus = Object.fromEntries(res.rows.map((r) => [r.group_key as string, Number(r.value)]));
    expect(byStatus).toEqual({ paid: 100, pending: 50 }); // order1 (60+40) paid, order3 (50) pending
  });

  it('a column not in the allow-list is refused — never runs SQL', async () => {
    const res = await executeQueryFunction(
      {
        functionName: 'aggregate_over_time',
        rawParams: {
          table: 'qr_orders',
          metric: { agg: 'sum', column: 'total; DROP TABLE qr_orders' },
          dateColumn: 'created_at',
          grain: 'month',
          from: '2026-01-01',
          to: '2026-02-28',
        },
        orgId: 'org-e2e',
      },
      deps,
    );
    expect(res).toMatchObject({ outcome: 'refused', code: 'column_not_exposed' });
    // Prove the table still exists (nothing was dropped).
    const [rows] = await admin!.query(`SELECT COUNT(*) AS n FROM \`${TEST_DB}\`.qr_orders`);
    expect(Number((rows as Array<{ n: number }>)[0]?.n)).toBe(4);
  });
});
