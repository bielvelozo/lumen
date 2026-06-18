---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/10-connect-db-ui/spec]]"
created: 2026-06-18
---
# A derived-state wizard must AWAIT a dependent query before deriving its sub-branch

The Flow-2 connect-DB wizard owns no step state — the step is a pure function of server
state (`deriveStep(consent, connection, exposure)`): consent → connect → exposure →
dashboard. This is the right pattern (no client flag can drift from the server; a deep link
to a later step is impossible because there's one route). The non-obvious trap is a
**dependent** query: `exposure` is only fetched once the connection is `active`
(`useExposure(connection.status === 'active')`). So on the render where `connection` just
resolved to `active` but `exposure` hasn't loaded yet, `deriveStep` sees `exposure ===
undefined` and picks the **exposure** step — which mounts the introspection picker and
fires an introspect call — for one frame, before flipping to the **dashboard**. That
transient wrong-step both wastes a request and (here) crashed on undefined data.

Fix: gate the render on the dependent query too, not just the always-on ones:

```ts
const exposurePending = connection.data?.status === 'active' && exposure.isPending;
if (consent.isPending || connection.isPending || exposurePending) return <Loading/>;
const step = deriveStep(consent.data, connection.data, exposure.data);
```

Note a disabled TanStack query reports `isPending: true` (with `fetchStatus: 'idle'`), so
guard the dependent query's pending state ONLY when its enabling condition holds — otherwise
a not-yet-enabled query would block the render forever.

## Context

Spec 10 (`apps/web/src/routes/connect-db/ConnectDatabasePage.tsx`). The glass-guard test
caught it: rendering the active+exposed state briefly hit `ExposureStep` and threw on a
schema that wasn't mocked.

## How to Apply

- In a derived-state view, before branching on query B (which depends on query A's result),
  wait for B to finish loading when it is enabled — don't derive the branch from B's
  transient `undefined`.
- Remember `isPending` is `true` for a *disabled* query; only treat it as "still loading"
  when the query's `enabled` condition is met.
- The chat flow (spec 14) will have similar derived states (session list vs. empty) — apply
  the same gate.
