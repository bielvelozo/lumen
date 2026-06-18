---
status: shipped
feature: deploy
created: 2026-06-17
shipped: 2026-06-18
---
# Production Deploy & Ops — Spec

**Status:** Draft
**Scope:** Phase 5, final. Package the whole system for production: a multi-stage **Dockerfile** for `apps/api` running as a non-root container on a small VPS; **Cloudflare Pages** build config for `apps/web`; **managed Postgres** (Neon/Supabase) with **Drizzle migrations** run as a deploy step (`[[../01-app-db-drizzle/spec|01]]`); **env/secrets** management with every secret outside the DB; the **cross-site cookie + CORS** wiring between the two production origins (`[[../05-login-jwt-sessions/spec|05]]`); and **basic CI** (build, lint, type-check, test) on PRs.

## Context

By this spec, every feature exists in the monorepo (`[[../00-monorepo-scaffold/spec|00]]` through `[[../14-chat-ui/spec|14]]`, plus `[[../15-observability-sentry/spec|15 · Sentry]]`). What is missing is the path to production. The locked hosting split (`[[../../constitution|Constitution]]` → *Tooling and workflow principles*; `HANDOFF.md`) is **two distinct origins**: the frontend ships as static assets to **Cloudflare Pages**, the backend runs as a **Docker container on a small VPS** (deliberately, to kill cold starts), and the app DB is **managed Postgres** (Neon or Supabase). The client's MySQL and the AI are external and per-tenant — they are not part of *our* deploy; they are connected at runtime by each owner.

Because frontend and backend live on different origins, the auth cookie is cross-site by construction: a `httpOnly; Secure; SameSite=None` JWT cookie issued by the API origin and sent by the Pages origin (`[[../05-login-jwt-sessions/spec|05]]`). That only works if CORS is configured to allow credentials with an **explicit origin allow-list** (never `*`), and if both origins are HTTPS. This spec is where that wiring becomes real against real hostnames.

This is a security-sensitive surface — it touches deploy, secrets, and cookies — so it merges only after a security review per `[[../../rules/security-review-before-merge|security-review-before-merge]]`.

## Problem Statement

There is no way to ship. We need a reproducible, secure deploy: a small hardened API image, a static frontend build that knows its API base URL, a migration step that runs against managed Postgres on every release, a single documented inventory of env vars / secrets that lives **outside** the database and is **never committed**, a correct cross-origin cookie + CORS handshake against production hostnames, and a CI gate that proves a PR builds, lints, type-checks, and tests before it can merge. The output is a **runbook** a single operator can follow to deploy and to recover.

## Non-Goals

- **No feature code.** Every behavior is owned by its spec (`00`–`15`). This spec only packages and deploys them.
- **No autoscaling, multi-region, blue/green, or orchestration (Kubernetes, swarm).** v1 is one container on one VPS. Out of scope, recorded so it is not re-litigated.
- **No managed-secrets vendor lock-in.** We define the *contract* (secrets via env / a secrets manager, outside the DB); choosing a specific manager beyond plain VPS env + Pages env is deferred.
- **No CD / auto-deploy-on-merge for the API.** CI gates PRs; the API deploy is a documented manual/scripted step in v1. (Pages auto-builds on push by nature.)
- **No client-DB or AI-provider provisioning.** Those are external, per-tenant, connected at runtime (`[[../08-db-connection-create-and-test/spec|08]]`, `[[../11-ai-connection-claude/spec|11]]`).
- **No load/perf tuning, CDN cache rules beyond Pages defaults, or DB read-replicas.**

## Constraints

- **API image (`apps/api/Dockerfile`):**
  - **Multi-stage:** a build stage installs the full pnpm workspace and compiles TS; a final stage carries only the built output + **production dependencies** (`pnpm install --prod` / pruned `node_modules`). No source, no dev deps, no test files in the final image.
  - **Small base:** `node:<pinned-LTS>-slim` or `-alpine`; pin the exact tag (no `latest`).
  - **Non-root:** create and run as an unprivileged user; filesystem read-only where practical.
  - **Healthcheck:** `HEALTHCHECK` hitting `GET /health` (from `[[../00-monorepo-scaffold/spec|00]]`) so the VPS/Docker can detect liveness.
  - **Config via env only** — no secrets baked into layers; `.dockerignore` excludes `.env`, `node_modules`, `.git`, tests.
  - Exposes one port; the VPS terminates TLS in front of it (reverse proxy, e.g. Caddy/nginx) so the public API origin is HTTPS.
