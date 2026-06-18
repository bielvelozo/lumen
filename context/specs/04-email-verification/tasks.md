---
status: in-progress
feature: email-verification
created: 2026-06-18
---
# Email Verification — Tasks

A box is checked ONLY after its slice is implemented AND committed.

## 1 — Shared contracts + env
- [x] `auth-contracts.ts`: `verifyEmailRequestSchema` (`{ token }`, strict),
      `verifyEmailResponseSchema` (`{ status: 'verified'|'already_verified'|'invalid' }`),
      `resendVerificationRequestSchema` (`{ email }`, strict, normalized),
      `resendVerificationResponseSchema` (`{ message }`); types; export.
- [x] `env.ts`: add `APP_URL` (default `http://localhost:5173`) and `RESEND_FROM_EMAIL`
      (default Lumen sender); `.env.example` entries.
- [x] contract tests (shared).

## 2 — Email sender port + template + rate limiter
- [x] `email-sender.ts`: `EmailSender` port; `consoleEmailSender` (no key — logs
      recipient only, NEVER the link/token); `resendEmailSender(apiKey, from)` via fetch.
- [x] `verification-template.ts`: `buildVerificationEmail(link)` → `{ subject, html, text }`
      (PT-first, "Lumen"); contains the link, never logged.
- [x] `rate-limiter.ts`: `RateLimiter` port + `createInMemoryRateLimiter({ limit, windowMs, now })`;
      unit test (allows N, blocks N+1, resets after window).

## 3 — Verification store (Drizzle)
- [x] `verification.store.ts`: `VerificationStore` port + `makeDrizzleVerificationStore(db)`:
      `issue` (invalidate prior unused + insert, one tx), `consume` (atomic conditional
      update + user flip; already_verified/invalid resolution).

## 4 — Verification service (issue / verify / resend)
- [x] `verification.service.ts`: `createVerificationService({ store, generateToken,
      hashToken, emailSender, rateLimiter, buildLink, findUserByEmail, now, ttlMs })`:
      `triggerForNewUser`/`issueVerification`, `verifyEmail`, `resendVerification`.
- [x] `verification.service.test.ts` (fakes): issue→hash equality (raw from link =
      sha256 in store); happy verify; replay→invalid; already_verified; expiry→invalid;
      resend parity across the 3 cases (send only for existing-unverified); rate-limit;
      send failure swallowed; GUARD: raw token never logged / never equals stored hash.

## 5 — Routes + app/server wiring
- [x] `verification.route.ts`: `POST /auth/verify-email`, `POST /auth/resend-verification`
      (safeParse → 400 | generic success); never echo a token.
- [x] `app.ts`: `AppDeps += verificationService`; register the two routes when supplied.
- [x] `server.ts`: build the verification service from env (store, sender by key, limiter,
      crypto token helpers, APP_URL) and bind it as BOTH the routes' service AND signup's
      `verificationTrigger` (replace the no-op).
- [x] `verification.route.test.ts` (inject, fakes): verify valid→verified, garbage→invalid;
      resend→generic; response never contains a token.

## 6 — Live store integration + gates + ship
- [x] `verification.store.integration.test.ts` (skipIf no `DATABASE_URL`): throwaway DB +
      migrate; issue stores a hash (row holds no raw token); consume flips user +
      `used_at` atomically; replay→0 rows→invalid; reissue invalidates prior unused. Run
      green vs Docker Postgres; record `LIVE-VERIFICATION-PENDING`.
- [x] Full suite green: `pnpm build && lint && type-check && test`.
- [x] Record open-question defaults + the Resend live-send `LIVE-VERIFICATION-PENDING`
      in `DECISIONS.md`; mark spec Shipped (MOC + frontmatter) atomically; capture learnings.
