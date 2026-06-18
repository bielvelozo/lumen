---
tags:
  - learning
  - concept
related:
  - "[[../specs/05-login-jwt-sessions/spec]]"
created: 2026-06-18
---
# `org_id` comes ONLY from `getAuth(request)` — the single anti-IDOR seam

Spec 05 builds the one mechanism the whole multi-tenant isolation promise rests on:
`requireAuth` (a Fastify `preHandler`) verifies the access JWT from the httpOnly cookie
and attaches `request.auth = { userId, orgId }` from the **signed claims only**;
`getAuth(request)` is the sole sanctioned accessor and throws if a route used it without
`requireAuth`. There is deliberately **no other code path** that yields `orgId` — not a
body field, query param, path segment, or header (constitution invariant 1).

Every later data-reading spec (08–14) MUST scope its tenant queries by
`getAuth(request).orgId`, never by an id taken from the request. The login/refresh
contracts are `.strict()` so a client cannot even submit an `org_id`; on login `orgId` is
read from the DB user row, and on refresh it is re-derived from the rotated token's user
inside the transaction. The guard test forces the point: a request carrying a different
`orgId` in the body/query but a valid JWT for org A resolves to org A — the client value
is ignored.

## Context

Built in spec 05 (`apps/api/src/auth/require-auth.ts`, `jwt.ts`). The JWT is HS256 via
`jose` with the algorithm **pinned on verify** (`algorithms: ['HS256']`) — without that
pin, alg-confusion/`none` tokens could forge claims. `JWT_SECRET` is validated to >= 32
chars (a weak HS256 key is offline-forgeable).

## How to Apply

- In any protected handler, get the tenant via `const { orgId } = getAuth(request)` and
  filter EVERY tenant query by it. Never read a tenant id from input.
- Register a route's auth with `{ preHandler: requireAuth }`; the data-access review gate
  (`[[../rules/data-access-review-gates]]`) blocks any diff that sources `org_id` elsewhere.
- Keep the JWT minimal (`userId`, `orgId`); fetch other profile fields (email, etc.) via a
  lookup, so the token stays an authz artifact, not a profile cache.
- When verifying any JWT, always pin `algorithms`.
