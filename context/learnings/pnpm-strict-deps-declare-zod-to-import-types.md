---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/04-email-verification/spec]]"
created: 2026-06-18
---
# pnpm strict deps: to `import { X } from 'zod'`, `zod` must be a DIRECT dependency

`apps/api` consumed Zod schemas re-exported from `@lumen/shared` and called
`schema.safeParse()` for specs 03–04 with no `zod` in its own `package.json` — that works
because the schema *objects* carry their types through `@lumen/shared` (a transitive dep).
But the moment a file does a **named import** of a Zod symbol — `import type { ZodError }
from 'zod'` (added in `http-validation.ts`) — `tsc` fails with:

```
error TS2307: Cannot find module 'zod' or its corresponding type declarations.
```

pnpm's strict, non-hoisted `node_modules` only lets a package import what it directly
declares; a transitively-installed `zod` is not resolvable by name. Fix: add `zod` to
`apps/api`'s own `dependencies` (same version range as `@lumen/shared`, `^3.23.8`) and
`pnpm install`. The downstream symptom was a cascade (`TS7053` on `flat.fieldErrors`) once
`ZodError` resolved to `any`.

## Context

Hit in spec 04 extracting a shared `validationErrorBody(error: ZodError)` helper from the
auth routes. Inferred types (e.g. `parsed.error` from a `safeParse` result) flow fine
without the dep; only *named* imports from the package need it declared.

## How to Apply

- If a package does a named `import ... from '<pkg>'` (value OR type), add `<pkg>` to that
  package's own `dependencies` — don't rely on a transitive copy under pnpm.
- Prefer re-exporting cross-cutting helpers/types through `@lumen/shared` when you want to
  avoid spreading a direct dep; but a small util that genuinely needs `ZodError` is fine
  to back with a direct `zod` dependency.
- Keep the version range aligned with `@lumen/shared` so one `zod` is installed.
