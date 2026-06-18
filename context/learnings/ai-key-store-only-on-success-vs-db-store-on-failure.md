---
tags:
  - learning
  - concept
related:
  - "[[../specs/11-ai-connection-claude/spec]]"
  - "[[../specs/08-db-connection-create-and-test/spec]]"
created: 2026-06-18
---
# The AI key is stored ONLY on success — the inverse of the DB password (stored on failure too)

Both `db_connections.encrypted_password` (spec 08) and `ai_connections.encrypted_api_key`
(spec 11) are `bytea NOT NULL` secrets, validated by a live call before use. But their
persistence rules are **opposite**, and getting them backwards corrupts the connection state:

- **spec 08 (client DB):** test-then-store ALWAYS. A wrong password still persists the row
  with `status='failed'` — because the owner must be able to **re-test without re-typing the
  password** (the stored ciphertext is decrypted for the retest). Only a root/over-privileged
  credential is rejected and never stored (invariant 5).
- **spec 11 (Claude key):** validate-then-store **only on success** ("don't store a key we
  just proved is dead", spec 11). Because the column is `NOT NULL`, a **first-time** failure
  therefore persists *nothing* (no row) — so the sanitized failure category is returned in the
  mutation response only; a subsequent `GET` shows "not configured."

That `NOT NULL` + store-only-on-success combination forces three rules that don't exist in
spec 08:

1. **First-time failure → no row.** Can't insert without a key, and we won't store a dead one.
2. **Failed re-key on an EXISTING active connection → never overwrite the stored ciphertext
   and never downgrade.** A typo in a new key must not disconnect a working assistant.
3. **Re-validating the STORED key** (no paste — e.g. a model change) is the only path that can
   downgrade `active → failed`, and only on a *permanent* category. Transient categories
   (`rate_limited` / `network`) leave the status untouched so a provider blip doesn't
   disconnect (open-question default #4).

## How to Apply

- When a secret column is `NOT NULL`, decide per-feature whether failure persists: if retest
  needs the secret (08) store on failure; if storing a proven-dead secret is wrong (11) store
  only on success and carry the failure in the response, not the row.
- Spec 13 (chat) decrypts `ai_connections.encrypted_api_key` per request — it can trust that a
  row with `status='active'` has a key that validated at least once, and that a failed re-key
  never silently replaced a good key. The two stores share the `getByOrg`-returns-ciphertext +
  `getState`-omits-it split — see [[org-id-only-from-requireauth-getauth]] for the org seam.
