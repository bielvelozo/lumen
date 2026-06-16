# Business Assistant — Agent Instructions

Business Assistant (provisional product name: **Lumen**) is a dashboard where a business owner connects their own database and an AI, then asks natural-language questions that are answered over their live, structured business data — type "quanto vendi em maio?" and get an exact figure computed against the real database on the spot. The differentiator is the AI layer over **structured relational data** (a relational database, not documents), so the numbers come straight from the database and are exact. The stack: a React SPA (Vite) on the front; a dedicated Node/TypeScript backend (NestJS or Fastify) using the Vercel AI SDK to talk to the model; PostgreSQL + Drizzle ORM for the application database; the client's own MySQL as a live, read-only database in v1; and Claude via a bring-your-own (BYO) key used server-side. This repo is currently at the planning/spec stage: `projeto.md` and `HANDOFF.md` are the source of truth, `db/schema.sql` is the application schema, `design-system/` holds the visual identity, `.agents/` holds imported generic skill packs, and `context/` holds the project knowledge vault.

## Before starting any work
1. Read `context/_index/home.md` for project-specific knowledge.
2. Read `context/constitution.md` for non-negotiable principles.
3. If the user asks you to implement, modify, or create something, assess: **"Can I describe the complete solution in one sentence?"**
   - **Yes** → implement directly.
   - **No** → invoke `brainstorming` → `spec.md` → `writing-plans` → `plan.md` + `tasks.md` → implement.
   - **Almost** (1–2 open decisions) → ask the user whether to spec or go direct.

   If the user is asking a question, investigating, or exploring — just answer.

## Non-negotiable invariants (do NOT violate)
These come from `HANDOFF.md`. Every change must respect them.

1. **Multi-tenant isolation.** Every query is scoped by `org_id`. The `org_id` comes from the JWT, never from an id sent by the client (anti-IDOR). The schema carries `org_id` even on `messages` and logs, on purpose, to make this scoping easy.
2. **Secrets.** The client's database password and the AI key are stored encrypted at rest (`bytea` columns: `encrypted_password`, `encrypted_api_key`). The decryption key lives **outside** the database (env / secrets manager). Postgres never sees the secret in plaintext.
3. **No free SQL.** The model NEVER emits arbitrary SQL. It only chooses among pre-defined, parameterized, read-only query functions that run solely over the tables the owner exposed. The backend executes the SQL, not the model.
4. **Hashed tokens.** Tokens (email verification, refresh) are stored as a HASH, never raw. The raw value only exists in the email link / the httpOnly cookie.
5. **Read-only client credential.** The client database credential is always read-only, created by the client via the onboarding script. Never request or store a root user.
6. **Glass only on the chrome.** The frosted-glass (glassmorphism) effect appears only on the frame (sidebar, topbar, chat field, menus). Data (numbers, tables, answers) always lives on a solid, high-contrast surface.

## After completing any task
If you discovered something non-obvious — a gotcha, a constraint, a surprising behavior — create an atomic note in `context/learnings/` using `context/templates/learning.md`, and link it to the relevant spec with a wikilink. Do this without asking permission.

## After completing a spec
This is the explicit reflection step. Do not skip it.
1. Ask yourself: **"what did I learn implementing this that wasn't obvious from the spec?"** — gotchas, constraints, surprising library behavior, decisions that got reversed.
2. If there is at least one useful learning, create one atomic note per learning in `context/learnings/` following `context/templates/learning.md`, link each back to the spec folder, and add each to `context/_index/learnings.md`.
3. If nothing non-obvious came up, say so explicitly in your final report. Silence is not reflection.

## Commands (most used)
The repo is **pre-implementation**: there is no `package.json` yet, so there are no established build, test, or lint commands — do not invent npm/pnpm scripts. The intended stack, per `HANDOFF.md`, is Vite for the front (React Router + TanStack Query), a dedicated Node/TypeScript service for the back (NestJS or Fastify) using the Vercel AI SDK, and Drizzle migrations run against PostgreSQL. Until tooling is scaffolded, treat `HANDOFF.md`'s phased build order as the current "what to do next" guide:

1. Base & auth: Postgres + Drizzle + migrate the schema; signup, login, email verification (Resend), JWT in a cookie; front shell with the design system and theme toggle.
2. Connect the client DB (MySQL): consent/terms, read-only onboarding script, collection, connection test, encryption, introspection, choosing exposed tables; connection states (`pending`/`active`/`failed` + `last_error`).
3. Connect the AI (Claude): paste the token, validate with a test call, encrypt, set the default model.
4. Chat (the core): orchestrator with the AI SDK + 1–2 parameterized query functions + streaming + saving messages + logging function calls; handle the unhappy paths.
5. Observability (Sentry), polish & deploy (Cloudflare Pages + Docker container on a VPS + Neon/Supabase).

Full command catalog: `context/learnings/commands-catalog.md` (a placeholder today; kept current as the build matures).

## Knowledge locations
| What you need | Where it lives |
|---|---|
| Non-negotiable principles | `context/constitution.md` |
| Specs (active + shipped) | `context/specs/` |
| Architecture, patterns, gotchas | `context/learnings/` (indexed by `context/_index/learnings.md`) |
| Code style conventions | `context/conventions/` (indexed by `context/_index/conventions.md`) |
| Project-specific rules | `context/rules/` (indexed by `context/_index/rules.md`) |
| Spec template | `context/specs/_template/` |
| Note templates | `context/templates/` |
| Product identity (what it is, who for, values, visual direction) | `projeto.md` |
| Locked stack, invariants & build order | `HANDOFF.md` |
| App DB schema (PostgreSQL) | `db/schema.sql` |
| Visual identity (tokens, components, preview) | `design-system/` |

## Claude Code skills and commands
Skills live in `.claude/skills/`; commands live in `.claude/commands/`. Together they provide the project's agentic workflow.

- **brainstorming** (skill) — design exploration before a spec.
- **writing-plans** (skill) — turn an approved design into a task list.
- **recall** (skill) — quick reconnaissance of the `context/` vault.
- **/open-pr** (command) — REQUIRED command to open pull requests, with an auto-generated title and description. Always use it when creating a PR.
- **/learn** (command) — investigate a topic and save the findings as a learning note in `context/learnings/`.
- **/spec** (command) — take the current conversation into the spec flow, skipping questions that have already been discussed.
