# DECISIONS.md — Lumen v1 cross-iteration ledger

This file is the durable, cross-iteration record for the autonomous Lumen v1 build
(see `RALPH.md`). It tracks: every Open-Question default taken, every
`[CONFIRM-WITH-HUMAN]` item, every `LIVE-VERIFICATION-PENDING` item, and any
`BLOCKED` / `BUILD-HALTED` stops. ASCII markers only (no emoji/glyphs) so they stay
greppable on Windows. Each entry is keyed `NN-spec | <question>`; update in place,
never duplicate.

Markers: `[CONFIRM-WITH-HUMAN]` `LIVE-VERIFICATION-PENDING:` `BLOCKED:` `RESOLVED:` `BUILD-HALTED:`

---

## Active banners

_None. Build proceeding normally._

---

## Open-question defaults taken

### 00-scaffold | pinned versions of Node / Postgres / MySQL images
2026-06-17 — Node pinned to **22** (engines `>=22 <23`; `.nvmrc` = 22.16.0, the
installed LTS). pnpm pinned to **10.33.0** via `packageManager` + corepack. Docker
images pinned **postgres:16-alpine** and **mysql:8.0** (stable, current). Recorded
as the project version baseline; revisit only as a convention-level change.

### 01-app-db | minimum supported PostgreSQL version
2026-06-18 — Default taken: **PG >= 13** (so `gen_random_uuid()` is native; matches
the spec-00 local container `postgres:16-alpine` and the intended Neon/Supabase
target). The first migration also runs `CREATE EXTENSION IF NOT EXISTS pgcrypto`
defensively. Not security-sensitive; recorded without the human-confirm flag.

### 01-app-db | Postgres driver
2026-06-18 — Default taken: **node-postgres (`pg`)** with
`drizzle-orm/node-postgres`, over `postgres.js`. Ecosystem familiarity; either works
with Drizzle. Locked as a convention. Not security-sensitive.

### 01-app-db | migration apply mechanism
2026-06-18 — Default taken: a **small programmatic migrator** (`drizzle-orm`
`migrate()` invoked by `pnpm db:migrate` -> `tsx src/db/migrate.ts`) over
`drizzle-kit migrate`, so the spec-16 production deploy runs migrations the same
way. Not security-sensitive.

### 01-app-db | v1 single-connection/single-AI uniqueness indexes
2026-06-18 — Default taken at spec 01: **no** unique indexes (mirror `db/schema.sql`),
enforced in app logic by 08/11. UPDATED: spec 08 ENABLED `uq_dbconn_org` (migration
0002) — the atomic upsert keyed by `org_id` needs the DB constraint as the race backstop,
so the index is now live for `db_connections`. `uq_aiconn_org` stays absent until spec 11
needs it. Not security-sensitive (the constraint strengthens one-connection-per-org).

### 02-secrets | master-key source in production
2026-06-18 — Default taken: a **validated env var** (`SECRETS_ENCRYPTION_KEY`,
base64, decoded to EXACTLY 32 bytes by the shared Zod env schema — fail fast at
boot). The crypto module holds a **keyring** (`Map<key_id, Buffer>`, active id `0`)
so a managed secrets-manager backend can slot in at spec 16 without touching call
sites. Not security-weakening; recorded without the human-confirm flag (locked at
spec 16 per the open question).

### 02-secrets | argon2id parameters
2026-06-18 — Default taken: the **OWASP argon2id baseline** — memoryCost 19456 KiB
(19 MiB), timeCost 2, parallelism 1. To be tuned to the VPS at spec 16 (open
question deferred there). Recorded as the current convention; not security-weakening.

### 02-secrets | password-hash library (argon2 vs bcrypt)
2026-06-18 — Default taken: **`@node-rs/argon2`** (argon2id), chosen over the
node-gyp `argon2` package for cross-platform reliability — it ships prebuilt napi
binaries (no compiler/node-gyp), verified loading + hashing on this Windows host
(`$argon2id$` PHC confirmed). bcrypt fallback NOT needed. NOTE: the library's
`Algorithm` enum is an ambient `const enum` and cannot be referenced as a value
under `verbatimModuleSyntax`; we omit the `algorithm` option (library default is
argon2id) and lock the choice with a test asserting the `$argon2id$` PHC prefix.
Re-verify the binary builds in the spec-16 Docker/Linux deploy image before closing 16.

