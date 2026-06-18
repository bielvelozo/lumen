---
tags:
  - learning
  - concept
related:
  - "[[../specs/07-db-connection-consent-and-script/spec]]"
created: 2026-06-18
---
# The onboarding script is least-privilege BY CONSTRUCTION (not by trust)

Constitution invariant 5 (read-only, never-root client credential) is enforced at the
source: the server-generated MySQL onboarding script only ever EMITS `CREATE USER` +
`GRANT SELECT` + `FLUSH PRIVILEGES`. There is no code path that emits a broader privilege,
a DDL grant, `GRANT OPTION`, `ALL PRIVILEGES`, or a `root` user — so the recipe we ship is
correct by construction. We can't police what the customer actually runs, but we ship a
provably-minimal script and say so explicitly in comments.

Two practical points:

1. **Test the generator with an allow-list AND a deny-list.** Assert the required
   statements are present, and assert the forbidden privileges/DDL/`root` are absent. The
   grant is scoped to `` `<db>`.* `` (or a clearly-commented placeholder) — never `*.*`
   (a silent global grant).
2. **Strip comments before the deny-list check.** Helpful warnings ("do not broaden these
   grants", "never use root") would otherwise trip a naive `not.toContain('root')`. The
   test filters out `--`/`#` comment lines and runs the deny-list on the EXECUTED SQL only;
   the `root`-definition check uses a regex (`/CREATE USER\s+['"\`]?root/i`) so the word may
   still appear in a warning.
3. **Validate embedded identifiers.** username/databaseName are validated to
   `^[A-Za-z0-9_]+$` (shared `sqlIdentifierSchema`) before being interpolated into the SQL —
   no injection into the generated script, even though the customer runs it themselves. No
   password is ever generated/received/stored (the script tells the owner to set their own).

## Context

Built in spec 07 (`apps/api/src/db-connection/onboarding-script.ts` + its test). The same
"least privilege, verified" posture carries into spec 08, which must **detect-and-REJECT**
a root/over-privileged credential at connection-create (`SHOW GRANTS`) rather than trusting
that the customer used this script.

## How to Apply

- For any generated/emitted SQL or command, make the safe shape the ONLY shape the code can
  produce; verify with allow+deny-list tests over the comment-stripped output.
- Spec 08: do not trust that the credential is read-only — verify it server-side and refuse
  root/write/DDL/admin/`GRANT OPTION` before storing (invariant 5 is a BLOCKED stop).
