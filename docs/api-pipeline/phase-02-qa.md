# Phase 2 QA: Shared test scaffolding harness

This is the QA gate for Phase 2 (the shared test scaffolding harness). Phase 2 ships net-new test
infrastructure plus three frozen type contracts (RouteDef, Ctx, RateLimitStore) and a behavior-
preserving limiter clock seam, all with zero runtime behavior change. The QA pass verifies every
acceptance criterion from phase-02-test-harness.md, proves the clock seam is truly a no-op by
default, proves the normalizer masks exactly the placeholder set and nothing else, proves the
FakeDb interfaces compile against the real db.ts signatures, and confirms no DDL, no WS wire
change, and no src/sim touch slipped in. It stays under 40% context because the diff is small
(two type-only modules, one one-file clock seam, a pure loadConfig, and a handful of self-tested
helpers) and the audit agents read only the diff plus state/progress, never the full main.ts.

### QA Starter Prompt

````
This is the QA gate for Phase 2 of the API Pipeline re-architecture: Shared test scaffolding
harness. Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: audit the Phase 2 diff for correctness, coverage, and cleanup; apply BLOCKING and SHOULD-FIX
findings; leave the PR green and ready to merge as its own stacked PR.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED; if it is dirty with files you do not own, STOP and ask
  before staging. You commit only with EXPLICIT paths, never `git add -A`.
- Confirm you are on the Phase 2 branch/PR (stacked on the Phase 1 PR).
- Scan Claude Code memory for Phase 2 domain topics: "Shared-worktree commit care",
  "Workflow-agent cwd/worktree gotcha" (ABSOLUTE paths to subagents), "server API pipeline audit /
  canonical", and the "DISCORD_SCHEMA unwired" precedent (why a defined-but-unwired schema is a
  trap; relevant only as context, since Phase 2 adds no DDL).

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; do NOT read main.ts directly)
Have the Explore agent read and summarize, anchored on symbol names (never line numbers):
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (what Phase 2 recorded as done: the
  frozen contracts, the clock seam, the new helper modules).
- docs/api-pipeline/phase-02-test-harness.md (the deliverables, invariants, OUT OF SCOPE, and the
  full acceptance-criteria checklist this QA must verify one by one).