### 02-secrets | disposable-token raw length & encoding
2026-06-18 — Default taken: **32 random bytes (CSPRNG) base64url-encoded** for the
raw token; stored as a SHA-256 hex hash (fast unsalted hash is correct — input is
already high-entropy). Confirm against the email-link UX in spec 04. Not
security-weakening.

### 02-secrets | refresh-token family/lineage id
2026-06-18 — Default taken: **deferred**. This module exposes only
generate/hash/verify + a pure freshness check; spec 05 owns any token
family/lineage if it adopts rotation-with-reuse-detection. Recorded; revisit in 05.

### 03-signup | duplicate-email response
2026-06-17 — `[CONFIRM-WITH-HUMAN]` Default: respond with a **uniform,
non-revealing success** (anti-enumeration). Signup with an already-registered email
returns the same "check your inbox" response as a fresh signup; no "email already
in use" leak. Implemented in spec 03 (relies on the DB `UNIQUE(email)` + tx
rollback, NOT a racy pre-SELECT; the duplicate path returns the byte-identical 201
body — asserted in route + service tests). Flagged for human review of UX trade-off.

### 03-signup | password strength policy
2026-06-18 — Default taken: **min length 8 + a small common-password denylist**
(case-insensitive), no heavy composition rules (UX over complexity). Lives in
`packages/shared/src/auth-contracts.ts` (`PASSWORD_MIN_LENGTH`,
`COMMON_PASSWORD_DENYLIST`) as the single source of truth. Recorded as a convention;
not security-weakening.

### 03-signup | success response status and body
2026-06-18 — Default taken: **`201 Created`** with a minimal, non-identifying
message (`{ message }`) — never returns `org_id`, `user_id`, or a session. Same body
for created and duplicate. Not security-weakening.

### 03-signup | rate limiting / abuse protection on /auth/signup
2026-06-18 — Default taken: **DEFER the mechanism** to a future cross-cutting
middleware spec; flagged here so signup is not silently shipped as an open
spam/enumeration vector. The endpoint is unauthenticated and mints `org_id`
server-side (never accepts one — `.strict()` rejects unknown fields). Revisit when a
rate-limit/middleware spec exists (and at spec 16 hardening).

### 04-verify | token lifetime
2026-06-18 — Default taken: **24h** (`expires_at = issue + 24h`). Confirm with
product (shorter tightens security, adds resend friction). Not security-weakening.

### 04-verify | resend rate-limit policy
2026-06-18 — Default taken: **per-email <= 3 / hour**, in-memory fixed-window
(`createInMemoryRateLimiter`). Per-process state — correct for single-instance v1; a
shared/distributed store (Redis) and a per-IP ceiling are deferred to deploy
hardening (spec 16). Over-limit returns the SAME generic response (no enumeration).

### 04-verify | multiple live tokens on reissue
2026-06-18 — Default taken: **most-recent-wins** — `issue` marks the user's prior
unused tokens `used_at=now()` in the same tx before inserting the new one, so an old
link cannot also verify. Verified by the live integration test.

### 04-verify | email template ownership & localization
2026-06-18 — Default taken: **Portuguese-first**, "Lumen" identity; template module
in `apps/api` (`verification-template.ts`). A design pass / shared template can come
with spec 06. Not security-sensitive.

### 04-verify | verify-link target + post-verify destination
2026-06-18 — Default taken: the email link points to the **SPA route**
`{APP_URL}/verify-email?token=...` (spec 06), which calls `POST /auth/verify-email`.
Post-verify destination = **redirect to login** (spec 05/06 own the redirect; no
auto-login here). Anti-IDOR: the verify endpoint accepts only the opaque token; the
user is derived from the hash-matched row. Recorded; coordinate UX in spec 06.

### 04-verify | resend timing uniformity (residual enumeration note)
2026-06-18 — The resend response shape/status is identical for existing-unverified,
already-verified, and unknown emails (parity test). Residual: the existing-unverified
path does extra work (issue + send) so latency is not perfectly constant. Accepted as
best-effort per the spec; a constant-time wrapper can be added with the rate-limit
hardening at spec 16. Not a new secret decision.

### 05-login | access/refresh TTL + sliding
2026-06-18 — `[CONFIRM-WITH-HUMAN]` Default: access JWT **15 min**; refresh **30 days**,
**FIXED** (not sliding) for v1 simplicity. Access token is short so the
unrevocable-access-token window is small; sensitive state lives behind the revocable
refresh token. Flagged (security-relevant TTL choice).

### 05-login | refresh cookie path scope
2026-06-18 — `[CONFIRM-WITH-HUMAN]` Default: **Path=/auth** for the refresh cookie
(browser only sends it to `/auth/*` — least surface); access cookie Path=/. Flagged.

