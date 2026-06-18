---
status: draft
feature: login-jwt-sessions
created: 2026-06-17
shipped: null
---
# Login, JWT & Sessions — Spec

**Status:** Draft
**Scope:** `POST /auth/login` (password verify + `email_verified` gate), short-lived JWT in an httpOnly cookie carrying `user_id`/`org_id`, hashed-and-rotated refresh tokens, `/auth/refresh`, `/auth/logout`, `/auth/me`, and — the cornerstone — a **Fastify auth decorator** that is the single source of `org_id` for every downstream handler (anti-IDOR foundation). Flow 1 + Decision 7.

## Context

Signup (`[[../03-signup-and-org/spec|03]]`) creates the `organization` + owner `user`, and email verification (`[[../04-email-verification/spec|04]]`) flips `email_verified`. Password hashing/verification and the generic hash-a-disposable-token primitive both live in `[[../02-secrets-and-tokens/spec|02]]`. This spec is the gate that turns a verified account into an authenticated session, and — far more importantly — it builds the mechanism by which the rest of the product knows *which tenant is asking*.

The locked stack (`[[../../constitution|Constitution]]` → *Tooling and workflow*) puts auth in a **JWT carried in an httpOnly, Secure, SameSite=None cookie**, decoded server-side. The schema already anticipates this: `refresh_tokens` carries `token_hash`, `expires_at`, and `revoked_at` precisely so a refresh token can be stored hashed and rotated/revoked (`[[../01-app-db-drizzle/spec|01]]`, `db/schema.sql`). The whole multi-tenant isolation promise — every query scoped by an `org_id` that comes from the JWT and never from client input — is unenforceable until the artifact that *extracts* that `org_id` exists. That artifact is this spec's auth decorator, and it is the seam every later data-reading spec (`12`–`14`) depends on. This makes the diff security-sensitive (`[[../../rules/security-review-before-merge|security-review-before-merge]]`) and directly load-bearing for `[[../../rules/data-access-review-gates|data-access-review-gates]]`.

## Problem Statement

There is no way to log in, no session, and — critically — no trusted source of `org_id`. We need: (1) a login endpoint that verifies the password against `users.password_hash`, refuses unverified accounts, and on success mints a short-lived access JWT plus a refresh token; (2) refresh tokens persisted **as a hash only** (invariant 4), rotated on every use and revoked on logout; (3) refresh and logout endpoints; (4) an `/auth/me` so the SPA can bootstrap session state on load; and (5) a reusable Fastify auth decorator that verifies the access JWT, rejects on failure, and exposes `{ user_id, org_id }` to handlers so that **no handler ever reads a tenant id from the body, query, path, or header**. Without (5), every future endpoint is one careless line away from an IDOR.

## Non-Goals

- **Per-resource authorization beyond org scoping.** This spec establishes *who you are* and *which org you belong to*. Row-level / role-based rules (e.g. `owner` vs the v2 `member`) beyond "you may only see your own org" are out of scope; the decorator exposes `org_id` and downstream specs apply it.
- **The frontend.** Login forms, the auth UI, cookie-aware fetch wiring, and the route guard land in `[[../06-web-shell-and-auth-ui/spec|06]]`. Here we ship endpoints + the server decorator only.
- **Signup, password hashing, email verification, password reset.** Owned by `[[../03-signup-and-org/spec|03]]`, `[[../02-secrets-and-tokens/spec|02]]`, `[[../04-email-verification/spec|04]]`. Password *reset* is not built here.
- **Cross-site cookie production wiring.** The final CORS config and the SameSite=None+Secure behavior across the Pages↔API origins are finalized in `[[../16-deploy/spec|16]]`. Here we set the correct cookie attributes for local dev and assume same logical contract.
- **Multi-session UX / device management, rate limiting, lockout policy.** Noted as open questions, not built (beyond the minimum needed to not be trivially brute-forceable).

## Constraints

