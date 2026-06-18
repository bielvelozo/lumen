---
status: in-progress
feature: web-shell-and-auth-ui
created: 2026-06-18
---
# Web Shell & Auth UI — Tasks

A box is checked ONLY after its slice is implemented AND committed.

## 1 — Deps + design-system port + providers
- [ ] Add `react-router-dom`@^7 + `@tanstack/react-query`@^5 to `apps/web`; install.
- [ ] Copy `design-system.css` into `apps/web/src/design-system/`; port `ui.jsx` →
      typed `ui.tsx` (exact classnames; explicit prop types; `ThemeProvider` owns theme,
      `ThemeToggle` consumes it; `AppBackground`, `GlassPanel as`, `Button variant`,
      `MetricCard trend`, `ChatBubble from`, `TextField`, `Card`, `Avatar`, `NavItem`).
- [ ] `main.tsx`: import the app's CSS once, mount QueryClient + ThemeProvider +
      AppBackground (once) + Router; `index.html` pre-paint theme script.
- [ ] `ui.test.tsx`: components render with the right classes; theme toggle flips
      `data-theme` + persists.

## 2 — API client + TanStack Query + session
- [ ] `lib/api-client.ts`: `apiFetch` (credentials:'include', JSON, `VITE_API_URL`,
      `ApiError`), NEVER attaches org_id. `lib/api.ts`: typed endpoint fns.
- [ ] `lib/query-client.ts`: one QueryClient; global 401 → `setQueryData(['me'], null)`.
      `lib/session.ts`: `useSession()`.
- [ ] tests: wrapper always sends `credentials:'include'`; NO request carries an org_id;
      me 401 → null.

## 3 — Router zones + guard + shell
- [ ] `routes/guards.tsx` (RequireAuth/PublicOnly/Splash), `AppShell` (glass chrome),
      `AuthLayout` (solid card), `HomePage` (solid), `router.tsx`.
- [ ] tests: unauth deep-link → `/login?from=`; authed → home; pending → splash (no
      flash); authed hitting public route → home.
- [ ] GUARD: `glass-only.test.tsx` — render shell + home; assert no `.card`/`.metric`/
      `.bubble`/reading-text under `.glass`; sidebar/topbar ARE `.glass`.

## 4 — Auth forms: signup / login / verify-email
- [ ] `forms/useZodForm.ts`; `SignupPage`, `LoginPage`, `VerifyEmailPage`.
- [ ] tests: signup happy → check-email + non-enumerating duplicate; field validation +
      400 mapping; login happy → navigate, invalid → generic error, unverified → resend;
      verify-email token across pending/verified/invalid.

## 5 — Auth forms: forgot / reset password
- [ ] `ForgotPasswordPage` (uniform non-enumerating message), `ResetPasswordPage`
      (shared password policy; reads `?token=`). Endpoints mocked (backend deferred).
- [ ] tests: forgot uniform copy; reset validation + success → /login.

## 6 — Gates + ship
- [ ] Full suite green: `pnpm build && lint && type-check && test`.
- [ ] Record open-question defaults + the forgot/reset backend-gap in `DECISIONS.md`;
      mark spec Shipped (MOC + frontmatter) atomically; capture learnings.
