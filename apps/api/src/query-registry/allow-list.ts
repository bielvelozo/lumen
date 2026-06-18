import { and, eq } from 'drizzle-orm';
import type { ConnectionStatus, ExposedColumn } from '@lumen/shared';
import { dbConnections, exposedTables, exposedRelationships } from '../db/schema';
import type { Database } from '../db/client';

/** A relationship the owner approved — the ONLY shape a JOIN may be built from. */
export interface AllowListRelationship {
  name: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

/** The owner-approved data surface for one connection: table -> (column -> sql type), + relationships. */
export interface ExposedAllowList {
  tables: Map<string, Map<string, string>>;
  relationships: AllowListRelationship[];
}

/** The connection handle the runner needs (incl. the encrypted secret — never serialized). */
export interface ResolvedConnection {
  connectionId: string;
  status: ConnectionStatus;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  sslEnabled: boolean;
  encryptedPassword: Buffer;
}

export interface OrgDataAccess {
  connection: ResolvedConnection;
  allowList: ExposedAllowList;
}

/**
 * Resolves an org's data-access surface BY `org_id` (from the JWT) only. `null` when the org
 * has no connection row at all. The returned connection carries `status` so the executor can
 * refuse a non-`active` connection; the allow-list is the exposed tables/relationships for THAT
 * connection — so a table/relationship from another org can never be in scope (anti-IDOR).
 */
export interface AllowListAccessor {
  getByOrg(orgId: string): Promise<OrgDataAccess | null>;
}

export function makeDrizzleAllowListAccessor(db: Database): AllowListAccessor {
  return {
    async getByOrg(orgId: string): Promise<OrgDataAccess | null> {
      const connRows = await db
        .select({
          id: dbConnections.id,
          status: dbConnections.status,
          host: dbConnections.host,
          port: dbConnections.port,
          databaseName: dbConnections.databaseName,
          username: dbConnections.username,
          sslEnabled: dbConnections.sslEnabled,
          encryptedPassword: dbConnections.encryptedPassword,
        })
        .from(dbConnections)
        .where(eq(dbConnections.orgId, orgId))
        .limit(1);
      const conn = connRows[0];
      if (!conn) return null;

      // Exposure rows are scoped by BOTH org and connection id — double-keyed isolation.
      const tableRows = await db
        .select({ name: exposedTables.tableName, columns: exposedTables.columns })
        .from(exposedTables)
        .where(and(eq(exposedTables.orgId, orgId), eq(exposedTables.dbConnectionId, conn.id)));

      const relRows = await db
        .select({
          name: exposedRelationships.relationshipName,
          fromTable: exposedRelationships.fromTable,
          fromColumn: exposedRelationships.fromColumn,
          toTable: exposedRelationships.toTable,
          toColumn: exposedRelationships.toColumn,
        })
        .from(exposedRelationships)
        .where(
          and(eq(exposedRelationships.orgId, orgId), eq(exposedRelationships.dbConnectionId, conn.id)),
        );

      const tables = new Map<string, Map<string, string>>();
      for (const t of tableRows) {
        const cols = new Map<string, string>();
        for (const c of t.columns as ExposedColumn[]) cols.set(c.name, c.type);
        tables.set(t.name, cols);
      }

      return {
        connection: {
          connectionId: conn.id,
          status: conn.status,
          host: conn.host,
          port: conn.port,
          databaseName: conn.databaseName,
          username: conn.username,
          sslEnabled: conn.sslEnabled,
          encryptedPassword: conn.encryptedPassword,
        },
        allowList: { tables, relationships: relRows },
      };
    },
  };
}
