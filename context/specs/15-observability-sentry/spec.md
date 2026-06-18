---
status: shipped
feature: observability-sentry
created: 2026-06-17
shipped: 2026-06-18
---
# Observability & Auditability (Sentry) — Spec

**Status:** Draft
**Scope:** Wire **Sentry** into `apps/api` (Fastify) and `apps/web` (React) for error capture and basic performance traces, behind a strict data-scrubbing layer that never lets raw customer data, secrets, credentials, cookies, or tokens leave the process. Harden the **`function_call_logs`** write path established in `[[../13-chat-orchestrator/spec|13]]` (sanitized `params`/`error_message`, plus `duration_ms`/`status`/`provider`/`model`), and expose a **per-org audit view** — an `org_id`-scoped endpoint plus a minimal frontend surface — so the owner can see what the assistant queried. Correlate errors with a request/trace id without leaking PII.

## Context

The `[[../../constitution|Constitution]]` makes two promises that meet in this spec. **Transparency / auditability:** what the assistant queried is logged and auditable per organization — *without ever storing the raw underlying data*; `function_call_logs.params` and `error_message` are sanitized at the write site. **Secrets & isolation:** the client-DB password and AI key stay encrypted and out of the DB, every query is scoped by `org_id` from the JWT, and logs never carry raw customer data. Observability is where these are easiest to break by accident: an error reporter, left at defaults, will happily ship request bodies, headers, cookies, and local variables — including a decrypted secret or a row of customer data — straight to a third party.

This is phase 5 (Decision 10) per `[[../../HANDOFF|HANDOFF]]`. The rows already exist: `function_call_logs` is defined in `db/schema.sql` (org-scoped, with `params jsonb` sanitized, `status`, `duration_ms`, `provider`, `model`, `error_message` sanitized) and is **written** by the orchestrator in `[[../13-chat-orchestrator/spec|13]]`. This spec does not invent that table or its writer. It (a) adds Sentry to both apps with aggressive scrubbing, (b) *hardens and verifies* the sanitization guarantee at the `function_call_logs` write site and centralizes it so it cannot drift, and (c) builds the read side — the auditable view the owner was promised.

Because this slice is logging/observability over auth-, secret-, and tenant-sensitive paths, it is governed by `[[../../rules/security-review-before-merge|security-review-before-merge]]`: it must pass an explicit security review before merge.

## Problem Statement

When something breaks in production — the client DB drops, the AI key is rejected, a query function throws — we currently have no signal beyond a log line on a VPS. We need real error tracking (Sentry) on both API and web, with enough trace/performance context to diagnose, **and** we need it to be safe by construction: no default integration may exfiltrate a request body, a header, a cookie, a token, a decrypted secret, or a single cell of the client's business data. At the same time, the owner was promised they could *see what the assistant did on their behalf* — but the audit rows the orchestrator writes have no read path yet. This spec closes both gaps: trustworthy error capture, and an org-scoped window onto the assistant's activity, sharing one sanitization discipline so the same data never leaks through either door.

## Non-Goals

- **Deploy / hosting / DSN provisioning** — Sentry project setup, environment DSNs, release/sourcemap upload in CI, alerting rules: all `[[../16-deploy/spec|16 · Deploy]]`. Here, the SDK is wired and reads its DSN from validated env; if the DSN is absent (local dev) it no-ops cleanly.
- **Building the log rows.** The `function_call_logs` schema and the orchestrator's *writing* of them belong to `[[../13-chat-orchestrator/spec|13]]`. This spec hardens the sanitization at that write site and adds the **read** path; it does not own the orchestration that emits them.
- **A full analytics / BI surface.** The audit view is a minimal, paginated, read-only list scoped to the org — not charts, not aggregations, not cross-org dashboards.
- **Audit logging of auth events** (logins, token rotation) — out of scope here; this view is specifically the *assistant's query activity* (`function_call_logs`).
- **Log retention / archival / export** policy — noted as an open question, not built here.

## Constraints

