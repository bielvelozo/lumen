---
status: in-progress
feature: login-jwt-sessions
created: 2026-06-18
---
# Login, JWT & Sessions — Implementation Plan

Implements `[[spec]]`. `POST /auth/login` (password verify + `email_verified` gate) →
short-lived access JWT + rotated, **hashed** refresh token, both in httpOnly/Secure/
SameSite=None cookies; `/auth/refresh` (rotate + reuse detection), `/auth/logout`
(revoke + clear), `/auth/me`; and the cornerstone **`requireAuth` Fastify preHandler**
that is the SINGLE source of `org_id` for every downstream handler (anti-IDOR). Gate-1
security-flagged: `/security-review` before Shipped.

## Architecture

```
packages/shared/src/
  auth-contracts.ts        # + loginRequest, sessionResponse(/me), AuthenticatedUser

apps/api/src/auth/
  jwt.ts                   # createAccessTokenService({secret,ttl}) — jose HS256 sign/verify
  cookies.ts               # cookie names + attrs (httpOnly/Secure/SameSite=None);
                           #   setAuthCookies / clearAuthCookies (refresh cookie Path=/auth)
  session.store.ts         # SessionStore (Drizzle): findUserByEmailForLogin,
                           #   createRefreshToken, rotateRefreshToken (atomic + reuse
                           #   detection -> family revoke), revokeRefreshToken, revokeAllForUser
  auth.service.ts          # createAuthService: login / refresh / logout (orchestration)
  require-auth.ts          # makeRequireAuth(accessTokenService) preHandler; FastifyRequest
                           #   augmentation (request.auth); getAuth(req) accessor (the ONLY
                           #   sanctioned org_id source)
  auth.route.ts            # POST /auth/login|refresh|logout, GET /auth/me (requireAuth)
  *.test.ts                # jwt, cookies, service, require-auth (GUARD), routes, live store

apps/api/src/app.ts        # register @fastify/cookie; AppDeps += authService,
                           #   accessTokenService; register auth routes + requireAuth
apps/api/src/server.ts     # wire from env (JWT_SECRET, TTLs); precompute dummy argon2
                           #   hash (timing guard) via top-level await
```

New deps (apps/api): **jose** (JWT), **@fastify/cookie**.

## Key decisions (recorded in DECISIONS.md; security-relevant ones flagged)

- **Access token:** HS256 JWT via `jose`, claims `{ userId, orgId }`, signed with
  `JWT_SECRET`; TTL ~15 min. In the `lumen_access` httpOnly cookie; never in a body.
- **Refresh token:** spec-02 `generateToken` (32-byte CSPRNG); DB stores ONLY
  `hashToken(raw)` (invariant 4). Lifetime 30 days, FIXED (not sliding) v1. In the
  `lumen_refresh` httpOnly cookie, **Path=/auth** (least surface). `[CONFIRM-WITH-HUMAN]`.
- **Rotation + reuse detection:** `/auth/refresh` does one atomic conditional
  `UPDATE refresh_tokens SET revoked_at=now WHERE token_hash=? AND revoked_at IS NULL
  AND expires_at>now RETURNING user_id`; if it rotates, insert a new row + new cookies.
  0 rows ⇒ look up the hash; if the row exists but was already revoked ⇒ **reuse
  after rotation**: revoke ALL the user's live refresh tokens (family nuke) and 401.
  `[CONFIRM-WITH-HUMAN]`.
- **org_id provenance (invariant 1):** `requireAuth` verifies the access JWT from the
  cookie, attaches `request.auth = { userId, orgId }` from the CLAIMS only, 401s
  otherwise. `getAuth(req)` is the sole accessor; no handler reads a tenant id from
  body/query/path/header. GUARD test asserts this.
- **Verified-email gate + uniform failures:** login runs `verifyPassword` even for an
  unknown email (against a precomputed dummy argon2 hash) so wrong-password vs
  unknown-email are timing-uniform; unverified ⇒ distinct non-enumerating message.
- **Cookies:** `httpOnly`, `Secure`, `SameSite=None`, centralized so spec 16 only swaps
  domain/origin. Local dev needs TLS/a browser exception (recorded LIVE-VERIFICATION).
- **Login rate limit:** reuse `createInMemoryRateLimiter` per-email (modest, e.g.
  10/15min) so login isn't trivially brute-forceable; full policy deferred to 16. `[CONFIRM-WITH-HUMAN]`.
- **Cleanup of expired/revoked rows:** lazy (rejected on use); a scheduled sweep is
  deferred to spec 16.
- **Payloads:** login + `/auth/me` return `{ userId, orgId, email }` (no token material).

## Guard tests (RALPH §2f, spec 05)

- **org_id-from-JWT:** a request carrying a body/query `orgId` for another org but a valid
  JWT for org A resolves `request.auth.orgId === A`; the protected route reflects the
  JWT org, never the client-supplied one.
- **Refresh hashed-only:** the live store test asserts the persisted `refresh_tokens`
  row holds `hashToken(raw)`, never the raw token; rotation revokes the old row and
  inserts a new one; a replayed (revoked) token is rejected and triggers family revoke.

## Verification

`pnpm build && lint && type-check && test` green. Auth/JWT/cookie/service tests run with
no DB. Live session-store integration env-gated on `DATABASE_URL` (Docker up — run green
once). Then `/security-review` (Gate 1) with findings resolved before Shipped.