### 05-login | refresh-token reuse response
2026-06-18 — `[CONFIRM-WITH-HUMAN]` Default: on detected reuse of an already-rotated
(revoked) refresh token, **revoke the entire token family** for that user (all live
refresh rows) + 401 — defense-in-depth over usability. Implemented in
`session.store.rotateRefreshToken` (verified by the live integration test). Flagged.

### 05-login | login rate limiting
2026-06-18 — `[CONFIRM-WITH-HUMAN]` Default: a modest **per-email in-memory limit
(10 / 15 min)** via `createInMemoryRateLimiter` so login isn't trivially
brute-forceable; a non-existent email is limited identically (no enumeration). Per-IP
keying + a shared/distributed store are deferred to spec 16. Flagged.

### 05-login | refresh_tokens cleanup cadence
2026-06-18 — Default: **lazy** — expired/revoked rows are simply rejected on use; a
scheduled prune (cron) is deferred to spec 16. Not security-weakening (expiry is
enforced in the rotate predicate). Recorded without the human-confirm flag.

### 05-login | login + /auth/me payload shape
2026-06-18 — Default: `{ userId, orgId, email }` (no token material; tokens live only
in httpOnly cookies). `/auth/me` resolves email via a session lookup (the JWT stays
minimal: `{ userId, orgId }`). Coordinate exact fields with spec 06. Recorded.

### 05-login | JWT_SECRET entropy floor (security-review fix)
2026-06-18 — Gate-1 `/security-review` LOW finding RESOLVED: `JWT_SECRET` now validated
to **>= 32 chars** in the shared env schema (was `min(1)`), mirroring
`SECRETS_ENCRYPTION_KEY`'s rigor — a weak HS256 key is offline-forgeable. No HIGH/MEDIUM
findings; all four invariants (org_id-from-JWT, refresh hashed-only + atomic rotation +
reuse detection, cookie flags, no-secret-in-logs) verified.

### 06-web | /auth/me response shape used by the client
2026-06-18 — `[CONFIRM-WITH-HUMAN]` Default: the client consumes spec-05's actual
`/auth/me` = `{ userId, orgId, email }`. The client HOLDS `orgId` (for nothing — the
topbar shows email/initials) but the fetch wrapper NEVER sends it; the server always
derives the tenant from the JWT cookie. Anti-IDOR holds and is tested
(api-client.test "no request carries an org_id"). Flagged because it touches `org_id`;
a future tidy could drop `orgId` from `/auth/me` to a display-only `{ email }`.

### 06-web | login wrong-creds vs unverified
2026-06-18 — Default taken: spec 05 returns **403 EmailNotVerified** only after a
CORRECT password; the login UI shows a generic "e-mail ou senha inválidos" for 401
(no enumeration) and, on 403, offers a "reenviar link" action (spec-04 resend). Recorded.

### 06-web | post-login redirect policy
2026-06-18 — Default taken: honor `?from=` but **clamp to same-origin in-app paths**
(`safeFrom` rejects `//host`, `http://…`, etc. → falls back to `/`) to avoid
open-redirect. Recorded (touches the redirect surface).

### 06-web | router mode + data loading
2026-06-18 — Default taken: declarative `<Routes>` + a component guard
(`RequireAuth`/`PublicOnly`) backed by the `me` query — the single bootstrap choke
point. TanStack Query for `me`/mutations (no `useEffect`+fetch). Not security-sensitive.

### 06-web | client rate-limit / captcha
2026-06-18 — Default taken: **defer** bot-protection to the backend; the UI reserves a
cooldown affordance (resend buttons disable after success). Recorded.

### 06-web | copy language / i18n
2026-06-18 — Default taken: inline **pt-BR** copy, no i18n framework yet. Recorded.

### 06-web | password-reset backend endpoints (gap)
2026-06-18 — `POST /auth/forgot-password` and `POST /auth/reset-password` are NOT in
the 00-16 backlog (spec 05 excludes password reset; no dedicated spec exists). The
spec-06 UI for both is built and tested against MOCKS; the live endpoints are a
DEFERRED future backend slice. Forgot-password UI is non-enumerating (uniform message
on settle); reset validates the shared `passwordPolicySchema`. Recorded as a known v1
gap — these two screens will 404 in production until a backend slice adds the routes.

