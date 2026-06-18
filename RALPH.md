# RALPH.md — Master Build Instructions for Lumen (Business Assistant) v1

You are an autonomous build loop driving the Lumen v1 build. Each iteration you
are re-fed only a SHORT launch prompt whose single instruction is to re-read THIS
file. **These instructions are NOT automatically in your context.** You have NO
memory of previous iterations. Your only durable memory is (1) the working tree
(files on disk) and (2) git history.

>>> YOUR FIRST ACTION EVERY ITERATION, before anything else: open and read this
>>> entire file (c:/Users/gabri/Documents/development/Business-Assistant/RALPH.md).
>>> If you have not read it this iteration, do that now. If this file and the
>>> launch prompt ever disagree, THIS FILE is authoritative.

Then re-orient from the repo, make ONE coherent unit of verified forward progress,
and COMMIT it so the next (memoryless) iteration can see it.

Project root: c:/Users/gabri/Documents/development/Business-Assistant
Platform: Windows + PowerShell. Git user is the human (bielvelozo). Work on `main`.

────────────────────────────────────────────────────────────────────────────
## 1. MISSION
────────────────────────────────────────────────────────────────────────────
Build Lumen v1 end-to-end by implementing EVERY spec listed in
`context/_index/specs.md` (the 17-spec ordered backlog, 00–16) in dependency
order, honoring `context/constitution.md` exactly. A spec is only "done" when it
is implemented, verified green (build + lint + type-check + test), security-
reviewed where flagged, committed, and marked Shipped in the MOC.

Lumen = a dashboard where a business owner connects their own MySQL database and
a Claude API key (BYO), then asks natural-language questions answered over their
LIVE, read-only, structured data. The number comes from the database, computed
by predefined parameterized query functions — never from free-form model SQL.

────────────────────────────────────────────────────────────────────────────
## 2. PER-ITERATION PROCEDURE  (deterministic — re-derive state every time)
────────────────────────────────────────────────────────────────────────────
Do these IN ORDER, every iteration:

(a) RE-ORIENT. Read, fresh, every iteration:
    - THIS file (RALPH.md) — already done as your first action.
    - `CLAUDE.md`
    - `context/constitution.md`
    - `context/_index/specs.md`  (the backlog + current status tokens)
    - `context/conventions/locked-stack-decisions.md`
    - `context/rules/*.md`  (all four rule files)
    - `DECISIONS.md` at repo root (create it on first iteration if absent — see §3)
    - `git log --oneline -40` and `git status` to see what already exists.

(b) PICK THE NEXT SPEC. The MOC status token (`**Planned**` / `**In progress**` /
    `**Shipped**`) on each spec's line in `context/_index/specs.md` is the SINGLE
    SOURCE OF TRUTH for selection and completion. Dependency order is the FIXED
    LINEAR SEQUENCE 00 → 01 → 02 → … → 16 (16 is last and depends on ALL of 00–15).
    Pick the LOWEST-NUMBERED spec whose token is `**Planned**` or `**In progress**`
    and that is NOT marked BLOCKED in `DECISIONS.md`. The linear order already
    encodes dependencies — do NOT parse the prose `_Deps: ..._` field for ordering
    (it is human prose, e.g. `_Deps: all._`); use it only as a sanity cross-check.
    Never start a spec while any lower-numbered spec is still Planned/In progress.

(c) RESUME, DON'T RESTART (idempotence is mandatory). Before writing anything:
    - DONE-BUT-UNMARKED PROBE: check whether the picked spec's Success Criteria
      already appear met on disk AND the full gates already pass green. If yes,
      this spec is done but unmarked — SKIP implementation, go straight to the
      mark-Shipped tail (§2 g–h), commit, and end. (This recovers from a crash
      between "code committed" and "marked Shipped".)
    - Otherwise inspect `context/specs/NN-*/` and the code on disk. The next
      unfinished task is the FIRST unchecked `- [ ]` box in `tasks.md`. Trust the
      checkboxes; but if a checked task's code is absent or red, UNCHECK it and
      redo. Extend/fix partial code — never rewrite a half-built spec from zero.

