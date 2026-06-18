---
tags:
  - learning
  - concept
related:
  - "[[../specs/08-db-connection-create-and-test/spec]]"
created: 2026-06-18
---
# Verify "read-only" with an allowlist, never a denylist

The connection tester rejects a client-DB credential that is over-privileged (invariant 5).
The first cut used a DENYLIST (`INSERT`, `UPDATE`, `DROP`, `SUPER`, …) — and the Gate-1
security review caught the hole: **MySQL 8 expresses many admin powers as *dynamic*
privileges** (`SYSTEM_USER`, `BACKUP_ADMIN`, `CONNECTION_ADMIN`, `ROLE_ADMIN`, …) on their
own `GRANT … ON *.* …` line, plus `PROXY`. A `SELECT`-looking line next to a dynamic-admin
line would slip through a fixed denylist. A denylist of privileges is unwinnable: the set
grows with every server version.

The fix is **deny-by-allowlist**: parse the privilege list of each `SHOW GRANTS` line and
treat the credential as over-privileged unless EVERY token is in a tiny safe set
(`SELECT`, `USAGE`, `SHOW VIEW`). That structurally rejects all present and future write/
DDL/admin/dynamic privileges, `ALL PRIVILEGES`, `PROXY`, and `GRANT OPTION` — including ones
that didn't exist when the code was written. Two parsing details: only inspect the part
before the first ` ON ` (so a table named `insert_logs` isn't a false positive), and strip
`(col, …)` column lists (so a column-scoped `SELECT (a,b)` stays safe while `INSERT (c)` is
still caught). Any line that isn't `GRANT … ON …` shaped → reject (fail-safe).

The matching design rule for the credential lifecycle: **test before you persist**. Because
`db_connections.encrypted_password` is `NOT NULL`, you can't "store then reject"; instead
connect + check grants FIRST, and only `encrypt()` + upsert if read-only. An over-privileged
credential is therefore never written to `encrypted_password` at all (→ 422).

## Context

`apps/api/src/db-connection/grants.ts` (+ test) and `db-connection.service.ts`. Verified
against real MySQL 8 (root → rejected; SELECT-only user → accepted).

## How to Apply

- For any "is this safe/minimal?" gate (privileges, scopes, capabilities), allowlist the
  safe set and reject everything else — never enumerate the dangerous set.
- Validate the credential/level BEFORE persisting an irreversible secret; reject paths must
  not write the secret.
- This read-only posture carries into specs 09 (introspection only over exposed tables) and
  12/13 (the query functions are SELECT-only by construction).
