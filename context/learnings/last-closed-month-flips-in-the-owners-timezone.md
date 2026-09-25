---
tags:
  - learning
related:
  - "[[../specs/17-home-sales-metrics/spec]]"
  - "[[bare-iso-date-as-inclusive-upper-bound-drops-the-last-day]]"
created: 2026-09-24
---
# The last closed month flips in the owner's timezone

The client's `DATETIME` columns are naive local time (a sale at 23:30 on Aug 31 is stored as `2026-08-31 23:30:00`), while the API container runs in UTC. Computing "last month" from `new Date()` in UTC turns the page at 21:00 in Brazil: between 21:00 and midnight on the last day of a month, the Home would already call the running month "closed" and compare a partial month against a full one.

## Context

Designed in on 2026-09-24 for spec 17 (Home sales metrics). `lastClosedMonths` reads year/month through `Intl.DateTimeFormat` with `timeZone: 'America/Sao_Paulo'`; tests pin 02:00 UTC on Sept 1st as still July-closed and 03:30 UTC as August-closed. The month's rows are then bounded `from 00:00:00` to `to 23:59:59`, the registry's existing convention.

## How to Apply

- Any "current/last period" boundary over the client's data must be computed in the owner's timezone, not the server's. v1 hard-codes `America/Sao_Paulo` (pt-BR product); a per-org timezone is the fix when a non-Brazilian owner appears.
- Inject `now` into anything that computes a period, so the boundary itself is testable.