- **Frontend (Cloudflare Pages):** build command `pnpm --filter web build`; output dir `apps/web/dist`; **SPA fallback** so deep links resolve (`_redirects` / `200` rewrite of `/* → /index.html`). The **API base URL** is injected at **build time** via a Pages build env var (`VITE_API_URL`), pointing at the production API origin. No secrets in frontend env — only the public API URL and (optionally) the Sentry DSN.
- **Managed Postgres (Neon/Supabase):** connection string in `DATABASE_URL`, **TLS required** (`sslmode=require`). Drizzle **migrations run as an explicit deploy step** (`pnpm --filter api db:migrate`, from `[[../01-app-db-drizzle/spec|01]]`) against the managed DB **before** the new API container serves traffic. Migrations are forward-only and idempotent on re-run.
- **Secrets & env (invariant 2):** every secret — the **encryption master key** (`[[../02-secrets-and-tokens/spec|02]]`), the **JWT secret** (`[[../05-login-jwt-sessions/spec|05]]`), the **Resend key**, the **Sentry DSN**, and `DATABASE_URL` — is provided via **env / secrets manager on the host, OUTSIDE the database**, and is **never committed**. Postgres never sees the decryption key. A committed **`.env.example`** enumerates every required var (no values); the real `.env` stays gitignored. The API **validates env at startup** against the shared Zod schema (`[[../00-monorepo-scaffold/spec|00]]`) and **fails fast** if any required var is missing or malformed.
- **Cross-site cookie + CORS (invariant — `[[../05-login-jwt-sessions/spec|05]]`):** the auth cookie is set `httpOnly; Secure; SameSite=None` (cross-site between Pages and the API). CORS on the API must: allow **credentials**, use an **explicit origin allow-list** (the Pages production origin + any preview origins we choose to permit — **never** `*`), and allow the methods/headers the app uses. Both origins **must be HTTPS** or the browser drops a `SameSite=None; Secure` cookie. The allowed origin(s) are themselves env-driven (`WEB_ORIGIN`) so prod and staging differ without code changes.
- **Cookie domain:** the cookie is **host-only on the API origin** (no shared parent domain assumed between Pages and the VPS); it travels cross-site via `SameSite=None`, not via a `Domain=` attribute.
- **CI (Turborepo on PRs):** a workflow (e.g. GitHub Actions) on every PR runs `pnpm install --frozen-lockfile` then `turbo build lint type-check test` across the workspace, on the **pinned Node version** (`[[../00-monorepo-scaffold/spec|00]]`). Green CI is **required to merge**. CI uses no production secrets; any test DB is ephemeral (the local Docker Postgres or a throwaway).
- **Docs:** a **deploy runbook** (first deploy, a routine release, rollback, rotating a secret, running a migration) and the **env-var inventory** are written down — in the spec folder or a `DEPLOY.md` it links — so a single operator can execute without tribal knowledge.
- **Security review:** merges only after `[[../../rules/security-review-before-merge|security-review-before-merge]]` (touches deploy, secrets, cookies). Re-verify by hand: secrets out of the DB, cookie flags correct, CORS allow-list not wildcarded, image runs non-root.

## User Stories / Scenarios

1. **Operator does the first deploy.** Following the runbook: provision managed Postgres, set every secret as host env on the VPS (none committed), build the API image, run the Drizzle migration step against the managed DB, start the container; configure Pages with the build command, output dir, SPA fallback, and `VITE_API_URL`. Visiting the Pages URL loads the app, which reaches the API origin, and signup/login work end-to-end.
2. **A user logs in across origins.** The browser on the Pages origin calls the API origin with `credentials: 'include'`; the API responds with `Set-Cookie: ...; HttpOnly; Secure; SameSite=None` and the correct CORS headers; the cookie is stored and **automatically sent on subsequent cross-site API calls**. No mixed-content or third-party-cookie breakage.
3. **A required secret is missing.** The container starts with `ENCRYPTION_MASTER_KEY` (or `JWT_SECRET`, etc.) unset; the API **exits immediately** with a readable error naming the missing var, and the healthcheck never goes green — it does not boot half-configured.
4. **A release ships a schema change.** The release runs the migration step first; it applies the new Drizzle migration against managed Postgres, then the new container starts. A re-run of the migration step is a no-op.
5. **A PR is opened.** CI runs build + lint + type-check + test across the workspace via Turborepo on the pinned Node; a type error or failing test **blocks merge**; no production secrets are exposed to the job.
6. **A secret is rotated.** The operator follows the runbook to rotate (e.g. the JWT secret or the encryption master key), updates host env, and restarts the container — with the documented caveat for the encryption master key (existing `bytea` blobs were encrypted under the old key; rotation needs a re-encryption plan, flagged below).
7. **A bad release is rolled back.** The operator redeploys the previous image tag per the runbook; because migrations are forward-only, the rollback path and its DB caveats are documented.

## Success Criteria

