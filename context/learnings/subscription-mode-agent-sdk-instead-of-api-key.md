---
tags:
  - learning
  - concept
related:
  - "[[fake-model-port-drives-real-tools-precision-invariant]]"
  - "[[query-functions-injection-proof-by-allowlist-membership]]"
  - "[[../reports/2026-09-05-teste-funcional-cliente]]"
created: 2026-09-09
---
# A Claude subscription cannot call the Messages API, but the Agent SDK can run the chat under it

A Claude Pro/Max subscription gives no Messages API access: an `sk-ant-api…` key needs prepaid console credits, and an org-level key additionally needs the `anthropic-workspace-id` header. What the subscription does cover is Claude Code, and `@anthropic-ai/claude-agent-sdk` runs Claude Code as a library — authenticated by the local `claude` login or a `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`. Because `ChatModelPort` hides the model behind `run(input, handlers)`, a second adapter (`chat-model-agent-sdk.ts`) slots in without touching the orchestrator: the registry tools become an in-process MCP server via `createSdkMcpServer` + `tool()`, `tools: []` removes every built-in tool, `allowedTools` lists only `mcp__lumen__<fn>`, `settingSources: []` and an empty `cwd` keep the user's own CLAUDE.md/settings out, and `includePartialMessages` yields `stream_event` text deltas for the SSE stream.

## Context

Added on 2026-09-09 for the school-project deployment (no API budget). Personal/demo use only: the token is the operator's own credential, so this is `AI_AUTH_MODE=subscription` server-wide, never per customer; the BYO-key path stays the default. The Zod 3 tool schemas work with the SDK's `tool()` (it wants a raw shape, so unwrap `ZodEffects` → `ZodObject.shape`); the SDK's peer requirement is Zod 4 but it bundles its own JSON-schema conversion, so the mismatch is only a warning.

## How to Apply

- Keep both adapters behind the port; wire by env in `server.ts`. Never persist an OAuth token per org.
- Expect ~20 s per turn (a Claude Code subprocess per question); history goes in as a transcript in the prompt because sessions are not persisted.
- `tsx watch` hung under the preview runner after the SDK install (plain `tsx` boots fine) — `.claude/launch.json` runs the API without watch.
