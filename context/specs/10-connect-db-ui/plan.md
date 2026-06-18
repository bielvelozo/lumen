---
status: in-progress
feature: connect-db-ui
created: 2026-06-18
---
# Connect-DB UI — Implementation Plan

Implements `[[spec]]`. The Flow-2 frontend in `apps/web`: a single protected route that
renders a **derived-from-server-state** wizard — consent → onboarding script + credential
form + live test → introspection + exposure picker → status dashboard. UI only: it calls
specs 07/08/09 via TanStack Query (queries + mutations that invalidate), renders all data on
solid surfaces (glass only on the shell chrome — invariant 6 RTL guard), and NEVER sends an
`org_id`/connection id (anti-IDOR).

## One small backend extension

`GET /db-connection` (spec 08) returns only `{ hasConnection, status, lastTestedAt,
lastError }`; the dashboard must show the non-secret config. Extend it to also return
`config: { host, port, databaseName, username, sslEnabled } | null` (NEVER the password).
Benign non-secret read, still org-scoped via `getAuth` — no new Gate-1 concern.

## Architecture

```
packages/shared/src/connection-contracts.ts   # dbConnectionStateSchema += config (no password)
apps/api/src/db-connection/db-connection.store.ts/.service.ts  # getState returns config

apps/web/src/lib/
  connect-db.ts            # typed endpoint fns (07/08/09): consent status/terms/accept,
                           #   onboarding-script, connection state, create+test, retest,
                           #   introspect, get/save exposure — all via apiFetch (no org_id)
  connect-db-queries.ts    # useConsentStatus / useConnectionState / useExposure (+ keys) and
                           #   deriveStep(consent, connection, exposure)
apps/web/src/routes/connect-db/
  ConnectDatabasePage.tsx  # wizard container: fetch state, derive step, render the step
  ConsentStep.tsx          # terms (07) on a solid Card; Accept enabled after scope points shown
  ConnectStep.tsx          # onboarding script (solid code panel + copy) + credential form
                           #   (shared Zod, write-only password) + test-result (active/failed,
                           #   sanitized last_error, retry without re-entering the password)
  ExposureStep.tsx         # introspect (09) → selectable tables/columns/FKs (solid);
                           #   both-endpoints client guard (UX); save → invalidate
  StatusDashboard.tsx      # config (no password) + status/lastTestedAt/sanitized error +
                           #   exposure set + re-test / edit-exposure / edit-config actions
apps/web/src/routes/AppShell.tsx  # + sidebar NavItem to /connect/database
apps/web/src/router.tsx           # + protected route /connect/database
```

## Key decisions (recorded in DECISIONS.md)

- **Route shape:** ONE parent route `/connect/database` that renders the wizard OR the
  dashboard, the step DERIVED from the connection query (no client-stored step flag; deep-link
  to a locked step is impossible — one route, derived view). Default lean.
- **Consolidated read:** the wizard keys off three queries — consent status (07), connection
  state (08, now incl. config), exposure (09). Default lean (one read per concern; all
  org-scoped, none return the password or a tenant id).
- **Introspection fetch-on-demand** when entering the exposure step; a manual "re-introspect"
  on the dashboard. Default lean.
- **Over-privileged credential:** spec 08 uses **detect-and-REJECT** (not warn-and-proceed),
  so there is no "active with warning" state — an over-privileged credential returns `422`
  on create; the credential form shows a clear "credential not read-only — re-run the
  onboarding script" error. Supersedes the spec's softer warning-banner lean.
- **Edit-config:** any saved config change re-enters the test flow; warn that a different
  database may invalidate the current exposure selection. Password stays blank/optional on
  edit (08 keeps the stored secret). Default lean.
- **Copy:** pt-BR inline, no i18n. Default lean.

## Guard / verification

GUARD (RALPH §2f, spec 10): glass-only RTL test — render the connect-DB views and assert no
`.card`/`.metric`/`.bubble`/data/reading-text node sits under `.glass`. Tests (RTL, mocked
07/08/09): step derivation per state; consent + re-acceptance on a newer version; script
copy + solid surface; credential Zod validation + write-only password + 400 mapping; test
result active/failed + retry-without-password + 422 over-privileged; relationship
both-endpoints client guard; save-exposure invalidation; dashboard hides the password; and
**no request carries an org_id/connection id**. `pnpm build && lint && type-check && test`
green. Follow react/vercel best-practices (TanStack Query, no useEffect+fetch, stable client,
derived state machine).
