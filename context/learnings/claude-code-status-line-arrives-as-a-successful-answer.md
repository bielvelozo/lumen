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

In subscription mode the Agent SDK can end a turn with `subtype: 'success'` whose entire result is the CLI's own notice — observed live: `Usage credits are required for long context requests.` and, asking Haiku 4.5 a normal question, `Prompt is too long`. There is no error subtype, no `errors` array and nothing on stderr, so the adapter streamed it to the owner and the orchestrator persisted it as the assistant's message. The chat then showed an English notice where a figure belongs, and the next turn inherited it as conversation history. The first one answered correctly on retry, which is what makes it easy to miss.

## Context

Found on 2026-09-11 while verifying the chat in the browser after the P0/P1 round — and then found AGAIN one turn later with a different sentence, which is why the check is a small family of patterns rather than one string. Fixed in `chat-model-agent-sdk.ts`: a short result opening with a known notice is reported as an error (`rate_limited` for the quota family, `unknown` for the rest), which surfaces the app's own pt-BR message and persists nothing (the orchestrator only writes an assistant row on `answered`).

## How to Apply

- Treat the Agent SDK's `result` as *possibly* a CLI status line, not necessarily model output. Success is about the subprocess, not about the answer.
- Never persist an assistant message the adapter cannot vouch for — a poisoned history keeps costing turns after the transient cause is gone.
- When adding a notice to the pattern, keep it anchored to the start of a SHORT result: a real answer to a data question is long, in Portuguese, and never opens with one.
- Expect more of them. Two different sentences showed up within minutes of each other; treat the list as something that grows every time the chat is exercised against a new model or plan state.
