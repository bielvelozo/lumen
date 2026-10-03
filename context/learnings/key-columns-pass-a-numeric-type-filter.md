---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/17-home-sales-metrics/spec]]"
created: 2026-09-24
---
# Key columns pass a numeric type filter

Filtering exposed columns by type family is not enough to find "an amount": every `id` and `*_id` is an `int`, so a table like `clientes(id, …, criado_em)` qualifies as a sales table with `id` as its "valor da venda" — and, being first alphabetically, it was the pre-selected choice. The registry guard accepts it too (it is a genuine numeric column), so nothing downstream catches it; the Home would have summed customer ids.

## Context

Found on 2026-09-24 verifying spec 17 in the browser against the test dataset. The unit test's fixture had no date column on `clientes`, so it passed; the real `clientes` has `criado_em`. Fixed in `SalesMappingCard.tsx`: key-named columns (`id`, `*_id`) are not offered as the amount, which leaves `pedidos` as the only candidate.

## How to Apply

- When a UI offers columns for a *meaning* (amount, price, quantity), exclude keys by name on top of the type check; the type family only says what SQL may do with the column.
- Build fixtures from the real introspected schema, not a trimmed one: the trim is exactly where this hid.
