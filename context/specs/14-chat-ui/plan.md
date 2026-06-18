---
status: in-progress
feature: chat-ui
created: 2026-06-18
---
# Chat UI — Implementation Plan

Implements `[[spec]]` — the Flow-4 frontend in `apps/web`, the product's main screen. A sessions
list + a streaming conversation view, mounted in spec-06's protected shell. Consumes spec-13's
endpoints + SSE stream; renders all data (bubbles, numbers, tables) on **solid** surfaces with
glass ONLY on the sessions sidebar + chat input + menus (the mandatory 06/10/14 glass guard).
Anti-IDOR: the client sends only `session_id`; never an `org_id`.

## Small backend extension (spec 13 shipped create+send only)

The UI needs three org-scoped reads/updates spec 13 didn't ship, plus a per-message model
override. All `getAuth`-only, anti-IDOR; a foreign `:sessionId` → 404 (no existence leak):
- `GET /chat/sessions` → the caller's sessions, `updated_at` desc (list).
- `GET /chat/sessions/:id/messages` → that session's messages, `created_at` order (history).
- `PATCH /chat/sessions/:id` → rename (title).
- Extend `sendMessageRequestSchema` with an optional `model` (curated enum); the orchestrator
  uses `override ?? default_model ?? DEFAULT_MODEL` and records it on `messages.model`.

## Architecture

```
packages/shared/src/chat-contracts.ts      # + renameSessionRequestSchema; send += optional model
apps/api/src/chat/chat.store.ts            # + listSessions / getMessages / renameSession (org-scoped)
apps/api/src/chat/chat.route.ts            # + GET sessions, GET messages, PATCH rename
apps/api/src/chat/chat.service.ts          # accept optional model override

apps/web/src/lib/
  chat.ts                # api: listSessions/getMessages/createSession/renameSession (apiFetch);
                         #   streamMessage (POST + ReadableStream SSE reader -> ChatStreamEvent)
  chat-queries.ts        # useSessions / useMessages (TanStack Query) + keys; useChatReadiness
                         #   (db + ai connection active -> gating)
apps/web/src/routes/chat/
  ChatPage.tsx           # two-pane: SessionSidebar (glass) + ConversationColumn (solid)
  SessionSidebar.tsx     # list (updated_at desc) + new + rename ("…" menu); glass chrome
  Conversation.tsx       # message list (solid ChatBubble), model switcher, ChatInput (glass);
                         #   send -> optimistic user bubble -> incremental assistant bubble ->
                         #   settle (invalidate messages) -> input lock; unhappy-path states
  states.tsx             # gating CTA + unhappy-path solid panels (out-of-scope/empty/db-down/ai)
apps/web/src/router.tsx + routes/AppShell.tsx   # /chat + /chat/:sessionId + sidebar NavItem
```

## Open-question defaults (recorded in DECISIONS.md)

- **Transport:** consume spec-13's SSE wire format (`text-delta`* then one `done`|`error`);
  the terminal `done` carries `{messageId, model}`, `error` carries `{code, message}` — the UI
  switches state on the discriminator. Default lean (matches the shipped contract).
- **Session creation:** first send in `/chat` (no id) creates the session (`POST /chat/sessions`),
  client navigates to `/chat/:id`, then streams — avoids orphan sessions. Default lean.
- **Title:** placeholder + spec-13 auto-title from the first question (already wired); user
  rename always wins (`PATCH`). Default lean.
- **Tabular answers:** v1 renders the assistant text in a solid `ChatBubble` (numbers in
  `tabular-nums`); a structured table payload is deferred (text fallback). Default lean.
- **Model list:** the curated `CLAUDE_MODELS` (shared), default from `ai_connections.default_model`.
- **Stop/cancel:** a client-side abort of the in-flight stream (AbortController); a discarded
  partial isn't persisted (spec 13 persists the assistant message only on `done`). Default lean.

## Guard / verification

GUARD (RALPH §2f, 06/10/14): glass-only RTL test — no `ChatBubble`/number/table/`MetricCard`/
data node sits under `.glass`; the sidebar + input MAY be glass. Tests (RTL, mocked 13): list
ordering/scoping; create/select/rename + URL; message load on solid; send → optimistic → streamed
bubble → settle/invalidate; input locks during stream; each unhappy path (out-of-scope/empty/
db-down→link 10 / ai-failed→link 11 / gating); switcher default + selection; **no request carries
an org_id**. `pnpm build && lint && type-check && test` green.
