---
status: shipped
feature: monorepo-scaffold
created: 2026-06-17
shipped: 2026-06-17
---
# Monorepo Scaffold — Spec

**Status:** Draft
**Scope:** Stand up the pnpm + Turborepo monorepo (`apps/web`, `apps/api`, `packages/shared`) with TypeScript, linting, testing, env validation, and local Docker infra — the foundation every later spec builds on.

## Context

The repo is pre-implementation: no `package.json`, no lockfile, no build/test scripts (see `[[../../constitution|Constitution]]` → *Tooling and workflow principles*). The locked stack is React SPA on Vite (front), a dedicated Fastify/TypeScript service (back), PostgreSQL + Drizzle for the app DB, and the Vercel AI SDK for Claude. Two previously-open forks are now decided: **backend = Fastify**, **repo = pnpm workspaces orchestrated by Turborepo**. This spec creates the skeleton so that every subsequent feature has a place to live and a single command to build, lint, type-check, and test the whole workspace.

It also provisions **local** Postgres (app DB) and MySQL (a stand-in for the client DB) via Docker Compose, so later specs (auth, connections, chat) can be developed and tested against real engines without external services.

## Problem Statement

There is nowhere to write code yet. We need a consistent, reproducible workspace where the frontend and backend share types/contracts, where one toolchain governs both, and where a developer (or the ralph loop) can clone, install, spin up dependencies, and run everything with a small, predictable set of commands.

## Non-Goals

- No feature code. No auth, no DB schema, no UI screens — those are specs `01`+. This spec ships an empty-but-runnable app shell on both sides (a health-check route on the API, a blank themed page on the web) and nothing more.
- No production deploy config (Dockerfile for prod, Cloudflare Pages, managed Postgres) — that is `[[../16-deploy/spec|16 · Deploy]]`. Here, Docker is **local dev infra only**.
- No design-system port — that lands in `[[../06-web-shell-and-auth-ui/spec|06]]`. Here the web app only imports the CSS once to prove the pipeline works.
- No CI pipeline — `[[../16-deploy/spec|16]]`.

## Constraints

- **Package manager:** pnpm with workspaces; **task orchestration:** Turborepo (`turbo.json` with `build`, `lint`, `type-check`, `test`, `dev` pipelines and sane caching/`dependsOn`).
- **Layout:**
  - `apps/web` — Vite + React + TypeScript SPA (React Router + TanStack Query are added with the shell in `06`; here just the Vite/React/TS baseline).
  - `apps/api` — Fastify + TypeScript service with a single `GET /health` route.
  - `packages/shared` — shared TypeScript types and runtime **Zod** contracts (request/response DTOs, env schema helpers) consumed by both apps. Built/consumed as a workspace package; no duplication of types across the boundary.
- **Language/tooling:** TypeScript everywhere (`strict: true`); a shared base `tsconfig`. **ESLint + Prettier** with one config applied workspace-wide. **Vitest** as the test runner (chosen for first-class Vite/TS/ESM support); a placeholder test per package proves the runner works.
- **Env:** environment variables are **validated at startup** against a Zod schema in `packages/shared` (fail fast with a clear message if a required var is missing). Provide `.env.example` enumerating every var the project will need as it grows (DB URLs, JWT secret, encryption key, Resend key, etc., documented even if unused yet). Never commit real secrets; `.env` is gitignored.
- **Local infra:** `docker-compose.yml` at the repo root with two services — `postgres` (app DB) and `mysql` (client-DB stand-in) — pinned versions, named volumes, ports, and healthchecks. A documented `.env.example` wires connection URLs to these.
- **Node:** pin a Node version (`.nvmrc` / `engines`) so the API and tooling are reproducible.
- Honor `[[../../rules/use-best-practices-skills|use-best-practices-skills]]`: the web baseline follows `react-best-practices`; nothing here is security-sensitive yet, but the structure must not make later `org_id`/secret handling awkward.

## User Stories / Scenarios

1. **Fresh clone runs.** A developer clones, runs `pnpm install`, `docker compose up -d`, then a single dev command, and gets: the API answering `GET /health` with `{ status: "ok" }`, and the web app serving a blank themed page on its dev port.
2. **One toolchain governs all.** From the repo root, `pnpm build`, `pnpm lint`, `pnpm type-check`, and `pnpm test` each run across every workspace via Turborepo, with caching.
3. **Shared contract works.** A type/Zod schema exported from `packages/shared` is imported and used by both `apps/api` and `apps/web` without copy-paste, and a change to it is type-checked across both.
4. **Env fails fast.** Starting the API with a required env var missing exits immediately with a readable error naming the missing var — not a deep runtime stack trace.

## Success Criteria

- `pnpm install` at the root installs all workspaces; one lockfile (`pnpm-lock.yaml`) is committed.
- `docker compose up -d` brings up healthy Postgres and MySQL containers reachable at the URLs in `.env.example`.
- Root scripts `build`, `lint`, `type-check`, `test`, `dev` all run green across `apps/web`, `apps/api`, `packages/shared` through Turborepo.
- `apps/api` serves `GET /health` → `200 {"status":"ok"}`; `apps/web` serves a blank page with the design-system CSS loaded.
- `packages/shared` exports at least one type and one Zod schema consumed by both apps; the env validator rejects a missing required var with a clear message.
- `tsc --noEmit` (via `type-check`) passes with `strict: true` everywhere; ESLint and Prettier pass; at least one Vitest test runs per package.
- Commit lands with the scaffold; `.gitignore` covers `node_modules`, `.env`, `dist`, Turborepo cache, etc.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Turborepo + pnpm workspace wiring (resolution, internal package builds) is fiddly and can rot later specs | Keep `packages/shared` a plain TS package consumed via workspace protocol; verify cross-imports type-check before closing the spec |
| ESM/CJS friction between Fastify (Node), Vite (browser), and shared package | Standardize on ESM (`"type": "module"`) across the workspace; pin Node and TS `moduleResolution: bundler/nodenext` consistently |
| Pinned Docker images drift or ports collide with local services | Pin exact image tags, expose non-default host ports, document them in `.env.example`, add healthchecks |
| Over-scaffolding (adding Router/Query/design system early) bleeds `06`'s scope in here | Hard-stop at "empty but runnable"; defer all feature wiring to its owning spec |

## Open Questions

- [NEEDS CLARIFICATION: exact pinned versions of Node, Postgres, and MySQL images] — pick current LTS Node and stable Postgres 16 / MySQL 8 unless the user prefers otherwise; record the choice as a convention once locked.
- [NEEDS CLARIFICATION: whether `packages/shared` should also hold the Drizzle schema, or whether that lives in `apps/api`] — resolved in `[[../01-app-db-drizzle/spec|01]]`; default lean is schema in `apps/api/src/db` with only inferred types/DTOs re-exported through `packages/shared`.
