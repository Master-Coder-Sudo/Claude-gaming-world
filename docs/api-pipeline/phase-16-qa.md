# Phase 16 QA: Discord family migration

This is the QA gate for Phase 16 (the Discord identity family migration). It audits the
implemented diff against every acceptance criterion in `phase-16-discord.md`, confirms the change
is server-only and parity-clean (the OAuth callback stays a non-JSON redirect, DISCORD_SCHEMA is
wired idempotently, the discord.* policy and codes are correct, and the isIpBlocked/turnstile gap
is closed), then applies BLOCKING and SHOULD-FIX findings.

It stays under 40% context because it reads one phase's diff plus the two short status docs and
fans correctness, coverage, cleanup, and the two matching domain reviewers over that bounded
surface; it does not re-derive the whole packet.

### QA Starter Prompt

````
This is the QA pass for Phase 16 of the API Pipeline re-architecture: Migrate Discord family (server/discord.ts).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: Verify the Phase 16 diff meets every acceptance criterion, is server-authoritative and parity-clean, keeps the callback non-JSON, wires DISCORD_SCHEMA idempotently, and localizes by stable code; then fix BLOCKING and SHOULD-FIX findings.

STEP 0 - PRE-FLIGHT
- Verify `git status`. Shared worktree with concurrent sessions: if there are changes unrelated to Phase 16, STOP and ask. Stage only Phase 16 files with EXPLICIT paths; never `git add -A`.
- Scan Claude Code memory for: "PR #1044 Discord integration review", "PR #1075 Discord choice+unlink review", "Server API pipeline audit", "i18n resolved baseline & assembly".

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; do not read planning docs directly)
Have it summarize, anchored on symbol names and route strings (never line numbers):
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (what Phase 16 claims to have shipped).
- docs/api-pipeline/phase-16-discord.md (the acceptance criteria, invariants, out-of-scope, and stopping rules to audit against).
- The Phase 16 diff: `git diff --name-only` and the full `git diff` against the phase's base commit, focused on server/discord.ts, server/discord_db.ts, the ensureSchema module (server/db.ts), the POLICIES module (server/ratelimit.ts), server/http/registry.ts, server/http/error_codes.ts, src/main.ts (userFacingApiError + client catalog), and tests/server/discord.test.ts.
Return: the list of changed files, the five Discord RouteDefs and how the callback is serialized, the ensureSchema insertion and the table-existence assertion, the discord.* policy and its derivation, the isIpBlocked/turnstile call sites, the new error codes and their client resolution, and which acceptance criteria the diff appears to satisfy vs miss.

STEP 2 - QA AUDIT (fan out parallel agents; give each ONLY the Explore summary and the diff)
- Correctness agent: verify EVERY acceptance criterion in phase-16-discord.md one by one and report each as met/unmet with evidence. Specifically confirm: (1) all five endpoints (start, callback, status, unlink, swag/claim) are RouteDefs resolved by the new router; (2) the callback is the HTML bouncePage on success and a 302 redirect-to-error on failure, NEVER problem+json (a JSON-wrapped callback is a BLOCKING regression that breaks window.opener.postMessage); (3) handleSwagClaim is reachable and its unit tests pass; (4) DISCORD_SCHEMA is in ensureSchema under the advisory lock with a real boot-time table-existence assertion and idempotent re-run; (5) the discord.* policy derives from DISCORD_MAX_PER_MINUTE (no re-typed literal) and the bucket fires ip-keyed-before-account; (6) isIpBlocked on start and callback and passesTurnstile after withBody on start; (7) unlink is account-scoped and cross-account unlink is denied (server-authority). ALSO verify server/three-host parity: the change is server-only (no src/sim/ touch, no WS wire or snapshot change, so the one-sim-three-hosts invariant holds) and the stable-code i18n holds end to end (the server emits a stable CODE with no English deciding rendering, and src/main.ts userFacingApiError resolves every Discord code; no `?? 'English'` or prose concat leaked).
- Test-coverage agent: confirm tests exist and assert the real behavior for each criterion: route parity vs the Phase 3 fixtures, the callback-not-problem+json contract, the idempotent-DDL re-run and the missing-table assertion, the discord.* limiter bucket and key ordering, the isIpBlocked denial and turnstile ordering, the cross-account unlink denial, and each Discord code resolving client-side (plus S3). Flag any criterion asserted only by inspection, not by a test.
- Dead-code/cleanup agent: check for an old inline Discord branch left dispatching on the NEW path (it should only remain on the old ladder for rollback), an unused import, a re-typed rate-limit literal, a leftover raw `{error:'rate limited'}` with no code, or any TODO/placeholder. Confirm no em dashes, en dashes, or emojis entered the diff.
- Domain reviewers (dispatch ONLY those whose surface the diff touches; run `git diff --name-only` first):
  - privacy-security-review (server/ auth, OAuth, unlink ownership, isIpBlocked, turnstile, the OAuth state secret, the new policy): always in play here.
  - migration-safety (DISCORD_SCHEMA wiring, the boot-time assertion, DDL idempotency): always in play here.
  - cross-platform-sync ONLY if the diff actually touches sim_i18n, server_i18n, the wire, IWorld, or the RL surface (it should NOT; userFacingApiError is the REST matcher, outside that trigger set). Skip otherwise.
Each agent is prompted for COVERAGE not filtering: report every correctness or requirement gap with confidence and severity. Truncation-resume line for every agent: "If your review is truncated, resume from the last file and finding you completed; do not restart from the top."

STEP 3 - FIX
Apply every BLOCKING and SHOULD-FIX finding (defer NICE-TO-HAVE with a note). After fixing, re-run the validation matrix:
- `npx tsc --noEmit`
- `npx vitest run tests/server/discord.test.ts` (plus any affected existing suite)
- `npx vitest run tests/localization_fixes.test.ts` plus the scoped Discord-code-resolve test
- the idempotent-DDL re-run and table-existence assertion tests
- the parity harness over the Phase 3 Discord fixtures
- `npm run ci:changed`, `npm run build:server`, `npm run build`
Commit fixes as separate Conventional-Commit changes with EXPLICIT paths (e.g. `fix(discord): ...`, `test(server): ...`), never folded into one blob and never `git add -A`.

STEP 4 - UPDATE DOCS + MEMORY
- Update docs/api-pipeline/progress.md and state.md to reflect the QA outcome and any deferrals (note the Phase 22 dependency for the comprehensive code-parity guard and the Phase 18/19 deferrals).
- Record in memory any QA-surfaced surprise (for example a parity diff that needed a new knownDeviation, or a subtlety in the callback serializer or the advisory-lock ordering).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Report a single verdict: PASS, PASS-WITH-FOLLOWUPS, or FAIL. Include counts (criteria met/total, BLOCKING found/fixed, SHOULD-FIX found/fixed, deferrals). List files touched (absolute paths) and the validation results. End with a one-line handoff to "Phase 17 (admin) implementation".
````