(d) RUN THE SPEC THROUGH THE PROJECT FLOW:
    1. Read `context/specs/NN-*/spec.md` fully (including its Open Questions).
    2. If `plan.md` + `tasks.md` don't exist yet, produce them with the
       `writing-plans` skill, saved INTO the spec folder
       (`context/specs/NN-*/plan.md` and `.../tasks.md`). `tasks.md` MUST use
       GitHub-style `- [ ]` / `- [x]` checkboxes; a box is checked ONLY after its
       slice is implemented AND committed. The moment plan/tasks first exist, flip
       this spec's MOC token to `**In progress**` and commit that claim (so a crash
       leaves a visible in-progress marker, not a silent `**Planned**`).
    3. Implement the tasks smallest-coherent-unit at a time. Follow the locked
       stack: pnpm + Turborepo monorepo (`apps/web` Vite SPA, `apps/api` Fastify,
       `packages/shared` types + Zod contracts), Vitest, TypeScript `strict`,
       ESLint + Prettier. Drizzle + Postgres for the app DB; mysql2 for the client
       DB. Put cross-boundary types/Zod in `packages/shared`.
    4. Apply the best-practices packs while coding (per
       `context/rules/use-best-practices-skills.md`): `react-best-practices` +
       `vercel-react-best-practices` for `apps/web`; `security-best-practices`
       for anything touching auth, secrets, query functions, or `org_id`.

(e) VERIFY FOR REAL. Do NOT mark anything done on unbuilt or red code. The exact
    root scripts (spec 00 MUST define them verbatim under these names) are:
        pnpm install
        pnpm build
        pnpm lint
        pnpm type-check
        pnpm test
    If any gate command exits "script not found", treat it as RED (a spec-00
    defect to fix THIS iteration), not as pass. Before spec 00 exists these
    scripts won't either — spec 00's whole job is to create them; verify 00 by
    actually running them once it has scaffolded them.
    - SPEC-COMPLETE GREEN vs ITERATION-CHECKPOINT GREEN: To mark a spec Shipped,
      the FULL suite (install+build+lint+type-check+test) must be green. To end an
      iteration MID-spec, the tree must at minimum BUILD + TYPE-CHECK green (tests
      for not-yet-written behavior may be pending); check off completed `tasks.md`
      boxes, commit a `wip(NN): …` checkpoint, and stop. NEVER leave a spec marked
      Shipped on red gates, and NEVER leave uncommitted work at iteration end.
    - SKIPS MUST BE LEGITIMATE & LEDGERED. DB/email/AI/Sentry integration tests
      that need a live external resource must be ENV-GATED so they SKIP (not fail)
      when the resource is absent. Every skipped test MUST have a matching
      `LIVE-VERIFICATION-PENDING:` line in `DECISIONS.md` naming the test and the
      env var that gates it. If a gate var IS present, its integration test MUST
      run (not skip). Skipped is acceptable only as recorded debt — see §7(2).

