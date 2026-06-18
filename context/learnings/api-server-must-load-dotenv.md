---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/00-monorepo-scaffold/spec]]"
created: 2026-06-18
---
# The API server entrypoint must load `.env` itself — a green test suite masked that it didn't

`apps/api/src/server.ts` validates env via `loadEnv()` → `parseEnv(process.env)`, but for the whole build **nothing populated `process.env` from the repo-root `.env`** — only `db/migrate.ts` and `db/seed.ts` imported `dotenv`. So `pnpm --filter @lumen/api dev`/`start` failed env validation (`DATABASE_URL: Required …`) and exited 1: the backend would not run locally, even though every gate was "green."

## Context

Hit when first starting the backend locally after the autonomous build finished (the frontend on `:5173` was up; nothing was listening on the API's `:3001`). The Vitest suite passed because tests inject env directly rather than through `.env`, so the missing load in the runnable entrypoint went undetected. Also note: `pnpm` runs package scripts with cwd = `apps/api`, so dotenv's default cwd lookup misses the **repo-root** `.env` — the path must be resolved explicitly.

## How to Apply

- Fixed with `apps/api/src/load-env.ts` (resolves the root `.env` via `import.meta.dirname`, like `db/seed.ts`/`db/migrate.ts`) imported **first** in `server.ts`, before any env read. `dotenv` never overrides an already-set var, so production (env from the secrets manager, no `.env` file) is unaffected.
- Lesson: a passing test suite does **not** prove the app boots. Tests that inject env bypass the real `.env`-loading path. Keep env-loading in one shared preload used by the server **and** the scripts, and add at least one check that the runnable entrypoint actually starts.
