---
tags:
  - rule
  - workflow
severity: important
applies-to:
  - auth, sessions, JWT / cookies
  - secret handling (encryption, key management)
  - the client-DB and AI-key connection flows
created: 2026-06-15
---
# Run a security review before merging auth or secret changes

Any change that touches authentication, session/cookie handling, secret encryption or key management, or the client-database / AI-key connection flows must pass an explicit security review before it merges.

## Why

These are the highest-blast-radius areas in the product: a mistake leaks credentials, breaks tenant isolation, or exposes a secret the [[../constitution|Constitution]] requires to stay encrypted and out of the database. The best-practices packs ([[use-best-practices-skills]]) raise the floor during development, but security-sensitive diffs deserve a deliberate second pass that looks specifically for these failure modes before they ship.

## How to Apply

- Before merging a diff that touches the areas above, run the `security-review` skill (`/security-review`) on the branch and resolve its findings.
- Apply `security-best-practices` (see [[use-best-practices-skills]]) while writing the code, not only at review time.
- Re-verify the relevant constitutional invariants by hand: secrets stay in `bytea` with the decryption key outside the DB, tokens are stored hashed, and the client credential is read-only and never the root user.
- If the review surfaces something that cannot be resolved within the diff, do not merge — open a discussion.
