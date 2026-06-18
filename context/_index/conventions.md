---
tags:
  - moc
---
# Conventions — Map of Content

Deliberate code style choices that all code in Business Assistant must follow. These are not safety rules (those live in the constitution) and not things learned from incidents (those live in learnings). These are team decisions about how code should look and be structured.

## Code style

- [[../conventions/locked-stack-decisions|Locked stack: Fastify · pnpm + Turborepo · Vitest]] — the framework / package-manager / test-runner forks the constitution left open are now decided; build on Fastify, a pnpm+Turborepo monorepo (`apps/web`, `apps/api`, `packages/shared`), and Vitest.

## UI / design

- [[../conventions/glass-only-on-chrome|Glass only on the chrome; data on solid surfaces]] — the glassmorphism effect is confined to topbar / sidebar / chat field / menus; numbers and reading text always sit on solid, high-contrast surfaces.
