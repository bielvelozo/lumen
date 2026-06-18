---
status: shipped
feature: introspection-and-exposure
created: 2026-06-17
shipped: 2026-06-18
---
# Schema Introspection & Exposure Allow-List — Spec

**Status:** Draft
**Scope:** The second half of Flow 2. Once a `db_connections` row is `active` ([[../08-db-connection-create-and-test/spec|08]]), introspect the customer's MySQL **read-only** over `information_schema` to discover tables, each table's columns (name + type), and foreign keys; then let the owner choose which tables to expose and which discovered relationships to approve. Persist the choices into `exposed_tables` and `exposed_relationships`, enforcing the least-privilege allow-list that [[../12-query-function-registry/spec|12]] is later constrained to.

## Context

Flow 2 connects the customer's own MySQL database to the assistant. [[../08-db-connection-create-and-test/spec|08]] handled the first half: collect non-secret config, encrypt the read-only password, run a connection test, and flip `db_connections.status` to `active`. This spec is the second half: turn a working connection into a curated **allow-list** of tables and relationships the assistant is permitted to touch.

The allow-list is the least-privilege boundary **at the data level** — invariant 3 of the [[../../constitution|Constitution]] in concrete form. The model never emits free SQL and never sees the full schema; it only operates over the tables and relationships the owner *explicitly* exposed here. Everything the registry ([[../12-query-function-registry/spec|12]]) and the chat ([[../13-chat-orchestrator/spec|13]]) are allowed to read flows from the rows this spec writes — and from nothing else. This makes exposure a critical data-access gate, governed by [[../../rules/data-access-review-gates|data-access-review-gates]].

The target tables already exist in `db/schema.sql`: `exposed_tables` (with a `columns` jsonb snapshot of the introspection and `UNIQUE(db_connection_id, table_name)`) and `exposed_relationships` (each row a discovered FK, with `UNIQUE(db_connection_id, relationship_name)`). Both carry `org_id` denormalized on purpose, so every read and write filters directly by tenant. The schema even records the application-level invariant this spec must enforce: a relationship cannot be activated unless both its `from_table` and `to_table` are already exposed on the **same** connection.

## Problem Statement

After [[../08-db-connection-create-and-test/spec|08]], the backend has a live, read-only handle to the customer's MySQL but no idea what is in it, and the assistant has nothing it is allowed to query. We need to (a) discover the real schema by reading `information_schema` (read-only, no data rows, no writes), (b) surface tables, columns, and foreign keys so the owner can make an informed least-privilege choice, and (c) durably persist that choice as the allow-list — table by table, relationship by relationship — with the same-connection exposure invariant enforced before any relationship goes live. All of it scoped by `org_id` from the JWT, never from the request.

## Non-Goals

- The parameterized query functions that consume the allow-list — that is [[../12-query-function-registry/spec|12]].
- The chat orchestrator / streaming / message persistence — [[../13-chat-orchestrator/spec|13]].
- The frontend for browsing the schema and toggling exposure — [[../10-connect-db-ui/spec|10]]. This spec ships the backend API and persistence only.
- Connecting the AI / Claude key — [[../11-ai-connection-claude/spec|11]].
- The first half of Flow 2 (consent, onboarding script, create/test, encryption, status transitions) — [[../07-db-connection-consent-and-script/spec|07]] and [[../08-db-connection-create-and-test/spec|08]].
- **Column-level exposure.** v1 exposes at the **table** level plus an introspected column snapshot; per-column allow/deny is v2 (locked out by the [[../../constitution|Constitution]] → *Scope guardrails*).
- Caching or copying the client schema. Introspection runs live against MySQL each time it is requested; no schema cache in v1.

## Constraints

