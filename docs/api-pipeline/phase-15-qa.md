# Phase 15 QA: reports + telemetry + misc (server/reports.ts)

This is the QA gate for the Phase 15 migration (the four reports/telemetry routes ported onto
`server/reports.ts`). It audits the implementation diff for correctness, test coverage, and
dead code, then runs the matching domain reviewers, applies BLOCKING and SHOULD-FIX findings,
and re-validates. It is sized to stay well under 40% context because the Phase 15 diff is small
(one new domain module, four routes, one new limiter, appended error codes, no DDL, no client
change): the audit fans out across that bounded surface rather than re-reading the whole spine.
Paste the block below into a fresh Claude Code session.

### QA Starter Prompt

````
This is the QA pass for Phase 15 of the API Pipeline re-architecture: Migrate reports + telemetry + misc (server/reports.ts).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: Verify Phase 15 ships every acceptance criterion with parity-clean behavior and stable-code i18n, apply BLOCKING + SHOULD-FIX findings, and re-validate, keeping it a single green stacked PR.

STEP 0 - PRE-FLIGHT
- Run `git status` and `git log --oneline -8`. Confirm the Phase 15 commits are present and the worktree is otherwise clean (SHARED worktree, concurrent sessions). If dirty with unrelated files, STOP and ask. You will stage with EXPLICIT paths only.
- Scan Claude Code memory for "Server API pipeline audit" and "PR #811 bug-report review fixes" so you do not re-litigate locked decisions.

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; do NOT read planning docs or source directly)
Have it read and summarize, anchoring on symbol names and route strings, never line numbers:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (confirm Phase 15 is recorded: server/reports.ts, the four routes, the reports.create policy, the named constants, the appended codes, the two knownDeviations).
- docs/api-pipeline/phase-15-reports-telemetry.md (the implementation prompt: extract its STEP 5 ACCEPTANCE CRITERIA verbatim as the checklist this QA must verify).
- The Phase 15 diff: `git diff` for server/reports.ts, server/http/error_codes.ts, the POLICIES file, server/http/registry.ts, tests/server/reports.test.ts, and the Phase 3 fixture/knownDeviation additions. Have Explore list every route, code, constant, and knownDeviation the diff actually introduces.
Explore returns: the per-route contract as IMPLEMENTED (status + body for each branch), the new reports.create limiter shape + constants, which codes were appended, and where parity fixtures + the knownDeviation list were updated.

STEP 2 - QA AUDIT (fan out FOUR agents in parallel, each given only the Explore summary + the diff for its surface)
- Correctness agent: verify EVERY Phase 15 acceptance criterion holds against the real diff (do not trust the prose). Specifically confirm: /api/reports + /api/bug-reports are requireAccount({scope:'active'}) and the two telemetry routes need no auth; the new reports.create per-account limiter fires 429 with a stable code and is a named-constant knownDeviation; bug-report keeps its EXISTING handler-level BugReportRateLimitError -> 429 and 1 MB -> 413 (not re-implemented); perf-report stays 200-on-throttle (never 429) and 405 {ok:false} on GET; site-presence keeps 405 {ok:false, error:'method not allowed'}, 400-on-bad-visitor, and stays reachable with REQUIRE_WEB_LOGIN on; all four resolve in the new router (registry-completeness diff) with dual-path parity clean except the documented knownDeviations. ALSO verify server parity (the new dispatcher path vs the old ladder produces equivalent success bodies; error bodies move to problem+json with stable codes per the Phase 7 contract as documented knownDeviations) and stable-code i18n (every player-visible failure emits a CODE in error_codes.ts append-only, never English prose the client cannot localize by code; confirm NO src/ client file changed and that wiring these codes into the client catalog is correctly LEFT to Phase 22).
- Test-coverage agent: confirm tests/server/reports.test.ts (and siblings) cover each validation branch of /api/reports, the bug-report 413 + 429, the reports.create limiter firing, perf-report 405 + 200-on-throttle, site-presence 405 + 400 + happy path + the web-login-on reachability, and the parity + registry-completeness assertions. Flag any uncovered branch or any test asserting a fiction (e.g. a FakeDb route that silently mis-resolves).
- Dead-code / cleanup agent: confirm the four inline dispatch blocks were REMOVED from server/main.ts (not left dead behind the new route), no orphaned helper remains, no magic literal slipped past the named constants, imports are tidy, and no em/en dash or emoji entered code, tests, or comments.
- Domain reviewers (per the canonical dispatch rules; check `git diff --name-only` and spawn ONLY matching surfaces): privacy-security-review (server/ auth, the new limiter, cross-account report-target resolution, the 1 MB bug-report body) and qa-checklist. Do NOT spawn migration-safety (no DDL/JSONB/db.ts), cross-platform-sync (no IWorld/sim/wire/matcher), or architecture-reviewer (no src/sim).
Prompt every agent: "If your output is truncated, resume from the last completed file rather than restarting; report findings with confidence + severity and do not pre-filter."

STEP 3 - FIX
- Apply every BLOCKING and SHOULD-FIX finding (defer NICE-TO-HAVE with a note). Make each fix test-first where it is a behavior bug: a failing test that reproduces it, then the smallest change that turns it green.
- Re-run the validation matrix: `npx tsc --noEmit`; `npx vitest run tests/server/reports.test.ts` + affected suites; the Phase 9 dual-path parity harness + registry-completeness path-set diff; the Phase 7 error_codes append-only catalog test; `npm run ci:changed`; `npm run build:server`. Before declaring done also run the pre-merge mirror: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`.
- Commit fixes as separate Conventional-Commit changes with a scope and EXPLICIT paths (for example `fix(server): ...` / `test(server): ...`), keeping the suite green at each commit.

STEP 4 - UPDATE DOCS + MEMORY
- Update docs/api-pipeline/progress.md and state.md to reflect the QA result and any follow-ups carried out of this phase.
- Record in memory any surprising rule confirmed during QA (perf-report 200-not-429 by design; site-presence bypasses REQUIRE_WEB_LOGIN; the {ok:false} 405 bodies must stay handler-owned; codes localized client-side only in Phase 22).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Report one verdict: PASS / PASS-WITH-FOLLOWUPS / FAIL, with counts (acceptance criteria verified vs total; BLOCKING found / fixed; SHOULD-FIX found / fixed; deferred NICE-TO-HAVE). List files touched (absolute paths) and validation results. End with one handoff line: "Next: Phase 16 implementation (docs/api-pipeline/phase-16-discord.md)."
````
