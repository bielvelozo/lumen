---
status: in-progress
feature: chat-ui
created: 2026-06-18
---
# Chat UI — Tasks

A box is checked ONLY after its slice is implemented AND committed.

## 1 — Backend: list / history / rename + model override
- [x] `chat-contracts.ts`: `renameSessionRequestSchema` (title, strict); `sendMessageRequestSchema`
      += optional `model` (curated enum). `chat.store`: `listSessions` / `getMessages` /
      `renameSession` (org-scoped). `chat.route`: GET `/chat/sessions`, GET `/chat/sessions/:id/
      messages`, PATCH `/chat/sessions/:id`. `chat.service`: accept optional model override.
      Tests: list org-scoped + desc; history org-scoped; rename cross-tenant → 404; override used.

## 2 — Web lib: api + SSE stream + queries + readiness
- [x] `lib/chat.ts`: listSessions/getMessages/createSession/renameSession (apiFetch) +
      `streamMessage` (POST + ReadableStream SSE reader yielding ChatStreamEvent; AbortController).
- [x] `lib/chat-queries.ts`: useSessions/useMessages (+ keys) + useChatReadiness (db+ai active).
- [x] tests: no chat request carries an org_id; SSE reader parses text-delta/done/error.

## 3 — Chat page: sidebar + conversation + routing
- [x] `ChatPage.tsx` (two-pane) + `SessionSidebar.tsx` (glass list + new + rename) +
      `Conversation.tsx` (solid bubbles + model switcher + glass input) + `states.tsx`
      (gating/unhappy panels). Router `/chat` + `/chat/:sessionId`; AppShell NavItem.
- [x] tests: list ordering/scoping; create/select/rename update cache + URL; messages load on solid.

## 4 — Streaming send + states + lock
- [x] send → optimistic user bubble → incremental assistant bubble → settle (invalidate messages)
      → input lock/unlock; model switcher default + selection; each unhappy path renders its
      distinct solid state (out-of-scope/empty/db-down→10 / ai-failed→11 / gating).
- [x] tests: full send→stream→settle; input locked during stream; each unhappy-path state.

## 5 — Glass guard + ship
- [x] GUARD `chat-glass.test.tsx`: render the chat in the shell; assert no
      `ChatBubble`/`.card`/`.metric`/number/data node under `.glass` (sidebar + input may be glass).
- [x] Full suite green: `pnpm build && lint && type-check && test`.
- [x] Record open-question defaults in `DECISIONS.md`; mark spec Shipped (MOC + frontmatter)
      atomically; capture learnings.
