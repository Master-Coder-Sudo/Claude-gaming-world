# Phase 12 QA: character ownership + BOLA seam

This QA phase audits the Phase 12 diff (the `server/characters.ts` migration, the
`requireOwned`/`requireOwnedCharacter` loader, the `bola_denied` deny-log, the deny-by-default
ownership coverage test, and the four new `character.*` limiter policies). It is sized to stay
under 40% context because it reviews exactly one domain module plus one shared middleware and
their tests against a fixed, short acceptance list, and it spawns only the reviewers whose surface
the diff actually touches (security + the QA gate), not the whole bench.

The QA Starter Prompt below is self-contained. A fresh Claude Code session can paste and run it
without reading this table of contents.

### QA Starter Prompt

````text
This is the QA pass for Phase 12 of the API Pipeline re-architecture: character ownership + BOLA
seam (server/characters.ts).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: verify every Phase 12 acceptance criterion, the BOLA denial model, the three-host/server
parity, and the stable-code i18n; apply BLOCKING and SHOULD-FIX findings; leave the phase green.

STEP 0 - PRE-FLIGHT
- Run `git status`. SHARED worktree: if dirty outside this phase's scope (server/characters.ts,
  server/http/middleware/require_owned.ts, server/http/error_codes.ts, the POLICIES module,
  tests/server/characters.test.ts, tests/server/http/require_owned.test.ts, docs/api-pipeline/),
  STOP and ask.
- Confirm the Phase 12 implementation PR is the current branch's diff and the suite was reported
  green by the implementer. Scan Claude Code memory for "BOLA 404-vs-403", "requireOwned
  account-scoped loader", "character account_id realm scoping", "thin rateLimit knownDeviations".

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; do not read planning docs yourself)
Ask it to summarize:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (the Phase 12 entries: migrated
  routes, the new loader, the bola_denied log, the four character.* POLICIES, any appended code,
  and the recorded Phase 17 operator-exclusion dependency).
- docs/api-pipeline/phase-12-characters-bola.md (the acceptance criteria and stopping rules to
  audit against).
- The Phase 12 git diff: `git diff` of server/characters.ts, server/http/middleware/
  require_owned.ts, server/http/error_codes.ts (if touched), the POLICIES module, registry.ts,
  tests/server/characters.test.ts, tests/server/http/require_owned.test.ts. Return it
  symbol-anchored (route names, loader signature, code strings), never line numbers.
The Explore agent returns: the as-shipped per-route middleware chains, the loader query and denial
status, the deny-log fields, the four limiter policies and their named constants, the appended
codes, and the coverage-test exclusion mechanism.

STEP 2 - QA AUDIT (spawn these agents in parallel, each given ONLY the Explore summary; add to
every prompt: "If your output is truncated, resume from the last completed file and continue; do
not restart.")
- Correctness agent: verify EVERY acceptance criterion from phase-12-characters-bola.md one by
  one, and explicitly:
  (a) requireOwnedCharacter uses an ACCOUNT-SCOPED query (id + account_id + realm), runs AFTER
      requireAccount (scope-before-find), and never falls back to the id+realm-only find.
  (b) Cross-account AND absent both resolve to 404 (player-owned anti-enumeration, the locked
      status), identically, with NO body or deny-log signal distinguishing "exists for another
      account" from "does not exist".
  (c) The deny-by-default registry coverage test truly covers every account-owned :id route and
      excludes admin operator :id routes via explicit RouteDef metadata, not a path-prefix guess.
  (d) A non-numeric :id is rejected by the num() param decoder (422) BEFORE any DB call (no NaN
      reaches a query).
  (e) Three-host/server parity: the character core functions take no req/res (server-authority),
      the Phase 9 parity harness diffs clean on every character route except the asserted
      character.* knownDeviations, GET /api/characters and GET /api/me/characters stay
      byte-identical, and the registry-completeness diff shows no dropped path.
  (f) Stable-code i18n: every player-visible error carries a stable machine code (problem+json),
      no English prose is emitted from the server, any appended code is append-only in
      error_codes.ts, and progress.md flags it for the Phase 22 client matcher.
- Test-coverage agent: are cross-account denial (each of DELETE/rename/takeover/standing/owner
  sheet), :id-as-NaN, owned success-path parity, the four limiter firings, and the byte-identity
  of the two list responses each asserted by a real test (not just present)? Name any uncovered
  branch.
- Dead-code / cleanup agent: any leftover old-ladder character branch now shadowed by the new
  router; any unused import; any inline magic number that should be a named limit constant; any
  duplicated body that should reuse characterListResponse; any debug log left in.
- Domain reviewers (spawn ONLY these; the diff is server-only, no DDL/JSONB, no wire/sim/matcher):
  - privacy-security-review: BOLA correctness, no cross-account existence leak, NaN :id blocked,
    limiter cannot be bypassed by casing/trailing slash, deny-log carries no PII beyond accountId +
    route + requested id.
  - qa-checklist: the end-of-contribution gate.
  Do NOT spawn migration-safety, cross-platform-sync, or architecture-reviewer (their surfaces are
  untouched this phase). Each reviewer is prompted for COVERAGE (report every gap with confidence +
  severity), not filtering.

STEP 3 - FIX
- Apply every BLOCKING and SHOULD-FIX finding. Re-run the validation matrix after fixes:
  `npx tsc --noEmit`;
  `npx vitest run tests/server/characters.test.ts tests/server/http/require_owned.test.ts`;
  the Phase 9 parity harness + registry-completeness test;
  if a code was appended: its append-only catalog test + `npx vitest run
  tests/localization_fixes.test.ts` (S3);
  `npm run ci:changed`; `npm run build:server`;
  and the full pre-merge gate `npm test && npx tsc --noEmit && npm run build:env && npm run
  build:server && npm run build`.
- Commit fixes SEPARATELY from the implementation commits, Conventional Commits with a scope and
  EXPLICIT paths (e.g. `fix(server): close cross-account existence leak in character loader`,
  `test(server): cover :id NaN rejection on character routes`). Never git add -A.

STEP 4 - DOC + MEMORY
- Update docs/api-pipeline/progress.md and state.md with the QA outcome and any newly-discovered
  rule (e.g. a sharper account-owned-vs-operator metadata shape, or a parity edge case).
- Record in memory anything surprising that future character/BOLA phases need.

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Report: PASS / PASS-WITH-FOLLOWUPS / FAIL; counts (acceptance criteria verified, BLOCKING found +
fixed, SHOULD-FIX found + fixed, deferrals); validation results (each command PASS/FAIL); reviewer
verdicts (privacy-security-review, qa-checklist); and a one-line handoff to "Phase 13: Migrate
account portal (server/account.ts) + em-dash fix".
````
