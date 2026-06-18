---
tags:
  - moc
---
# Specs — Map of Content

All specs for Business Assistant features, past and current. Specs never get deleted — shipped specs remain as historical record.

## Workflow trigger

Before implementing a user request, ask: "Can I describe the complete solution in one sentence?" If no → use the Spec Kit flow. If yes → go direct. If almost → ask the user.

Template: `[[../specs/_template/spec|_template/spec]]`

## How the roadmap is built

The v1 build is decomposed into the ordered implementation specs below — this list **is** the backlog the build (and the ralph loop) consumes, one feature at a time. Each entry has a `spec.md` written up front; its `plan.md` + `tasks.md` are produced by the `writing-plans` flow when the feature is picked up for implementation. The order respects dependencies: a spec is only started after the specs it depends on are shipped. Each slice aims to deliver something that works end-to-end, not a loose fragment (per `HANDOFF.md`).

Status legend: **Planned** (spec written, not implemented) · **In progress** · **Shipped**.

## Active

### Phase 0 — Foundation
- **Shipped** — [[../specs/00-monorepo-scaffold/spec|00 · Monorepo scaffold]] — pnpm + Turborepo workspace (`apps/web`, `apps/api`, `packages/shared`), TS/ESLint/Prettier/Vitest, env validation, local Docker (Postgres + MySQL). _Deps: none._
- **Shipped** — [[../specs/01-app-db-drizzle/spec|01 · App DB + Drizzle]] — Drizzle against Postgres; port `db/schema.sql` to a Drizzle schema; migrations, seed, `updated_at` handling. _Deps: 00._
- **Shipped** — [[../specs/02-secrets-and-tokens/spec|02 · Secrets & tokens]] — encryption-at-rest module (key outside the DB) for `bytea` secrets; token hashing for verification/refresh; password hashing helper. _Deps: 00, 01._

### Phase 1 — Base & Auth
- **Shipped** — [[../specs/03-signup-and-org/spec|03 · Signup & org creation]] — signup creates org + owner user; password hashed; validation. _Deps: 01, 02._
- **Shipped** — [[../specs/04-email-verification/spec|04 · Email verification]] — Resend; hashed single-use expiring token; verify + resend endpoints. _Deps: 03._
- **Shipped** — [[../specs/05-login-jwt-sessions/spec|05 · Login, JWT & sessions]] — login; JWT in httpOnly/Secure/SameSite=None cookie; refresh-token rotation (hashed, revocable); logout; auth middleware that derives `org_id` from the JWT (anti-IDOR foundation). _Deps: 02, 03._
- **Shipped** — [[../specs/06-web-shell-and-auth-ui/spec|06 · Web shell & auth UI]] — port the design system into `apps/web`; AppBackground, theme toggle, router, TanStack Query, auth pages, protected-route guard. _Deps: 00, 03, 04, 05._

### Phase 2 — Connect the client DB (MySQL)
- **Shipped** — [[../specs/07-db-connection-consent-and-script/spec|07 · Consent & onboarding script]] — terms/consent capture; generate the read-only onboarding SQL script for the customer. _Deps: 05, 06._
- **Shipped** — [[../specs/08-db-connection-create-and-test/spec|08 · Create & test connection]] — create `db_connections`; encrypt password; live MySQL connection test; `status` (pending/active/failed) + sanitized `last_error`; read-only/least-privilege checks. _Deps: 02, 07._
- **Planned** — [[../specs/09-introspection-and-exposure/spec|09 · Introspection & exposure]] — introspect tables/columns/FKs; owner approves `exposed_tables` + `exposed_relationships` (allow-list). _Deps: 08._
- **Planned** — [[../specs/10-connect-db-ui/spec|10 · Connect-DB UI]] — frontend for the full connect-DB flow (consent → script → credentials → test → choose tables/relationships → status). _Deps: 06, 07, 08, 09._

### Phase 3 — Connect the AI (Claude)
- **Planned** — [[../specs/11-ai-connection-claude/spec|11 · Connect Claude]] — paste API key; validate with a test call (Vercel AI SDK); encrypt; set `default_model`; status + `last_error`; frontend. _Deps: 02, 05, 06._

