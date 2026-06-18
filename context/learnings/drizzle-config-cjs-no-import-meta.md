---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/01-app-db-drizzle/spec]]"
created: 2026-06-18
---
# `drizzle.config.ts` runs as CJS — `import.meta` is empty there

drizzle-kit loads `drizzle.config.ts` by bundling it to **CommonJS** with esbuild.
Inside that bundle `import.meta` is unavailable, so `import.meta.dirname` (and
`import.meta.url`) resolve to `undefined`. Using them to locate the repo-root `.env`
crashes drizzle-kit with:

```
"import.meta" is not available with the "cjs" output format and will be empty
The "paths[0]" argument must be of type string. Received undefined
```

In the config, derive paths from `process.cwd()` instead (drizzle-kit runs with the
package directory as cwd, e.g. `apps/api`): `resolve(process.cwd(), '..', '..', '.env')`.

## Context

Hit in spec 01 wiring `apps/api/drizzle.config.ts`. The same `import.meta.dirname`
pattern works fine in the runtime ops scripts (`src/db/migrate.ts`, `seed.ts`)
because those run as ESM under **tsx**, not bundled to CJS — so the gotcha is
specific to files drizzle-kit itself loads (the config).

## How to Apply

- In `drizzle.config.ts` (and anything drizzle-kit bundles), use `process.cwd()`
  for path resolution, never `import.meta.*`.
- In tsx-run ESM scripts (`migrate.ts`/`seed.ts`), `import.meta.dirname` is fine and
  is the robust choice (independent of cwd).
- `drizzle-kit generate` does not connect to the DB, so a placeholder
  `dbCredentials.url` is acceptable for generation; a real `DATABASE_URL` is only
  needed for `migrate`/`push`/`studio`.
