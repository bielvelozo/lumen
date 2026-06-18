---
tags:
  - learning
  - gotcha
related:
  - "[[../specs/15-observability-sentry/spec]]"
created: 2026-06-18
---
# A key-name denylist is NOT a content scrubber — drop wholesale, normalize keys, scan strings

The first cut of the Sentry scrubber (spec 15) was `beforeSend: redactSensitive(event)`, where
`redactSensitive` redacts any value whose KEY is in a denylist. The Gate-1 review found three real
ways a secret/PII still reached the third party, all from over-trusting key-name matching:

1. **Request headers leaked.** A header object is `{ "cookie": …, "authorization": …,
   "x-api-key": … }`. Relying on the key matching the denylist is fragile: `x-api-key` lowercased
   is `x-api-key`, which does **not** contain `api_key` or `apikey` (different separators) — so the
   Anthropic key in `x-api-key` survived. **Fix: drop `request.headers` (and body/query/cookies)
   WHOLESALE.** Don't scrub headers by key; delete the whole object.

2. **Hyphenated key forms bypassed the substring denylist.** `x-api-key`, `api-key`,
   `proxy-authorization` slip past a naive `key.includes('api_key')`. **Fix: normalize the key —
   `key.toLowerCase().replace(/[-_\s]/g,'')` — before matching, and keep the denylist parts
   separator-free** (`apikey`, `setcookie`, …). Now `x-api-key` → `xapikey` matches `apikey`.

3. **Secrets hide INSIDE string values, under benign keys.** A driver error message
   `connect failed: mysql://root:hunter2@db/shop`, or `Bearer eyJ…`, sits under `exception.values[].value`
   (key `value`, not denylisted) — the secret is in the string, not the key. **Fix: also redact
   secret-SHAPED substrings** in every string value (`sk-ant-…`, `Bearer …`, `mysql|postgres://…`),
   independent of the key.

Other hardening the review forced: skip prototype-polluting keys (`__proto__`/`constructor`/
`prototype`) in the recursive walk; make the WEB `beforeSend` reuse the *same* shared scrubber +
add `beforeBreadcrumb` (it was weaker than the API); `sendDefaultPii:false` + no Replay/Feedback so
input/stack-vars aren't captured.

## The residual a key-denylist genuinely can't solve

It still cannot catch a raw value (a customer's name/phone/sale amount) sitting under a *benign*
key (`extra.row`). The only real defenses are (a) drop the request body wholesale — the main row
ingress — and (b) **never call `captureException` with row data** (enforced by convention; the only
capture site is the app error handler passing a framework `Error`, and query-runner errors are
caught + sanitized to a code before they can be thrown with rows). Document this; don't pretend the
scrubber covers it.

## How to Apply

- Put the scrubber in `packages/shared` so the API, the web SDK, AND the `function_call_logs`
  write-site guard share ONE denylist — see [[org-id-only-from-requireauth-getauth]] for the same
  single-seam principle on org scoping.
- For any redactor: drop high-risk containers (headers/bodies) wholesale; normalize keys before
  matching; scan string VALUES for secret patterns; and state plainly what a key-denylist can't do.
