---
status: in-progress
feature: ai-connection-claude
created: 2026-06-18
---
# Connect the AI (Claude) — Implementation Plan

Implements `[[spec]]`. Flow 3: the owner pastes a Claude API key; the backend validates it
with a real minimal completion via the **Vercel AI SDK** (Anthropic provider), encrypts it
(spec 02) into `ai_connections.encrypted_api_key` (`bytea`), records `provider='claude'`, a
`default_model` from the curated list, and first-class state (`status`/`last_validated_at`/
sanitized `last_error`). Backend + a small frontend. **Gate-1 (security-review) spec.**

## Invariants this spec must hold (constitution 1/2 + spec 11)

- **Secret at rest:** the key is encrypted via spec 02 and stored only in
  `encrypted_api_key`; plaintext exists in memory only for the validation call, then dropped.
  NEVER logged, NEVER returned by any endpoint.
- **Anti-IDOR:** every `ai_connections` read/write is scoped by `org_id` from `getAuth` only —
  no client-supplied id ever selects the connection (one connection per org).
- **Sanitized failures:** raw provider text is never persisted or returned — only a closed
  category set reaches `last_error`.

## Architecture

```
packages/shared/src/ai-contracts.ts        # CLAUDE_MODELS (verified ids) + DEFAULT_MODEL;
                                            #   aiModelSchema (enum), aiConnectStateSchema,
                                            #   connectAiRequestSchema (apiKey? + model),
                                            #   AiConnectErrorCategory closed set
apps/api/src/ai-connection/
  claude-validator.ts        # ClaudeValidator PORT: validate(apiKey, model) -> result.
                             #   createAiSdkValidator() = ai + @ai-sdk/anthropic adapter,
                             #   minimal completion (maxOutputTokens ~4, bounded timeout),
                             #   maps provider HTTP status -> closed category. CI uses a fake.
  ai-connection.store.ts     # org-scoped: getByOrg (incl. encryptedApiKey for re-validate),
                             #   getState (NO key), upsertActive (encrypt+store), setFailed,
                             #   touchValidated(model)
  ai-connection.service.ts   # connect(orgId, {apiKey?, model}): validate-then-persist with
                             #   the no-store-on-failure / re-key / re-validate rules; getState
  ai-connection.route.ts     # GET /ai-connection (state, no key); PUT /ai-connection (connect)
apps/api/src/app.ts + server.ts            # wire aiConnection into AppDeps
apps/web/src/lib/ai-connection.ts + -queries.ts   # typed fns + query/mutation (no org_id)
apps/web/src/routes/connect-ai/ConnectAiPage.tsx  # paste-key form + model selector + status
apps/web/src/router.tsx + routes/AppShell.tsx     # /connect/ai route + sidebar NavItem
```

## Behavior (recorded in DECISIONS.md)

- **Model list:** verified ids `claude-opus-4-8` (default), `claude-sonnet-4-6`,
  `claude-haiku-4-5` — exact aliases, no date suffixes; single source in `packages/shared`.
  Submitting a model outside the list is rejected by Zod before any provider call.
- **Mapping:** 401/403→`invalid_key`, 404→`model_unavailable`, 429→`rate_limited`,
  timeout/5xx/529→`network`, else→`unknown`. Raw text discarded.
- **Persistence:** new key stored ONLY on success; first-time failure persists nothing
  (category returned in the response). On an existing row a failed re-key never overwrites
  the ciphertext. Re-validate stored key: success→active(+model); permanent failure→failed;
  transient failure→status unchanged (no downgrade), category surfaced in the response.
- **State transitions:** new/edited → `pending` conceptually; success → `active` +
  `last_validated_at=now` + `last_error=null`; failure → `failed` + sanitized `last_error`
  (last_validated_at unchanged), per the persistence rules above.

## Gate-1 / verification

- `/security-review` on the diff; resolve findings before Shipped.
- Tests (Vitest, provider mocked): happy path → active + key encrypted; each category →
  mapping + `status=failed`; **no-store-on-failure**; **key never serialized** (GET + any
  response greps clean of the key); **org-scoping** (getAuth only, no client id path);
  **model-not-in-list rejected** before any provider call; re-validate reuses stored key;
  transient re-validate doesn't downgrade. Web: form + selector render + no `org_id` in any
  request. Env-gated (`ANTHROPIC_API_KEY`) optional live smoke → `LIVE-VERIFICATION-PENDING`.
- Full suite green: `pnpm build && lint && type-check && test`.
