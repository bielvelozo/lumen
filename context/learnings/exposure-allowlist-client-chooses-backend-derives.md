---
tags:
  - learning
  - concept
related:
  - "[[../specs/09-introspection-and-exposure/spec]]"
created: 2026-06-18
---
# The exposure allow-list takes client CHOICES (names), not client DATA

The exposure endpoint (`PUT /db-connection/exposure`) is the least-privilege data boundary
the whole query layer (specs 12/13) is bound to. The Gate-2-safe shape: the client submits
ONLY names — `{ tableNames[], relationshipNames[] }` — and the backend re-introspects the
live schema and **derives every persisted value itself** (the column snapshot, the FK
from/to direction). The client cannot inject a fake table, a fake column, or a fake
relationship to widen what the assistant may read.

Concretely, `saveExposure`:
1. resolves the org's connection from the JWT (no client connection id at all);
2. re-introspects live (active-gated);
3. validates each chosen name is a member of the introspection (`Map.get(name)`), rejecting
   `unknown_table` / `unknown_relationship` — the name is NEVER interpolated into SQL or used
   as an identifier, only looked up;
4. enforces the same-connection invariant (a relationship needs BOTH endpoints in the chosen
   table set) BEFORE any write;
5. persists rows built from the introspection object (`table.columns`, `rel.fromColumn`, …),
   via parameterized Drizzle, all in one transaction.

The persistence is a **whole-set replace in one transaction** (delete all tables+
relationships for the connection, then re-insert). That makes un-expose structural: omitting
a table drops it and any relationship referencing it — no dangling relationship can survive,
and re-saving is idempotent (no UNIQUE collisions).

## Context

Spec 09 (`apps/api/src/db-connection/exposure.service.ts` + `exposure.store.ts`). The
introspection SQL is parameterized and scoped to the connection's OWN `database_name` (from
the trusted `db_connections` row), read-only over `information_schema` only.

## How to Apply

- When a client selects from a server-known set, accept the SELECTION (ids/names) and
  re-derive the underlying data server-side; never trust client-supplied data for the
  selected items. This is the anti-IDOR-of-content rule that complements org-from-JWT.
- A validated name is for membership lookup, not for building SQL (value or identifier).
- For an allow-list, prefer whole-set-replace-in-a-transaction over incremental add/remove —
  it makes cascade/idempotency structural. Specs 12/13 read ONLY from these rows.
