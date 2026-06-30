# Phase 19 QA: Two-tier rate limiter + ratelimit_db

This QA pass audits the Phase 19 limiter rework: the boolean-to-`{remaining, resetSeconds}` return
change across every limiter and call site, the new pg-backed tier-2 backstop in
`server/ratelimit_db.ts`, the `RATELIMIT_SCHEMA` wiring into `ensureSchema` under the boot advisory
lock (the DISCORD_SCHEMA trap), and the draft-11 `RateLimit` / `RateLimit-Policy` header emission in
`respond429`. It stays under ~40% of a context window because it reviews one phase's diff (a bounded
set of limiter files plus one new pg module and the ensureSchema call site), not the whole pipeline.
The correctness agent verifies every acceptance criterion from phase-19-rate-limiter.md, the
server-only parity (no WS-wire / no src/sim change), and the stable-code i18n boundary.

````
### QA Starter Prompt

This is the QA pass for Phase 19 of the API Pipeline re-architecture: Two-tier rate limiter +
ratelimit_db. Model: Opus 4.8, xhigh effort. Harness: Claude Code. Hand-spawn the audit agents
below; do not use a Workflow.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED: if it is dirty with files outside Phase 19's surface,
  STOP and ask before touching anything. Stage only Phase 19 files with EXPLICIT paths, never
  `git add -A`.
- Confirm the Phase 19 branch is stacked on Phase 18 and that the implementation already reported
  done (this QA either passes it or sends it back).
- Scan Claude Code memory for this domain: "PR #1044 Discord integration review" (the
  DISCORD_SCHEMA-unwired-into-ensureSchema blocker this phase must not repeat), "Server API pipeline
  audit" (the locked two-tier limiter decision), and "migration-safety" / "additive idempotent DDL"
  notes.

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; summarize, do not dump). Anchor on symbol names and
route strings, never line numbers (main.ts is ~1695 lines):
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (so QA knows what Phase 19 claims to
  have added).
- docs/api-pipeline/phase-19-rate-limiter.md (the acceptance criteria, invariants, out-of-scope, and
  stopping rules to audit against).
- The Phase 19 diff: run `git diff --name-only` against the Phase 18 base and have the Explore agent
  summarize each changed hunk (server/ratelimit.ts return-shape change and call sites,
  server/ratelimit_db.ts, the server/db.ts ensureSchema wiring, the http rate-limit adapter,
  respond429 in errors.ts, the POLICIES module, and the new/changed tests).
Explore agent returns: the per-file diff summary, the final `rateLimited` / `recordSlidingWindowAttempt`
signatures and all call sites, the RATELIMIT_SCHEMA definition and where it is added to the
ensureSchema list, the respond429 header set, the POLICIES rows and their backing constants, and the
list of new/changed test files.

STEP 2 - QA AUDIT (hand-spawn these agents in parallel; give each ONLY the Explore summary and the
phase-19 doc; each reports COVERAGE, every gap with confidence and severity, not a filtered verdict).
Add to EVERY dispatch: "If your review is truncated, resume from the last file you fully covered and
continue; do not restart."
- Correctness agent: verify EVERY acceptance criterion in phase-19-rate-limiter.md item by item, and
  specifically:
  - `{remaining, resetSeconds}` is the return everywhere and no boolean caller survives; the values
    are correct across the window boundary using the injected clock.
  - authThrottled stays handler-level (per-username, failed-only, clears on success, 15m/10-fail) and
    rateLimitedPerfReport still returns 200 by design; their semantics did not drift.
  - server/ratelimit_db.ts is a global-keyed single-statement atomic UPSERT; RATELIMIT_SCHEMA is in
    the ensureSchema list under `pg_advisory_xact_lock` with a boot-time table-existence assertion;
    re-running ensureSchema is safe (idempotent).
  - tier-1 IP gate runs BEFORE tier-2, so under flood pg is never written (the pg-write counter stays
    0).
  - respond429 emits Retry-After + draft-11 RateLimit/RateLimit-Policy (q/w/r/t) with a pinned
    draft-version comment and no legacy trio.
  - POLICIES values DERIVE from existing named constants (no re-typed literal, no re-tuned
    limit/window); discord.* / character.* / reports.* policies are present.
  - SERVER PARITY: no WS-wire or WS-snapshot change, and src/sim is untouched (sim-purity guard
    green). STABLE-CODE i18n: respond429 emits a CODE from error_codes.ts, never English prose; any
    new code is APPEND-ONLY and the client-side resolution is correctly deferred to Phase 22 (no
    src/main.ts or client-catalog edit in this diff).