### 07-08-consent | consent vs `encrypted_password NOT NULL`
2026-06-18 — `[CONFIRM-WITH-HUMAN]` `RESOLVED:` IMPLEMENTED in spec 07 as **Option B** —
a lightweight `db_connection_consents` table (`id`, `org_id` FK cascade,
`consent_version`, `accepted_at`, `accepted_by` FK cascade, `created_at`;
`unique(org_id, consent_version)`) added via migration `0001` (the 12th table). Spec 07
writes it; spec 08 will read/gate on it (`consentService.hasCurrentConsent`) and copy the
fields into the `db_connections` row on insert. Keeps 07 independently persistable +
testable and `encrypted_password NOT NULL` intact; NO placeholder secret written.
Still flagged for human review of the modeling choice.

### 07-consent | terms text source + version gating
2026-06-18 — Default taken: terms are a **versioned constant in `packages/shared`**
(`CONSENT_TERMS` + `CURRENT_CONSENT_VERSION='1'`, 4 scope points), so the accepted
version maps deterministically to exact text. Accept requires the client-sent
`consentVersion === CURRENT` else `409` (terms changed → re-fetch). Gating = a
current-version row for the org. anti-IDOR: org/user from the JWT only (body is
`.strict()`, no org_id). Not security-weakening.

### 07-script | MySQL host scope + REQUIRE SSL + identifier safety
2026-06-18 — Defaults taken: generated `CREATE USER 'lumen_ro'@'%'` (any host) with a
clear comment on restricting to the app's egress IP/CIDR (not pinned until spec 16);
`REQUIRE SSL` included as a **commented, recommended** option (active only if
`requireSsl:true`). The script is read-only BY CONSTRUCTION (only `CREATE USER` +
`GRANT SELECT` + `FLUSH PRIVILEGES`; deny-list test enforces no broader privilege/DDL/
root). username + databaseName validated to `^[A-Za-z0-9_]+$` (≤64) before embedding —
no SQL injection into the generated script. No password is ever generated/received/stored.

