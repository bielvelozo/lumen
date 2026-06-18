---
tags:
  - moc
---
# Learnings — Map of Content

Atomic notes about Business Assistant's architecture, patterns, and gotchas. Categorized by tag.

Learnings here are specific to Business Assistant. Code style conventions live in `[[conventions|Conventions MOC]]`.

## `#concept` — Architecture and patterns

- [[../learnings/shared-package-consumed-as-ts-source|`@lumen/shared` is consumed as TS source (no build step)]] — JIT internal package: apps import its `src` directly; `tsc --noEmit` "no output files" turbo warning is expected (spec 00).
- [[../learnings/base64-32-byte-key-validation-no-buffer|Validate a 32-byte base64 key in `@lumen/shared` without `Buffer`]] — keep shared Node-global-free: check decoded length with pure string math; a 32-byte key is 44 chars + one `=` (`'A'.repeat(44)` is 33 bytes!) (spec 02).
- [[../learnings/signup-unique-violation-is-the-rollback-proof|Signup's duplicate-email path IS the rollback-atomicity proof]] — one tx (org→owner) + DB `UNIQUE(email)`: a duplicate naturally rolls back the org insert too; catch `23505`, return uniform 201; the same shape recurs in specs 08/11 (spec 03).

## `#reference` — Environment and commands

- [[../learnings/commands-catalog|Commands catalog]] — build/run commands as the stack matures (pre-implementation today).

## `#gotcha` — Things that tripped us up

- [[../learnings/pnpm-blocks-dependency-build-scripts|pnpm 10 blocks dependency build scripts]] — `Ignored build scripts: esbuild` warning is actionable; allow-list via `pnpm.onlyBuiltDependencies` or Vite/Vitest/tsx break at runtime (spec 00).
- [[../learnings/drizzle-desc-index-nulls-ordering|Drizzle `.desc()` emits `DESC NULLS LAST`]] — but Postgres bare `DESC` is `NULLS FIRST`; use `.desc().nullsFirst()` for a faithful DDL port; always diff generated SQL vs the DDL oracle (spec 01).
- [[../learnings/drizzle-config-cjs-no-import-meta|`drizzle.config.ts` runs as CJS]] — `import.meta` is empty there (drizzle-kit bundles it to CJS); use `process.cwd()` for paths, not `import.meta.dirname` (spec 01).
- [[../learnings/db-connection-consent-before-credential-tension|`db_connections` can't hold consent before a credential exists]] — consent and `encrypted_password NOT NULL` share one row, so "save consent first" needs a modeling decision (affects specs 07/08/10).
- [[../learnings/node-rs-argon2-const-enum-verbatim-module|`@node-rs/argon2`'s `Algorithm` enum is unusable under `verbatimModuleSyntax`]] — ambient `const enum` → TS2748; omit the `algorithm` option (default is argon2id) and pin it with a `$argon2id$` PHC test (spec 02).
