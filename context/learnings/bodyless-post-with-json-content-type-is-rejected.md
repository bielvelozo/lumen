---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/13-chat-orchestrator/spec]]"
  - "[[../specs/14-chat-ui/spec]]"
  - "[[../specs/06-web-shell-and-auth-ui/spec]]"
created: 2026-09-05
---
# A body-less POST with `Content-Type: application/json` is rejected by Fastify — and the error handler hides it as a 500

`apiFetch` always sets `Content-Type: application/json`, even when there is no `body`. Fastify's JSON parser then throws `FST_ERR_CTP_EMPTY_JSON_BODY` (a 400), and the app's `setErrorHandler` rewrites EVERY error — including Fastify's own 4xx — into `500 InternalError`. Every body-less mutation the web makes (`POST /chat/sessions`, `POST /db-connection/test`, `POST /auth/logout`) therefore fails in the real browser while passing every unit test (the web tests mock `fetch`; the API tests use `app.inject` without that header).

## Context

Found during the 2026-09-05 end-to-end client run (`[[../reports/2026-09-05-teste-funcional-cliente]]`): the chat could not create a session from the UI, "Testar novamente" did nothing, and logout left the refresh token valid server-side (`POST /auth/refresh` still returned 200 after "Sair").

## How to Apply

- Only send `Content-Type: application/json` when a body is present (or always send `{}` for body-less mutations).
- In `setErrorHandler`, pass through `error.statusCode < 500` untouched (validation, malformed JSON, 413) and reserve the sanitized 500 + Sentry capture for real server faults.
- Keep at least one test that drives the API through the real web client wrapper (no `fetch` mock), so header/body mismatches surface.
