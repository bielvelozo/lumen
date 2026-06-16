---
status: canonical
created: 2026-06-15
---
# Business Assistant — Constitution

This document declares the non-negotiable principles of the Business Assistant project (provisionally branded **Lumen**). Every agent and every human must read it before making any substantive change. The rules here are not preferences or style suggestions — they are load-bearing decisions where a quiet shortcut becomes a data leak, a wrong number, or a tenant seeing another tenant's data. If you find yourself tempted to violate a rule in this file, stop. Do not silently work around the constitution: open a discussion, get the principle changed in the open, and only then proceed. A rule you route around in code without changing it here is a bug, not a clever solution.

## Why Business Assistant exists

Business Assistant solves one problem: the owner of a business already has the data, but the answer is locked away — behind SQL, behind a spreadsheet, or behind whoever knows how to extract it. The owner asks "how much did I sell in May?" and, today, has to wait for a report or for an analyst. Here they ask in plain natural language and get the exact answer — "R$ 128.000, 12% more than April" — computed against their own live database, on the spot, without writing a line of code.

It is built for owners of small and medium businesses who want answers from their own data without depending on a pre-built report or on someone who can query a database.

The differentiator is the one thing that must never be diluted: this is AI over **structured relational data**, not over documents. The number comes from the database, so it is exact — not a paraphrase, not an approximation, not a hallucination. The product is also deliberately generic: it serves any business with a database. It is not an e-commerce plugin, and it must not collapse into one.

## Scope guardrails

Version 1 is intentionally narrow. The following are the locked v1 boundaries:

- **Client database — MySQL, live, read-only.** In v1 the customer's database is MySQL, external to us. It is queried **live** and **read-only**. It is never copied, and there is **no cache in v1**. The answer always reflects the real current state of the customer's data.
- **AI — Claude, BYO key.** In v1 the model is Claude, used server-side through the Vercel AI SDK. The customer brings their own API key (BYO key); the AI account is theirs, not ours. We never run customer queries against a key we own.
- **Transactional email — Resend.** Email verification and password recovery go through Resend (or an equivalent free-tier provider). Transactional only.

Explicitly **deferred** (out of v1 scope, recorded so it is not re-litigated or accidentally built):

- Inviting additional users per organization / membership (the `member` role exists in the schema but is v2).
- More than one AI provider, or more than one client database, per organization.
- Column-level exposure (v1 exposes at the table level, plus introspection).
- Any caching or copying of the client database.

If a request implies stepping outside these boundaries, treat it as a scope change to be discussed — not as an implementation detail.

## Architecture principles

These are the invariants. They are stated as principles, but they are mandatory and not negotiable in implementation.

1. **Multi-tenant isolation is enforced in the data layer.** Every query is scoped by `org_id`. The `org_id` comes from the JWT — **never** from an id supplied by the client (this is the anti-IDOR rule). The application schema deliberately carries `org_id` down to `messages` and `function_call_logs`, denormalized on purpose, so any query can filter directly by `org_id` without depending on remembering a JOIN. This is defense in depth: one organization sees only its own data, always.

2. **Secrets are encrypted at rest, and Postgres never sees plaintext.** The client database password and the AI API key are stored as encrypted blobs in `bytea` columns. The key that decrypts them lives **outside** the database (environment / secrets manager). Postgres never holds the secret in clear text. Encryption and decryption happen in the application, never in the database.

3. **The model never emits free SQL.** The model only selects among predefined, parameterized, read-only query functions, operating only over the tables the owner explicitly exposed. The **backend** executes the SQL — the model does not. There is no door for arbitrary SQL, so there is nothing to convince the model to do. "Just let the model write this one query" is a constitutional violation, not a feature.

4. **Disposable tokens are stored as hashes, never raw.** Email verification tokens and refresh tokens are stored as a HASH, the same way passwords are. The raw value exists only in the email link or in the httpOnly cookie — never in the database.

