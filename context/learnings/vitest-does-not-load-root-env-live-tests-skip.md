---
tags:
  - learning
  - gotcha
related:
  - "[[api-server-must-load-dotenv]]"
  - "[[vitest-skipif-body-still-evaluated]]"
created: 2026-09-05
---
# Vitest never loads the root `.env`, so every env-gated "live" test silently skips locally too

The DB-facing suites are gated with `describe.skipIf(!process.env.MYSQL_URL)` / `DATABASE_URL`. Vitest does not read the repo-root `.env` (only `server.ts`, `migrate.ts` and `seed.ts` load it via dotenv), so with Docker up and `.env` fully filled, `pnpm test` still reports **10 files / 38 tests skipped** — the same as CI. The green run gives a false sense that the live paths were exercised.

## Context

Observed on 2026-09-05 while running the full suite as a baseline for the end-to-end client test (`[[../reports/2026-09-05-teste-funcional-cliente]]`). The `LIVE-VERIFICATION-PENDING` ledger in `DECISIONS.md` assumes these run "against local Docker before release", which only happens if someone exports the variables by hand.

**Fixed on 2026-09-11** by `apps/api/vitest.config.ts` + `src/setup-test-env.ts`: the root `.env` is loaded before collection (without overriding a real shell export), and the API suite went from 44 skipped to 2 — only the two credit-spending Claude live tests remain gated. Vite had the mirror problem (it looks for `.env` next to the app, so the root `VITE_API_URL` was ignored and the client silently used its default); `envDir` now points at the repo root.

## How to Apply

- Treat "N skipped" in the local test summary as a signal, not noise — that number hid every DB-facing assertion in the repo.
- Loading `.env` into the test process also arms anything gated on a paid key: `ANTHROPIC_API_KEY` filled in `.env` turns on the live Claude validator test and spends credits. Keep it empty in subscription mode.
- A monorepo with ONE root `.env` has to tell every tool where it is: the server (dotenv preload), Vitest (setupFiles), and Vite (`envDir`) each resolve it separately.
