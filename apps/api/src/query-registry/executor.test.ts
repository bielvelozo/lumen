import { describe, it, expect, vi } from 'vitest';
import { executeQueryFunction } from './executor';
import type { AllowListAccessor, OrgDataAccess, ResolvedConnection } from './allow-list';
import type { QueryRunner } from './query-runner';

const CONNECTION: ResolvedConnection = {
  connectionId: 'conn-1',
  status: 'active',
  host: 'db',
  port: 3306,
  databaseName: 'shop',
  username: 'lumen_ro',
  sslEnabled: false,
  encryptedPassword: Buffer.from('enc'),
};

const access: OrgDataAccess = {
  connection: CONNECTION,
  allowList: {
    tables: new Map([
      ['orders', new Map([['id', 'int'], ['total', 'decimal(10,2)'], ['status', 'varchar(20)'], ['created_at', 'datetime']])],
    ]),
    relationships: [],
  },
};

function makeDeps(opts: { access?: OrgDataAccess | null; rows?: Record<string, unknown>[]; runThrows?: boolean } = {}) {
  const accessor: AllowListAccessor = {
    getByOrg: vi.fn(async () => (opts.access === undefined ? access : opts.access)),
  };
  const runner: QueryRunner = {
    run: vi.fn(async () => {
      if (opts.runThrows) throw new Error('raw driver error: secret leak attempt');
      return opts.rows ?? [{ bucket: '2026-01', value: 42 }];
    }),
  };
  return { accessor, runner };
}

const VALID = {
  table: 'orders',
  metric: { agg: 'sum', column: 'total' },
  dateColumn: 'created_at',
  grain: 'month',
  from: '2026-01-01',
  to: '2026-05-31',
};

describe('executeQueryFunction', () => {
  it('happy path: validates, guards, builds, runs — returns DB rows', async () => {
    const deps = makeDeps();
    const res = await executeQueryFunction({ functionName: 'aggregate_over_time', rawParams: VALID, orgId: 'org-1' }, deps);
    expect(res).toEqual({ outcome: 'rows', rows: [{ bucket: '2026-01', value: 42 }] });
    // The org came from the input (JWT in spec 13), passed straight to the accessor.
    expect(deps.accessor.getByOrg).toHaveBeenCalledWith('org-1');
  });

  it('unknown function → typed refusal, no DB call', async () => {
    const deps = makeDeps();
    const res = await executeQueryFunction({ functionName: 'run_raw_sql', rawParams: {}, orgId: 'org-1' }, deps);
    expect(res).toMatchObject({ outcome: 'refused', code: 'unknown_function' });
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it('bad params → invalid, no guard, no DB call', async () => {
    const deps = makeDeps();
    const res = await executeQueryFunction(
      { functionName: 'aggregate_over_time', rawParams: { ...VALID, from: '2026-12-01' }, orgId: 'org-1' },
      deps,
    );
    expect(res.outcome).toBe('invalid');
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it('GUARD: a column not in the snapshot (incl. an injection string) is refused — builder/runner never reached', async () => {
    const deps = makeDeps();
    const res = await executeQueryFunction(
      {
        functionName: 'aggregate_over_time',
        rawParams: { ...VALID, metric: { agg: 'sum', column: 'total; DROP TABLE orders' } },
        orgId: 'org-1',
      },
      deps,
    );
    expect(res).toMatchObject({ outcome: 'refused', code: 'column_not_exposed' });
    // No model-supplied string ever reached the SQL builder or the DB.
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it('relationship not exposed → refused before any DB call', async () => {
    const deps = makeDeps();
    const res = await executeQueryFunction(
      {
        functionName: 'filtered_aggregate',
        rawParams: {
          table: 'orders',
          metric: { agg: 'sum', column: 'total' },
          relationship: 'orders__x__secrets',
          joinTable: 'secrets',
        },
        orgId: 'org-1',
      },
      deps,
    );
    // 'secrets' isn't exposed → table_not_exposed (caught before the relationship check).
    expect(res).toMatchObject({ outcome: 'refused' });
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it('connection not active → connection_unavailable', async () => {
    const deps = makeDeps({ access: { ...access, connection: { ...CONNECTION, status: 'failed' } } });
    const res = await executeQueryFunction({ functionName: 'aggregate_over_time', rawParams: VALID, orgId: 'org-1' }, deps);
    expect(res).toMatchObject({ outcome: 'refused', code: 'connection_unavailable' });
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it('no connection (another org / cross-tenant resolves to nothing) → connection_unavailable', async () => {
    const deps = makeDeps({ access: null });
    const res = await executeQueryFunction({ functionName: 'aggregate_over_time', rawParams: VALID, orgId: 'other-org' }, deps);
    expect(res).toMatchObject({ outcome: 'refused', code: 'connection_unavailable' });
  });

  it('runner throws → sanitized query_failed (raw error discarded)', async () => {
    const deps = makeDeps({ runThrows: true });
    const res = await executeQueryFunction({ functionName: 'aggregate_over_time', rawParams: VALID, orgId: 'org-1' }, deps);
    expect(res).toMatchObject({ outcome: 'refused', code: 'query_failed' });
    expect(JSON.stringify(res)).not.toContain('secret leak attempt');
  });
});