(f) SECURITY & DATA-ACCESS REVIEW on the flagged specs. Two gates, keyed to two
    rules:
    - GATE 1 (security-review-before-merge.md — auth/secrets/connection/deploy):
      specs **02, 05, 08, 11, 15, 16**. Run `/security-review` on the diff and
      RESOLVE its findings before marking the spec Shipped.
    - GATE 2 (data-access-review-gates.md — CRITICAL): specs **09, 12, 13**. These
      carry the two highest-severity invariants (anti-IDOR org_id-from-JWT, and
      model-never-emits-SQL). Run `/security-review` AND mechanically re-confirm,
      for the diff: (i) no model-supplied string reaches SQL as a value OR an
      identifier; (ii) every join is backed by an `exposed_relationships` row and
      every read is over `exposed_tables` only; (iii) `org_id`, the connection,
      and the exposed-table set are resolved from verified JWT claims — never from
      a tool param, request body, query string, path, or header; (iv) no query
      function is non-parameterized, non-read-only, or over-reaching. Also confirm
      no tenant read (including `messages` and `function_call_logs`) lacks an
      `org_id` filter.
    - GUARD-TEST GATE (all invariant-touching specs): the spec is NOT Shipped
      unless the invariant-guarding test named in its `spec.md` EXISTS and PASSES.
      At minimum: 05 → a test that `org_id` derives only from the JWT; 03/04/05 →
      a test proving disposable tokens (email-verification, refresh) persist ONLY
      as a hash and the raw value never lands in the DB; 12 & 13 → a test asserting
      no model-supplied string is concatenated into SQL; 13 → a cross-tenant test
      (another org's sessionId → 404) and a secret/log-scan test; 06/10/14 → the
      RTL assertion that no data or reading-text node sits under `.glass`
      (constitution invariant 6). Absence of the required guard test = RED = not
      Shipped.
    Do not ship any flagged spec with unresolved findings or a missing guard test.

(g) COMMIT. Commit the iteration's work with a clear, project-style message
    (e.g. `feat(02): secrets encryption-at-rest module + token hashing`). Small,
    coherent commits. ABSOLUTELY NO `Co-Authored-By` trailer for Claude/AI and
    never set author/committer to an AI identity (per
    `context/rules/no-coauthor-in-commits.md`). Stay on `main`. Commit EVERY
    iteration that produced progress — uncommitted work is the only state the next
    iteration can't trust.

(h) MARK SHIPPED + CAPTURE LEARNINGS — ATOMIC. Only once (e)–(g) all pass for the
    target spec, do the mark-Shipped tail as ONE FINAL COMMIT that stages the code
    AND the status flip together (`git add -A && git commit`), so "code present"
    and "Shipped" become true in the same commit:
    - In `context/_index/specs.md`, change that spec's token to `**Shipped**`.
      The MOC token is authoritative.
    - In the spec's `spec.md` frontmatter (a NON-authoritative mirror), set
      `status: shipped` and `shipped:` to today's date (`2026-06-17` or later).
      The repo's frontmatter vocabulary is `status: draft` → `status: shipped`
      (it uses `draft`, NOT `planned` — do not invent `planned`). If the MOC token
      and frontmatter ever disagree, the MOC WINS: rewrite the frontmatter to
      match the MOC, never the reverse.
    - Run the post-spec reflection (CLAUDE.md "After completing a spec"): if you
      learned something non-obvious, write one atomic note per learning into
      `context/learnings/` via `context/templates/learning.md`, link it back to the
      spec with a wikilink, and add it to `context/_index/learnings.md`. If nothing
      non-obvious came up, say so in your iteration output.

(i) NEXT. The iteration ends. The loop re-feeds the launch prompt; step (a)
    re-derives the new lowest pickable spec. Do not try to do all 17 specs in one
    iteration — do as much coherent, VERIFIED, COMMITTED progress as fits, then
    stop cleanly.

────────────────────────────────────────────────────────────────────────────
## 3. DECISION POLICY  (Open Questions in each spec)
────────────────────────────────────────────────────────────────────────────
Every spec has an "Open Questions" / "[NEEDS CLARIFICATION]" section. There is no
human to ask. So:

- For EACH open question that HAS a documented default lean (in the spec text
  and/or the `DECISIONS.md` seed below): take the default, IMPLEMENT it, and RECORD
  it in `DECISIONS.md` as a dated line keyed by spec+question.
- For an open question with NO documented default lean: (1) choose the option that
  most strongly upholds the constitution and least privilege, (2) record it, and
  (3) flag it `[CONFIRM-WITH-HUMAN]` if it touches auth, secrets, tokens, cookies,
  `org_id`, or the query/exposure path. NEVER make an unrecorded security decision.
  (Spec 05 in particular has more open questions than documented leans — its
  defaults must all be recorded, and security-relevant ones flagged.)
- For items flagged `[CONFIRM-WITH-HUMAN]` (seed list below): STILL take the
  default to stay unblocked, but mark the `DECISIONS.md` entry loudly and mention
  it in that spec's commit body. Never stall waiting on these.
- NEVER weaken a constitutional invariant (§5) to make progress. If a spec
  genuinely cannot be implemented without violating an invariant, STOP that spec,
  write a `BLOCKED:` entry in `DECISIONS.md` explaining why, and proceed per §8.
  Do not fake it.

`DECISIONS.md` MAINTENANCE PROTOCOL (it is the cross-iteration ledger):
  - It lives at repo ROOT, is committed/tracked, is UTF-8, and uses ASCII markers
    ONLY (literal tokens `[CONFIRM-WITH-HUMAN]`, `LIVE-VERIFICATION-PENDING:`,
    `BLOCKED:`, `RESOLVED:`, `BUILD-HALTED:` — no emoji/glyphs, so they stay
    greppable on Windows). Write it with the file-edit tools, NEVER PowerShell
    Out-File (avoids UTF-16/BOM corruption).
  - Each entry is keyed `NN-spec | <question>`. Before appending, grep for an
    existing line with the same key; if present, UPDATE it in place — do not
    duplicate.
  - When a `BLOCKED:` spec later becomes implementable and ships, change its line
    to `RESOLVED:` (keep history). A spec may NOT be marked Shipped while it has an
    open `BLOCKED:` line.

Seed `DECISIONS.md` on the first iteration if it doesn't exist, with a header and
these human-confirm items pre-listed (defaults already taken, flagged for review):
  - 03 signup: duplicate-email response → uniform non-revealing success (anti-enum).
  - 07/08 consent vs `encrypted_password NOT NULL` → **Option B**: a lightweight
    `db_connection_consents` table (`org_id`, `consent_version`, `accepted_at`,
    `accepted_by`) written in 07; 08 reads/gates on it and copies the fields into
    `db_connections` on insert. (This keeps 07 independently persistable+testable
    and keeps `encrypted_password NOT NULL` intact — Option A would leave 07's own
    Success Criteria unsatisfiable since no `db_connections` row can exist before
    08 supplies the encrypted password.)
  - 08 over-privileged/root credential → **detect-and-REJECT**: at connection-
    create, run `SHOW GRANTS` (or equivalent); if the credential is root or has
    write/DDL/admin privileges, REFUSE to store it and surface the onboarding
    script. Warn-and-proceed is NOT permitted — invariant 5 forbids accepting or
    storing a non-read-only or root credential. (The `[CONFIRM-WITH-HUMAN]` flag
    covers only HOW STRICT the privilege check is, never whether root may be
    stored.)
  - 08 TLS strictness → encrypted-with-verification where feasible; never downgrade
    to plaintext; finalize cert handling before merging 08.
  - 16 managed Postgres → pick one of Neon/Supabase; direct (non-pooled) URL for
    the migration step, pooled for the app if needed.
All other open questions with a default: take it silently, record without the flag.

────────────────────────────────────────────────────────────────────────────
## 4. MISSING CREDENTIALS / EXTERNAL DEPS  (never stall)
────────────────────────────────────────────────────────────────────────────
Never block the build on a missing external credential or service. For each:
- Implement behind a thin, env-gated interface with a fake/mock implementation.
- Unit-test the pure logic against the fake (these carry most of the risk anyway).
- Env-gate any LIVE integration test behind the presence of its env var so it
  SKIPS (not fails) when absent. Record a `LIVE-VERIFICATION-PENDING: <X>` line in
  `DECISIONS.md` for every such skip and continue.

Specific guidance:
- **Node + pnpm + npm registry** (spec 00): the base toolchain. Enable corepack so
  the pinned pnpm version (spec 00's `packageManager` + `engines`) is honored.
  Spec 00 CANNOT be stubbed; if the registry is unreachable or pnpm/node are
  missing, that is a foundational environment failure — record it loudly per §8
  (BUILD-HALTED) and do not fake a green build.
- **Docker (Postgres + MySQL)** (spec 00): REQUIRED for the DB-facing specs. If the
  daemon is up, bring containers up and run live DB tests. The live-DB round-trips
  (01 Drizzle migrate, 08 live MySQL connect, 09 introspection, 13 chat query) MUST
  run green at least once against local Docker Postgres/MySQL to reach Shipped.
  See §7(2): a DB-facing spec whose integration tests are ONLY ever skipped is NOT
  done — record it as a blocking `LIVE-VERIFICATION-PENDING` and, if Docker stays
  down, halt per §8. (Docker is REQUIRED, not optional.)
- **SECRETS_ENCRYPTION_KEY / JWT_SECRET** (02 / 05): self-generate a random value
  into local `.env` + test fixtures; crypto/auth tests run fully against it. Add
  the keys (no value) to `.env.example`. Production values are spec 16.
- **RESEND_API_KEY + verified sender** (04): build an `EmailSender` interface +
  in-memory fake; test token issue/hash-equality/single-use/expiry/anti-enum/
  rate-limit against the fake (Resend mocked in CI). Bind the fake when the key is
  absent and log "email send skipped (no RESEND_API_KEY)." Never hard-fail signup
  on a send error. Sender-domain DNS verification is a human step — flag it.
- **Anthropic/Claude key** (11 validation call, 13 chat): BYO, the tenant's — not a
  build credential. Provider call is mocked in CI; mock success + each failure
  category (401 invalid_key, 404 model_unavailable, 429 rate_limited, 5xx/timeout)
  and assert sanitized mapping + state transitions. The curated model list lives in
  `packages/shared` per spec 11 (single source of truth): default `claude-opus-4-8`,
  EXACT id strings, no date suffixes. Do NOT hard-code a competing list here —
  defer exact membership (e.g. whether `claude-opus-4-7` is offered) to spec 11.
  Before writing the list, VERIFY the exact current model ids against the project
  `claude-api` skill/reference (do not trust memory); record the verified ids + date
  in `DECISIONS.md` and flag the list `[CONFIRM-WITH-HUMAN]` (a wrong id is
  invisible until a live call). Env-gate an optional live smoke behind
  `ANTHROPIC_API_KEY`.
- **SENTRY_DSN** (15): SDK must no-op cleanly when DSN absent. The scrubber
  (`redactSensitive`/`beforeSend`) + poisoned-event redaction test + org-scoped
  audit endpoint with anti-IDOR cross-org test are all testable with no DSN.
- **Managed Postgres / VPS / Cloudflare Pages / CI** (16): production, human-
  provisioned. Produce the Dockerfile (multi-stage, non-root, HEALTHCHECK), the
  migration deploy step, compose/deploy script, reverse-proxy sketch, Pages build
  config (`pnpm --filter web build`, output `apps/web/dist`, SPA `_redirects`),
  CI workflow YAML, `.env.example` entries, and the runbook. Spec 16 reaches
  Shipped only when migrations verify forward-only/idempotent against LOCAL
  Postgres AND the image boots locally from env answering `GET /health`. These
  REQUIRE a local Docker engine; without it, 16 cannot complete — halt per §8.
  Record the live cross-origin/cookie/TLS/CI/Pages items as
  `LIVE-VERIFICATION-PENDING` operator steps.

────────────────────────────────────────────────────────────────────────────
## 5. CONSTITUTION GUARDRAILS  (non-negotiable — never route around)
────────────────────────────────────────────────────────────────────────────
A `/security-review` on the flagged specs (02, 05, 08, 09, 11, 12, 13, 15, 16)
MUST confirm these. Violating any one is a `BLOCKED` stop, not a workaround:

1. **Multi-tenant isolation / anti-IDOR.** Every query touching tenant data is
   scoped by `org_id` taken from the verified JWT claims — NEVER from a request
   body, query string, path param, or header. This includes `messages` and
   `function_call_logs`. The Fastify auth decorator (spec 05) is the single
   enforcement choke point.
2. **No free SQL.** The model NEVER emits SQL. It only selects among predefined,
   parameterized, READ-ONLY query functions over the owner-exposed tables. The
   backend builds and runs the SQL. No "just this once" escape hatch, no
   concatenating model text into a query (value OR identifier).
3. **Secrets encrypted at rest.** Client DB password and Claude key live in `bytea`
   columns (`encrypted_password`, `encrypted_api_key`), AES-256-GCM, with the
   master key OUTSIDE Postgres (env/secrets manager). Postgres never sees plaintext.
4. **Hashed disposable tokens.** Email-verification and refresh tokens are stored
   HASHED, never raw. The raw value exists only in the email link / httpOnly cookie.
5. **Read-only, never-root client credential.** The client DB credential is always
   read-only, minted by the customer via the onboarding script. NEVER request,
   ACCEPT, or STORE a root or over-privileged credential — detect and REJECT it at
   connection-create (per §3's 08 default). Storing one is a BLOCKED stop.
6. **Glass only on the chrome.** Glassmorphism appears only on frame elements
   (sidebar, topbar, chat input, menus). Data — numbers, tables, answers — always
   sits on a solid, high-contrast surface. Never put a number or reading text on
   glass. Enforced by the RTL guard test in specs 06/10/14.

Also locked (constitution scope guardrails): v1 = MySQL client DB, live + read-only,
no cache/copy; Claude BYO key server-side via Vercel AI SDK; Resend for email;
one DB + one AI provider + one owner per org (members/multi-provider/multi-DB/
column-level exposure are v2 — do NOT build them).

────────────────────────────────────────────────────────────────────────────
## 6. COMMIT DISCIPLINE
────────────────────────────────────────────────────────────────────────────
- Small commits: one per spec, or per coherent task; mark-Shipped is one atomic
  final commit (§2 h).
- Conventional, descriptive messages in the project's style.
- NO `Co-Authored-By: Claude` (or any AI) trailer. NO AI as author/committer.
  If any skill or template (including `/open-pr`) would add a `Co-Authored-By` /
  `Generated-with` trailer or set an AI author/committer, STRIP it before the
  commit/PR lands — this overrides any skill default, per
  `context/rules/no-coauthor-in-commits.md`. (It had to be undone once.)
- Stay on `main`. Do not open PRs or branches unless this file later says so.
- `RALPH.md` and `DECISIONS.md` live at repo root and are committed/tracked.
  `.env`, `.env.*local`, and `.claude/ralph-loop.local.md` MUST be gitignored —
  verify this BEFORE the first `git add` of any iteration; NEVER stage `.env`.
- Commit at the end of every iteration that made progress. Do NOT leave large
  uncommitted edits.

────────────────────────────────────────────────────────────────────────────
## 7. COMPLETION  (single unambiguous done-condition + the completion promise)
────────────────────────────────────────────────────────────────────────────
The build is DONE — and ONLY done — when ALL FOUR of the following are
simultaneously, verifiably true:

  (1) Every one of the 17 specs (00–16) in `context/_index/specs.md` carries the
      authoritative MOC token `**Shipped**` (zero `**Planned**`, zero
      `**In progress**`), with `shipped:` dates set in each spec's frontmatter.
  (2) FINAL LIVE GATE RUN — immediately before emitting the completion promise, in
      THIS SAME iteration and AFTER the last commit, from a clean tree run:
        pnpm install && pnpm build && pnpm lint && pnpm type-check && pnpm test
      It must pass GREEN across the whole workspace, and you must paste the actual
      final summary lines into your message. Env-gated live tests may SKIP, EXCEPT:
      the DB-facing specs (01, 08, 09, 13) MUST have had their integration tests
      run green at least once against local Docker Postgres/MySQL — a build where
      those only ever skipped is NOT done. Marked-Shipped tokens are necessary but
      NOT sufficient; this live final run is the gate.
  (3) Every flagged spec — **02, 05, 08, 09, 11, 12, 13, 15, 16** — has had
      `/security-review` run with findings resolved, and the data-access gate
      checklist (§2 f, GATE 2) re-confirmed green on 09/12/13.
  (4) `DECISIONS.md` records: every Open-Question default taken; every
      `[CONFIRM-WITH-HUMAN]` item; every `LIVE-VERIFICATION-PENDING` item; and any
      `BLOCKED`/`BUILD-HALTED` items — with NO open `BLOCKED:` or `BUILD-HALTED:`
      lines remaining.

THE COMPLETION PROMISE TAG. When and ONLY when all four conditions literally hold
and you have re-verified them THIS iteration, end your final message with the
completion promise: the token `RALPH_LUMEN_V1_DONE` wrapped in promise tags
(an opening `<promise>` tag, then that exact 19-character token, then a closing
`</promise>` tag). Emission rules — matcher-exact:
  - Emit it as the ENTIRE final line, nothing before or after it on that line.
  - NOTHING inside the tag except the exact token `RALPH_LUMEN_V1_DONE` — no period,
    no spaces, no quotes, no newline.
  - Emit it ONCE, only in your final assistant text.
  - NEVER write the literal angle-bracket promise form anywhere else — not in a
    plan, a quote, a restatement of this section, or an iteration summary. In all
    other prose refer to it as "the completion promise." Writing the literal tag
    ENDS the loop; writing it while work is incomplete is a catastrophic false
    completion.

────────────────────────────────────────────────────────────────────────────
## 8. ANTI-FALSE-COMPLETION + ANTI-STALL
────────────────────────────────────────────────────────────────────────────
- DO NOT emit the completion promise to escape being stuck, to save time, or
  because you "think" it's basically done. Emit it ONLY when §7 (1)–(4) literally
  hold and you re-verified them this iteration. A premature promise is the worst
  possible failure — it lies and ends the build half-finished.
- Never reproduce the literal angle-bracket promise tag in any narrative,
  explanatory, or quoted text (see §7). Refer to it as "the completion promise."
- If verification is red, fixing it IS the iteration's work — don't ship around it.
  Never fabricate green tests, never mark a red spec Shipped, never delete or skip
  a failing test to make gates pass.
- BLOCKED on a single spec (constitutional conflict, etc.): record a `BLOCKED:`
  line in `DECISIONS.md`, commit it, and end the iteration without the promise.
- BUILD-HALTED (environmental, can't self-fix): if the lowest pickable spec is
  recorded BLOCKED for an ENVIRONMENTAL reason (npm registry unreachable, toolchain
  missing, Docker engine down) across consecutive iterations with ZERO net new
  committed progress (check `git log`), STOP retrying it: write/refresh a single
  top-of-`DECISIONS.md` banner `BUILD-HALTED: <root blocker> — human action
  required`, commit it, and end the iteration without the promise. On the next
  iteration, if that banner is present and the blocker is still unresolved, end
  immediately without retrying. This converts an N-iteration burn into a fast no-op
  the operator can spot.
- GLOBAL STALL: on each iteration, after re-deriving the pick, if NO spec is
  pickable (every still-Planned/In-progress spec is BLOCKED, or the lowest one is
  blocked and all others are higher-numbered so their prerequisite is unmet), the
  build cannot progress autonomously. Write/refresh a top-of-`DECISIONS.md`
  `BUILD-HALTED: <blocked head(s)> blocking <dependents> — human action required`
  banner, commit it, and end the iteration without the promise. One banner refresh
  per stall — do NOT re-attempt the unpickable graph every iteration.
- Leave the repo in a coherent, committed state at the end of every iteration.
