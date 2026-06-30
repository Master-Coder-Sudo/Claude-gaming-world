# Phase 10 QA: Migrate public reads (server/leaderboard.ts)

This is the QA gate for Phase 10. It audits the public-read migration diff for correctness, test
coverage, dead code, and the one matching domain reviewer (privacy-security-review, since the diff
touches the `/api/realms` + `/api/search` authz-gap-close and the `/api/status` name-list trim), then
applies BLOCKING and SHOULD-FIX findings, re-validates, and hands off to Phase 11. It is sized to stay
under 40% context because the diff is one read-only domain (no DDL, no wire change), so the audit fans
out over a small, bounded surface and the correctness agent re-checks a finite acceptance list rather
than re-deriving the spine.

### QA Starter Prompt

````
This is the QA pass for Phase 10 of the API Pipeline re-architecture: Migrate public reads
(server/leaderboard.ts).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: verify every Phase 10 acceptance criterion holds, fix BLOCKING and SHOULD-FIX findings, keep the
suite green, and hand off to Phase 11.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED: if it is dirty with files you do not own, STOP and ask.
  Commit with EXPLICIT paths only, never `git add -A`.
- Scan Claude Code memory for "leaderboard / guild leaderboard / topGuilds", "API pipeline phase 9
  parity harness", and "userFacingApiError / REST i18n". Note anything relevant before auditing.

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; symbol-anchored summaries, no verbatim dumps)
Have Explore summarize and return:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (what Phase 10 claims it shipped: the new
  module, migrated routes, named constants, any appended error codes, the convention B decision, the two
  labeled knownDeviations).
- docs/api-pipeline/phase-10-public-reads.md (the acceptance criteria + stopping rules this QA enforces).
- The Phase 10 diff: `git diff --name-only` and the full `git diff` for server/leaderboard.ts,
  server/http/registry.ts, any server/http/middleware/* change (the anonymous-friendly bearer resolver),
  server/http/error_codes.ts (if appended), tests/server/leaderboard.test.ts, and the updated Phase 3
  fixtures. Return the diff scope so the audit agents do not re-read unrelated spine files.

STEP 2 - QA AUDIT (parallel agents; give each ONLY the Explore summary + the diff; COVERAGE not filtering)
- Correctness agent: verify EVERY acceptance criterion in phase-10-public-reads.md against the real code:
  all listed routes registered as RouteDefs and served by the new dispatcher; the old handleApi branches
  LEFT intact as the flag-off rollback path; domain functions take a Db interface (no req/res) and are
  FakeDb-tested; page/pageSize/scope decoders typed with named-constant bounds so no NaN/out-of-range
  reaches a DB call; the public-sheet :id typed; /api/status trimmed to {ok,realm,players_online} as a
  labeled knownDeviation; /api/realms + /api/search serve anonymously with no token and reject an invalid
  token, no-token behavior unchanged; /api/perf gated by ALLOW_DEV_COMMANDS; convention B decision recorded
  with the guild board + legacy ?limit exempt. It MUST also verify (a) DUAL-PATH parity: the new dispatcher
  and the old handleApi ladder return identical status/body/contracted-headers per route except the two
  documented knownDeviations, and (b) STABLE-CODE i18n: every error code these routes emit exists in
  error_codes.ts (any new one appended frozen + given an English apiError.* entry), and src/main.ts's
  userFacingApiError was NOT touched (that is Phase 22). Confirm the change is SERVER-ONLY (no src/sim, no
  client/render/ui, no RL surface) and the WS wire is unchanged.
- Test-coverage agent: confirm parity tests exist for every migrated route (standard boards, ?board=guilds,
  legacy ?limit=N, ?scope, arena, releases, project-stats, search, realms, public sheet, perf, status);
  page/pageSize coercion + bounds tested; the authz-gap-close tested for no-token-serves AND invalid-token-
  rejects; the status trim asserted; the /api/perf dev-gate tested; FakeDb unit tests exercise the domain
  functions. Flag any route registered without a parity test.
- Dead-code / cleanup agent: flag duplicated handler logic that should have been extracted into a Db-taking
  domain function, leftover inline scaffolding, unused imports/exports, magic numbers that should be named
  constants, and any premature abstraction.
- privacy-security-review: REQUIRED (the authz-gap-close + the name-list trim). Verify the /api/status trim
  actually removes the player name-list leak, the bearer resolver rejects invalid tokens without leaking,
  and the anonymous path cannot be used to bypass an intended gate.
- migration-safety: SKIP (no DDL/JSONB change). cross-platform-sync: SKIP. architecture-reviewer: SKIP.
Give every agent: "If your review is truncated, note exactly where you stopped and resume from that point
in a follow-up pass; do not silently drop coverage."

STEP 3 - FIX
Apply every BLOCKING and SHOULD-FIX finding. Re-run the validation matrix after fixing:
- `npx tsc --noEmit`
- `npx vitest run tests/server/leaderboard.test.ts` + the Phase 9 dual-path parity harness over these
  routes + the registry-completeness test
- if error_codes.ts changed: `npx vitest run tests/localization_fixes.test.ts` (S3) + the code-parity
  assertion if present
- `npm run ci:changed` and `npm run build:server`
- full pre-merge gate: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server &&
  npm run build`
Commit fixes SEPARATELY with EXPLICIT paths and a scoped Conventional-Commit headline
(e.g. `fix(leaderboard): ...`, `test(server): ...`). Defer NICE-TO-HAVE findings to a tracked follow-up.

STEP 4 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md and state.md to reflect the QA outcome and any fixes (new
  constants/codes/knownDeviations introduced during the fix pass).
- Record surprising rules in Claude Code memory (e.g. a parity diff the harness missed, the
  anonymous-friendly resolver subtlety, the topGuilds heavy read).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
- Verdict: PASS / PASS-WITH-FOLLOWUPS / FAIL.
- Counts: BLOCKING found/fixed, SHOULD-FIX found/fixed, deferred follow-ups.
- Validation results (each command + pass/fail) and reviewer verdicts.
- One-line handoff: "Ready for Phase 11: Migrate auth (register/login/native-attestation)."
````
