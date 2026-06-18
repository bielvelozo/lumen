---
status: in-progress
feature: connect-db-ui
created: 2026-06-18
---
# Connect-DB UI — Tasks

A box is checked ONLY after its slice is implemented AND committed.

## 1 — Backend: GET /db-connection returns non-secret config
- [ ] `connection-contracts.ts`: `dbConnectionStateSchema += config` (`{ host, port,
      databaseName, username, sslEnabled } | null`; NEVER password). `db-connection.store`
      `getState` + `db-connection.service` `getState` return config. Update tests.

## 2 — Web API layer + queries + step machine
- [ ] `lib/connect-db.ts`: typed fns for consent status/terms/accept, onboarding-script,
      connection state, create+test (PUT), retest, introspect, get/save exposure (via apiFetch).
- [ ] `lib/connect-db-queries.ts`: `useConsentStatus`/`useConnectionState`/`useExposure`
      (+ query keys) and `deriveStep(consent, connection, exposure)`.
- [ ] tests: deriveStep maps each state→step; no connect-db request carries an org_id.

## 3 — Wizard container + Consent + Connect steps
- [ ] `ConnectDatabasePage.tsx` (derive step, render); `ConsentStep` (terms solid card,
      Accept after scope points, re-accept on newer version); `ConnectStep` (script panel +
      copy + credential form (shared Zod, write-only password, 400 map) + test result
      (active/failed sanitized, retry-no-password, 422 over-privileged)).
- [ ] router `/connect/database` + AppShell sidebar NavItem.
- [ ] tests: consent gate/re-accept; script copy + solid; credential validation + 400 map +
      write-only password; test result + retry; 422 over-privileged message.

## 4 — Exposure picker + Status dashboard
- [ ] `ExposureStep.tsx`: introspect → selectable tables/columns/FKs (solid); both-endpoints
      client guard (auto-deselect relationship + reason); empty-state; save → invalidate.
- [ ] `StatusDashboard.tsx`: config (no password) + status/lastTestedAt/sanitized error +
      exposure set + re-test / edit-exposure / edit-config actions.
- [ ] tests: both-endpoints guard; save-exposure invalidation; dashboard hides password;
      empty-introspection state.

## 5 — Glass guard + gates + ship
- [ ] GUARD `connect-db-glass.test.tsx`: render the connect-DB views; assert no
      `.card`/`.metric`/`.bubble`/data/reading-text under `.glass`.
- [ ] Full suite green: `pnpm build && lint && type-check && test`.
- [ ] Record open-question defaults in `DECISIONS.md`; mark spec Shipped (MOC + frontmatter)
      atomically; capture learnings.