- **org_id provenance (invariant 1, anti-IDOR).** `org_id` is read **only** from verified JWT claims, set at login from `users.org_id`. The decorator never falls back to a body/query/path/header value, and handlers have no other accessor. This is the single rule `[[../../rules/data-access-review-gates|data-access-review-gates]]` exists to protect. ([[../../constitution|Constitution]] → Architecture principle 1.)
- **Access token = short-lived JWT.** Claims carry at least `user_id` (= `users.id`) and `org_id` (= `users.org_id`); signed with a server secret from validated env (`JWT_SECRET`, per the `00` env validator). Short TTL (target ~15 min — see Open Questions). The access token rides in an httpOnly cookie; it is never returned in a JSON body and never readable by JS.
- **Refresh token stored hashed (invariant 4).** The raw refresh token exists **only** inside the httpOnly cookie. The DB row in `refresh_tokens` holds `token_hash` (via the `02` hashing primitive), `expires_at`, and `user_id`. The raw value is never logged, never returned in a body, never stored in clear text.
- **Rotation on use.** `/auth/refresh` validates the presented raw token against its stored hash, checks not-expired and `revoked_at IS NULL`, then **rotates**: sets `revoked_at = now()` on the old row and issues a brand-new refresh token (new row) + new access JWT. A presented token whose row is already revoked or expired is rejected (and — see Risks — reuse of an already-rotated token is treated as a red flag).
- **Revocation on logout.** `/auth/logout` sets `revoked_at = now()` on the current refresh token row and clears both cookies. Logout is idempotent and must not error if the cookie is missing/already revoked.
- **Cookies.** Both cookies are `httpOnly`, `Secure`, `SameSite=None`, `Path=/` (refresh cookie may be path-scoped to `/auth` — see Open Questions). Cookie max-age aligns to token TTL. Use the Fastify cookie plugin; signing/attributes centralized so prod (`16`) only adjusts domain/origin, not the security flags.
- **Verified-email gate.** Login fails (and issues no tokens) if `users.email_verified = false`, with a distinct, non-enumerating response that nudges the user to verify rather than leaking whether the account exists.
- **Uniform auth failures.** Wrong password, unknown email, and (where appropriate) unverified account must not let an attacker enumerate accounts via differing responses/timing. Password verification runs even on unknown emails (constant-ish work) to avoid a timing oracle.
- **Decorator contract.** A single Fastify decorator/preHandler (e.g. `requireAuth`) verifies the access JWT from the cookie, returns `401` on missing/invalid/expired token, and attaches `{ userId, orgId }` to the request (typed via `packages/shared`, augmenting `FastifyRequest`). Protected routes opt in by registering it; it is the *only* sanctioned way to learn the caller's `orgId`.
- **Security review required.** This diff touches auth, sessions, and cookies — run `/security-review` and resolve findings before merge (`[[../../rules/security-review-before-merge|security-review-before-merge]]`).
- **Tests (Vitest).** Cover the happy path and the failure/abuse paths (see Success Criteria). Tests assert the DB stores only the *hash*, never the raw refresh token.

## User Stories / Scenarios

1. **Verified owner logs in.** `POST /auth/login` with correct email+password for a verified user → `200`, an access-token cookie and a refresh-token cookie are set (both httpOnly/Secure/SameSite=None), a `refresh_tokens` row exists with a `token_hash` (not the raw value), and the body contains a minimal session payload (e.g. `user_id`, `org_id`, email) — no tokens in the body.
2. **Unverified user blocked.** Login with correct credentials but `email_verified = false` → no tokens issued; a response that tells the user to verify without confirming account existence to an outsider.
3. **Wrong / unknown credentials.** Bad password, or an email with no account → uniform `401` with no enumeration signal and no meaningful timing difference.
4. **Session bootstrap.** With a valid access cookie, `GET /auth/me` → `200 { user_id, org_id, email, ... }`; with no/invalid cookie → `401`. The SPA uses this on load to decide authed vs. anonymous.
5. **Silent refresh + rotation.** With a valid refresh cookie (access expired), `POST /auth/refresh` → new access + new refresh cookies; the old refresh row is `revoked_at`-stamped, a new row is created. The previously-presented raw token no longer works.
6. **Replay of a rotated token.** Presenting a refresh token whose row is already `revoked_at` (i.e. reuse after rotation) → `401`; treated as a reuse signal (logged; see Risks for optional family revocation).
7. **Logout.** `POST /auth/logout` → current refresh row `revoked_at`-stamped, both cookies cleared; a subsequent `/auth/me` or `/auth/refresh` with the old cookies → `401`. Calling logout twice does not error.
8. **A protected handler can only get org_id from the token.** A route guarded by `requireAuth` reads `request.orgId` from the verified claims; an attempt to influence the tenant via a body/query/path field has no effect — there is no code path that reads it from there.

## Success Criteria

