---
status: shipped
feature: home-sales-metrics
created: 2026-09-24
shipped: 2026-09-24
---
# Home Sales Metrics — Spec

**Status:** Shipped
**Scope:** The owner tells Lumen which exposed table holds their sales (the table, its amount column and its date column) on the database screen, and the Home shows three real cards for the last closed month (revenue, order count, average ticket), each compared with the month before.

## Context

The Home carried three hard-coded cards ("R$ 128.000 / 342 pedidos / R$ 374", later relabelled "Exemplo do que o Lumen responde") in a product whose differentiator is exact numbers from the owner's own database — flagged as P1-5 in [[../../reports/2026-09-11-correcoes-p0-p1]]. Nothing in the app records which table or column means "sales": the chat lets the model infer it from names every turn. The Home cannot ask the model (20–100 s per turn, non-deterministic), so the meaning has to be stated once, by the owner.

Decisions taken with the user on 2026-09-24:
- The owner picks the mapping on the database screen (not auto-detection).
- The cards show the **last closed month** against the month before it (a partial current month would show misleading drops at the start of every month).

## Problem Statement

The first screen after login shows invented numbers. It should show the owner's real revenue, orders and average ticket, computed by their database.

## Non-Goals

- Auto-detecting the sales table (may later pre-fill the choice).
- Filtering by order status (the metric counts every row, the same convention the chat uses for "quanto vendi").
- Custom periods, charts, or more than three cards.
- Logging these reads in `function_call_logs`: the audit screen is "what the assistant queried"; the Home is not the assistant.

## Constraints

- **Invariant 3 (no free SQL).** The metrics run through `executeQueryFunction` with the existing `aggregate_over_time` function; the saved mapping is re-checked by the allow-list guard on every read, so a table or column the owner later un-exposes stops being read.
- **Invariant 1.** `org_id` comes from the JWT only; the mapping row is keyed by `org_id`.
- **Invariant 6.** Numbers render on solid `MetricCard`s.
- Saving a mapping validates it against the current exposure with the same guard: amount column numeric, date column temporal.
- The month boundary is computed in `America/Sao_Paulo` (pt-BR product; the client's DATETIME columns are naive local time).

## User Stories / Scenarios

1. Owner with an active connection and exposed tables opens **Banco de dados**, sees a "Vendas no painel inicial" card, picks `pedidos` / `total` / `criado_em`, saves. The choice is shown afterwards and can be changed.
2. Owner opens the Home: sees "Vendas em agosto R$ 74.323,10, +23,7% vs julho", "Pedidos 53", "Ticket médio", with the deltas.
3. Owner with no mapping sees, in place of the cards, a short call to action linking to the database screen.
4. Owner whose mapping points at a table/column no longer exposed, or whose connection is not active, sees a calm "não foi possível calcular" message with the link — never a 500, never fake numbers.
5. A month with no sales shows R$ 0,00 / 0 pedidos / ticket "—", and the delta says there were no sales to compare with.

## Success Criteria

- `GET /home/metrics` returns the figures the reference SQL returns for the test dataset (August/2026: 53 orders, R$ 74.323,10; July/2026: 46, R$ 60.098,00).
- `PUT /sales-mapping` refuses an unexposed table, a non-numeric amount and a non-temporal date column with 422.
- A forged `orgId` in body/query is ignored (anti-IDOR test).
- Home and database screen verified in the browser.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Mapping goes stale when exposure changes | Guard re-validates on each read → typed `unavailable` state with a link to fix it |
| DECIMAL sums arrive from mysql2 as strings | Service normalizes to decimal strings; the web formats, never re-sums |
| Three short-lived MySQL connections per Home load | Acceptable at v1 scale; queries run in parallel, each bounded by the runner's timeouts |

## Open Questions

None.

## Result (2026-09-24)

All success criteria met. `GET /home/metrics` returned August/2026 53 orders R$ 74.323,10 and July/2026 46 orders R$ 60.098,00 against the local dataset, identical to the direct `SELECT`; the Home renders them with +23,7% / +15,2% / +7,3% vs July. 27 API tests (service, route incl. anti-IDOR, live Postgres store, live MySQL end-to-end with last-day bounds), 7 web tests, and the glass-only invariant test now asserts a real figure is off-glass.

Learnings: [[../../learnings/key-columns-pass-a-numeric-type-filter]], [[../../learnings/last-closed-month-flips-in-the-owners-timezone]].
