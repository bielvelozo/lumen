---
tags:
  - learning
  - gotcha
related:
  - "[[subscription-mode-agent-sdk-instead-of-api-key]]"
  - "[[claude-code-status-line-arrives-as-a-successful-answer]]"
created: 2026-09-18
---
# The Agent SDK loads the account's claude.ai connectors under a subscription login

`settingSources: []` and `tools: []` do NOT isolate an Agent SDK call. Under a Pro/Max login the CLI also loads every claude.ai connector on the account (Gmail, Drive, Shopify, Klaviyo, Lucid, Canva…). They connect asynchronously, so a turn that starts before they're up is small (~3k input tokens), and one that starts after gets every connector's tool definitions and goes past 200k tokens. That's the real cause of the "intermittent" `Usage credits are required for long context requests.` (Sonnet) and `Prompt is too long` (Haiku) notices. It is also a leak: the Lumen chat model could see the owner's personal connector tools. `strictMcpConfig: true` plus `ENABLE_CLAUDEAI_MCP_SERVERS=false` in the child env brings the `init` message down to 0 connectors (157 input tokens for a trivial prompt).

## Context

Found while deploying the demo (Pages + tunnel, 2026-09-18). A question answered correctly at 23:09 failed on every retry 15 minutes later with no code change. A probe that printed the SDK `init` message showed 13 `claude.ai *` MCP servers in `pending` state.

## How to Apply

Every Agent SDK `query()` in the product must pass `strictMcpConfig: true` and set `ENABLE_CLAUDEAI_MCP_SERVERS=false` in `env` (done in `apps/api/src/chat/chat-model-agent-sdk.ts`). When debugging context-size notices, log the `init` message's `mcp_servers` and `tools` before blaming the prompt or the tool results.