- `apps/api/Dockerfile` builds a **multi-stage** image that runs as **non-root**, contains **only production deps + built output** (no source/dev deps/tests), pins an exact base tag, and defines a working `HEALTHCHECK` against `GET /health`.
- The image boots from **env only**; no secret appears in any image layer or in `git` (verified — `.dockerignore` excludes `.env`).
- Cloudflare Pages builds `apps/web` with the documented build command and output dir, serves the SPA with a working deep-link fallback, and talks to the production API via the build-time `VITE_API_URL`.
- Drizzle migrations run as a **discrete, repeatable deploy step** against managed Postgres over TLS, **before** the API serves traffic; re-running is a no-op.
- A committed **`.env.example`** lists every required var with no values; the API **fails fast** at startup on a missing/invalid var; the real `.env`/secrets are **never committed** and live outside the DB.
- A cross-origin login from the Pages origin sets and reuses the `httpOnly; Secure; SameSite=None` cookie; **CORS allows credentials with an explicit, non-wildcard origin allow-list**; both origins are HTTPS.
- CI on PRs runs `build`, `lint`, `type-check`, `test` across the workspace via Turborepo on the pinned Node and **blocks merge** on failure, using **no production secrets**.
- A **deploy runbook** + **env-var inventory** exist and are sufficient for a single operator to do a first deploy, a routine release, a rollback, a migration, and a secret rotation.
- The branch passes `/security-review` per `[[../../rules/security-review-before-merge|security-review-before-merge]]` with findings resolved.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `SameSite=None` cookie silently dropped (one origin not HTTPS, missing `Secure`, or browser third-party-cookie heuristics) | Enforce HTTPS on **both** origins (Pages is HTTPS by default; TLS-terminate the VPS API behind a reverse proxy); set `Secure` always; test the real cross-origin login in a browser before closing; document the constraint |
| CORS misconfigured — wildcard origin with credentials (browser rejects) or origin omitted (request blocked) | Explicit env-driven origin allow-list (`WEB_ORIGIN`), `credentials: true`, never `*` with credentials; assert this in the security review |
| A secret leaks into an image layer, the repo, or CI logs | Multi-stage build + `.dockerignore`; env-only config; `.env` gitignored with a values-free `.env.example`; CI uses no prod secrets; security review checks `git`/layers |
| Migration runs against the wrong DB, or a half-applied migration corrupts state | Migration is a discrete step gated on `DATABASE_URL`; forward-only, idempotent; run **before** the new container serves; runbook documents the order and the rollback caveat |
| Rotating the **encryption master key** orphans existing `bytea` secrets encrypted under the old key | Document that master-key rotation requires a re-encryption pass; design `[[../02-secrets-and-tokens/spec|02]]` to allow it (key id / re-encrypt path); do not present rotation as a simple env swap |
| API fails to start in prod due to a missing env var with no clear signal | Startup Zod validation (`[[../00-monorepo-scaffold/spec|00]]`) fails fast naming the missing var; healthcheck stays red until configured |
| Single VPS container is a single point of failure (no HA in v1) | Accepted for v1 (non-goal); mitigate operationally with healthcheck-driven restart (`restart: unless-stopped`) and a documented quick-redeploy in the runbook |
| Frontend points at the wrong API origin (stale `VITE_API_URL` baked at build) | Treat `VITE_API_URL` as a release input; document that a changed API origin requires a Pages rebuild; surface the resolved API URL in a build log/health badge |

## Open Questions

- [NEEDS CLARIFICATION: which managed Postgres — Neon or Supabase? They differ in pooling (Neon pgBouncer endpoints, prepared-statement caveats) and in how migrations should connect.] Default lean: pick one, use the **direct (non-pooled)** connection string for the migration step, and the pooled one for the app if needed.
- [NEEDS CLARIFICATION: reverse proxy on the VPS — Caddy (automatic TLS) vs nginx + certbot?] Default lean: Caddy, for automatic HTTPS with the least config; record once chosen.
- [NEEDS CLARIFICATION: CI provider — GitHub Actions assumed; confirm the repo host and whether Pages is wired to that same git provider for auto-build.]
- [NEEDS CLARIFICATION: are Pages **preview deployments** in scope, and if so do their (dynamic) origins need to be allow-listed for CORS / cookies, or do previews point at a staging API?] Default lean: previews point at a staging API with its own allow-list; production allow-lists only the production Pages origin.
- [NEEDS CLARIFICATION: secrets manager beyond plain host env — do we want one in v1 (e.g. Doppler / 1Password / cloud KMS) or is documented host env sufficient?] Default lean: host env + a documented inventory for v1; the contract (outside the DB, never committed) holds either way.
- [NEEDS CLARIFICATION: does the API deploy get a script (compose file / deploy script) committed to the repo, or is it purely runbook steps?] Default lean: commit a `docker-compose.yml` (or deploy script) for the VPS that reads host env, so the deploy is reproducible.
