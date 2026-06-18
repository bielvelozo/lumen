# Lumen — Deploy & Ops Runbook (v1)

The single operator's guide to shipping and running Lumen. Spec 16. v1 is **one API container on
one VPS** + **static frontend on Cloudflare Pages** + **managed Postgres**. The client's MySQL and
the Claude key are external and per-tenant — connected at runtime by each owner, not part of our
deploy.

## Topology

```
 Browser ──HTTPS──> Cloudflare Pages (apps/web, static)   # VITE_API_URL baked at build
    │                                                      
    └──HTTPS, credentials:include──> Caddy (TLS) ──> API container (apps/api, :3001, non-root)
                                                        └──TLS──> Managed Postgres (Neon/Supabase)
```

The auth cookie is **cross-site** (`httpOnly; Secure; SameSite=None`), so **both origins must be
HTTPS** and the API's CORS must allow credentials with an **explicit `WEB_ORIGIN` allow-list (never
`*`)**.

## Environment / secrets inventory

Every secret lives in **host env / a secrets manager — OUTSIDE the database — and is NEVER
committed**. `.env.example` enumerates all vars (no values). The API validates env at startup and
**fails fast** if any required var is missing/malformed.

| Var | Where | Required | Notes |
|---|---|---|---|
| `DATABASE_URL` | VPS host env | yes | Managed Postgres, `sslmode=require`. Use the **direct (non-pooled)** URL for the migration step. |
| `SECRETS_ENCRYPTION_KEY` | VPS host env | yes | 32-byte base64 (AES-256-GCM master key, spec 02). Postgres never sees it. Rotation = re-encryption (below). |
| `JWT_SECRET` | VPS host env | yes | ≥32 chars (spec 05). |
| `WEB_ORIGIN` | VPS host env | yes | The production Pages origin(s), comma-separated. The CORS allow-list. Never `*`. |
| `MYSQL_URL` | VPS host env | dev only | Local Docker stand-in for tests; not used in prod (clients connect their own DB at runtime). |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` / `SENTRY_TRACES_SAMPLE_RATE` | VPS host env | no | Empty DSN disables Sentry cleanly (spec 15). |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | VPS host env | no | Transactional email (spec 04). Needs a verified sender domain. |
| `APP_URL` | VPS host env | no | Base URL used in email links. |
| `VITE_API_URL` | **Pages build env** | yes | The production API origin (e.g. `https://api.yourdomain.com`). Baked at build — a change needs a **Pages rebuild**. |
| `VITE_SENTRY_DSN` | Pages build env | no | Web Sentry DSN (public). |

Generate secrets: `openssl rand -base64 32` (encryption key), `openssl rand -base64 48` (JWT).

## First deploy

1. **Managed Postgres:** create a Neon/Supabase project; copy the connection string (TLS,
   `sslmode=require`). Keep the **direct** (non-pooled) URL for migrations.
2. **VPS:** install Docker + Caddy. Set every secret above as host env (or an untracked `.env`
   beside `docker-compose.prod.yml`). Point `deploy/Caddyfile` at the real API hostname.
3. **Migrate** (before serving traffic):
   ```sh
   DATABASE_URL="<direct postgres url>" pnpm --filter @lumen/api db:migrate
   ```
4. **Build + start the API:**
   ```sh
   docker compose -f docker-compose.prod.yml build
   docker compose -f docker-compose.prod.yml up -d
   caddy run --config deploy/Caddyfile        # TLS-terminate, proxy 127.0.0.1:3001
   ```
   Verify: `curl https://api.yourdomain.com/health` → `{"status":"ok"}`.
5. **Cloudflare Pages:** connect the repo. Build command `pnpm --filter web build`, output dir
   `apps/web/dist`. Set `VITE_API_URL` to the API origin. The `_redirects` SPA fallback ships in
   the build. Pages serves HTTPS by default.
6. **Smoke test in a browser:** open the Pages URL, sign up + log in. Confirm the cross-site cookie
   is set (`Secure; SameSite=None`) and reused on subsequent API calls (no CORS / third-party-cookie
   errors). If the cookie is dropped: confirm BOTH origins are HTTPS and `WEB_ORIGIN` exactly
   matches the Pages origin.

## Routine release

1. Merge to `main` with green CI (build + lint + type-check + test).
2. If the release has a schema change, run the **migration step first** (idempotent; a re-run is a
   no-op):
   ```sh
   DATABASE_URL="<direct url>" pnpm --filter @lumen/api db:migrate
   ```
3. Rebuild + restart the API:
   ```sh
   docker compose -f docker-compose.prod.yml build
   docker compose -f docker-compose.prod.yml up -d
   ```
   The healthcheck (`GET /health`) drives `restart: unless-stopped`.
4. Pages auto-rebuilds on push. If `VITE_API_URL` changed, trigger a Pages rebuild.

## Rollback

Migrations are **forward-only**. To roll back the API, redeploy the previous image tag:
```sh
docker compose -f docker-compose.prod.yml up -d --no-build   # pin the prior image tag first
```
If the bad release included a migration, rolling the **code** back is safe only if the old code
tolerates the new schema (additive migrations usually are). A destructive migration needs a
forward fix-migration, not a DB rollback — never hand-edit prod schema.

## Run a migration (standalone)

```sh
DATABASE_URL="<direct managed-postgres url>" pnpm --filter @lumen/api db:migrate
```
Forward-only + idempotent (drizzle tracks applied migrations in `drizzle.__drizzle_migrations`).
Run it **before** the new container serves traffic.

## Rotate a secret

- **`JWT_SECRET`:** update host env, restart the API. In-flight sessions are invalidated (existing
  access/refresh tokens no longer verify) — users re-log-in. Acceptable.
- **`SECRETS_ENCRYPTION_KEY` (encryption master key):** ⚠️ NOT a simple env swap. Existing
  `bytea` secrets (`db_connections.encrypted_password`, `ai_connections.encrypted_api_key`) were
  encrypted under the OLD key. The crypto keyring (spec 02) is versioned (each blob carries its
  `key_id`), so the path is: add the NEW key to the keyring as the active key while keeping the OLD
  key available for decryption, deploy, then run a **re-encryption pass** that decrypts each blob
  with its old key and re-encrypts under the new key. Only after every blob is re-encrypted can the
  old key be retired. Do NOT just replace the env var — that orphans every stored secret.

## CI

`.github/workflows/ci.yml` runs `build`, `lint`, `type-check`, `test` across the workspace via
Turborepo on the pinned Node, on every PR/push to `main`, with a frozen lockfile and **no
production secrets**. Green CI is required to merge. DB-facing live tests are env-gated and SKIP in
CI (no `DATABASE_URL`/`MYSQL_URL`/`ANTHROPIC_API_KEY`); they are verified against local Docker
before release (see `DECISIONS.md` LIVE-VERIFICATION-PENDING entries).

## Recovery quick reference

| Symptom | Action |
|---|---|
| API won't boot | Check logs — startup env validation names the missing/invalid var. Set it, restart. |
| `/health` red | `docker compose -f docker-compose.prod.yml logs api`; `restart: unless-stopped` auto-restarts. |
| Cross-site login fails | Both origins HTTPS? `WEB_ORIGIN` == Pages origin exactly? Cookie `Secure; SameSite=None`? |
| Frontend hits wrong API | Stale `VITE_API_URL` baked at build → trigger a Pages rebuild. |
