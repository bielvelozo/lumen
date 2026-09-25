import type {
  Aggregate,
  HomeMetricsResponse,
  HomeMetricsUnavailableReason,
  MonthSales,
  RefusalCode,
  SalesMapping,
} from '@lumen/shared';
import { executeQueryFunction, type AllowListAccessor, type QueryRunner } from '../query-registry';
import { guard } from '../query-registry/guard';
import type { SalesMappingStore } from './sales-mapping.store';

export type SaveMappingResult =
  | { outcome: 'saved'; mapping: SalesMapping }
  | { outcome: 'no_connection' }
  | { outcome: 'invalid'; code: RefusalCode };

export interface HomeMetricsService {
  getMapping(orgId: string): Promise<SalesMapping | null>;
  saveMapping(orgId: string, mapping: SalesMapping): Promise<SaveMappingResult>;
  getMetrics(orgId: string): Promise<HomeMetricsResponse>;
}

export interface HomeMetricsDeps {
  store: SalesMappingStore;
  accessor: AllowListAccessor;
  runner: QueryRunner;
  now?: () => Date;
}

interface MonthRange {
  month: string;
  from: string;
  to: string;
}

// The owner's DATETIME columns are naive local time, and the product is pt-BR: "last month"
// has to flip at midnight in Brazil, not at midnight UTC.
const TIME_ZONE = 'America/Sao_Paulo';

function monthRange(year: number, month: number): MonthRange {
  const normalized = new Date(Date.UTC(year, month - 1, 1));
  const y = normalized.getUTCFullYear();
  const m = normalized.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { month: `${y}-${mm}`, from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

export function lastClosedMonths(now: Date): { current: MonthRange; previous: MonthRange } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit' })
    .formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return { current: monthRange(year, month - 1), previous: monthRange(year, month - 2) };
}

function unavailableReason(code: RefusalCode | 'invalid_params'): HomeMetricsUnavailableReason {
  if (code === 'connection_unavailable') return 'connection_unavailable';
  if (code === 'query_failed') return 'query_failed';
  return 'mapping_invalid';
}

function decimalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export function createHomeMetricsService(deps: HomeMetricsDeps): HomeMetricsService {
  const now = deps.now ?? (() => new Date());

  return {
    getMapping: (orgId) => deps.store.get(orgId),

    async saveMapping(orgId, mapping) {
      const access = await deps.accessor.getByOrg(orgId);
      if (!access) return { outcome: 'no_connection' };
      const verdict = guard(
        {
          tables: [mapping.table],
          columns: [
            { table: mapping.table, column: mapping.amountColumn, family: 'numeric' },
            { table: mapping.table, column: mapping.dateColumn, family: 'temporal' },
          ],
          relationships: [],
        },
        access.allowList,
      );
      if (!verdict.ok) return { outcome: 'invalid', code: verdict.code };
      await deps.store.upsert(orgId, mapping);
      return { outcome: 'saved', mapping };
    },

    async getMetrics(orgId) {
      const mapping = await deps.store.get(orgId);
      if (!mapping) return { status: 'not_configured' };

      const { current, previous } = lastClosedMonths(now());
      const monthly = (agg: Aggregate) =>
        executeQueryFunction(
          {
            functionName: 'aggregate_over_time',
            rawParams: {
              table: mapping.table,
              metric: { agg, column: mapping.amountColumn },
              dateColumn: mapping.dateColumn,
              grain: 'month',
              from: previous.from,
              to: current.to,
            },
            orgId,
          },
          { accessor: deps.accessor, runner: deps.runner },
        );

      const [sums, counts, averages] = await Promise.all([monthly('sum'), monthly('count'), monthly('avg')]);
      const byMonth = new Map<string, { total?: string | null; orders?: number; averageTicket?: string | null }>();
      for (const [result, key] of [
        [sums, 'total'],
        [counts, 'orders'],
        [averages, 'averageTicket'],
      ] as const) {
        if (result.outcome !== 'rows') return { status: 'unavailable', reason: unavailableReason(result.code) };
        for (const row of result.rows) {
          const bucket = String(row.bucket);
          const entry = byMonth.get(bucket) ?? {};
          if (key === 'orders') entry.orders = Number(row.value);
          else entry[key] = decimalString(row.value);
          byMonth.set(bucket, entry);
        }
      }

      const figures = (range: MonthRange): MonthSales => {
        const entry = byMonth.get(range.month);
        return {
          month: range.month,
          total: entry?.total ?? '0',
          orders: entry?.orders ?? 0,
          averageTicket: entry?.averageTicket ?? null,
        };
      };
      return { status: 'ok', current: figures(current), previous: figures(previous) };
    },
  };
}
