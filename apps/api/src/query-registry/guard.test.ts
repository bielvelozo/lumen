import { describe, it, expect } from 'vitest';
import { guard, type NeedManifest } from './guard';
import type { ExposedAllowList } from './allow-list';
import { quoteIdent, UnsafeIdentifierError } from './identifiers';

const allowList: ExposedAllowList = {
  tables: new Map([
    [
      'orders',
      new Map([
        ['id', 'int'],
        ['total', 'decimal(10,2)'],
        ['status', 'varchar(20)'],
        ['created_at', 'datetime'],
      ]),
    ],
    ['order_items', new Map([['line_total', 'decimal(10,2)']])],
  ]),
  relationships: [
    {
      name: 'order_items__order_id__orders',
      fromTable: 'order_items',
      fromColumn: 'order_id',
      toTable: 'orders',
      toColumn: 'id',
    },
  ],
};

describe('guard — allow-list membership', () => {
  it('passes when every table/column/relationship is exposed', () => {
    const manifest: NeedManifest = {
      tables: ['orders'],
      columns: [
        { table: 'orders', column: 'total', family: 'numeric' },
        { table: 'orders', column: 'created_at', family: 'temporal' },
      ],
      relationships: [],
    };
    expect(guard(manifest, allowList)).toEqual({ ok: true });
  });

  it('refuses a table that is not exposed', () => {
    const r = guard({ tables: ['salaries'], columns: [], relationships: [] }, allowList);
    expect(r).toMatchObject({ ok: false, code: 'table_not_exposed' });
  });

  it('refuses a column that is not in the snapshot — incl. an injection string', () => {
    const r = guard(
      { tables: ['orders'], columns: [{ table: 'orders', column: 'total; DROP TABLE orders' }], relationships: [] },
      allowList,
    );
    expect(r).toMatchObject({ ok: false, code: 'column_not_exposed' });
  });

  it('refuses a numeric aggregate over a non-numeric column (type family)', () => {
    const r = guard(
      { tables: ['orders'], columns: [{ table: 'orders', column: 'status', family: 'numeric' }], relationships: [] },
      allowList,
    );
    expect(r).toMatchObject({ ok: false, code: 'type_mismatch' });
  });

  it('refuses a date bucket over a non-temporal column', () => {
    const r = guard(
      { tables: ['orders'], columns: [{ table: 'orders', column: 'total', family: 'temporal' }], relationships: [] },
      allowList,
    );
    expect(r).toMatchObject({ ok: false, code: 'type_mismatch' });
  });

  it('refuses a join not backed by an exposed relationship row (no ad-hoc JOIN)', () => {
    const r = guard(
      {
        tables: ['orders', 'order_items'],
        columns: [],
        relationships: [
          { name: 'fake', fromTable: 'order_items', fromColumn: 'order_id', toTable: 'orders', toColumn: 'total' },
        ],
      },
      allowList,
    );
    expect(r).toMatchObject({ ok: false, code: 'relationship_not_exposed' });
  });

  it('passes an exact-matching exposed relationship', () => {
    const r = guard(
      {
        tables: ['order_items', 'orders'],
        columns: [],
        relationships: [
          { name: 'order_items__order_id__orders', fromTable: 'order_items', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id' },
        ],
      },
      allowList,
    );
    expect(r).toEqual({ ok: true });
  });

  it('cross-tenant: another org\'s allow-list (empty here) exposes nothing', () => {
    const empty: ExposedAllowList = { tables: new Map(), relationships: [] };
    expect(guard({ tables: ['orders'], columns: [], relationships: [] }, empty)).toMatchObject({
      ok: false,
      code: 'table_not_exposed',
    });
  });
});

describe('quoteIdent', () => {
  it('backtick-quotes a safe identifier', () => {
    expect(quoteIdent('created_at')).toBe('`created_at`');
  });
  it('throws on anything outside the safe charset (defense in depth)', () => {
    expect(() => quoteIdent('total; DROP TABLE orders')).toThrow(UnsafeIdentifierError);
    expect(() => quoteIdent('a`b')).toThrow(UnsafeIdentifierError);
    expect(() => quoteIdent('')).toThrow(UnsafeIdentifierError);
  });
});
