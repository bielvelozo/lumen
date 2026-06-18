---
status: shipped
feature: email-verification
created: 2026-06-17
shipped: 2026-06-18
---
# Email Verification — Spec

**Status:** Shipped
**Scope:** Flow 1's email-verification slice — issue a single-use, hashed, expiring verification token on signup and on resend, email the **raw** token as a link via Resend, and verify it through an endpoint that hashes the link token, checks expiry/single-use, and flips `users.email_verified` to true. Built on the token helpers from `[[../02-secrets-and-tokens/spec|02]]` and called from `[[../03-signup-and-org/spec|03]]`.

## Context

Signup (`[[../03-signup-and-org/spec|03]]`) creates an `organizations` row plus an `owner` user with `email_verified = false`. Before that account is trusted — before it can connect a client DB, an AI key, or run the chat — we must prove the person controls the email address. This spec owns that proof.

The mechanism is constrained by `[[../../constitution|Constitution]]` invariant 4 (and `HANDOFF.md` invariant 4): **disposable tokens are stored as a HASH, never raw.** The raw, high-entropy token exists in exactly one place — the link inside the email — and `email_verification_tokens.token_hash` holds only its SHA-256 digest. Verification re-hashes the token from the URL and looks it up by hash. This is identical in shape to how `refresh_tokens` and password-reset tokens work, so the hashing/compare/expiry primitives live in `[[../02-secrets-and-tokens/spec|02]]` and are reused here rather than reinvented.

The `email_verification_tokens` table already exists in `db/schema.sql`: `user_id` (FK, cascade), `token_hash text`, `expires_at timestamptz`, `used_at timestamptz` (single-use marker), `created_at`, indexed on `token_hash` and `user_id`. This spec wires the issue → email → consume lifecycle over that table and the `users.email_verified` / `users.verified_at` columns.

Transactional email goes through **Resend** (`[[../../constitution|Constitution]]` → *Scope guardrails*; `HANDOFF.md`). Email here is transactional only — no marketing, no lists.

## Problem Statement

A freshly signed-up owner has an unverified account and an email we have not confirmed they control. We need to (a) mint a verification token whose raw value only ever leaves the system inside one email link, (b) store only its hash plus an expiry, (c) deliver the link through Resend, (d) consume the link exactly once to mark the email verified, and (e) let the user request a fresh link — all without leaking whether a given email is registered (anti-enumeration) and without letting an attacker brute-force or replay tokens.

## Non-Goals

- **Login, JWT issuance, sessions, refresh tokens** — `[[../05-login-jwt-sessions/spec|05]]`. This spec does not log the user in; it only sets `email_verified`. What a verified-but-unauthenticated user lands on is `05`/`[[../06-web-shell-and-auth-ui/spec|06]]`'s call.
- **Password-reset email.** It reuses this exact issue/hash/expire/consume pattern and Resend, but it is owned where login/recovery lives (`[[../05-login-jwt-sessions/spec|05]]`). Out of scope here beyond noting the shared shape; if `02` exposes the hashing/token helpers generically (it should), `05` consumes the same helpers — we do not duplicate them.
- **Signup itself** (form, org/user creation, password hashing, duplicate-email handling) — `[[../03-signup-and-org/spec|03]]`. This spec exposes an `issueVerification(user)` entry point that `03` calls post-creation.
- **Token/crypto primitives** — `[[../02-secrets-and-tokens/spec|02]]` owns `generateToken`, `hashToken`, and the constant-time compare/lookup helpers. This spec consumes them.
- **Frontend** — the verify landing page, the "check your inbox" screen, and the resend button UI are `[[../06-web-shell-and-auth-ui/spec|06]]`. This spec ships the API endpoints and the email send only.
- **Secrets-manager wiring for the Resend API key** — the key is a plain env var here (it is our key, not a per-tenant BYO secret), validated at startup per `[[../00-monorepo-scaffold/spec|00]]`. Not the encrypted-`bytea` path, which is for client/tenant secrets.

## Constraints

