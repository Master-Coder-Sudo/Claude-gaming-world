# Phase 7 QA: RFC 9457 error model + per-surface serializers + error_codes catalog

This is the QA pass for Phase 7. It audits exactly the Phase 7 diff: `server/http/errors.ts`,
`server/http/error_codes.ts`, and the three test files (`error_codes`, `errors`, `error_leak`),
plus the packet doc updates. The scope is small (two pure primitives, no routes, no client
touch), so the audit stays well under 40% context: a correctness agent that re-checks every
acceptance criterion, a test-coverage agent, a dead-code/cleanup agent, and the one matching
domain reviewer (privacy-security-review, for the 500-no-leak contract). The QA correctness
agent must verify the server-only / three-host invariant (nothing in this diff alters the sim,
client, or WS wire) and the stable-code i18n rule (errors carry a CODE, not English).

### QA Starter Prompt

````
This is the QA pass for Phase 7 of the API Pipeline re-architecture: RFC 9457 error model +
per-surface serializers + error_codes catalog.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: confirm Phase 7 meets every acceptance criterion, leaks nothing in the 500 body, keeps the
catalog append-only, and changed nothing outside server/http/ (no routes, no client, no wire).

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED; if it is dirty with files you do not own, STOP and ask
  before staging. Stage only explicit paths, never `git add -A`.
- Confirm you are on the Phase 7 branch (stacked on Phase 6).
- Scan Claude Code memory for Phase 7 / error-model topics: the per-surface (not per-prefix)
  serializer rule, problem+json `code` as the localization key, the append-only AIP-193 catalog, and
  the DISCORD_SCHEMA "defined but not wired/sourced" precedent.

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; do not read planning docs yourself)
Have the Explore agent summarize, anchored on symbol names not line numbers:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (what Phase 7 claims it landed).
- docs/api-pipeline/phase-07-error-model.md (the acceptance criteria, invariants, and stopping rules
  it was built against; the Explore agent must return the full acceptance checklist verbatim).
- The Phase 7 diff itself: `git diff` of server/http/errors.ts, server/http/error_codes.ts,
  tests/server/http/error_codes.test.ts, tests/server/http/errors.test.ts,
  tests/server/http/error_leak.test.ts, and docs/api-pipeline/{progress,state}.md.
- For context (read-only): server/http/schema.ts (the ValidationError shape mapError consumes),
  server/http/context.ts (the Ctx + the route error-surface tag), and the Phase 2 fakeCtx + the
  onUnexpected/log sink seam under tests/server/.
The Explore agent returns: the acceptance checklist verbatim, the list of changed files with a
one-line summary each, the exact mapError signature and the surface union as implemented, the code
set in error_codes.ts, and confirmation of whether ANY file outside server/http/ + tests/server/http/
+ the two doc files was changed.

STEP 2 - QA AUDIT (spawn these agents in parallel; give each only the Explore summary + the diff)
- Correctness agent: verify EVERY acceptance criterion from phase-07-error-model.md against the real
  code (not the prose), specifically:
  (a) error_codes.ts is `as const`, deep-frozen, every key is domain.reason, every value declares its
      param keys, and the snapshot test genuinely FAILS on a removed/renamed code (append-only).
  (b) the existing userFacingApiError domain.reason vocabulary was REUSED, not re-invented in parallel.
  (c) toAppError covers the full table: 400 bad JSON, 422 ValidationError with ALL issues (not
      first-fail), 401 + WWW-Authenticate, 403, 413, 409 on pg 23505, 429 + Retry-After, 500 default.
  (d) mapError picks the serializer by the route's error-surface TAG, not by prefix; all seven shapes
      (problem+json, RFC 6749, admin {success,data,error}, htmlError, 302 redirect, binary no-wrap,
      {ok:false} 405) are frozen with exact fields + Content-Type + status.
  (e) STABLE-CODE i18n: the body carries a stable `code` (+ params); no English sentence is the
      localization source; clients localize by `code`, not by parsing `detail`.
  (f) THREE-HOST / SERVER parity: the diff is server-only; it imports nothing from src/sim and changes
      no client file, no WS wire, no sim_i18n/server_i18n matcher. Flag any such touch as BLOCKING.
  (g) the 500 path proves no stack/SQL/table/column/detail text in body or headers and hands the
      original to onUnexpected.
- Test-coverage agent: are there real assertions (not smoke) for each status branch, each of the seven
  serializers, the WWW-Authenticate and Retry-After headers, the all-issues-in-one-pass 422, the
  append-only snapshot, and the adversarial leak inputs (pg error with SQL/table/detail/column, Error
  with a stack, a thrown string, a thrown object)? Name any branch with no asserting test.
- Dead-code/cleanup agent: any unused export, unreachable serializer branch, a code in the catalog that
  no path emits and no test references, a duplicated literal that should be a named constant, a stray
  console.* that is not the intended onUnexpected default, or a TODO/placeholder. Confirm Biome is clean
  on the changed files and there are no em dashes/en dashes/emojis.
- privacy-security-review (the ONLY matching domain reviewer; server/ + the 500-no-leak + auth status
  semantics are its surface): prompt for COVERAGE of error-body hygiene, the 401/403/429 semantics, and
  that no code or param key carries PII. Do NOT dispatch migration-safety (no DDL), cross-platform-sync
  (no sim/wire/client matcher), or architecture-reviewer (no src/sim).
Add to every agent: "If your output is truncated, resume from the last file you completed and continue;
do not restart."

STEP 3 - FIX (apply BLOCKING + SHOULD-FIX; defer NICE-TO-HAVE with a note)
- Apply fixes in the affected file. Re-run the validation matrix after each fix batch:
  `npx tsc --noEmit` ; `npx vitest run tests/server/http/error_codes.test.ts
  tests/server/http/errors.test.ts tests/server/http/error_leak.test.ts` ; `npx vitest run
  tests/server/http` ; `npx vitest run tests/localization_fixes.test.ts` (S3 no-regression) ;
  `npm run build:server` ; Biome on changed files only (`npx @biomejs/biome check --write <file>` then
  `npm run ci:changed`). Before merge, run the full gate: `npm test && npx tsc --noEmit &&
  npm run build:env && npm run build:server && npm run build`.
- Commit fixes as SEPARATE Conventional Commits with explicit paths, e.g.
  `fix(http): collect all validation issues in the 422 body` (server/http/errors.ts
  tests/server/http/errors.test.ts) or `test(http): cover the redirect and binary error surfaces`.
  Never `git add -A`.

STEP 4 - UPDATE DOCS + MEMORY
- Update docs/api-pipeline/progress.md and state.md to reflect the QA outcome and any fixes (the final
  code set, the serializer map, the append-only rule, the deferrals to Phases 8/19/22).
- Record any surprising finding in memory (for example: a serializer that silently fell back to
  problem+json for an untagged route, or an append-only snapshot that did not actually fail on a
  rename).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Return one of PASS / PASS-WITH-FOLLOWUPS / FAIL, plus: counts (BLOCKING found/fixed, SHOULD-FIX
found/fixed, NICE-TO-HAVE deferred); the validation results (tsc, the three test files,
tests/server/http, S3, build:server, Biome, full gate); the privacy-security-review and qa-checklist
verdicts; the list of files touched by the QA fixes; and a one-line handoff to "Phase 8: Core
middleware set + metric/log hook seam + thin rateLimit adapter".
````
