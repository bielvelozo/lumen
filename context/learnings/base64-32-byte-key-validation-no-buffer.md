---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/02-secrets-and-tokens/spec]]"
created: 2026-06-18
---
# Validating a 32-byte base64 key in `@lumen/shared` without `Buffer`

The shared env schema must fail-fast when `SECRETS_ENCRYPTION_KEY` is not a 32-byte
key, but `packages/shared` is deliberately **free of Node globals** (no `Buffer`,
`tsconfig` has no `"types": ["node"]`) so it stays portable. Solution: validate the
**decoded byte length with pure string math** instead of decoding:

```ts
function base64ByteLength(v: string): number | null {
  if (v.length === 0 || v.length % 4 !== 0) return null;       // require padding
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;          // base64 alphabet, '=' only at end
  const pad = v.endsWith('==') ? 2 : v.endsWith('=') ? 1 : 0;
  return (v.length / 4) * 3 - pad;
}
// .refine(v => base64ByteLength(v) === 32)
```

The non-obvious trap: a 32-byte key is **44 base64 chars ending in exactly one `=`**.
`'A'.repeat(44)` (no padding) decodes to **33 bytes**, not 32 — the old test fixtures
used that and silently became invalid once the length check landed. The correct
zero-key fixture is `'A'.repeat(43) + '='`.

## Context

Hit in spec 02 tightening `packages/shared/src/env.ts` and updating the env test
fixtures in both `apps/api` and `packages/shared`. The authoritative 32-byte check
also lives (defense-in-depth) in `apps/api/src/crypto/keyring.ts`, where `Buffer` IS
available and decodes the already-validated value.

## How to Apply

- Keep `packages/shared` Node-global-free: validate shapes with string/Zod logic, do
  the actual `Buffer`/`node:crypto` decode in `apps/api`.
- A standard-base64 32-byte value is 44 chars with one trailing `=`. When you need a
  valid-but-fake key fixture, use `'A'.repeat(43) + '='` (decodes to 32 zero bytes),
  never `'A'.repeat(44)` (33 bytes).
- Generate real keys with `openssl rand -base64 32`.
