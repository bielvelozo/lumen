/**
 * Query-function registry contracts (spec 12) — the constitutional heart (invariant 3). The
 * model NEVER emits SQL or identifiers: it picks a function by name and fills a Zod-typed param
 * object. Aggregates / grains / filter ops are CLOSED backend enums; tables/columns/relationships
 * are strings the GUARD resolves by membership against the org's allow-list (never concatenated).
 * These schemas validate SHAPE only — the allow-list membership check happens server-side.
 */
import { z } from 'zod';

/** Closed aggregate set — the model selects by enum, never by string. */
export const AGGREGATES = ['sum', 'count', 'avg'] as const;
export type Aggregate = (typeof AGGREGATES)[number];

/** Closed time-grain set (UTC buckets in v1). */
export const TIME_GRAINS = ['day', 'week', 'month'] as const;
export type TimeGrain = (typeof TIME_GRAINS)[number];

/** Closed filter-operator set (equality + range in v1). */
export const FILTER_OPS = ['eq', 'gte', 'lte'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** The registered function names. An unknown name is a typed `unknown_function` error. */
export const QUERY_FUNCTION_NAMES = ['aggregate_over_time', 'filtered_aggregate'] as const;
export type QueryFunctionName = (typeof QUERY_FUNCTION_NAMES)[number];

/**
 * Closed set of sanitized refusal/error codes. Every non-row outcome carries one of these +
 * a model-safe message — NEVER raw SQL, schema internals, secrets, or customer values.
 */
export const REFUSAL_CODES = [
  'unknown_function',
  'invalid_params',
  'connection_unavailable',
  'table_not_exposed',
  'column_not_exposed',
  'relationship_not_exposed',
  'type_mismatch',
  'query_failed',
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

// A column/table identifier the model supplies is a plain string here; it carries NO authority
// until the guard confirms it is a member of the allow-list. Bounded length keeps a hostile
// value small; the guard (membership) — not this — is what makes injection impossible.
const identifierParam = z.string().min(1).max(64);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date (YYYY-MM-DD)');

/** The coarse type family a column must belong to for a given use (sum/avg, date bucketing). */
export type TypeFamily = 'numeric' | 'temporal';

const NUMERIC_TYPE = /\b(int|integer|tinyint|smallint|mediumint|bigint|decimal|numeric|dec|fixed|float|double|real|bit)\b/i;
const TEMPORAL_TYPE = /\b(date|datetime|timestamp|time|year)\b/i;

/** Classify a MySQL `COLUMN_TYPE` (from the exposure snapshot). The guard and the UI share it. */
export function sqlTypeFamily(sqlType: string): TypeFamily | null {
  if (NUMERIC_TYPE.test(sqlType)) return 'numeric';
  if (TEMPORAL_TYPE.test(sqlType)) return 'temporal';
  return null;
}

/** Max grouped rows a function may return (backend ceiling, v1 default). */
export const RESULT_ROW_LIMIT = 1000;

/**
 * `aggregate_over_time`: sum/count/avg of an exposed numeric column, bucketed by a time grain
 * over an exposed date column, within `[from, to]`, on ONE exposed table.
 */
export const aggregateOverTimeParamsSchema = z
  .object({
    table: identifierParam,
    metric: z
      .object({ agg: z.enum(AGGREGATES), column: identifierParam })
      .strict(),
    dateColumn: identifierParam,
    grain: z.enum(TIME_GRAINS),
    from: isoDate,
    to: isoDate,
  })
  .strict()
  .refine((p) => p.from <= p.to, { message: 'from must be <= to', path: ['from'] });

export type AggregateOverTimeParams = z.infer<typeof aggregateOverTimeParamsSchema>;

/**
 * `filtered_aggregate`: count/sum with equality/range filters + optional group-by, optionally
 * reaching a second table ONLY via an exposed relationship (by its name). Filter VALUES are
 * bound params; the column is resolved against the allow-list.
 */
export const filteredAggregateParamsSchema = z
  .object({
    table: identifierParam,
    metric: z
      .object({ agg: z.enum(AGGREGATES), column: identifierParam })
      .strict(),
    filters: z
      .array(
        z.object({ column: identifierParam, op: z.enum(FILTER_OPS), value: z.string().max(256) }).strict(),
      )
      .max(10)
      .default([]),
    groupBy: identifierParam.optional(),
    // Reach a second table only by naming an exposed relationship; the JOIN is built solely
    // from that row's from_*/to_* (never an ad-hoc join). `groupBy` may then target `joinTable`.
    relationship: z.string().min(1).max(128).optional(),
    joinTable: identifierParam.optional(),
  })
  .strict();

export type FilteredAggregateParams = z.infer<typeof filteredAggregateParamsSchema>;
