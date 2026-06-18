---
status: in-progress
feature: query-function-registry
created: 2026-06-18
---
# Query Function Registry — Implementation Plan

Implements `[[spec]]` — **the constitutional heart** (invariant 2/3) and a **Gate-2 CRITICAL**
spec. A PURE backend module (no AI, no HTTP): given `(functionName, rawParams, orgId)` + injected
accessors, return rows or a typed refusal. Spec 13 consumes it; this spec does NOT import the AI
SDK.

## The boundary this spec IS (must hold mechanically)

- **The model never emits SQL or identifiers.** A function exposes only a Zod param object.
  Every table/column/relationship/aggregate/grain the model "chooses" is a **constrained
  value resolved against the allow-list** (membership lookup) or a **closed backend enum** —
  never a raw string concatenated into SQL. A malicious `total; DROP TABLE orders` simply
  isn't a member of the exposed columns → typed refusal, nothing interpolated.
- **Allow-list guard runs BEFORE SQL is built.** Every table ∈ `exposed_tables`; every column
  ∈ that table's snapshot; every join is backed by an `exposed_relationships` row — for the
  org's ACTIVE `db_connections`, resolved by JWT `org_id`. A miss = typed refusal, no query.
- **Backend builds the SQL.** Single read-only `SELECT`; bound `?` params for EVERY value;
  identifiers taken only from the validated allow-listed set, backtick-escaped AND
  charset-asserted (`^[A-Za-z0-9_]+$`). LIMIT + statement timeout. Read-only credential
  (decrypted in-app, spec 02) against the active connection.

## Architecture (all injectable / pure)

```
packages/shared/src/query-registry-contracts.ts
  AGGREGATES (sum/count/avg), TIME_GRAINS (day/week/month), FILTER_OPS (eq/gte/lte),
  QUERY_FUNCTION_NAMES, REFUSAL_CODES (not_exposed/relationship_not_exposed/
  connection_unavailable/type_mismatch/query_failed/unknown_function/invalid_params),
  the two function param schemas (SHAPE only — from<=to refine; enums closed), result types.

apps/api/src/query-registry/
  identifiers.ts     # quoteIdent: assert ^[A-Za-z0-9_]+$ then backtick-escape (belt+suspenders)
  allow-list.ts      # AllowList type {connectionId,status,tables:Map<name,Map<col,type>>,
                     #   relationships[]} + makeDrizzleAllowListAccessor(db): getByOrg(orgId)
                     #   -> active db_connections + exposed_tables + exposed_relationships
  guard.ts           # pure guard(manifest, allowList) -> ok | typed refusal (table/col/rel + type)
  sql-fragments.ts   # bucketExpr(grain,col), aggExpr(agg,col), filter fragment builders (bound)
  functions/
    aggregate-over-time.ts   # needs(params)->manifest; build(params,allowList)->{sql,params}
    filtered-aggregate.ts    # + optional second table via an exposed_relationships row only
  registry.ts        # name -> definition; getFunction(name)
  query-runner.ts    # QueryRunner port + createMysql2QueryRunner (decrypt, read-only session,
                     #   statement timeout, LIMIT) — the only DB-touching, env-gated-tested part
  executor.ts        # executeQueryFunction: lookup -> Zod -> resolve allow-list -> guard ->
                     #   type-family check -> build -> assert read-only -> run -> sanitized result
```

## Open-question defaults (recorded in DECISIONS.md)

- Needs declaration: a **typed declaration object per function** the guard reads field-by-field.
- Filters (`filtered_aggregate`): **equality + range** (`eq`/`gte`/`lte`) on exposed columns; richer later.
- Time grains: **day / week / month**, **UTC** buckets (`DATE_FORMAT`), documented.
- Type-family check: coarse from the snapshot — metric column must be numeric, date column
  must be a date/datetime type; mismatch = typed refusal.
- Ceilings: `LIMIT 1000` grouped rows + **statement timeout ~10s** per function (global v1
  default; revisit with 13). Reject params that would defeat the bound.
- Identifier quoting: allow-list membership + `^[A-Za-z0-9_]+$` assertion + backtick-escape
  (double any backtick) — triple defense so even an allow-listed name can't break out.

## Gate-2 / verification

- `/security-review` on the diff + mechanically re-confirm (i) no model string reaches SQL as
  value OR identifier; (ii) every join backed by an `exposed_relationships` row, every read over
  `exposed_tables` only; (iii) org/connection/exposed-set resolved from JWT `org_id` only;
  (iv) no function is non-parameterized / non-read-only / over-reaching.
- GUARD TEST (RALPH §2f for 12): a test asserting NO model-supplied string is concatenated into
  SQL (injection string → refusal; built SQL contains only `?` + allow-listed/escaped idents).
- Two starter functions tested end-to-end against a **seeded Docker MySQL** fixture (exact
  DB-computed numbers); cross-tenant refusal; each failure mode sanitized. Live test env-gated +
  ledgered. Full suite green.