5. **The client DB credential is always read-only and never the root user.** The credential is read-only and is created by the customer themselves via the onboarding script. We never ask for, accept, or store the root user. Least privilege at the connection level, by construction.

Supporting facts that frame the above: the application database is **PostgreSQL + Drizzle ORM** (full schema in `db/schema.sql`); the client database is queried live and is external. Connection state is first-class — `status` (`pending` / `active` / `failed`) plus a sanitized `last_error` — never inferred.

These invariants are the embodiment of the product's identity values, which were never decoration — each one became an architecture decision:

- **Privacy and least privilege** — read-only access; the owner chooses which tables the assistant may see; secrets stay encrypted.
- **Precision** — the database does the math, not the model. The right number, every time.
- **Security by construction** — the model only has safe doors: predefined, parameterized functions. Arbitrary SQL is impossible because that door does not exist.
- **Transparency / auditability** — what the assistant queried is logged (auditable per organization), without ever storing the raw underlying data; `function_call_logs.params` and `error_message` are sanitized.
- **Isolation** — each organization sees only its own data, enforced in the data layer.

## Tooling and workflow principles

The stack below is locked. It is recorded here not to invent commands — the repo is pre-implementation, with no `package.json`, no lockfile, and no build/test scripts yet — but so the choices are not re-litigated. Do not fabricate commands or tooling that does not yet exist; do honor these decisions when implementation begins.

- **Frontend:** React SPA with **Vite**, **React Router**, and **TanStack Query**. No Next — the app lives behind login, so SSR earns nothing here. The visual identity is the project's own design system in `design-system/`.
- **Backend:** a dedicated **Node / TypeScript** service (NestJS or Fastify), using the **Vercel AI SDK** to talk to the model. Auth is a **JWT carried in an httpOnly, Secure, SameSite=None cookie**.
- **Observability:** **Sentry** for errors, plus sanitized **function-call logs**. Logs never carry raw customer data.
- **Hosting:** Cloudflare Pages for the frontend; a Docker container on a small VPS for the backend (kills cold starts); managed Postgres (Neon or Supabase) for the application database.

The framework choice between NestJS and Fastify, and the package manager and test runner, are not yet locked — do not invent them. When they are chosen, record the decision so it, too, stops being re-debated.

## Spec-Driven workflow

Before implementing any request, assess whether the solution is obvious. The test: **can you describe the complete solution in one sentence?**

- **If you cannot**, use the Spec Kit flow: brainstorm → `spec.md` → `plan.md` → `tasks.md` → implement. Think before you build.
- **If it is obvious**, go direct — do not ceremony-wrap a one-line change.
- **If it is almost obvious**, with one or two open decisions, ask the user whether to spec it out or go direct. Do not guess on a fork that matters.

Specs are never deleted. Shipped specs remain in `context/specs/` as the historical record of why a thing was built the way it was.

## Knowledge layering

Project-specific knowledge lives in `context/`. Only add notes here for things that are **unique to Business Assistant** — its invariants, its flows, its decisions. Generic engineering patterns are not duplicated into this vault; they belong to the imported skill rule-packs.

`.agents/skills/` holds imported generic skill rule-packs (e.g. `react-best-practices`). That is a separate system from this vault. Do not copy generic guidance out of the skills into `context/`, and do not put Business-Assistant-specific rules into the skills. Keep the two layers distinct.

## What this constitution is not

- It is **not an architecture document**. The evolving technical reasoning and lessons live in `context/_index/learnings.md`.
- It is **not a style guide**. Conventions live in `context/conventions/` — including the one design invariant that belongs at the constitutional level only as a reminder: the glass (glassmorphism) effect appears **only on the chrome** — sidebar, topbar, the chat field, and menus. Data — numbers, tables, answers — always sits on a solid, high-contrast surface. In a data product, legibility beats visual effect; never place a number or reading text on glass.
- It is **not a spec**. Specs live in `context/specs/`.

This document exists to hold the things that would be catastrophic to forget.
