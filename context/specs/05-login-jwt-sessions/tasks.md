---
status: in-progress
feature: login-jwt-sessions
created: 2026-06-18
---
# Login, JWT & Sessions — Tasks

A box is checked ONLY after its slice is implemented AND committed.

## 1 — Shared contracts + deps
- [x] `auth-contracts.ts`: `loginRequestSchema` (`{ email (norm), password (min 1) }`,
      strict), `sessionResponseSchema` (`{ userId, orgId, email }`), `AuthenticatedUser`
      type; export. Contract tests.
- [x] Add `jose` + `@fastify/cookie` to `apps/api`; `pnpm install`; confirm load.

## 2 — JWT + cookies primitives
- [x] `jwt.ts`: `createAccessTokenService({ secret, ttlSeconds })` → `sign(claims)`,
      `verify(token)` (HS256 via jose; verify returns `AuthenticatedUser | null`).
- [x] `jwt.test.ts`: round-trip; tampered/expired/wrong-secret → null.
- [x] `cookies.ts`: names (`lumen_access`/`lumen_refresh`), attrs (httpOnly/Secure/
      SameSite=None; refresh Path=/auth); `setAuthCookies` / `clearAuthCookies`.
- [x] `cookies.test.ts`: attributes present; clear expires both.

## 3 — Session store (Drizzle)
- [x] `session.store.ts`: `findUserByEmailForLogin`, `createRefreshToken`,
      `rotateRefreshToken` (atomic conditional revoke+RETURNING; reuse detection →
      `revokeAllForUser`), `revokeRefreshToken` (idempotent).

## 4 — Auth service
- [x] `auth.service.ts`: `createAuthService({ store, verifyPassword, dummyPasswordHash,
      generateToken, hashToken, accessTokenService, rateLimiter, now, refreshTtlMs })`:
      `login` (timing-uniform; email_verified gate; rate limit), `refresh` (rotate +
      reuse), `logout` (idempotent).
- [x] `auth.service.test.ts`: login happy/unverified/wrong-pw/unknown-email (verifyPassword
      called even when user missing); rate-limited; refresh rotate + replay(revoked)→reuse;
      logout idempotent; no raw token leaks.

## 5 — requireAuth decorator + routes + wiring
- [x] `require-auth.ts`: `makeRequireAuth(accessTokenService)` preHandler; FastifyRequest
      augmentation; `getAuth(req)`; 401 on missing/invalid/expired.
- [x] `require-auth.test.ts` (GUARD): valid cookie → request.auth from JWT; missing/bad →
      401; a body/query `orgId` is ignored — orgId comes ONLY from the JWT.
- [x] `auth.route.ts`: `POST /auth/login|refresh|logout`, `GET /auth/me` (requireAuth);
      set/clear cookies; bodies carry no token material.
- [x] `app.ts`: register `@fastify/cookie`; `AppDeps += authService, accessTokenService`;
      register auth routes (+ requireAuth on `/auth/me`).
- [x] `server.ts`: wire from env (JWT_SECRET, TTLs, rate limiter); precompute dummy argon2
      hash (top-level await).
- [x] `auth.route.test.ts` (inject): login sets both cookies + creates hashed row; me
      200/401; refresh rotates cookies; logout clears + idempotent; no token in any body.

## 6 — Live store integration + security + ship
- [x] `session.store.integration.test.ts` (skipIf no `DATABASE_URL`): throwaway DB +
      migrate; create stores ONLY the hash (GUARD: raw never in row); rotate revokes old +
      inserts new; replay(revoked)→reuse→family revoke; expired/unknown→null. Run green vs
      Docker Postgres; record `LIVE-VERIFICATION-PENDING`.
- [x] Full suite green: `pnpm build && lint && type-check && test`.
- [x] GATE 1: run `/security-review` on the diff; resolve findings.
- [x] Record all open-question defaults (flag security-relevant) in `DECISIONS.md`; mark
      spec Shipped (MOC + frontmatter) atomically; capture learnings.
