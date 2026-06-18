---
tags:
  - learning
  - concept
related:
  - "[[../specs/00-monorepo-scaffold/spec]]"
  - "[[../conventions/locked-stack-decisions]]"
created: 2026-06-17
---
# `@lumen/shared` is consumed as TypeScript source (no build step), on purpose

`packages/shared` exports its TypeScript source directly — `package.json` `exports`
and `types` both point at `./src/index.ts`, and there is no compiled `dist/`.
Consumers (`apps/api`, `apps/web`) import `@lumen/shared` and their own bundler/runner
compiles that source as part of their build: Vite bundles it for the web app, tsx
runs it for the API, and `tsc --noEmit` type-checks straight through it. This is
Turborepo's "Just-in-Time package" pattern. It is the deliberate choice over a
compiled package because it removes a prebuild dependency: dev, test, and
type-check all work without first building `shared`, which keeps the ralph loop and
local dev from breaking on a stale/absent `dist`.

## Context

Decided while scaffolding spec 00. Because `shared`'s `build` script is
`tsc --noEmit` (it validates, it does not emit), `turbo run build` prints a benign
`WARNING no output files found for task @lumen/shared#build` (and the same for
`@lumen/api#build`, which is also `tsc --noEmit`). That warning is expected, not a
defect — only `@lumen/web#build` (Vite) emits a `dist/`.

## How to Apply

- Put cross-boundary types and Zod request/response contracts in
  `packages/shared/src` and re-export them from `src/index.ts`. Do NOT add a
  compile-to-`dist` step or change the `exports` to point at `dist` — later specs
  rely on importing the source.
- Use extensionless relative imports inside `shared` (e.g. `export * from './env'`);
  `moduleResolution: bundler` + the consumers' tooling resolve them.
- Ignore the `no output files found` turbo warning for `tsc --noEmit` tasks. If you
  ever need a real emitted artifact for the API (e.g. spec 16 production bundle),
  introduce a bundler (tsup/esbuild) for `apps/api` rather than switching `shared`
  to a compiled package.
