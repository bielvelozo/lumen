---
tags:
  - moc
---
# Learnings — Map of Content

Atomic notes about Business Assistant's architecture, patterns, and gotchas. Categorized by tag.

Learnings here are specific to Business Assistant. Code style conventions live in `[[conventions|Conventions MOC]]`.

## `#concept` — Architecture and patterns

_No learnings yet. Add the first one when you discover something non-obvious._

## `#reference` — Environment and commands

- [[../learnings/commands-catalog|Commands catalog]] — build/run commands as the stack matures (pre-implementation today).

## `#gotcha` — Things that tripped us up

- [[../learnings/db-connection-consent-before-credential-tension|`db_connections` can't hold consent before a credential exists]] — consent and `encrypted_password NOT NULL` share one row, so "save consent first" needs a modeling decision (affects specs 07/08/10).
