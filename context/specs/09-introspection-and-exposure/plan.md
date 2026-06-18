---
status: in-progress
feature: introspection-and-exposure
created: 2026-06-18
---
# Schema Introspection & Exposure Allow-List — Implementation Plan

Implements `[[spec]]` (backend; UI is spec 10). Over an **active** `db_connections` row,
introspect the customer's MySQL **read-only** (`information_schema` only) to discover
tables/columns/FKs; then persist the owner's chosen allow-list into `exposed_tables` +
`exposed_relationships`. This is the least-privilege data boundary spec 12/13 are bound to
(constitution invariant 3). **Gate-2 CRITICAL** (data-access-review-gates) + mandatory live
(introspection against Docker MySQL).

## Security design (Gate-2)

- **org from JWT only.** v1 = one connection per org, so NO connection id is accepted from
  the client; the connection is resolved by `getAuth(request).orgId`. Exposure rows get
  `org_id` + `db_connection_id` from that resolved row. A cross-tenant request resolves to
  nothing (verified by test).
- **Client chooses NAMES, backend derives the rest.** `saveExposure` takes only
  `{ tableNames[], relationshipNames[] }`. The backend re-introspects live, validates every
  chosen name exists in the introspection, and builds the persisted rows from the
  INTROSPECTION (column snapshots + FK from/to direction) — never from client input. A
  client cannot inject a fake table, column, or relationship.
- **No client/model string becomes SQL (value or identifier).** Introspection SQL is
  parameterized by `TABLE_SCHEMA = ?` (the connection's own `database_name`, from the
  trusted row — not user input). Chosen names are membership-checked against the
  introspection, never interpolated into SQL; persistence is parameterized Drizzle (names
  are text VALUES, not identifiers).
- **Same-connection exposure invariant (hard gate).** A relationship is persisted only if
  both its `from_table` and `to_table` are in the chosen table set — validated BEFORE the
  write; violation → domain error, zero rows written.
- **Read-only introspection.** Only `information_schema` (TABLES / COLUMNS /
  KEY_COLUMN_USAGE); no customer data-row reads, no writes. The read-only credential is the
  backstop.

## Architecture

```
packages/shared/src/introspection-contracts.ts
  # IntrospectedSchema { tables:[{name, columns:[{name,type}]}], relationships:[{name,
  #   fromTable, fromColumn, toTable, toColumn}] }, saveExposureRequestSchema
  #   ({ tableNames[], relationshipNames[] }, strict), exposureResponseSchema

apps/api/src/db-connection/
  schema-introspector.ts   # SchemaIntrospector port + mysql2 impl (information_schema only,
                           #   parameterized by db name; group KEY_COLUMN_USAGE → skip composite FKs;
                           #   relationship_name = `${fromTable}__${fromColumn}__${toTable}`)
  exposure.store.ts        # getExposure(orgId, connId); replaceExposure(...) atomic (delete+insert tx)
  exposure.service.ts      # introspect / getExposure / saveExposure (active-gate, validate, persist)
  exposure.route.ts        # GET /db-connection/introspect, GET/PUT /db-connection/exposure (requireAuth)
  db-connection.store.ts   # getByOrg now also returns the connection `id`
apps/api/src/app.ts/server.ts  # wire exposureService (+ introspector, crypto.decrypt)
```

## Key decisions (recorded in DECISIONS.md)

- **API surface:** `GET /db-connection/introspect` (live discovered schema), `GET
  /db-connection/exposure` (current allow-list), `PUT /db-connection/exposure` (replace the
  whole allow-list — subsumes expose/un-expose, idempotent). Default lean; coord with 10.
- **Un-expose semantics:** replace-the-whole-set in ONE transaction → omitted tables and any
  relationship referencing them are removed atomically; no dangling relationship survives.
- **Composite (multi-column) FKs:** SKIP in v1 (a constraint with >1 KEY_COLUMN_USAGE row);
  only single-column FKs are surfaced. Flagged unsupported.
- **relationship_name:** deterministic `${fromTable}__${fromColumn}__${toTable}` (stable
  across re-introspection; disambiguates multiple FKs between the same table pair).
- **Drift:** v1 keeps the point-in-time `columns` snapshot; re-running exposure refreshes it
  (no live sync, no drift flagging). The live read path (12) is bounded by the allow-list
  regardless.

## Guard / review (Gate 2)

`/security-review` + mechanical re-confirm: (i) no client/model string in SQL as value or
identifier; (ii) relationships require both tables exposed; (iii) org/connection/exposure
from JWT; (iv) introspection read-only + parameterized; no tenant read lacks an org_id
filter. GUARD test: a second org cannot introspect or expose against another org's
connection (anti-IDOR), + the same-connection invariant rejection.

## Verification

Unit (introspector fake, exposure service/store with fakes incl. invariant + anti-IDOR) +
LIVE: introspection against Docker MySQL (create a test DB with tables + single & composite
FKs → assert shape + composite skipped + no data-row reads) and exposure-store against Docker
Postgres (atomic replace, idempotent, un-expose cascade, org-scoped). `LIVE-VERIFICATION-PENDING`.
`pnpm build && lint && type-check && test` green.
