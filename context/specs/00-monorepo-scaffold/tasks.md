---
feature: monorepo-scaffold
plan: "[[plan]]"
spec: "[[spec]]"
created: 2026-06-17
---
# Monorepo Scaffold — Tasks

**For this plan:** `[[plan]]`

A box is checked ONLY after its slice is implemented AND committed.

## Phase 1: Root toolchain

### Task 1: Workspace manifests + orchestration

- [x] Root `package.json` (private, `type: module`, `packageManager: pnpm@10.33.0`, `engines.node >=22 <23`, scripts delegating to turbo)
- [x] `pnpm-workspace.yaml` (`apps/*`, `packages/*`)
- [x] `turbo.json` with `build` / `lint` / `type-check` / `test` / `dev` pipelines + `dependsOn: ["^build"]`
- [x] `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `moduleResolution: bundler`)
- [x] `eslint.config.js` (flat, TS) + `.prettierrc.json` + `.prettierignore`
- [x] `.nvmrc` (22.16.0); extend `.gitignore` if needed
- [x] Commit

## Phase 2: packages/shared

### Task 2: Typed contracts + Zod env validator

- [x] `packages/shared` package.json + tsconfig (exports map, workspace-consumable)
- [x] `src/env.ts` — Zod `envSchema` + `parseEnv()` that throws a readable error naming missing/invalid vars
- [x] `src/dto.ts` — `healthResponseSchema` (Zod) + inferred `HealthResponse` type
- [x] `src/index.ts` barrel export
- [x] `src/env.test.ts` + `src/dto.test.ts` (Vitest) — validator rejects missing var; schema parses ok payload
- [x] Commit

## Phase 3: apps/api

### Task 3: Fastify service + /health + startup env validation

- [x] `apps/api` package.json (Fastify, tsx, vitest) + tsconfig extending base
- [x] `src/env.ts` — load + validate env via `@lumen/shared` parseEnv at startup (fail fast)
- [x] `src/app.ts` — Fastify app factory with `GET /health` -> `200 {status:"ok"}` typed by shared DTO
- [x] `src/server.ts` — boot: validate env, listen
- [x] `src/app.test.ts` — `app.inject` GET /health returns 200 + ok; `src/env.test.ts` — missing var fails fast
- [x] Commit

## Phase 4: apps/web

### Task 4: Vite + React baseline themed page

- [x] `apps/web` package.json (vite, react, vitest, @testing-library/react, jsdom) + tsconfigs + vite.config.ts
- [x] `index.html` + `src/main.tsx` + `src/App.tsx` — blank themed page importing design-system CSS + AppBackground blobs
- [x] Import `HealthResponse` type from `@lumen/shared` in a typed `fetchHealth` helper (proves cross-app shared use)
- [x] `src/App.test.tsx` (RTL) renders without crashing; `src/setup-test.ts`
- [x] Commit

## Phase 5: Local infra

### Task 5: Docker Compose + env example

- [x] `docker-compose.yml` — `postgres:16-alpine` + `mysql:8.0`, named volumes, ports, healthchecks
- [x] `.env.example` — every documented var (DB URLs, secrets, deferred keys)
- [x] `docker compose up -d` brings up healthy Postgres + MySQL (verified once — both `healthy`)
- [x] Commit

## Phase 6: Verify + ship

### Task 6: Green gates + mark Shipped

- [x] `pnpm install` (one lockfile committed)
- [x] `pnpm build` green across all workspaces
- [x] `pnpm lint` green
- [x] `pnpm type-check` green (`tsc --noEmit`, strict)
- [x] `pnpm test` green (>=1 Vitest test per package: shared 6, api 3, web 1)
- [ ] Mark spec 00 Shipped (MOC token + frontmatter) — atomic final commit
