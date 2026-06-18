---
status: shipped
feature: secrets-and-tokens
created: 2026-06-17
shipped: 2026-06-18
---
# Secrets & Tokens — Spec

**Status:** Shipped
**Scope:** A foundational crypto/secrets module in `apps/api` — three pure, well-tested capabilities consumed by every later auth and connection spec: (a) authenticated **encryption at rest** for `bytea` secrets, (b) **disposable-token** generate/hash/verify utilities, and (c) **password hashing** (argon2id). No endpoints, no flows — just the primitives, done correctly once.

## Context

Three constitutional invariants converge on a single module, so it is built once, in one place, and audited as a unit (see `[[../../constitution|Constitution]]` → *Architecture principles* 2 & 4, and `[[../../rules/security-review-before-merge|security-review-before-merge]]`):

- **Invariant 2 — Secrets encrypted at rest.** The client DB password (`db_connections.encrypted_password`) and the AI API key (`ai_connections.encrypted_api_key`) are `bytea` blobs. The key that decrypts them lives **outside** the database (env / secrets manager). Postgres never sees plaintext, and encryption/decryption happen in the application, never in the DB.
- **Invariant 4 — Disposable tokens stored as hashes.** Email verification tokens (`email_verification_tokens.token_hash`) and refresh tokens (`refresh_tokens.token_hash`) are stored as a hash. The raw value exists only in the email link or the httpOnly cookie — never in the database.
- **Passwords.** `users.password_hash` holds a one-way hash (bcrypt/argon2 per the schema comment), never the raw password.

This spec depends on the scaffold (`[[../00-monorepo-scaffold/spec|00]]`) for the `apps/api` skeleton and env-validation pattern, and on the Drizzle schema (`[[../01-app-db-drizzle/spec|01]]`) for the exact `bytea` / `text` column shapes these helpers read and write. It is a hard prerequisite for `[[../03-signup-and-org/spec|03]]`, `[[../04-email-verification/spec|04]]`, `[[../05-login-jwt-sessions/spec|05]]`, `[[../08-db-connection-create-and-test/spec|08]]`, and `[[../11-ai-connection-claude/spec|11]]`. Because the diff touches secret encryption and key management, it must pass `[[../../rules/security-review-before-merge|security-review-before-merge]]` before merge.

## Problem Statement

Several upcoming specs need to encrypt a secret, hash a token, or hash a password — and each one getting crypto subtly wrong (ECB instead of GCM, a reused IV, a non-constant-time compare, a missing auth tag, a secret leaked into a log) is exactly the class of bug that becomes a credential leak. We need a single, narrow, dependency-injected `crypto` module in `apps/api` that exposes a small, hard-to-misuse API: `encrypt`/`decrypt` for at-rest secrets, `generateToken`/`hashToken`/`verifyTokenHash` for disposable tokens, and `hashPassword`/`verifyPassword` for credentials. Every consumer calls these and never touches `node:crypto` or an argon library directly.

## Non-Goals

- **No auth endpoints or session logic.** Signup, login, JWT issuance/verification, and cookie handling are `[[../03-signup-and-org/spec|03]]` and `[[../05-login-jwt-sessions/spec|05]]`. This spec does not mint, sign, or verify JWTs — only the random/hash primitives that refresh tokens are built from.
- **No email or verification flow.** Sending the link, the `/verify` route, and `used_at`/`expires_at` enforcement live in `[[../04-email-verification/spec|04]]`. Here we ship only the token primitives and a documented single-use/expiry helper shape; the calling spec owns the row-level state machine.
- **No connection flows.** Collecting, testing, or decrypting a client-DB password / AI key against a live engine is `[[../08-db-connection-create-and-test/spec|08]]` and `[[../11-ai-connection-claude/spec|11]]`. This spec only encrypts/decrypts the bytes.
- **No key-management infrastructure.** Provisioning a KMS, rotating keys on a schedule, or re-encrypting existing rows is out of scope. We make rotation *possible* (a version/key-id byte in the blob) but do not implement a rotation job.
- **No general-purpose crypto surface.** No signing, no asymmetric keys, no envelope encryption beyond what the two `bytea` columns need.

## Constraints

