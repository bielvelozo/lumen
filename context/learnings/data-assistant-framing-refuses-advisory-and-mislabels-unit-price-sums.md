---
tags:
  - learning
  - gotcha
related:
  - "[[fake-model-port-drives-real-tools-precision-invariant]]"
  - "[[../specs/13-chat-orchestrator/spec]]"
created: 2026-09-18
---
# A "data assistant" prompt refuses advisory questions, and advisory answers expose unit-price sums sold as revenue

With a system prompt that only said "você é o assistente de dados… responde perguntas sobre os dados", Claude answered "me dê uma ideia de promoção pra Black Friday" by declaring marketing out of its scope and offering to run analyses instead. Nothing in the prompt forbade it; the narrow role framing was enough. Once the prompt made data-grounded advice part of the job, a second, older bug surfaced: to rank products "by revenue" the model called `filtered_aggregate` with `sum(itens_pedido.preco_unit)` and presented it as faturamento (café: R$ 54.390 vs the real R$ 301.980). The registry cannot multiply quantity × price, and the model did not know that. The ranking happened to coincide, which is what makes it look right.

## Context

Reported by the owner on 2026-09-18 from the chat UI. Fixed in `apps/api/src/chat/system-prompt.ts`: an "IDEIAS E ESTRATÉGIA" block (never refuse business/marketing requests, fetch the data before suggesting, cite the figure, label proposals as suggestions), plus a rule that a summed unit-price column is not revenue ("mais vendidos" = sum of quantity). Default `maxSteps` went from 5 to 8 so an advisory turn can gather several figures. Covered by `system-prompt.test.ts`; verified live against the Docker MySQL — every figure in the new Black Friday answer matched a direct `SELECT`.

## How to Apply

- The role sentence in the system prompt defines scope as much as the rules do. State every capability the product promises, or the model will politely refuse it.
- After any prompt change that widens what the model does, re-check the numbers it quotes against direct SQL: new question types reach tool/param combinations nobody tested.
- A revenue-per-product question needs either a total-per-item column or a new registry function that computes `quantity × price` server-side — until then, the prompt must steer to quantities.