### Phase 4 — Chat (the core)
- **Planned** — [[../specs/12-query-function-registry/spec|12 · Query-function registry]] — the predefined, parameterized, read-only query functions over exposed tables/relationships; allow-list enforcement; backend builds the SQL, never the model. _The constitutional heart. Deps: 09._
- **Planned** — [[../specs/13-chat-orchestrator/spec|13 · Chat orchestrator]] — Fastify route + AI SDK tool-calling mapping model tool calls → query functions; streaming; persist `messages` (org-scoped); `function_call_logs` (sanitized); unhappy paths. _Deps: 11, 12._
- **Planned** — [[../specs/14-chat-ui/spec|14 · Chat UI]] — sessions list, streaming message render on solid surfaces (glass only on chrome/input), model switch. _Deps: 06, 13._

### Phase 5 — Observability & deploy
- **Planned** — [[../specs/15-observability-sentry/spec|15 · Observability]] — Sentry (api + web); error/log sanitization that never carries raw customer data; `function_call_logs` audit view. _Deps: 13._
- **Planned** — [[../specs/16-deploy/spec|16 · Deploy]] — Dockerfile for `apps/api`; Cloudflare Pages for `apps/web`; managed Postgres (Neon/Supabase); cross-site cookie/CORS config; CI basics. _Deps: all._

## Shipped

- **00 · Monorepo scaffold** — shipped 2026-06-17. pnpm + Turborepo workspace
  (`apps/web`, `apps/api`, `packages/shared`), TS strict + ESLint + Prettier +
  Vitest, Zod env validation, local Docker (Postgres + MySQL). All gates green;
  both DB containers healthy. (Status token stays on its line in **Active** above —
  the MOC token is authoritative.)
- **01 · App DB + Drizzle** — shipped 2026-06-18. Drizzle schema 1:1 port of
  `db/schema.sql` (4 enums, 11 tables, all FK delete actions, uniques, indexes),
  programmatic migrator (+pgcrypto), idempotent seed, structural test + live migrate
  smoke (ran green vs local Docker Postgres). All gates green.
- **02 · Secrets & tokens** — shipped 2026-06-18. Single injectable `crypto` module
  in `apps/api` (no consumer imports `node:crypto`/argon2 directly): AES-256-GCM
  encryption-at-rest with a self-describing `version|key_id|iv|tag|ciphertext` blob
  (fresh IV/call, tag-verified — tamper throws), keyring loaded once from a
  32-byte-validated `SECRETS_ENCRYPTION_KEY`, disposable-token generate/SHA-256-hash/
  constant-time-verify + pure freshness check, and argon2id passwords via
  `@node-rs/argon2`. Errors carry only safe reason codes (no secret/plaintext). 46
  unit tests; all gates green; `/security-review` clean (Gate 1).
- **03 · Signup & org creation** — shipped 2026-06-18. `POST /auth/signup`
  (unauthenticated): shared `.strict()` Zod contract (email trim+lowercase, password
  min-8 + denylist, orgName trim/bounds), atomic Drizzle tx creating one
  `organizations` + one `owner` `users` (password argon2-hashed via spec 02). Duplicate
  email → uniform 201 via DB `UNIQUE(email)` + tx rollback (no orphan org), not a racy
  pre-SELECT; raw password never persisted/echoed (guard test). Verification fired
  best-effort post-commit via a `VerificationTrigger` seam (spec 04 fills it). Service
  + route unit tests; live store integration (atomic tx + UNIQUE rollback) ran green vs
  Docker Postgres. All gates green.
- **08 · Create & test connection** — shipped 2026-06-18. Flow-2 gate 2 (backend; UI is
  spec 10). `PUT /db-connection` upserts the org's single `db_connections` row (keyed by the
  new `uq_dbconn_org`, migration 0002), **encrypts the password** (spec 02 AES-256-GCM →
  `encrypted_password` only), and runs a **live mysql2 test** (connect + `SELECT 1` +
  `SHOW GRANTS`, ≤5s, try/finally close) → `active | failed` with a SANITIZED `last_error`
  from a closed category set (raw driver text never stored/returned/logged). Root/over-
  privileged credential → **detect-and-REJECT** (422, never stored — invariant 5); the
  Gate-1 review upgraded the grants check to a deny-by-allowlist (catches MySQL 8 dynamic/
  admin/`PROXY`). `POST /db-connection/test` re-tests via the decrypted password; all routes
  `requireAuth` (org from JWT, anti-IDOR). Consent (spec 07) gates create. Unit (mapper/
  grants/service/route) + **live MySQL integration ran green vs Docker MySQL** (read-only→
  active, root→rejected, error categories). Gate-1 `/security-review`: no HIGH; MEDIUM
  (denylist gap) resolved.
