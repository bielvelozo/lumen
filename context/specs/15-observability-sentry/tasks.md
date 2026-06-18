---
status: in-progress
feature: observability-sentry
created: 2026-06-18
---
# Observability & Auditability — Tasks

A box is checked ONLY after its slice is implemented AND committed.

## 1 — Shared: redactSensitive + env + audit DTO
- [ ] `redact.ts`: `SENSITIVE_KEY` denylist + `redactSensitive(value)` (deep, redacts denylisted
      keys → `[REDACTED]`, depth/size bounded) + `containsSensitiveLeaf(value)`. `env.ts`:
      + `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`. `audit-contracts.ts`: `auditQuerySchema`
      + `AuditLogDTO` + `AuditPageResponse`. Export from index. Tests: redacts cookies/headers/
      secrets/email/sample rows; keeps benign values; env coerces the rate.

## 2 — API Sentry: scrubber + init + request id
- [ ] `observability/scrubber.ts`: `scrubEvent`/`scrubBreadcrumb` (redactSensitive + strip request
      body/query + `cookie`/`set-cookie`/`authorization` headers + server name). `sentry.ts`:
      `initSentry(env)` (no-op when DSN absent; `sendDefaultPii:false`, beforeSend/beforeBreadcrumb,
      sample rate). `request-id.ts`: opaque id per request → request + error header. Add `@sentry/node`.
      Wire into app/server (init + hook + error handler returns request id). Tests: scrubEvent on a
      poisoned event redacts everything; request id is opaque; disabled-without-DSN no-ops.

## 3 — API audit endpoint + write-site guard
- [ ] `audit.store.ts` (listForOrg: org-scoped, newest-first, filter status/functionName, paginated)
      + `audit.route.ts` (GET `/audit/function-calls`, org from getAuth). Wire into app/server.
      `function-log.store`: write-time guard asserting no sensitive leaf in params/error_message.
      Tests: cross-org isolation (forged org id → only caller's rows); filters; write-site guard.

## 4 — Web Sentry + audit surface
- [ ] `observability/sentry.ts` (init no-op without DSN) + `ErrorBoundary` (solid). `lib/audit.ts`
      + `audit-queries.ts`; `routes/audit/AuditPage.tsx` (paginated list on SOLID surfaces) + router
      `/audit` + AppShell NavItem. Add `@sentry/react`. Tests: list renders on solid (no `.glass`);
      no request carries an `org_id`; error boundary renders a solid fallback.

## 5 — Gate-1 + ship
- [ ] `/security-review` on the diff; resolve findings (no secret/cookie/token/raw row to Sentry
      or the audit response; audit org-scoped).
- [ ] Full suite green: `pnpm build && lint && type-check && test`.
- [ ] Record open-question defaults in `DECISIONS.md`; mark spec Shipped (MOC + frontmatter)
      atomically; capture learnings.
