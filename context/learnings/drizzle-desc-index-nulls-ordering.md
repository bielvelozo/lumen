---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/01-app-db-drizzle/spec]]"
created: 2026-06-18
---
# Drizzle `.desc()` emits `DESC NULLS LAST`, but Postgres bare `DESC` is `NULLS FIRST`

When porting a `CREATE INDEX ... (col DESC)` from raw DDL to Drizzle, a naive
`index('x').on(table.col.desc())` does NOT round-trip exactly: Drizzle generates
`col DESC NULLS LAST`, whereas PostgreSQL's bare `DESC` defaults to `NULLS FIRST`.
For a faithful port you must write `table.col.desc().nullsFirst()` so the emitted
SQL is `DESC NULLS FIRST`, matching the DDL. (`ASC` is symmetric: bare `ASC` is
`NULLS LAST`, which is also Drizzle's default — so ascending indexes round-trip
without help.)

## Context

Found porting `db/schema.sql` to Drizzle in spec 01. The two DESC indexes
(`idx_session_org_updated` on `chat_sessions(org_id, updated_at DESC)` and
`idx_log_org_created` on `function_call_logs(org_id, created_at DESC)`) initially
generated `DESC NULLS LAST`. Both ordered columns are `NOT NULL`, so the NULL
ordering is functionally irrelevant *here* — but a strict diff against the DDL
oracle still flagged it, and on a nullable column it would be a real semantic
difference (which rows sort first). The diff oracle (`db/schema.sql`) catches this;
trusting Drizzle's default would have silently drifted.

## How to Apply

- Porting a `DESC` index from DDL? Use `.desc().nullsFirst()`, not bare `.desc()`.
  The ordering methods chain on the index column proxy.
- Always diff drizzle-kit's generated migration SQL against the source DDL
  clause-by-clause before committing — Drizzle's defaults (NULLS ordering, unnamed
  constraint names, `DEFAULT '[]'::jsonb` vs `'[]'`) differ from hand-written DDL in
  small ways that only a clause-level comparison surfaces.
