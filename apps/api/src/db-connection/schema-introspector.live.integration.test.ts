import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConnection, type Connection } from 'mysql2/promise';
import { createMysqlSchemaIntrospector } from './schema-introspector';

// ---------------------------------------------------------------------------
// Live MySQL introspection — env-gated on MYSQL_URL. Skips when absent. MANDATORY live-DB
// test for spec 09 (RALPH 7(2): 01/08/09/13). As root, provision a test DB (single +
// composite FKs + a secret data row) and a SELECT-only user, then run the REAL read-only
// introspector AS the read-only user and assert: tables/columns/single-FK shape, composite
// FK skipped, and NO customer data-row is read. Cleans up after.
// ---------------------------------------------------------------------------
const TEST_DB = 'lumen_introspect_test';
const RO_USER = 'lumen_introspect_ro';
const RO_PASS = 'ro_pw_strong';
const SECRET_ROW = 'SECRET_DATA_XYZ_should_never_be_read';

function rootConfig(): { host: string; port: number; user: string; password: string } {
  const url = new URL(process.env.MYSQL_URL ?? '');
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

describe.skipIf(!process.env.MYSQL_URL)('live: MySQL schema introspection', () => {
  const introspector = createMysqlSchemaIntrospector();
  let root: ReturnType<typeof rootConfig>;
  let admin: Connection | undefined;

  beforeAll(async () => {
    root = rootConfig();
    admin = await createConnection({ ...root, connectTimeout: 8000, multipleStatements: true });
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await admin.query(`CREATE DATABASE \`${TEST_DB}\``);
    await admin.query(`USE \`${TEST_DB}\``);
    await admin.query('CREATE TABLE products (id INT PRIMARY KEY, name VARCHAR(255))');
    await admin.query(
      'CREATE TABLE orders (id INT PRIMARY KEY, product_id INT, FOREIGN KEY (product_id) REFERENCES products(id))',
    );
    // Composite (two-column) FK — must be SKIPPED by the introspector.
    await admin.query('CREATE TABLE warehouses (id INT, region INT, PRIMARY KEY (id, region))');
    await admin.query(
      'CREATE TABLE stock (id INT PRIMARY KEY, wh_id INT, wh_region INT, FOREIGN KEY (wh_id, wh_region) REFERENCES warehouses(id, region))',
    );
    // A real data row — introspection must never read it.
    await admin.query('INSERT INTO products (id, name) VALUES (1, ?)', [SECRET_ROW]);

    await admin.query(`DROP USER IF EXISTS '${RO_USER}'@'%'`);
    await admin.query(`CREATE USER '${RO_USER}'@'%' IDENTIFIED WITH mysql_native_password BY '${RO_PASS}'`);
    await admin.query(`GRANT SELECT ON \`${TEST_DB}\`.* TO '${RO_USER}'@'%'`);
    await admin.query('FLUSH PRIVILEGES');
  }, 30_000);

  afterAll(async () => {
    if (admin) {
      await admin.query(`DROP USER IF EXISTS '${RO_USER}'@'%'`);
      await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
      await admin.end();
    }
  });

  it('discovers tables + columns + single-column FKs, skipping composite FKs', async () => {
    const schema = await introspector.introspect({
      host: root.host,
      port: root.port,
      database: TEST_DB,
      username: RO_USER,
      password: RO_PASS,
      ssl: false,
    });

    const tableNames = schema.tables.map((t) => t.name).sort();
    expect(tableNames).toEqual(['orders', 'products', 'stock', 'warehouses']);

    const products = schema.tables.find((t) => t.name === 'products');
    expect(products?.columns).toEqual([
      { name: 'id', type: 'int' },
      { name: 'name', type: 'varchar(255)' },
    ]);

    // Single FK surfaced child→parent; the composite stock→warehouses FK is skipped.
    expect(schema.relationships).toEqual([
      { name: 'orders__product_id__products', fromTable: 'orders', fromColumn: 'product_id', toTable: 'products', toColumn: 'id' },
    ]);
  });

  it('reads NO customer data rows (only information_schema metadata)', async () => {
    const schema = await introspector.introspect({
      host: root.host,
      port: root.port,
      database: TEST_DB,
      username: RO_USER,
      password: RO_PASS,
      ssl: false,
    });
    expect(JSON.stringify(schema)).not.toContain(SECRET_ROW);
  });
});
