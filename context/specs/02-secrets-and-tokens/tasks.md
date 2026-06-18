---
status: in-progress
feature: secrets-and-tokens
created: 2026-06-18
---
# Secrets & Tokens — Tasks

A box is checked ONLY after its slice is implemented AND committed. Order respects
dependencies: contracts/env first, then the crypto primitives, then wiring + review.

## 1 — Shared contracts & env hardening
- [ ] `packages/shared/src/crypto-contracts.ts`: `DisposableToken`,
      `TokenRecordState`, `TokenFreshness` (+ `TokenFreshnessReason`) shapes; export
      from `index.ts`.
- [ ] `packages/shared/src/env.ts`: tighten `SECRETS_ENCRYPTION_KEY` to a base64
      string that decodes to **exactly 32 bytes** (pure-JS byte-length — no Buffer);
      clear message. Update env test fixtures (`apps/api`, `packages/shared`) to a
      valid 32-byte base64 key; add a wrong-length-key failure case.

## 2 — Crypto module: errors + keyring
- [ ] `apps/api/src/crypto/errors.ts`: `CryptoError` + reason-code union; message is
      the code only (never secret bytes).
- [ ] `apps/api/src/crypto/keyring.ts`: `createKeyring(masterKeyBase64, activeKeyId=0)`
      → `Map<key_id, Buffer>`; 32-byte re-validation; `get`/`tryGet`/`activeKeyId`.
- [ ] `keyring.test.ts`: valid key builds; wrong-length throws `KEY_INVALID`; error
      message contains no key bytes; unknown key id handling.

## 3 — Encryption at rest (AES-256-GCM)
- [ ] `apps/api/src/crypto/encryption.ts`: `createEncryptionService(keyring)` →
      `encrypt(string): Buffer`, `decrypt(Buffer): string`; blob layout
      `version|key_id|iv|tag|ciphertext`; tag verified on decrypt.
- [ ] `encryption.test.ts`: round-trip (incl. empty + unicode); IV uniqueness (same
      plaintext twice → different blobs); tamper rejection (flip ct/iv/tag → throws);
      truncation/wrong-version → `MALFORMED_BLOB`; unknown key id → `UNKNOWN_KEY_ID`;
      thrown error carries no plaintext.

## 4 — Disposable tokens
- [ ] `apps/api/src/crypto/tokens.ts`: `generateToken` (≥32 CSPRNG bytes, base64url),
      `hashToken` (SHA-256 hex), `verifyTokenHash` (`timingSafeEqual`),
      `tokenFreshness(state, now)`.
- [ ] `tokens.test.ts`: raw entropy/length; raw→hash determinism; hash is 64-hex;
      verify match/mismatch; freshness ok/expired/used/revoked precedence.

## 5 — Password hashing (argon2id)
- [ ] Add `@node-rs/argon2` to `apps/api` deps; `pnpm install`; confirm the prebuilt
      binary loads on this host (runtime smoke). Fallback to bcrypt only if it
      doesn't — record in `DECISIONS.md`.
- [ ] `apps/api/src/crypto/passwords.ts`: `hashPassword` (argon2id PHC, OWASP params),
      `verifyPassword` (boolean; malformed hash → false, never throws plaintext).
- [ ] `passwords.test.ts`: PHC is `$argon2id$`; verify right=true/wrong=false; same
      password twice → different hashes (per-hash salt); malformed hash → false.

## 6 — Module wiring + gates
- [ ] `apps/api/src/crypto/index.ts`: barrel + `createCryptoModule(env)` (reads master
      key ONCE). Confirm no module outside `crypto/` imports `node:crypto`/argon2.
- [ ] Full suite green: `pnpm build && pnpm lint && pnpm type-check && pnpm test`.
- [ ] Gate 1 security: run `/security-review` on the diff; resolve findings.
- [ ] Record open-question defaults + argon2 decision in `DECISIONS.md`; mark spec
      Shipped (MOC token + frontmatter) atomically; capture learnings.
