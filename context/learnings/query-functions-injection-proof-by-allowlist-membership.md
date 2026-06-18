---
tags:
  - learning
  - concept
related:
  - "[[../specs/12-query-function-registry/spec]]"
  - "[[../specs/09-introspection-and-exposure/spec]]"
created: 2026-06-18
---
# Query functions are injection-proof BY CONSTRUCTION — identifiers resolved by membership, not escaping

The constitutional heart (spec 12) makes "the model never emits SQL" real with one technique,
not a pile of escaping: **the model supplies strings; the backend resolves identifiers by
allow-list MEMBERSHIP, never by concatenation.** A column param like `total; DROP TABLE orders`
isn't escaped into safety — it's simply *not a member* of the org's `exposed_tables` snapshot,
so the guard refuses it (`column_not_exposed`) **before any SQL is built**. The malicious string
never reaches the builder. Escaping (`quoteIdent`: `^[A-Za-z0-9_]+$` assert + backtick-double) is
only the last-line backstop over names that already passed membership.

The layered defense, in order:

1. **Zod** validates SHAPE: aggregates/grains/filter-ops are CLOSED enums; table/column/
   relationship are plain bounded strings (no authority yet).
2. **Guard** runs BEFORE build: every table ∈ `exposed_tables`, every column ∈ that table's
   snapshot (+ coarse type family), every join matches an `exposed_relationships` row — all for
   the org's ACTIVE connection resolved by JWT `org_id`. A miss = typed refusal, no query.
3. **Builder** emits a single `SELECT`: every VALUE is a bound `?`; every IDENTIFIER comes only
   from the guard-validated set, `quoteIdent`-escaped; aggregates/grains/the `LIMIT` are backend
   constants. A JOIN's columns come solely from the matched relationship row.
4. **Backstops:** `assertReadOnlySelect` (`^select\b`, no `;`), `multipleStatements: false`,
   read-only credential, statement timeout.

## The non-obvious trap: the guard and the builder must select the SAME row by the SAME predicate

The Gate-2 review caught a latent desync (F2/F3): the guard matched a relationship by
`name + table-pair`, but the builder re-fetched the row by `name` only. Harmless under v1 (one
connection per org + per-connection unique relationship names), but if two same-named
relationships ever coexisted, the guard could approve pair A while the builder emitted the JOIN
from pair B. **Fix: the builder uses the identical predicate (name + orientation-independent
pair).** Rule: whenever a guard validates "row X is allowed" and a builder then *uses* row X,
both must resolve X by the exact same key — or return the matched row from the guard so there's
one source of truth.

## Also recorded

- **Identifier charset is a hard wall, fail-closed (F1).** `^[A-Za-z0-9_]+$` rejects real-but-odd
  MySQL names (hyphens, dots). Such a name can be *exposed* (introspection stores raw names) but
  is unqueryable in v1 → sanitized `query_failed`. Safe, but the limitation should surface at the
  exposure boundary ([[../specs/09-introspection-and-exposure/spec|09]]) — tracked, non-blocking.
- The module is pure: `(functionName, rawParams, orgId)` + injected `AllowListAccessor` +
  `QueryRunner` → rows or typed refusal. Spec 13 wires it to Claude tool-calls; it never imports
  the AI SDK. Org scoping is the same `getAuth`-only seam as [[org-id-only-from-requireauth-getauth]].
