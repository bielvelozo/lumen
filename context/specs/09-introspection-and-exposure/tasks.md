---
status: in-progress
feature: introspection-and-exposure
created: 2026-06-18
---
# Schema Introspection & Exposure — Tasks

A box is checked ONLY after its slice is implemented AND committed.

## 1 — Shared introspection/exposure contracts
- [x] `introspection-contracts.ts`: `IntrospectedSchema`, `saveExposureRequestSchema`
      (`{ tableNames[], relationshipNames[] }`, strict), `exposureResponseSchema`; export.
      Contract tests.

## 2 — Schema introspector (mysql2, read-only)
- [x] `schema-introspector.ts`: `SchemaIntrospector` port + mysql2 impl — query
      `information_schema` (TABLES / COLUMNS / KEY_COLUMN_USAGE) parameterized by db name;
      group FK rows by constraint → SKIP composite; `relationship_name` deterministic.
- [x] live integration (skipIf no `MYSQL_URL`): create a test DB w/ tables + single & composite
      FKs; assert tables/columns/single-FK shape + composite skipped + NO data-row reads.

## 3 — Exposure store (Drizzle) + connection id
- [x] `db-connection.store.ts`: `getByOrg` also returns the connection `id`.
- [x] `exposure.store.ts`: `getExposure(orgId, connId)`, `replaceExposure(orgId, connId,
      { tables, relationships })` atomic (delete + insert in one tx; org_id denormalized).
- [x] live integration (skipIf no `DATABASE_URL`): atomic replace, idempotent re-save,
      un-expose cascade (omit a table → its relationships gone), org-scoped + cross-tenant.

## 4 — Exposure service + routes + wiring
- [x] `exposure.service.ts`: `introspect` (active-gate + decrypt + introspect), `getExposure`,
      `saveExposure` (re-introspect → validate chosen names → same-connection invariant →
      build rows from introspection → replace). Connection resolved by JWT org only.
- [x] `exposure.route.ts`: `GET /db-connection/introspect`, `GET/PUT /db-connection/exposure`
      (requireAuth; org from getAuth; no connection id from client).
- [x] `app.ts`/`server.ts`: wire `exposureService` (introspector + crypto.decrypt + store).
- [x] tests: service (fakes) — introspect active-gate; saveExposure happy/unknown-table/
      invariant-rejection(no write)/idempotent; anti-IDOR (org from JWT). Route (inject):
      401; GET/PUT; 422 invariant; body carries no connection id.

## 5 — Gate 2 + ship
- [x] Full suite green: `pnpm build && lint && type-check && test`.
- [x] GATE 2: `/security-review` + mechanical re-confirm (no client string in SQL value/
      identifier; relationship needs both tables; org from JWT; read-only introspection;
      org_id filter on every tenant read). GUARD: cross-tenant anti-IDOR + invariant tests pass.
- [x] Record open-question defaults in `DECISIONS.md` + the two LIVE-VERIFICATION-PENDING;
      mark spec Shipped (MOC + frontmatter) atomically; capture learnings.
