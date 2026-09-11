---
tags:
  - learning
related:
  - "[[fastify-cookie-plugin-register-before-routes]]"
  - "[[../reports/2026-09-11-correcoes-p0-p1]]"
created: 2026-09-11
---
# Refreshing on a 401 must be single-flight, because the refresh token rotates

`POST /auth/refresh` revokes the presented refresh token and issues a new one (reuse detection depends on it). A client that retries every 401 independently therefore breaks itself: the app boots several requests at once, they all get 401 when the 15-minute access token expires, and the second refresh presents a token the first one already spent — which reads as reuse and ends the session that was being renewed. One shared in-flight promise per tab turns the storm into a single rotation.

The rest of the rule is about which 401s deserve a retry at all: `login`, `logout`, `refresh` and `signup` answer 401 on their own merits, so retrying them is meaningless (and refreshing `/auth/refresh` is a loop). Everything else, `/auth/me` included, is worth exactly one refresh-and-replay — and the 401 should escape only when the refresh fails too, because that is the genuine logged-out state the route guard is waiting for.

## Context

Written on 2026-09-11 fixing P0-2: nothing ever refreshed the access token, so the owner was bounced to the login screen mid-conversation while the refresh cookie was still valid. `apiFetch` now refreshes and replays; `streamMessage` does the same by hand (it is a raw `fetch`, not `apiFetch`). Verified in the browser with `ACCESS_TTL_SECONDS` temporarily at 15 s: `/auth/me` 401 → `/auth/refresh` 200 → `/auth/me` 200, app still logged in.

## How to Apply

- Put the retry in the single fetch wrapper, never in each caller — and remember any raw `fetch` that bypasses the wrapper (streaming) needs it copied.
- Guard the refresh with a module-level in-flight promise cleared on settle.
- To test a session-expiry fix, shorten the TTL and watch the network panel; waiting out the real TTL is not a test anyone repeats.
