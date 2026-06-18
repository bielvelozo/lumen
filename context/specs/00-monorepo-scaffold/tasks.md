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

- [ ] Root `package.json` (private, `type: module`, `packageManager: pnpm@10.33.0`, `engines.node >=22 <23`, scripts delegating to turbo)
- [ ] `pnpm-workspace.yaml` (`apps/*`, `packages/*`)
- [ ] `turbo.json` with `build` / `lint` / `type-check` / `test` / `dev` pipelines + `dependsOn: ["^build"]`
- [ ] `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `moduleResolution: bundler`)
- [ ] `eslint.config.js` (flat, TS) + `.prettierrc.json` + `.prettierignore`
- [ ] `.nvmrc` (22.16.0); extend `.gitignore` if needed
- [ ] Commit

## Phase 2: packages/shared

### Task 2: Typed contracts + Zod env validator

- [ ] `packages/shared` package.json + tsconfig (exports map, workspace-consumable)
- [ ] `src/env.ts` — Zod `envSchema` + `parseEnv()` that throws a readable error naming missing/invalid vars
- [ ] `src/dto.ts` — `healthResponseSchema` (Zod) + inferred `HealthResponse` type
- [ ] `src/index.ts` barrel export
- [ ] `src/env.test.ts` + `src/dto.test.ts` (Vitest) — validator rejects missing var; schema parses ok payload
- [ ] Commit

## Phase 3: apps/api

### Task 3: Fastify service + /health + startup env validation

- [ ] `apps/api` package.json (Fastify, tsx, vitest) + tsconfig extending base
- [ ] `src/env.ts` — load + validate env via `@lumen/shared` parseEnv at startup (fail fast)
- [ ] `src/app.ts` — Fastify app factory with `GET /health` -> `200 {status:"ok"}` typed by shared DTO
- [ ] `src/server.ts` — boot: validate env, listen
- [ ] `src/app.test.ts` — `app.inject` GET /health returns 200 + ok; `src/env.test.ts` — missing var fails fast
- [ ] Commit

## Phase 4: apps/web

### Task 4: Vite + React baseline themed page

- [ ] `apps/web` package.json (vite, react, vitest, @testing-library/react, jsdom) + tsconfigs + vite.config.ts
- [ ] `index.html` + `src/main.tsx` + `src/App.tsx` — blank themed page importing design-system CSS + AppBackground blobs
- [ ] Import `HealthResponse` type from `@lumen/shared` in a typed `fetchHealth` helper (proves cross-app shared use)
- [ ] `src/App.test.tsx` (RTL) renders without crashing; `src/setup-test.ts`
- [ ] Commit

## Phase 5: Local infra

### Task 5: Docker Compose + env example

- [ ] `docker-compose.yml` — `postgres:16-alpine` + `mysql:8.0`, named volumes, ports, healthchecks
- [ ] `.env.example` — every documented var (DB URLs, secrets, deferred keys)
- [ ] `docker compose up -d` brings up healthy Postgres + MySQL (verified once)
- [ ] Commit

## Phase 6: Verify + ship

### Task 6: Green gates + mark Shipped

- [ ] `pnpm install` (one lockfile committed)
- [ ] `pnpm build` green across all workspaces
- [ ] `pnpm lint` green
- [ ] `pnpm type-check` green (`tsc --noEmit`, strict)
- [ ] `pnpm test` green (>=1 Vitest test per package)
- [ ] Mark spec 00 Shipped (MOC token + frontmatter) — atomic final commit