- **Read-only introspection.** Discovery queries `information_schema` only (`TABLES`, `COLUMNS`, `KEY_COLUMN_USAGE` / `REFERENTIAL_CONSTRAINTS`), scoped to the connection's `database_name`. No reads of customer data rows, no DDL, no writes — consistent with invariant 5 ([[../../constitution|Constitution]]) and the read-only credential created in [[../07-db-connection-consent-and-script/spec|07]]. The MySQL credential is read-only by construction; introspection must not assume or require anything more.
- **Connection must be `active`.** Introspection and exposure are only allowed on a `db_connections` row whose `status = 'active'`. A `pending`/`failed` connection returns a clear error, not a partial result.
- **`org_id` from the JWT, never the client (anti-IDOR).** Every introspection call and every exposure read/write resolves the connection and its rows by `org_id` taken from the verified JWT claims, never from a body/query/path/header value. A `db_connection_id` supplied by the client is only honored after confirming it belongs to the caller's `org_id`. Governed by [[../../rules/data-access-review-gates|data-access-review-gates]].
- **`org_id` denormalized on write.** When inserting into `exposed_tables` / `exposed_relationships`, set `org_id` from the JWT-resolved connection — matching the denormalization the schema mandates for tenant isolation.
- **Column snapshot shape.** `exposed_tables.columns` stores the introspected columns as a jsonb array of `[{"name": "...", "type": "..."}, ...]` (the `type` being the MySQL column type as reported by `information_schema`). This is a point-in-time snapshot taken at exposure; it is not kept live in sync with the customer's DB in v1.
- **Relationship direction is explicit and from the FK.** Each `exposed_relationships` row is a *discovered* FK, never a hand-authored join: `from_table`/`from_column` = the child side that **holds** the FK; `to_table`/`to_column` = the referenced **parent**. The backend derives these from `information_schema`, not from model or client input.
- **Same-connection exposure invariant (hard gate).** A relationship may be persisted/activated only if **both** `from_table` and `to_table` already exist in `exposed_tables` for the **same** `db_connection_id`. This is enforced in the application before insert; violating it returns a domain error, never a half-written row.
- **Uniqueness honored.** Respect `UNIQUE(db_connection_id, table_name)` and `UNIQUE(db_connection_id, relationship_name)`; re-exposing is idempotent (upsert/no-op), not a 500. `relationship_name` is a stable identifier the registry will reference (e.g. `orders_products`); generate it deterministically from the FK so re-introspection is stable.
- **Un-exposing is supported and safe.** Removing a table from the allow-list must also remove (or block while present) any `exposed_relationships` that reference it, so the invariant can never be left violated. Decide and document the order so no dangling relationship survives an un-expose.
- **Sanitized errors.** Introspection failures (unreachable DB, dropped permission, timeout) surface a sanitized message and never leak raw schema internals or connection secrets into logs/responses — consistent with `last_error` being sanitized in `db_connections`.

## User Stories / Scenarios

1. **Discover the schema.** Owner with an `active` connection requests introspection; the backend reads `information_schema` read-only and returns the list of tables, each with its columns (name + type) and the foreign keys among them — without reading a single data row.
2. **Expose chosen tables.** Owner selects a subset of discovered tables; each becomes an `exposed_tables` row scoped to their `org_id`, with the column snapshot persisted as jsonb. Tables not chosen remain invisible to the assistant.
3. **Approve a relationship.** Owner approves a discovered FK between two already-exposed tables; it is saved as an `exposed_relationships` row (child→parent direction, named) and becomes available for JOINs in [[../12-query-function-registry/spec|12]].
4. **Relationship blocked by missing table.** Owner tries to approve a FK whose parent table is not exposed; the backend refuses with a clear domain error explaining both endpoints must be exposed first — no partial write.
5. **Un-expose a table.** Owner removes a previously exposed table; any relationship touching it is removed/blocked in the same operation so no dangling relationship remains, and the assistant immediately loses access to that table.
6. **Cross-tenant attempt fails.** A request references a `db_connection_id` belonging to another org; because resolution is by JWT `org_id`, it resolves to nothing and is rejected — no introspection, no exposure, no leak.
7. **Idempotent re-exposure.** Owner re-runs exposure on a table already exposed; the operation upserts (refreshes the column snapshot) without duplicating rows or erroring on the unique constraint.

## Success Criteria

