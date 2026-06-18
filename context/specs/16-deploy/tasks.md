---
status: in-progress
feature: deploy
created: 2026-06-18
---
# Production Deploy & Ops — Tasks

A box is checked ONLY after its slice is implemented AND committed.

## 1 — Cross-site CORS (code) + env
- [ ] `env.ts`: + `WEB_ORIGIN` (comma-separated allow-list; default local dev origin). Add
      `@fastify/cors`; register in `app.ts` with `credentials: true` + explicit origin allow-list
      from `WEB_ORIGIN` (NEVER `*` with credentials), before routes. `.env.example`: + WEB_ORIGIN.
      Tests: a configured origin is reflected with `Access-Control-Allow-Credentials: true`; an
      off-list origin is NOT reflected; never `*` when credentials.

## 2 — API Dockerfile + .dockerignore (+ image-boot gate)
- [ ] `apps/api/Dockerfile` (multi-stage; `node:22-slim` pinned; build stage compiles the
      workspace; final stage = prod deps + built output only; non-root user; `HEALTHCHECK` →
      `GET /health`; one port). `apps/api/.dockerignore` (exclude `.env`, `node_modules`, `.git`,
      tests). GATE: build the image + run it from env → `GET /health` returns 200 (Docker). Ledger.

## 3 — Migration deploy gate (idempotent vs local Postgres)
- [ ] Verify `pnpm --filter api db:migrate` runs green against a throwaway local Postgres AND a
      re-run is a no-op (forward-only/idempotent). Ledger the verification.

## 4 — Pages config + CI + deploy compose + Caddy
- [ ] `apps/web/public/_redirects` (SPA fallback). `.github/workflows/ci.yml` (frozen-lockfile +
      turbo build/lint/type-check/test on pinned Node, no prod secrets). `docker-compose.prod.yml`
      (api image, host env, restart, healthcheck). `deploy/Caddyfile` (TLS reverse proxy sketch).

## 5 — DEPLOY.md runbook + env inventory
- [ ] `DEPLOY.md`: first deploy / routine release / rollback / migration / secret rotation (with
      the encryption-master-key re-encryption caveat) + the full env-var inventory.

## 6 — Gate-1 + ship
- [ ] `/security-review` on the diff; resolve findings (secrets out of DB + uncommitted; cookie
      flags; CORS not wildcarded; non-root image).
- [ ] Full suite green: `pnpm build && lint && type-check && test`.
- [ ] Record open-question defaults in `DECISIONS.md`; mark spec Shipped (MOC + frontmatter)
      atomically; capture learnings.
