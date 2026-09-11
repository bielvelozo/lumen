import type {
  AiConnectState,
  AiConnectResult,
  AiConnectErrorCategory,
  ClaudeModelId,
  ConnectAiRequest,
} from '@lumen/shared';
import type { AiConnectionStore, AiConnectionStateRow } from './ai-connection.store';
import type { ClaudeValidator } from './claude-validator';

/**
 * Result the route maps to HTTP. `connected` / `validation_failed` are both 200 (a failed key
 * is a normal, well-formed outcome — the category lives in the body); `no_connection` is 404
 * (re-validate requested but no stored key for this org).
 */
export type ConnectResult =
  | { outcome: 'connected'; result: AiConnectResult }
  | { outcome: 'validation_failed'; result: AiConnectResult }
  | { outcome: 'no_connection' };

export interface AiConnectionServiceDeps {
  store: AiConnectionStore;
  validator: ClaudeValidator;
  /** spec 02 AES-256-GCM. The plaintext key exists only transiently here, never logged/stored raw. */
  encrypt(plaintext: string): Buffer;
  decrypt(blob: Buffer): string;
  now?: () => Date;
  /** When set, the org never pastes a key: state is a fixed "active" and connect is a no-op. */
  subscription?: { defaultModel: ClaudeModelId };
}

export interface AiConnectionService {
  /** Validate-then-persist. `apiKey` present = paste/re-key; absent = re-validate stored key. */
  connect(orgId: string, request: ConnectAiRequest): Promise<ConnectResult>;
  getState(orgId: string): Promise<AiConnectState>;
}

// rate_limited / network are TRANSIENT — a blip must not disconnect a working assistant
// (open-question default #4). Everything else is treated as a permanent validation failure.
const TRANSIENT: ReadonlySet<AiConnectErrorCategory> = new Set(['rate_limited', 'network']);

function rowToState(row: AiConnectionStateRow | null): AiConnectState {
  if (!row) {
    return {
      provider: 'claude',
      hasKey: false,
      defaultModel: null,
      status: null,
      lastValidatedAt: null,
      lastError: null,
    };
  }
  return {
    provider: 'claude',
    hasKey: true,
    defaultModel: (row.defaultModel as ClaudeModelId | null) ?? null,
    status: row.status,
    lastValidatedAt: row.lastValidatedAt ? row.lastValidatedAt.toISOString() : null,
    lastError: (row.lastError as AiConnectErrorCategory | null) ?? null,
  };
}

export function createAiConnectionService(deps: AiConnectionServiceDeps): AiConnectionService {
  const now = deps.now ?? ((): Date => new Date());

  async function currentState(orgId: string): Promise<AiConnectState> {
    return rowToState(await deps.store.getState(orgId));
  }

  if (deps.subscription) {
    const state: AiConnectState = {
      provider: 'claude',
      hasKey: true,
      defaultModel: deps.subscription.defaultModel,
      status: 'active',
      lastValidatedAt: null,
      lastError: null,
      mode: 'subscription',
    };
    return {
      async connect(): Promise<ConnectResult> {
        return { outcome: 'connected', result: { state, error: null } };
      },
      async getState(): Promise<AiConnectState> {
        return state;
      },
    };
  }

  return {
    async connect(orgId, request): Promise<ConnectResult> {
      const existing = await deps.store.getByOrg(orgId);

      // Resolve the plaintext key to validate. A pasted key is encrypted up-front (used only on
      // success); a re-validate decrypts the stored key in-scope and drops it after the call.
      const isPaste = request.apiKey !== undefined;
      let plaintextKey: string;
      let encryptedKey: Buffer | null = null;
      if (isPaste) {
        plaintextKey = request.apiKey as string;
        encryptedKey = deps.encrypt(plaintextKey);
      } else {
        if (!existing) return { outcome: 'no_connection' };
        plaintextKey = deps.decrypt(existing.encryptedApiKey);
      }

      const validation = await deps.validator.validate(plaintextKey, request.model);

      if (validation.outcome === 'valid') {
        if (isPaste) {
          await deps.store.upsertActive({
            orgId,
            encryptedApiKey: encryptedKey as Buffer,
            model: request.model,
            lastValidatedAt: now(),
          });
        } else {
          // Re-validate success: keep the stored ciphertext, refresh status/model/time.
          await deps.store.markActive(orgId, { model: request.model, lastValidatedAt: now() });
        }
        return { outcome: 'connected', result: { state: await currentState(orgId), error: null } };
      }

      // Validation failed — sanitized category only; raw provider text was discarded by the port.
      const category = validation.category;

      if (isPaste) {
        // New/re-keyed key proved dead: NEVER store it. An existing row (a working assistant) is
        // left untouched so a typo can't disconnect it. Surface the category in the response.
        return {
          outcome: 'validation_failed',
          result: { state: await currentState(orgId), error: category },
        };
      }

      // Re-validating the stored key. Transient errors do NOT downgrade an active connection.
      if (!TRANSIENT.has(category)) {
        await deps.store.setFailed(orgId, category);
      }
      return {
        outcome: 'validation_failed',
        result: { state: await currentState(orgId), error: category },
      };
    },

    getState(orgId): Promise<AiConnectState> {
      return currentState(orgId);
    },
  };
}
