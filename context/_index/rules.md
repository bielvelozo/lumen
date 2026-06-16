---
tags:
  - moc
---
# Rules — Map of Content

Business Assistant-specific safety and workflow rules.

**Nothing here yet.** Rules are added when a project-specific safety or workflow constraint is discovered.

## `severity: critical`

- [[../rules/data-access-review-gates|Data-access review gates: org_id from the JWT, never free SQL]] — block any change that derives `org_id` from the client or lets the model emit SQL.

## `severity: important`

- [[../rules/use-best-practices-skills|Always develop with the best-practices skill packs]] — apply `react-best-practices` + `vercel-react-best-practices` for React/frontend, and `security-best-practices` for security-sensitive code.
- [[../rules/security-review-before-merge|Run a security review before merging auth or secret changes]] — `security-review` must pass on any diff touching auth, secrets, or the connection flows.

## `severity: advisory`

_(none yet)_
