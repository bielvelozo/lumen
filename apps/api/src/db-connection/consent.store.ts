import { desc, eq } from 'drizzle-orm';
import { dbConnectionConsents } from '../db/schema';
import type { Database } from '../db/client';

/**
 * Persistence port for DB-connection consent (spec 07). Consent is org-scoped and
 * versioned; the `unique(org_id, consent_version)` constraint makes re-accepting the same
 * version idempotent (refreshes `accepted_at`/`accepted_by`).
 */
export interface ConsentStore {
  /** Record (or refresh) the org's acceptance of a terms version. */
  recordConsent(orgId: string, userId: string, version: string): Promise<void>;
  /** The most-recently accepted terms version for the org, or `null` if none. */
  getAcceptedVersion(orgId: string): Promise<string | null>;
}

export function makeDrizzleConsentStore(db: Database): ConsentStore {
  return {
    async recordConsent(orgId: string, userId: string, version: string): Promise<void> {
      await db
        .insert(dbConnectionConsents)
        .values({ orgId, acceptedBy: userId, consentVersion: version })
        .onConflictDoUpdate({
          target: [dbConnectionConsents.orgId, dbConnectionConsents.consentVersion],
          set: { acceptedBy: userId, acceptedAt: new Date() },
        });
    },

    async getAcceptedVersion(orgId: string): Promise<string | null> {
      const rows = await db
        .select({ version: dbConnectionConsents.consentVersion })
        .from(dbConnectionConsents)
        .where(eq(dbConnectionConsents.orgId, orgId))
        .orderBy(desc(dbConnectionConsents.acceptedAt))
        .limit(1);
      return rows[0]?.version ?? null;
    },
  };
}
