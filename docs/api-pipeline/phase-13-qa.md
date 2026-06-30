# Phase 13 QA: account portal migration + em-dash fix

This QA pass audits the Phase 13 diff (account-portal RouteDef migration plus the em-dash copy fix
across server/main.ts, src/main.ts, and the admin en_CA copy). It is sized under 40% context because
it reviews one bounded diff (one domain of about 14 routes, one test file, a 3-file copy sweep) and
loads only the phase state plus the diff, not the whole pipeline. The audit verifies every acceptance
criterion from phase-13-account.md, old-path-vs-new-path parity, and that the stable-code i18n model
is preserved (no new codes, matcher still resolves, em-dash gone).

Paste the block below into a fresh Claude Code session. It is self-contained.

### QA Starter Prompt

````text
This is the QA gate for Phase 13 of the API Pipeline re-architecture: account portal migration
(server/account.ts) + em-dash fix. Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: confirm the phase is correct, complete, parity-clean, and copy-clean, then apply BLOCKING and
SHOULD-FIX findings.

STEP 0 - PRE-FLIGHT
- Run `git status` and `git log --oneline -8`. The worktree is SHARED; if it is dirty with files you
  do not own, STOP and ask. Commit fixes with EXPLICIT paths only, never `git add -A`.
- Scan Claude Code memory for: the locked API pipeline spec, the i18n reword-staleness + copy-scan
  notes, the prior server/account.ts extraction, and the admin i18n regen flow.

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; anchor on symbol names, not line numbers)
Have it summarize:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (what Phase 13 claims it landed).
- docs/api-pipeline/phase-13-account.md (the acceptance criteria, knownDeviations, and stopping rules
  to check against).
- The Phase 13 diff: `git diff` for server/account.ts, server/main.ts, server/http/registry.ts,
  src/main.ts, src/admin/i18n.locales/en_CA.ts, src/admin/i18n.resolved.generated/en_CA.ts, and
  tests/server/account.test.ts (use `git diff main...HEAD -- <paths>` or the phase's commit range).
The Explore agent returns: the exact set of ported routes and their middleware composition, the
bearer resolver/scope per route, the companion-token RouteDef trio + its 405 deviation, the
unsubscribe serializer choice, the three em-dash edit sites and whether the admin resolved copy was
regenerated vs hand-edited, and the test coverage present vs missing.

STEP 2 - QA AUDIT (fan out parallel agents, each given only the Explore summary)
- Correctness agent: verify EVERY acceptance criterion in phase-13-account.md is actually met in the
  diff, line by line. Specifically confirm: (a) old-path-vs-new-path PARITY for every account route
  via the Phase 9 harness (status, body, contracted headers) with no undocumented diff; (b) each
  route preserves the exact bearer resolver/scope it used in the old ladder (no scope widened or
  narrowed); (c) the stable-code i18n model is intact: NO new error code was introduced for an
  account string, the existing English-source -> userFacingApiError mapping is unchanged, and the
  em-dash swap kept every matcher prefix so each fixed string still resolves to its t() key in every
  locale; (d) /api/email/unsubscribe is served at the content-type of its real fixture (JSON {ok:true}
  today) and the HTML planning label was reconciled, not blindly applied; (e) the companion-token
  method-fan 405 deviation is the ONLY new deviation and it is documented and asserted; (f) no WS wire
  or snapshot change, no src/sim touch.
- Test-coverage agent: confirm tests/server/account.test.ts covers each route's success path, the
  401 on missing/invalid bearer, the companion-token CRUD trio + the 405 deviation, the unsubscribe
  serializer, the registry-completeness diff (no account path missing from the new router), and the
  em-dash regression assertions (no U+2014 in touched strings; matcher still resolves). Flag any route
  with zero parity assertion.
- Dead-code/cleanup agent: check for orphaned old-ladder branches left unreachable after migration,
  duplicated handler logic copied into main.ts instead of staying in server/account.ts, an
  accidentally hand-edited generated admin file, leftover debug/console, and any unused import.
- Domain reviewers whose surface the diff touches (check `git diff --name-only`): dispatch
  privacy-security-review (server auth-adjacent: account portal, password re-verify, 2fa, deactivate,
  bearer scope, companion-token minting) and qa-checklist. Do NOT dispatch cross-platform-sync unless
  the matcher LOGIC changed (a copy-only em-dash swap does not trigger it), and do NOT dispatch
  migration-safety or architecture-reviewer (no DDL/JSONB, no src/sim).
Prompt every agent for COVERAGE, not filtering (report each gap with confidence and severity). If any
reply is truncated, tell that agent: "resume from the last complete finding and continue."

STEP 3 - FIX (apply BLOCKING + SHOULD-FIX; defer NICE-TO-HAVE with a note)
After fixing, re-run the validation matrix:
```bash
npx tsc --noEmit
npx vitest run tests/server/account.test.ts
npx vitest run tests/localization_fixes.test.ts
npm run i18n:admin && npm run check:admin
npm run ci:changed
npm run build:server
grep -rnP "\x{2014}" server/main.ts src/main.ts src/admin/i18n.locales/en_CA.ts src/admin/i18n.resolved.generated/en_CA.ts
```
(The grep must print nothing.) Plus the Phase 9 parity + registry-completeness tests over the account
paths, and the pre-merge gate `npm test && npx tsc --noEmit && npm run build:env && npm run
build:server && npm run build`. Commit each fix separately with a scoped Conventional Commit and
explicit paths (for example `fix(http): correct account route scope`, `test(server): add account
parity case`). Do not commit while any BLOCKING finding stands.

STEP 4 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md and state.md to reflect the QA outcome and any fixes (note the
  final knownDeviation list: companion-token 405, the unsubscribe classification).
- Record in memory any surprising rule confirmed during QA (the unsubscribe JSON-not-HTML reality, the
  em-dash matcher-prefix safety, the admin resolved copy being generated).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Report: PASS / PASS-WITH-FOLLOWUPS / FAIL; counts of BLOCKING fixed, SHOULD-FIX fixed, and deferred
follow-ups; the validation matrix results; the review verdicts; and a one-line handoff: "Proceed to
Phase 14 (phase-14-wallet.md)."
````
