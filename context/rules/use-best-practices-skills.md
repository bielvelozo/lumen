---
tags:
  - rule
  - workflow
severity: important
applies-to:
  - React / frontend code
  - security-sensitive code (auth, secrets, query functions, org_id scoping)
created: 2026-06-15
---
# Always develop with the best-practices skill packs

When writing or reviewing code, apply the project's imported best-practices skill packs as the default playbook — not optional reading. For any React/frontend work, follow **`react-best-practices`** and **`vercel-react-best-practices`**. For anything security-sensitive, follow **`security-best-practices`**.

## Why

The [[../constitution|Constitution]] makes security and precision non-negotiable, and the frontend is the product's entire surface. These packs encode the performance, correctness, and safety patterns the project has decided to standardize on. Applying them on every change is how "security by construction" and a consistent React codebase actually happen, instead of being re-derived — or quietly forgotten — each time. They live in `.agents/skills/` (registered in `skills-lock.json`), a separate layer from this vault.

## How to Apply

- **React / frontend code:** read and apply the relevant rules in `.agents/skills/react-best-practices/rules/` and `.agents/skills/vercel-react-best-practices/rules/` (rendering, re-render, async, bundle, server). Consult them before and during the work.
- **Security-sensitive code** — auth, JWT/cookies, secret encryption, the predefined query functions, `org_id` scoping: follow `.agents/skills/security-best-practices/` (its `SKILL.md` and `references/`). Run it as a check before merging anything touching these areas.
- **Precedence:** these packs guide *how* to write code, but they never override the constitution's hard invariants. If a pack's advice ever conflicts with a constitutional invariant (e.g. multi-tenant `org_id` scoping, no free SQL, secrets out of the DB), the constitution wins.
