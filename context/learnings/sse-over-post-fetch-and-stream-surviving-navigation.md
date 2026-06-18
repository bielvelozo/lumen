---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/14-chat-ui/spec]]"
  - "[[../specs/13-chat-orchestrator/spec]]"
created: 2026-06-18
---
# Streaming an SSE answer from a POST — and keeping the stream alive across the first-send navigate

Two non-obvious things made the chat stream work.

## 1. EventSource can't POST — read the SSE body yourself

The chat send is `POST /chat/sessions/:id/messages` (it has a request body + needs the auth
cookie), but the browser `EventSource` API only does GET and can't send a body or custom headers.
So the streaming client is a plain `fetch` whose response body is read as a `ReadableStream`, with
the SSE framing parsed by hand:

```ts
const res = await fetch(url, { method: 'POST', credentials: 'include', body, signal });
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let sep = buffer.indexOf('\n\n');          // frames are blank-line separated
  while (sep !== -1) {
    const line = buffer.slice(0, sep).split('\n').find((l) => l.startsWith('data: '));
    buffer = buffer.slice(sep + 2);
    if (line) yield JSON.parse(line.slice(6));
    sep = buffer.indexOf('\n\n');
  }
}
```

The trap: a TCP chunk does NOT align to an SSE frame — `data: {"type":"text-` and
`delta",...}\n\n` can arrive in separate `read()`s. Buffer across reads and only parse a frame
once you've seen its terminating `\n\n` (tested explicitly with a frame split mid-token). An
`AbortSignal` cancels the stream (the stop control); the discarded partial is never persisted
because spec 13 saves the assistant message only on the `done` event.

## 2. One route element for `/chat` and `/chat/:id` so the in-flight stream survives the navigate

The first message in `/chat` (no session yet) does: `createSession()` → `navigate('/chat/'+id)`
→ then stream. If `/chat` and `/chat/:sessionId` rendered *different* elements, that navigate
would unmount the component mid-stream and kill the `for await`. Mount the SAME element on both
routes:

```tsx
<Route path="/chat" element={<ChatPage />} />
<Route path="/chat/:sessionId" element={<ChatPage />} />
```

React Router renders `<ChatPage/>` for both, so React reconciles it as the same component and
preserves its state (the streaming buffer, the optimistic bubbles) across the URL change. The
`sessionId` just appears via `useParams` after the navigate.

## How to Apply

- For an authenticated, body-carrying stream, use `fetch` + a `ReadableStream` reader, not
  `EventSource`. Buffer across reads; parse a frame only at `\n\n`.
- When a flow creates a resource then routes into it mid-stream, render the same route element
  before and after so the component (and its stream) isn't torn down. Same reconciliation
  principle as the derived-wizard route in [[derived-wizard-await-dependent-query]].
- Settle the optimistic/streamed bubbles by invalidating the messages query so server state is
  canonical (figures in `tabular-nums`/`.ds-num` on solid `ChatBubble`s — never on `.glass`,
  per [[glass-only-rtl-guard-test]]). The client sends only `session_id`, never an org id.
