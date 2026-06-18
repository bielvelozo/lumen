---
status: in-progress
feature: deploy
created: 2026-06-18
---
# Production Deploy & Ops — Implementation Plan

Implements `[[spec]]` — the final spec. **Gate-1**. Packages the system for production: a hardened
API Docker image, Cloudflare Pages config, a Drizzle-migration deploy step, the cross-site
cookie + CORS wiring, CI, a deploy compose, and a runbook. Mostly ARTIFACTS + two verifiable
gates (image boots → `GET /health`; migrations idempotent against local Postgres). One real code
change: env-driven CORS (credentials + explicit allow-list, never `*`).

## The two verifiable gates (Docker is up — both run this iteration)

1. **Migrations forward-only/idempotent vs LOCAL Postgres** — `pnpm --filter api db:migrate` runs
   green, and a re-run is a NO-OP (Drizzle tracks applied migrations).
2. **The image boots from env only → `GET /health` 200** — build `apps/api/Dockerfile`, run it with
   env, curl `/health`.

## Code change: cross-site CORS (invariant — spec 05 cookie)

`@fastify/cors` registered with `credentials: true` and an EXPLICIT origin allow-list from
`WEB_ORIGIN` (comma-separated env, never `*` with credentials). Both prod origins are HTTPS (the
VPS API behind a TLS reverse proxy). Registered before routes, gated like the cookie plugin.

## Architecture / artifacts

```
packages/shared/src/env.ts        # + WEB_ORIGIN (CORS allow-list, comma-separated; default local)
apps/api/src/app.ts               # register @fastify/cors (credentials + WEB_ORIGIN allow-list)
apps/api/Dockerfile               # multi-stage, node:22-slim pinned, non-root, prod-deps only, HEALTHCHECK /health
apps/api/.dockerignore            # exclude .env, node_modules, .git, tests, source maps
apps/web/public/_redirects        # SPA fallback: /* /index.html 200
docker-compose.prod.yml           # VPS deploy: api image, host env, restart: unless-stopped, healthcheck
deploy/Caddyfile                  # TLS-terminating reverse proxy sketch (automatic HTTPS)
.github/workflows/ci.yml          # frozen-lockfile + turbo build/lint/type-check/test on pinned Node
.env.example                      # + WEB_ORIGIN + deploy notes (prod DATABASE_URL sslmode=require, etc.)
DEPLOY.md                         # runbook: first deploy / release / rollback / migration / secret rotation + env inventory
```

## Open-question defaults (recorded in DECISIONS.md)

- Managed Postgres: **Neon** (default lean; `[CONFIRM-WITH-HUMAN]` per seed) — direct (non-pooled)
  URL for the migration step, pooled for the app if needed; `sslmode=require`.
- Reverse proxy: **Caddy** (automatic HTTPS, least config).
- CI provider: **GitHub Actions** on the pinned Node (22).
- Pages previews: point at a **staging API** with its own allow-list; prod allow-lists only the
  prod Pages origin.
- Secrets manager: **host env + a documented inventory** for v1 (contract: outside the DB, never
  committed).
- Deploy: commit a **`docker-compose.prod.yml`** that reads host env (reproducible).
- Master-key rotation needs a re-encryption pass (spec 02 keyring is versioned) — NOT a simple
  env swap; documented in the runbook.

## Gate-1 / verification

- `/security-review` on the diff: secrets out of the DB + never committed (`.dockerignore`/
  `.env.example`); cookie flags correct (httpOnly/Secure/SameSite=None); CORS allow-list NOT
  wildcarded with credentials; image runs non-root. Resolve findings.
- CORS unit/inject test: configured origin allowed with credentials; an off-list origin not
  reflected; no `*`-with-credentials.
- Run BOTH live gates (Docker): migrate idempotent + image boots → `/health`. Ledger.
- Full suite green: `pnpm build && lint && type-check && test`.
