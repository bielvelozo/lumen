---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/08-db-connection-create-and-test/spec]]"
created: 2026-06-18
---
# `describe.skipIf(...)` still EVALUATES the describe body during collection

`describe.skipIf(cond)(name, fn)` only marks the contained tests as skipped — vitest still
**runs `fn` during collection** to register them. So any throwing/side-effecting work placed
directly in the describe body executes even when the suite is "skipped". An env-gated
integration test that did:

```ts
describe.skipIf(!process.env.MYSQL_URL)('live', () => {
  const root = rootConfig();           // new URL(process.env.MYSQL_URL ?? '')  ← throws offline
  ...
});
```

failed the WHOLE FILE in the default offline `pnpm test` — `new URL('')` threw at collection
time, even though every test was meant to skip. The default suite went red despite "0 failed
tests" (it was a file-level error).

Fix: do the gated/throwing setup inside `beforeAll` (which does NOT run for a skipped suite),
not in the describe body:

```ts
let root: ReturnType<typeof rootConfig>;
beforeAll(async () => { root = rootConfig(); admin = await createConnection({ ...root }); });
```

## Context

Hit wiring the spec-08 live MySQL integration test. The same applies to every
`skipIf`-gated DB/MySQL/AI integration test in this repo (specs 01/08/09/13).

## How to Apply

- In a `describe.skipIf(...)` block, keep the body free of code that can throw when the gate
  is off — parse env / open connections / read fixtures inside `beforeAll`/`beforeEach`.
- `test`/`it` callbacks are safe (they don't run when skipped); the describe body and any
  top-level `const x = f()` inside it are NOT.
- A green-looking "N passed | M skipped" can still be a RED file if collection threw — watch
  for `Test Files … failed` even when `Tests … 0 failed`.