- **07 · Consent & onboarding script** — shipped 2026-06-18. Flow-2 gate 1 (backend;
  UI is spec 10). Resolved the consent-before-credential tension as **Option B**: a new
  `db_connection_consents` table (migration `0001`, the 12th) holds durable, versioned,
  org-scoped consent without a placeholder secret (`encrypted_password NOT NULL` intact);
  spec 08 will gate on it. Endpoints (all requireAuth, org/user from the JWT only):
  `GET/POST /db-connection/consent` (accept rejects a stale version → 409),
  `GET …/consent/terms`, `POST …/onboarding-script`. The script generator is read-only
  BY CONSTRUCTION (`CREATE USER` + `GRANT SELECT` + `FLUSH PRIVILEGES` only; deny-list
  test rejects broader privilege/DDL/root; identifiers validated `^[A-Za-z0-9_]+$`; no
  password ever generated/stored). 19 unit tests + live consent-store integration green
  vs Docker Postgres. Not Gate-1 flagged.
- **06 · Web shell & auth UI** — shipped 2026-06-18. `apps/web` is now a themed,
  authenticated SPA: design system ported to typed `ui.tsx` (`ThemeProvider` owns theme,
  pre-paint script, app-owned CSS imported once, `AppBackground` at root); React Router
  with a PUBLIC auth zone + a PROTECTED glass shell (glass sidebar/topbar, account menu),
  a `/auth/me`-backed guard (pending→splash, 200→shell, 401→`/login?from=`) — the
  httpOnly cookie is unreadable so the server is the single source of truth. One
  TanStack `QueryClient` + a cookie fetch wrapper (`credentials:'include'`, base from
  `VITE_API_URL`, global 401→logout) that NEVER sends an `org_id` (tested). Five auth
  pages (signup/login/verify-email/forgot/reset) validate the SHARED Zod contracts, map
  400s, and use non-enumerating copy. Guard test (invariant 6): no data/reading node
  under `.glass`. 24 RTL tests; all gates green. Not Gate-1 flagged. NOTE: forgot/reset
  backend endpoints are a deferred slice (UI built against mocks — see DECISIONS).
- **05 · Login, JWT & sessions** — shipped 2026-06-18. `POST /auth/login` (argon2
  verify + `email_verified` gate, timing-uniform via a dummy-hash verify on unknown
  emails, per-email rate limit) issues a 15-min HS256 access JWT (`jose`, alg pinned)
  + a 30-day refresh token, both in httpOnly/Secure/SameSite=None cookies (refresh
  Path=/auth). `/auth/refresh` rotates atomically (one conditional UPDATE...RETURNING,
  no TOCTOU) with reuse detection → family revoke; `/auth/logout` revokes + clears
  (idempotent); `/auth/me` is requireAuth-guarded. The **`requireAuth` preHandler +
  `getAuth()`** is the single `org_id` source from the JWT (anti-IDOR cornerstone for
  08–14) — guard test proves a client-supplied org_id is ignored. Refresh tokens
  persisted hash-only (guard test). Gate-1 `/security-review`: no HIGH/MEDIUM; LOW
  JWT_SECRET-entropy finding resolved (>=32 chars). Unit + live session-store
  integration green vs Docker Postgres.
- **04 · Email verification** — shipped 2026-06-18. Issue → email → consume lifecycle
  over `email_verification_tokens`: spec-02 `generateToken` (32-byte CSPRNG) with only
  the SHA-256 hash persisted (raw lives solely in the link — guard test). `POST
  /auth/verify-email` consumes via one atomic conditional `UPDATE ... WHERE used_at IS
  NULL AND expires_at>now RETURNING user_id` (no TOCTOU) + flips the user;
  verified/already_verified/invalid, no 500. `POST /auth/resend-verification` is
  anti-enumeration (identical generic 202 for existing/verified/unknown; email only for
  existing-unverified) + per-email rate limit; most-recent-wins reissue. Resend behind
  an `EmailSender` port (no-op when no key, never logs the link/token). The verification
  service fulfills spec-03's `VerificationTrigger` seam (real issue-on-signup now).
  Service/route unit tests + live store integration ran green vs Docker Postgres.
  All gates green.
