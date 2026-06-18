---
status: in-progress
feature: web-shell-and-auth-ui
created: 2026-06-18
---
# Web Shell & Auth UI — Implementation Plan

Implements `[[spec]]`. Make `apps/web` a navigable, themed, authenticated SPA: port the
design system to typed `.tsx`, render `<AppBackground/>` + theme once, set up React Router
(public auth zone + protected glass shell), a `/auth/me`-backed guard, a TanStack Query +
cookie fetch wrapper, and the auth pages (signup, login, verify-email, forgot/reset).
Two invariants drive it: **cookie-only auth** (JWT is httpOnly — the client never reads/
sends a tenant id) and **glass only on chrome** (RTL guard test, invariant 6).

## Architecture

```
apps/web/src/
  design-system/
    design-system.css        # copied from /design-system, imported once in main.tsx
    ui.tsx                    # typed port: useTheme/ThemeProvider/ThemeToggle, AppBackground,
                              #   GlassPanel(as), Button(variant), Card, MetricCard(trend),
                              #   TextField, ChatBubble(from), Avatar, NavItem — exact classnames
  lib/
    api-client.ts            # apiFetch (credentials:'include', JSON, ApiError); NEVER sends org_id
    api.ts                   # typed endpoint fns: signup/login/logout/me/verifyEmail/resend/
                              #   forgotPassword/resetPassword (shared Zod contracts)
    query-client.ts          # one QueryClient; global 401 -> setQueryData(['me'], null)
    session.ts               # useSession() = useQuery(['me'], retry:false)
  routes/
    guards.tsx               # <RequireAuth> (401->/login?from=), <PublicOnly> (authed->/),
                              #   <Splash> while me pending (no flash)
    AppShell.tsx             # protected layout: GLASS sidebar (NavItem) + GLASS topbar
                              #   (ThemeToggle, Avatar, account menu) + <Outlet/>
    AuthLayout.tsx           # centered solid Card layout for public auth pages
    HomePage.tsx             # placeholder home on solid surfaces (no data on glass)
  pages/
    SignupPage / LoginPage / VerifyEmailPage / ForgotPasswordPage / ResetPasswordPage
  forms/useZodForm.ts        # tiny controlled-form + shared-Zod validate + 400-field mapping
  router.tsx                 # <BrowserRouter> zones
  App.tsx / main.tsx         # providers (Query, Theme, Router) + AppBackground once
  *.test.tsx                 # guard redirects, splash-not-flash, forms, glass guard, no-org_id
```

New deps (apps/web): **react-router-dom@^7**, **@tanstack/react-query@^5**.

## Key decisions (recorded in DECISIONS.md)

- **Session source of truth = `GET /auth/me`** (httpOnly cookie is unreadable). Guard gates
  the whole tree on the `me` query: pending → splash, `200` → shell, `401`→null → `/login`.
  Never infer auth from localStorage. `me` shape is spec-05's `{ userId, orgId, email }`
  (the client holds orgId only for nothing — it NEVER sends it; server derives org from JWT).
- **Fetch wrapper:** one `apiFetch` sets `credentials:'include'` + JSON on every call, base
  from `VITE_API_URL` (default `http://localhost:3001`), parses an error envelope, throws
  `ApiError(status, body)`. It NEVER attaches an `org_id`/tenant id (asserted by a test).
  Global 401 → clear the `me` cache (logged-out redirect), not a thrown toast.
- **Theme:** a single `ThemeProvider` owns the state (localStorage + `data-theme` on `<html>`,
  `prefers-color-scheme` default); `ThemeToggle` consumes it. An inline pre-paint script in
  `index.html` sets `data-theme` before React mounts (no flash).
- **Forms:** validate with the SAME shared Zod schemas (`signupRequestSchema`,
  `loginRequestSchema`, `verifyEmailRequestSchema`, `resendVerificationRequestSchema`);
  client checks are UX-only; map server `400` field errors onto inputs. Non-enumerating copy
  for signup-duplicate and forgot-password (uniform success).
- **Routing:** layout-route guard component backed by the `me` query (the single choke
  point). `?from=` honored but clamped to same-origin in-app paths (no open redirect).
- **Glass only on chrome:** `GlassPanel`/`.glass` only on sidebar/topbar/menus; every form,
  error, result, `Card`/`MetricCard` on solid surfaces. RTL guard test asserts no
  `.card`/`.metric`/`.bubble`/reading-text node is a descendant of `.glass`.
- **forgot/reset-password backend gap:** `POST /auth/forgot-password` + `/auth/reset-password`
  are NOT in the 00–16 backlog (05 excludes reset; no dedicated spec). The UI is built per
  spec 06 and tested against mocks; the live endpoints are deferred to a future backend
  slice. Recorded; forgot UI is non-enumerating, reset validates the shared password policy.

## Verification

`pnpm build && lint && type-check && test` green. Vitest + RTL with a mocked API (global
`fetch` stub / `vi.fn`), no real backend. Guard test for glass-only-on-chrome is mandatory
(invariant 6). Follow `react-best-practices` + `vercel-react-best-practices` (TanStack Query
not `useEffect`+fetch; stable QueryClient/wrapper; typed prop-driven components).
