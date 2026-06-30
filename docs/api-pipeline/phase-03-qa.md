# Phase 3 QA: Surface re-inventory, content-type classification + characterization/golden corpus

This is the QA gate for Phase 3. Because Phase 3 ships no runtime behavior change (only the
inventory, the content-type classification, the characterization golden corpus, and the seeded
knownDeviation list), the QA focus is correctness of the SAFETY NET itself: do the goldens actually
reproduce today's behavior, is every route and content-type class covered, is the freshness gate
real, and does any captured golden silently bless a defect (a leaked token, a cross-account read, a
secret-gate that does not reject). A wrong baseline here propagates into every later migration phase,
so this gate is load-bearing. It stays under 40% context because it audits a tests-and-fixtures-only
diff and dispatches a bounded reviewer set.

### QA Starter Prompt

````
This is the QA pass for Phase 3 of the API Pipeline re-architecture: Surface re-inventory,
content-type classification + characterization/golden corpus.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: verify the Phase 3 safety net is correct and complete (goldens reproduce today's behavior,
every route + content-type class is covered, the freshness gate is real, no golden blesses a
defect), fix BLOCKING and SHOULD-FIX findings, and hand off to Phase 4.

STEP 0 - PRE-FLIGHT
- Run `git status`. Shared worktree, concurrent sessions: if it is dirty with files you do not own,
  STOP and ask before staging. Commit with EXPLICIT paths only, never `git add -A`.
- Confirm Phase 3 actually landed: tests/server/http/surface_inventory.ts,
  content_type_classification.ts, known_deviations.ts, surface_inventory.test.ts,
  characterization.test.ts, and the tests/server/fixtures/ corpus all exist. If not, STOP: there is
  nothing to QA.
- Scan Claude Code memory for this phase's domain: the server API pipeline audit/SPEC notes, the
  Discord wiring entries (unwired DISCORD_SCHEMA, orphaned handleSwagClaim, isIpBlocked/turnstile
  gaps), and the i18n reword-staleness / stable-code conventions.

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; do not read raw source yourself). Have it read and
summarize exactly:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (what Phase 3 recorded as done).
- docs/api-pipeline/phase-03-surface-inventory.md (the implementation prompt and its ACCEPTANCE
  CRITERIA, which the correctness agent must verify one by one).
- The Phase 3 diff: `git diff` for tests/server/http/surface_inventory.ts,
  content_type_classification.ts, known_deviations.ts, surface_inventory.test.ts,
  characterization.test.ts, and the tests/server/fixtures/ corpus.
The Explore agent must RETURN: the full acceptance-criteria checklist verbatim; the route list the
inventory claims to cover (by symbol + route string); the content-type class assigned to each /api
route; the seeded deviation ids with their target phases; and the set of dynamic fields the goldens
rely on the normalizer to mask.

STEP 2 - QA AUDIT (fan out parallel agents, each given ONLY the Explore summary and the diff):
- Correctness agent: verify EVERY acceptance criterion from phase-03-surface-inventory.md, one by
  one. Specifically: (a) the inventory enumerates every (method,path) across all four dispatchers
  (main handleApi, admin, oauth, internal) + the createServer prefix routes, anchored by symbol +
  route string with ZERO line-number anchors, and includes the net-new endpoints (4 Discord /api
  routes, the orphaned swag/claim flagged UNREACHABLE, the 8 /internal/discord/* secret-gated
  endpoints, the leaderboard ?board=guilds / ?scope / legacy ?limit forks, dev-gated GET /api/perf);
  (b) every /api route has exactly one of the 5 named content-type classes and none is unclassified;
  (c) the route-count freshness gate truly fails on a route added/removed in source (have the agent
  reason about whether the scan can be fooled by a route literal it does not recognize); (d) the
  goldens reproduce today's NORMALIZED response and are byte-stable across two runs; (e) the
  knownDeviation entries each name a real route and a real future phase. This phase is SERVER-ONLY,
  so verify server-parity in the characterization sense: each golden matches the CURRENT old path
  (re-run the corpus and confirm green), and STABLE-CODE i18n in the characterization sense: the
  corpus records the codes/strings the server emits today and introduces NO new code or catalog
  entry (those belong to Phase 7 and Phase 22).
- Test-coverage agent: find routes or response shapes the corpus MISSED. Check the createServer
  prefix routes (serveStatic, /c/ SSR, /p/ card, /avatar, sitemap), the error/404-vs-405 paths, the
  guild-board fork as a distinct case, the binary card path, the HTML email/unsubscribe and OAuth
  GET pages, and the secret-gate reject path on /internal. Report any uncovered (method,path) or
  uncharacterized status/body shape.
- Dead-code / cleanup agent: flag unused fixture files, duplicated normalization logic that should
  call the Phase 2 normalizer instead of re-implementing it, magic string literals that should be
  named constants (content-type classes, deviation ids, dispatcher labels), and any stray `.only(`,
  `debugger`, em/en dash, or emoji.
- Domain reviewers, ONLY those whose surface this diff touches (check `git diff --name-only`):
  privacy-security-review, because the corpus FREEZES the security contract (auth scope per route,
  the anti-enumeration 404, the x-woc-discord-secret gate, BOLA ownership); prompt it for COVERAGE,
  asking specifically whether any golden blesses a defect as expected (a leaked bearer/token a
  normalizer missed, a cross-account read returning data, a secret-gate that does not reject). Do
  NOT dispatch migration-safety (no DDL/JSONB), cross-platform-sync (no sim/wire/matcher), or
  architecture-reviewer (no src/sim). Also run qa-checklist over the full diff.
  Give every reviewer this line: "If your output is truncated, resume from the last complete finding
  and continue; do not restart."

STEP 3 - FIX (apply BLOCKING + SHOULD-FIX findings; defer NICE-TO-HAVE with a note)
- Apply fixes, then re-run the validation matrix for this change type:
```bash
npx tsc --noEmit
npx vitest run tests/server/http/surface_inventory.test.ts tests/server/http/characterization.test.ts
npx @biomejs/biome check --write tests/server/http/surface_inventory.ts tests/server/http/content_type_classification.ts tests/server/http/known_deviations.ts tests/server/http/surface_inventory.test.ts tests/server/http/characterization.test.ts
npm run ci:changed
npm run build:server
```
- Commit each fix as its own Conventional Commit with a scope and EXPLICIT paths, for example
  `test(server): cover the leaderboard guild-board fork as a distinct golden` or
  `fix(server): mask the wallet challenge token the corpus normalizer missed`. Never `git add -A`.
- If a finding shows a golden blessed a real defect (a token leak, a cross-account read, a
  non-rejecting secret-gate), STOP and surface it: do not adjust the golden to "expect" the defect;
  it is a real bug to characterize as a deviation or escalate.

STEP 4 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md and state.md with the QA verdict and any corpus additions
  (new fixtures, new deviation ids, a normalizer mask that had to be widened).
- Record in Claude Code memory any durable surprise (a route that could not be anchored on a symbol,
  a 6th content-type class candidate, a dynamic field that needed masking, the confirmed orphaned
  handleSwagClaim wiring bug for Phase 16).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Report a single verdict: PASS / PASS-WITH-FOLLOWUPS / FAIL, with counts (BLOCKING fixed, SHOULD-FIX
fixed, NICE-TO-HAVE deferred) and the validation results (tsc, vitest, biome, build:server, the
reviewer verdicts). List any deferred follow-ups explicitly. End with a one-line handoff to "Phase 4
implementation: Table router (server/http/router.ts)".
````
