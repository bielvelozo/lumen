---
status: in-progress
feature: signup-and-org
created: 2026-06-18
---
# Signup & Organization — Implementation Plan

Implements `[[spec]]`. `POST /auth/signup` (unauthenticated): validate `{ email,
password, organizationName }` with a shared Zod contract, then **atomically** create
one `organizations` row + one `owner` `users` row (password hashed via spec 02),
and trigger email verification (spec 04 seam) after commit. Duplicate email →
uniform, non-revealing success (anti-enumeration). No session is issued here.

## Architecture

```
packages/shared/src/
  auth-contracts.ts        # signupRequestSchema (.strict, email trim+lowercase,
                           #   password policy, orgName trim/bounds), signupResponseSchema,
                           #   PASSWORD_MIN_LENGTH, COMMON_PASSWORD_DENYLIST, types

apps/api/src/auth/
  verification-trigger.ts  # VerificationTrigger port + noopVerificationTrigger
                           #   (spec 04 replaces the no-op with the real Resend flow)
  signup.store.ts          # SignupStore port + makeDrizzleSignupStore(db):
                           #   atomic tx (insert org -> insert owner), catch PG
                           #   unique_violation (23505) -> { outcome: 'duplicate' }
  signup.service.ts        # createSignupService({ store, hashPassword,
                           #   verificationTrigger }): hash ALWAYS (timing), create,
                           #   best-effort post-commit trigger, uniform response
  signup.route.ts          # registerSignupRoute(app, service): POST /auth/signup;
                           #   safeParse -> 400 field errors | 201 uniform message
  *.test.ts                # service (fakes), route (app.inject), store (live, gated)

apps/api/src/app.ts        # buildApp(deps?) — register /auth/signup iff a service is
                           #   supplied; /health stays dependency-free
apps/api/src/server.ts     # wire real deps from env: makeDb, hashPassword, noop trigger
```

Cross-boundary types/Zod live in `packages/shared` (consumed later by spec 06's form).

## Key decisions

- **Atomicity:** one Drizzle `db.transaction` — insert `organizations`, then `users`
  (`role='owner'`, `email_verified=false`, `org_id` = the just-created org). Any
  throw rolls both back. There is no `owner` FK on `organizations` (avoids the
  circular FK; owner = the `users` row with `role='owner'`).
- **Duplicate email (anti-enumeration):** rely on the DB `UNIQUE(email)` — NOT a racy
  pre-`SELECT`. The owner insert hits `23505`; the tx rolls back (so no orphan org)
  and the store returns `{ outcome: 'duplicate' }`. The service returns the SAME
  uniform success body as a fresh signup. (`[CONFIRM-WITH-HUMAN]` default already in
  DECISIONS.md.) This duplicate path doubles as the rollback-atomicity proof: a real
  induced failure on the 2nd insert leaves zero new rows.
- **Password at rest:** `hashPassword()` (spec 02, argon2id) is injected and called
  on EVERY request before the store call (uniform timing); only the hash is passed to
  the store. The raw password is never logged, echoed, or persisted.
- **Verification trigger after commit:** a `VerificationTrigger` port, fired
  best-effort AFTER the tx commits (created path only); errors are swallowed (never
  roll back the tenant, never change the externally observable status). Spec 04 binds
  the real Resend-backed implementation; spec 03 ships the no-op + the seam.
- **Validation (shared Zod):** `.strict()` rejects unknown fields; email
  `trim().toLowerCase()` + format; password `min 8` + small common-password denylist;
  `organizationName` trimmed, non-empty, length-bounded. Failure → `400` with
  field-level errors; nothing written.
- **Response:** `201` with a minimal, non-identifying message (never `org_id`,
  `user_id`, or a session).
- **No `org_id` from client:** endpoint is pre-auth; it MINTS `org_id` server-side and
  rejects unknown fields (anti-IDOR boundary).

## Open-question defaults (recorded in DECISIONS.md)

- Password strength → min length 8 + small common-password denylist (no heavy
  composition rules). Locked as a convention.
- Duplicate-email response → uniform success (option a) — already recorded,
  `[CONFIRM-WITH-HUMAN]`.
- Success status/body → `201` + minimal non-identifying message.
- Rate limiting on the unauthenticated endpoint → DEFER the mechanism to a
  cross-cutting middleware spec; flag the dependency (not shipped as an open vector
  silently).

## Verification

`pnpm build && lint && type-check && test` green. Unit (service+route via fakes /
app.inject) run with no DB. The live store integration test is **env-gated on
`DATABASE_URL`** (throwaway DB, migrate, real tx) — Docker is up, so run it green once
and record `LIVE-VERIFICATION-PENDING`. Guard: a test proving the persisted value is
the argon2 hash, never the raw password.
