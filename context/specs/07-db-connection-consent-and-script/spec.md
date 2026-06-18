---
status: draft
feature: db-connection-consent-and-script
created: 2026-06-17
shipped: null
---
# DB Connection — Consent & Onboarding Script — Spec

**Status:** Draft
**Scope:** The first half of Flow 2 — capture the owner's explicit consent to the terms of connecting their database, then generate a copy-pasteable **read-only MySQL onboarding script** the customer runs on their own server to create a dedicated, least-privilege user. No credential is collected, tested, or stored here.

## Context

Flow 2 connects the customer's own MySQL database to the assistant. Before we ever touch a credential, two gates must clear. First, **informed consent**: the owner must understand and accept what they are authorizing — read-only access, that *they* choose which tables the assistant may see, and that any secret they later provide is encrypted at rest. Second, **least privilege by construction**: the customer must not hand us a root user. Per `[[../../constitution|Constitution]]` (invariant 5) and `HANDOFF.md`, the client DB credential is **always read-only and is created by the customer themselves** via an onboarding script — we never ask for, accept, or store the root user. This spec owns those two gates: the consent record on `db_connections` (`consent_version`, `consent_accepted_at`, `consent_accepted_by`) and a **server-generated** MySQL script that creates a `SELECT`-only user.

This is deliberately the "nothing secret yet" slice. Consent is durable application state; the script is rendered guidance the customer executes on *their* machine. The actual credential — host, port, username, password, SSL — is collected, encrypted, and tested in `[[../08-db-connection-create-and-test/spec|08]]`, surfaced by the UI in `[[../10-connect-db-ui/spec|10]]`. Depends on `[[../05-login-jwt-sessions/spec|05]]` (auth context / `org_id` from JWT) and `[[../06-web-shell-and-auth-ui/spec|06]]` (the app shell this lives inside).

## Problem Statement

A business owner is about to point us at their production database. Two things must be true before any credential exists: (1) they have explicitly and auditably accepted the terms of that access, and (2) they have an exact, safe recipe to mint a dedicated read-only user on their own server — so the credential they later give us is least-privilege *by construction*, not by trust. Today there is no consent capture and no script generator. We need an endpoint/flow that records consent (scoped to the org, attributed to the user, versioned) and an endpoint that produces a correct, parameterized, copy-pasteable `CREATE USER` + `GRANT SELECT` MySQL script — and we need to do this without prompting for, receiving, or persisting any secret or any root credential.

## Non-Goals

- **Collecting, encrypting, or testing the credential.** The credential form, `encrypted_password`, the live connection test, and `status` transitions (`pending` → `active`/`failed` + `last_error`) all belong to `[[../08-db-connection-create-and-test/spec|08]]`.
- **Introspection and table/relationship exposure** (`exposed_tables`, `exposed_relationships`) — that is `[[../09-introspection-and-exposure/spec|09]]`.
- **The full connect-DB UI / wizard** — `[[../10-connect-db-ui/spec|10]]`. Here we define only the two surfaces this slice needs: the consent screen and the script-display panel.
- **Executing the script for the customer.** We never SSH in, never run it, never see its output. It is theirs to run.
- **Multiple connections per org, non-MySQL engines, password recovery.** v1 is one MySQL connection per org; the script targets MySQL only.

## Constraints

