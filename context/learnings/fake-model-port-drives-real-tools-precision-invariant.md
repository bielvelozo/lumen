---
tags:
  - learning
  - concept
related:
  - "[[../specs/13-chat-orchestrator/spec]]"
  - "[[../specs/12-query-function-registry/spec]]"
created: 2026-06-18
---
# Verify "the number comes from the DB" with a FAKE model driving the REAL tools

The chat orchestrator's constitutional promise is the precision invariant: *the function
computes, the model narrates* — the figure in the answer must originate from a tool result, not
the model's own arithmetic. The non-obvious part is **how to test that end-to-end without a live
Claude call** (CI has no key; RALPH §4 mocks the provider).

The move: put the ENTIRE model interaction behind a `ChatModelPort` (the tool-loop + streaming),
and in the live test bind a **fake port that drives the real tools**:

```ts
const modelPort: ChatModelPort = {
  run: async (input, handlers) => {
    const tool = input.tools.find((t) => t.name === 'aggregate_over_time')!;
    const result = await tool.execute({ table: 'sales', metric: { agg: 'sum', column: 'total' }, ... });
    const value = Number(result.rows[0]?.value ?? 0);   // the number came from MySQL, not us
    handlers.onTextDelta(`Você vendeu R$ ${value} em maio.`);
    return { outcome: 'answered', text: `...${value}...` };
  },
};
```

`tool.execute` is the REAL one → real spec-12 guarded executor → real mysql2 runner → Docker
MySQL. The fake only *chooses* the function and narrates the returned rows. So the test asserts
the streamed/persisted figure equals the seeded DB sum (350) — proving the number is the DB's,
through the real loop — with **Postgres stores faked** (sessions/messages/logs aren't the
DB-facing risk; the MySQL query is). One env-gated live test covers the constitutional core
without a Claude key.

## Two sinks for one tool call

A tool `execute` fans the same call to two different places, and conflating them leaks data:
- **rows → the model** (and thence the assistant `message`, which legitimately holds business
  numbers — that's the answer, org-scoped).
- **shape → the log** (`function_call_logs.params` = `sanitizeParams(rawInput)` = type tags
  only; `error_message` = a closed code). The log NEVER gets the rows, the values, or a secret.

## Also recorded

- The model port keeps the AI SDK confined to ONE adapter (`createAiSdkChatModel`,
  `streamText` + `tool` + `stepCountIs`), exercised only by an operator/key-gated path; the
  orchestrator's unhappy paths are all unit-tested against the fake port — same shape as spec
  11's `ClaudeValidator` port (CI mocks the provider, the adapter is the thin live edge).
- **Best-effort audit logging:** a `function_call_logs` write hiccup must not fail a successful
  read — `.catch(() => undefined)` on the insert (Gate-2 LOW). The row is best-effort; the
  answer is not held hostage to observability. `message_id` is null (the assistant message is
  created after the loop) — accepted; the row is still scoped by org/session/function/time.
- Anti-IDOR is the same `getAuth`-only seam as [[org-id-only-from-requireauth-getauth]]; a
  foreign `:sessionId` → 404 via the org-scoped ownership check, no cross-tenant read.
