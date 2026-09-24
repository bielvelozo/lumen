---
tags:
  - learning
  - gotcha
related:
  - "[[subscription-mode-agent-sdk-instead-of-api-key]]"
  - "[[claude-code-status-line-arrives-as-a-successful-answer]]"
created: 2026-09-24
---
# Agent SDK text blocks arrive without a separator

When the model writes a sentence, calls a query tool and then writes the answer, each piece is a separate text content block, and the `text_delta` stream carries no whitespace between them. Concatenating the deltas as they come glues the pre-tool sentence to the answer: "Vou buscar as duas informações ao mesmo tempo! 🔍Aqui está o resumo" — in the stream and in the persisted assistant message, so markdown also loses the paragraph break (a table or heading that opens the second block no longer renders as one).

## Context

Found on 2026-09-24 during an end-to-end browser pass of the chat in subscription mode, on a two-part question ("quanto vendi em maio e quantos pedidos?") that made the model announce the lookup before calling the tools. Fixed in `chat-model-agent-sdk.ts`: on a top-level `content_block_start` of type `text`, `textBlockSeparator` emits `\n\n` (or the missing half of it) when text already exists, both to the live stream and to the text that gets persisted.

## How to Apply

- Any adapter that assembles a turn from streamed deltas must insert its own boundary between text blocks; the provider does not.
- Emit the separator through the same `onTextDelta` path as the text, so what the owner saw streaming and what is stored stay identical.
- The Vercel AI SDK path (`createAiSdkChatModel`, `textStream`) concatenates step texts the same way; it only runs in `api_key` mode, which could not be exercised here without API credits.