- **Module shape.** Lives in `apps/api/src/crypto/` (or equivalent), exposed as a small injectable service/module — no consumer imports `node:crypto`, `argon2`, or `bcrypt` directly. Pure functions where possible; the only state is the master key, read once at startup.
- **Encryption — AES-256-GCM (authenticated).** Use `node:crypto` AES-256-GCM. For each `encrypt`: generate a fresh random **12-byte IV** (never reused), produce the 16-byte auth tag, and store the blob as a self-describing layout: `version(1B) ‖ key_id(1B) ‖ iv(12B) ‖ auth_tag(16B) ‖ ciphertext`. `decrypt` parses this layout, selects the key by `key_id`, and verifies the tag — a tampered or truncated blob throws, never returns partial plaintext. The leading `version`/`key_id` bytes exist so a future key rotation can decrypt old blobs while writing new ones under a new key, **without** implementing rotation now.
- **Master key from env, outside the DB.** The 32-byte master key is read from an env var (e.g. `SECRETS_ENCRYPTION_KEY`), base64/hex-decoded, and **validated at startup** against the shared env schema (`[[../00-monorepo-scaffold/spec|00]]`): wrong length or missing → fail fast with a clear message, never a silent zero-key default. The key is never written to the database and never logged. Support a small keyring (map of `key_id → key`) so rotation is a config change, not a code change.
- **Disposable tokens.** `generateToken()` returns a high-entropy raw token from `crypto.randomBytes` (≥32 bytes, URL-safe encoding) — the only place the raw value exists. `hashToken(raw)` returns a **SHA-256** hash (fast hash is correct here: the input is already high-entropy, so it needs no salt/work-factor, unlike a password). `verifyTokenHash(raw, storedHash)` hashes and compares with **constant-time** equality (`crypto.timingSafeEqual`). Provide a documented helper/shape for single-use + expiry semantics (`used_at`, `expires_at`, `revoked_at`) that callers (`04`, `05`) apply at the row level — this module supplies the comparison and freshness check, not the table writes.
- **Password hashing — argon2id.** `hashPassword(plain)` uses **argon2id** with sensible, documented parameters (memory/iterations/parallelism), returning the self-describing PHC string stored in `users.password_hash`. `verifyPassword(plain, hash)` verifies and returns boolean (constant-time within the library). bcrypt is an acceptable fallback only if argon2 native bindings prove unworkable in the deploy target; record the decision if so. Never log the plaintext, the hash, or the password length.
- **No secret in logs, ever.** Plaintext secrets, raw tokens, passwords, the master key, and decrypted blobs must never reach logs, error messages, or Sentry. Error types thrown by this module carry only a safe reason code (e.g. `DECRYPT_AUTH_FAILED`), never the offending bytes. This complements the schema's sanitized `last_error` / `function_call_logs` columns.
- **Types & contracts.** Any shared shapes (e.g. the token-pair return type) that cross into other specs are exported through `packages/shared`; the `bytea`/`text` column types come from the Drizzle schema in `[[../01-app-db-drizzle/spec|01]]`.
- **Tested with Vitest.** Unit tests cover round-trips, tamper rejection, and timing-safe paths (see Success Criteria). No test commits a real key.

## User Stories / Scenarios

1. **Encrypt then decrypt a secret.** `encrypt("hunter2")` returns a `Buffer` suitable for a `bytea` column; `decrypt(buf)` returns exactly `"hunter2"`. The stored blob contains a fresh IV each call, so encrypting the same plaintext twice yields different bytes.
2. **Tampered ciphertext is rejected.** Flipping any byte of a stored blob (ciphertext, IV, or auth tag) makes `decrypt` **throw** with a safe error — it never returns corrupted or partial plaintext.
3. **A disposable token is single-use and unguessable.** `generateToken()` yields a raw token only the caller sees; only its `hashToken` output is persisted. On verify, `verifyTokenHash(raw, stored)` is constant-time, and the calling spec rejects a token whose row is past `expires_at` or already has `used_at`/`revoked_at` set.
4. **A password is stored one-way.** `hashPassword` produces an argon2id PHC string; `verifyPassword` returns `true` for the right password and `false` otherwise; the database never holds the plaintext, and nothing about the attempt is logged.
5. **Env guards startup.** Booting `apps/api` with `SECRETS_ENCRYPTION_KEY` missing or the wrong length exits immediately with a readable message naming the var — never boots with an insecure default key.
6. **Rotation stays open.** Because every blob carries `version`/`key_id`, a future spec can add a second key to the keyring and re-encrypt lazily; old blobs still decrypt under their original `key_id` without code changes here.

## Success Criteria

