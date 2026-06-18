---
status: in-progress
feature: secrets-and-tokens
created: 2026-06-18
---
# Secrets & Tokens — Implementation Plan

Implements `[[spec]]`. A single, narrow, dependency-injected `crypto` module in
`apps/api` exposing three capabilities consumed by every later auth/connection
spec: authenticated **encryption at rest** (AES-256-GCM) for `bytea` secrets,
**disposable-token** generate/hash/verify utilities, and **password hashing**
(argon2id). No endpoints, no flows — just the primitives, done correctly once and
audited as a unit. Honors constitution invariants 2 (secrets encrypted at rest,
key outside the DB) and 4 (disposable tokens stored hashed).

## Architecture

```
packages/shared/src/
  crypto-contracts.ts     # cross-spec data shapes: DisposableToken, TokenRecordState,
                          #   TokenFreshness (types/Zod only — no Node crypto here)
  env.ts                  # tighten SECRETS_ENCRYPTION_KEY: base64 -> exactly 32 bytes
                          #   (pure-JS byte-length, no Buffer / Node global)

apps/api/src/crypto/
  errors.ts               # CryptoError + safe reason-code union (no secret bytes ever)
  keyring.ts              # load master key(s) from env into a key_id -> Buffer map;
                          #   validate 32-byte length; defense-in-depth re-check
  encryption.ts           # createEncryptionService(keyring): encrypt / decrypt
                          #   blob = version(1) | key_id(1) | iv(12) | tag(16) | ciphertext
  tokens.ts               # generateToken / hashToken / verifyTokenHash + tokenFreshness
  passwords.ts            # hashPassword / verifyPassword (argon2id via @node-rs/argon2)
  index.ts                # barrel + createCryptoModule(env) — reads key ONCE at startup
  *.test.ts               # Vitest: round-trip, tamper, IV-uniqueness, hash/verify,
                          #   freshness, password hash/verify, no-secret-in-error
```

Only files under `apps/api/src/crypto/` import `node:crypto` or `@node-rs/argon2`.
Every other module (specs 03/04/05/08/11) consumes `createCryptoModule(...)`.

## Key decisions (recorded in `DECISIONS.md`)

- **Encryption:** AES-256-GCM, fresh 12-byte random IV per call, 16-byte auth tag.
  Self-describing blob `version(1B) ‖ key_id(1B) ‖ iv(12B) ‖ auth_tag(16B) ‖ ct`
  so a future key rotation can decrypt old blobs while writing under a new key
  without a format change. `decrypt` verifies the tag — tamper/truncation throws,
  never returns partial plaintext.
- **Master key:** 32 bytes from `SECRETS_ENCRYPTION_KEY` (base64), validated in the
  shared env schema (fail-fast at boot) AND re-checked in the keyring loader. Held
  in a `Map<key_id, Buffer>` keyring (active id `0` in v1) so rotation is config,
  not code. Never logged, never persisted.
- **Disposable tokens:** `generateToken()` → 32 CSPRNG bytes, base64url (raw exists
  only here). `hashToken` = SHA-256 hex (fast hash is correct — input is already
  high-entropy, no salt/work-factor needed). `verifyTokenHash` constant-time via
  `timingSafeEqual`. `tokenFreshness(state, now)` is the pure single-use/expiry
  decision (`revoked` > `used` > `expired` > `ok`); callers (04/05) own row writes.
- **Passwords:** argon2id via **`@node-rs/argon2`** (prebuilt napi binaries — no
  node-gyp, reliable on Windows dev + Linux deploy), OWASP baseline m=19456 KiB,
  t=2, p=1. PHC string stored in `users.password_hash`. bcrypt fallback only if the
  napi binary proves unworkable in the deploy target (recorded if so).
- **No secret in logs:** `CryptoError` carries only a reason code
  (`MALFORMED_BLOB` / `DECRYPT_AUTH_FAILED` / `UNKNOWN_KEY_ID` / `KEY_INVALID`) —
  never plaintext, ciphertext, keys, tokens, or passwords.

## Verification

`pnpm build && pnpm lint && pnpm type-check && pnpm test` green. New Vitest suites
cover every Success Criterion. No live external resource needed — this spec is pure
crypto, so nothing is env-gated/skipped. Security-flagged spec (Gate 1): run
`/security-review` on the diff and resolve findings before marking Shipped.

## Open-question defaults (taken; recorded in `DECISIONS.md`)

- Master-key source → validated env var now, keyring abstraction so a secrets
  manager can slot in at spec 16 without touching call sites.
- argon2id params → OWASP baseline (m=19456, t=2, p=1); tune to the VPS at spec 16.
- Disposable-token raw length/encoding → 32 bytes, base64url.
- Refresh-token family/lineage id → deferred; this module exposes only
  generate/hash/verify, 05 owns lineage if it adopts reuse detection.
