# Phase 3: Surface re-inventory, content-type classification + characterization/golden corpus

Phase 3 builds the regression safety net that every later migration phase diffs against. It does
three things and changes zero runtime behavior: (1) re-derive every JSON/HTTP endpoint and its
handler SYMBOL anchor against HEAD (main.ts is now ~1710 lines, the SPEC line anchors are all
stale), with a route-count freshness gate; (2) classify every `/api` route by response
content-type (problem+json vs HTML vs 302 redirect vs binary vs the legacy `{ok:false}` 405) so
the 415/withBody/mapError design in later phases is correct before a single primitive is built;
(3) capture a characterization golden-master corpus over the current server (the old ladder) using
the Phase 2 harness, plus a seeded `knownDeviation` list that encodes the INTENDED hardened
behavior. It is sized under 40% context because it writes only tests, fixtures, and data tables
(no router, no onion, no migration), and the work partitions cleanly by dispatcher across parallel
agents.

This phase consumes the Phase 1 importable spine (so requests can be replayed without binding a
socket) and the Phase 2 harness (golden-master generator, dynamic-field normalizer, fake-http,
fakeCtx, FakeDb, the dual-path parity driver). It produces the fixtures Phases 10 to 18 diff
against and the classification that gates Phase 7's error model.

### Starter Prompt

````
This is Phase 3 of the API Pipeline re-architecture: Surface re-inventory, content-type
classification + characterization/golden corpus.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: add `ultracode`. This phase is batch-heavy (a golden-master corpus over ~46+ routes
across four sub-dispatchers: main handleApi, admin, oauth, internal). Orchestrate the corpus sweep
via a Workflow fan-out. If you are not running ultracode, hand-spawn the parallel agents in STEP 2.
Goal: produce a HEAD-anchored route inventory, a per-route content-type classification, and a
characterization golden corpus (plus a seeded knownDeviation list) that reproduces today's behavior
so every later phase can diff against it, with no runtime behavior change.

STEP 0 - PRE-FLIGHT
- Run `git status`. This is a SHARED worktree with concurrent sessions: if it is dirty with files
  you do not own, STOP and ask before staging anything. You will commit with EXPLICIT paths only,
  never `git add -A`.
- Confirm Phase 1 and Phase 2 landed: `server/http/` exists (the importable spine + ws_auth) and
  `tests/server/` exists (the fake-http, fakeCtx, golden-master generator, normalizer, FakeDb,
  parity driver). If either is missing, STOP: Phase 3 cannot characterize without them.
- Scan Claude Code memory for entries in this phase's domain. Suggested topics to look up:
  "server API pipeline audit / SPEC", "PR #1044 / #1075 Discord integration (unwired
  DISCORD_SCHEMA, orphaned handleSwagClaim, isIpBlocked/turnstile gaps)", "guild leaderboard /
  highscores shape-fork", and the Workflow-agent absolute-path gotcha (agents resolve relative
  reads against session cwd, not the worktree, so pass ABSOLUTE paths).

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or server source directly; spawn ONE Explore
agent and have it summarize). Tell the Explore agent to read and summarize exactly:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (current packet state; what Phases 1
  and 2 shipped).
- docs/api-pipeline/phase-03-surface-inventory.md (THIS file).
- server/main.ts: anchor on `handleApi` and the `createServer` callback's prefix dispatch ladder;
  enumerate every route string literal and its handler symbol. Do NOT cite line numbers (the file
  is ~1710 lines and churns). Include the net-new routes: POST /api/auth/discord/start, GET
  /api/auth/discord/callback, GET /api/discord, DELETE /api/discord, GET /api/leaderboard with its
  ?board=guilds / ?scope=global|realm / legacy ?limit=N forks, and the dev-gated GET /api/perf
  (ALLOW_DEV_COMMANDS).
- server/admin.ts: `handleAdminApi` (the ~19 branches; the `{success,data,error}` envelope; the
  enum-segment routes suspend|unsuspend|ban|unban; page/limit pagination).
- server/oauth.ts: `handleOAuth` (POST /oauth/token, /oauth/revoke, /oauth/device_authorization,
  authorize-POST, device-POST emit RFC 6749 {error,error_description}; the GET authorize/device
  pages return text/html via `htmlError`).