- A `crypto` module exists in `apps/api` exporting `encrypt`/`decrypt`, `generateToken`/`hashToken`/`verifyTokenHash`, and `hashPassword`/`verifyPassword`; no other module imports `node:crypto`, `argon2`, or `bcrypt` directly.
- `encrypt` uses AES-256-GCM with a fresh 12-byte IV per call and emits the `version ‖ key_id ‖ iv ‖ auth_tag ‖ ciphertext` layout; `decrypt` verifies the tag and throws on any tamper/truncation. Round-trip and tamper-rejection tests pass.
- The master key is loaded from env, validated at startup (length + presence) via the shared env schema, kept in a keyring addressable by `key_id`, and is never logged or persisted; a wrong/missing key fails boot with a clear message.
- `generateToken` produces ≥32 bytes of CSPRNG entropy; `hashToken` is SHA-256; `verifyTokenHash` uses `timingSafeEqual`. Tests prove identical raw→hash determinism and that a wrong token fails.
- `hashPassword` produces a verifiable argon2id PHC string with documented parameters; `verifyPassword` returns correct booleans; the same password hashed twice yields different hashes (per-hash salt).
- No plaintext secret, raw token, password, or master key appears in any log, thrown error message, or test snapshot; errors expose only safe reason codes.
- Vitest suite covers: encrypt/decrypt round-trip, tamper rejection, IV uniqueness, token hash/verify (match + mismatch + timing-safe), password hash/verify, and env-validation failure. All green; the change passes `/security-review`.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| IV reuse under AES-GCM (catastrophic — leaks plaintext relationships and can break integrity) | Generate a fresh `randomBytes(12)` IV inside `encrypt` on every call; never accept a caller-supplied IV; assert uniqueness across repeated encryptions in a test |
| Master key leaks via logs, error messages, Sentry, or a committed `.env` | Load key once at startup, never log it; module errors carry only reason codes; `.env` gitignored (`[[../00-monorepo-scaffold/spec|00]]`); `/security-review` per `[[../../rules/security-review-before-merge|security-review-before-merge]]` |
| Insecure default key if env is missing (silent zero/empty key) | Validate length+presence in the shared Zod env schema; fail boot loudly; no fallback default anywhere in code |
| Non-constant-time comparison enables timing attacks on token/password verification | Use `crypto.timingSafeEqual` for token-hash compares; rely on the argon2/bcrypt library's constant-time verify for passwords; cover with tests |
| Using a fast hash (or a salted slow hash) for the wrong input — passwords hashed fast, or tokens needlessly salted | Encode the rule in the API: argon2id for passwords (slow, salted), SHA-256 for already-high-entropy tokens (fast, unsalted); document why in the module |
| Tampered/truncated blob returns partial plaintext instead of failing | AES-GCM auth-tag verification in `decrypt`; strict length/layout parsing that throws before decryption on malformed input |
| `argon2` native bindings fail to build in the Docker/VPS deploy target | Pin a known-good version; if bindings are unworkable, fall back to bcrypt and record the decision; verify in the deploy image before closing `[[../16-deploy/spec|16]]` |
| Future key rotation blocked by a format that can't tell keys apart | Self-describing blob carries `version` + `key_id`; loader holds a keyring; rotation becomes a config + lazy re-encrypt, no format change |

## Open Questions

- [NEEDS CLARIFICATION: master-key source in production — a single env var (`SECRETS_ENCRYPTION_KEY`) on the VPS vs. a managed secrets manager] — default to a validated env var now, with the keyring abstraction so a secrets-manager backend can slot in later without touching call sites; lock the choice in `[[../16-deploy/spec|16]]`.
- [NEEDS CLARIFICATION: exact argon2id parameters (memory cost, time cost, parallelism) for the target VPS] — start from the OWASP-recommended baseline and tune to the deploy host's resources; record the chosen parameters as a convention once benchmarked.
- [NEEDS CLARIFICATION: disposable-token raw length and encoding] — default to 32 random bytes, base64url, unless a flow needs a shorter human-friendly code; confirm against the email-link UX in `[[../04-email-verification/spec|04]]`.
- [NEEDS CLARIFICATION: whether refresh-token rotation in `[[../05-login-jwt-sessions/spec|05]]` needs a token *family*/lineage id surfaced from this module] — defer; expose only generate/hash/verify here and let `05` own lineage if it adopts rotation-with-reuse-detection.
