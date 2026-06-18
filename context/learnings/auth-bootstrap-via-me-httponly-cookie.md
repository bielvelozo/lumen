---
tags:
  - learning
  - concept
related:
  - "[[../specs/06-web-shell-and-auth-ui/spec]]"
created: 2026-06-18
---
# The SPA can't read the auth cookie — bootstrap session from `GET /auth/me`

The access JWT lives in an **httpOnly** cookie, so JS cannot read it. The frontend
therefore CANNOT know whether it is authenticated from anything local — `localStorage`, a
JS flag, or the cookie itself. The single source of truth is the server: on load the route
guard issues `GET /auth/me` (`credentials: 'include'`) and branches on the result.

The clean shape: the `me` query function maps a `401` to **`null` (a logged-out state)**,
not a thrown error — so the guard reads three states cleanly:

- `isPending` → render a **splash**, never a flash of the login page or protected content;
- `data` (a session) → render the protected tree;
- `data === null` → redirect to `/login?from=<attempted path>`.

A global `401` from any other request (`QueryCache`/`MutationCache` `onError`) does
`queryClient.setQueryData(['me'], null)`, which makes the guard redirect — so an expired
session mid-use becomes a clean logout, not a crash. The client holds `orgId` (from
`/auth/me`) but the fetch wrapper NEVER sends it; the server always derives the tenant from
the JWT (anti-IDOR), asserted by a "no request carries an org_id" test.

## Context

Built in spec 06 (`apps/web/src/lib/session.ts`, `query-client.ts`, `routes/guards.tsx`).
Uses TanStack Query (not `useEffect`+fetch) with `retry:false` and a stable `QueryClient`.
The pre-paint theme script in `index.html` is the analogous "set before first paint" trick
for theming.

## How to Apply

- Never infer auth from `localStorage`/a JS-readable flag with httpOnly cookies — gate the
  whole tree on the `/auth/me` query.
- Model `401` as a `null` data state for the session query; show a splash while pending.
- Centralize `credentials:'include'` in ONE fetch wrapper and never attach a tenant id;
  the server derives `org_id` from the cookie. The connect-DB (10) and chat (14) UIs reuse
  this guard + wrapper.
