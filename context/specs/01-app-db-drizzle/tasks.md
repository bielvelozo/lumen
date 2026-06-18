---
feature: app-db-drizzle
plan: "[[plan]]"
spec: "[[spec]]"
created: 2026-06-18
---
# App DB & Drizzle Schema — Tasks

**For this plan:** `[[plan]]`

A box is checked ONLY after its slice is implemented AND committed.

## Phase 1: Shared contracts

### Task 1: Cross-boundary DB primitives in packages/shared

- [x] `packages/shared/src/db-contracts.ts` — enum unions (`UserRole`, `ConnectionStatus`, `MessageRole`, `LogStatus`) as `as const` tuples + string unions; `ExposedColumn = { name: string; type: string }`
- [x] Re-export from `src/index.ts`; unit test asserts the enum tuples match the DDL values/order
- [x] Commit

## Phase 2: Deps + bytea + schema

### Task 2: Drizzle schema (1:1 port of db/schema.sql)

- [x] Add deps to `apps/api`: `drizzle-orm`, `pg`, `dotenv` (deps) + `drizzle-kit`, `@types/pg` (dev) + `db:*` scripts
- [x] `src/db/bytea.ts` — `customType<{ data: Buffer }>` emitting `bytea`
- [x] `src/db/schema.ts` — 4 `pgEnum` + 11 `pgTable` with every column/type/null/default, all FK `ON DELETE` actions (incl. 3 SET NULL + 1 NO ACTION), uniques, named indexes (incl. 2 `DESC`); inline invariant-1 comments
- [x] Commit

## Phase 3: Config + client + ops scripts

### Task 3: drizzle.config + client + migrate + seed

- [x] `drizzle.config.ts` (schema path, out `./drizzle`, dialect postgresql, `DATABASE_URL`)
- [x] `src/db/client.ts` — `makeDb(databaseUrl)` via `drizzle-orm/node-postgres`
- [x] `src/db/migrate.ts` — programmatic migrator, fail-fast on missing `DATABASE_URL`; first migration `CREATE EXTENSION IF NOT EXISTS pgcrypto`
- [x] `src/db/seed.ts` — idempotent demo org + owner user (+ optional stub connections, placeholder bytea)
- [x] Commit

## Phase 4: Generate + verify migration

### Task 4: Generate and diff against the DDL oracle

- [x] `pnpm db:generate` produces SQL migration(s) under `apps/api/drizzle/`
- [x] Diff emitted SQL vs `db/schema.sql` clause-by-clause: 4 enums (values/order), 11 tables, all FK delete actions, 2 composite + 1 global UNIQUE, all named indexes incl. the 2 `DESC`, all emitted defaults; absent `uq_dbconn_org`/`uq_aiconn_org`
- [x] Commit the generated migration

## Phase 5: Tests + live DB run

### Task 5: Structural test + env-gated live migrate smoke

- [x] `src/db/schema.test.ts` always-on: enum value/order; bytea cols `getSQLType()==='bytea'` + NOT NULL; jsonb shape + default; 4 denormalized `org_id` NOT NULL; 3 SET NULL + 1 NO ACTION FK actions; absence of uq indexes
- [x] Env-gated (`DATABASE_URL`) live smoke: create throwaway DB, migrate, assert 4 enums + 11 tables + a DESC index, drop DB
- [x] Run the live smoke green against Docker Postgres (record `LIVE-VERIFICATION-PENDING`)
- [x] `pnpm db:migrate` applies clean + idempotent on local Docker; `pnpm db:seed` twice = no dup
- [x] Commit

## Phase 6: Gates + ship

### Task 6: Green gates + mark Shipped

- [x] `pnpm build` / `pnpm lint` / `pnpm type-check` / `pnpm test` all green
- [x] Record `db:generate` / `db:migrate` / `db:seed` in `context/learnings/commands-catalog.md`
- [x] Mark spec 01 Shipped (MOC token + frontmatter) — atomic final commit + learnings
