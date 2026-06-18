---
status: in-progress
feature: db-connection-create-and-test
created: 2026-06-18
---
# DB Connection — Create & Test — Tasks

A box is checked ONLY after its slice is implemented AND committed.

## 1 — uq_dbconn_org unique index + mysql2
- [x] `schema.ts`: add `unique('uq_dbconn_org').on(db_connections.org_id)`; `pnpm db:generate`
      → `drizzle/0002_*.sql`; verify SQL. Update the "single-connection unique indexes" test
      (db_connections now 1 unique) + verify migrate smoke green.
- [x] Add `mysql2` to `apps/api`; install.

## 2 — Shared connection contracts
- [x] `connection-contracts.ts`: `dbConnectionConfigSchema` (strict, no org_id),
      `ConnectionErrorCategory` union, `dbConnectionStateSchema`
      (`{ status, lastTestedAt, lastError, hasConnection }`); export. Contract tests.

## 3 — Pure helpers: error mapper + grants parser
- [x] `mysql-errors.ts`: `mapMysqlError(err)` → safe category (never echoes raw). Test all codes.
- [x] `grants.ts`: `analyzeGrants(grants[])` → `{ overPrivileged }` (write/admin/root/GRANT
      OPTION/ALL PRIVILEGES on the privilege portion). Test read-only vs root vs writer.

## 4 — Connection tester + stores
- [x] `connection-tester.ts`: `ConnectionTester` port + mysql2 live impl (connect+SELECT 1+
      SHOW GRANTS, bounded timeout, try/finally close) → ok | over_privileged | failed(category).
- [x] `consent.store.ts`/`consent.service.ts`: add `getConsentRecord(orgId)` (version +
      acceptedAt + acceptedBy) for copying the NOT NULL consent fields.
- [x] `db-connection.store.ts`: `upsert` (onConflict org_id), `getByOrg`, `updateStatus`, `getState`.

## 5 — Service + routes + wiring
- [x] `db-connection.service.ts`: `createOrUpdate` (consent gate → test → over-priv REJECT
      (no store) → encrypt+persist active/failed), `retest`, `getState`.
- [x] `db-connection.route.ts`: `PUT /db-connection`, `POST /db-connection/test`,
      `GET /db-connection` (requireAuth; org/user from getAuth; 403 no-consent; 422 over-priv).
- [x] `app.ts`/`server.ts`: extend `dbConnection` deps with `dbConnectionService`; build the
      mysql2 tester + crypto encrypt/decrypt (`createCryptoModule(env)`) + store.
- [x] tests: service (fakes) — happy active; failed+sanitized; over-priv→reject(no store);
      consent gate; anti-IDOR (org from JWT); re-test without password. Route (inject): 401/
      403/422/200; password never echoed; body org_id ignored.

## 6 — Live MySQL integration + security + ship
- [x] `db-connection.live.integration.test.ts` (skipIf no `MYSQL_URL`): as root create a test
      DB + read-only user; assert read-only→active, root→over_privileged(reject), wrong-pw→
      auth_failed, bad-db→database_not_found; re-test path. Cleanup. Run green vs Docker MySQL;
      `LIVE-VERIFICATION-PENDING`.
- [x] Full suite green: `pnpm build && lint && type-check && test`.
- [x] GATE 1: `/security-review` on the diff; resolve findings. GUARD: password only in
      `encrypted_password`; raw error never stored; anti-IDOR; over-priv rejected.
- [x] Record open-question defaults in `DECISIONS.md`; mark spec Shipped (MOC + frontmatter)
      atomically; capture learnings.
