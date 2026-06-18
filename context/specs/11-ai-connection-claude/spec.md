---
status: draft
feature: ai-connection-claude
created: 2026-06-17
shipped: null
---
# Connect the AI (Claude) — Spec

**Status:** Draft
**Scope:** Flow 3 — the owner pastes their Claude API key; the backend validates it with a real lightweight test call via the Vercel AI SDK (Anthropic provider), encrypts it into `ai_connections.encrypted_api_key` (`bytea`), records `provider='claude'`, a selectable `default_model`, and first-class connection state (`status` + `last_validated_at` + sanitized `last_error`). Backend plus a small frontend (paste-key form, validate action, model selector). v1: one provider per org. The key is used server-side only and never returned to the client.

## Context

This is the third of three "connect" flows, after the client database connection (`[[../08-db-connection-create-and-test/spec|08]]`, `[[../09-introspection-and-exposure/spec|09]]`). The product is AI over the owner's structured data; the AI is **Claude**, accessed server-side through the **Vercel AI SDK with the Anthropic provider**, and the customer **brings their own API key** (BYO) — the AI account is theirs, not ours (`[[../../constitution|Constitution]]` → *Scope guardrails*). This spec turns the empty `ai_connections` row into an `active` connection the chat orchestrator (`[[../13-chat-orchestrator/spec|13]]`) can later decrypt and use.

The schema already models this exactly (`db/schema.sql` → `ai_connections`): `org_id`, `provider` (default `'claude'`), `encrypted_api_key` (`bytea`), `default_model` (nullable, swappable later in chat), `status` (`pending`/`active`/`failed`), `last_validated_at`, and a sanitized `last_error`. Connection state is first-class and never inferred — the same `status` + `last_error` pattern Flow 2 established. The encryption module lands in `[[../02-secrets-and-tokens/spec|02]]`; this spec consumes it, it does not reimplement crypto. Auth context (`org_id` from the JWT) comes from `[[../05-login-jwt-sessions/spec|05]]`, and the UI lives inside the authenticated web shell from `[[../06-web-shell-and-auth-ui/spec|06]]`.

The differentiator with BYO is that the key is a live secret we must protect: it can run up the owner's bill and must never leak to the browser or into logs. The constitution makes that non-negotiable — encrypted at rest, decryption key outside the DB, Postgres never sees plaintext (`[[../../constitution|Constitution]]` → *Architecture principles* #2).

## Problem Statement

The owner has connected their database but the assistant cannot answer anything yet — there is no model to call. We need a flow where the owner pastes a Claude API key, we **prove it actually works** before trusting it (a real test call against the chosen model, not a format check), encrypt it, pick a default model, and surface a clear, honest status. On failure we must tell the owner *which category* of thing went wrong (bad key, model unavailable, rate/quota, network) without ever echoing raw provider error text — which can leak request details — and without persisting a half-broken `active` connection.

## Non-Goals

- **Chat orchestration / tool-calling / streaming** — the actual question-to-answer loop, decrypting the key per request, and switching models mid-chat live in `[[../13-chat-orchestrator/spec|13]]`. This spec only proves the key works and stores it.
- **The query function registry** — the parameterized read-only functions the model may call are `[[../12-query-function-registry/spec|12]]`.
- **The encryption/decryption primitive** — owned by `[[../02-secrets-and-tokens/spec|02]]`; here we only call `encrypt()` and never decrypt outside a validation call.
- **More than one AI provider per org** — v1 is one Claude connection per org (`[[../../constitution|Constitution]]` → *Scope guardrails*: multi-provider is deferred). No OpenAI/Gemini abstraction layer.
- **Usage metering / spend caps / billing** against the owner's key — out of scope for v1.
- **A live model catalog fetched from Anthropic** — the model list is a curated constant in v1 (see Constraints); auto-discovery is deferred.

## Constraints

