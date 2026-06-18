---
status: in-progress
feature: observability-sentry
created: 2026-06-18
---
# Observability & Auditability (Sentry) — Implementation Plan

Implements `[[spec]]` — **Gate-1 (security-review) spec**. Wire Sentry into `apps/api` + `apps/web`
behind a strict scrubber; centralize the redaction discipline in `packages/shared`; and add the
org-scoped audit READ path over the `function_call_logs` rows spec 13 already writes.

## Invariants this spec must hold (Gate-1)

- **No secret / cookie / token / raw client-DB row ever reaches Sentry** — `beforeSend` +
  breadcrumb scrubber is MANDATORY, runs on every event, strips request bodies/query/headers
  (`cookie`/`set-cookie`/`authorization`) + every denylisted key; `sendDefaultPii: false`.
- **Single source of truth:** one shared `redactSensitive` (denylist) used by BOTH the Sentry
  scrubber AND verified at the `function_call_logs` write site — the sensitive-key list can't drift.
- **Audit anti-IDOR:** `GET /audit/function-calls` reads `WHERE org_id = jwt.org_id` ONLY — never
  a query param / body. A forged org id returns no foreign rows.
- **Correlation without PII:** a random opaque request id per API request → Sentry tag + error
  response; it encodes no user/org/email/secret.
- Missing `SENTRY_DSN` ⇒ SDK disabled, both apps boot + tests pass.

## Architecture

```
packages/shared/src/
  env.ts                 # + SENTRY_ENVIRONMENT, SENTRY_TRACES_SAMPLE_RATE (coerced number)
  redact.ts              # SENSITIVE_KEY denylist + redactSensitive(value) + containsSensitiveLeaf
  audit-contracts.ts     # auditQuerySchema (status/functionName/page/limit) + AuditLogDTO + page resp
apps/api/src/observability/
  scrubber.ts            # scrubEvent / scrubBreadcrumb (redactSensitive + strip body/query/headers)
  sentry.ts              # initSentry(env) — no-op when DSN absent; binds the scrubber + sample rate
  request-id.ts          # onRequest hook: opaque request id -> request + Sentry tag + error header
apps/api/src/audit/
  audit.store.ts         # listForOrg(orgId, filters, page) over function_call_logs (idx_log_org_created)
  audit.route.ts         # GET /audit/function-calls (requireAuth; org from getAuth)
apps/api/src/chat/function-log.store.ts  # write-time guard: assert no sensitive leaf survives (+ test)
apps/api/src/app.ts + server.ts          # init Sentry + request-id hook + wire audit; error handler
apps/web/src/
  observability/sentry.ts  # initSentry (no-op without DSN) + ErrorBoundary (solid surface)
  lib/audit.ts + audit-queries.ts        # fetch the audit list (no org_id)
  routes/audit/AuditPage.tsx             # paginated list on SOLID surfaces; router + NavItem
```

## Open-question defaults (recorded in DECISIONS.md)

- Traces sample rate: conservative default `0.1`, env-overridable (finalized in 16).
- Retention/archival of `function_call_logs`: out of scope here; flagged for a later spec.
- Audit visibility: owner-only in v1 (only role present).
- Sentry tenant tag: OMIT any tenant identifier by default; the request id is the only tag (opaque).
- Sentry SDK versions: pin current stable `@sentry/node` + `@sentry/react`; record once installed.

## Gate-1 / verification

- `/security-review` on the diff; resolve findings. Re-verify by hand no secret/cookie/token/raw
  row can reach Sentry or the audit response.
- Tests: `redactSensitive` (cookies/headers/secrets/email/sample rows → `[REDACTED]`); `scrubEvent`
  on a fully-poisoned event; the write-site guard (no denylisted leaf in params/error_message);
  audit endpoint cross-org isolation (forged org id → only caller's rows); web audit renders on a
  solid surface (no `.glass`) + no request carries an `org_id`; Sentry disabled without DSN boots.
- Full suite green: `pnpm build && lint && type-check && test`.
