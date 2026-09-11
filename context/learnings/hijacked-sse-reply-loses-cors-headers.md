---
tags:
  - learning
  - gotcha
related:
  - "[[sse-over-post-fetch-and-stream-surviving-navigation]]"
  - "[[bodyless-post-with-json-content-type-is-rejected]]"
  - "[[../reports/2026-09-05-teste-funcional-cliente]]"
created: 2026-09-10
---
# A hijacked SSE reply drops the CORS headers and defers them until the first delta

`reply.hijack()` takes the response out of Fastify's send path, so whatever `@fastify/cors` put on `reply` never reaches the wire unless the route copies it into its own `raw.writeHead(...)`. Node also buffers the status line and headers until the first `write`, which in the chat is the first text delta — 20 s or more away in subscription mode. The browser therefore saw a cross-origin response with no `Access-Control-Allow-Origin` (`net::ERR_FAILED`), the UI showed nothing, and yet the backend answered and persisted the assistant message. `app.inject` tests never register CORS, so they cannot catch it.

## Context

Found on 2026-09-10 while verifying the chat from the real browser for the first time (creating a session from the UI had been impossible until the body-less-POST fix). Fixed in `chat.route.ts` by copying `access-control-allow-origin`, `access-control-allow-credentials` and `vary` from `reply.getHeader` into `writeHead`, followed by `raw.flushHeaders()`.

## How to Apply

- Any hijacked/raw response must re-emit the CORS headers itself and flush them immediately.
- Verify streaming routes from a browser on a different origin at least once; `inject`-based tests only prove the wire format, not the headers.
