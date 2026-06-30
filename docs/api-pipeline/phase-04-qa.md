# Phase 4 QA: Table router (server/http/router.ts)

This is the QA gate for Phase 4. It audits the implemented diff (the pure path-pattern helper,
the table router, and their tests) against every acceptance criterion in
`docs/api-pipeline/phase-04-router.md`, confirms server-only purity and the pure-match boundary,
and applies any BLOCKING or SHOULD-FIX findings before the phase is declared green. The surface
is tiny and server-only, so this QA stays well under 40 percent context: there is no DB, auth,
wire, or three-host client surface to load, only two pure modules and a discriminated MatchResult.

````
### QA Starter Prompt

This is the QA pass for Phase 4 of the API Pipeline re-architecture: Table router
(server/http/router.ts). Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: verify the Phase 4 router and its pure path-pattern helper meet every acceptance criterion,
keep the server-only purity and pure-match invariants, and fix any BLOCKING / SHOULD-FIX issue
before sign-off. Do not add new feature surface; this is a QA gate, not a continuation.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED; if it is dirty with files you do not own, STOP and ask
  before staging. Commit only with EXPLICIT paths, never `git add -A`.
- Scan Claude Code memory for Phase 4 router topics: "API pipeline router / server/http spine",
  "no-regex routing / admin enum routes", "server-api-pipeline-audit", "shared-worktree commit
  care". Note anything that affects the audit.

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; do not read the docs yourself)
Have the Explore agent summarize:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (the Phase 4 ledger entries and the
  recorded router contract).
- docs/api-pipeline/phase-04-router.md (the acceptance criteria, invariants, and OUT OF SCOPE list
  this QA verifies against).
- The Phase 4 diff itself: `git diff --name-only` plus the full `git diff` for
  server/http/router.ts, server/http/path_pattern.ts, and tests/server/http/router.test.ts,
  tests/server/http/path_pattern.test.ts. Report the actual public surface (exports, the
  MatchResult union, the guard behavior) and the test coverage as implemented.
The Explore agent returns: the implemented exports and types; which acceptance criteria appear
covered vs unproven by tests; and any import the router/helper pulls in beyond `./path_pattern.ts`
and Node built-ins (flag any `src/sim`/render/ui/game/net or `node:http` import).

STEP 2 - QA AUDIT (spawn these agents in parallel; give each ONLY the Explore summary + the diff)
- Correctness agent. MUST verify EVERY acceptance criterion in phase-04-router.md against the real
  code (not the test names): the no-regex guard actually THROWS on `/a/(b|c)`, `/a/*`, `/a/:`,
  `/a/:1bad`, `/^x$/`, and duplicate `:id/:id`; static lookup is O(1) (an inner Map, not a scan);
  dynamic match uses NO `new RegExp` at request time; HEAD maps to GET with `head: true`; wrong-
  method returns 405 with a COMPLETE Allow list (incl. synthesized HEAD when GET present, and
  OPTIONS); OPTIONS synthesizes the allow set on a known path and returns notFound on an unknown
  path; single trailing slash is normalized and root "/" preserved; duplicate (method, path)
  throws; a literal segment beats a `:param` at the same position; `normalizePath` does NOT decode
  percent-encoding or resolve "..". Also confirm the SERVER-ONLY / three-host parity invariant for
  this phase: the router imports nothing from src/sim/render/ui/game/net and touches no req/res, so
  it cannot diverge across the three hosts; and confirm the stable-code i18n invariant holds
  trivially here, the router emits NO player-visible English string (it returns status-class
  descriptors only; the localized 404/405 body is Phase 7).
- Test-coverage agent. Find untested branches: param capture with regex-special characters used as
  literal path VALUES (e.g. an id `a.b+c`), OPTIONS-on-unknown-path -> notFound, the 405 Allow list
  ordering determinism, HEAD on a path that has no GET (should be notFound/405, not a crash), and
  the guard rejection cases. Confirm each acceptance criterion is pinned by an assertion, not just
  exercised.
- Dead-code / cleanup agent. Flag any unused export, any helper introduced "for later", any
  premature generality beyond the contract, any `new RegExp` or regex literal sneaking into the
  match path, and any leftover console/debug. Confirm path_pattern.ts is genuinely consumed by
  router.ts (not orphaned) and that the split earns its keep (pure helper + thin consumer), per
  the repo's module-first rule.
- Domain reviewers (spawn ONLY surfaces this diff touches; check `git diff --name-only`):
  - `privacy-security-review`: server/ routing boundary. COVERAGE prompt: can `normalizePath` or
    the static/dynamic precedence be abused to route a request to a different route than a
    downstream auth gate expects (mixed/encoded slashes, trailing slash, absent ".." handling); is
    the honest 405+Allow consistent with the Phase 9 anti-enumeration deviation; is the guard
    ReDoS-safe by construction.
  - Do NOT spawn migration-safety (no DB/DDL/JSONB), cross-platform-sync (no sim/wire/matcher), or
    architecture-reviewer (no src/sim).
Give every agent this truncation-resume line: "If your review is cut off, resume from the last
file and finding you completed and continue; do not restart."

STEP 3 - FIX (apply BLOCKING + SHOULD-FIX; defer NICE-TO-HAVE with a note)
- Make the smallest change that resolves each BLOCKING / SHOULD-FIX finding. Prefer a failing test
  first, then the fix that turns it green.
- Re-run the validation matrix after fixes:
  - `npx tsc --noEmit`
  - `npx vitest run tests/server/http/router.test.ts tests/server/http/path_pattern.test.ts`
  - `npm run ci:changed` (scoped Biome only; if formatting, `npx @biomejs/biome check --write` the
    four changed files explicitly; never a whole-tree --write)
  - PR pre-merge mirror if anything material changed: `npm test && npx tsc --noEmit && npm run
    build:env && npm run build:server && npm run build`
- Commit fixes in SEPARATE Conventional-Commit commits with EXPLICIT paths, e.g.
  `fix(http): reject encoded-slash routing bypass in normalizePath` or
  `test(http): pin OPTIONS-on-unknown-path notFound and Allow ordering`.

STEP 4 - UPDATE DOCS + MEMORY
- docs/api-pipeline/progress.md and state.md: reflect the QA outcome and any contract clarification
  (e.g. a tightened normalizePath rule or a confirmed Allow-ordering guarantee).
- Memory: record any surprising fix (a routing-bypass edge in normalization, a missed guard case).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Report one of PASS / PASS-WITH-FOLLOWUPS / FAIL, with:
- counts: BLOCKING found/fixed, SHOULD-FIX found/fixed, deferred follow-ups.
- the acceptance-criteria verdict (all met / which remain open).
- validation results (tsc, the two test files, ci:changed, pre-merge mirror if run).
- reviewer verdicts (correctness, test-coverage, dead-code, privacy-security-review).
- a one-line handoff to the next implementation phase: "Phase 5: Onion compose + request context
  (docs/api-pipeline/phase-05-onion-context.md)."
````
