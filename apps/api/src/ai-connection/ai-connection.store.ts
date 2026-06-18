import { eq } from 'drizzle-orm';
import type { ClaudeModelId, AiConnectErrorCategory, ConnectionStatus } from '@lumen/shared';
import { aiConnections } from '../db/schema';
import type { Database } from '../db/client';

/** The stored row the service needs to re-validate (incl. the encrypted key) + decide flow. */
export interface StoredAiConnection {
  id: string;
  encryptedApiKey: Buffer;
  defaultModel: string | null;
  status: ConnectionStatus;
}

/** Public state for `GET /ai-connection` — NEVER the key. */
export interface AiConnectionStateRow {
  defaultModel: string | null;
  status: ConnectionStatus;
  lastValidatedAt: Date | null;
  lastError: string | null;
}

export interface AiConnectionStore {
  /** Org-scoped read incl. the encrypted key — used to re-validate the stored key. */
  getByOrg(orgId: string): Promise<StoredAiConnection | null>;
  /** Non-secret state for the GET endpoint. */
  getState(orgId: string): Promise<AiConnectionStateRow | null>;
  /** Paste success: insert-or-overwrite the ciphertext, go active. Keyed by `uq_aiconn_org`. */
  upsertActive(input: {
    orgId: string;
    encryptedApiKey: Buffer;
    model: ClaudeModelId;
    lastValidatedAt: Date;
  }): Promise<void>;
  /** Re-validate success: go active WITHOUT touching the stored ciphertext. */
  markActive(orgId: string, input: { model: ClaudeModelId; lastValidatedAt: Date }): Promise<void>;
  /** Re-validate permanent failure: downgrade to failed, keep ciphertext + last_validated_at. */
  setFailed(orgId: string, lastError: AiConnectErrorCategory): Promise<void>;
}

export function makeDrizzleAiConnectionStore(db: Database): AiConnectionStore {
  return {
    async getByOrg(orgId) {
      const rows = await db
        .select({
          id: aiConnections.id,
          encryptedApiKey: aiConnections.encryptedApiKey,
          defaultModel: aiConnections.defaultModel,
          status: aiConnections.status,
        })
        .from(aiConnections)
        .where(eq(aiConnections.orgId, orgId))
        .limit(1);
      return rows[0] ?? null;
    },

    async getState(orgId) {
      const rows = await db
        .select({
          defaultModel: aiConnections.defaultModel,
          status: aiConnections.status,
          lastValidatedAt: aiConnections.lastValidatedAt,
          lastError: aiConnections.lastError,
        })
        .from(aiConnections)
        .where(eq(aiConnections.orgId, orgId))
        .limit(1);
      return rows[0] ?? null;
    },

    async upsertActive(input) {
      await db
        .insert(aiConnections)
        .values({
          orgId: input.orgId,
          provider: 'claude',
          encryptedApiKey: input.encryptedApiKey,
          defaultModel: input.model,
          status: 'active',
          lastValidatedAt: input.lastValidatedAt,
          lastError: null,
        })
        .onConflictDoUpdate({
          target: aiConnections.orgId,
          set: {
            encryptedApiKey: input.encryptedApiKey,
            defaultModel: input.model,
            status: 'active',
            lastValidatedAt: input.lastValidatedAt,
            lastError: null,
            updatedAt: new Date(),
          },
        });
    },

    async markActive(orgId, input) {
      await db
        .update(aiConnections)
        .set({
          defaultModel: input.model,
          status: 'active',
          lastValidatedAt: input.lastValidatedAt,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(aiConnections.orgId, orgId));
    },

    async setFailed(orgId, lastError) {
      await db
        .update(aiConnections)
        .set({ status: 'failed', lastError, updatedAt: new Date() })
        .where(eq(aiConnections.orgId, orgId));
    },
  };
}
