---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/00-monorepo-scaffold/spec]]"
created: 2026-06-17
---
# pnpm 10 blocks dependency build scripts by default (esbuild breaks silently)

pnpm 10 does NOT run a dependency's install/postinstall scripts unless that
dependency is explicitly allow-listed. After the first `pnpm install` it prints a
yellow `Ignored build scripts: esbuild@...` warning and moves on green — but
esbuild's postinstall (which places its platform binary) never ran. Anything built
on esbuild (Vite, Vitest, tsx) can then fail at runtime with a missing-binary
error even though `pnpm install` "succeeded". The fix is to add the package to
`pnpm.onlyBuiltDependencies` in the root `package.json` and reinstall:

```jsonc
// package.json (repo root)
"pnpm": { "onlyBuiltDependencies": ["esbuild"] }
```

## Context

Discovered scaffolding spec 00 (pnpm + Turborepo monorepo). The very first
`pnpm install` resolved everything and exited 0, but flagged
`Ignored build scripts: esbuild@0.21.5, esbuild@0.28.1`. Because the whole
toolchain (Vite build, Vitest, tsx-run for the API) sits on esbuild, this is a
latent failure: green install, red builds. Adding `onlyBuiltDependencies: ["esbuild"]`
and reinstalling ran the postinstalls (`postinstall: Done`) and every gate
(build/lint/type-check/test) then passed.

## How to Apply

- Treat any `Ignored build scripts: <pkg>` line from `pnpm install` as actionable,
  not cosmetic. If the package is part of the build/test toolchain, add it to
  `pnpm.onlyBuiltDependencies` and reinstall.
- When a NEW dependency that ships native binaries or a real postinstall lands in a
  later spec (e.g. an argon2/bcrypt native module, a DB driver with a build step),
  expect the same warning and allow-list it deliberately — never blanket-approve.
- The allow-list is the secure default: it means you opt into each package that may
  run code at install time, instead of letting all of them run arbitrary scripts.