- The Phase 2 diff: `git diff` for this phase (the commits touching server/http/types.ts,
  server/http/config.ts, server/ratelimit.ts, and tests/server/helpers/*). Summarize every changed
  hunk: the contracts frozen, the Date.now sites threaded with the clock, the helper surfaces, and
  the loadConfig scope.
Explore returns: the acceptance-criteria checklist verbatim, the exact list of files touched, the
frozen RouteDef/Ctx/RateLimitStore signatures, every former Date.now call site now on the clock,
and the normalizer's placeholder set. Pass every subagent ABSOLUTE paths.

STEP 2 - QA AUDIT (fan out; each agent gets ONLY the Explore brief; prompt for COVERAGE not
filtering; if any agent is truncated tell it "resume from where you were truncated and continue,
do not restart")
- Correctness agent: verify EVERY acceptance criterion from phase-02-test-harness.md against the
  real diff, item by item. Specifically confirm:
  - server/http/types.ts is TYPE-ONLY (zero runtime emit) and RouteDef carries the requireOwned*
    marker with ownerScope 'account'|'operator', the seven-value EnvelopeKind ('problem+json',
    'oauth', 'admin', 'html', 'redirect', 'binary', 'legacy405'), and the deprecated/sunset fields;
    Ctx, Middleware/Next, and RateLimitStore are exported and self-consistent.
  - The clock seam is behavior-preserving: every former Date.now site in ratelimit.ts now uses the
    injected now() with a Date.now default, NO limiter changed its return shape (boolean stays
    boolean), and the three named existing suites (woc_balance, wallet_server, discord_server) plus
    any auth-throttle suite pass UNCHANGED. Re-run them to confirm.
  - The normalizer masks EXACTLY the named placeholder set and nothing else (verify the self-test
    proves a look-alike numeric non-dynamic field is NOT masked), with no manual-approve step.
  - The FakeDb CharactersDb/LeaderboardDb/ReportsDb interfaces COMPILE against the real db.ts
    query signatures (the `satisfies` conformance check actually references the real functions and
    would fail tsc on drift, not a hand-copied stub).
  - The parity driver's per-pass isolation truly resets limiter Maps + clock (the self-test proves
    pass-2 limiter bleed is prevented and a divergence is detected), and both dispatchers are
    injected params (no dependency on a not-yet-existing Phase 9 dispatcher).
  - The registry-introspection helpers exclude operator-scoped admin :id routes from the
    account-owner clause and fail on a missing loader.
  - loadConfig(env) is pure and frozen, fails fast on a missing required value, and is NOT wired
    into boot.
  - SERVER PARITY + THREE-HOST INVARIANTS: no WS wire/snapshot change; no src/sim/ touch (sim
    purity intact, no Math.random/Date.now/performance.now added to sim); the server still builds
    headless. Confirm the clock seam is server-only.
  - STABLE-CODE i18n: no player-visible English string or error code was added on the server path
    (Phase 2 is test infra; the EnvelopeKind freeze is a serializer seam, not a code source).
    Confirm userFacingApiError and the server catalogs are untouched.
- Test-coverage agent: confirm each helper has its OWN unit test and the negative cases exist
  (fake-http double-end/double-next rejection and writeHead header-merge; normalizer non-dynamic
  field NOT masked; parity driver divergence-detected AND isolation-prevents-bleed; registry-
  introspect non-compliant fixture fails; FakeDb conformance drift would fail tsc; loadConfig
  missing-required fails). Flag any deliverable whose test asserts only the happy path.
- Dead-code/cleanup agent: flag any unused export, any helper not consumed by a test, any
  placeholder/TODO, any literal that should be a named constant (limiter constants, normalizer
  tokens), any em dash/en dash/emoji, and any file that should have been type-only but emits
  runtime.
- Domain reviewers (run `git diff --name-only` first; dispatch ONLY matching surfaces):
  - privacy-security-review: REQUIRED (server/ touched: the limiter clock seam and loadConfig env
    parsing; confirm the clock cannot weaken a limiter window and loadConfig neither logs nor leaks
    secrets).
  - qa-checklist: REQUIRED.
  - migration-safety: NOT dispatched (no DDL/JSONB/ensureSchema change).
  - cross-platform-sync: NOT dispatched (no IWorld/src/sim/wire/sim_i18n|server_i18n/RL change).
  - architecture-reviewer: NOT dispatched (no src/sim change).

STEP 3 - FIX
Apply every BLOCKING finding and every reasonable SHOULD-FIX in separate, scoped commits (explicit
paths, Conventional Commits with a scope, e.g. `fix(ratelimit): ...`, `test(server): ...`). Defer
only genuine NICE-TO-HAVEs and record them. After fixing, re-run the validation matrix:
- `npx tsc --noEmit`
- `npx vitest run tests/server/http tests/server/helpers`
- `npx vitest run tests/woc_balance.test.ts tests/wallet_server.test.ts tests/discord_server.test.ts`
  (behavior-preservation proof) plus any auth-throttle suite
- `npm run ci:changed` (Biome on changed files only; scoped --write only)
- `npm run build:server`
- PR gate: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`

STEP 4 - UPDATE DOCS + MEMORY
- Update docs/api-pipeline/progress.md and state.md if the fixes changed any frozen contract, helper
  surface, or the normalizer placeholder set (keep state.md the authoritative record later phases
  import from).
- Record in memory any new surprising rule the fixes surfaced (for example a clock-seam edge case,
  or a FakeDb conformance subtlety), tagged to the API pipeline packet.

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Report one of PASS / PASS-WITH-FOLLOWUPS / FAIL, with counts: acceptance criteria verified vs
total, BLOCKING found/fixed, SHOULD-FIX found/fixed, NICE-TO-HAVE deferred. List the files touched
by the fixes (absolute paths) and the validation results. End with a one-line handoff to the next
implementation phase: "Phase 3 implementation: docs/api-pipeline/phase-03-surface-inventory.md
(Surface re-inventory, content-type classification + characterization/golden corpus)."
````