- Introspection runs read-only over `information_schema` for the connection's `database_name` and returns tables, columns (name + type), and FKs; verified to issue no data-row reads and no writes against the client MySQL.
- Introspection and exposure both reject any connection not in `status = 'active'` with a clear, sanitized error.
- Exposing tables writes `exposed_tables` rows with `org_id` from the JWT, the column snapshot as `[{"name","type"}]` jsonb, and respects `UNIQUE(db_connection_id, table_name)` (re-exposure is idempotent).
- Approving relationships writes `exposed_relationships` rows with correct child→parent `from_*`/`to_*` derived from the FK, a deterministic `relationship_name`, `org_id` from the JWT, and respects `UNIQUE(db_connection_id, relationship_name)`.
- The same-connection exposure invariant is enforced: approving a relationship whose `from_table` or `to_table` is not in `exposed_tables` of that connection fails with a domain error and writes nothing.
- Un-exposing a table never leaves a dangling `exposed_relationships` row; the post-condition (no relationship references a non-exposed table) holds after every operation.
- Every read and write is scoped by JWT-derived `org_id`; a cross-tenant `db_connection_id` resolves to nothing. Verified by a test that a second org cannot introspect or expose against another org's connection.
- The persisted allow-list is exactly the set [[../12-query-function-registry/spec|12]] reads from — nothing in the registry can reach a table or relationship absent from these tables.
- Tests cover: read-only introspection shape, table exposure + idempotency, relationship approval, the invariant rejection, un-expose cascade, and the anti-IDOR scoping.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Introspection accidentally reads data rows or issues a write, breaking the read-only invariant | Restrict discovery to `information_schema` queries only; assert in tests that no statement targets a customer table or mutates anything; rely on the read-only credential as the backstop |
| A relationship row is written referencing a non-exposed table, silently widening the allow-list | Enforce the same-connection exposure invariant in the application *before* insert, inside the same transaction; reject with a domain error; cover with a test that asserts zero rows written on failure |
| Un-exposing a table leaves a dangling relationship that still permits a JOIN | Make un-expose remove/guard dependent relationships in one transaction; add a post-condition test that no relationship references a missing table |
| `org_id` taken from a client-supplied `db_connection_id` instead of the JWT (IDOR) | Resolve the connection by JWT `org_id`; treat client ids as filters confirmed against that scope, never as the source of truth — per [[../../rules/data-access-review-gates|data-access-review-gates]] |
| Non-deterministic `relationship_name` causes duplicates or churn on re-introspection | Derive `relationship_name` deterministically from the FK endpoints so re-introspection maps to the same unique key and upserts cleanly |
| Snapshot column types drift from the live DB after exposure | Document that `columns` is a point-in-time snapshot (no live sync in v1); re-running exposure refreshes it; the live read path in `12` is still bounded by the allow-list regardless |
| Introspection error leaks raw schema/secret detail into logs or the response | Sanitize all error messages (mirror `last_error`); never log connection secrets or raw `information_schema` dumps |

## Open Questions

- [NEEDS CLARIFICATION: API surface shape — is introspection a synchronous read endpoint returning the discovered schema, with separate write endpoints for exposing tables/relationships, or a single "save exposure" submission that takes the owner's chosen set? Resolve alongside [[../10-connect-db-ui/spec|10]].]
- [NEEDS CLARIFICATION: exact un-expose semantics — cascade-delete dependent relationships automatically, or block the un-expose until the owner removes the relationships first? Default lean: cascade within the same transaction, surfacing what was removed.]
- [NEEDS CLARIFICATION: how composite (multi-column) foreign keys are represented, given `exposed_relationships` carries a single `from_column`/`to_column` pair — skip composite FKs in v1, or model them as one row per column pair? Default lean: surface single-column FKs in v1 and flag composites as unsupported.]
- [NEEDS CLARIFICATION: how `relationship_name` is generated deterministically and kept human-readable (e.g. `from_table__to_table`) while staying unique within a connection when two FKs share the same pair of tables.]
- [NEEDS CLARIFICATION: whether re-introspecting after the customer's schema changed (a previously exposed table/column dropped) should flag drift to the owner or silently keep the stale snapshot until re-exposed.]