- **Hash, never raw (invariant 4).** Generate a high-entropy raw token (≥ 32 bytes from a CSPRNG, URL-safe encoded) via `[[../02-secrets-and-tokens/spec|02]]`'s `generateToken`. Persist only `sha256(raw)` in `token_hash`. The raw token appears only in the email link and is never logged, never stored, never returned in an API response body.
- **Single-use.** A token is consumed exactly once: verification sets `used_at = now()` in the **same** transaction/atomic update that flips the user, so a replayed link finds `used_at` already set and is rejected. Use a conditional update (`... WHERE used_at IS NULL AND expires_at > now()`) and treat "0 rows affected" as failure — do not read-then-write (TOCTOU).
- **Expiry.** `expires_at` is set at issue time. Default lifetime **24h** `[NEEDS CLARIFICATION]`. An expired token is rejected with the same generic outcome as an invalid/used one; the user can resend.
- **Lookup by hash only.** The verify endpoint hashes the URL token and selects on `token_hash` (indexed). It never trusts a `user_id` or token id from the client (anti-IDOR; invariant 1). The user to flip is derived from the matched row's `user_id`.
- **org_id scoping (invariant 1).** All writes to `users` resolve `org_id` from the token's owning user row, never from client input. (`email_verification_tokens` has no `org_id` column by design — it is reached only via the user FK.)
- **Anti-enumeration on resend.** The resend endpoint returns the **same** success-shaped response whether or not the email exists or is already verified. It never reveals account existence or verification state through status code, body, or timing-observable branching.
- **Rate limiting.** Resend is rate-limited per-email and/or per-IP (e.g. ≤ N requests / window, `[NEEDS CLARIFICATION]` exact N/window). Exceeding the limit still returns the generic success shape (or a generic 429) — never a message that distinguishes a real from a non-existent account.
- **Single live token per user (recommended).** On (re)issue, invalidate prior unused tokens for that user (mark used/expired) or rely on most-recent-wins so an old link cannot also verify. Decide and document `[NEEDS CLARIFICATION]`.
- **Resend, transactional only.** One verification template (`[NEEDS CLARIFICATION: localization — Portuguese first per product audience? plus brand "Lumen" sender identity]`). Send failures are handled (see scenarios) and surfaced as a retryable state, not a hard signup failure.
- **No secret in logs/Sentry.** The raw token must never reach `function_call_logs`, application logs, or Sentry (`[[../15-observability-sentry/spec|15]]`). Log token *events* (issued/verified/expired) by user/token id, never the raw value.
- **Idempotent verify on already-verified.** Hitting verify for an already-verified user (e.g. double-click) yields a clean success/"already verified" outcome, not a 500.

## User Stories / Scenarios

1. **Issue on signup.** A new owner finishes signup (`03`). The system mints a raw token, stores its hash + `expires_at`, and Resend delivers an email with a link like `{APP_URL}/verify-email?token={raw}`. The DB holds only the hash.
2. **Happy-path verify.** The user clicks the link. The verify endpoint hashes `token`, finds the matching unused, unexpired row, and in one atomic update sets `users.email_verified = true`, `users.verified_at = now()`, and the token's `used_at = now()`. Outcome: verified.
3. **Replay / double-click.** The user clicks the (now consumed) link again. The conditional update affects 0 rows; the endpoint responds with a generic "invalid or already used" outcome (or, if the user is already verified, a benign "already verified") — never a 500, never a second flip.
4. **Expired link.** The user clicks after `expires_at`. Rejected with the generic invalid-link outcome and a prompt to request a new link.
5. **Resend (account exists, unverified).** The user requests a new link. Rate limit permitting, prior unused tokens are invalidated, a fresh token is issued and emailed. Response is the generic success shape.
6. **Resend (no such account / already verified).** Same generic success-shaped response, **no** email sent (or a benign no-op), nothing that reveals which case occurred.
7. **Resend rate-limited.** Beyond the threshold, no new email is sent; response stays generic (success-shaped or generic 429). No enumeration signal.
8. **Resend/email-send fails.** Resend API errors are caught; signup itself does not hard-fail on a send error — the account exists and the user can resend. The failure is logged (sanitized) and observable, with no raw token in the log.
9. **Tampered / garbage token.** A malformed or non-matching `token` hashes to nothing in the table → generic invalid-link outcome. No stack trace leaked.

