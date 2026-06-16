---
tags:
  - learning
  - reference
related:
  - "[[../constitution|Constitution]]"
created: 2026-06-15
---
# Commands catalog

The repository is currently in the planning / spec stage — there is **no `package.json`, lockfile, or build tooling yet**, so there are no real build, test, or run commands to catalog. This note is the placeholder that AGENTS.md points to; fill it in as the stack is stood up.

## Context

Captured during the initial agent-harness setup (2026-06-15). The locked stack is documented in [HANDOFF.md](../../HANDOFF.md), but no project has been scaffolded. The intended tooling (so the choice is not re-litigated):

- **Frontend:** React SPA with Vite (React Router + TanStack Query). Dev/build/preview will come from Vite scripts once scaffolded. Deploy: Cloudflare Pages.
- **Backend:** Node/TypeScript service (NestJS or Fastify) using the Vercel AI SDK. Deploy: Docker container on a small VPS.
- **App database:** PostgreSQL (Neon/Supabase) with Drizzle ORM. Migrations via Drizzle; the schema lives in [db/schema.sql](../../db/schema.sql).
- **Package manager / test runner:** not yet chosen.

## How to Apply

When the first package is scaffolded, replace this section with the real, copy-pasteable commands (install, dev, build, test, lint, migrate, deploy) and keep it current. Until then, treat [HANDOFF.md](../../HANDOFF.md)'s phased build order as the source of "what to do next."
