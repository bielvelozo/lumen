---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/02-secrets-and-tokens/spec]]"
created: 2026-06-18
---
# `@node-rs/argon2`'s `Algorithm` enum is unusable under `verbatimModuleSyntax`

`@node-rs/argon2` exports its `Algorithm` (and `Version`) as an **ambient `const
enum`**. The repo compiles with `verbatimModuleSyntax: true`, under which a `const
enum` from a dependency cannot be referenced as a value — `tsc` fails:

```
error TS2748: Cannot access ambient const enums when 'verbatimModuleSyntax' is enabled.
```

So `import { hash, verify, Algorithm } from '@node-rs/argon2'` then
`{ algorithm: Algorithm.Argon2id }` does not type-check. The fix that keeps the
security choice explicit-and-verified: **omit the `algorithm` option** (the library
default is already argon2id) and lock it with a unit test asserting the produced PHC
string starts with `$argon2id$`. The test is the guard against a future default
change, so we get correctness without the enum reference.

## Context

Hit in spec 02 wiring `apps/api/src/crypto/passwords.ts`. We chose `@node-rs/argon2`
over the node-gyp `argon2` package for cross-platform reliability (prebuilt napi
binaries — no compiler; verified loading + hashing on the Windows dev host). The
const-enum constraint only surfaced at `pnpm type-check`, not at runtime.

## How to Apply

- Don't reference a dependency's `const enum` members as values anywhere in this
  codebase (`verbatimModuleSyntax` forbids it). Prefer the library default, or pass
  the documented primitive value with a test/asserted constant.
- For security-critical defaults (the hash algorithm here), don't silently rely on a
  library default — pin it with a test on an observable property (`$argon2id$` PHC
  prefix) so a dependency change can't quietly weaken it.
- Re-verify the `@node-rs/argon2` prebuilt binary builds/loads in the spec-16
  Docker/Linux deploy image before closing 16.
