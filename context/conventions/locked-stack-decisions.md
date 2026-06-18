---
tags:
  - convention
  - architecture
applies-to:
  - backend service
  - repo structure / tooling
  - test setup
created: 2026-06-17
---
# Locked stack: Fastify backend · pnpm + Turborepo monorepo · Vitest

The forks the `[[../constitution|Constitution]]` left open ("NestJS **or** Fastify", package manager, test runner) are now decided and not to be re-litigated:

- **Backend framework: Fastify** (Node/TypeScript). Not NestJS.
- **Repo: a monorepo** with **pnpm workspaces** orchestrated by **Turborepo**. Layout: `apps/web` (Vite SPA), `apps/api` (Fastify service), `packages/shared` (shared TypeScript types + Zod contracts).
- **Test runner: Vitest** across the whole workspace.

## Why

The constitution explicitly says: *"When they are chosen, record the decision so it, too, stops being re-debated."* This note is that record. The choices were made deliberately for v1: Fastify keeps the service light and makes AI-SDK streaming straightforward; a pnpm + Turborepo monorepo lets the front and back share one toolchain and a typed contract package (`packages/shared`) without duplication; Vitest is the natural fit for a Vite/TS/ESM codebase. These are foundational — they shape every file the build (and the ralph loop) produces — so they are locked before implementation, per the constitution's "do not guess on a fork that matters."

## How to Apply

- Build the backend with **Fastify** idioms (plugins, decorators, hooks). The auth decorator that derives `org_id` from the JWT (see `[[../specs/05-login-jwt-sessions/spec|05]]`) is the canonical enforcement point for multi-tenant isolation — there is no NestJS Guard layer; use Fastify hooks/decorators instead.
- Run tasks through **Turborepo** (`build`, `lint`, `type-check`, `test`, `dev`) with one `pnpm-lock.yaml` at the root. Foundation defined in `[[../specs/00-monorepo-scaffold/spec|00]]`.
- Put cross-boundary types and request/response Zod schemas in `packages/shared`; do not duplicate types across `apps/web` and `apps/api`.
- Write tests with **Vitest** (plus React Testing Library for `apps/web`). Do not introduce Jest/Mocha.
- If a future need argues for changing any of these, treat it as a constitutional-level decision: change it in the open and update this note — do not quietly diverge per package.
