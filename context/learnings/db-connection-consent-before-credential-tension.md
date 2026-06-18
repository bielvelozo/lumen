---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/07-db-connection-consent-and-script/spec]]"
  - "[[../specs/08-db-connection-create-and-test/spec]]"
created: 2026-06-17
---
# `db_connections` can't hold consent before a credential exists

The `db_connections` table makes both the consent columns (`consent_version`, `consent_accepted_at`) **and** the connection columns (`host`, `port`, `database_name`, `username`, `encrypted_password bytea`) `NOT NULL` on the **same row**. Flow 2 wants the owner to accept terms *before* any credential is collected — but there is no row you can legally `INSERT` to record that consent until you already have the host/port/user/password. The two halves of Flow 2 (`07` consent, `08` credential) therefore can't be persisted in the order the flow presents them without a modeling decision.

## Context

Surfaced while writing the implementation specs for Flow 2 (connect the client MySQL DB). Spec `[[../specs/07-db-connection-consent-and-script/spec]]` owns consent + the read-only onboarding script ("nothing secret yet"); spec `[[../specs/08-db-connection-create-and-test/spec]]` owns the credential, encryption, and the live test. The schema (`db/schema.sql`) co-locates consent and credential on one `NOT NULL`-heavy row, so "save consent first" collides with the `encrypted_password NOT NULL` constraint. Captured as an Open Question in spec `07`.

## How to Apply

Decide this before implementing `07`/`08` (it changes the data model, so resolve it deliberately, not in passing):

- **Option A — one atomic step (lowest schema churn):** treat consent as a required *field of the same submission* that creates the connection. The UI gates the credential form behind the consent checkbox, and `08`'s create endpoint writes consent columns + encrypted credential together in a single `INSERT`. Consent is still auditable (`consent_accepted_by`, `_at`, `_version`), just recorded at credential-creation time, not before.
- **Option B — separate the lifecycles:** make the credential columns (`encrypted_password`, `host`, `port`, `database_name`, `username`) nullable so a `db_connections` row can exist in a pre-credential `pending` state holding only consent, or move consent to its own table keyed by `org_id`/`db_connection_id`. More faithful to "consent strictly precedes credential," but it's a schema change and weakens the `NOT NULL` guarantees `08` relies on.

Default lean: **Option A** — it keeps the schema as-is and the `NOT NULL` invariants intact, and "consent recorded atomically with the connection it authorizes" is still fully auditable. Only choose B if the product genuinely needs a persisted consent record that outlives an abandoned (never-credentialed) connection attempt. Whichever is chosen, record it as a convention so `07`, `08`, and `[[../specs/10-connect-db-ui/spec]]` agree.

## RESOLVED (2026-06-18, spec 07)

Chosen: **Option B**, via a *separate* `db_connection_consents` table (NOT nullable
credential columns). The reasoning that flipped the default: Option A makes spec 07's OWN
success criterion ("accepting terms persists `consent_version`/`_at`/`_by`") unsatisfiable —
no `db_connections` row can exist before `08` supplies the `NOT NULL` `encrypted_password`,
so there is nothing to write at the consent step. The new table (`org_id`, `consent_version`,
`accepted_at`, `accepted_by`; `unique(org_id, consent_version)`; migration `0001`) keeps 07
independently persistable + testable and leaves `db_connections.encrypted_password NOT NULL`
intact. Spec 08 reads/gates on it (`hasCurrentConsent`) and copies the fields into the
`db_connections` row on insert. No placeholder secret is ever written.
