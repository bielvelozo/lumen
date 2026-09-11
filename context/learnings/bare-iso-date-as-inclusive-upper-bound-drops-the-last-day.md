---
tags:
  - learning
  - gotcha
related:
  - "[[fake-model-port-drives-real-tools-precision-invariant]]"
  - "[[../reports/2026-09-11-correcoes-p0-p1]]"
created: 2026-09-11
---
# A bare ISO date as an inclusive upper bound silently drops the last day

`filtered_aggregate` bound every filter value exactly as the model supplied it, so `created_at <= '2026-05-31'` against a `DATETIME` column compares as `2026-05-31 00:00:00` and quietly excludes everything that happened that day. May 2026 answered **86** orders instead of **90** — a wrong number with no error, no refusal and no log entry, in the one product whose entire promise is that the number is exact. `aggregate_over_time` had already solved this for its own `from`/`to` (it binds `00:00:00` / `23:59:59`), so the two functions disagreed about what a date range means.

The closed filter-op enum makes the fix necessary rather than optional: there is no `lt`, so the model cannot express "before June 1st" — an inclusive `lte` is the *only* way to end a period, and it has to mean the whole day.

## Context

Found on 2026-09-11 verifying the QA handoff's P1-10 against the seeded MySQL dataset. Fixed in `sql-fragments.ts` with a `filterValue(op, value)` that binds `<date> 23:59:59` when `op === 'lte'` and the value is date-shaped; non-date values and explicit timestamps pass through. Covered by a unit test and by a live case in `executor.live.integration.test.ts` (a row at 23:30 on the last day must be counted, the next month's 00:30 row must not).

The same round also found that the model had no way to know the v1 conventions — the exposed relationships were never listed in the system prompt, so it tried to join by column name and got `column_not_exposed`.

## How to Apply

- Whenever a user-facing date becomes a SQL bound, decide explicitly what the last day means and make every query function agree. A date is a *day*, not a midnight instant.
- A precision bug does not announce itself: assert query-function results against figures computed independently in the database, not against the model's prose.
- Anything the model must know to fill params correctly (period conventions, which table filters apply to, the exposed relationship names) belongs in the system prompt — it cannot infer a backend convention.
