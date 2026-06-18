---
status: draft
feature: app-db-drizzle
created: 2026-06-17
shipped: null
---
# App DB & Drizzle Schema — Spec

**Status:** Draft
**Scope:** Stand up Drizzle ORM against the application's PostgreSQL and faithfully port `db/schema.sql` — every enum, table, column, default, FK, unique constraint, and index — into a typed Drizzle schema, with drizzle-kit migrations, a migrate runner, and a seed script.

## Context

The monorepo skeleton exists (`[[../00-monorepo-scaffold/spec|00 · Monorepo Scaffold]]`): pnpm + Turborepo, `apps/api` (Fastify), `packages/shared` (types + Zod), and a local Postgres container from `docker-compose.yml`. What does not exist yet is the application database itself — only `db/schema.sql`, a commented PostgreSQL DDL, written as the source of truth for the data layer (`[[../../constitution|Constitution]]` → *Architecture principles*).

This spec turns that DDL into a Drizzle TypeScript schema and a migration pipeline. It is the foundation under every feature spec that follows: auth (`03`–`05`), DB connection (`07`–`10`), AI connection (`11`), and chat (`13`–`14`) all read and write through these tables. Getting the port exact — same defaults, same `ON DELETE` behavior, same indexes — is the whole job; a drift here silently corrupts every later spec.

The schema is not neutral. It is the physical embodiment of the constitution's invariants: `org_id` is carried (denormalized) all the way down to `messages` and `function_call_logs` so any query can filter by tenant without a JOIN (invariant 1, anti-IDOR defense in depth); secrets live in `bytea` columns (`encrypted_password`, `encrypted_api_key`) never plaintext (invariant 2); disposable tokens are stored as `token_hash`, never raw (invariant 4); connection state is first-class (`status` + `last_error`). This spec must preserve all of that structurally — it defines the columns; it does not implement the behavior.

The resolved default from `[[../00-monorepo-scaffold/spec|00]]`'s open questions stands: the Drizzle schema lives in `apps/api/src/db`, and only inferred row types / DTOs are re-exported through `packages/shared`.

## Problem Statement

There is no application database and no typed access to it. We need: (1) a Drizzle schema that is a 1:1 port of `db/schema.sql` — no added, dropped, or renamed columns; identical enums, defaults, foreign-key delete actions, unique constraints, and indexes; (2) a drizzle-kit pipeline that generates SQL migrations from that schema and applies them to Postgres; (3) a single command to migrate; (4) a seed script that populates a coherent demo tenant for local development. The generated migration must reproduce `db/schema.sql` faithfully so the DDL and the ORM never disagree.

## Non-Goals

- **No encryption or decryption logic.** This spec only defines `encrypted_password` and `encrypted_api_key` as `bytea` columns and the surrounding non-secret config. Encrypt/decrypt, key management, and the env-resident decryption key are `[[../02-secrets-and-tokens/spec|02 · Secrets & Tokens]]`. Likewise, token *hashing* is `02`/`04`/`05`; here `token_hash` is just a `text` column.
- **No endpoints, no auth, no business logic.** No Fastify routes, no JWT, no `org_id`-scoping middleware. The repository/query layer that enforces tenant scoping at call sites belongs to the feature specs that own those queries.
- **No client-DB (MySQL) connectivity or introspection.** This is the *application* Postgres only. Connecting to and introspecting the client's MySQL is `[[../08-db-connection-create-and-test/spec|08]]` / `[[../09-introspection-and-exposure/spec|09]]`; here `exposed_tables.columns` is just a `jsonb` column.
- **No `updated_at` database trigger.** Per `db/schema.sql`'s closing note, `updated_at` is maintained by the application/ORM, not a DB-level trigger. This spec does not add one.
- **No v2 columns or tables.** The `member` role value exists in the enum (it is in the DDL) but no membership/invite tables are added. No column-level exposure, no multi-provider/multi-connection structures.

## Constraints

