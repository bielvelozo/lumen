import { eq } from 'drizzle-orm';
import type { ConnectionStatus, ConnectionErrorCategory } from '@lumen/shared';
import { dbConnections } from '../db/schema';
import type { Database } from '../db/client';

/** Row written on create-or-update. `encryptedPassword` is the spec-02 AES-256-GCM blob. */
export interface UpsertConnectionInput {
  orgId: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  sslEnabled: boolean;
  encryptedPassword: Buffer;
  status: ConnectionStatus;
  lastTestedAt: Date;
  lastError: ConnectionErrorCategory | null;
  // Consent fields copied from the consent record (NOT NULL on db_connections).
  consentVersion: string;
  consentAcceptedAt: Date;
  consentAcceptedBy: string;
}

/** The stored row fields the service needs to re-test / introspect (incl. the encrypted password). */
export interface StoredConnection {
  id: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  sslEnabled: boolean;
  encryptedPassword: Buffer;
  status: ConnectionStatus;
}

export interface DbConnectionStore {
  /** Atomic upsert keyed by `org_id` (uq_dbconn_org). Consent fields set on insert only. */
  upsert(input: UpsertConnectionInput): Promise<void>;
  getByOrg(orgId: string): Promise<StoredConnection | null>;
  updateStatus(
    orgId: string,
    state: { status: ConnectionStatus; lastTestedAt: Date; lastError: ConnectionErrorCategory | null },
  ): Promise<void>;
  /** Public state for `GET /db-connection` — never secrets. */
  getState(
    orgId: string,
  ): Promise<{ status: ConnectionStatus; lastTestedAt: Date | null; lastError: string | null } | null>;
}

export function makeDrizzleDbConnectionStore(db: Database): DbConnectionStore {
  return {
    async upsert(input: UpsertConnectionInput): Promise<void> {
      await db
        .insert(dbConnections)
        .values({
          orgId: input.orgId,
          engine: 'mysql',
          host: input.host,
          port: input.port,
          databaseName: input.databaseName,
          username: input.username,
          sslEnabled: input.sslEnabled,
          encryptedPassword: input.encryptedPassword,
          status: input.status,
          lastTestedAt: input.lastTestedAt,
          lastError: input.lastError,
          consentVersion: input.consentVersion,
          consentAcceptedAt: input.consentAcceptedAt,
          consentAcceptedBy: input.consentAcceptedBy,
        })
        .onConflictDoUpdate({
          target: dbConnections.orgId,
          // Update config + credential + state; keep the original consent fields.
          set: {
            host: input.host,
            port: input.port,
            databaseName: input.databaseName,
            username: input.username,
            sslEnabled: input.sslEnabled,
            encryptedPassword: input.encryptedPassword,
            status: input.status,
            lastTestedAt: input.lastTestedAt,
            lastError: input.lastError,
            updatedAt: new Date(),
          },
        });
    },

    async getByOrg(orgId: string): Promise<StoredConnection | null> {
      const rows = await db
        .select({
          id: dbConnections.id,
          host: dbConnections.host,
          port: dbConnections.port,
          databaseName: dbConnections.databaseName,
          username: dbConnections.username,
          sslEnabled: dbConnections.sslEnabled,
          encryptedPassword: dbConnections.encryptedPassword,
          status: dbConnections.status,
        })
        .from(dbConnections)
        .where(eq(dbConnections.orgId, orgId))
        .limit(1);
      return rows[0] ?? null;
    },

    async updateStatus(orgId, state): Promise<void> {
      await db
        .update(dbConnections)
        .set({
          status: state.status,
          lastTestedAt: state.lastTestedAt,
          lastError: state.lastError,
          updatedAt: new Date(),
        })
        .where(eq(dbConnections.orgId, orgId));
    },

    async getState(orgId) {
      const rows = await db
        .select({
          status: dbConnections.status,
          lastTestedAt: dbConnections.lastTestedAt,
          lastError: dbConnections.lastError,
        })
        .from(dbConnections)
        .where(eq(dbConnections.orgId, orgId))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
