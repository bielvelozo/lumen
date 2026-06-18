---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/16-deploy/spec]]"
  - "[[shared-package-consumed-as-ts-source]]"
created: 2026-06-18
---
# Dockerizing a monorepo whose shared package is consumed as TS source

`@lumen/shared` is consumed as TS source — there's no build step, the apps import its `src`
directly ([[shared-package-consumed-as-ts-source]]). That's lovely for dev but fights the spec-16
production-image requirement: "only production deps + built output, no source/dev deps/tests."
`tsc` alone won't emit a runnable app (`build` is `tsc --noEmit`), and shipping `tsx` + source
violates "no source."

**The clean resolution: esbuild bundles the server, inlining the workspace package and
externalizing the real runtime deps.**

```js
// apps/api/build.mjs
const external = Object.keys(pkg.dependencies).filter((d) => d !== '@lumen/shared');
await build({ entryPoints: ['src/server.ts'], outfile: 'dist/server.js',
  bundle: true, platform: 'node', format: 'esm', target: 'node22', external });
```

- **Inline only the workspace package** (it's the only thing with no published build); everything
  else (`fastify`, `pg`, `mysql2`, `@sentry/node`, the AI SDK, and especially the **native**
  `@node-rs/argon2`) stays external — bundling frameworks with dynamic requires / native `.node`
  binaries breaks at runtime. The final image's `node_modules` provides them.
- Get the prod `node_modules` with `pnpm --filter @lumen/api deploy --prod --legacy /app` (the
  `--legacy` flag is needed for a non-injected workspace). Verify it's dev-dep-free:
  `docker run --rm --entrypoint sh img -c "ls node_modules | grep -E 'vitest|esbuild|tsx'"` →
  empty.
- **Match libc across stages:** build and runtime both `node:22-bookworm-slim` (glibc) so the
  argon2 native binary installed in the build stage runs in the runtime stage. Alpine (musl)
  would mismatch.

## The `.dockerignore` resolution gotcha (Gate-1 MEDIUM)

The build context is the **repo root** (the Dockerfile `COPY . .` needs the lockfile + every
workspace `package.json`). A `.dockerignore` placed at `apps/api/Dockerfile.dockerignore` is only
honored by BuildKit's per-Dockerfile resolution — if anything builds via a path that falls back to
the **context-root** `.dockerignore`, a developer's repo-root `.env` would land in the
intermediate build layer (not the final image, but still an exfil surface in a cached/pushed
layer). **Fix: put a root `.dockerignore` with `.env`/`.env.*`** so the exclusion is unconditional.
Keep the per-Dockerfile one for narrower extras.

## The image-boot gate is cheap and worth running

`/health` doesn't touch the DB (the pg pool connects lazily, and startup only does an argon2
dummy-hash for the login timing guard), so you can boot the image with a valid-but-unreachable
`DATABASE_URL` and `curl /health` → 200 to prove the whole multi-stage build + non-root + env-only
config works — no managed DB needed. Also assert `whoami` = the non-root user and that a missing
secret fails fast.
