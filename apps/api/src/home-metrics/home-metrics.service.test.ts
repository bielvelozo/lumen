import { describe, it, expect, vi } from 'vitest';
import type { SalesMapping } from '@lumen/shared';
import type { AllowListAccessor, OrgDataAccess } from '../query-registry';
import type { QueryRunner, ReadOnlyQueryInput } from '../query-registry/query-runner';
import { createHomeMetricsService, lastClosedMonths } from './home-metrics.service';
import type { SalesMappingStore } from './sales-mapping.store';

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MAPPING: SalesMapping = { table: 'pedidos', amountColumn: 'total', dateColumn: 'criado_em' };
const SEPT_24 = new Date('2026-09-24T23:00:00Z');

function access(overrides: Partial<OrgDataAccess['connection']> = {}): OrgDataAccess {
  return {
    connection: {
      connectionId: 'c1',
      status: 'active',
      host: 'db',
      port: 3306,
      databaseName: 'loja',
      username: 'ro',
      sslEnabled: false,
      encryptedPassword: Buffer.from('x'),
      ...overrides,
    },
    allowList: {
      tables: new Map([
        ['pedidos', new Map([['id', 'int'], ['status', 'varchar(20)'], ['total', 'decimal(12,2)'], ['criado_em', 'datetime']])],
      ]),
      relationships: [],
    },
  };
}

function setup(opts: { mapping?: SalesMapping | null; access?: OrgDataAccess | null; rows?: (sql: string) => Record<string, unknown>[] } = {}) {
  const store: SalesMappingStore = {
    get: vi.fn(async () => (opts.mapping === undefined ? MAPPING : opts.mapping)),
    upsert: vi.fn(async () => undefined),
  };
  const accessor: AllowListAccessor = {
    getByOrg: vi.fn(async () => (opts.access === undefined ? access() : opts.access)),
  };
  const calls: ReadOnlyQueryInput[] = [];
  const runner: QueryRunner = {
    run: vi.fn(async (input: ReadOnlyQueryInput) => {
      calls.push(input);
      return opts.rows ? opts.rows(input.sql) : [];
    }),
  };
  const service = createHomeMetricsService({ store, accessor, runner, now: () => SEPT_24 });
  return { service, store, accessor, runner, calls };
}