- server/internal.ts: the secret-gated `x-woc-discord-secret` handlers (restart-countdown plus the
  8 /internal/discord/* bot-channel endpoints).
- server/discord.ts: the OAuth start/callback handlers, the callback `bouncePage` HTML, and the
  orphaned `handleSwagClaim` (implemented + unit-tested but NOT dispatched in main.ts, currently
  unreachable over HTTP).
- server/http_util.ts (current response helpers: the makeRes/writeHead/end shapes, readBody,
  readBinaryBody), server/perf_report.ts (the `{ok:false}` 405 AND the 200-not-429-on-throttle
  by-design response), server/site_presence.ts (405 method ownership), server/ratelimit.ts (the
  current limiter booleans + the Phase 2 injected `now()` clock).
- server/CLAUDE.md and root CLAUDE.md (the server-only, stable-code-i18n, no-em-dash invariants).
- The prior phases' new modules this phase consumes: the Phase 1 spine under server/http/ (exported
  startServer, the pure prefix dispatcher, the ws_auth module) and the Phase 2 harness under
  tests/server/ (fake-http, fakeCtx, the golden-master generator, the dynamic-field normalizer,
  FakeDb, the per-pass-isolated parity driver).
The Explore agent must RETURN: (a) a per-route ledger row for EVERY (method, path) across all four
dispatchers and the createServer prefix routes, each row carrying { dispatcher, handler SYMBOL
name, response content-type, auth scope, current status/body shape, limiter if any, requireOwned*
expectation } and ZERO line-number anchors; (b) the EXACT public signatures of the Phase 2 harness
(golden-master generator, normalizer, fakeCtx, fake-http, FakeDb, parity driver) so agents call
them correctly; (c) the exact set of dynamic fields the Phase 2 normalizer currently masks
(timestamps, ids, tokens, reqId, Date) so we know what is already deterministic.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE. Fan out 4 parallel agents, each owning a complete vertical
slice (its data/fixtures PLUS its tests), each given ONLY the Explore summary (not the raw source):
- Agent A (inventory + classification spine):
  - tests/server/http/surface_inventory.ts: a single `as const` ledger of every (method, path) the
    server dispatches today, each entry anchored by route string + handler symbol name (NO line
    numbers), tagged with { dispatcher, contentType class, authScope, limiter, requireOwnedExpected }.
  - tests/server/http/content_type_classification.ts: the 5-class enum as named constants
    (PROBLEM_JSON, HTML, REDIRECT, BINARY, LEGACY_OKFALSE_405) and the per-route map for the /api
    surface (card -> BINARY, email/unsubscribe -> HTML, discord/callback -> REDIRECT, perf-report ->
    LEGACY_OKFALSE_405, everything else JSON-shaped -> PROBLEM_JSON-eligible).
  - tests/server/http/surface_inventory.test.ts: the route-count FRESHNESS GATE (scan the four
    dispatcher sources for route literals/prefixes, count distinct (method,path), assert it equals
    the inventory length so a route added or removed in source without an inventory update hard-fails)
    PLUS a classification completeness assertion (every /api path has exactly one class; no /api path
    is unclassified).
- Agent B (characterization goldens, MAIN /api surface): fixtures + characterization.test.ts
  covering the handleApi inline routes, the /api/leaderboard ?board=guilds + ?scope + legacy ?limit
  forks (treat each fork as a DISTINCT golden case), dev-gated GET /api/perf, the 4 Discord /api
  routes, POST /api/card (binary), and GET /api/email/unsubscribe (HTML). Replay each through the
  CURRENT old path via the Phase 2 parity driver; normalize dynamic fields via the Phase 2
  normalizer; store the golden.
- Agent C (characterization goldens, admin + oauth + internal): fixtures + tests for handleAdminApi
  (`{success,data,error}`, page/limit), handleOAuth (POST RFC 6749 {error,error_description} AND the
  GET authorize/device HTML pages), and the secret-gated /internal handlers (restart-countdown + the
  8 /internal/discord/* endpoints with their `x-woc-discord-secret` gate). Same replay + normalize +
  store flow.
- Agent D (knownDeviations + completeness wiring): tests/server/http/known_deviations.ts as a named
  `as const` list, each entry { id, routes, currentBehavior, intendedBehavior, introducedInPhase,
  reason }, SEEDED with: perf_report returns 200-not-429 on throttle (by design); perf_report and
  site_presence return 405 (method ownership preserved); register/login anti-enumeration 404;
  planned 405-before-auth on known-path wrong-method (Phase 4); the 422/400/413 status remap from
  today's 400-for-validation / 500-for-malformed (Phase 7); the `{ok:false}` 405 4th contract case;
  the /api/status name-list trim (Phase 10); the NEW limiters (character.create/rename/delete/
  takeover -> Phase 12, reports.create -> Phase 15, discord.* -> Phase 16/19). Wire a test that every
  deviation id names a real inventory route and a real future phase; tag the corresponding goldens
  with their deviation id so later phases know which diffs are expected.
Each agent's deliverables are the bullets above. There is no documented a/b split for Phase 3: if
context approaches 40%, do NOT split the phase, instead land the corpus per-dispatcher across the
separate commits in STEP 4 (the agent boundaries already partition it).

INVARIANTS THIS PHASE MUST KEEP
- NO runtime behavior change: this phase adds ONLY files under tests/ and docs/. `git diff
  --name-only` must show no server/ runtime source and no src/ files. If reproducing a route forces
  a server source edit, STOP (the spine/harness is insufficient; surface it).
- Anchor on SYMBOL names + route strings, NEVER line numbers (the entire point of the re-inventory).
- Determinism: goldens must be byte-stable across runs. All non-determinism (timestamps, ids,
  tokens, reqId, Date) is masked by the Phase 2 normalizer, never by hand-editing a golden. Server
  time is fine; this phase does not touch src/sim, so sim purity is untouched.
- Stable-code i18n: CHARACTERIZE the codes/strings the server emits today; do NOT add or rename any
  error code or catalog entry (that is Phase 7 and Phase 22). The goldens record what exists.
- Server-authority and the WS wire protocol are untouched: this is read-only characterization of the
  HTTP surface.
- No magic values: the content-type classes, the deviation ids, and the dispatcher labels are all
  named constants, not inline string literals scattered through tests.
- Module-first: inventory, classification, and deviations are their own small data + test modules
  under tests/server/http/, never inlined into one mega-test.
- No em dashes, no en dashes, no emojis anywhere (fixtures, code, comments, docs, commits).

OUT OF SCOPE (do not do these here)
- Any router, onion/compose, schema validator, error model, or middleware primitive (Phases 4 to 8).
- Migrating any route onto a RouteDef, or wiring a new dispatcher in front of handleApi (Phase 9+).
- Building the parity DRIVER, the normalizer, fakeCtx, or FakeDb (those are Phase 2; you USE them).
- Adding/wiring any error code, any limiter, RATELIMIT_SCHEMA/DISCORD_SCHEMA, security headers, the
  em-dash string fix, or any i18n catalog entry (later phases own those).
- The market realm-scope fix and any DDL or JSONB change (Phase 20 and Phase 19).
- Touching src/sim/, src/main.ts, the WS wire, or the RL surface.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run the validation matrix for this change type (tests + fixtures, no server source change):
```bash
npx tsc --noEmit
npx vitest run tests/server/http/surface_inventory.test.ts tests/server/http/characterization.test.ts
npx @biomejs/biome check --write tests/server/http/surface_inventory.ts tests/server/http/content_type_classification.ts tests/server/http/known_deviations.ts tests/server/http/surface_inventory.test.ts tests/server/http/characterization.test.ts
npm run ci:changed
npm run build:server   # sanity: no server runtime change, build must still pass
```
Then dispatch review agents, but ONLY the surfaces this diff actually touches (check `git diff
--name-only` first). This diff is tests + fixtures + docs only, so:
- privacy-security-review: the golden corpus FREEZES the security contract (per-route auth scope,
  the anti-enumeration 404 on register/login, the `x-woc-discord-secret` gate on /internal, BOLA
  ownership expectations). Prompt it for COVERAGE: does any captured golden bless a defect as
  "expected" (a cross-account read returning data, a secret-gate that does not actually reject, a
  token echoed in a body the normalizer missed)? Not filtering, coverage.
- qa-checklist: at phase completion, over the full diff.
Do NOT dispatch migration-safety (no DDL/JSONB), cross-platform-sync (no sim/wire/matcher change),
or architecture-reviewer (no src/sim change). Give each reviewer the diff and this line: "If your
output is truncated, resume from the last complete finding and continue; do not restart." Do not
commit until each reviewer reports no BLOCKING findings.

STEP 4 - COMMIT CADENCE (Conventional Commits with a scope, EXPLICIT paths; this phase ships as its
own green PR in the stacked chain):
- `test(server): HEAD-anchored API surface inventory + route-count freshness gate`
  (tests/server/http/surface_inventory.ts, tests/server/http/surface_inventory.test.ts)
- `test(server): classify every /api route by response content-type`
  (tests/server/http/content_type_classification.ts)
- `test(server): characterization golden corpus for main + admin + oauth + internal`
  (tests/server/http/characterization.test.ts, tests/server/fixtures/**)
- `test(server): seed knownDeviation list for planned hardening`
  (tests/server/http/known_deviations.ts)
- `docs(api-pipeline): record Phase 3 inventory, classification, deviations`
  (docs/api-pipeline/progress.md, docs/api-pipeline/state.md)

STEP 5 - ACCEPTANCE CRITERIA (verifiable checkboxes)
- [ ] The inventory enumerates every (method, path) across all four dispatchers (main handleApi,
      admin, oauth, internal) and the createServer prefix routes, each anchored by route string +
      handler symbol name, with ZERO line-number anchors.
- [ ] The inventory includes the net-new-since-SPEC endpoints: the 4 Discord /api routes, the
      orphaned POST /api/discord/swag/claim (flagged UNREACHABLE), the 8 /internal/discord/*
      secret-gated endpoints, the /api/leaderboard ?board=guilds + ?scope + legacy ?limit forks, and
      dev-gated GET /api/perf.
- [ ] Every /api route carries exactly one content-type class; the classification test fails if any
      /api path is unclassified, and the 5 classes are named constants.
- [ ] The route-count freshness gate fails when a route is added or removed in source without a
      matching inventory update.
- [ ] The golden corpus reproduces today's NORMALIZED response (status, body, contracted headers)
      for every route; characterization.test.ts is green against the CURRENT old path.
- [ ] Goldens are byte-stable across two runs (dynamic fields masked by the Phase 2 normalizer, not
      by hand-editing a golden).
- [ ] The knownDeviation list is seeded with every named entry, each tagged with the phase that
      introduces it, and each id names a real inventory route.
- [ ] `git diff --name-only` shows only tests/ and docs/ paths (no server/ runtime, no src/).
- [ ] `npx tsc --noEmit` clean, the new vitest files pass, biome clean on changed files,
      `npm run build:server` unaffected.

STEP 6 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md (mark Phase 3 done; the suite is green; PR opened) and
  docs/api-pipeline/state.md, naming the specific new artifacts: the modules
  tests/server/http/surface_inventory.ts, content_type_classification.ts, known_deviations.ts,
  characterization.test.ts; the tests/server/fixtures/ corpus; the 5 content-type classes
  (PROBLEM_JSON, HTML, REDIRECT, BINARY, LEGACY_OKFALSE_405); the route-count freshness gate; and the
  seeded deviation ids with their target phases.
- Record in Claude Code memory anything surprising: the orphaned handleSwagClaim is unreachable over
  HTTP (a real wiring bug to fix in Phase 16); the OAuth GET authorize/device pages are HTML
  (htmlError), not RFC 6749 JSON; the perf_report 200-on-throttle and `{ok:false}` 405 are the 4th
  contract shape; the guild-board leaderboard is a genuine response shape-fork; and which dynamic
  fields the normalizer had to mask for byte-stability.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status (DONE / BLOCKED); files touched (absolute paths); validation results (tsc,
vitest, biome, build:server); review verdicts (privacy-security-review, qa-checklist); deferrals or
surprises surfaced (e.g. a 6th content-type class, a golden that exposed a defect); and a one-line
handoff to "Phase 3 QA".

STOPPING RULES (stop and surface, do not work around)
- Stop if reproducing any route's behavior requires MODIFYING server runtime source. This phase is
  characterization-only; a needed source change means the Phase 1 spine or Phase 2 harness is
  insufficient.
- Stop if a golden master is non-deterministic after the Phase 2 normalizer (a dynamic field is
  unmasked). Fix it in the normalizer (Phase 2 scope) and surface it; never hand-edit a golden to
  make it pass.
- Stop if a route cannot be anchored on a stable handler SYMBOL name (an anonymous closure with no
  name). Note it as a Phase 1 extraction gap rather than anchoring on a line number.
- Stop if classification finds a /api route that is none of the 5 classes (a 6th content-type
  contract). It changes the Phase 7 error-model design; surface it before proceeding.
- Stop if any captured golden appears to bless a security defect (a cross-account read returning
  data, a secret-gate that does not reject, a leaked token). Do not freeze a vulnerability as
  "expected"; surface it.
- Stop if any change would alter the WS wire protocol or touch src/sim/. Neither may change here.
````
