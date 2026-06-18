---
tags:
  - moc
---
# Learnings — Map of Content

Atomic notes about Business Assistant's architecture, patterns, and gotchas. Categorized by tag.

Learnings here are specific to Business Assistant. Code style conventions live in `[[conventions|Conventions MOC]]`.

## `#concept` — Architecture and patterns

- [[../learnings/shared-package-consumed-as-ts-source|`@lumen/shared` is consumed as TS source (no build step)]] — JIT internal package: apps import its `src` directly; `tsc --noEmit` "no output files" turbo warning is expected (spec 00).
- [[../learnings/base64-32-byte-key-validation-no-buffer|Validate a 32-byte base64 key in `@lumen/shared` without `Buffer`]] — keep shared Node-global-free: check decoded length with pure string math; a 32-byte key is 44 chars + one `=` (`'A'.repeat(44)` is 33 bytes!) (spec 02).
- [[../learnings/signup-unique-violation-is-the-rollback-proof|Signup's duplicate-email path IS the rollback-atomicity proof]] — one tx (org→owner) + DB `UNIQUE(email)`: a duplicate naturally rolls back the org insert too; catch `23505`, return uniform 201; the same shape recurs in specs 08/11 (spec 03).
- [[../learnings/single-use-token-atomic-consume-no-toctou|Single-use token consume = one conditional UPDATE, not read-then-write]] — `UPDATE ... WHERE used_at IS NULL AND expires_at>now RETURNING user_id`; 0 rows = not consumed; resolve `already_verified` vs `invalid` with a follow-up read; reuse for refresh tokens (spec 04→05).
- [[../learnings/org-id-only-from-requireauth-getauth|`org_id` comes ONLY from `getAuth(request)` — the single anti-IDOR seam]] — `requireAuth` verifies the JWT (alg pinned) and attaches `{ userId, orgId }`; every data-reading spec (08–14) scopes by `getAuth(request).orgId`, never client input (spec 05).
- [[../learnings/auth-bootstrap-via-me-httponly-cookie|The SPA can't read the auth cookie — bootstrap from `GET /auth/me`]] — httpOnly cookie is invisible to JS; gate the tree on the `me` query (401→null), splash while pending; never send a tenant id (spec 06).
- [[../learnings/glass-only-rtl-guard-test|Enforcing glass-only-on-chrome with an RTL guard test]] — assert no `.glass .card/.metric/.bubble` and `getByText(number).closest('.glass')` is null; required for specs 06/10/14 (spec 06).
- [[../learnings/derived-wizard-await-dependent-query|A derived-state wizard must await a dependent query before deriving its sub-branch]] — gate the render on the dependent (enabled) query too, else a transient wrong-step renders; `isPending` is true for a *disabled* query (spec 10).
- [[../learnings/generated-sql-least-privilege-by-construction|The onboarding script is least-privilege BY CONSTRUCTION]] — only emit `CREATE USER`+`GRANT SELECT`+`FLUSH`; test allow+deny-list over comment-stripped SQL; validate embedded identifiers; spec 08 must still detect-and-reject root (spec 07).
- [[../learnings/mysql-privilege-check-allowlist-not-denylist|Verify "read-only" with an allowlist, never a denylist]] — over-privileged unless every `SHOW GRANTS` token ∈ {SELECT,USAGE,SHOW VIEW}; catches MySQL 8 dynamic/admin/PROXY; test BEFORE persisting the secret (spec 08).
- [[../learnings/exposure-allowlist-client-chooses-backend-derives|The exposure allow-list takes client CHOICES (names), not client DATA]] — client sends names only; backend re-introspects + derives columns/FKs; validated name = membership lookup, never SQL identifier; whole-set replace in one tx (cascade/idempotent). Specs 12/13 read only these rows (spec 09).
- [[../learnings/ai-key-store-only-on-success-vs-db-store-on-failure|The Claude key is stored ONLY on success — inverse of the DB password]] — `NOT NULL` secret + store-only-on-success ⇒ first-time failure persists nothing; a failed re-key never overwrites a working key; only re-validating the stored key (permanent category) downgrades active→failed; transient blips don't (spec 11).
- [[../learnings/query-functions-injection-proof-by-allowlist-membership|Query functions are injection-proof BY CONSTRUCTION — membership, not escaping]] — the model's identifier strings are resolved by allow-list MEMBERSHIP (refused before SQL is built), values are bound `?`, enums/LIMIT are backend constants; escaping is only the backstop. The guard and builder must select the same allow-list row by the identical predicate or they desync (spec 12, Gate-2).
- [[../learnings/fake-model-port-drives-real-tools-precision-invariant|Verify "the number comes from the DB" with a FAKE model driving the REAL tools]] — a `ChatModelPort` hides the AI SDK; the live e2e binds a fake port that calls the real `tool.execute` (→ real spec-12 executor → Docker MySQL) and narrates the returned rows, so the streamed figure provably comes from the DB without a Claude key. A tool call fans to two sinks: rows→model, shape→sanitized log (spec 13, Gate-2).
- [[../learnings/sse-over-post-fetch-and-stream-surviving-navigation|Streaming an SSE answer from a POST, and keeping the stream alive across navigation]] — `EventSource` can't POST; read the `fetch` body as a `ReadableStream` and buffer across reads (a frame can split mid-token). Render the SAME route element on `/chat` and `/chat/:id` so the first-send create→navigate doesn't unmount the in-flight stream (spec 14).
- [[../learnings/sentry-scrubber-key-denylist-is-not-a-content-scrubber|A key-name denylist is NOT a content scrubber]] — drop Sentry headers/body/query/cookies WHOLESALE (don't scrub by key); normalize keys before matching so `x-api-key`→`xapikey` matches `apikey`; redact secret-shaped substrings (sk-ant/Bearer/DSN) inside string values; skip proto-polluting keys. A key-denylist can't catch a raw row under a benign key — drop the body + never `captureException` rows (spec 15, Gate-1).

## `#reference` — Environment and commands

- [[../learnings/commands-catalog|Commands catalog]] — build/run commands as the stack matures (pre-implementation today).

## `#gotcha` — Things that tripped us up

- [[../learnings/pnpm-blocks-dependency-build-scripts|pnpm 10 blocks dependency build scripts]] — `Ignored build scripts: esbuild` warning is actionable; allow-list via `pnpm.onlyBuiltDependencies` or Vite/Vitest/tsx break at runtime (spec 00).
- [[../learnings/drizzle-desc-index-nulls-ordering|Drizzle `.desc()` emits `DESC NULLS LAST`]] — but Postgres bare `DESC` is `NULLS FIRST`; use `.desc().nullsFirst()` for a faithful DDL port; always diff generated SQL vs the DDL oracle (spec 01).
- [[../learnings/drizzle-config-cjs-no-import-meta|`drizzle.config.ts` runs as CJS]] — `import.meta` is empty there (drizzle-kit bundles it to CJS); use `process.cwd()` for paths, not `import.meta.dirname` (spec 01).
- [[../learnings/db-connection-consent-before-credential-tension|`db_connections` can't hold consent before a credential exists]] — consent and `encrypted_password NOT NULL` share one row, so "save consent first" needs a modeling decision (affects specs 07/08/10).
- [[../learnings/node-rs-argon2-const-enum-verbatim-module|`@node-rs/argon2`'s `Algorithm` enum is unusable under `verbatimModuleSyntax`]] — ambient `const enum` → TS2748; omit the `algorithm` option (default is argon2id) and pin it with a `$argon2id$` PHC test (spec 02).
- [[../learnings/pnpm-strict-deps-declare-zod-to-import-types|pnpm strict deps: declare `zod` to `import { ZodError }` by name]] — a transitive dep via `@lumen/shared` covers inferred types, but a *named* import needs the package in that workspace's own `dependencies` (TS2307) (spec 04).
- [[../learnings/fastify-cookie-plugin-register-before-routes|`@fastify/cookie` must be registered BEFORE the routes that use cookies]] — decorations (`reply.setCookie`, `request.cookies`) only reach routes registered after the plugin; gate it on the auth dep so the base app stays minimal (spec 05).
- [[../learnings/vitest-skipif-body-still-evaluated|`describe.skipIf(...)` still evaluates the describe body during collection]] — throwing setup (e.g. `new URL('')`) in a skipped suite's body fails the whole FILE offline; move it to `beforeAll` (specs 01/08/09/13) (spec 08).