- **Faithful port of `db/schema.sql`.** The canonical contents:
  - **Enums (4):** `user_role` (`'owner'`, `'member'`), `connection_status` (`'pending'`, `'active'`, `'failed'`), `message_role` (`'user'`, `'assistant'`), `log_status` (`'success'`, `'failed'`). Define each as a Drizzle `pgEnum`; values and order must match exactly.
  - **Tables (11), in dependency order:** `organizations`, `users`, `email_verification_tokens`, `refresh_tokens`, `db_connections`, `exposed_tables`, `exposed_relationships`, `ai_connections`, `chat_sessions`, `messages`, `function_call_logs`. Every column, type, nullability, and default must match the DDL.
- **Primary keys & UUID default.** Every `id` is `uuid PRIMARY KEY DEFAULT gen_random_uuid()`. Use Drizzle's `uuid('id').primaryKey().defaultRandom()` (emits `gen_random_uuid()`). Document that `gen_random_uuid()` is native on PostgreSQL 13+; on older servers the `pgcrypto` extension must be enabled — the migration should `CREATE EXTENSION IF NOT EXISTS pgcrypto` defensively (or the spec notes PG ≥ 13 as a hard requirement, see Open Questions).
- **Timestamps.** All `created_at` / `updated_at` / `*_at` columns are `timestamptz`. `created_at` and (where present) `updated_at` are `NOT NULL DEFAULT now()`; nullable event timestamps (`verified_at`, `used_at`, `revoked_at`, `last_tested_at`, `last_validated_at`, `consent_accepted_at` is NOT NULL, etc.) keep their exact nullability from the DDL.
- **`bytea` secret columns.** `db_connections.encrypted_password` and `ai_connections.encrypted_api_key` are `bytea NOT NULL`. Map to Drizzle `customType<{ data: Buffer }>` emitting `bytea` (Drizzle has no first-class `bytea`); the TS type must be `Buffer`/`Uint8Array`, not `string`. No transform that would ever surface plaintext.
- **`jsonb` columns.** `exposed_tables.columns` is `jsonb NOT NULL DEFAULT '[]'`; `function_call_logs.params` is `jsonb` (nullable, no default). Use Drizzle `jsonb`; type `columns` as an array of `{ name: string; type: string }` shape and default to `[]`.
- **Foreign keys & delete actions — exact:**
  - `ON DELETE CASCADE`: `users.org_id`→organizations; `email_verification_tokens.user_id`→users; `refresh_tokens.user_id`→users; `db_connections.org_id`→organizations; `exposed_tables.db_connection_id`→db_connections, `exposed_tables.org_id`→organizations; `exposed_relationships.db_connection_id`→db_connections, `exposed_relationships.org_id`→organizations; `ai_connections.org_id`→organizations; `chat_sessions.org_id`→organizations, `chat_sessions.user_id`→users; `messages.session_id`→chat_sessions, `messages.org_id`→organizations; `function_call_logs.org_id`→organizations.
  - `ON DELETE SET NULL`: `function_call_logs.user_id`→users, `function_call_logs.session_id`→chat_sessions, `function_call_logs.message_id`→messages.
  - **No delete action specified (default `NO ACTION`):** `db_connections.consent_accepted_by`→users (nullable FK). Preserve this exactly — it must not become CASCADE or SET NULL.
- **Unique constraints:** `users.email` UNIQUE (global); `exposed_tables` UNIQUE `(db_connection_id, table_name)`; `exposed_relationships` UNIQUE `(db_connection_id, relationship_name)`. The two commented-out v1 unique indexes in the DDL (`uq_dbconn_org`, `uq_aiconn_org`) stay **commented/absent** — do not add them.
- **Indexes — port all, with column order and sort direction:**
  - `idx_users_org` on `users(org_id)`.
  - `idx_evt_token` on `email_verification_tokens(token_hash)`; `idx_evt_user` on `(user_id)`.
  - `idx_rt_token` on `refresh_tokens(token_hash)`; `idx_rt_user` on `(user_id)`.
  - `idx_dbconn_org` on `db_connections(org_id)`.
  - `idx_exposed_org` on `exposed_tables(org_id)`.
  - `idx_exposed_rel_org` on `exposed_relationships(org_id)`; `idx_exposed_rel_conn` on `(db_connection_id)`.
  - `idx_aiconn_org` on `ai_connections(org_id)`.
  - `idx_session_org` on `chat_sessions(org_id)`; `idx_session_org_updated` on `chat_sessions(org_id, updated_at DESC)`.
  - `idx_msg_session` on `messages(session_id, created_at)`; `idx_msg_org` on `(org_id)`.
  - `idx_log_org_created` on `function_call_logs(org_id, created_at DESC)`.
  - The two `DESC` indexes must emit `DESC`; preserve the multi-column ordering verbatim.
