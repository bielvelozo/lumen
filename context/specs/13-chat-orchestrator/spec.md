---
status: shipped
feature: chat-orchestrator
created: 2026-06-17
shipped: 2026-06-18
---
# Chat Orchestrator — Spec

**Status:** Draft
**Scope:** The chat orchestrator (Flow 4) — the server-side loop that ties Claude, the query-function registry, and the customer's MySQL together. A Fastify route accepts a user message inside a `chat_sessions` row (org + user from the JWT), calls Claude via the Vercel AI SDK with the org's decrypted key, exposes the predefined query functions as **tools**, executes the chosen function against the read-only MySQL, feeds results back to the model, and **streams** the natural-language answer to the client — persisting `messages` and writing a sanitized `function_call_logs` row per tool call. This is the product's core promise: the number comes from the database, the model only narrates.

## Context

This is the heart of the product (`[[../../constitution|Constitution]]` → *Why Business Assistant exists*): the owner types "quanto vendi em maio?" and gets an exact figure computed against their live data. Everything upstream exists to make this route safe — auth and org scoping (`[[../05-login-jwt-sessions/spec|05]]`), the encrypted Claude key and MySQL password (`[[../02-secrets-and-tokens/spec|02]]`, `[[../11-ai-connection-claude/spec|11]]`, `[[../08-db-connection-create-and-test/spec|08]]`), the exposed-tables allow-list (`[[../09-introspection-and-exposure/spec|09]]`), and the parameterized query-function registry (`[[../12-query-function-registry/spec|12]]`). This spec assembles them into the request loop.

The orchestrator runs on `apps/api` (Fastify + TypeScript) and uses the **Vercel AI SDK** with the Anthropic provider. The model is **Claude** (BYO key, server-side), default `claude-opus-4-8`, with the org's `ai_connections.default_model` overriding it when set. The loop is tool-calling: the registry's functions are presented to the model as tools; the model picks one plus parameters; the **backend** validates (Zod + allow-list) and executes the SQL; the result returns to the model; the model composes the final answer, streamed back. The model never sees the MySQL credential, never sees raw SQL, and never emits SQL — it only chooses a function name and parameters. This is the constitutional "safe doors only" guarantee made concrete (`[[../../constitution|Constitution]]` → *The model never emits free SQL*; `[[../../rules/data-access-review-gates|data-access-review-gates]]`).

The schema is built for this flow: `chat_sessions` (org + user + title), `messages` (`org_id`, `role`, `content`, `model`, denormalized `org_id` because answers can carry business data), and `function_call_logs` (the sanitized audit trail — `function_name`, `params`, `status`, `duration_ms`, `provider`, `model`, `error_message`). See `db/schema.sql`.

## Problem Statement

There is no path today from a typed question to an exact, streamed answer. We need a single Fastify route that, given an authenticated user and a message: resolves or creates the chat session; loads the org's exposed tables, query-function registry, decrypted Claude key, and decrypted MySQL connection; runs a tool-calling loop with Claude where the model selects predefined functions and the backend executes them read-only against MySQL; streams the composed answer; persists both turns as `messages`; and logs every function call in sanitized form. It must do all of this without ever letting the model touch raw SQL or a tenant boundary, and it must degrade deliberately on each failure mode rather than leaking a stack trace or a wrong number.

## Non-Goals

- **The chat frontend.** The message composer, streaming render, session list, and theme are `[[../14-chat-ui/spec|14]]`. This spec defines the HTTP/stream contract the UI consumes, nothing visual.
- **The query-function registry itself.** The catalog of functions, their Zod parameter schemas, their SQL, and the allow-list enforcement live in `[[../12-query-function-registry/spec|12]]`. Here we *invoke* the registry; we do not define its members. v1 ships with the 1–2 functions `12` provides.
- **Introspection / table exposure.** Choosing which tables are visible is `[[../09-introspection-and-exposure/spec|09]]`. Here we only *read* `exposed_tables` / `exposed_relationships` to scope what the model and the functions may see.
- **Claude connection setup.** Pasting, validating, and encrypting the key is `[[../11-ai-connection-claude/spec|11]]`. We consume the decrypted key via `[[../02-secrets-and-tokens/spec|02]]`.
- **Sentry wiring.** Error reporting to Sentry is `[[../15-observability-sentry/spec|15]]`. Here we only write the `function_call_logs` rows; surfacing them to Sentry is later.
- **Caching, conversation summarization, multi-provider, multiple client DBs.** Out of v1 per `[[../../constitution|Constitution]]` → *Scope guardrails*. Each request reads live MySQL.

