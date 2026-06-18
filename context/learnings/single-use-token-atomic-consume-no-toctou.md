---
tags:
  - learning
  - concept
related:
  - "[[../specs/04-email-verification/spec]]"
created: 2026-06-18
---
# Single-use token consume = one conditional UPDATE, not read-then-write

Consuming a disposable token (email-verification here; refresh tokens in spec 05) must
be atomic and single-use under concurrency. The robust shape is ONE conditional update
that both claims and reports:

```sql
UPDATE email_verification_tokens
   SET used_at = $now
 WHERE token_hash = $hash AND used_at IS NULL AND expires_at > $now
RETURNING user_id;
```

If it returns a row, this caller won the race — flip the user in the same transaction.
If it returns **0 rows**, the token was already used, expired, or unknown — treat that
as "not consumed here". Never `SELECT ... then UPDATE`: that opens a TOCTOU window where
two concurrent clicks both pass the check and verify twice.

The subtlety: the UX wants to tell a benign double-click (`already_verified`) apart from
a genuinely bad link (`invalid`), but both produce 0 rows. Resolve that with a
**follow-up read that is NOT part of the atomicity guarantee** — look up the token's user
and, if already verified, return `already_verified`; else `invalid`. The atomic flip
already happened (or didn't); this read only chooses the message, so it can't reintroduce
a race.

## Context

Built in spec 04 (`apps/api/src/auth/verification.store.ts`, `consume`). The live
integration test drives the real rollback/replay paths. "Most-recent-wins" reissue uses
the same idea: on issue, `UPDATE ... SET used_at=now WHERE user_id=? AND used_at IS NULL`
invalidates older links before inserting the new one.

## How to Apply

- For any consume-once token, claim it with a single conditional `UPDATE ... WHERE
  <still-valid> RETURNING ...`; branch on affected-rows, never on a prior SELECT.
- Do the dependent write (flip user / rotate session) inside the SAME transaction as the
  claim.
- If you need a richer outcome than win/lose, compute it with a follow-up read AFTER the
  atomic claim — keep the claim itself a single statement.
- Spec 05 refresh-token rotation should reuse this exact pattern (claim-and-rotate).
