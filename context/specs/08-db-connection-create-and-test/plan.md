---
status: in-progress
feature: db-connection-create-and-test
created: 2026-06-18
---
# DB Connection — Create & Test — Implementation Plan

Implements `[[spec]]` (backend; UI is spec 10). An authenticated endpoint that upserts the
org's single `db_connections` row, **encrypts the password** (spec 02) into
`encrypted_password`, runs a **live read-only MySQL test** (mysql2), and drives
`pending → active | failed` with a SANITIZED `last_error`. Gate-1 security-flagged AND a
mandatory live-DB spec (live MySQL connect must run green). Three invariants converge:
1 (org from JWT), 2 (password encrypted at rest), 5 (read-only, never-root).

## Authoritative decisions (override the spec's softer leans)

- **Over-privileged / root → DETECT-AND-REJECT** (NOT warn-and-proceed). Per the DECISIONS
  seed + constitution invariant 5: a credential that is root or holds write/DDL/admin/
  `GRANT OPTION`/`SUPER` privileges is REFUSED — its password is NEVER encrypted/stored;
  the endpoint returns `422` and points at the onboarding script. We connect once to run
  `SHOW GRANTS` (the prescribed detection), then drop it. An existing good row is never
  overwritten by a rejected credential.
- **uq_dbconn_org unique index** is enabled here (migration 0002) so create-or-update is an
  atomic upsert keyed by `org_id` (the constraint is the race backstop). This RESOLVES the
  earlier 01 decision (index absent) — spec 08 needs it.

## Architecture

```
apps/api/src/db/schema.ts        # + unique('uq_dbconn_org').on(db_connections.org_id)
apps/api/drizzle/0002_*.sql      # migration for the unique index
                                 # schema.test.ts: db_connections now has 1 unique constraint

packages/shared/src/connection-contracts.ts
  # dbConnectionConfigSchema (host/port 1..65535/databaseName/username/password/sslEnabled,
  #   strict, no org_id), ConnectionErrorCategory union, dbConnectionStateSchema
  #   ({ status, lastTestedAt, lastError, hasConnection }), createConnectionResult shapes

apps/api/src/db-connection/
  mysql-errors.ts                # mapMysqlError(err) -> safe category (pure; never echoes raw)
  grants.ts                      # analyzeGrants(grants[]) -> { overPrivileged } (pure)
  connection-tester.ts          # ConnectionTester port; mysql2 live impl (connect+SELECT 1+
                                 #   SHOW GRANTS, bounded timeout, try/finally close); fake for units
  db-connection.store.ts        # upsert by org_id, getByOrg, updateStatus, getState
  consent.store.ts / .service.ts # + getConsentRecord(orgId) (version+acceptedAt+acceptedBy)
                                 #   to copy the NOT NULL consent fields into db_connections
  db-connection.service.ts      # createOrUpdate (consent gate -> test -> reject-or-encrypt+persist),
                                 #   retest (decrypt -> test -> update state), getState
  db-connection.route.ts        # PUT /db-connection, POST /db-connection/test, GET /db-connection
apps/api/src/app.ts / server.ts  # wire dbConnectionService + crypto encrypt/decrypt + tester
```

New dep (apps/api): **mysql2**.

## Flow (createOrUpdate)

1. `org_id`/`user_id` from `getAuth` (JWT). Validate body (Zod). 401 unauth / 400 invalid.
2. Gate on consent (`consentService.hasCurrentConsent`) → 403 if missing/stale.
3. **Test first** (in-memory plaintext password): connect (≤5s) + `SELECT 1` + `SHOW GRANTS`.
4. `over_privileged` → **422, store nothing** (reject; surface onboarding script).
5. else encrypt(password) and upsert: `active` (read-only ok) or `failed` (+ sanitized
   category), `last_tested_at=now`, copy consent fields. Return public state (never secrets).

Re-test: decrypt stored password, re-run, update the state triple (no password re-entry).

## Key decisions (recorded in DECISIONS.md)

- **Error sanitization (hard):** raw driver/server errors map to a CLOSED set
  (`auth_failed|host_unreachable|connection_refused|timeout|ssl_error|database_not_found|
  access_denied|unknown`) before touching `last_error`/response/logs. Raw text never stored.
- **Routes:** `PUT /db-connection` (create-or-update+test), `POST /db-connection/test`
  (re-test), `GET /db-connection` (state). Synchronous create+test. Default lean.
- **Timeout:** ~5s connect + query; no auto-retry (owner re-tests). Default lean.
- **TLS:** when `ssl_enabled`, attempt TLS with `rejectUnauthorized:true` (verify); NEVER
  downgrade to plaintext; a CA-bundle/strictness knob is deferred to spec 16.
  `[CONFIRM-WITH-HUMAN]`. Live happy-path test uses `ssl_enabled=false` (local Docker).
- **No secret in logs:** plaintext/encrypted password, master key, connection string never
  reach logs/response/error (extends spec 02's rule to the network layer).

## Guard / review (Gate 1)

`/security-review` on the diff, findings resolved before Shipped. Mechanically re-confirm:
org from JWT only (anti-IDOR cross-tenant test); password only in `encrypted_password`
(never another column/log/response — guard test); raw MySQL error never stored/returned;
over-privileged/root REJECTED not stored.

## Verification

Unit: error mapper + grants parser (pure) + service with a fake tester (over-priv reject,
anti-IDOR, consent gate). Live integration (Docker MySQL, env-gated on `MYSQL_URL`): create a
read-only user + a test DB as root, then assert read-only→active, root→reject(422 path),
wrong-password→auth_failed, re-test path. Run green once; `LIVE-VERIFICATION-PENDING`.
`pnpm build && lint && type-check && test` green.