## Success Criteria

- After signup, exactly one `email_verification_tokens` row exists for the user with a non-null `token_hash` and `expires_at`; `used_at` is null; the raw token appears **only** in the delivered email link and nowhere in the DB, logs, or responses.
- `token_hash` equals `sha256(rawTokenFromLink)` computed with `[[../02-secrets-and-tokens/spec|02]]`'s helper — verified by an automated test that issues, extracts the link token, and confirms the stored hash matches.
- Clicking a valid, unexpired, unused link sets `email_verified = true` + `verified_at` and the token's `used_at` in a single atomic operation; a second click flips nothing and returns a non-error outcome.
- An expired token and an unknown/garbage token both yield the same generic invalid-link outcome; neither 500s.
- Resend returns an identical success-shaped response for existing-unverified, already-verified, and non-existent emails; a test asserts the three responses are indistinguishable (status, body, and no email sent in the latter two).
- Rate limiting blocks excess resend attempts without leaking account state.
- Vitest covers: issue→hash equality, happy verify, replay (0-row), expiry, anti-enumeration parity across the three resend cases, and rate-limit rejection. Resend is mocked in tests (no real email sent in CI).
- No raw token ever reaches application logs or Sentry (asserted by a log-spy test or a lint/review check).

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Read-then-write verify creates a TOCTOU window allowing a token to verify twice under concurrency | Single conditional `UPDATE ... WHERE used_at IS NULL AND expires_at > now()`; treat affected-rows = 0 as failure; never branch on a prior `SELECT` |
| User enumeration via resend (different response/timing for real vs. fake email) | Identical success-shaped response in all cases; do the same amount of work (or constant-ish) regardless; rate-limit generically; covered by a parity test |
| Raw token leaks into logs, Sentry, or a response body | Helpers from `02` keep raw token local; log only ids/events; explicit log-spy test; review checklist item |
| Resend send failure silently strands a user with no email and a "verified later" account they can't progress | Don't hard-fail signup on send error; surface a retryable state; always-available resend; sanitized failure log + Sentry breadcrumb (no token) |
| Token brute-force / guessing | ≥ 32-byte CSPRNG token (huge keyspace) + short expiry + single-use + resend rate limit make online guessing infeasible |
| Old, still-unused link remains valid after a resend (two live tokens) | On reissue, invalidate prior unused tokens (or most-recent-wins); documented and tested |
| Verify endpoint trusts a client-supplied `user_id`/token id (IDOR) | Endpoint accepts only the opaque `token`; user is derived from the hash-matched row; no id from client is read (invariant 1) |

## Open Questions

- [NEEDS CLARIFICATION: token lifetime] — default **24h**; confirm with product. Shorter (e.g. 1h) tightens security but increases resend friction.
- [NEEDS CLARIFICATION: resend rate-limit policy] — exact N and window, and whether keyed per-email, per-IP, or both. Lean: per-email ≤ 3 / hour plus a per-IP ceiling.
- [NEEDS CLARIFICATION: multiple live tokens] — invalidate prior unused tokens on reissue (most-recent-only) vs. allow several concurrently valid. Lean: invalidate prior, most-recent-wins.
- [NEEDS CLARIFICATION: email template ownership & localization] — Portuguese-first (product audience is BR SMB owners) with the "Lumen" sender identity; where the HTML/text template lives (`apps/api` vs. a shared template module) and whether a design pass is needed in `[[../06-web-shell-and-auth-ui/spec|06]]`.
- [NEEDS CLARIFICATION: verify-link target] — does the link hit the API directly (`GET /api/verify-email`) which then redirects into the SPA, or land on the SPA route (`/verify-email`) which calls the API? Affects where the redirect/landing UX lives (coordinate with `[[../06-web-shell-and-auth-ui/spec|06]]`).
- [NEEDS CLARIFICATION: post-verify destination] — after a successful verify, redirect to login (`[[../05-login-jwt-sessions/spec|05]]`) or auto-establish a session? Default: redirect to login; auto-login is `05`'s decision.
