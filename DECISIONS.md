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
2026-06-18 — Default taken: **no** — mirror `db/schema.sql`; the commented-out
`uq_dbconn_org` / `uq_aiconn_org` unique indexes stay absent. "One connection per
org" / "one AI provider per org" is enforced in application logic by specs 08 / 11.
Not security-sensitive.

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

### 07-08-consent | consent vs `encrypted_password NOT NULL`
2026-06-17 — `[CONFIRM-WITH-HUMAN]` Default: **Option B** — a lightweight
`db_connection_consents` table (`org_id`, `consent_version`, `accepted_at`,
`accepted_by`) written in spec 07; spec 08 reads/gates on it and copies the fields
into `db_connections` on insert. Keeps 07 independently persistable+testable and
keeps `encrypted_password NOT NULL` intact (Option A would make 07's own Success
Criteria unsatisfiable). Flagged for human review.

### 08-connection | over-privileged / root credential handling
2026-06-17 — `[CONFIRM-WITH-HUMAN]` Default: **detect-and-REJECT**. At
connection-create, run `SHOW GRANTS` (or equivalent); if the credential is root or
holds write/DDL/admin privileges, REFUSE to store it and surface the onboarding
script. Warn-and-proceed is NOT permitted (constitution invariant 5). The
`[CONFIRM-WITH-HUMAN]` flag covers only HOW STRICT the privilege check is, never
whether root may be stored. Flagged for human review of strictness threshold.

### 08-connection | TLS strictness to the client MySQL
2026-06-17 — `[CONFIRM-WITH-HUMAN]` Default: encrypted-with-verification where
feasible; never downgrade to plaintext. Finalize certificate handling before
merging spec 08. Flagged for human review.

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

---

## Blocked / build-halted

_None._
