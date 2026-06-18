---
status: shipped
feature: signup-and-org
created: 2026-06-17
shipped: 2026-06-18
---
# Signup & Organization — Spec

**Status:** Shipped
**Scope:** The signup endpoint (Flow 1, first half). `POST /auth/signup`: validate input with Zod, then **atomically** create the tenant (`organizations`) plus its single `owner` (`users`, `email_verified = false`, password hashed), and kick off email verification. This is the front door to the product — it is where a tenant comes into existence.

## Context

This is the very first write path in the system and the moment a tenant is born. Per `[[../../constitution|Constitution]]` → *Multi-tenant isolation*, every later query is scoped by an `org_id` that must already exist and be trustworthy; this spec is what mints that `org_id`. Per the schema (`db/schema.sql`), an organization has exactly one `owner` in v1 — the `member` role exists in the enum but is deferred to v2 (`[[../../constitution|Constitution]]` → *Scope guardrails*), so there are **no invites** here.

The schema deliberately has **no `owner` FK on `organizations`** — that would force a circular FK with `users`. The owner is simply the `users` row whose `role = 'owner'` inside the org. Creating both rows is therefore a two-insert operation that must be **transactional**: an org with no owner, or an owner with no org, is a corrupt tenant. `email` is `UNIQUE` globally (1 person = 1 account in v1), so duplicate-email is a first-class, expected case — not an edge.

This spec **calls into** but does not implement two neighbors: password hashing (`[[../02-secrets-and-tokens/spec|02]]`) and the verification token + Resend email mechanics (`[[../04-email-verification/spec|04]]`). It depends on the Drizzle schema and DB access being in place (`[[../01-app-db-drizzle/spec|01]]`).

## Problem Statement

A new business owner needs to create an account and an organization in one step, with no prior tenant context (this endpoint is unauthenticated — there is no JWT yet). We must turn a validated `{ email, password, organizationName }` into a consistent pair of rows (one `organizations`, one `owner` `users`) without ever leaving a half-created tenant behind, store the password only as a hash, refuse weak passwords and malformed input, and handle an already-registered email without leaking who is and isn't a user. On success we hand off to email verification and tell the client to go check their inbox — we do **not** log them in here.

## Non-Goals

- **Email sending and token internals.** Generating, hashing, storing, and emailing the verification token is `[[../04-email-verification/spec|04]]`. This spec only *triggers* it (one call) after the tenant is committed.
- **Login, JWT issuance, sessions, refresh tokens.** Signup returns no session and sets no auth cookie — that is `[[../05-login-jwt-sessions/spec|05]]`. A user cannot use the app until they verify and then log in.
- **Any frontend.** The signup form, validation UX, and "check your email" screen are `[[../06-web-shell-and-auth-ui/spec|06]]`.
- **Password hashing primitive.** The hash function/params live in `[[../02-secrets-and-tokens/spec|02]]`; here we only call `hashPassword()`.
- **Invites / second user / role assignment beyond `owner`.** v2 (`member`). No team management.
- **Resending verification, password reset, email change.** Not part of the signup path.

## Constraints