- **`org_id` from the JWT, never the client (invariant 1).** Consent is written for the org derived from the authenticated session. No org id is accepted from the request body. `consent_accepted_by` is the authenticated user's id.
- **No secret persisted at this step (invariant 2, by omission).** This slice writes only non-secret columns. `encrypted_password` is `NOT NULL` in the schema, so consent **cannot** be persisted by inserting a partial `db_connections` row. Resolve via one of: (a) hold consent in a short-lived pending state and write the full `db_connections` row only in `08` (carrying the consent fields forward), or (b) make consent its own lightweight record. See Open Questions — the chosen path must not weaken invariant 2 and must not require a placeholder/empty `encrypted_password`.
- **Read-only credential, never root (invariant 5).** The generated script uses **`GRANT SELECT` only** — no `INSERT`/`UPDATE`/`DELETE`, no DDL (`CREATE`/`ALTER`/`DROP`), no `GRANT OPTION`, no `ALL PRIVILEGES`, no admin/`*.*` global grants. It creates a *new* dedicated user; it never references or requires `root` as the resulting credential. The script is the construction mechanism for least privilege.
- **Script is generated server-side and merely displayed.** The customer-facing values it embeds (a suggested username, an optional database name to scope the grant, host pattern) are non-secret. The script must instruct the customer to choose their **own** strong password locally — we never generate, request, transmit, or store that password here.
- **Consent is versioned and immutable as written.** `consent_version` pins the exact terms text the owner saw. If terms change later, a new version is shown and re-accepted; we never silently re-map an old acceptance to new text.
- **Consent text scope (high level, not legal final copy).** The accepted terms must, at minimum, state: access is **read-only**; the **owner chooses** which tables the assistant can see (nothing is exposed by default); any credential provided is **encrypted at rest** and the decryption key lives outside the database; the connection can be revoked. Exact legal wording is out of scope for this spec.
- **Backend = Fastify + TS; validation via Zod in `packages/shared`** (per `[[../00-monorepo-scaffold/spec|00]]`). The script template lives server-side; the consent DTO is a shared Zod contract.
- **Glass only on chrome (invariant 6).** The script block is *data the owner must read and copy exactly* — render it on a solid, high-contrast surface (a code panel), never on glass. Only the surrounding frame may use the glass effect.

## User Stories / Scenarios

1. **Owner reviews and accepts terms.** An authenticated owner who has not yet connected a DB lands on the consent screen, reads the plain-language terms (read-only, owner-chosen tables, encrypted secrets, revocable), and clicks Accept. The backend records the acceptance against their org (`consent_version`, `consent_accepted_at = now()`, `consent_accepted_by = <user>`), all derived server-side. They may now proceed toward the credential step (owned by `08`).
2. **Owner cannot proceed without consent.** A user who tries to reach the credential step (`08`) without a recorded, current-version consent for their org is blocked/redirected back to the consent gate.
3. **Owner generates the read-only script.** After (or alongside) consent, the owner requests the onboarding script. The server returns a MySQL script containing `CREATE USER` + `GRANT SELECT` (optionally scoped to a database name the owner typed), with placeholders for the owner's chosen password and clear inline comments. The owner copies it, runs it on their MySQL server, and now has a dedicated read-only user — without ever sending us a password or using root as the connection user.
4. **Owner scopes the grant to one database.** The owner provides a database name; the generated `GRANT SELECT` is scoped to `` `that_db`.* `` rather than a broader grant — tightening least privilege further. With no database name given, the script clearly comments where to insert it and does not silently grant globally.
5. **Terms changed since last acceptance.** An owner who accepted `v1` returns after terms moved to `v2`; the system detects the stale `consent_version` and requires re-acceptance before the credential step.
6. **No secret leaks at this step.** Throughout consent + script generation, no password, no root credential, and no encrypted blob is created or stored. Inspecting the DB after this step shows at most a consent record — never a secret.

## Success Criteria