- **Tenant isolation (anti-IDOR).** Every read/write of `ai_connections` is scoped by `org_id` taken **from the JWT**, never from a body/param sent by the client (`[[../../constitution|Constitution]]` → *Architecture principles* #1). The route resolves the org's single connection from the authenticated context; the client never supplies a connection id.
- **Secret at rest.** The pasted key is encrypted via `[[../02-secrets-and-tokens/spec|02]]` and stored only in `ai_connections.encrypted_api_key` (`bytea`). The decryption key lives outside Postgres (env / secrets manager). Postgres never sees plaintext; the plaintext key exists in process memory only for the duration of a validation call, then is dropped — never logged, never written elsewhere.
- **Never returned to the client.** No endpoint ever serializes `encrypted_api_key` or the plaintext key. `GET` responses expose only non-secret state (`provider`, `default_model`, `status`, `last_validated_at`, `last_error`, and a boolean like `hasKey`/`isConfigured`). Optionally a masked hint (e.g. last 4 chars) **only if** captured at submit time and stored as non-secret metadata — default is to show nothing.
- **Validate with a real call, server-side.** Validation uses the **Vercel AI SDK** (`ai`) with the **Anthropic provider** (`@anthropic-ai/sdk` via `@ai-sdk/anthropic`), constructing the provider with the pasted key and issuing a **minimal completion** against the chosen `default_model` (tiny prompt, `maxTokens` ~1–8). Success ⇒ the key works *and* the model is reachable. This runs only in `apps/api`; the key never reaches the browser.
- **Model IDs are current and curated.** The selectable models are a constant in `packages/shared`, grounded in the live Claude model IDs (per the `claude-api` skill): `claude-opus-4-8` (default), `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5`. Use the exact ID strings — no date suffixes. The default `default_model` is `claude-opus-4-8`. The list is the single source of truth for both the selector and server-side validation of the submitted model.
- **Sanitized failure categories — never raw provider text.** On failure, map to a closed set of safe categories and store only the category (+ a generic message) in `last_error`. Mapping (from provider HTTP status / error type — see `claude-api` skill `shared/error-codes.md`):
  - `invalid_key` — 401 `authentication_error` / 403 `permission_error`.
  - `model_unavailable` — 404 `not_found_error` (bad/unentitled model id).
  - `rate_limited` — 429 `rate_limit_error` (includes quota/billing exhaustion).
  - `network` — timeout, DNS, connection reset, 5xx/529 overloaded.
  - `unknown` — anything unmapped (still sanitized; raw text discarded).
  Raw provider error bodies/messages are **never** persisted or returned, and never logged at a level that reaches normal logs.
- **State transitions are explicit.** A new/edited connection starts `pending`. A successful validation sets `status='active'`, `last_validated_at=now()`, `last_error=null`. A failed validation sets `status='failed'`, leaves `last_validated_at` unchanged, and sets the sanitized `last_error`. The encrypted key is written **only on successful validation** (don't store a key we just proved is dead) — except when re-validating an already-stored key, where the existing ciphertext stays put.
- **One connection per org.** Enforce a single Claude connection per org at the application layer (and optionally the `uq_aiconn_org` unique index noted in the schema). A second submit updates the existing row (re-key / swap model), it does not create a second.
- **Idempotent, side-effect-light.** Validation must not mutate the owner's Anthropic account beyond the cost of one tiny completion. Use a short server-side timeout so a hung provider call surfaces as `network` rather than hanging the request.
- **Stack & contracts.** Backend is Fastify + TS in `apps/api`; request/response DTOs and the model-list constant are Zod schemas/types in `packages/shared`, consumed by `apps/web` (per `[[../00-monorepo-scaffold/spec|00]]`). Tests in Vitest, with the provider call mocked (no real network in CI).

## User Stories / Scenarios

1. **Happy path — connect Claude.** Owner opens "Connect AI", pastes their `sk-ant-…` key, leaves the default model (`claude-opus-4-8`) or picks another, clicks **Validate & save**. The backend runs a minimal completion, it succeeds, the key is encrypted and stored, `status` → `active`, `last_validated_at` set. The UI shows a green "Connected — Claude · Opus 4.8" state.
2. **Bad key.** Owner pastes a typo'd/revoked key. Validation returns 401; backend sets `status='failed'`, `last_error` category `invalid_key`. UI shows "That key was rejected by Anthropic. Check it and try again." No key is stored.
3. **Model not available to this key.** Key is valid but the chosen model id isn't entitled (404). `status='failed'`, `last_error='model_unavailable'`. UI suggests picking a different model from the selector.
4. **Rate-limited / quota exhausted.** Validation returns 429. `status='failed'`, `last_error='rate_limited'`. UI says it's a temporary limit / quota issue and to retry shortly — the key may be fine.
5. **Network / provider down.** The provider call times out or returns 5xx/529. `status='failed'`, `last_error='network'`. UI says it couldn't reach Anthropic and to retry; nothing stored.
6. **Change the default model later.** Owner already has an `active` connection and wants to switch the default from Opus to Haiku. They re-select and save; the backend re-validates against the new model using the **stored** (decrypted-in-memory) key, updates `default_model` on success, keeps the same ciphertext. (Per-message model switching in chat is `[[../13-chat-orchestrator/spec|13]]`.)
7. **Re-key.** Owner rotates their Anthropic key. They paste a new one; on successful validation the old ciphertext is overwritten with the new encrypted value.
8. **View state.** Returning to the page, the owner sees current `status`, last validated time, and (on failure) the human-readable category — never the key itself.
9. **Cross-tenant attempt.** A request crafted to point at another org's connection is impossible: the org is derived from the JWT, so the attacker only ever touches their own row.

## Success Criteria

- An owner can paste a Claude key, pick a model, validate, and reach `status='active'` with `last_validated_at` set and `last_error=null`.
- After a successful save, `ai_connections` for the org has `provider='claude'`, a non-null `encrypted_api_key` (`bytea`), and the chosen `default_model`; no plaintext key exists anywhere in the DB, logs, or any API response.
- A wrong key, bad model, rate limit, and network failure each produce the correct sanitized `last_error` category and `status='failed'`, with **no** raw provider text persisted or returned.
- Validation issues exactly one minimal completion via the Vercel AI SDK + Anthropic provider against the selected model, server-side, with a bounded timeout.
- All `ai_connections` access is scoped by `org_id` from the JWT; there is no code path where a client-supplied id selects the connection.
- The model selector is driven by the shared model-list constant; submitting a model outside that list is rejected (Zod) before any provider call.
- Re-validating or changing the default model on an existing `active` connection reuses the stored key (no re-paste required) and preserves the ciphertext on success.
- Unit/integration tests (Vitest, provider mocked) cover: happy path, each failure category → mapping, no-store-on-failure, key-never-serialized, org-scoping, and model-not-in-list rejection.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Raw Anthropic error text leaks into `last_error`, logs, or the response (could expose key fragments / request internals) | Map every provider error to the closed category set **before** persisting; store only category + generic message; assert in tests that `last_error` is one of the allowed values and that the response body never contains the key |
| Plaintext key accidentally logged or returned (e.g. request logger dumps body, or a debug log prints the provider config) | Redact the key field in request logging; never `console.log`/Sentry the key or provider config; integration test greps the serialized response + captured logs for the key string |
| Storing a key that we proved is dead (`active` row with a non-working key) | Persist `encrypted_api_key` only on a successful validation; on failure, leave the prior state and the prior key untouched |
| A new model id ships and the curated list rots, or a date-suffixed id sneaks in | Keep the list in `packages/shared` as the single source; ground it against the `claude-api` skill at change time; CI/test asserts default is `claude-opus-4-8` and ids carry no date suffix |
| Validation call hangs on a wedged provider, blocking the request | Bounded server-side timeout on the completion; a timeout maps to `network`, not a hung 500 |
| Treating a 429 as a permanently bad key (and discarding a good key) | Map 429 → `rate_limited` (transient), keep messaging that the key may be fine; never auto-overwrite/clear a stored key on a transient failure |
| Multiple connections per org created by repeated submits | App-layer single-connection invariant (update-not-insert) + optional `uq_aiconn_org` unique index; test the second submit updates the same row |
| Decrypting the stored key for re-validation widens the plaintext exposure window | Decrypt only inside the validation call scope, never return it, drop the reference immediately after; reuse the same in-memory-only discipline as a fresh paste |

## Open Questions

- [NEEDS CLARIFICATION: should the curated model list include `claude-opus-4-7` as a selectable option, or only the current default `claude-opus-4-8` plus `claude-sonnet-4-6` / `claude-haiku-4-5`? Default lean: offer Opus 4.8 (default), Sonnet 4.6, Haiku 4.5; keep the list small and current.]
- [NEEDS CLARIFICATION: do we store a masked hint (last 4 chars of the key) for UX, or show nothing? Default lean: show nothing — least data, least risk; revisit if owners ask "which key is this?"]
- [NEEDS CLARIFICATION: exact validation prompt + `maxTokens` for the minimal completion — a 1-token "ping" vs. a slightly larger call to better exercise the model. Default lean: shortest possible (`maxTokens` ~4, trivial user message) to minimize cost and latency.]
- [NEEDS CLARIFICATION: on a transient failure (`rate_limited`/`network`) during a *re-key*, do we keep the old `active` key or move the row to `failed`? Default lean: keep the old key and old `active` state, surface the transient error without downgrading status, so a blip doesn't disconnect a working assistant.]
- [NEEDS CLARIFICATION: should validation enforce the BYO-key prefix shape (`sk-ant-`) client-side before submit as a cheap pre-check, or rely solely on the real call? Default lean: a light client-side format hint only (non-blocking), with the real server-side call as the source of truth.]
