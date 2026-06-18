import { describe, it, expect, vi } from 'vitest';
import { buildQueryTools, toolNamesMatchRegistry } from './query-tools';
import type { AllowListAccessor, OrgDataAccess } from '../query-registry/allow-list';
import type { QueryRunner } from '../query-registry/query-runner';
import type { FunctionLogStore } from './function-log.store';

const access: OrgDataAccess = {
  connection: {
    connectionId: 'c1',
    status: 'active',
    host: 'db.internal',
    port: 3306,
    databaseName: 'shop',
    username: 'ro',
    sslEnabled: false,
    encryptedPassword: Buffer.from('enc'),
  },
  allowList: {
    tables: new Map([['orders', new Map([['total', 'decimal'], ['created_at', 'datetime']])]]),
    relationships: [],
  },
};

function makeCtx(opts: { rows?: Record<string, unknown>[] } = {}) {
  const logs: Parameters<FunctionLogStore['insert']>[0][] = [];
  const accessor: AllowListAccessor = { getByOrg: vi.fn(async () => access) };
  const runner: QueryRunner = { run: vi.fn(async () => opts.rows ?? [{ bucket: '2026-05', value: 128000 }]) };
  const logStore: FunctionLogStore = { insert: vi.fn(async (row) => void logs.push(row)) };
  const ctx = {
    orgId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    model: 'claude-opus-4-8',
    accessor,
    runner,
    logStore,
    now: (() => {
      let t = 1000;
      return () => (t += 5);
    })(),
  };
  return { ctx, logs, runner };
}

describe('toolNamesMatchRegistry', () => {
  it('the tool catalog matches the registry (no drift)', () => {
    expect(toolNamesMatchRegistry()).toBe(true);
  });
});

describe('buildQueryTools — execute runs the guarded query + logs sanitized', () => {
  it('happy path: returns rows to the model and writes a success log with NO raw values', async () => {
    const { ctx, logs } = makeCtx();
    const tools = buildQueryTools(ctx);
    const agg = tools.find((t) => t.name === 'aggregate_over_time')!;

    const result = await agg.execute({
      table: 'orders',
      metric: { agg: 'sum', column: 'total' },
      dateColumn: 'created_at',
      grain: 'month',
      from: '2026-05-01',
      to: '2026-05-31',
    });

    expect(result).toEqual({ ok: true, rows: [{ bucket: '2026-05', value: 128000 }] });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ functionName: 'aggregate_over_time', status: 'success', model: 'claude-opus-4-8', provider: 'claude' });
    expect(typeof logs[0]?.durationMs).toBe('number');
    // The logged params carry ONLY names/shape — no schema name, no value.
    const paramsJson = JSON.stringify(logs[0]?.params);
    expect(paramsJson).not.toContain('orders');
    expect(paramsJson).not.toContain('total');
    expect(paramsJson).not.toContain('2026-05-01');
    // No secret / host ever in the log.
    expect(JSON.stringify(logs[0])).not.toContain('db.internal');
    expect(JSON.stringify(logs[0])).not.toContain('enc');
  });

  it('injection param: refused by the registry guard — NO SQL runs, logged failed', async () => {
    const { ctx, logs, runner } = makeCtx();
    const tools = buildQueryTools(ctx);
    const agg = tools.find((t) => t.name === 'aggregate_over_time')!;

    const result = await agg.execute({
      table: 'orders',
      metric: { agg: 'sum', column: 'total; DROP TABLE orders' },
      dateColumn: 'created_at',
      grain: 'month',
      from: '2026-05-01',
      to: '2026-05-31',
    });

    expect(result).toEqual({ ok: false, error: 'column_not_exposed' });
    expect(runner.run).not.toHaveBeenCalled(); // no model string reached SQL
    expect(logs[0]).toMatchObject({ status: 'failed', errorMessage: 'column_not_exposed' });
  });

  it('bad params: logged failed with invalid_params (no execution)', async () => {
    const { ctx, logs, runner } = makeCtx();
    const tools = buildQueryTools(ctx);
    const agg = tools.find((t) => t.name === 'aggregate_over_time')!;
    const result = await agg.execute({ table: 'orders' }); // missing required fields
    expect(result).toEqual({ ok: false, error: 'invalid_params' });
    expect(runner.run).not.toHaveBeenCalled();
    expect(logs[0]).toMatchObject({ status: 'failed', errorMessage: 'invalid_params' });
  });
});
