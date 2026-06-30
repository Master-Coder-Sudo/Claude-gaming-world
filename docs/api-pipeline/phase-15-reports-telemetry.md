# Phase 15: Migrate reports + telemetry + misc (server/reports.ts)

This is the reports-and-telemetry migration phase of the API Pipeline re-architecture. It
ports the four leftover write/telemetry endpoints (`/api/reports`, `/api/bug-reports`,
`/api/perf-report`, `/api/site-presence`) off the inline `handleApi` ladder in `server/main.ts`
and onto `RouteDef`s in a new `server/reports.ts`, consuming the spine and middleware stood up
in Phases 1 to 9 and the migration pattern set by Phases 10 to 14. It is sized low-context (four
small routes, no new spine, no DDL, no client change) so a fresh session stays well under 40% of
its window: the only genuinely new behavior is one per-account `reports.create` limiter, and the
rest is parity-preserving porting with two carefully characterized knownDeviations (perf-report
stays 200 on throttle, perf-report and site-presence keep owning their custom 405). Paste the
block below into a fresh Claude Code session.

### Starter Prompt

````
This is Phase 15 of the API Pipeline re-architecture: Migrate reports + telemetry + misc (server/reports.ts).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: NOT needed (four small routes, no batch sweep). Hand-spawn parallel agents per STEP 2.
Goal: Port /api/reports, /api/bug-reports, /api/perf-report, and /api/site-presence onto RouteDefs in a new server/reports.ts behind the new dispatcher, preserving every current contract except the one new per-account reports.create limiter, and keeping the suite green as its own stacked PR.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED across concurrent sessions. If it is dirty with files you do not recognize, STOP and ask before touching anything. You will commit with EXPLICIT paths only, never `git add -A`.
- Scan Claude Code memory for entries in this phase's domain. Suggested topics to look up: "Server API pipeline audit" (the locked SPEC), "PR #811 bug-report review fixes" (the bug-report screenshot allowlist + meta clamp + 413 cap already in place), "bestiary/perf telemetry" only if relevant, and "rate limiter / two-tier" (so you do NOT pull the deferred Phase 19 limiter rework in early). Report what you found in 2 to 4 bullets.

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or source directly; spawn ONE Explore agent)
Tell the Explore agent to read and summarize, anchoring on SYMBOL NAMES and route strings, never line numbers (server/main.ts is ~1695 lines and the SPEC anchors are stale):
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (current pipeline state, which domains are already migrated, the dispatch-flag / per-path-delegate wiring from Phase 9).
- docs/api-pipeline/phase-15-reports-telemetry.md (this file).
- server/main.ts, ONLY the four inline dispatch blocks for these routes, anchored on their route strings and handler symbols: `/api/reports` (bearerActiveAccount, cleanReportReason, getCharacter, resolveReportTarget, findCharacterReportTargetByName, createPlayerReport, returns {ok:true, reportId}); `/api/bug-reports` (bearerActiveAccount, readBody(req, 1MB) -> 413, createBugReport, BugReportRateLimitError -> 429, returns {ok:true, reportId, screenshotStored}); `/api/perf-report` (handlePerfReport); `/api/site-presence` (handleSitePresenceHeartbeat). Note that `/api/site-presence` is dispatched by URL only (any method) and BEFORE the REQUIRE_WEB_LOGIN prologue, so it bypasses web-login; the other three sit after that prologue (which gates only register/login).
- server/perf_report.ts: handlePerfReport (405 {ok:false} on non-POST; rateLimitedPerfReport returns 200 {ok:true} on throttle BY DESIGN, never 429; shouldStorePerfReport per-session insert throttle also returns 200; body caps PERF_REPORT_MAX_BODY_BYTES / PERF_REPORT_DEV_TRACE_MAX_BODY_BYTES; optional bearer -> accountId).
- server/site_presence.ts: handleSitePresenceHeartbeat (405 {ok:false, error:'method not allowed'} on non-POST; 400 {ok:false, error:'invalid visitor id'}; 200 {ok:true}; readBody cap 1024; cleanSiteVisitorId / cleanSitePresencePage).
- server/bug_report_db.ts: createBugReport, BugReportRateLimitError, BUG_REPORT_RATE_LIMIT (=5). server/report_target.ts: resolveReportTarget, ReportTargetResolvers. server/moderation_db.ts: cleanReportReason, createPlayerReport. db.ts: getCharacter and findCharacterReportTargetByName signatures only.
- server/CLAUDE.md and root CLAUDE.md (the thin-handler + SQL-only-in-*_db + i18n-stable-code rules, the module-first / never-grow-main.ts rule).
- The prior-phase spine under server/http/ that this phase CONSUMES: router.ts, compose.ts, context.ts, schema.ts, errors.ts (HttpError + mapError + the per-surface serializer selection), error_codes.ts (the as-const append-only catalog), registry.ts, index.ts barrel, config.ts, and middleware/* (withErrors, requestId, withCors, withBody(maxBytes) -> 413/400, requireAccount({scope}), and the THIN rateLimit(policy) adapter + the POLICIES table). Plus the dispatcher-in-front + per-path catch-all delegate + registry-completeness path-set diff from Phase 9, and the parity harness + reports FakeDb interface from Phase 2 + the golden fixtures + knownDeviation list from Phase 3.
- The closest migration templates to copy: server/wallet.ts (Phase 14, the account-gated write surface) and server/leaderboard.ts (Phase 10, the simplest RouteDef shape).
Explore returns: per-route exact current contract (method, auth scope, body cap, every success and error status + body shape), the precise handler symbol names, the RouteDef + middleware composition shape used by Phases 10 to 14, how reports FakeDb is declared and injected, where the POLICIES table and the knownDeviation list live and how to append, how error_codes.ts append-only is structured, and the exact test file path conventions and parity-harness entry point. NO line numbers.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Low context risk; NO a/b split. Hand-spawn THREE parallel agents, each owning a complete vertical slice (behavior + its tests) and given ONLY the Explore summary (not the raw files):
- Agent A (account-gated writes slice): add RouteDefs for POST /api/reports and POST /api/bug-reports to server/reports.ts as THIN Ctx handlers calling cleanReportReason/getCharacter/resolveReportTarget/createPlayerReport and createBugReport (domain fns take no req/res; tests use the reports FakeDb interface, never a live pool). Deliverables:
  - /api/reports: requireAccount({scope:'active'}); typed schema for {reason, reporterCharacterId, target fields, details}; preserve the validation ladder (reason missing, reporterCharacterId not finite, reporter not owned, resolveReportTarget failure, createPlayerReport throw) mapping each to its HttpError code, success 200 {ok:true, reportId}.
  - NEW reports.create per-account limiter via the thin rateLimit(policy) adapter, keyed by account, returning 429; add the policy to POLICIES; define its cap + window as NAMED constants (REPORTS_CREATE_MAX_PER_WINDOW / REPORTS_CREATE_WINDOW_MS, conservative, single source, to be folded into loadConfig in Phase 24). Label it a knownDeviation (route was previously unlimited).
  - /api/bug-reports: requireAccount({scope:'active'}); withBody(1 MB) preserving 413-on-overflow and 400-on-bad-json; keep the EXISTING handler-level BugReportRateLimitError -> 429 (do not re-implement bug-report limiting; reference BUG_REPORT_RATE_LIMIT in the policy table for visibility only); success 200 {ok:true, reportId, screenshotStored}.
  - Error codes for reports.* and bug_report.* appended to error_codes.ts (reuse existing domain.reason vocabulary). Tests in tests/server/reports.test.ts covering each validation branch, the new limiter firing, the 413, and the existing bug-report 429.
- Agent B (telemetry/beacon slice): add RouteDefs for POST /api/perf-report and POST /api/site-presence to server/reports.ts, keeping handlePerfReport and handleSitePresenceHeartbeat as the handler bodies. Deliverables:
  - Register both so the HANDLER keeps owning its custom 405 (perf-report 405 {ok:false}; site-presence 405 {ok:false, error:'method not allowed'}); do NOT let the table router synthesize a generic 405+Allow that overwrites these bodies. Record both as knownDeviations (these are the 4th-contract {ok:false} cases).
  - Preserve perf-report 200-on-throttle BY DESIGN (rateLimitedPerfReport and the per-session shouldStorePerfReport both return 200 {ok:true}, NEVER 429); the perf-report per-IP limiter stays handler-level inside perf_report.ts; reference it in POLICIES for visibility only.
  - Characterize and PRESERVE site-presence being reachable independent of REQUIRE_WEB_LOGIN (it is dispatched pre-prologue today): mark the route so the web-login guard does not start gating it under the table router; keep its 1024-byte body cap and 400-on-invalid-visitor. Neither telemetry route requires auth.
  - Error codes for perf_report.* and site_presence.* appended to error_codes.ts. Tests in tests/server/reports.test.ts (or a sibling) asserting: perf-report 405 on GET, perf-report 200 on throttle, site-presence 405 on GET, site-presence 400 on bad visitor, both 200 happy paths, site-presence reachable with REQUIRE_WEB_LOGIN on.
- Agent C (assembly slice): wire all four RouteDefs into registry.ts / the http/index barrel behind the new dispatcher's per-path delegate; extend the Phase 9 registry-completeness path-set diff so these four old-ladder paths now resolve in the new router; add the four routes' fixtures + knownDeviation entries to the Phase 3 corpus and run the dual-path parity harness over them; consolidate the error_codes.ts append-only additions from A and B into one ordered, frozen, append-only block and confirm the catalog append-only test passes. Owns the final cross-route parity run.
If, against expectation, context approaches 40%, land Agent A (writes) as commit 1 and Agents B+C (telemetry + assembly) as commit 2 in the same PR rather than splitting the PR.

INVARIANTS THIS PHASE MUST KEEP
- Single dispatch model: these four routes resolve through the new router/onion; un-migrated paths still fall through the per-path catch-all delegate to the old ladder unchanged. Do not touch the all-or-nothing-on-the-default-path semantics or CORS/OPTIONS/security-header top-level wrappers.
- Server-authority + thin handlers: handler bodies stay thin; the report/bug/perf/presence logic lives in moderation_db / bug_report_db / perf_report / site_presence / report_target and is called with no req/res. No raw SQL added in server/reports.ts.
- Stable-code i18n: every player-visible failure emits a STABLE CODE via the per-surface serializer (problem+json `code` for the JSON routes), never English prose the client cannot localize by code. error_codes.ts is the single as-const source, APPEND-ONLY (AIP-193), reusing the existing domain.reason vocabulary. Wiring these codes into the client catalog + matcher is Phase 22, NOT this phase; the codes must exist in error_codes.ts now.
- No magic values: the new reports.create cap + window are named constants, single source.
- Persistence: NO new DDL or JSONB shape change in this phase (reports/bug_reports tables already exist; the reports.create limiter is in-memory via the Phase 8 adapter, the pg-tier backstop is Phase 19).
- No em dashes, en dashes, or emojis anywhere (code, comments, tests, commits, docs). Conventional Commits with a scope; EXPLICIT paths.

OUT OF SCOPE (do not let these creep in)
- The deep two-tier limiter rework + ratelimit_db.ts + RATELIMIT_SCHEMA wiring + {remaining,resetSeconds} return shape (Phase 19): use only the THIN existing-boolean rateLimit adapter here.
- 415 Content-Type enforcement and the withRawBody hardening / beacon Content-Type audit for perf-report and site-presence (Phase 21): only PRESERVE today's body handling; do NOT add a 415 here.
- The Discord family (Phase 16), Admin (Phase 17), OAuth + Internal (Phase 18).
- The REST i18n matcher (userFacingApiError) + apiError.* client catalog (Phase 22): server emits codes only; no src/main.ts or src/ change.
- Structured logging / /metrics (Phase 23); loadConfig consolidation + server timeouts + perf gate (Phase 24).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order (anchor on the real test paths Explore reported):
- `npx tsc --noEmit`
- `npx vitest run tests/server/reports.test.ts` plus any existing affected suite (perf-report / site-presence / bug-report tests).
- The Phase 9 dual-path parity harness over the four routes and the registry-completeness path-set diff test (confirm all four old paths now resolve in the new router; zero undocumented diffs; perf-report stays 405 on GET and site-presence stays 405 on GET).
- The Phase 7 error_codes append-only catalog test.
- `npm run ci:changed` (Biome on changed files only; scoped `npx @biomejs/biome check --write <changed-file.ts>` if it flags format).
- `npm run build:server`.
Then dispatch review agents for COVERAGE (report every correctness or requirement gap with confidence + severity; do NOT filter). Per the canonical Review dispatch rules, check `git diff --name-only` and spawn ONLY:
- privacy-security-review: REQUIRED (server/ auth via requireAccount, a new limiter, cross-account report-target resolution, the bug-report 1 MB body path).
- qa-checklist: REQUIRED at phase completion.
Do NOT dispatch migration-safety (no DDL/JSONB/db.ts change), cross-platform-sync (no IWorld/sim/wire/matcher change), or architecture-reviewer (no src/sim change). Prompt each: "If your output is truncated, resume from the last completed file rather than restarting." Do not commit until each reports no BLOCKING.

STEP 4 - COMMIT CADENCE (stacked PR chain: this phase ships as ITS OWN green, bisectable PR)
2 to 4 Conventional-Commit headlines with a scope and EXPLICIT paths, for example:
- `feat(server): add server/reports.ts RouteDefs for /api/reports and /api/bug-reports` -- server/reports.ts server/http/error_codes.ts tests/server/reports.test.ts
- `feat(server): port perf-report and site-presence onto RouteDefs, preserve 405 + 200-on-throttle` -- server/reports.ts server/http/error_codes.ts tests/server/reports.test.ts
- `feat(server): add reports.create per-account limiter policy + named constants` -- server/reports.ts server/http/<policies-file>.ts
- `test(server): wire reports routes into registry, parity, and path-set diff` -- server/http/registry.ts docs/api-pipeline/...(fixtures)
Keep the suite green at every commit.

STEP 5 - ACCEPTANCE CRITERIA (verifiable checkbox list)
- [ ] server/reports.ts exists and exports `export const routes: RouteDef[]` covering POST /api/reports, POST /api/bug-reports, POST /api/perf-report, POST /api/site-presence; main.ts grew NO new inline dispatch (it shrank).
- [ ] /api/reports and /api/bug-reports go through requireAccount({scope:'active'}); /api/perf-report and /api/site-presence require no auth.
- [ ] NEW reports.create per-account limiter fires (429 with a stable code) and is a labeled knownDeviation; its cap + window are named constants in a single source; it is in the POLICIES table.
- [ ] /api/bug-reports keeps its existing handler-level BugReportRateLimitError -> 429 and its 1 MB body cap -> 413; bug-report limiting was NOT re-implemented.
- [ ] /api/perf-report returns 200 {ok:true} on throttle (never 429) and 405 {ok:false} on GET, both unchanged.
- [ ] /api/site-presence returns 405 {ok:false, error:'method not allowed'} on GET, 400 on a bad visitor id, 200 {ok:true} happy path, and stays reachable with REQUIRE_WEB_LOGIN on.
- [ ] All four old-ladder paths resolve in the new router (registry-completeness diff green); dual-path parity is clean except the documented knownDeviations (problem+json error envelope, perf/site 405 ownership, new reports.create limiter).
- [ ] New reports.* / bug_report.* / perf_report.* / site_presence.* codes are appended to error_codes.ts (append-only test green); no English-only player string is emitted without a code; no src/ client file changed.
- [ ] `npx tsc --noEmit`, the reports + parity + append-only suites, `npm run ci:changed`, and `npm run build:server` all pass; no em/en dashes or emojis introduced.

STEP 6 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md (mark Phase 15 done; list the new module server/reports.ts; the migrated routes /api/reports, /api/bug-reports, /api/perf-report, /api/site-presence; the new POLICIES entry reports.create; the new named constants REPORTS_CREATE_MAX_PER_WINDOW / REPORTS_CREATE_WINDOW_MS; the appended error codes reports.* / bug_report.* / perf_report.* / site_presence.*; the two knownDeviations: perf/site 405 ownership and perf-report 200-on-throttle).
- Update docs/api-pipeline/state.md (current migrated-domain set now includes reports/telemetry; note the codes added here are localized client-side in Phase 22, not yet wired).
- Record in Claude Code memory any surprising rule you hit (for example: perf-report deliberately returns 200 not 429 on throttle; site-presence must bypass REQUIRE_WEB_LOGIN; the 405 bodies must stay handler-owned so the table router does not overwrite them).

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status (done / blocked); files touched (absolute paths); validation results (each command pass/fail); review verdicts (privacy-security-review, qa-checklist: BLOCKING/none); any deferrals; and one handoff line: "Phase 15 QA: run docs/api-pipeline/phase-15-qa.md."

STOPPING RULES (stop and surface, do not push through)
- STOP if perf-report would start returning 429 on throttle, or if either perf-report or site-presence loses its custom {ok:false} 405 body to a synthesized router 405.
- STOP if site-presence becomes web-login-gated, or if any of the four routes' success-path body shape diverges from its Phase 3 fixture without a documented knownDeviation.
- STOP if this change would touch DDL, JSONB character state, the WS wire protocol, or src/sim (none should change here) -- those signal scope creep into Phase 16/19/20.
- STOP if a code would be emitted with English prose the client cannot localize by code, or if error_codes.ts is edited non-append-only.
````
