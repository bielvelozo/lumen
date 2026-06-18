---
status: in-progress
feature: db-connection-consent-and-script
created: 2026-06-18
---
# DB Connection — Consent & Onboarding Script — Tasks

A box is checked ONLY after its slice is implemented AND committed.

## 1 — Schema: db_connection_consents + migration
- [x] `schema.ts`: add `dbConnectionConsents` (uuid id; org_id FK cascade; consent_version;
      accepted_at default now; accepted_by FK users cascade; created_at; unique(org_id,
      consent_version); idx on org_id).
- [x] `pnpm db:generate` → `drizzle/0001_*.sql`; verify the SQL (CREATE TABLE + FK + unique + idx).
- [x] Update `schema.test.ts` live smoke to expect **12** tables incl. `db_connection_consents`.

## 2 — Shared consent + script contracts
- [x] `consent-contracts.ts`: `CURRENT_CONSENT_VERSION`, `CONSENT_TERMS` (4 scope points),
      `acceptConsentRequestSchema` (`{ consentVersion }`, strict), `consentStatusResponseSchema`,
      `onboardingScriptRequestSchema` (`{ username?, databaseName?, requireSsl? }`, strict,
      identifier regex), `onboardingScriptResponseSchema`; export. Contract tests.

## 3 — Onboarding-script generator
- [x] `onboarding-script.ts`: `buildOnboardingScript(opts)` → MySQL CREATE USER + GRANT
      SELECT (+ optional db scope `\`db\`.*`) + FLUSH PRIVILEGES; `@'%'` host + restrict
      comment; commented REQUIRE SSL. Read-only by construction.
- [x] `onboarding-script.test.ts`: allow-list present; deny-list absent (no ALL PRIVILEGES/
      GRANT OPTION/INSERT/UPDATE/DELETE/ALTER/DROP/SUPER/DDL CREATE/root); db scope vs
      commented placeholder.

## 4 — Consent store + service + routes + wiring
- [x] `consent.store.ts`: `recordConsent(orgId, userId, version)` (upsert org+version),
      `getConsent(orgId)` → latest accepted version | null.
- [x] `consent.service.ts`: `acceptConsent` (reject stale version), `getStatus`,
      `hasCurrentConsent`.
- [x] `consent.route.ts`: POST/GET `/db-connection/consent`, POST
      `/db-connection/onboarding-script` — all `requireAuth`; org/user from `getAuth` only.
- [x] `app.ts`: register `@fastify/cookie` once (auth || dbConnection); add `dbConnection`
      deps; `server.ts`: wire consent service + accessTokenService.
- [x] tests: service (accept records current; stale→409; status/gating) + route (inject:
      requireAuth 401; body org_id ignored — org from JWT; script endpoint shape).

## 5 — Live integration + gates + ship
- [x] `consent.store.integration.test.ts` (skipIf no `DATABASE_URL`): throwaway DB + migrate;
      record consent, status, current-version gating, idempotent re-accept. Run green vs
      Docker Postgres; record `LIVE-VERIFICATION-PENDING`.
- [x] Full suite green: `pnpm build && lint && type-check && test`.
- [x] Record open-question defaults in `DECISIONS.md` (Option B → implemented); mark spec
      Shipped (MOC + frontmatter) atomically; capture learnings.
