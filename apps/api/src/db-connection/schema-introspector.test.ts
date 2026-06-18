import { describe, it, expect } from 'vitest';
import { buildSchema, relationshipName } from './schema-introspector';

describe('relationshipName', () => {
  it('is deterministic and disambiguates by the child column', () => {
    expect(relationshipName('orders', 'product_id', 'products')).toBe('orders__product_id__products');
    // Two FKs between the same table pair get distinct names via the child column.
    expect(relationshipName('orders', 'shipping_id', 'addresses')).not.toBe(
      relationshipName('orders', 'billing_id', 'addresses'),
    );
  });
});

describe('buildSchema', () => {
  const tables = [{ name: 'orders' }, { name: 'products' }, { name: 'order_items' }];
  const columns = [
    { table: 'orders', name: 'id', type: 'int' },
    { table: 'orders', name: 'product_id', type: 'int' },
    { table: 'products', name: 'id', type: 'int' },
    { table: 'products', name: 'name', type: 'varchar(255)' },
  ];

  it('groups columns under their tables (snapshot of name+type)', () => {
    const schema = buildSchema(tables, columns, []);
    const orders = schema.tables.find((t) => t.name === 'orders');
    expect(orders?.columns).toEqual([
      { name: 'id', type: 'int' },
      { name: 'product_id', type: 'int' },
    ]);
    const empty = schema.tables.find((t) => t.name === 'order_items');
    expect(empty?.columns).toEqual([]);
  });

  it('turns a single-column FK into a child→parent relationship', () => {
    const schema = buildSchema(tables, columns, [
      {
        fromTable: 'orders',
        fromColumn: 'product_id',
        toTable: 'products',
        toColumn: 'id',
        constraintName: 'fk_orders_product',
      },
    ]);
    expect(schema.relationships).toEqual([
      {
        name: 'orders__product_id__products',
        fromTable: 'orders',
        fromColumn: 'product_id',
        toTable: 'products',
        toColumn: 'id',
      },
    ]);
  });

  it('SKIPS composite (multi-column) foreign keys (v1 unsupported)', () => {
    const schema = buildSchema(tables, columns, [
      // One constraint spanning two columns → composite → skipped.
      { fromTable: 'order_items', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id', constraintName: 'fk_oi_composite' },
      { fromTable: 'order_items', fromColumn: 'product_id', toTable: 'products', toColumn: 'id', constraintName: 'fk_oi_composite' },
      // A separate single-column FK survives.
      { fromTable: 'orders', fromColumn: 'product_id', toTable: 'products', toColumn: 'id', constraintName: 'fk_single' },
    ]);
    expect(schema.relationships.map((r) => r.name)).toEqual(['orders__product_id__products']);
  });
});
