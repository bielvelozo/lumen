---
tags:
  - moc
---
# Learnings — Map of Content

Atomic notes about Business Assistant's architecture, patterns, and gotchas. Categorized by tag.

Learnings here are specific to Business Assistant. Code style conventions live in `[[conventions|Conventions MOC]]`.

## `#concept` — Architecture and patterns

- [[../learnings/shared-package-consumed-as-ts-source|`@lumen/shared` is consumed as TS source (no build step)]] — JIT internal package: apps import its `src` directly; `tsc --noEmit` "no output files" turbo warning is expected (spec 00).

## `#reference` — Environment and commands

- [[../learnings/commands-catalog|Commands catalog]] — build/run commands as the stack matures (pre-implementation today).

## `#gotcha` — Things that tripped us up

- [[../learnings/pnpm-blocks-dependency-build-scripts|pnpm 10 blocks dependency build scripts]] — `Ignored build scripts: esbuild` warning is actionable; allow-list via `pnpm.onlyBuiltDependencies` or Vite/Vitest/tsx break at runtime (spec 00).
- [[../learnings/db-connection-consent-before-credential-tension|`db_connections` can't hold consent before a credential exists]] — consent and `encrypted_password NOT NULL` share one row, so "save consent first" needs a modeling decision (affects specs 07/08/10).
