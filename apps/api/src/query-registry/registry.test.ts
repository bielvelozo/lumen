import { describe, it, expect } from 'vitest';
import { getQueryFunction } from './registry';
import type { ExposedAllowList } from './allow-list';

const allowList: ExposedAllowList = {
  tables: new Map([
    ['orders', new Map([['id', 'int'], ['total', 'decimal(10,2)'], ['status', 'varchar(20)'], ['created_at', 'datetime']])],
    ['order_items', new Map([['order_id', 'int'], ['line_total', 'decimal(10,2)']])],
  ]),
  relationships: [
    { name: 'order_items__order_id__orders', fromTable: 'order_items', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id' },
  ],
};

function prepareOk(name: string, raw: unknown) {
  const def = getQueryFunction(name);
  expect(def).not.toBeNull();
  const result = def!.prepare(raw);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.prepared;
}

describe('registry lookup', () => {
  it('returns null for an unknown function name', () => {
    expect(getQueryFunction('drop_everything')).toBeNull();
    expect(getQueryFunction('aggregate_over_time')).not.toBeNull();
  });
});

describe('aggregate_over_time build', () => {
  it('emits a single SELECT with bound date bounds and allow-listed escaped identifiers', () => {
    const prepared = prepareOk('aggregate_over_time', {
      table: 'orders',
      metric: { agg: 'sum', column: 'total' },
      dateColumn: 'created_at',
      grain: 'month',
      from: '2026-01-01',
      to: '2026-05-31',
    });
    const { sql, params } = prepared.build(allowList);

    expect(sql.match(/select/gi)).toHaveLength(1); // single statement, no second SELECT
    expect(sql).not.toContain(';'); // no statement terminator / stacking
    expect(sql).toContain('SUM(`orders`.`total`)');
    expect(sql).toContain("DATE_FORMAT(`orders`.`created_at`, '%Y-%m')");
    expect(sql).toContain('`orders`.`created_at` >= ? AND `orders`.`created_at` <= ?');
    expect(sql).toMatch(/LIMIT \d+$/);
    // every VALUE is bound — the two date bounds, nothing inlined.
    expect(params).toEqual(['2026-01-01 00:00:00', '2026-05-31 23:59:59']);
  });

  it('count(col) does not require a numeric metric (manifest has no family on count)', () => {
    const prepared = prepareOk('aggregate_over_time', {
      table: 'orders',
      metric: { agg: 'count', column: 'status' },
      dateColumn: 'created_at',
      grain: 'day',
      from: '2026-01-01',
      to: '2026-01-31',
    });
    const statusNeed = prepared.manifest.columns.find((c) => c.column === 'status');
    expect(statusNeed?.family).toBeUndefined();
  });
});

describe('filtered_aggregate build', () => {
  it('binds every filter value and builds the JOIN ONLY from the exposed relationship row', () => {
    const prepared = prepareOk('filtered_aggregate', {
      table: 'order_items',
      metric: { agg: 'sum', column: 'line_total' },
      filters: [{ column: 'order_id', op: 'gte', value: '100' }],
      groupBy: 'status',
      relationship: 'order_items__order_id__orders',
      joinTable: 'orders',
    });
    // The manifest declares both tables + the relationship by name — the guard will check it.
    expect(prepared.manifest.tables).toEqual(['order_items', 'orders']);
    expect(prepared.manifest.relationships).toEqual([
      { name: 'order_items__order_id__orders', tableA: 'order_items', tableB: 'orders' },
    ]);

    const { sql, params } = prepared.build(allowList);
    // JOIN ON uses the relationship row's from_*/to_* — not any model-supplied column.
    expect(sql).toContain('JOIN `orders` ON `order_items`.`order_id` = `orders`.`id`');
    expect(sql).toContain('SUM(`order_items`.`line_total`)');
    expect(sql).toContain('`order_items`.`order_id` >= ?'); // filter bound
    expect(sql).toContain('GROUP BY `orders`.`status`'); // group-by targets the joined table
    expect(sql.match(/select/gi)).toHaveLength(1);
    expect(sql).not.toContain(';');
    expect(params).toEqual(['100']); // only the filter value is bound; nothing inlined
  });

  it('omits the JOIN entirely when no relationship is requested', () => {
    const prepared = prepareOk('filtered_aggregate', {
      table: 'orders',
      metric: { agg: 'count', column: 'id' },
      filters: [{ column: 'status', op: 'eq', value: 'paid' }],
    });
    const { sql, params } = prepared.build(allowList);
    expect(sql).not.toContain('JOIN');
    expect(sql).toContain('`orders`.`status` = ?');
    expect(params).toEqual(['paid']);
  });
});
