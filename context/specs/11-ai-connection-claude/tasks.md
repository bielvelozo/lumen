---
status: in-progress
feature: ai-connection-claude
created: 2026-06-18
---
# Connect the AI (Claude) — Tasks

A box is checked ONLY after its slice is implemented AND committed.

## 1 — Shared contracts: curated model list + DTOs
- [x] `ai-contracts.ts`: `CLAUDE_MODELS` (verified ids, no date suffix) + `DEFAULT_MODEL`
      (`claude-opus-4-8`); `aiModelSchema` (enum), `AI_CONNECT_ERROR_CATEGORIES` closed set,
      `connectAiRequestSchema` (`apiKey?` + `model`), `aiConnectStateSchema` (NO key). Export
      from index. Tests: default is `claude-opus-4-8`; ids carry no date suffix; non-list model
      rejected.

## 2 — Validator port + AI SDK adapter
- [x] `claude-validator.ts`: `ClaudeValidator` port + `ValidationResult`; `createAiSdkValidator`
      (ai + @ai-sdk/anthropic, minimal completion, bounded timeout, status→category map). Add
      `ai` + `@ai-sdk/anthropic` deps. Tests: status→category mapping via a stubbed call;
      env-gated (`ANTHROPIC_API_KEY`) live smoke skipped + ledgered.

## 3 — Store + service (validate-then-persist)
- [x] `ai-connection.store.ts`: org-scoped getByOrg (incl. encryptedApiKey), getState (no key),
      upsertActive (encrypt+store), setFailed, touchValidated.
- [x] `ai-connection.service.ts`: `connect` (no-store-on-failure / re-key / re-validate rules);
      `getState`. Tests: happy path → active + encrypt called + key never in result; each
      category → failed + sanitized; no-store-on-failure (no row); re-validate reuses stored
      key; transient re-validate no downgrade; model-not-in-list never calls validator.

## 4 — Routes + wiring
- [x] `ai-connection.route.ts`: GET `/ai-connection` (state, no key) + PUT `/ai-connection`
      (connect), requireAuth, org from getAuth. Wire into app.ts AppDeps + server.ts. Tests:
      GET never returns key; PUT maps validation outcomes; no client id selects the connection.

## 5 — Frontend
- [x] `lib/ai-connection.ts` + `-queries.ts`; `ConnectAiPage.tsx` (paste-key write-only form +
      model selector from CLAUDE_MODELS + status/last_validated/sanitized error, never the key);
      router `/connect/ai` + AppShell NavItem. Tests: render + no `org_id` in any request +
      key never displayed.

## 6 — Gate-1 + ship
- [x] `/security-review` on the diff; resolve findings.
- [x] Full suite green: `pnpm build && lint && type-check && test`.
- [x] Mark spec Shipped (MOC + frontmatter) atomically; capture learnings.
