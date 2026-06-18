---
status: in-progress
feature: query-function-registry
created: 2026-06-18
---
# Query Function Registry — Tasks

A box is checked ONLY after its slice is implemented AND committed.

## 1 — Shared contracts: closed enums + refusal codes + function param schemas
- [x] `query-registry-contracts.ts`: `AGGREGATES`/`TIME_GRAINS`/`FILTER_OPS` closed sets;
      `QUERY_FUNCTION_NAMES`; `REFUSAL_CODES`; `aggregateOverTimeParamsSchema` +
      `filteredAggregateParamsSchema` (strict shape, closed enums, `from<=to` refine, bound
      limit); result/refusal types. Export from index. Tests: closed enums; from>to rejected;
      unknown keys rejected; an injection string is still a *string* param (guard rejects later).

## 2 — Identifiers + allow-list accessor + guard (pure)
- [x] `identifiers.ts`: `quoteIdent` asserts `^[A-Za-z0-9_]+$` then backtick-escapes.
- [x] `allow-list.ts`: `AllowList` type + `makeDrizzleAllowListAccessor(db).getByOrg(orgId)`
      reading the ACTIVE `db_connections` + its `exposed_tables`(col→type) + `exposed_relationships`.
- [x] `guard.ts`: pure `guard(manifest, allowList)` → ok | typed refusal (table/column/relationship
      not exposed; type-family mismatch). Tests: membership pass/fail; injection string not a
      member → refusal; relationship must match an exposed row; cross-tenant resolves to nothing.

## 3 — Starter functions + SQL builder + registry
- [x] `sql-fragments.ts` (bucket/agg/filter, all values bound); `functions/aggregate-over-time.ts`
      + `functions/filtered-aggregate.ts` (needs + build); `registry.ts` (name→def, unknown→error).
      Tests: SQL shape (single SELECT, `?` for every value), identifiers only allow-listed+escaped,
      JOIN only from a relationship row, NO model string concatenated into SQL (the guard test).

## 4 — Executor + MySQL read-only runner
- [x] `query-runner.ts`: `QueryRunner` port + `createMysql2QueryRunner` (decrypt cred, read-only
      session, statement timeout, LIMIT). `executor.ts`: lookup→Zod→resolve→guard→type-check→build
      →assert-read-only→run→sanitized typed result. Tests (fake runner): happy path rows; unknown
      function; bad params; not-exposed; relationship-not-exposed; connection-inactive; query-failed.
- [x] LIVE end-to-end vs seeded Docker MySQL (env-gated + ledgered): both starter functions return
      exact DB-computed numbers; cross-tenant refusal.

## 5 — Gate-2 + ship
- [x] `/security-review` on the diff + mechanically re-confirm GATE-2 (i)-(iv); GUARD test present.
- [x] Full suite green: `pnpm build && lint && type-check && test`.
- [x] Record open-question defaults in `DECISIONS.md`; mark spec Shipped (MOC + frontmatter)
      atomically; capture learnings.