- Test-coverage agent: are the new tests sufficient and deterministic? Confirm the injected clock (not
  Date.now) drives every window/Retry-After/RateLimit assertion; the idempotent-DDL re-run and
  boot-assertion tests exist and fail if RATELIMIT_SCHEMA is removed from the list; a flood test
  proves tier-1-before-tier-2 (pg-write counter stays 0); the FakeRateLimitStore exercises tier-2;
  and each policy's algorithm and the header field values are asserted. Name any uncovered branch.
- Dead-code / cleanup agent: find leftover boolean-era helpers, dead POLICIES entries, an unused
  legacy-header path, duplicated window math that should be one function, re-typed literals that
  should reference the named constant, or stray debug logging. Flag, do not auto-delete.
- Domain reviewers (spawn ONLY these; this diff is server-only, no IWorld/src/sim/wire/matcher
  change): `privacy-security-review` (rate-limit control, new SQL, UPSERT injection safety, key
  derivation, no SQL/secret leak in 429 bodies, no pg amplification under flood) and `migration-safety`
  (additive idempotent DDL, RATELIMIT_SCHEMA in the ensureSchema list under the advisory lock, boot
  assertion, re-run safety). Do NOT spawn cross-platform-sync or architecture-reviewer.

STEP 3 - FIX
- Apply every BLOCKING and SHOULD-FIX finding from the agents (NICE-TO-HAVE goes to deferrals). Make
  the smallest change that turns each red item green; for any bug, add a failing test first, then the
  fix.
- Re-run the validation matrix after fixes: `npx tsc --noEmit`; `npx vitest run
  tests/server/ratelimit.test.ts tests/server/ratelimit_db.test.ts` and the http middleware test;
  the idempotent-DDL re-run + boot-assertion tests; `npm run ci:changed`; `npm run build:server`;
  and `npx vitest run tests/localization_fixes.test.ts` if error_codes.ts changed. Before declaring
  PASS, run the full pre-merge gate once: `npm test && npx tsc --noEmit && npm run build:env &&
  npm run build:server && npm run build`.
- Commit fixes as SEPARATE Conventional Commits with a scope and EXPLICIT paths (for example
  `fix(server): assert RATELIMIT_SCHEMA table exists at boot`,
  `test(server): cover tier-1-before-tier-2 under flood`). Never `git add -A`.

STEP 4 - DOC UPDATES + MEMORY
- Reconcile docs/api-pipeline/progress.md and state.md with what actually shipped (correct the module
  / table / policy / constant names if the implementation diverged).
- Record any surprising rule the audit surfaced in memory (for example a subtlety in the atomic UPSERT
  ordering, the draft-11 header field encoding, or a fix to the boot-assertion timing relative to the
  advisory lock).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Report a single verdict: PASS, PASS-WITH-FOLLOWUPS, or FAIL. Include counts (BLOCKING fixed /
SHOULD-FIX fixed / deferred follow-ups, each with the owning phase), the validation results (tsc,
vitest suites, build:server, ci:changed, S3 if run, the full pre-merge gate), and the
privacy-security-review + migration-safety + qa-checklist verdicts. End with a one-line handoff to
"Phase 20: World Market realm-scope fix + partitioned backfill".
````
