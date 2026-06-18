# DECISIONS.md — Lumen v1 cross-iteration ledger

This file is the durable, cross-iteration record for the autonomous Lumen v1 build
(see `RALPH.md`). It tracks: every Open-Question default taken, every
`[CONFIRM-WITH-HUMAN]` item, every `LIVE-VERIFICATION-PENDING` item, and any
`BLOCKED` / `BUILD-HALTED` stops. ASCII markers only (no emoji/glyphs) so they stay
greppable on Windows. Each entry is keyed `NN-spec | <question>`; update in place,
never duplicate.

Markers: `[CONFIRM-WITH-HUMAN]` `LIVE-VERIFICATION-PENDING:` `BLOCKED:` `RESOLVED:` `BUILD-HALTED:`

---

## Active banners

_None. Build proceeding normally._

---

## Open-question defaults taken

### 00-scaffold | pinned versions of Node / Postgres / MySQL images
2026-06-17 — Node pinned to **22** (engines `>=22 <23`; `.nvmrc` = 22.16.0, the
installed LTS). pnpm pinned to **10.33.0** via `packageManager` + corepack. Docker
images pinned **postgres:16-alpine** and **mysql:8.0** (stable, current). Recorded
as the project version baseline; revisit only as a convention-level change.

### 03-signup | duplicate-email response
2026-06-17 — `[CONFIRM-WITH-HUMAN]` Default: respond with a **uniform,
non-revealing success** (anti-enumeration). Signup with an already-registered email
returns the same "check your inbox" response as a fresh signup; no "email already
in use" leak. Implemented in spec 03. Flagged for human review of UX trade-off.

### 07-08-consent | consent vs `encrypted_password NOT NULL`
2026-06-17 — `[CONFIRM-WITH-HUMAN]` Default: **Option B** — a lightweight
`db_connection_consents` table (`org_id`, `consent_version`, `accepted_at`,
`accepted_by`) written in spec 07; spec 08 reads/gates on it and copies the fields
into `db_connections` on insert. Keeps 07 independently persistable+testable and
keeps `encrypted_password NOT NULL` intact (Option A would make 07's own Success
Criteria unsatisfiable). Flagged for human review.

### 08-connection | over-privileged / root credential handling
2026-06-17 — `[CONFIRM-WITH-HUMAN]` Default: **detect-and-REJECT**. At
connection-create, run `SHOW GRANTS` (or equivalent); if the credential is root or
holds write/DDL/admin privileges, REFUSE to store it and surface the onboarding
script. Warn-and-proceed is NOT permitted (constitution invariant 5). The
`[CONFIRM-WITH-HUMAN]` flag covers only HOW STRICT the privilege check is, never
whether root may be stored. Flagged for human review of strictness threshold.

### 08-connection | TLS strictness to the client MySQL
2026-06-17 — `[CONFIRM-WITH-HUMAN]` Default: encrypted-with-verification where
feasible; never downgrade to plaintext. Finalize certificate handling before
merging spec 08. Flagged for human review.

### 16-deploy | managed Postgres provider
2026-06-17 — `[CONFIRM-WITH-HUMAN]` Default: pick one of **Neon / Supabase**; use
the direct (non-pooled) URL for the migration step and a pooled URL for the app if
needed. Final provider chosen at deploy time. Flagged for human review.

---

## Live-verification-pending (env-gated tests that skip when the resource is absent)

_None yet. As env-gated integration tests are added, each skipped one is recorded
here with the env var that gates it (per RALPH.md sections 2e / 4 / 7-2)._

---

## Blocked / build-halted

_None._