- Accepting terms persists `consent_version`, `consent_accepted_at`, and `consent_accepted_by` scoped to the org from the JWT; the request body carries **no** org id and none is honored if sent.
- The credential step (`08`) is gated on a present, current-version consent for the org; a missing or stale consent blocks progression (scenario 2 & 5).
- The script endpoint returns a syntactically valid MySQL script that contains exactly `CREATE USER` and `GRANT SELECT` (plus `FLUSH PRIVILEGES`), and contains **none** of: `ALL PRIVILEGES`, `GRANT OPTION`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`, `SUPER`, a `root` user definition. A test asserts these positively and negatively.
- When a database name is supplied, the grant is scoped to `` `<db>`.* ``; when omitted, the script contains a clearly-commented placeholder and is never globally scoped silently.
- The script instructs the owner to set their **own** password locally; the server never generates, receives, logs, or stores that password. No secret column is written by any endpoint in this spec.
- Consent text shown to the user covers, at minimum, the four scope points (read-only, owner-chosen tables, encryption at rest, revocable) and is pinned to the `consent_version` recorded.
- The script panel renders on a solid surface (not glass), is copy-to-clipboard friendly, and the consent + script DTOs are validated by shared Zod schemas.
- Unit tests cover: org-scoping of consent (anti-IDOR), version gating, and the script allow/deny-list above. No test requires a real MySQL connection (that lands in `08`).

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `encrypted_password` is `NOT NULL`, so persisting consent on a bare `db_connections` row is impossible without a placeholder secret — tempting a weakening of invariant 2 | Do **not** insert a dummy/empty `encrypted_password`. Either keep consent in a pending state and write the full row in `08`, or model consent as its own record. Decide in Open Questions; whichever path, no placeholder secret is ever written. |
| Owner edits the script and grants more than `SELECT` (or runs it as / for root) | Lock the grant scope in the template; add prominent inline comments warning against widening privileges or using root; the test suite enforces the allow/deny-list on what *we* emit. We cannot police what they run, but we ship a correct, least-privilege recipe and say so explicitly. |
| Consent becomes a meaningless click-through (no real informed consent) | Terms are plain-language and enumerate the four concrete scope points; `consent_version` pins exact text; re-acceptance is forced on version change so consent always maps to terms actually shown. |
| Stale `consent_version` silently honored after terms change | Gate the credential step on *current* version, not merely "any consent exists"; scenario 5 is a tested path. |
| A future engine (Postgres client DB) reuses this script generator and emits MySQL-only syntax | Keep the generator keyed on `engine` (v1: `'mysql'` only) and template per-engine; out of scope to implement non-MySQL, but the seam is explicit so it does not rot. |
| Script display accidentally rendered on glass, hurting legibility of a string the owner must copy exactly | Enforce invariant 6: code panel on a solid, high-contrast surface; covered by the design review for `[[../10-connect-db-ui/spec|10]]`. |

## Open Questions

- [NEEDS CLARIFICATION: where consent lives before `08` writes the row] — Given `encrypted_password NOT NULL`, should consent (a) be held in a short-lived pending/session state and copied into the `db_connections` row when the credential is saved in `08`, or (b) be its own lightweight record (e.g., a `db_connection_consents` table or a nullable pre-row) that `08` then references? Default lean: carry consent forward into the single `db_connections` insert in `08` (no schema change, no placeholder secret), but confirm before building.
- [NEEDS CLARIFICATION: source of truth and storage of the terms text per `consent_version`] — is the terms copy a versioned asset in the repo, a row in the DB, or a constant in `packages/shared`? Whatever it is, the version string the user accepts must deterministically map to exact text.
- [NEEDS CLARIFICATION: MySQL host scope for the created user] — should the generated `CREATE USER 'app_ro'@'%'` default to `'%'` (any host) for simplicity, or prompt the owner for the app's egress IP/CIDR to tighten it? `'%'` is easier but looser; an IP-scoped host is tighter least privilege. Default lean: `'%'` with a clear comment on how to restrict, since our egress IP is not yet pinned (`[[../16-deploy/spec|16]]`).
- [NEEDS CLARIFICATION: whether to suggest enforcing `REQUIRE SSL` in the `CREATE USER` script] — the schema defaults `ssl_enabled = true`; should the script include `REQUIRE SSL` so the read-only user is SSL-only at the server level, or leave SSL purely as a connection-time setting handled in `08`? Default lean: include it as a commented, recommended option.