- `POST /auth/login` verifies the password via the `02` primitive, enforces the `email_verified` gate, and on success sets both cookies and creates a hashed `refresh_tokens` row; returns no token material in the body.
- Access JWT is short-lived, signed with `JWT_SECRET`, and carries `user_id` + `org_id`; tampering with or expiring the token yields `401`.
- `refresh_tokens` persists only `token_hash`; a test greps the stored row and asserts the raw token is absent. `expires_at` is set; `revoked_at` starts `NULL`.
- `/auth/refresh` rotates: old row `revoked_at`-stamped, new row + new cookies issued; expired/revoked/replayed tokens are rejected with `401`.
- `/auth/logout` revokes the current refresh row, clears both cookies, and is idempotent.
- `/auth/me` returns the session for a valid access cookie and `401` otherwise.
- The `requireAuth` decorator is implemented, typed (request augmented with `userId`/`orgId` via `packages/shared`), registered on at least one protected route as proof, and is the sole accessor of `orgId`. A grep/lint check (or documented review gate) confirms no handler reads a tenant id from body/query/path/header.
- All cookies carry `httpOnly`, `Secure`, `SameSite=None`; security flags are centralized so `16` changes only domain/origin.
- Auth failures (bad password, unknown email, unverified) are uniform enough to not enable account enumeration or a timing oracle.
- Vitest suite covers stories 1–8 (happy + abuse paths) and passes; `/security-review` has been run and its findings resolved.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| A future handler reads `org_id` from the request body/query/path/header, silently breaking tenant isolation (IDOR) | The decorator is the *only* sanctioned accessor; augment `FastifyRequest` so `request.orgId` is the obvious path; enforce via `[[../../rules/data-access-review-gates|data-access-review-gates]]` at review and a grep/lint guard. |
| Refresh token leaked or written in clear text somewhere (logs, body, DB) | Store only `token_hash` (invariant 4); raw value lives solely in the httpOnly cookie; ban it from logs; test asserts no raw token in the row or responses. |
| Rotation gap allows a stolen-then-rotated token to be replayed | On `/auth/refresh`, reuse of an already-`revoked_at` token returns `401` and is flagged as reuse; optionally revoke the whole token family (all live tokens for that user) on detected reuse. |
| Account enumeration / timing oracle via login responses | Uniform `401` for wrong-password vs unknown-email; run password verification even for unknown emails; keep the unverified-account message non-confirming. |
| `SameSite=None` cookies require `Secure` and correct CORS or break across Pages↔API origins | Set `Secure`+`SameSite=None` from the start (local over TLS or documented dev exception); centralize cookie/CORS config so `[[../16-deploy/spec|16]]` only swaps origin/domain. |
| Stolen short-lived access JWT cannot be revoked before it expires | Keep access TTL short; sensitive state lives behind refresh (which *is* revocable); document the access-token revocation gap as accepted for v1. |
| JWT secret weak, rotated, or leaked invalidates all sessions / forges tokens | `JWT_SECRET` comes from the validated env (`00`), is required and high-entropy; document that rotating it logs everyone out (acceptable v1). |
| Expired/revoked `refresh_tokens` rows accumulate | A cleanup/expiry sweep (cron or lazy-on-write) prunes rows past `expires_at`; size/owner of the sweep is an Open Question. |

## Open Questions

- [NEEDS CLARIFICATION: exact access-token TTL (~15 min) and refresh-token lifetime (e.g. 7–30 days), plus whether refresh is "sliding" (extends on use) or fixed.]
- [NEEDS CLARIFICATION: whether the refresh cookie should be path-scoped (`Path=/auth/refresh`) to limit its surface, or kept at `Path=/` for simplicity.]
- [NEEDS CLARIFICATION: on detected refresh-token reuse, revoke just the replayed token or the entire token family for that user (defense-in-depth vs. usability of accidental double-submits).]
- [NEEDS CLARIFICATION: whether v1 needs login rate limiting / lockout here or defers it to a later hardening pass — minimum bar is "not trivially brute-forceable."]
- [NEEDS CLARIFICATION: ownership and cadence of the expired/revoked `refresh_tokens` cleanup (scheduled job vs. lazy pruning) — confirm against `[[../16-deploy/spec|16]]`.]
- [NEEDS CLARIFICATION: shape of the `/auth/me` and login response payloads (which fields the SPA actually needs) — coordinate with `[[../06-web-shell-and-auth-ui/spec|06]]`.]