- **`defaults` that must be emitted, not just typed:** `users.role` → `'owner'`; `users.email_verified` → `false`; `db_connections.engine` → `'mysql'`, `.ssl_enabled` → `true`, `.status` → `'pending'`; `exposed_tables.columns` → `'[]'`; `ai_connections.provider` → `'claude'`, `.status` → `'pending'`; messages/logs none beyond `created_at`.
- **Denormalized `org_id` preserved (invariant 1).** `org_id` is present and `NOT NULL` on `exposed_tables`, `exposed_relationships`, `messages`, and `function_call_logs` even though it is reachable via a parent FK. This is deliberate denormalization for tenant filtering — do **not** "normalize it away."
- **Drizzle config & connection.** Single `drizzle.config.ts` pointing at the schema file(s) and `DATABASE_URL` (validated via the `packages/shared` env schema from `00`). A pooled `pg`/`postgres` client and a `db` instance live in `apps/api/src/db`. Migrations are SQL files under `apps/api/drizzle/` (committed), generated by `drizzle-kit generate`, applied by `drizzle-kit migrate` (or a tiny programmatic migrator).
- **Commands.** Add workspace scripts (wired into Turborepo where sensible): `db:generate` (drizzle-kit generate), `db:migrate` (apply pending migrations), and `db:seed` (run the seed script). Record them in `context/learnings/commands-catalog.md`. Migrate must be idempotent and safe to re-run.
- **Seed script.** Inserts one demo `organization`, one `owner` user (with a clearly-fake `password_hash` placeholder — no real auth yet, that is `03`), and optionally a stub `db_connections`/`ai_connections` row with **placeholder `bytea`** values (NOT real secrets — seed must never write a real encrypted blob, since encryption is `02`). Seed is idempotent (safe re-run) and clearly marked dev-only.
- **Naming.** TypeScript table/column identifiers use Drizzle's mapping so the **database** names stay exactly as in `db/schema.sql` (snake_case table and column names, same index names). The generated migration's object names must match the DDL.

## User Stories / Scenarios

1. **Generate matches the DDL.** A developer runs `pnpm db:generate`; drizzle-kit emits a SQL migration whose `CREATE TYPE` / `CREATE TABLE` / `CREATE INDEX` statements are equivalent to `db/schema.sql` (same enums, columns, defaults, FK actions, uniques, indexes). Diffing the two reveals no semantic drift.
2. **Migrate from empty.** Against the local Postgres container (from `00`), `pnpm db:migrate` on a fresh database creates all 4 enums and 11 tables with every constraint and index, and exits success. Re-running it is a no-op.
3. **Types flow to callers.** `apps/api` imports the typed tables and gets inferred `Insert`/`Select` row types; `packages/shared` re-exports the inferred row/DTO types so `apps/web` can reference them without duplicating shapes. A `bytea` column types as `Buffer`, a `jsonb` column as its declared shape — both checked by `tsc`.
4. **Seed a demo tenant.** `pnpm db:seed` populates one org + one owner user (+ optional stub connections with placeholder bytea) so later specs can develop against non-empty data. Running it twice does not duplicate or error.
5. **Tenant column is structurally present.** A developer inspecting `messages` and `function_call_logs` finds a `NOT NULL org_id` FK to `organizations` — confirming the anti-IDOR denormalization survived the port.

## Success Criteria

