---
status: in-progress
feature: chat-orchestrator
created: 2026-06-18
---
# Chat Orchestrator — Tasks

A box is checked ONLY after its slice is implemented AND committed.

## 1 — Shared contracts: chat DTOs + stream wire format + error codes
- [ ] `chat-contracts.ts`: `sendMessageRequestSchema` (`message` only — strict, no org/session id);
      `CHAT_ERROR_CODES` (ai_not_connected/ai_key_invalid/ai_rate_limited/ai_unavailable/
      model_refused/data_source_unavailable/step_limit/unknown); stream-event types
      (`text-delta`/`done`/`error`); session/message DTOs. Export from index. Tests.

## 2 — Stores + sanitizers
- [ ] `chat.store.ts` (org-scoped sessions: create/getByIdAndOrg/touchAndTitle; messages:
      insertUser/insertAssistant/recentForContext) + `function-log.store.ts` (insert sanitized row).
- [ ] `sanitize.ts`: `sanitizeParams` (param NAMES/shape only, drop values) + `mapChatError`
      (provider/driver → closed code). Tests: params carry no values; secrets/host never present.

## 3 — Query tools + model port + system prompt
- [ ] `query-tools.ts`: `buildQueryTools` (registry → ExecutableTool[]; each execute times +
      runs `executeQueryFunction` (spec 12) + writes ONE sanitized function_call_logs row).
- [ ] `chat-model.ts`: `ChatModelPort` + `createAiSdkChatModel` (streamText + tools + stepCountIs);
      `system-prompt.ts` (answer-only-from-tool-results + exposed-tables context). Tests: a tool
      execute logs sanitized + status; an injection param → refusal, no SQL; log has no secret.

## 4 — Orchestrator service (fake model port)
- [ ] `chat.service.ts`: resolve/own session (404) → persist user msg → load ai_connection
      (active, decrypt) + allow-list + runner → tools+prompt+history → port.run(stream) → persist
      assistant msg (+title) → map failures. Tests (fake port + fake stores): happy path persists
      both turns + sets title; cross-tenant sessionId → 404 loads nothing; refusal; ai_not_connected;
      ai_key_invalid; data_source_unavailable; validation-fail logs failed; step-limit; secret never
      in messages/logs.

## 5 — Route + wiring + live MySQL e2e
- [ ] `chat.route.ts` (POST `/chat/sessions` + POST `/chat/sessions/:id/messages`, requireAuth, org
      from getAuth, SSE stream); wire into app.ts + server.ts (real AI SDK adapter; ANTHROPIC_API_KEY
      live smoke env-gated + ledgered). Route tests: 401 no auth; cross-tenant 404; stream contract.
- [ ] LIVE end-to-end vs Docker MySQL (env-gated + ledgered): fake model picks aggregate function,
      REAL runner computes, streamed figure equals the direct DB value.

## 6 — Gate-2 + ship
- [ ] `/security-review` + mechanically re-confirm GATE-2 (i)-(iv); GUARD tests present
      (no-model-string-in-SQL, cross-tenant 404, secret/log-scan).
- [ ] Full suite green: `pnpm build && lint && type-check && test`.
- [ ] Record open-question defaults in `DECISIONS.md`; mark spec Shipped (MOC + frontmatter)
      atomically; capture learnings.