### 08-connection | over-privileged / root credential handling
2026-06-18 — `[CONFIRM-WITH-HUMAN]` `RESOLVED:` IMPLEMENTED as **detect-and-REJECT**
(NOT the spec's softer warn-and-proceed lean — overridden by invariant 5). At create,
the tester connects once and runs `SHOW GRANTS FOR CURRENT_USER()`; an over-privileged
credential → `422 CredentialOverPrivileged`, and its password is NEVER encrypted/stored
(verified: `upsert` not called on the over_privileged branch; live test: root rejected).
The Gate-1 review upgraded the check from a denylist to a **deny-by-allowlist** (a grant
is over-privileged unless every privilege token is in {SELECT, USAGE, SHOW VIEW}) so it
catches MySQL 8 dynamic/admin privileges + `PROXY` + `GRANT OPTION`. Strictness threshold
still flagged for human review (it is strict by design — read-only only).

### 08-connection | TLS strictness to the client MySQL
2026-06-18 — `[CONFIRM-WITH-HUMAN]` Default taken (implemented): when `ssl_enabled`, the
tester connects with `ssl: { rejectUnauthorized: true }` (encrypted-with-verification);
there is NO catch-and-retry-plaintext path, so a requested TLS connection can't silently
downgrade (a TLS failure → `ssl_error`). A CA-bundle / verify-identity knob and the live
SSL round-trip are deferred to spec 16. Flagged. (Live happy-path test uses
`ssl_enabled=false` against local Docker MySQL.)

### 08-connection | route shape + timeout + uq_dbconn_org
2026-06-18 — Defaults taken: routes `PUT /db-connection` (create-or-update+test, sync),
`POST /db-connection/test` (re-test, no password re-entry), `GET /db-connection` (state).
Connect+query timeout ~5s, no auto-retry. Sanitized `last_error` from a CLOSED category
set (raw driver text never stored/returned/logged). Enabled the `uq_dbconn_org` unique
index (migration 0002) so create-or-update is an atomic upsert keyed by `org_id` — this
RESOLVES the earlier 01 decision (index absent). Not security-weakening (the index +
org-from-JWT strengthen isolation).

### 09-exposure | API surface + names-only exposure request
2026-06-18 — Default taken: `GET /db-connection/introspect` (live discovered schema),
`GET /db-connection/exposure` (current allow-list), `PUT /db-connection/exposure`
(REPLACE the whole allow-list — subsumes expose/un-expose, idempotent). The PUT body is
**names-only** (`{ tableNames[], relationshipNames[] }`, `.strict()`, no connection id);
the backend re-introspects, validates the chosen names against the live schema, and
builds the persisted rows from the INTROSPECTION (column snapshot + FK direction) — the
client can never inject a fake table/column/relationship. Gate-2 clean. Coord with 10.

### 09-exposure | un-expose semantics + composite FKs + relationship_name + drift
2026-06-18 — Defaults taken: (un-expose) replace-the-whole-set in ONE transaction →
omitted tables and any relationship referencing them are removed atomically (no dangling
relationship can survive; `db_connection_id` FK also CASCADE). (composite FKs) SKIP
multi-column FKs in v1 — only single-column FKs are surfaced (a constraint with >1
KEY_COLUMN_USAGE row is dropped). (relationship_name) deterministic
`${fromTable}__${fromColumn}__${toTable}` (stable across re-introspection, disambiguates
multiple FKs between the same table pair). (drift) v1 keeps the point-in-time `columns`
snapshot; re-running exposure refreshes it (no live sync / no drift flagging) — the read
path (spec 12) is bounded by the allow-list regardless. Not security-weakening.

### 10-connect-ui | route shape + derived step machine + reads
2026-06-18 — Defaults taken: ONE parent route `/connect/database` in the protected shell;
the wizard step is DERIVED from server state (consent → connect → exposure → dashboard),
never a client-stored flag (deep-link to a later step is impossible — one route, derived
view). Keyed off three reads: consent status (07), connection state (08), exposure (09).
Extended `GET /db-connection` (08) to also return the non-secret `config`
(host/port/db/user/ssl — NEVER the password) for the dashboard. Not security-weakening.

### 10-connect-ui | over-privileged surfacing + edit-config + introspection + copy
2026-06-18 — Defaults taken: because spec 08 is **detect-and-REJECT** (not warn-and-
proceed), an over-privileged credential returns `422` and the credential form shows a
clear "não é somente leitura — rode o script" error (supersedes the spec's softer
warning-banner lean). Introspection is fetched on demand when entering the exposure step
(+ re-introspect on edit). Edit-config / edit-exposure are inline panels on the dashboard;
any config change re-enters the test flow; the password field stays write-only and blank
on edit (08 keeps the stored secret). Copy is pt-BR inline. The relationship
both-endpoints client guard is UX only (09's server validation stays authoritative).

### 11-ai-connection | curated Claude model list (verified ids)
2026-06-18 — `[CONFIRM-WITH-HUMAN]` Verified the exact model ids against the project
`claude-api` skill/reference (shared/models.md, cached 2026-06-04) — NOT from memory.
Curated selectable list in `packages/shared` (single source of truth), EXACT alias
strings, NO date suffixes: `claude-opus-4-8` (default), `claude-sonnet-4-6`,
`claude-haiku-4-5`. Took the spec's open-question default lean (small + current): Opus
4.8 / Sonnet 4.6 / Haiku 4.5 — `claude-opus-4-7` is intentionally NOT offered (kept
short). A wrong id is invisible until a live call, so flagged for human confirmation.

### 11-ai-connection | failure mapping + no-store-on-failure + re-key/re-validate
2026-06-18 — Defaults taken. Sanitized closed-set mapping (per claude-api
shared/error-codes.md): 401/403 -> `invalid_key`; 404 -> `model_unavailable`; 429 ->
`rate_limited`; timeout/DNS/5xx/529 -> `network`; unmapped -> `unknown`. Raw provider
text is NEVER persisted or returned. Persistence: a NEW key is encrypted+stored ONLY on
successful validation (`encrypted_api_key NOT NULL` + "don't store a dead key" => a
first-time failure persists NOTHING; the failed category is returned in the mutation
response only). On an EXISTING row a failed re-key NEVER overwrites the stored
ciphertext (a typo must not disconnect a working assistant). Re-validating the stored
key (no paste, e.g. model change): success -> active + model + lastValidatedAt=now;
permanent failure (invalid_key/model_unavailable) -> status=failed + lastError, ciphertext
kept; transient failure (rate_limited/network) -> status UNCHANGED (don't downgrade
active), category surfaced in the response only (open-question default #4). Masked hint:
show NOTHING (default #2). Validation prompt: shortest possible, `maxOutputTokens` ~4
(default #3), bounded server-side timeout -> `network`. Client-side `sk-ant-` shape: a
non-blocking hint only (default #5). Validation uses the **Vercel AI SDK**
(`ai` + `@ai-sdk/anthropic`) per the locked stack (HANDOFF), behind a `ClaudeValidator`
port; CI mocks the provider, an `ANTHROPIC_API_KEY`-gated live smoke is optional.

### 11-ai-connection | Gate-1 security-review result
2026-06-18 — Gate 1 (security-review-before-merge) run on the spec-11 diff. All five
non-negotiable invariants UPHELD, each backed by a passing test: secret-at-rest (key
AES-256-GCM-encrypted before any store write; Postgres never sees plaintext; never
returned/logged/echoed in a 400 body), sanitized errors (`categorizeProviderError` maps
to the closed set; raw provider text discarded), anti-IDOR (org from `getAuth` only;
`.strict()` rejects a client org/connection id), model allow-list (Zod enum rejects
off-list models before any provider call), no-store-on-failure (dead key never persisted;
failed re-key never overwrites the stored ciphertext). Zero HIGH/MEDIUM findings. One LOW
(doc divergence): the DDL oracle `db/schema.sql` kept `uq_aiconn_org` (and `uq_dbconn_org`)
commented while the executed migrations enforce single-column `UNIQUE(org_id)` — RESOLVED
by syncing `db/schema.sql` to the migrations (no exploit; migrations are the live source).

### 12-query-registry | open-question defaults
2026-06-18 — Defaults taken (all spec-12 open questions). (1) Needs declaration: a typed
manifest object per function (`{tables, columns:[{table,column,family?}], relationships}`)
the guard reads field-by-field — adding a function is "declare needs + Zod schema + builder."
(2) Filters (`filtered_aggregate`): equality + range only (`eq`/`gte`/`lte`) on exposed
columns; richer predicates later. (3) Time grains: `day`/`week`/`month`, UTC buckets via
`DATE_FORMAT`. (4) Type-family check: coarse from the snapshot — sum/avg metric column must be
numeric, date-bucket column must be temporal; count(col) needs no family; mismatch =
`type_mismatch` refusal. (5) Ceilings: `RESULT_ROW_LIMIT=1000` grouped rows + `max_execution_time`
10s per statement (global v1; revisit with 13). (6) Identifier quoting: allow-list membership
(guard) + `^[A-Za-z0-9_]+$` assertion + backtick-escape — triple defense.

### 12-query-registry | identifier charset is a v1 limitation (Gate-2 F1)
2026-06-18 — The SQL-layer identifier assertion is strict `^[A-Za-z0-9_]+$` (the right
invariant — it's a hard wall against identifier injection). Consequence (Gate-2 review F1):
an exposed table/column whose REAL MySQL name contains a hyphen/space/dot/non-ASCII is
exposable (introspection stores raw names) but fails CLOSED at build with a sanitized
`query_failed` — safe, but that data is unqueryable in v1. Accepted as a v1 limitation: the
vast majority of schemas use `[A-Za-z0-9_]` names. FOLLOW-UP (spec 09, non-blocking): reject
non-conforming identifiers at the exposure boundary so the limitation surfaces where the owner
can act. Not a vulnerability (fail-closed). See the learning
`query-functions-injection-proof-by-allowlist-membership`.

### 12-query-registry | Gate-2 CRITICAL data-access review result
2026-06-18 — Gate 2 (data-access-review-gates) run on the spec-12 diff with mechanical
re-confirmation. All four checks UPHELD: (i) NO model string reaches SQL as a value (all bound
`?`) OR identifier (only guard-validated allow-list members, charset-asserted + backtick-escaped;
LIMIT is a backend constant); (ii) a JOIN is emitted only from a guard-matched
`exposed_relationships` row, reads only over `exposed_tables`; (iii) org/connection/exposed-set
resolved ONLY by the passed-in `org_id` (JWT in 13) — cross-tenant refs resolve to nothing;
(iv) single read-only `SELECT` only (builder shape + `assertReadOnlySelect` + `multipleStatements:
false` + LIMIT/timeout). No injection/cross-tenant/write/leak break could be constructed. Findings:
F2/F3 (MEDIUM, latent under future multi-connection — guard matched a relationship by name+pair but
build re-fetched by name only) RESOLVED by making build use the identical name+pair predicate +
regression test; F1 (MEDIUM, robustness, fail-closed) documented above; F4/F5 (LOW) — filter values
bound-as-strings (intentional v1) and the read-only backstop (already triple-layered), no change.
GUARD TEST present: injection column → `column_not_exposed` refusal, builder/runner never reached
(unit + live, table left intact).

### 16-deploy | managed Postgres provider
2026-06-17 — `[CONFIRM-WITH-HUMAN]` Default: pick one of **Neon / Supabase**; use
the direct (non-pooled) URL for the migration step and a pooled URL for the app if
needed. Final provider chosen at deploy time. Flagged for human review.

---

## Live-verification-pending (env-gated tests that skip when the resource is absent)

LIVE-VERIFICATION-PENDING: apps/api migrate smoke test (`src/db/schema.test.ts` ->
"live: migrate applies cleanly to a fresh Postgres") is gated on `DATABASE_URL`. It
SKIPS in the default `pnpm test` (vitest does not load `.env`, so CI without a DB
passes). It MUST be run green at least once against local Docker Postgres — done
this iteration via `DATABASE_URL=... vitest run` (creates/migrates/drops a throwaway
`lumen_migrate_smoke` database, asserts the 4 enums + 11 tables + a DESC index, then
drops it). Re-confirm in the §7(2) final live gate.

LIVE-VERIFICATION-PENDING: apps/api signup-store integration test
(`src/auth/signup.store.integration.test.ts` -> "live: signup store (Drizzle
transaction)") is gated on `DATABASE_URL`. SKIPS in the default `pnpm test`. Run
GREEN on 2026-06-18 against local Docker Postgres via
`DATABASE_URL=postgres://postgres:postgres@localhost:5432/lumen npx vitest run`
(throwaway `lumen_signup_test` DB: migrate, then assert created -> exactly 1 org +
1 owner with an argon2 `password_hash` (not raw), and duplicate-email -> `duplicate`
with the org insert rolled back, zero new rows). Re-confirm in the §7(2) final live
gate.

LIVE-VERIFICATION-PENDING: apps/api verification-store integration test
(`src/auth/verification.store.integration.test.ts` -> "live: verification store") is
gated on `DATABASE_URL`. SKIPS in the default `pnpm test`. Run GREEN on 2026-06-18
against local Docker Postgres (throwaway `lumen_verification_test` DB: migrate, then
assert issue persists ONLY the hash (raw never in the row), consume flips the user +
`used_at` atomically with benign replay, unknown/expired -> invalid, and reissue
invalidates the prior unused token). Re-confirm in the §7(2) final live gate.

LIVE-VERIFICATION-PENDING: apps/api session-store integration test
(`src/auth/session.store.integration.test.ts` -> "live: session store") is gated on
`DATABASE_URL`. SKIPS in the default `pnpm test`. Run GREEN on 2026-06-18 against local
Docker Postgres (throwaway `lumen_session_test` DB: migrate, then assert refresh tokens
persist ONLY the hash (raw never in the row), rotation revokes the old row + inserts a
new one, replay of a rotated token is reuse_detected + revokes the whole family, and
unknown/expired -> invalid). Re-confirm in the §7(2) final live gate.

LIVE-VERIFICATION-PENDING: apps/api consent-store integration test
(`src/db-connection/consent.store.integration.test.ts` -> "live: consent store") is
gated on `DATABASE_URL`. SKIPS in the default `pnpm test`. Run GREEN on 2026-06-18
against local Docker Postgres (throwaway `lumen_consent_test` DB: migrate incl. 0001,
then assert consent is org-scoped, re-accepting the same version is idempotent
(unique org+version), and a version bump returns the latest). The spec-01 migrate smoke
(now 12 tables, incl. `db_connection_consents`) also ran green. Re-confirm in the
§7(2) final live gate.

LIVE-VERIFICATION-PENDING: apps/api live MySQL connection tester
(`src/db-connection/db-connection.live.integration.test.ts` -> "live: MySQL connection
tester") is gated on `MYSQL_URL`. SKIPS in the default `pnpm test`. Run GREEN on
2026-06-18 against local Docker MySQL via
`MYSQL_URL=mysql://root:root@127.0.0.1:3306/lumen_client npx vitest run` (as root,
provision a throwaway DB + a SELECT-only user, then assert read-only→ok, root→
over_privileged(reject), wrong-password→auth_failed, bad-db→database_not_found,
unreachable-port→fast-fail). This satisfies RALPH 7(2) (08 must run live MySQL once).
Re-confirm in the final live gate. NOTE: real-customer caching_sha2_password over
plaintext (no SSL) may need `allowPublicKeyRetrieval`/SSL — the test user uses
mysql_native_password; revisit with the SSL story at spec 16.

LIVE-VERIFICATION-PENDING: apps/api live MySQL schema introspection
(`src/db-connection/schema-introspector.live.integration.test.ts` -> "live: MySQL schema
introspection") is gated on `MYSQL_URL`. SKIPS in the default `pnpm test`. Run GREEN on
2026-06-18 vs Docker MySQL (as root provision a test DB with single + composite FKs + a
secret data row + a SELECT-only user; introspect AS the read-only user → assert tables/
columns/single-FK shape, composite FK skipped, and the secret data row is NOT read).
Satisfies RALPH 7(2) (09 must run live introspection once). Re-confirm in the final gate.

LIVE-VERIFICATION-PENDING: apps/api exposure-store integration
(`src/db-connection/exposure.store.integration.test.ts` -> "live: exposure store") is
gated on `DATABASE_URL`. SKIPS in the default `pnpm test`. Run GREEN on 2026-06-18 vs
Docker Postgres (throwaway DB: atomic replace round-trip, idempotent re-save, un-expose
cascade (omitting a table drops its relationships), org/connection scoping +
cross-tenant). Re-confirm in the final gate.

LIVE-VERIFICATION-PENDING: cross-site cookie behavior (spec 05) — the
`Secure`+`SameSite=None` auth cookies require HTTPS; over plain-HTTP local dev the
browser rejects them. Verified in tests via `app.inject` (no browser enforcement); real
cross-origin Pages<->API cookie flow is finalized + verified at deploy (spec 16) with
TLS. Operator step.

LIVE-VERIFICATION-PENDING: real Resend email send (spec 04) is gated on
`RESEND_API_KEY` + a verified sender domain (a human/DNS step, finalized at spec 16).
With no key, `makeEmailSender` binds the no-op `consoleEmailSender` (logs the
recipient only, never the link/token) and all unit tests use a fake sender (no real
email in CI). The real `resendEmailSender` (fetch -> api.resend.com) is implemented
but UNVERIFIED against the live API until a key + verified domain exist.

LIVE-VERIFICATION-PENDING: chat end-to-end (spec 13) — the live test
`apps/api/src/chat/chat.live.integration.test.ts` ("live: chat end-to-end") is gated on
`MYSQL_URL` and SKIPS in the default `pnpm test`. Ran GREEN on 2026-06-18 vs Docker MySQL:
the full chat tool-loop (real query-tools -> real spec-12 executor -> real mysql2 runner) with
a FAKE model port picking `aggregate_over_time` returned the EXACT May sum (350) from MySQL,
the assistant message + stream carried it, and one sanitized `function_call_logs` row was
written (no schema name/value). The orchestrator + unhappy paths are fully unit-tested with a
fake model port; the real AI SDK adapter (`createAiSdkChatModel`) is exercised only by the
ANTHROPIC_API_KEY-gated path. Re-confirm in the final gate.

LIVE-VERIFICATION-PENDING: real Claude chat call (spec 13) — `createAiSdkChatModel`
(Vercel AI SDK `streamText` + tools + `stepCountIs`) is UNVERIFIED against the live Anthropic
API until a BYO key is supplied; CI uses a fake `ChatModelPort`. No env-gated live test ships
for it in v1 (the orchestration is covered by the fake; the real streaming/tool-loop is a
manual/operator verification once a key exists). The error->category mapping it reuses
(`categorizeProviderError`, spec 11) is unit-tested.

LIVE-VERIFICATION-PENDING: query-function end-to-end (spec 12) — the live test
`apps/api/src/query-registry/executor.live.integration.test.ts` ("live: query-function
end-to-end") is gated on `MYSQL_URL` and SKIPS in the default `pnpm test`. Ran GREEN on
2026-06-18 vs Docker MySQL (throwaway DB): `aggregate_over_time` sum-by-month (exact
300/350), `filtered_aggregate` filtered sum (exact 600), `filtered_aggregate` JOIN via the
exposed relationship grouped by the joined table (exact paid:100/pending:50), and an
injection column refused at the guard with the table left intact (4 rows). The pure
guard/builder/executor logic is fully unit-tested without a DB. Re-confirm in the final gate.

LIVE-VERIFICATION-PENDING: real Claude key validation (spec 11) — the live smoke in
`apps/api/src/ai-connection/claude-validator.test.ts` ("createAiSdkValidator (live)")
is gated on `ANTHROPIC_API_KEY` and SKIPS in the default `pnpm test`. CI mocks the
provider; the error->category mapping (`categorizeProviderError`) is fully unit-tested
with synthetic `APICallError`/abort instances. The real `createAiSdkValidator`
(Vercel AI SDK + `@ai-sdk/anthropic`, one minimal completion, bounded timeout) is
implemented but UNVERIFIED against the live Anthropic API until a BYO key is supplied.

---

## Blocked / build-halted

_None._
