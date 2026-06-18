import {
  aggregateOverTimeParamsSchema,
  type AggregateOverTimeParams,
  RESULT_ROW_LIMIT,
} from '@lumen/shared';
import { quoteIdent, qualified } from '../identifiers';
import { bucketExpr, aggExpr } from '../sql-fragments';
import type { NeedManifest } from '../guard';
import type { BuiltQuery, QueryFunctionDefinition } from '../types';

function needs(p: AggregateOverTimeParams): NeedManifest {
  return {
    tables: [p.table],
    columns: [
      // sum/avg require a numeric column; count(col) does not.
      { table: p.table, column: p.metric.column, family: p.metric.agg === 'count' ? undefined : 'numeric' },
      { table: p.table, column: p.dateColumn, family: 'temporal' },
    ],
    relationships: [],
  };
}

function build(p: AggregateOverTimeParams): BuiltQuery {
  const dateCol = qualified(p.table, p.dateColumn);
  const bucket = bucketExpr(p.grain, dateCol);
  const metric = aggExpr(p.metric.agg, qualified(p.table, p.metric.column));
  const sql =
    `SELECT ${bucket} AS bucket, ${metric} AS value ` +
    `FROM ${quoteIdent(p.table)} ` +
    `WHERE ${dateCol} >= ? AND ${dateCol} <= ? ` +
    `GROUP BY bucket ORDER BY bucket ` +
    `LIMIT ${RESULT_ROW_LIMIT}`;
  // Inclusive full-day bounds — both VALUES are bound.
  return { sql, params: [`${p.from} 00:00:00`, `${p.to} 23:59:59`] };
}

/**
 * `aggregate_over_time` — sum/count/avg of an exposed numeric column, bucketed by a time grain
 * over an exposed date column, within `[from, to]`, on ONE exposed table. The model picks the
 * table/columns (validated as allow-list members by the guard) and the agg/grain (closed enums).
 */
export const aggregateOverTime: QueryFunctionDefinition = {
  name: 'aggregate_over_time',
  prepare(raw) {
    const parsed = aggregateOverTimeParamsSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, issues: parsed.error.issues };
    const p = parsed.data;
    return { ok: true, prepared: { manifest: needs(p), build: () => build(p) } };
  },
};