- **Endpoint:** `POST /auth/signup`, unauthenticated, in `apps/api`. JSON in, JSON out.
- **Validation (Zod, shared):** the request schema lives in `packages/shared` (consumed by `06`'s form later, single source of truth). Enforce: `email` — valid, normalized (trim + lowercase) before uniqueness check and insert; `password` — strength policy (`[NEEDS CLARIFICATION]` below — propose min 8, with a basic strength rule); `organizationName` (the business/tenant name → `organizations.name`) — required, trimmed, non-empty, length-bounded. Reject extra/unknown fields. A `400` with field-level errors on validation failure.
- **Atomicity:** create `organizations` then `users` inside **one DB transaction**. Any failure rolls back both — never a dangling org or ownerless tenant.
- **Owner by construction:** the `users` row is inserted with `role = 'owner'`, `email_verified = false`, `verified_at = null`, and `org_id` pointing at the org just created in the same transaction. There is no separate "make owner" step and no `owner` column on `organizations` (avoids the circular FK — see Context).
- **Password at rest:** store only `password_hash` via `[[../02-secrets-and-tokens/spec|02]]`'s `hashPassword()`. The raw password exists only in the request body and is never logged, echoed, or persisted (`[[../../constitution|Constitution]]` → *Disposable secrets / hashing*).
- **Globally unique email, no enumeration:** `email` is `UNIQUE`. On a duplicate, do **not** reveal "this email is already registered" in a way that distinguishes existing from new accounts. Prefer a uniform success-shaped response (and optionally a "if this is you, we sent a link" notification path) over a distinguishing `409`. Resolve the exact behavior in Open Questions; whatever is chosen must be applied consistently and be safe against timing-based enumeration where practical.
- **Race on duplicate email:** rely on the DB `UNIQUE` constraint as the source of truth, not a pre-check `SELECT` (which is racy). Catch the unique-violation error and funnel it into the same non-enumerating response as the pre-checked duplicate.
- **Verification trigger after commit:** only call `[[../04-email-verification/spec|04]]` **after** the transaction commits (the user row must exist and have an `id`). Email send is best-effort relative to the HTTP response: a transient email failure must not roll back a successfully created tenant, and must not leak as a different status to the client (the user can re-trigger via `04`'s resend path later).
- **No JWT, no `org_id` from client:** this endpoint predates any session; it never reads an `org_id` from the request — it *creates* one server-side (`[[../../constitution|Constitution]]` → *anti-IDOR*).
- **Testing:** Vitest. Cover the happy path, validation failures, the duplicate-email path (both pre-checked and unique-violation race), transactional rollback, and "tenant created even if the verification email send fails."

## User Stories / Scenarios

1. **New owner signs up (happy path).** A first-time owner POSTs a valid `{ email, password, organizationName }`. The API normalizes the email, hashes the password, and in one transaction inserts an `organizations` row and a `users` row with `role='owner'`, `email_verified=false`, linked by `org_id`. After commit, it triggers verification (`04`) and returns a success response telling them to check their email. No session is issued.
2. **Weak or malformed input.** A request with an invalid email, a too-weak password, or a missing/blank `organizationName` is rejected with `400` and field-level error messages — and nothing is written to the database.
3. **Email already registered.** Someone signs up with an email that already exists. The response is indistinguishable from (or deliberately non-revealing about) a fresh signup — no "account already exists" tell — and no second tenant or user row is created.
4. **Concurrent duplicate (race).** Two signups for the same new email arrive nearly simultaneously; both pass the optional pre-check. The DB `UNIQUE` constraint rejects the second insert; the API catches the violation, rolls back, and returns the same non-enumerating response — exactly one tenant exists afterward.
5. **Email provider hiccups.** The tenant and owner commit successfully, but the verification email send (`04`) fails transiently. The signup still succeeds from the client's perspective; the user later uses the resend path to get their link. No orphaned/rolled-back tenant.

## Success Criteria

- `POST /auth/signup` with valid input creates exactly one `organizations` row and one `users` row (`role='owner'`, `email_verified=false`, correct `org_id`), with the password stored only as `password_hash`.
- Org-creation and owner-creation are atomic: an induced failure between the two inserts leaves **zero** new rows (verified by test).
- The raw password never appears in the DB, logs, or the response body; only the hash is persisted.
- Invalid input yields `400` with field-level errors and writes nothing.
- A duplicate email (whether caught by pre-check or by the `UNIQUE` constraint under a race) does not create a second account and does not leak account existence; exactly one tenant remains.
- Verification is triggered (`04`) only after commit; a simulated email-send failure does not roll back the tenant and does not change the externally observable status.
- The request/response Zod contract lives in `packages/shared` and is the single source consumed by the API (and later by `06`).
- Vitest covers: happy path, each validation failure class, duplicate-email (pre-check + race), rollback atomicity, and email-send-failure resilience — all green.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Non-atomic creation leaves a dangling org (no owner) or an ownerless tenant, corrupting isolation assumptions later | Wrap both inserts in a single Drizzle transaction; test that an injected mid-transaction failure rolls back both rows |
| Duplicate-email handling leaks which emails are registered (user enumeration) | Return a uniform, non-distinguishing response; rely on the DB `UNIQUE` constraint (not a racy pre-`SELECT`) and funnel its violation into the same response; consider response-time uniformity |
| Raw password leaks via logs, error messages, or echoed response | Never log the body; hash via `[[../02-secrets-and-tokens/spec|02]]` immediately; assert in tests that no plaintext password is persisted or returned |
| Triggering email inside the transaction (or letting a send failure roll back the tenant) | Call `[[../04-email-verification/spec|04]]` strictly **after** commit; treat send as best-effort with a resend fallback; never surface send failure as a different signup status |
| Email not normalized → case/whitespace variants bypass uniqueness (`A@x.com` vs `a@x.com`) | Trim + lowercase before the uniqueness check and the insert; store the normalized form |
| Reading `org_id` (or any tenant id) from the client at this pre-auth boundary | Endpoint is unauthenticated and never accepts an `org_id`; it mints one server-side — enforced by the contract rejecting unknown fields |

## Open Questions

- [NEEDS CLARIFICATION: exact password strength policy] — propose a minimum length of 8 plus a basic rule (e.g. not in a small common-password denylist); avoid overcomplex composition rules that hurt UX. Lock the rule and record it as a convention.
- [NEEDS CLARIFICATION: duplicate-email response shape] — pick between (a) a uniform success-shaped `200/201` that never reveals existence (strongest anti-enumeration, but the legitimate user gets no "you already have an account" signal in-band), or (b) a generic `409` accepting some enumeration. Default lean: option (a), with an out-of-band "someone tried to sign up with your email" / "you already have an account, log in" email handled via `[[../04-email-verification/spec|04]]`.
- [NEEDS CLARIFICATION: success response status and body] — `201 Created` vs `200 OK`, and whether the body returns anything beyond a generic "check your email" message (it must **not** return the `org_id`, `user_id`, or any session). Default lean: `201` with a minimal, non-identifying message.
- [NEEDS CLARIFICATION: rate limiting / abuse protection on the unauthenticated endpoint] — likely belongs to a cross-cutting middleware spec, but note it here so signup isn't shipped as an open spam/enumeration vector; default lean: defer the mechanism, flag the dependency.