## Constraints

- **Route & runtime.** A Fastify route on `apps/api` (e.g. `POST /chat/sessions/:sessionId/messages`, plus a create-session path). TypeScript, Vitest for tests. The response is a **stream** (SSE or the AI SDK's stream protocol — the chosen mechanism is the contract `[[../14-chat-ui/spec|14]]` consumes).
- **org_id from the JWT, always (anti-IDOR).** `org_id` and `user_id` come from the verified JWT (`[[../05-login-jwt-sessions/spec|05]]`), **never** from the body, params, or a client-sent id. Every DB access — loading the session, the connection, exposed tables, the registry, writing `messages`, writing `function_call_logs` — is filtered by that `org_id`. A `:sessionId` in the path is validated to belong to the caller's org before use; a session owned by another org returns 404, not 403 (don't confirm existence). This is a hard review gate (`[[../../rules/data-access-review-gates|data-access-review-gates]]`).
- **The model never emits SQL.** The model is given the registry as **tools** and may only choose a function name + parameters. The backend builds and runs the parameterized, read-only SQL (`[[../12-query-function-registry/spec|12]]`). There is no code path that concatenates model output into a query or offers a free-SQL escape hatch. Tool parameters are validated with Zod and against the allow-list **before** execution; a validation failure is a handled tool error, never an execution.
- **Precision invariant: the function computes, the model narrates.** Numbers in the answer must originate from a tool result, not from the model's own arithmetic. The system prompt instructs the model to answer only from tool results and to call a function rather than estimate. The model composes prose around the figures; it does not invent or recompute them.
- **Secrets decrypted per request, never logged.** The Claude key and the MySQL password are decrypted in-process via `[[../02-secrets-and-tokens/spec|02]]` at request time and discarded after; Postgres never sees plaintext, and neither value (nor any decrypted secret) is ever written to `messages`, `function_call_logs`, or application logs. The MySQL connection uses the read-only credential the customer created (`[[../../constitution|Constitution]]` → *least privilege*).
- **Sanitized logs — no raw customer data.** `function_call_logs.params` and `function_call_logs.error_message` carry parameter **names/shape and sanitized error context**, never raw row values or the figures returned. `messages.content` does hold the assistant's answer (which can contain business numbers) and therefore carries `org_id` for isolation, per schema; the *logs* do not. Driver/model errors are mapped to a sanitized `last_error`-style string before storage.
- **Model & SDK usage.** Use the Vercel AI SDK Anthropic provider. Default model `claude-opus-4-8`; honor `ai_connections.default_model` when present. Adaptive thinking is appropriate for the orchestration step. Stream the final answer. Handle Claude's `refusal` stop reason as an unhappy path (below), not as a crash.
- **Tool-loop bounds.** Cap the number of tool-call round-trips per user message (e.g. a small `maxSteps`) so a misbehaving loop can't run unbounded. Exceeding the cap is a handled "couldn't complete" path, logged as `failed`.
- **Persistence ordering & atomicity.** Persist the user `message` on receipt (so the turn isn't lost if the stream dies), and persist the assistant `message` (with `model`) when the stream completes. Update `chat_sessions.updated_at`; set `title` on first message (derive a short title, e.g. from the first question) so the session list (`[[../14-chat-ui/spec|14]]`) is meaningful. Each tool call writes one `function_call_logs` row regardless of success/failure.
- **Read-only enforcement.** The MySQL connection is read-only by credential (constitution invariant 5). The orchestrator additionally must not depend on any write; functions are read-only by construction (`[[../12-query-function-registry/spec|12]]`).

## User Stories / Scenarios

1. **Happy path — exact figure, streamed.** An authenticated owner sends "quanto vendi em maio?" to their session. The orchestrator loads the org's exposed tables + registry + decrypted key + MySQL connection, calls Claude with the functions as tools, Claude picks `sum_sales_by_period(month=5, year=...)`, the backend validates params and runs the read-only query, the result (e.g. `128000.00`) returns to Claude, and Claude streams "Você vendeu R$ 128.000 em maio." The user `message` and the assistant `message` (with `model`) are persisted; one `function_call_logs` row records `function_name`, sanitized `params`, `status=success`, `duration_ms`, `provider`, `model`.
2. **New session.** The user sends a first message with no `:sessionId` (or to a create endpoint). A `chat_sessions` row is created with the caller's `org_id`/`user_id` and a derived `title`; the flow proceeds as in (1).
3. **Out of scope of exposed data.** The user asks about a table the owner never exposed (e.g. payroll). No function can serve it; the model is constrained to the registry and answers honestly that it can't access that data — no fabricated number, no error leak. Logged appropriately (no successful tool call, or a tool call that fails the allow-list).
4. **Empty / zero result.** The function runs and returns zero rows / `0`. The model narrates the real answer ("Nenhuma venda registrada em maio" / "R$ 0"), distinguishing "no data" from a failure. `function_call_logs.status=success`.
5. **Client DB down / unreachable.** MySQL connection or query fails (host down, timeout, dropped credential). The tool call returns a sanitized error to the model; the user gets a clear "couldn't reach your database right now" message; the connection's failure context is sanitized; `function_call_logs.status=failed` with a sanitized `error_message` (no host, no row data). The user `message` is still saved.
6. **AI key invalid / over quota / rate-limited.** Claude returns 401 (invalid/revoked key), 403 (no model access), 429 (rate limit), or 529 (overloaded). Each maps to a distinct, user-readable message ("your AI key looks invalid — reconnect it" vs "rate limit reached, try again shortly"); retryable cases (429/529) may back off per SDK defaults. Nothing crashes the route; the failure is logged sanitized.
7. **Tool call fails validation.** The model proposes parameters that fail Zod or the allow-list (bad type, unexposed table, out-of-range). The backend rejects **before** executing SQL, returns a tool error to the model so it can correct or give up, and logs `status=failed`. No SQL ran.
8. **Model refusal.** Claude returns `stop_reason: "refusal"`. The orchestrator detects it before reading content, surfaces a neutral "I can't help with that request" to the user, and logs it — it does not treat the empty content as an answer.
9. **Cross-tenant attempt (anti-IDOR).** A user sends a `:sessionId` belonging to another org. The route returns 404 without revealing the session exists; no data from the other org is loaded.
10. **Advisory request — data-grounded ideas (amended 2026-09-18).** The owner asks for an idea, not a figure ("me dê uma ideia de promoção pra Black Friday"). The model does NOT refuse it as out of scope and does NOT offer to run analyses; it calls the functions that ground the idea (best/worst sellers by quantity, sales by month and channel, average ticket) and answers with a few concrete actions, each citing its figure. Percentages, targets and dates it proposes are labeled as suggestions, not data. A summed unit-price column is never presented as revenue (the functions cannot multiply quantity × price). The system prompt carries these rules; the step cap is 8 so such a turn can gather several figures. Verified live: every figure in the Black Friday answer matched a direct `SELECT`.

## Success Criteria

- `POST` to the messages route, authenticated, with a valid session and a question that maps to a registry function, returns a streamed answer whose figure equals the value the function returns when run directly against MySQL (the number comes from the DB, verified by test).
- The model is only ever offered the registry functions as tools; there is no route, branch, or fixture in which model output becomes SQL. (Enforced and tested per `[[../../rules/data-access-review-gates|data-access-review-gates]]`.)
- Every DB access in the route is scoped by the JWT `org_id`; a request carrying another org's `sessionId` yields 404 and loads nothing cross-tenant. Covered by an isolation test.
- Both turns persist: a `user` `message` and an `assistant` `message` (the latter with `model` set) exist for a completed exchange, each with the caller's `org_id`; `chat_sessions.updated_at` advances and `title` is set on the first message.
- Each tool call produces exactly one `function_call_logs` row with `function_name`, `status` (`success`/`failed`), `duration_ms`, `provider`, `model`, sanitized `params`, and (on failure) sanitized `error_message` — asserted to contain no raw row values, no secrets, no MySQL host.
- The decrypted Claude key and MySQL password never appear in `messages`, `function_call_logs`, or any log line (asserted by a log/secret-scan test).
- Each unhappy path (3–8) returns a deterministic, user-readable outcome and the correct `function_call_logs.status`, without an unhandled exception escaping the route. Covered by tests with mocked MySQL/Claude failures.
- The tool-loop step cap is enforced: a forced loop terminates with a handled "couldn't complete" result logged `failed`, not an unbounded run.
- The stream contract is stable enough for `[[../14-chat-ui/spec|14]]` to consume (documented event/format).

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Model fabricates a number instead of calling a function (precision invariant broken) | System prompt forbids answering data questions without a tool result; tests assert the answer's figure matches the tool result; numbers in prose are traceable to a tool call, never model arithmetic |
| A "just let the model write this query" shortcut creeps in under deadline | Constitutional + review-gate ban (`[[../../rules/data-access-review-gates|data-access-review-gates]]`); the registry is the *only* tool surface; no SQL-from-model code path exists; reviewer checklist blocks it |
| `org_id` accidentally sourced from the path/body (IDOR) | `org_id`/`user_id` taken only from verified JWT; `:sessionId` ownership checked against that `org_id`; cross-tenant test returns 404; review gate |
| Raw customer data or secrets leak into `function_call_logs` / `messages` / logs | Sanitize `params` to names/shape and `error_message` to mapped strings before write; secrets decrypted in-process and discarded; secret-scan + log-scan tests |
| Streaming complicates persistence — assistant message lost if the stream dies mid-flight | Persist the user message before the model call; persist the assistant message on stream completion; partial/aborted streams leave a recoverable state, not a half-written answer |
| Claude failure modes (401/403/429/529/refusal) handled as one generic 500 | Map each to a distinct user message and `function_call_logs`/response outcome; retry only 429/529 per SDK defaults; detect `refusal` before reading content |
| MySQL latency stalls the request or exhausts connections | Per-query timeout and a bounded pool on the read-only connection; timeout maps to scenario 5 (handled `failed`), not a hang |
| Unbounded tool-call loop burns tokens / time | Cap round-trips (`maxSteps`); exceeding it is a handled, logged `failed` outcome |
| Model/tool JSON escaping differs across Claude versions | Parse tool inputs via the SDK's parsed object / `JSON.parse`, never raw-string-match the serialized input |

## Open Questions

- [NEEDS CLARIFICATION: exact streaming transport — Vercel AI SDK `toDataStreamResponse` / data-stream protocol vs. plain SSE — and how it's adapted onto Fastify (the SDK's first-class integration is Next/Node handlers).] Default lean: use the AI SDK stream and bridge it to a Fastify reply; lock the wire format as the contract for `[[../14-chat-ui/spec|14]]`.
- [NEEDS CLARIFICATION: how much prior conversation history is sent to Claude per message — full session transcript, a sliding window, or last-N turns — given there is no summarization/compaction in v1.] Default lean: send the session's messages (bounded by a turn/character cap) so follow-ups have context; revisit if token cost or latency bites.
- [NEEDS CLARIFICATION: whether the session-create step is a separate endpoint or implicit on first message to a sessionless route.] Default lean: support both — an explicit create plus implicit create-on-first-message — and have the UI (`[[../14-chat-ui/spec|14]]`) pick.
- [NEEDS CLARIFICATION: title derivation — truncate the first question vs. a cheap model-generated title.] Default lean: truncate the first user message for v1 (no extra model call); upgrade later if desired.
- [NEEDS CLARIFICATION: per-query MySQL timeout value and tool-loop `maxSteps` value.] Default lean: a conservative query timeout (e.g. a few seconds) and a small step cap (e.g. 3–5); tune against real data once `[[../12-query-function-registry/spec|12]]` lands.
