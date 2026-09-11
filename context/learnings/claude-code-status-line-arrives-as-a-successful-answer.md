---
tags:
  - learning
  - gotcha
related:
  - "[[subscription-mode-agent-sdk-instead-of-api-key]]"
  - "[[../reports/2026-09-11-correcoes-p0-p1]]"
created: 2026-09-11
---
# A Claude Code status line arrives as a perfectly successful answer

In subscription mode the Agent SDK can end a turn with `subtype: 'success'` whose entire result is the CLI's own notice — observed live: `Usage credits are required for long context requests.` There is no error subtype, no `errors` array and nothing on stderr, so the adapter streamed it to the owner and the orchestrator persisted it as the assistant's message. The chat then showed an English quota notice where a figure belongs, and the next turn inherited it as conversation history. The same question answered correctly on retry, which is what makes it easy to miss.

## Context

Found on 2026-09-11 while verifying the chat in the browser after the P0/P1 round. Fixed in `chat-model-agent-sdk.ts`: a short result opening with one of the known notices is reported as `rate_limited`, which surfaces the app's own pt-BR message and persists nothing (the orchestrator only writes an assistant row on `answered`).

## How to Apply

- Treat the Agent SDK's `result` as *possibly* a CLI status line, not necessarily model output. Success is about the subprocess, not about the answer.
- Never persist an assistant message the adapter cannot vouch for — a poisoned history keeps costing turns after the transient cause is gone.
- When adding a notice to the pattern, keep it anchored to the start of a SHORT result: a real answer to a data question is long and never opens with one.
