---
tags:
  - learning
  - reference
related:
  - "[[../constitution|Constitution]]"
  - "[[../specs/00-monorepo-scaffold/spec]]"
  - "[[../specs/01-app-db-drizzle/spec]]"
created: 2026-06-15
---
# Commands catalog

Real, copy-pasteable commands for the Lumen monorepo. Kept current as the build
matures. Stack: pnpm + Turborepo monorepo (`apps/web` Vite SPA, `apps/api` Fastify,
`packages/shared`), Vitest, TypeScript strict, Drizzle + Postgres.

## Context

Scaffolded by [[../specs/00-monorepo-scaffold/spec|spec 00]]; DB layer by
[[../specs/01-app-db-drizzle/spec|spec 01]]. Run everything with **pnpm** (pinned via
`packageManager`). Node is pinned in `.nvmrc` (22.16.0) / `engines`.

## Root workspace (Turborepo — run from repo root)

```bash
pnpm install        # install all workspaces (one pnpm-lock.yaml)
pnpm dev            # run every package's dev task (Vite + Fastify watch)
pnpm build          # build all (web -> dist; api/shared -> tsc --noEmit)
pnpm lint           # eslint across all packages
pnpm type-check     # tsc --noEmit (strict) across all packages
pnpm test           # vitest run across all packages
pnpm format         # prettier --write .
pnpm format:check   # prettier --check .
```

## Local infrastructure (Docker)

```bash
docker compose up -d     # start Postgres (5432) + MySQL (3306), both healthchecked
docker compose ps        # check health
docker compose down      # stop (add -v to also drop the named volumes/data)
```

Connection URLs live in `.env` (copy from `.env.example`). `.env` is gitignored.

## Database (Drizzle — apps/api)

```bash
# from repo root, filtered to the api workspace:
pnpm --filter @lumen/api db:generate   # drizzle-kit generate -> apps/api/drizzle/*.sql (commit it)
pnpm --filter @lumen/api db:migrate    # apply pending migrations (programmatic migrator); idempotent
pnpm --filter @lumen/api db:seed       # idempotent demo tenant (placeholder bytea; dev only)
```

- `db:migrate` / `db:seed` read `DATABASE_URL` from the repo-root `.env` (via dotenv;
  production/CI provides it directly). Both are safe to re-run.
- The committed first migration also runs `CREATE EXTENSION IF NOT EXISTS pgcrypto`
  defensively (for `gen_random_uuid()` on PG < 13; PG >= 13 is the target).

## Running a single package's tests

```bash
pnpm --filter @lumen/api test          # just the api tests
# Live DB integration tests are env-gated on DATABASE_URL and SKIP when absent.
# To exercise them against local Docker Postgres:
DATABASE_URL='postgres://postgres:postgres@localhost:5432/lumen' \
  pnpm --filter @lumen/api exec vitest run src/db/schema.test.ts
```

## How to Apply

Keep this current: when a spec adds a script or a run path, record it here in the
same iteration (it is the canonical "how do I run X" reference).
