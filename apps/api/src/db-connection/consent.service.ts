import { CURRENT_CONSENT_VERSION, type ConsentStatusResponse } from '@lumen/shared';
import type { ConsentStore, ConsentRecord } from './consent.store';

export type AcceptConsentResult =
  | { ok: true }
  | { ok: false; reason: 'stale_version' };

export interface ConsentService {
  /** Record consent for `orgId`/`userId`. Rejects a non-current version (terms changed). */
  acceptConsent(orgId: string, userId: string, version: string): Promise<AcceptConsentResult>;
  /** Whether the org has accepted the CURRENT terms version. */
  getStatus(orgId: string): Promise<ConsentStatusResponse>;
  /** Gate used by spec 08: true iff a current-version consent exists for the org. */
  hasCurrentConsent(orgId: string): Promise<boolean>;
  /** The current-version consent record to copy into `db_connections`, or `null` if missing/stale. */
  getCurrentConsentRecord(orgId: string): Promise<ConsentRecord | null>;
}

export function createConsentService(store: ConsentStore): ConsentService {
  return {
    async acceptConsent(orgId, userId, version): Promise<AcceptConsentResult> {
      // The client must accept the version it was shown; a stale version means terms moved.
      if (version !== CURRENT_CONSENT_VERSION) {
        return { ok: false, reason: 'stale_version' };
      }
      await store.recordConsent(orgId, userId, version);
      return { ok: true };
    },

    async getStatus(orgId): Promise<ConsentStatusResponse> {
      const acceptedVersion = await store.getAcceptedVersion(orgId);
      return {
        currentVersion: CURRENT_CONSENT_VERSION,
        acceptedVersion,
        accepted: acceptedVersion === CURRENT_CONSENT_VERSION,
      };
    },

    async hasCurrentConsent(orgId): Promise<boolean> {
      return (await store.getAcceptedVersion(orgId)) === CURRENT_CONSENT_VERSION;
    },

    async getCurrentConsentRecord(orgId): Promise<ConsentRecord | null> {
      const record = await store.getConsentRecord(orgId);
      return record && record.version === CURRENT_CONSENT_VERSION ? record : null;
    },
  };
}