- The Drizzle schema defines exactly the 4 enums and 11 tables of `db/schema.sql`, with matching column names, types, nullability, and defaults — verified column-by-column against the DDL.
- `pnpm db:generate` produces committed SQL migration(s) under `apps/api/drizzle/`; the migration recreates the DDL's structure (enums, tables, all FK `ON DELETE` actions, all UNIQUE constraints, all named indexes including the two `DESC` ones).
- `pnpm db:migrate` applies cleanly to a fresh local Postgres and is idempotent on re-run; a Drizzle migrations bookkeeping table exists and is committed-migration-driven.
- `encrypted_password` and `encrypted_api_key` are `bytea NOT NULL` and type as `Buffer`/`Uint8Array` in TS; no code path turns them into `string`.
- `exposed_tables.columns` is `jsonb NOT NULL DEFAULT '[]'`; `function_call_logs.params` is nullable `jsonb`.
- `org_id` is `NOT NULL` and FK-constrained on `exposed_tables`, `exposed_relationships`, `messages`, and `function_call_logs` (invariant 1 preserved).
- `function_call_logs.user_id` / `session_id` / `message_id` are `ON DELETE SET NULL`; `db_connections.consent_accepted_by` is a nullable FK with the DDL's default delete action (no CASCADE/SET NULL).
- `users.email` is globally UNIQUE; the two composite UNIQUE constraints exist; the two commented-out org-uniqueness indexes are absent.
- `pnpm db:seed` creates a coherent demo tenant idempotently using placeholder (non-real) bytea values.
- `tsc --noEmit` passes with `strict: true`; at least one Vitest test asserts the schema/types (e.g. inferred insert type rejects a missing required column, or a migration smoke test against a throwaway DB) per the `00` test baseline.
- Commands recorded in `context/learnings/commands-catalog.md`.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Drizzle has no native `bytea`, so a careless mapping yields `text`/`string` and silently risks plaintext handling | Use a dedicated `customType` emitting `bytea` with a `Buffer` TS type; add a test asserting the column SQL type and the inferred TS type; cross-check the generated migration says `bytea` |
| `gen_random_uuid()` unavailable on PostgreSQL < 13 | Pin/require PG ≥ 13 (matches the local container from `00`); additionally have the first migration `CREATE EXTENSION IF NOT EXISTS pgcrypto` as a belt-and-suspenders measure |
| drizzle-kit generates FK delete actions, `DESC` index ordering, or enum value order subtly differently from the DDL | Treat `db/schema.sql` as the diff oracle: after `generate`, compare the emitted SQL against the DDL clause-by-clause; encode the four SET-NULL/NO-ACTION exceptions as explicit references and verify them in the migration |
| Denormalized `org_id` "looks redundant" and gets dropped by a well-meaning cleanup | Document invariant 1 inline in the schema file next to each denormalized `org_id`; add a test asserting those four columns exist and are `NOT NULL` |
| Seed writes a real-looking secret into a `bytea` column and someone treats it as encrypted | Seed uses obvious placeholder bytes and a comment that real encryption is `[[../02-secrets-and-tokens/spec|02]]`; keep stub connection rows optional |
| Schema location drift (some tables in `packages/shared`, some in `apps/api`) breaks the resolved `00` decision | Keep the full Drizzle schema in `apps/api/src/db`; export only inferred types through `packages/shared`; no table definitions cross the boundary |
| `updated_at` silently stops updating because no trigger and no app logic yet | Spec explicitly defers `updated_at` maintenance to the ORM/app at write sites (owned by the feature specs that write those rows); note it so it is not mistaken for a bug here |

## Open Questions

- [NEEDS CLARIFICATION: minimum supported PostgreSQL version] — default to **PG ≥ 13** (so `gen_random_uuid()` is native and matches the `00` local container and the intended Neon/Supabase target); still emit `CREATE EXTENSION IF NOT EXISTS pgcrypto` defensively. Confirm before locking.
- [NEEDS CLARIFICATION: Postgres driver — `node-postgres` (`pg`) vs `postgres` (postgres.js)] — either works with Drizzle; lean `pg` for ecosystem familiarity unless the user prefers `postgres.js`. Record as a convention once chosen.
- [NEEDS CLARIFICATION: apply migrations via `drizzle-kit migrate` vs a small programmatic migrator using `drizzle-orm/.../migrator`] — default to the programmatic migrator invoked by `db:migrate` so production deploy (`[[../16-deploy/spec|16]]`) can run it the same way; confirm.
- [NEEDS CLARIFICATION: should the v1 single-connection / single-AI-provider uniqueness be enforced now via the commented-out `uq_dbconn_org` / `uq_aiconn_org` indexes] — default **no**, mirror the DDL (they stay commented); the "one connection per org" rule is enforced in application logic by its owning spec (`[[../08-db-connection-create-and-test/spec|08]]` / `[[../11-ai-connection-claude/spec|11]]`).
