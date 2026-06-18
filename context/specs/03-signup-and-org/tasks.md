---
status: in-progress
feature: signup-and-org
created: 2026-06-18
---
# Signup & Organization — Tasks

A box is checked ONLY after its slice is implemented AND committed.

## 1 — Shared signup contract
- [ ] `packages/shared/src/auth-contracts.ts`: `PASSWORD_MIN_LENGTH`,
      `COMMON_PASSWORD_DENYLIST`, `signupRequestSchema` (`.strict()`; email
      `trim().toLowerCase()` + format; password min-8 + denylist; `organizationName`
      trim/non-empty/max), `signupResponseSchema`, `SignupRequest`/`SignupResponse`
      types; export from `index.ts`.
- [ ] `auth-contracts.test.ts`: normalizes email (trim+lowercase); rejects bad email,
      weak/denylisted password, blank orgName, unknown fields; accepts valid input.

## 2 — Verification trigger seam (spec 04 fills it)
- [ ] `apps/api/src/auth/verification-trigger.ts`: `VerificationTrigger` port +
      `noopVerificationTrigger` (logs a "verification pending (spec 04)" line; no throw).

## 3 — Signup store (atomic tenant creation)
- [ ] `apps/api/src/auth/signup.store.ts`: `SignupStore` port (`createTenant` →
      `{ outcome: 'created'; userId; orgId } | { outcome: 'duplicate' }`) +
      `makeDrizzleSignupStore(db)`: one tx (insert org -> insert owner), catch PG
      `23505` → duplicate; `isUniqueViolation` helper.

## 4 — Signup service (orchestration)
- [ ] `apps/api/src/auth/signup.service.ts`: `createSignupService({ store,
      hashPassword, verificationTrigger })`: hash ALWAYS, create, best-effort
      post-commit trigger (created only; swallow errors), uniform response.
- [ ] `signup.service.test.ts` (fakes): happy path (trigger called, success msg);
      duplicate (no 2nd create, SAME success msg, no leak); trigger failure → still
      success; password hashed before store; raw password never reaches store.

## 5 — Route + app/server wiring
- [ ] `apps/api/src/auth/signup.route.ts`: `registerSignupRoute(app, service)`;
      `POST /auth/signup`; `safeParse` → `400 { error, fields }` | `201` response.
- [ ] `apps/api/src/app.ts`: `buildApp(deps?)` registers `/auth/signup` iff a service
      is supplied; `/health` stays dependency-free (app.test.ts unchanged).
- [ ] `apps/api/src/server.ts`: build real deps from env (makeDb, hashPassword, noop
      trigger) → service → buildApp.
- [ ] `signup.route.test.ts` (app.inject, fake-backed service): 201 valid; 400 each
      validation class; response body never contains org_id/user_id/password;
      duplicate → 201 same shape.

## 6 — Live store integration (env-gated) + gates + ship
- [ ] `signup.store.integration.test.ts` (skipIf no `DATABASE_URL`): throwaway DB +
      migrate; created inserts exactly 1 org + 1 owner (`role='owner'`,
      `email_verified=false`, `password_hash` is argon2 not raw); duplicate returns
      `duplicate` + leaves zero new rows (rollback atomicity). Run green vs Docker
      Postgres; record `LIVE-VERIFICATION-PENDING`.
- [ ] Full suite green: `pnpm build && lint && type-check && test`.
- [ ] Record open-question defaults in `DECISIONS.md`; mark spec Shipped (MOC token +
      frontmatter) atomically; capture learnings.
