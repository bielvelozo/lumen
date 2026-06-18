---
tags:
  - learning
  - concept
related:
  - "[[../specs/03-signup-and-org/spec]]"
created: 2026-06-18
---
# Signup's duplicate-email path IS the rollback-atomicity proof

Signup creates two rows in one Drizzle transaction — `organizations` then the owner
`users` — and handles a duplicate email by relying on the DB `UNIQUE(email)`
constraint, NOT a racy pre-`SELECT`. The non-obvious payoff: these two requirements
collapse into one mechanism. When a duplicate email arrives, the org insert succeeds
but the owner insert raises Postgres `23505`; because both run inside the same
`db.transaction(...)`, the throw rolls back the **org insert too**. So the natural
duplicate case is a real, induced mid-transaction failure — you don't need to
fabricate one to prove atomicity. The store catches `23505` and returns
`{ outcome: 'duplicate' }`; the service maps that to the same uniform 201 as a fresh
signup (anti-enumeration).

The integration test exploits this: insert email X (created), then insert email X
again with a *different* org name (duplicate) and assert (a) the org count is
unchanged and (b) no org with the second name exists — one test that proves
duplicate-handling, UNIQUE enforcement, AND rollback atomicity together.

## Context

Built in spec 03 (`apps/api/src/auth/signup.store.ts` + its live integration test).
The same create-then-detect-conflict shape recurs in specs 08 (one db_connection per
org) and 11 (one ai_connection per org), so prefer the DB constraint + transaction
over a pre-check there too.

## How to Apply

- For multi-row "create a tenant/connection" writes, wrap them in one transaction and
  let a DB `UNIQUE`/constraint violation be the conflict signal — catch the specific
  SQLSTATE (`23505` for unique) and translate it; never pre-`SELECT` (racy) and never
  swallow a non-unique error as "duplicate".
- Detect the violation structurally (`error.code === '23505'`), not by string-matching
  the message.
- To test rollback atomicity, drive the *real* conflicting insert rather than mocking
  a mid-transaction crash — it exercises the actual rollback path the DB takes.
- Keep the conflicting branch's externally observable response byte-identical to the
  success branch when the constitution calls for anti-enumeration.
