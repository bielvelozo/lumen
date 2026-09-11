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

## How to Apply

- Add a Vitest `setupFiles` entry (or `globalSetup`) in `apps/api` that loads the root `.env` with `dotenv` (never overriding already-set vars), so live tests run automatically whenever Docker is up.
- Alternatively document the exact command (`dotenv -e ../../.env -- pnpm test`) in the commands catalog and make the release checklist call it out.
- Treat "N skipped" in the local test summary as a signal, not noise.
