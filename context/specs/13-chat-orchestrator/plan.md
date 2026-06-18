---
status: in-progress
feature: chat-orchestrator
created: 2026-06-18
---
# Chat Orchestrator — Implementation Plan

Implements `[[spec]]` — Flow 4, the request loop that ties Claude + the query-function registry
(spec 12) + the customer's read-only MySQL together. **Gate-2 CRITICAL** + DB-facing. A user
message → tool-calling loop (model picks a registry function; the BACKEND executes it read-only;
the model narrates) → streamed answer, with `messages` persisted (org-scoped) and a sanitized
`function_call_logs` row per tool call. The number comes from the DB; the model only narrates.

## Invariants this spec must hold (Gate-2)

- **Anti-IDOR:** `org_id`/`user_id` ONLY from the verified JWT; every DB access filtered by
  `org_id`. A `:sessionId` from another org → **404** (don't confirm existence), loads nothing.
- **Model never emits SQL:** the model is offered ONLY the registry functions as tools and may
  pick a name + params; the backend validates (Zod + allow-list, spec 12) and runs the SQL.
  No code path concatenates model output into a query.
- **Secrets decrypted per request, never logged:** the Claude key + MySQL password are decrypted
  in-process and discarded; never written to `messages`, `function_call_logs`, or any log line.
- **Sanitized logs:** `function_call_logs.params`/`error_message` carry names/shape + mapped
  error context — never raw row values, figures, secrets, or the MySQL host.

## Architecture (model interaction behind a port; AI SDK confined to one adapter)

```
packages/shared/src/chat-contracts.ts
  sendMessageRequestSchema (message text; NO org/session id in body), chat stream-event wire
  format (text-delta / done / error), CHAT_ERROR_CODES, sessionSummary/messageDTO.

apps/api/src/chat/
  chat.store.ts          # org-scoped: sessions create/getByIdAndOrg/touch(+title); messages
                         #   insert(user/assistant), recentForContext; all filtered by org_id
  function-log.store.ts  # insert one sanitized function_call_logs row (org-scoped)
  sanitize.ts            # sanitizeParams (names/shape, drop values) + mapChatError -> code
  query-tools.ts         # buildQueryTools(orgId, accessor, runner, logSink): registry funcs ->
                         #   ExecutableTool[] whose execute = time + executeQueryFunction (spec 12)
                         #   + write ONE sanitized function_call_logs row; returns tool result
  chat-model.ts          # ChatModelPort: run({apiKey,model,system,messages,tools}, {onTextDelta})
                         #   -> { outcome: answered|refusal|error }. createAiSdkChatModel = real
                         #   streamText(tools, stopWhen: stepCountIs(maxSteps)); CI uses a fake.
  system-prompt.ts       # answer-only-from-tool-results prompt + exposed-tables context
  chat.service.ts        # orchestrate: resolve/own session(404) -> persist user msg -> load
                         #   ai_connection(active, decrypt key+model)+allow-list+runner -> build
                         #   tools+prompt+history -> port.run(stream) -> persist assistant msg
                         #   (+title) -> map failures. Bounded history + maxSteps.
  chat.route.ts          # POST /chat/sessions (create) + POST /chat/sessions/:id/messages
                         #   (requireAuth; org from getAuth; SSE stream); :id ownership -> 404
apps/api/src/app.ts + server.ts   # wire chat deps
```

## Open-question defaults (recorded in DECISIONS.md)

- **Streaming:** the orchestrator owns a simple SSE wire format (`text-delta`/`done`/`error`
  events) it controls — the contract for spec 14; the real model adapter bridges the AI SDK
  stream into `onTextDelta`. Default lean.
- **History:** send the session's recent messages bounded by a turn cap (last ~10) so follow-ups
  have context; no summarization in v1.
- **Session create:** support BOTH an explicit `POST /chat/sessions` and implicit create-on-first-
  message (sessionless messages route variant). Default lean.
- **Title:** truncate the first user message (no extra model call). Default lean.
- **maxSteps:** 5 tool-call round-trips; query timeout from spec 12's runner (~10s). Default lean.

## Gate-2 / verification

- `/security-review` + mechanically re-confirm (i)-(iv) incl. `messages`/`function_call_logs`
  org-scoping. GUARD TESTS (RALPH §2f for 13): (a) no model-supplied string concatenated into
  SQL (tool execute goes through spec-12's membership guard; injection → refusal, no SQL);
  (b) cross-tenant: another org's `sessionId` → 404, nothing loaded; (c) secret/log-scan: the
  decrypted key + MySQL password never appear in messages/logs/any captured output.
- Unhappy paths 3-8 each → deterministic outcome + correct `function_call_logs.status`.
- LIVE end-to-end vs Docker MySQL (env-gated + ledgered): a fake model picks a function, the
  REAL runner computes it, and the streamed figure equals the direct DB value.
- Full suite green: `pnpm build && lint && type-check && test`.
