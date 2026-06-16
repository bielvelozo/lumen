---
tags:
  - rule
  - safety
severity: critical
applies-to:
  - backend query layer
  - the predefined query functions
  - any endpoint that reads tenant data
created: 2026-06-15
---
# Data-access review gates: org_id from the JWT, never free SQL

Two constitutional invariants are promoted here to hard review gates: (1) every query that touches tenant data is scoped by an `org_id` taken from the authenticated JWT, never from a client-supplied value; and (2) the model never emits SQL — it only selects among predefined, parameterized, read-only query functions, which the backend executes. A change that weakens either gate must not merge.

## Why

These are the two ways this product fails catastrophically. If `org_id` can come from the request, one tenant can read another's data (IDOR) and the isolation promise is broken. If the model can produce SQL, the "safe doors only" guarantee collapses and prompt injection becomes data exfiltration. Both are non-negotiable in the [[../constitution|Constitution]]; this rule makes them explicit checklist items a reviewer must verify, not assumptions.

## How to Apply

Block the change at review if any of these is true:

- A query derives `org_id` (or any tenant key) from the request body, query string, path param, or header instead of from the verified JWT claims.
- A new or edited data path reads tenant data without an `org_id` filter — including `messages`, `function_call_logs`, and anything that joins to them.
- Any code path builds SQL from model output, concatenates model text into a query, or adds a "just this once" free-form query escape hatch.
- A query function is added that is not parameterized, not read-only, or can reach tables the owner did not explicitly expose.

If a feature seems to *need* one of these, it is a constitutional discussion (see [[../constitution|Constitution]]) — not a code-review override.
