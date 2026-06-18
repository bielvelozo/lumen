import type {
  DbConnectionConfig,
  DbConnectionState,
  ConnectionStatus,
  ConnectionErrorCategory,
} from '@lumen/shared';
import type { DbConnectionStore } from './db-connection.store';
import type { ConnectionTester } from './connection-tester';
import type { ConsentService } from './consent.service';

export type CreateOrUpdateResult =
  | { outcome: 'saved'; state: DbConnectionState }
  | { outcome: 'no_consent' }
  | { outcome: 'over_privileged' };

export type RetestResult =
  | { outcome: 'tested'; state: DbConnectionState }
  | { outcome: 'not_found' };

export interface DbConnectionServiceDeps {
  store: DbConnectionStore;
  tester: ConnectionTester;
  consentService: ConsentService;
  /** spec 02 AES-256-GCM. The plaintext password exists only transiently here. */
  encrypt(plaintext: string): Buffer;
  decrypt(blob: Buffer): string;
  now?: () => Date;
}

export interface DbConnectionService {
  createOrUpdate(orgId: string, config: DbConnectionConfig): Promise<CreateOrUpdateResult>;
  retest(orgId: string): Promise<RetestResult>;
  getState(orgId: string): Promise<DbConnectionState>;
}

function toState(
  status: ConnectionStatus,
  lastTestedAt: Date,
  lastError: ConnectionErrorCategory | null,
  config: DbConnectionState['config'],
): DbConnectionState {
  return { hasConnection: true, status, lastTestedAt: lastTestedAt.toISOString(), lastError, config };
}

export function createDbConnectionService(deps: DbConnectionServiceDeps): DbConnectionService {
  const now = deps.now ?? ((): Date => new Date());

  return {
    async createOrUpdate(orgId, config): Promise<CreateOrUpdateResult> {
      // Gate: a current-version consent must exist (and gives us the fields to copy).
      const consent = await deps.consentService.getCurrentConsentRecord(orgId);
      if (!consent) return { outcome: 'no_consent' };

      // Test FIRST, before persisting — so an over-privileged/root credential is REJECTED
      // and never written to `encrypted_password` (invariant 5).
      const result = await deps.tester.test({
        host: config.host,
        port: config.port,
        database: config.databaseName,
        username: config.username,
        password: config.password,
        ssl: config.sslEnabled,
      });
      if (result.outcome === 'over_privileged') {
        return { outcome: 'over_privileged' };
      }

      const status: ConnectionStatus = result.outcome === 'ok' ? 'active' : 'failed';
      const lastError = result.outcome === 'failed' ? result.category : null;
      const lastTestedAt = now();

      await deps.store.upsert({
        orgId,
        host: config.host,
        port: config.port,
        databaseName: config.databaseName,
        username: config.username,
        sslEnabled: config.sslEnabled,
        encryptedPassword: deps.encrypt(config.password),
        status,
        lastTestedAt,
        lastError,
        consentVersion: consent.version,
        consentAcceptedAt: consent.acceptedAt,
        consentAcceptedBy: consent.acceptedBy,
      });

      return {
        outcome: 'saved',
        state: toState(status, lastTestedAt, lastError, {
          host: config.host,
          port: config.port,
          databaseName: config.databaseName,
          username: config.username,
          sslEnabled: config.sslEnabled,
        }),
      };
    },

    async retest(orgId): Promise<RetestResult> {
      const row = await deps.store.getByOrg(orgId);
      if (!row) return { outcome: 'not_found' };

      const result = await deps.tester.test({
        host: row.host,
        port: row.port,
        database: row.databaseName,
        username: row.username,
        password: deps.decrypt(row.encryptedPassword),
        ssl: row.sslEnabled,
      });

      let status: ConnectionStatus;
      let lastError: ConnectionErrorCategory | null;
      if (result.outcome === 'ok') {
        status = 'active';
        lastError = null;
      } else if (result.outcome === 'over_privileged') {
        // The stored credential was read-only at create time; if grants changed, fail it.
        status = 'failed';
        lastError = 'access_denied';
      } else {
        status = 'failed';
        lastError = result.category;
      }
      const lastTestedAt = now();
      await deps.store.updateStatus(orgId, { status, lastTestedAt, lastError });
      return {
        outcome: 'tested',
        state: toState(status, lastTestedAt, lastError, {
          host: row.host,
          port: row.port,
          databaseName: row.databaseName,
          username: row.username,
          sslEnabled: row.sslEnabled,
        }),
      };
    },

    async getState(orgId): Promise<DbConnectionState> {
      const state = await deps.store.getState(orgId);
      if (!state) {
        return { hasConnection: false, status: null, lastTestedAt: null, lastError: null, config: null };
      }
      return {
        hasConnection: true,
        status: state.status,
        lastTestedAt: state.lastTestedAt ? state.lastTestedAt.toISOString() : null,
        lastError: (state.lastError as ConnectionErrorCategory | null) ?? null,
        // Non-secret config for the dashboard — the password is never included.
        config: {
          host: state.host,
          port: state.port,
          databaseName: state.databaseName,
          username: state.username,
          sslEnabled: state.sslEnabled,
        },
      };
    },
  };
}
