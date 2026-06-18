---
feature: monorepo-scaffold
spec: "[[spec]]"
created: 2026-06-17
---
# Monorepo Scaffold — Plan

**For this spec:** `[[spec]]`

## Approach

Stand up a pnpm + Turborepo monorepo with three workspaces — `apps/web` (Vite +
React SPA), `apps/api` (Fastify service), `packages/shared` (typed contracts + Zod)
— governed by one root toolchain. The whole workspace is ESM (`"type": "module"`)
to avoid CJS/ESM friction between Fastify (Node), Vite (browser), and the shared
package. A single base `tsconfig` (`strict: true`, `moduleResolution: bundler`) is
extended per package; one flat ESLint config and one Prettier config apply
workspace-wide. Turborepo wires `build`, `lint`, `type-check`, `test`, `dev`
pipelines with `dependsOn: ["^build"]` so `packages/shared` builds before its
consumers.

`packages/shared` is the spine: it exports a Zod-based **env validator**
(`parseEnv`/`loadEnv`) and at least one shared **DTO** (the `/health` response
contract) consumed by both apps — proving the typed boundary works without
duplication. The API validates `process.env` against the shared schema at startup
and exits with a readable message naming the missing var (fail fast). The web app
renders a single blank themed page that imports the design-system CSS once, proving
the asset pipeline — no Router/Query/feature wiring (that is spec 06).

Local infra is a root `docker-compose.yml` with pinned `postgres:16-alpine` and
`mysql:8.0`, named volumes, non-default-safe host ports, and healthchecks, wired to
the URLs documented in `.env.example`. Docker here is **dev-only**; production
images are spec 16.

## Architecture

```
business-assistant/
  package.json            # root, private, workspaces scripts -> turbo
  pnpm-workspace.yaml     # apps/*, packages/*
  turbo.json              # build/lint/type-check/test/dev pipelines
  tsconfig.base.json      # strict, bundler resolution, shared compiler opts
  eslint.config.js        # flat config, TS + react hooks, workspace-wide
  .prettierrc.json        # one formatter config
  .nvmrc                  # 22.16.0
  docker-compose.yml      # postgres:16-alpine + mysql:8.0, healthchecks
  .env.example            # every var the project will need, documented
  packages/shared/        # @lumen/shared — types + Zod env + DTOs
  apps/api/               # @lumen/api — Fastify, GET /health, env validation
  apps/web/               # @lumen/web — Vite + React + TS, themed blank page
```

Data flow for the typed contract: `packages/shared` exports `HealthResponse`
(type) + `healthResponseSchema` (Zod) + `envSchema`/`parseEnv`. `apps/api` imports
the schema to shape its `/health` payload and the env validator at boot;
`apps/web` imports the same `HealthResponse` type for a typed fetch helper. One
edit to the shared schema type-checks across both apps.

## File Structure

- `package.json` — root private package; scripts delegate to `turbo run ...`.
- `pnpm-workspace.yaml` — declares `apps/*` and `packages/*`.
- `turbo.json` — task graph + caching; `dev` is non-cached/persistent.
- `tsconfig.base.json` — `strict`, `noUncheckedIndexedAccess`, `bundler` resolution.
- `eslint.config.js` + `.prettierrc.json` + `.prettierignore` — lint/format.
- `.nvmrc`, `.gitignore` (extend) — toolchain pin + ignore rules.
- `docker-compose.yml` — local Postgres + MySQL with healthchecks.
- `.env.example` — documents DATABASE_URL, MYSQL_URL, secrets, deferred keys.
- `packages/shared/{package.json,tsconfig.json,src/index.ts,src/env.ts,src/dto.ts,src/*.test.ts}`.
- `apps/api/{package.json,tsconfig.json,src/server.ts,src/app.ts,src/env.ts,src/*.test.ts}`.
- `apps/web/{package.json,tsconfig.json,tsconfig.node.json,vite.config.ts,index.html,src/main.tsx,src/App.tsx,src/*.test.tsx,src/setup-test.ts}`.

## Phase Ordering

1. **Root toolchain** — workspace manifests, turbo, tsconfig base, lint/format,
   .nvmrc, gitignore. (no app code yet)
2. **packages/shared** — env validator + DTO + Zod, with a Vitest test. Built first
   because both apps depend on it.
3. **apps/api** — Fastify app factory + `/health` + startup env validation + tests
   (health route via `app.inject`, env validator rejects missing var).
4. **apps/web** — Vite/React baseline, themed blank page importing design CSS, one
   RTL/Vitest test.
5. **Local infra** — docker-compose + `.env.example`; bring up + healthcheck.
6. **Verify + ship** — `pnpm install/build/lint/type-check/test` all green.

## Risks / Open Decisions

- Turbo + pnpm internal-package resolution: consume `@lumen/shared` via the
  `workspace:*` protocol and export from source through the package `exports` map
  so apps don't need a separate prebuild in dev; ensure `build`/`type-check` still
  resolve. Verify cross-import type-checks before closing.
- ESM everywhere: Fastify + Vitest + Vite all ESM; use `tsx` for the API dev/run so
  no emit step is needed at dev time.
- Pinned image/port drift: pin exact tags, expose host ports from `.env.example`,
  add healthchecks. (Decision recorded in `DECISIONS.md` → `00-scaffold`.)
- Scope creep: hard-stop at "empty but runnable"; no Router/Query/design-system
  port (spec 06), no Drizzle (spec 01), no prod Docker/CI (spec 16).