// What MySQL returns for the reference dataset: DECIMAL sums/averages arrive as strings.
function referenceRows(sql: string): Record<string, unknown>[] {
  if (/\bSUM\(/i.test(sql)) return [{ bucket: '2026-07', value: '60098.00' }, { bucket: '2026-08', value: '74323.10' }];
  if (/\bCOUNT\(/i.test(sql)) return [{ bucket: '2026-07', value: 46 }, { bucket: '2026-08', value: 53 }];
  return [{ bucket: '2026-07', value: '1306.478261' }, { bucket: '2026-08', value: '1402.322642' }];
}

describe('lastClosedMonths', () => {
  it('is the month before the current one, with the one before it to compare', () => {
    expect(lastClosedMonths(SEPT_24)).toEqual({
      current: { month: '2026-08', from: '2026-08-01', to: '2026-08-31' },
      previous: { month: '2026-07', from: '2026-07-01', to: '2026-07-31' },
    });
  });

  it('flips at midnight in Brazil, not in UTC', () => {
    // 02:00 UTC on Sept 1st is still Aug 31st, 23:00 in São Paulo.
    expect(lastClosedMonths(new Date('2026-09-01T02:00:00Z')).current.month).toBe('2026-07');
    expect(lastClosedMonths(new Date('2026-09-01T03:30:00Z')).current.month).toBe('2026-08');
  });

  it('crosses the year boundary and knows short months', () => {
    expect(lastClosedMonths(new Date('2026-01-15T12:00:00Z'))).toEqual({
      current: { month: '2025-12', from: '2025-12-01', to: '2025-12-31' },
      previous: { month: '2025-11', from: '2025-11-01', to: '2025-11-30' },
    });
    expect(lastClosedMonths(new Date('2028-03-10T12:00:00Z')).current.to).toBe('2028-02-29');
  });
});

describe('getMetrics', () => {
  it('asks the owner to configure when there is no mapping, without touching their database', async () => {
    const { service, runner } = setup({ mapping: null });
    expect(await service.getMetrics(ORG)).toEqual({ status: 'not_configured' });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('returns the database-computed figures for the last closed month and the one before', async () => {
    const { service } = setup({ rows: referenceRows });
    expect(await service.getMetrics(ORG)).toEqual({
      status: 'ok',
      current: { month: '2026-08', total: '74323.10', orders: 53, averageTicket: '1402.322642' },
      previous: { month: '2026-07', total: '60098.00', orders: 46, averageTicket: '1306.478261' },
    });
  });

  it('reads both months through aggregate_over_time, bounded by the two whole months', async () => {
    const { service, calls } = setup({ rows: referenceRows });
    await service.getMetrics(ORG);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.sql).toMatch(/^SELECT/i);
      expect(call.sql).toContain('`pedidos`');
      expect(call.params).toEqual(['2026-07-01 00:00:00', '2026-08-31 23:59:59']);
    }
  });

  it('shows a month without sales as zero, with no average ticket', async () => {
    const { service } = setup({
      rows: (sql) => (/\bCOUNT\(/i.test(sql) ? [{ bucket: '2026-08', value: 3 }] : [{ bucket: '2026-08', value: '30.00' }]),
    });
    const result = await service.getMetrics(ORG);
    expect(result).toMatchObject({ status: 'ok', previous: { month: '2026-07', total: '0', orders: 0, averageTicket: null } });
  });

  it('stops reading a column the owner no longer exposes', async () => {
    const unexposed = access();
    unexposed.allowList.tables.get('pedidos')?.delete('total');
    const { service, runner } = setup({ access: unexposed });
    expect(await service.getMetrics(ORG)).toEqual({ status: 'unavailable', reason: 'mapping_invalid' });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('reports an inactive connection', async () => {
    const { service } = setup({ access: access({ status: 'failed' }) });
    expect(await service.getMetrics(ORG)).toEqual({ status: 'unavailable', reason: 'connection_unavailable' });
  });

  it('reports a failed query without leaking the driver error', async () => {
    const { service, runner } = setup();
    vi.mocked(runner.run).mockRejectedValue(new Error('ER_ACCESS_DENIED for user ro@10.0.0.1'));
    expect(await service.getMetrics(ORG)).toEqual({ status: 'unavailable', reason: 'query_failed' });
  });
});

describe('saveMapping', () => {
  it('saves a mapping that points at an exposed numeric amount and temporal date', async () => {
    const { service, store } = setup();
    expect(await service.saveMapping(ORG, MAPPING)).toEqual({ outcome: 'saved', mapping: MAPPING });
    expect(store.upsert).toHaveBeenCalledWith(ORG, MAPPING);
  });

  it.each([
    [{ ...MAPPING, table: 'clientes' }, 'table_not_exposed'],
    [{ ...MAPPING, amountColumn: 'desconto' }, 'column_not_exposed'],
    [{ ...MAPPING, amountColumn: 'status' }, 'type_mismatch'],
    [{ ...MAPPING, dateColumn: 'total' }, 'type_mismatch'],
  ])('refuses %o with %s', async (mapping, code) => {
    const { service, store } = setup();
    expect(await service.saveMapping(ORG, mapping)).toEqual({ outcome: 'invalid', code });
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('needs a connection to validate against', async () => {
    const { service, store } = setup({ access: null });
    expect(await service.saveMapping(ORG, MAPPING)).toEqual({ outcome: 'no_connection' });
    expect(store.upsert).not.toHaveBeenCalled();
  });
});
