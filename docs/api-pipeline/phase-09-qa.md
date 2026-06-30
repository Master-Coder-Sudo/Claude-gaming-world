# Phase 9 QA: Registry + dispatcher-in-front + dual-path parity harness + top-level CORS wrapper

This is the QA gate for Phase 9. It audits the integration seam (the registry, the dispatcher-in-
front with its per-path catch-all delegate, the single top-level CORS wrapper, the dual-path parity
harness, and the registry-completeness gate) for correctness, test coverage, and dead code, then
applies BLOCKING and SHOULD-FIX findings and re-runs the validation matrix. Because Phase 9 changes
no behavior (zero routes migrated, everything delegates), the QA correctness bar is sharp: the
proof of identity (parity, completeness, CORS-equivalence, exactly-one-response, preserved void
semantics) must be real and not asserted on fictions.

It stays under 40% context because the diff is small and server-local (two spine modules, a thin
main.ts swap, two test files), so the audit reads the diff plus state, not the whole server.

### QA Starter Prompt

````
This is the QA pass for Phase 9 of the API Pipeline re-architecture: Registry + dispatcher-in-front
+ dual-path parity harness + top-level CORS wrapper.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.

STEP 0 - PRE-FLIGHT
- Run `git status`. Shared worktree: if it is dirty with files you do not own, STOP and ask before
  staging. Commit fixes with EXPLICIT paths only, never `git add -A`.
- Scan Claude Code memory for this phase's domain. Suggested look-ups: "Server API pipeline audit
  (2026-06-29)" (the locked SPEC), "Shared-worktree commit care", and "PR #1044 Discord integration
  review" (the defined-but-unwired-seam precedent the completeness gate is meant to catch).

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; pass ABSOLUTE paths)
Have it read and summarize:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (post-Phase-9 state).
- docs/api-pipeline/phase-09-registry-parity.md (the implementation spec, especially STEP 5
  Acceptance Criteria and the Stopping Rules).
- The Phase 9 diff: `git diff` for server/http/registry.ts, server/http/dispatch.ts,
  server/http/index.ts, server/main.ts (the /api swap + the lifted CORS/OPTIONS wrapper),
  tests/server/http/parity.test.ts, tests/server/http/completeness.test.ts, and any parity-driver
  helper extension under tests/server/. Use `git diff --name-only` first to confirm the touched set.
Have the Explore agent RETURN: the dispatcher's external signature and how main.ts invokes it
(awaited vs void), how the flag gate selects new-vs-legacy, where and how CORS/OPTIONS were lifted
and which prefixes they cover, the registry resolve contract, the parity harness's diff scope
(status/body/which headers) and its knownDeviation handling, and the completeness gate's coverage
math (router UNION delegate vs old-ladder set). Anchor on symbol names, not line numbers.

STEP 2 - QA AUDIT (fan out parallel agents, each given the Explore summary + ABSOLUTE paths)
Spawn these in parallel. Every agent ends with: "If your output is truncated, resume from the last
file you completed and continue; do not restart."
- Correctness agent. Verify EVERY acceptance criterion in phase-09-registry-parity.md STEP 5 against
  the real code, not the description. Specifically confirm:
  - The single dispatch flag + per-path catch-all delegate model is implemented: flag-on routes
    registered paths through the onion and delegates every other /api path to the legacy handleApi
    UNCHANGED; flag-off bypasses the dispatcher entirely (clean rollback).
  - The createServer prefix ORDER and the non-awaited void semantics of the /api call site are
    preserved exactly, and the Phase 5 outermost wrapper owns exactly ONE idempotent response on
    both resolve and throw (no double-response, no double-await).
  - CORS + OPTIONS-204 preflight is one top-level wrapper over BOTH paths from a single source of
    truth, with today's CORS application surface unchanged and identical CORS/preflight old-vs-new.
  - Server-only / three-host parity holds: no src/sim/ touch, no /ws upgrade or wire/snapshot change,
    behavior byte-identical to today because zero routes are migrated.
  - Stable-code i18n: no new English player-facing string is emitted on the dispatcher or delegate
    path; any error body still flows through the Phase 7 mapError -> codes seam.
  - The named parity assertions are genuinely exercised: /api/perf-report stays 405,
    /api/characters stays 401 on a wrong-method unauthenticated request, zero silent diffs.
- Test-coverage agent. Confirm the parity harness runs EVERY Phase 3 fixture old-vs-new (not a
  subset), diffs status + normalized body + the contracted headers, weights error and 404-vs-405
  paths heaviest, and BLOCKS on any diff absent from the knownDeviation list. Confirm the
  completeness gate's coverage math is sound (router UNION delegate must equal the old-ladder path
  set) and that it would actually HARD-FAIL on a dropped route (add or describe a negative case
  proving the gate bites). Confirm the dispatcher unit tests cover the delegate path, the onion
  path, flag-off bypass, and the exactly-one-response throw path. Flag any criterion asserted by a
  test that cannot fail.
- Dead-code / cleanup agent. Check for an unused export in registry.ts / dispatch.ts / the index.ts
  barrel, a leftover stub or scaffold, a scattered process.env read that should go through
  loadConfig, a bare literal that should be a named constant (flag name, header names), a re-forked
  CORS decision instead of reusing the single source, or any drift from the surrounding file style.
- Domain review agents (ONLY the surfaces this diff touches; check `git diff --name-only`):
  - privacy-security-review: server/ is touched and the dispatcher fronts auth + CORS + the delegate.
    Verify the delegate cannot drop an auth or moderation check, no un-authed path leaks through, CORS
    is not weakened, and a flag-off rollback restores the legacy path with no gap.
  - qa-checklist: the standard end-of-phase invariant sweep.
  Do NOT spawn migration-safety (no DDL/JSONB), cross-platform-sync (no IWorld/sim/wire/matcher
  change), or architecture-reviewer (no src/sim/ change).

STEP 3 - FIX
Apply every BLOCKING and SHOULD-FIX finding (defer NICE-TO-HAVE with a note). After fixes, re-run
the validation matrix:
- `npx tsc --noEmit`
- `npx vitest run tests/server/http/registry.test.ts tests/server/http/dispatch.test.ts tests/server/http/parity.test.ts tests/server/http/completeness.test.ts`
- `npx vitest run tests/server/`
- `npm run build:server`
- `npm run ci:changed`
- Full pre-merge gate: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`
Land fixes as SEPARATE Conventional commits with a scope and EXPLICIT paths (for example
`fix(http): ...`, `test(server): ...`), stacked on the Phase 9 PR.

STEP 4 - UPDATE DOCS + MEMORY
- Reflect any fix in docs/api-pipeline/progress.md and docs/api-pipeline/state.md (keep the named
  surface accurate: registry.ts, dispatch.ts, the index.ts barrel, the dispatch flag env name +
  loadConfig field, the parity and completeness test files).
- Record in memory any surprising rule the audit surfaced (for example a non-awaited void semantic
  that had to be preserved, a CORS coverage subtlety, or a completeness-gate edge in the
  router-UNION-delegate math).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Report a single verdict: PASS / PASS-WITH-FOLLOWUPS / FAIL. Include counts (BLOCKING found/fixed,
SHOULD-FIX found/fixed, deferred), the validation-matrix results, the review verdicts, and a
one-line handoff to "Phase 10 (Migrate public reads, server/leaderboard.ts) implementation".
````