- **Two SDKs, one discipline.** Use the official Sentry SDKs: `@sentry/node` (with Fastify integration) in `apps/api`, `@sentry/react` in `apps/web`. Both initialize from a Zod-validated `SENTRY_DSN` (+ `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`) sourced through `packages/shared`'s env schema (`[[../00-monorepo-scaffold/spec|00]]`). Missing DSN → SDK disabled, app boots normally (local dev must not require Sentry).
- **`beforeSend` / `beforeSendTransaction` is mandatory, not optional.** On the API, a scrubbing layer runs on every event *and breadcrumb* before it leaves the process and **redacts/strips**: request bodies, query strings, the entire `cookie`/`set-cookie` and `authorization` headers, any field whose key matches a secret/PII denylist (`password`, `encrypted_password`, `encrypted_api_key`, `api_key`, `apiKey`, `token`, `token_hash`, `secret`, `email`, etc.), and any captured local variables. Default PII off: `sendDefaultPii: false`. Server name / IP scrubbed.
- **No raw client-DB data, ever.** Values returned from the client MySQL (rows, cells, result sets) must never enter a Sentry event, breadcrumb, message, or exception context. Errors raised on the client-DB path carry only *shape* (function name, table/relationship identifiers from the allow-list, row **count**, `duration_ms`) — never values. This mirrors the `last_error` / `function_call_logs.error_message` "sanitized, no raw data" rule already in the schema.
- **Secrets never reach Sentry.** Decrypted passwords/API keys (Constitution invariant 2) must be impossible to capture: keep them out of error messages and out of any object that could be serialized into an event; the denylist scrubber is defense-in-depth, not the primary guard.
- **Centralized sanitizer, single source of truth.** The redaction used by `beforeSend` and the redaction used at the `function_call_logs` write site share one tested function in `packages/shared` (e.g. `redactSensitive(value)`), so the "what counts as sensitive" list cannot drift between the two doors. `params` written to `function_call_logs` records argument **names/shapes/operators**, never sensitive literal values.
- **`function_call_logs` write site, hardened.** Confirm/enforce that every write sets `org_id` (from JWT context, never client input), `function_name`, sanitized `params`, `status` (`success`/`failed`), `duration_ms`, `provider`, `model`, and sanitized `error_message`. Add a write-time assertion/guard (and a unit test) proving no denylisted key survives into `params`/`error_message`.
- **Audit endpoint is `org_id`-scoped from the JWT (anti-IDOR).** `GET /audit/function-calls` (paginated, newest-first, filterable by `status`/`function_name`/date) reads `function_call_logs WHERE org_id = <jwt.org_id>`. The `org_id` is derived from the verified JWT on the request, **never** from a query param or body (Constitution invariant 1). Uses the existing `idx_log_org_created` index. Response DTO is a Zod contract in `packages/shared`; it returns only already-sanitized fields — no field that could carry raw data is added.
- **Correlation without PII.** Generate/propagate a request id (and Sentry trace id) per API request; attach it as a Sentry tag and return it on error responses so a user-reported failure maps to an event. The request id is a random opaque id — it encodes no user, org, email, or secret. The web SDK tags releases/sessions but captures no form values or input contents (mask user input; no `email` in user context — at most a hashed/opaque org or user id tag if needed).
- **Web error boundary on solid surfaces.** The React error boundary and the audit list render on **solid, high-contrast data surfaces**, not glass (Constitution / `[[../../conventions|conventions]]`): the audit rows are data and must never sit on the frosted chrome.
- **Tested.** Vitest unit tests for the sanitizer and the `beforeSend` scrubber (feed an event containing cookies/headers/secrets/email/sample rows → assert all redacted); an integration test that the audit endpoint refuses cross-org reads and returns only the caller's org rows.
- Honors `[[../../rules/security-review-before-merge|security-review-before-merge]]`: run `/security-review` on the branch; re-verify by hand that no secret, cookie, token, or raw client row can reach Sentry or the audit response.

## User Stories / Scenarios

1. **An error is captured, scrubbed, and correlatable.** A query function throws against the client DB. Sentry receives an event tagged with the request/trace id; the event contains the function name, table identifiers, and `duration_ms` — and **no** row values, no cookie, no `authorization` header, no decrypted secret. The failing API response returns the same request id so the report ties to the event.
2. **Secrets and customer data cannot leak.** A developer deliberately constructs an error whose context includes a decrypted password and a sample customer row, then triggers it. The delivered Sentry event shows both redacted (`[REDACTED]`), proving `beforeSend` and the shared sanitizer caught them.
3. **The owner audits the assistant.** An owner opens the audit view and sees a paginated, newest-first list of what the assistant queried for **their** org — function name, status, duration, provider, model, timestamp, and sanitized params — on a solid data surface. They can filter by failures. They never see another org's activity, and never see raw values.
4. **Anti-IDOR holds.** A request to the audit endpoint carrying a different org's id in a query param or forged body still returns only the caller's own rows, because `org_id` comes from the JWT. A cross-org read attempt yields nothing belonging to the other org.
5. **Local dev needs no Sentry.** A developer with no `SENTRY_DSN` set runs both apps; they boot and function normally, Sentry disabled, no crashes and no noisy warnings — and the `function_call_logs` write + audit endpoint still work.
6. **The log write is provably clean.** The orchestrator logs a function call whose arguments include a value that matches the denylist; the persisted `function_call_logs.params` records the argument *names/operators* but the sensitive value is redacted, asserted by a unit test at the write site.

