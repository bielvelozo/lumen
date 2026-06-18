---
status: in-progress
feature: db-connection-consent-and-script
created: 2026-06-18
---
# DB Connection — Consent & Onboarding Script — Implementation Plan

Implements `[[spec]]` (backend + contracts). Two gates before any credential exists:
(1) durable, versioned, org-scoped **consent**; (2) a server-generated **read-only MySQL
onboarding script** the customer runs themselves to mint a `SELECT`-only user. No secret,
no root credential, no live MySQL here (that is spec 08). The connect-DB UI is spec 10.

## Key decision — Option B (already recorded in DECISIONS.md)

Consent is its OWN lightweight record: a new `db_connection_consents` table
(`org_id`, `consent_version`, `accepted_at`, `accepted_by`). 07 writes it; 08 reads/gates
on it and copies the fields into the `db_connections` row on insert. This keeps 07
independently persistable+testable and keeps `encrypted_password NOT NULL` intact (Option
A — carry consent forward into 08's insert — would make 07's own "persist consent" success
criterion unsatisfiable, since no `db_connections` row can exist before 08 supplies the
encrypted password). NO placeholder secret is ever written (invariant 2).

## Architecture

```
apps/api/src/db/schema.ts        # + db_connection_consents (uuid id, org_id FK cascade,
                                 #   consent_version, accepted_at, accepted_by FK cascade,
                                 #   created_at; unique(org_id, consent_version), idx org)
apps/api/drizzle/0001_*.sql      # generated migration for the new table
                                 # schema.test.ts: live smoke now expects 12 tables

packages/shared/src/
  consent-contracts.ts           # CURRENT_CONSENT_VERSION, CONSENT_TERMS (4 scope points,
                                 #   pinned to the version), acceptConsent/consentStatus and
                                 #   onboardingScript request/response Zod (strict; identifier
                                 #   regex on username/databaseName)

apps/api/src/db-connection/
  onboarding-script.ts           # buildOnboardingScript({username, databaseName?, requireSsl})
                                 #   -> MySQL: CREATE USER + GRANT SELECT + FLUSH PRIVILEGES.
                                 #   Read-only BY CONSTRUCTION (no broader privilege emitted).
  consent.store.ts               # Drizzle: recordConsent (upsert on org+version),
                                 #   getConsent(orgId) -> latest accepted version | null
  consent.service.ts             # accept (reject stale version 409), status, gating helper
  consent.route.ts               # POST/GET /db-connection/consent, POST /db-connection/onboarding-script
                                 #   ALL requireAuth; org_id + user_id ONLY from getAuth (JWT)
apps/api/src/app.ts              # register cookie ONCE (auth || dbConnection); + dbConnection deps
apps/api/src/server.ts           # wire consent service + accessTokenService
```

## Key decisions (recorded in DECISIONS.md)

- **Terms text source:** a versioned constant in `packages/shared` (`CONSENT_TERMS` +
  `CURRENT_CONSENT_VERSION`), so the accepted version maps deterministically to exact text.
  Terms enumerate the 4 scope points: read-only; owner chooses exposed tables (nothing by
  default); secrets encrypted at rest (key outside the DB); revocable.
- **Version gating:** accept requires the client-sent `consentVersion` to equal
  `CURRENT_CONSENT_VERSION` (else `409` — terms changed, re-fetch). Gating ("can proceed to
  08") = a consent row for the org at the CURRENT version (scenario 5: stale → re-accept).
- **MySQL host scope:** `CREATE USER 'lumen_ro'@'%'` with a clear comment on how to restrict
  to the app's egress IP (not pinned until spec 16). Default lean.
- **REQUIRE SSL:** included as a commented, recommended option (schema defaults
  `ssl_enabled=true`). Default lean.
- **Identifier safety:** username + databaseName validated to `^[A-Za-z0-9_]+$` (≤64) before
  embedding in the script — no injection into the generated SQL even though the customer runs it.
- **anti-IDOR:** consent is written for `getAuth(request).orgId` / `.userId` only; the request
  body carries no org id and none is honored.

## Guard / review

Not a Gate-1 flagged spec; no glass RTL guard (that is 06/10/14 — the UI is spec 10). The
security-relevant surface is the script generator: a test asserts the allow-list (CREATE
USER / GRANT SELECT / FLUSH PRIVILEGES present) AND the deny-list (no ALL PRIVILEGES, GRANT
OPTION, INSERT/UPDATE/DELETE/ALTER/DROP/SUPER, no DDL CREATE TABLE/DATABASE, no root user).

## Verification

`pnpm build && lint && type-check && test` green. Consent store has an env-gated live
integration test (Docker up — run green once; `LIVE-VERIFICATION-PENDING`). The new
migration applies cleanly (the spec-01 live migrate smoke, now expecting 12 tables).
