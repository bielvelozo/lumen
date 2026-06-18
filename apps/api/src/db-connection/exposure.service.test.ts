import { describe, it, expect, vi } from 'vitest';
import type { IntrospectedSchema } from '@lumen/shared';
import { createExposureService, type ExposureServiceDeps } from './exposure.service';
import type { StoredConnection } from './db-connection.store';
import type { IntrospectInput } from './schema-introspector';
import type { ExposureInput } from './exposure.store';

const CONN: StoredConnection = {
  id: 'conn-1',
  host: 'h',
  port: 3306,
  databaseName: 'shop',
  username: 'lumen_ro',
  sslEnabled: false,
  encryptedPassword: Buffer.from('enc'),
  status: 'active',
};

const SCHEMA: IntrospectedSchema = {
  tables: [
    { name: 'products', columns: [{ name: 'id', type: 'int' }] },
    { name: 'orders', columns: [{ name: 'id', type: 'int' }, { name: 'product_id', type: 'int' }] },
  ],
  relationships: [
    { name: 'orders__product_id__products', fromTable: 'orders', fromColumn: 'product_id', toTable: 'products', toColumn: 'id' },
  ],
};

function build(opts: { connection?: StoredConnection | null; introspectThrows?: boolean } = {}) {
  const getByOrg = vi.fn(async (_o: string): Promise<StoredConnection | null> =>
    opts.connection === undefined ? CONN : opts.connection,
  );
  const connectionStore = { upsert: vi.fn(), getByOrg, updateStatus: vi.fn(), getState: vi.fn() };

  const introspect = vi.fn(async (_i: IntrospectInput): Promise<IntrospectedSchema> => {
    if (opts.introspectThrows) throw { code: 'ECONNREFUSED' };
    return SCHEMA;
  });

  const replaceExposure = vi.fn(async (_o: string, _c: string, _e: ExposureInput) => {});
  const getExposure = vi.fn(async () => ({ tables: [], relationships: [] }));
  const exposureStore = { getExposure, replaceExposure };

  const deps: ExposureServiceDeps = {
    connectionStore,
    introspector: { introspect },
    exposureStore,
    decrypt: (b: Buffer) => b.toString('utf8'),
  };
  return { service: createExposureService(deps), getByOrg, introspect, replaceExposure };
}

describe('exposureService.introspect', () => {
  it('returns the schema for an active connection', async () => {
    const res = await build().service.introspect('org-1');
    expect(res).toEqual({ outcome: 'ok', schema: SCHEMA });
  });
  it('rejects no connection / a non-active connection without introspecting', async () => {
    expect((await build({ connection: null }).service.introspect('o')).outcome).toBe('no_connection');
    const t = build({ connection: { ...CONN, status: 'failed' } });
    expect((await t.service.introspect('o')).outcome).toBe('not_active');
    expect(t.introspect).not.toHaveBeenCalled();
  });
  it('maps an introspection failure to a sanitized category', async () => {
    expect(await build({ introspectThrows: true }).service.introspect('o')).toEqual({
      outcome: 'failed',
      category: 'connection_refused',
    });
  });
});

describe('exposureService.saveExposure', () => {
  it('persists rows built from the introspection (columns/FK backend-derived), org-scoped', async () => {
    const t = build();
    const res = await t.service.saveExposure('org-1', {
      tableNames: ['products', 'orders'],
      relationshipNames: ['orders__product_id__products'],
    });
    expect(res.outcome).toBe('saved');
    expect(t.getByOrg).toHaveBeenCalledWith('org-1');
    const [orgArg, connArg, exposure] = t.replaceExposure.mock.calls[0] as [string, string, ExposureInput];
    expect(orgArg).toBe('org-1');
    expect(connArg).toBe('conn-1');
    // columns came from the introspection, not the request (which only had names).
    expect(exposure.tables.find((x) => x.name === 'orders')?.columns).toEqual([
      { name: 'id', type: 'int' },
      { name: 'product_id', type: 'int' },
    ]);
    expect(exposure.relationships[0]?.fromColumn).toBe('product_id');
  });

  it('rejects an unknown table and writes nothing', async () => {
    const t = build();
    const res = await t.service.saveExposure('o', { tableNames: ['nope'], relationshipNames: [] });
    expect(res).toEqual({ outcome: 'unknown_table', name: 'nope' });
    expect(t.replaceExposure).not.toHaveBeenCalled();
  });

  it('rejects an unknown relationship and writes nothing', async () => {
    const t = build();
    const res = await t.service.saveExposure('o', {
      tableNames: ['products', 'orders'],
      relationshipNames: ['fake__rel'],
    });
    expect(res).toEqual({ outcome: 'unknown_relationship', name: 'fake__rel' });
    expect(t.replaceExposure).not.toHaveBeenCalled();
  });

  it('enforces the same-connection invariant: a relationship needs BOTH tables exposed', async () => {
    const t = build();
    // Choose only `orders`; the relationship needs `products` too.
    const res = await t.service.saveExposure('o', {
      tableNames: ['orders'],
      relationshipNames: ['orders__product_id__products'],
    });
    expect(res).toEqual({ outcome: 'invariant_violation', name: 'orders__product_id__products' });
    expect(t.replaceExposure).not.toHaveBeenCalled();
  });

  it('active-gates the save (no introspection / write when not active)', async () => {
    const t = build({ connection: { ...CONN, status: 'pending' } });
    const res = await t.service.saveExposure('o', { tableNames: [], relationshipNames: [] });
    expect(res.outcome).toBe('not_active');
    expect(t.introspect).not.toHaveBeenCalled();
    expect(t.replaceExposure).not.toHaveBeenCalled();
  });
});
