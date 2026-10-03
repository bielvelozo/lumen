import { describe, it, expect } from 'vitest';
import {
  AGGREGATES,
  TIME_GRAINS,
  FILTER_OPS,
  aggregateOverTimeParamsSchema,
  filteredAggregateParamsSchema,
  sqlTypeFamily,
} from './query-registry-contracts';

describe('sqlTypeFamily', () => {
  it('classifies the MySQL COLUMN_TYPE strings the introspection stores', () => {
    expect(sqlTypeFamily('decimal(12,2)')).toBe('numeric');
    expect(sqlTypeFamily('int unsigned')).toBe('numeric');
    expect(sqlTypeFamily('datetime')).toBe('temporal');
    expect(sqlTypeFamily('timestamp(3)')).toBe('temporal');
    expect(sqlTypeFamily('varchar(20)')).toBeNull();
    expect(sqlTypeFamily('text')).toBeNull();
  });
});

describe('closed enums', () => {
  it('aggregates / grains / ops are the v1 closed sets', () => {
    expect(AGGREGATES).toEqual(['sum', 'count', 'avg']);
    expect(TIME_GRAINS).toEqual(['day', 'week', 'month']);
    expect(FILTER_OPS).toEqual(['eq', 'gte', 'lte']);
  });
});

describe('aggregateOverTimeParamsSchema', () => {
  const ok = {
    table: 'orders',
    metric: { agg: 'sum' as const, column: 'total' },
    dateColumn: 'created_at',
    grain: 'month' as const,
    from: '2026-01-01',
    to: '2026-05-31',
  };

  it('accepts a well-formed param object', () => {
    expect(aggregateOverTimeParamsSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects from > to', () => {
    expect(aggregateOverTimeParamsSchema.safeParse({ ...ok, from: '2026-06-01' }).success).toBe(false);
  });

  it('rejects an aggregate / grain outside the closed set', () => {
    expect(aggregateOverTimeParamsSchema.safeParse({ ...ok, grain: 'year' }).success).toBe(false);
    expect(
      aggregateOverTimeParamsSchema.safeParse({ ...ok, metric: { agg: 'median', column: 'total' } }).success,
    ).toBe(false);
  });

  it('rejects unknown keys (strict — no smuggled fields)', () => {
    expect(aggregateOverTimeParamsSchema.safeParse({ ...ok, rawSql: 'x' }).success).toBe(false);
  });

  it('keeps an injection string as a plain string param (the guard rejects it later, not Zod)', () => {
    const parsed = aggregateOverTimeParamsSchema.safeParse({
      ...ok,
      metric: { agg: 'sum', column: 'total; DROP TABLE orders' },
    });
    // 64-char bound trims absurd payloads, but a short injection still parses as a *string* —
    // membership against the allow-list (not Zod) is what makes it un-runnable.
    expect(parsed.success).toBe(true);
  });
});

describe('filteredAggregateParamsSchema', () => {
  it('defaults filters to [] and accepts eq/gte/lte', () => {
    const parsed = filteredAggregateParamsSchema.safeParse({
      table: 'orders',
      metric: { agg: 'count', column: 'id' },
    });
    expect(parsed.success && parsed.data.filters).toEqual([]);
    expect(
      filteredAggregateParamsSchema.safeParse({
        table: 'orders',
        metric: { agg: 'sum', column: 'total' },
        filters: [{ column: 'status', op: 'eq', value: 'paid' }],
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown filter op', () => {
    expect(
      filteredAggregateParamsSchema.safeParse({
        table: 'orders',
        metric: { agg: 'sum', column: 'total' },
        filters: [{ column: 'status', op: 'like', value: '%paid%' }],
      }).success,
    ).toBe(false);
  });
});
