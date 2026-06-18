import type {
  IntrospectedSchema,
  ExposureResponse,
  SaveExposureRequest,
  ConnectionErrorCategory,
} from '@lumen/shared';
import type { DbConnectionStore } from './db-connection.store';
import type { SchemaIntrospector } from './schema-introspector';
import type { ExposureStore, ExposureTableInput, ExposureRelationshipInput } from './exposure.store';
import { mapMysqlError } from './mysql-errors';

export type IntrospectResult =
  | { outcome: 'ok'; schema: IntrospectedSchema }
  | { outcome: 'no_connection' }
  | { outcome: 'not_active' }
  | { outcome: 'failed'; category: ConnectionErrorCategory };

export type GetExposureResult =
  | { outcome: 'ok'; exposure: ExposureResponse }
  | { outcome: 'no_connection' };

export type SaveExposureResult =
  | { outcome: 'saved'; exposure: ExposureResponse }
  | { outcome: 'no_connection' }
  | { outcome: 'not_active' }
  | { outcome: 'unknown_table'; name: string }
  | { outcome: 'unknown_relationship'; name: string }
  | { outcome: 'invariant_violation'; name: string }
  | { outcome: 'failed'; category: ConnectionErrorCategory };

export interface ExposureServiceDeps {
  connectionStore: DbConnectionStore;
  introspector: SchemaIntrospector;
  exposureStore: ExposureStore;
  /** spec 02 decrypt — recovers the read-only password to open the introspection connection. */
  decrypt(blob: Buffer): string;
}

export interface ExposureService {
  introspect(orgId: string): Promise<IntrospectResult>;
  getExposure(orgId: string): Promise<GetExposureResult>;
  saveExposure(orgId: string, request: SaveExposureRequest): Promise<SaveExposureResult>;
}

export function createExposureService(deps: ExposureServiceDeps): ExposureService {
  /** Resolve the org's single connection and run a live introspection (active-gated). */
  async function introspectConnection(
    orgId: string,
  ): Promise<
    | { ok: true; connId: string; schema: IntrospectedSchema }
    | { ok: false; result: Exclude<IntrospectResult, { outcome: 'ok' }> }
  > {
    const conn = await deps.connectionStore.getByOrg(orgId);
    if (!conn) return { ok: false, result: { outcome: 'no_connection' } };
    if (conn.status !== 'active') return { ok: false, result: { outcome: 'not_active' } };
    try {
      const schema = await deps.introspector.introspect({
        host: conn.host,
        port: conn.port,
        database: conn.databaseName,
        username: conn.username,
        password: deps.decrypt(conn.encryptedPassword),
        ssl: conn.sslEnabled,
      });
      return { ok: true, connId: conn.id, schema };
    } catch (error) {
      // Sanitized — the raw introspection error never surfaces.
      return { ok: false, result: { outcome: 'failed', category: mapMysqlError(error) } };
    }
  }

  return {
    async introspect(orgId): Promise<IntrospectResult> {
      const introspected = await introspectConnection(orgId);
      return introspected.ok ? { outcome: 'ok', schema: introspected.schema } : introspected.result;
    },

    async getExposure(orgId): Promise<GetExposureResult> {
      const conn = await deps.connectionStore.getByOrg(orgId);
      if (!conn) return { outcome: 'no_connection' };
      return { outcome: 'ok', exposure: await deps.exposureStore.getExposure(orgId, conn.id) };
    },

    async saveExposure(orgId, request): Promise<SaveExposureResult> {
      // Re-introspect live so the persisted rows are built from the REAL schema, not from
      // client input (the client only chose names). This also active-gates the save.
      const introspected = await introspectConnection(orgId);
      if (!introspected.ok) return introspected.result;
      const { connId, schema } = introspected;

      const tablesByName = new Map(schema.tables.map((t) => [t.name, t]));
      const relsByName = new Map(schema.relationships.map((r) => [r.name, r]));
      const chosenTables = new Set([...new Set(request.tableNames)]);

      // Validate + build the table rows from the introspection (columns are backend-derived).
      const exposureTables: ExposureTableInput[] = [];
      for (const name of chosenTables) {
        const table = tablesByName.get(name);
        if (!table) return { outcome: 'unknown_table', name };
        exposureTables.push({ name: table.name, columns: table.columns });
      }

      // Validate + build the relationship rows; enforce the same-connection invariant.
      const exposureRelationships: ExposureRelationshipInput[] = [];
      for (const name of new Set(request.relationshipNames)) {
        const rel = relsByName.get(name);
        if (!rel) return { outcome: 'unknown_relationship', name };
        if (!chosenTables.has(rel.fromTable) || !chosenTables.has(rel.toTable)) {
          // Both endpoints must be exposed — never widen the allow-list via a dangling join.
          return { outcome: 'invariant_violation', name };
        }
        exposureRelationships.push({
          name: rel.name,
          fromTable: rel.fromTable,
          fromColumn: rel.fromColumn,
          toTable: rel.toTable,
          toColumn: rel.toColumn,
        });
      }

      await deps.exposureStore.replaceExposure(orgId, connId, {
        tables: exposureTables,
        relationships: exposureRelationships,
      });
      return { outcome: 'saved', exposure: await deps.exposureStore.getExposure(orgId, connId) };
    },
  };
}
