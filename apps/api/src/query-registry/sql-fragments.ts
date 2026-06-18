import type { Aggregate, TimeGrain, FilterOp } from '@lumen/shared';

/**
 * SQL fragment builders. They take an ALREADY-QUOTED column expression (from `quoteIdent` /
 * `qualified` over an allow-listed name) and a CLOSED enum (agg / grain / op) — never a raw
 * model string. Every comparison VALUE is a bound `?`, never inlined.
 */

/** UTC time-bucket expression via `DATE_FORMAT`. Grain is a closed enum (exhaustive switch). */
export function bucketExpr(grain: TimeGrain, quotedCol: string): string {
  switch (grain) {
    case 'day':
      return `DATE_FORMAT(${quotedCol}, '%Y-%m-%d')`;
    case 'week':
      return `DATE_FORMAT(${quotedCol}, '%x-W%v')`;
    case 'month':
      return `DATE_FORMAT(${quotedCol}, '%Y-%m')`;
  }
}

/** Aggregate expression. Agg is a closed enum (exhaustive switch). */
export function aggExpr(agg: Aggregate, quotedCol: string): string {
  switch (agg) {
    case 'sum':
      return `SUM(${quotedCol})`;
    case 'avg':
      return `AVG(${quotedCol})`;
    case 'count':
      return `COUNT(${quotedCol})`;
  }
}

const OP_SQL: Record<FilterOp, string> = { eq: '=', gte: '>=', lte: '<=' };

/** A filter predicate `<col> <op> ?` — the value is always bound by the caller. */
export function filterFragment(quotedCol: string, op: FilterOp): string {
  return `${quotedCol} ${OP_SQL[op]} ?`;
}