## Success Criteria

- `@sentry/node` (Fastify) and `@sentry/react` initialize from validated env; absent DSN ⇒ disabled, both apps boot and pass tests.
- A mandatory `beforeSend` + breadcrumb scrubber on the API strips request bodies, query strings, `cookie`/`set-cookie`/`authorization` headers, denylisted keys (secrets/tokens/email/PII), and local variables; `sendDefaultPii` is false. A test sends a fully-loaded event and asserts every sensitive field is redacted.
- No client-DB row value, decrypted secret, credential, cookie, or token appears in any Sentry event, breadcrumb, message, or context — verified by test and by manual security review.
- The `function_call_logs` write site is centralized through the shared sanitizer and verified to set `org_id`, `function_name`, sanitized `params`, `status`, `duration_ms`, `provider`, `model`, sanitized `error_message`; a unit test proves no denylisted key survives into `params`/`error_message`.
- The shared `redactSensitive` (or equivalent) is the single source of truth used by both `beforeSend` and the log writer, with its own unit tests.
- `GET /audit/function-calls` returns the caller's org's logs, paginated newest-first (using `idx_log_org_created`), filterable by `status`/`function_name`/date, `org_id` taken from the JWT; an integration test proves cross-org isolation (anti-IDOR).
- The audit endpoint's request/response DTOs are Zod contracts in `packages/shared`, returning only sanitized fields.
- A request/trace id is generated per API request, attached as a Sentry tag, and returned on error responses; it encodes no PII.
- A minimal web audit surface renders the list on a solid data surface (not glass), with a React error boundary; web SDK masks user input and carries no email/form values.
- Root `pnpm lint`, `pnpm type-check`, `pnpm test` pass across the workspace; `/security-review` run on the branch with findings resolved.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Sentry defaults exfiltrate PII/secrets (bodies, headers, cookies, local vars) before anyone notices | `beforeSend` + breadcrumb scrubber is mandatory and tested; `sendDefaultPii: false`; ship a deliberately-poisoned event in a test and assert full redaction; gate merge on `[[../../rules/security-review-before-merge|security-review-before-merge]]` |
| Raw client-DB rows leak via an exception message or error context on the query path | Errors on the client-DB path carry only shape (function/table ids, row **count**, `duration_ms`), never values; denylist scrubber as defense-in-depth; test with a sample row in context |
| Sanitizer logic drifts between `beforeSend` and the `function_call_logs` writer, opening a gap in one door | One shared `redactSensitive` in `packages/shared` used by both, with unit tests; no local re-implementation allowed |
| Audit endpoint trusts a client-supplied org id → cross-tenant leak (IDOR) | `org_id` derived from verified JWT only; query is `WHERE org_id = jwt.org_id`; integration test asserts a forged org id returns no foreign rows |
| A decrypted secret reaches an event despite scrubbing (serialized object, stack frame) | Keep secrets out of error messages and serializable contexts at the source (Constitution invariant 2); scrubber is backstop not primary guard; manual review of secret-handling paths |
| Request/trace id accidentally encodes user/org/email, leaking PII into tags | Id is random and opaque; reviewed to ensure it derives from nothing identifying |
| Audit data rendered on glass chrome, violating the legibility/"data on solid" invariant | List + error boundary render on solid high-contrast surfaces per `[[../../conventions|conventions]]`; reviewed in UI |
| Sentry hard-required, breaking local dev without a DSN | Missing DSN cleanly disables the SDK; apps boot and tests pass without it; covered by a scenario |

## Open Questions

- [NEEDS CLARIFICATION: traces sample rate per environment — a low fixed rate (e.g. 0.1) for prod vs. 1.0 for staging, or dynamic sampling? Default to a conservative low rate, finalized with DSN/env config in `[[../16-deploy/spec|16]]`.]
- [NEEDS CLARIFICATION: retention/archival policy for `function_call_logs` (rows grow unbounded per org) — is a retention window or pruning job needed, and does the audit view paginate far enough back? Out of scope to build here; flag for a later spec.]
- [NEEDS CLARIFICATION: should the audit endpoint be owner-only, or visible to a future `member` role? Defaults to owner-only in v1 (only role present); revisit when membership lands (v2).]
- [NEEDS CLARIFICATION: do we attach an opaque org/user id tag to Sentry events for triage, or omit any tenant identifier entirely? Lean omit-by-default; if a tag is needed, use a non-reversible opaque id, never the email or raw uuid.]
- [NEEDS CLARIFICATION: exact pinned versions of `@sentry/node` / `@sentry/react` and the Fastify integration — pick current stable, record as a convention once locked.]
