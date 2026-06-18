---
status: in-progress
feature: email-verification
created: 2026-06-18
---
# Email Verification — Implementation Plan

Implements `[[spec]]`. Issue a single-use, **hashed**, expiring verification token on
signup and on resend; email the **raw** token as a link via a Resend-backed `EmailSender`
port; verify through `POST /auth/verify-email`, which hashes the link token and, in one
atomic conditional update, flips `users.email_verified` + the token's `used_at`. Reuses
spec 02's `generateToken`/`hashToken`. Fulfills constitution invariant 4 (disposable
tokens stored hashed; raw only in the email link).

## Architecture

```
packages/shared/src/
  auth-contracts.ts        # + verifyEmailRequest/Response, resendVerificationRequest/Response
  env.ts                   # + APP_URL (verify-link base) and RESEND_FROM_EMAIL

apps/api/src/auth/
  email-sender.ts          # EmailSender port; resendEmailSender(fetch) + consoleEmailSender
                           #   (no-op when no key; NEVER logs the raw token/link)
  verification-template.ts # buildVerificationEmail(link): { subject, html, text } (PT-first, Lumen)
  rate-limiter.ts          # RateLimiter port + in-memory fixed-window (per-email <=3/h)
  verification.store.ts    # VerificationStore port + Drizzle impl:
                           #   issue(): invalidate prior unused + insert new (one tx)
                           #   consume(): atomic UPDATE...WHERE used_at IS NULL AND
                           #     expires_at>now RETURNING user_id, then flip user; else
                           #     'already_verified' if user already verified, else 'invalid'
  verification.service.ts  # createVerificationService(...): issueVerification (=the spec-03
                           #   VerificationTrigger), verifyEmail, resendVerification
  verification.route.ts    # POST /auth/verify-email, POST /auth/resend-verification
  *.test.ts                # service (fakes), routes (inject), store (live, gated), limiter

apps/api/src/app.ts        # AppDeps += verificationService; register the two routes
apps/api/src/server.ts     # build the verification service; bind it as BOTH the routes'
                           #   service AND signup's VerificationTrigger
```

## Key decisions (recorded in DECISIONS.md)

- **Token:** spec 02 `generateToken()` (32-byte CSPRNG, base64url); persist only
  `hashToken(raw)` (SHA-256). Raw exists ONLY in the link `{APP_URL}/verify-email?token=`;
  never logged, stored, or returned.
- **Lifetime:** 24h (`expires_at` set at issue).
- **Single-use / no TOCTOU:** consume is a conditional `UPDATE ... WHERE used_at IS NULL
  AND expires_at > now() RETURNING user_id`; 0 rows ⇒ not verified here. Never read-then-write.
- **Idempotent / double-click:** if the conditional update finds nothing but the token's
  user is already verified ⇒ benign `already_verified`; else `invalid`. Garbage/expired/
  used all ⇒ `invalid` (no 500).
- **Most-recent-wins:** on (re)issue, mark the user's prior unused tokens `used_at=now()`
  in the same tx, so an old link can't also verify.
- **Anti-enumeration resend:** `resendVerification` returns the SAME generic success for
  existing-unverified, already-verified, and unknown emails; email sent ONLY for
  existing-unverified. Parity asserted by test.
- **Rate limit:** in-memory fixed-window per-email (≤3/hour); over-limit ⇒ no send, same
  generic response. Per-process (single-instance v1); a shared store is deferred to 16.
- **EmailSender port:** real `resendEmailSender` (fetch → `https://api.resend.com/emails`)
  bound only when `RESEND_API_KEY` present; otherwise `consoleEmailSender` logs
  "verification email skipped (no RESEND_API_KEY)" WITH the recipient but NEVER the
  link/token. Send failure never hard-fails signup (best-effort, sanitized log).
- **Verify-link target:** link → SPA route `/verify-email?token=` (spec 06), which calls
  `POST /auth/verify-email`. Post-verify destination = login (05/06 own the redirect).
- **anti-IDOR:** verify accepts only the opaque `token`; the user is derived from the
  hash-matched row — never a client-supplied id. `email_verification_tokens` has no
  `org_id` (reached via the user FK); the user flip resolves `org_id` server-side.

## Guard test (RALPH §2f, 03/04/05)

A test proving the verification token is persisted ONLY as a hash and the raw never lands
in the DB: issue → extract the raw token from the captured email link → assert the stored
`token_hash === sha256(raw)` and `!== raw`; the live store test queries the row and
confirms no column holds the raw token. Plus a log-spy test: the raw token never appears
in any logged string.

## Verification

`pnpm build && lint && type-check && test` green; Resend mocked in unit tests (no real
send). Live store integration env-gated on `DATABASE_URL` (Docker up — run green once).
A real Resend send needs a verified sender domain (human/DNS step) — record
`LIVE-VERIFICATION-PENDING` behind `RESEND_API_KEY`.
