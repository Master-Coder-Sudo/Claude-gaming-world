# Phase 10: Migrate public reads (server/leaderboard.ts)

Phase 10 is the first domain migration in the API Pipeline stacked-PR chain. It ports the
anonymous public-read GET surface onto `RouteDef`s served by the Phase 9 dispatcher, proving the
single-flag dispatch plus per-path catch-all delegate model on the lowest-risk routes before any
sensitive surface (auth, characters, wallet) is touched. It is sized to stay under 40% context
because it migrates exactly one domain (a small set of read-only routes) by consuming spine
primitives already built in Phases 4 to 9, adds no DDL and no JSONB shape change, and touches no
WS wire. The only real complexity is the `/api/leaderboard?board=guilds` response shape-fork plus
two labeled knownDeviations (the `/api/status` trim and the `/api/realms` + `/api/search`
authz-gap-close). Read the canonical decisions in `docs/api-pipeline/` planning state before
starting; this file is the executable contract.

### Starter Prompt

````
This is Phase 10 of the API Pipeline re-architecture: Migrate public reads (server/leaderboard.ts).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: this phase is NOT batch-heavy (a handful of read routes plus their tests). Do NOT add
`ultracode`; hand-spawn 2 to 4 parallel Agents as described in STEP 2.
Goal: port the anonymous public-read GET surface onto RouteDefs served by the new dispatcher,
parity-clean against the Phase 3 golden corpus, with two labeled knownDeviations (the /api/status
trim and the /api/realms + /api/search authz-gap-close) and a documented decision on convention B.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with concurrent sessions: if it is dirty with files you
  do not own, STOP and ask before staging anything. You will commit with EXPLICIT paths only, never
  `git add -A`.
- Scan Claude Code memory for entries in this phase's domain. Suggested topics to look up:
  "leaderboard / guild leaderboard / topGuilds", "API pipeline phase 9 dispatcher + parity harness",
  "userFacingApiError / REST i18n matcher", "wiki guild-highscores". Surface anything relevant before
  you design the routes.

STEP 1 - LOAD CONTEXT (do NOT read planning docs or large source files directly; spawn ONE Explore agent)
Tell the Explore agent to summarize, anchored on SYMBOL NAMES and route strings (main.ts is ~1695
lines, every SPEC line anchor is stale), and to return symbol-anchored summaries, never verbatim dumps:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (the running ledger: what Phases 1 to 9
  shipped, the exact name of the single dispatch flag env var, the RouteDef metadata shape frozen in
  Phase 2, the per-path delegate wiring from Phase 9).
- docs/api-pipeline/phase-10-public-reads.md (this file).
- The inline public-read handlers in server/main.ts, anchored on handleApi and the route-string
  branches: /api/leaderboard (incl. ?board=guilds, legacy ?limit=N, ?scope=global|realm),
  /api/arena/leaderboard, /api/releases, /api/project-stats, /api/search, /api/realms,
  /api/public/characters/:id/sheet, /api/perf (dev-gated by ALLOW_DEV_COMMANDS), and /api/status.
  For each: the current request shape (query handling), the current response body + status + any
  contracted headers, and which db.ts function it calls.
- server/db.ts read functions by name: topLifetimeXp, topArenaRatings, topGuilds,
  getGuildLeaderboard/paginateGuildLeaderboard, the public character-sheet read, and the realms/search
  reads, plus the leaderboard cache (refresh functions). Return their signatures.
- The Phase 4 to 9 spine the migration consumes: server/http/router.ts, compose.ts, context.ts,
  schema.ts, errors.ts, error_codes.ts, registry.ts, index.ts, and server/http/middleware/*.ts (esp.
  the Phase 8 requireAccount bearer resolver, withBody, the THIN rateLimit adapter, withErrors).
  Return the RouteDef type shape, how registry.ts registers a domain's `export const routes`, and how
  the Phase 9 dispatcher decides served-vs-delegate.
- The Phase 2 test scaffolding under tests/server/: the fake-http/fakeCtx helper, the FakeDb interface,
  the golden-master normalizer, the dual-path parity-harness driver, and the registry-introspection
  meta-test helpers. Return their public API surfaces.
- The Phase 3 golden corpus fixtures for the routes above (where they live, how to diff against them).
- server/CLAUDE.md and root CLAUDE.md (the server/http seam + invariants).
Explore should RETURN: the exact current request/response shape of each public-read route, the db.ts
signatures the handlers call, the RouteDef + middleware + registry surfaces, and the parity-harness +
FakeDb + fixture APIs, so STEP 2 agents need nothing else.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Phase 10 has NO documented a/b split (only 08, 09, 17, 23 do): keep all routes in ONE PR. Hand-spawn
these parallel Agents, each owning a COMPLETE vertical slice (RouteDef + thin Ctx handler + extracted
host-agnostic domain function taking a Db interface + its tests). Give each agent ONLY the Explore
summary, not the planning docs.
- Agent A (standard boards): /api/leaderboard standard boards + /api/arena/leaderboard.
  - RouteDefs + thin handlers; domain functions take the FakeDb-able Db interface, no req/res.
  - Typed page/pageSize + scope=global|realm query decoders (bounds + default as NAMED constants).
  - Make and record the convention B decision (see INVARIANTS / the {items,page,pageCount,total,pageSize}
    envelope note below); wire the topLifetimeXp/topArenaRatings cache WITHOUT changing cache behavior.
  - Parity tests vs the Phase 3 fixtures + unit tests via FakeDb.
- Agent B (guild fork + legacy shapes): /api/leaderboard?board=guilds + legacy ?limit=N single-page.
  - Distinct golden-master cases: PRESERVE each existing response shape exactly (parity-clean).
  - Wire getGuildLeaderboard/paginateGuildLeaderboard + the topGuilds JSONB-sum read; do NOT optimize
    or re-index topGuilds (out of scope), just preserve today's behavior and cache.
  - Parity tests for board=guilds, legacy ?limit=N, and ?scope on the guild board.
- Agent C (misc public reads): /api/releases, /api/project-stats, /api/public/characters/:id/sheet
  (typed :id param so it can never reach a DB call as NaN), dev-gated /api/perf.
  - /api/perf stays gated by ALLOW_DEV_COMMANDS=1 and is unreachable in prod; assert the gate.
  - Parity tests + unit tests.
- Agent D (authz-gap-close + status trim): /api/realms + /api/search + /api/status.
  - Apply the one bearer resolver in ANONYMOUS-FRIENDLY mode to /api/realms and /api/search: serve
    normally when NO token is present, but validate a token that IS present and reject an invalid one
    (this closes the authz gap). If the Phase 8 requireAccount lacks an anonymous-friendly path, add
    a minimal additive `optional` option (validate-if-present, allow-none) with its own middleware
    test; do NOT redesign the resolver.
  - Trim /api/status to {ok, realm, players_online} (drops the player name-list leak).
  - BOTH the authz-gap-close and the status trim are LABELED knownDeviations: update the Phase 3
    fixture and add an asserted-knownDeviation entry, never a silent parity diff.
If context approaches 40% despite the small surface, reduce fan-out detail and lean on the parity
harness rather than splitting the PR; this phase ships as one PR.

INVARIANTS THIS PHASE MUST KEEP
- Single-flag dispatch + per-path catch-all delegate (CENTRAL here): registering these RouteDefs makes
  the new onion serve them while the single dispatch flag is on (the test default); every un-migrated
  path still delegates to the old handleApi ladder. Do NOT delete the old leaderboard branches in
  main.ts: they are the flag-off rollback path and are removed only in Phase 25.
- Server-authority: every read resolves server-side; the client never decides an outcome.
- Stable-code i18n: the server emits a stable CODE, never English prose. Any error code these routes
  emit (e.g. invalid-token 401 on the authz-gap-close) must already exist in
  server/http/error_codes.ts (Phase 7); reuse the existing domain.reason vocabulary. If a genuinely
  NEW code is required, APPEND it to error_codes.ts (frozen, append-only) and add its English
  apiError.* catalog entry in the SAME change. Do NOT edit the userFacingApiError client matcher in
  src/main.ts: that extension is Phase 22.
- No DDL / no persistence change: this is a read-only phase. Add no tables, no ALTER, no migrations,
  no JSONB shape change.
- No magic values: page/pageSize bounds, the default limit, and the scope enum values are NAMED
  constants with a single source of truth.
- Determinism / sim-purity: this work is SERVER-ONLY. Do NOT import from or touch src/sim/; if you
  reach for it, stop.
- No WS wire change. No em dashes, no en dashes, no emojis anywhere (code, comments, commits, docs).

THE {items,page,pageCount,total,pageSize} (convention B) DECISION (make it explicitly, record it)
- Introduce the typed page/pageSize/scope query DECODERS regardless: they are input hardening with no
  wire change.
- Adopt the {items,page,pageCount,total,pageSize} ENVELOPE for the standard boards ONLY IF the Phase 3
  fixture shows the mapping is lossless OR a consumer audit (grep src/net and src/ui for the current
  response keys) confirms no client field breaks. Otherwise PRESERVE the existing shape and defer
  convention B to net-new endpoints (Phase 25 scaffold). If you adopt it, it is a LABELED knownDeviation
  with the fixture updated and the consumer audit recorded.
- The guild board (?board=guilds) and the legacy ?limit=N single-page are EXEMPT from convention B:
  keep their existing shapes as distinct golden-master cases.
- Record whichever way you decide in docs/api-pipeline/progress.md with the fixture diff.

OUT OF SCOPE (do not touch; each is a later phase)
- Auth register/login/native-attestation (Phase 11); character ownership + BOLA (Phase 12); account
  portal + em-dash fix (Phase 13); wallet/cards (Phase 14); reports/telemetry (Phase 15); Discord family
  (Phase 16); Admin API (Phase 17); OAuth + Internal (Phase 18).
- The deep two-tier rate-limiter rework and ratelimit_db (Phase 19): use ONLY the Phase 8 THIN rateLimit
  adapter; do not change any limiter return-shape.
- Market realm-scope fix (Phase 20); security-headers top-level wrapper + 415/Origin enforcement (Phase 21).
- The userFacingApiError client matcher extension + per-surface code-parity guard in src/main.ts (Phase 22).
- Logging/metrics/health (Phase 23); validated config + timeouts + no-magic-values consolidation +
  perf gate (Phase 24); flag-default flip + old-ladder deletion (Phase 25).
- Leaderboard cache optimization / topGuilds re-indexing: PRESERVE today's behavior, do not optimize.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Validation (this is a server-only code change with player-facing codes possibly added):
- `npx tsc --noEmit`
- `npx vitest run tests/server/leaderboard.test.ts` (and any existing affected suite the routes touch)
- The Phase 9 dual-path PARITY harness over the Phase 3 fixtures for these routes: zero undocumented diff.
- The Phase 9 registry-completeness test: no old leaderboard path is absent from the new router.
- If any new code was appended to error_codes.ts: `npx vitest run tests/localization_fixes.test.ts` (S3)
  plus the per-surface code-parity assertion if it already exists.
- `npm run ci:changed` (Biome on changed files; scoped `npx @biomejs/biome check --write <file>` only).
- `npm run build:server`.
- Full pre-merge gate before opening the PR: `npm test && npx tsc --noEmit && npm run build:env &&
  npm run build:server && npm run build`.
Multi-agent review (spawn ONLY the agents whose surface this diff touches; check `git diff --name-only`):
- privacy-security-review: REQUIRED (server/ touched; the /api/realms + /api/search authz-gap-close and
  the /api/status name-list trim are security-relevant). Prompt it for COVERAGE not filtering: report
  every correctness or requirement gap with confidence and severity.
- migration-safety: SKIP (no DDL, no JSONB shape change, no db.ts schema change).
- cross-platform-sync: SKIP (no IWorld/src/sim/wire/sim_i18n/server_i18n/RL change).
- architecture-reviewer: SKIP (no src/sim change).
- qa-checklist at phase completion.
Give each reviewer this truncation-resume line: "If your review is truncated, note exactly where you
stopped and resume from that point in a follow-up pass; do not silently drop coverage." Do NOT commit
the PR-final state until every dispatched reviewer reports no BLOCKING finding.

STEP 4 - COMMIT CADENCE (Conventional Commits, scope, EXPLICIT paths; this phase ships as its OWN green PR)
- feat(leaderboard): port public-read routes to RouteDefs
  (server/leaderboard.ts, server/http/registry.ts)
- feat(http): anonymous-friendly bearer resolver for /api/realms and /api/search
  (server/http/middleware/<resolver>.ts, server/leaderboard.ts)
- feat(leaderboard): trim /api/status payload behind a labeled knownDeviation
  (server/leaderboard.ts)
- test(server): parity + unit coverage for public reads
  (tests/server/leaderboard.test.ts, the updated Phase 3 fixtures)
Each phase is a bisectable PR; the suite stays green at every commit.

STEP 5 - ACCEPTANCE CRITERIA (verifiable checkboxes)
- [ ] All listed public-read routes are registered as RouteDefs in server/leaderboard.ts and served by
      the new dispatcher: /api/leaderboard (standard + ?board=guilds + legacy ?limit=N + ?scope),
      /api/arena/leaderboard, /api/releases, /api/project-stats, /api/search, /api/realms,
      /api/public/characters/:id/sheet, /api/perf, /api/status.
- [ ] The old handleApi leaderboard branches in main.ts are LEFT intact (flag-off rollback path).
- [ ] Domain functions take a Db interface (no req/res) and are unit-tested via the Phase 2 FakeDb.
- [ ] page/pageSize and scope query decoders are typed with bounds + defaults as named constants; an
      out-of-range page never reaches a DB call, and :id on the public sheet never reaches a DB call as NaN.
- [ ] /api/status is trimmed to {ok, realm, players_online} as a labeled knownDeviation with the fixture updated.
- [ ] /api/realms and /api/search serve anonymously with no token and reject an INVALID token, as a
      labeled knownDeviation (authz-gap-close); their no-token behavior is unchanged.
- [ ] /api/perf is unreachable unless ALLOW_DEV_COMMANDS=1.
- [ ] The convention B decision is recorded in progress.md with the fixture diff; the guild board and
      legacy ?limit single-page are exempt.
- [ ] The dual-path parity harness is green for every route (zero undocumented diff) and the
      registry-completeness test passes (no dropped route).
- [ ] tsc clean, ci:changed clean, build:server green, full pre-merge gate green.
- [ ] No new magic values; no em/en dashes or emojis; the WS wire is unchanged.

STEP 6 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md: mark Phase 10 done; name the new module (server/leaderboard.ts),
  the migrated routes, any new named constants (page/pageSize bounds, default limit, scope enum), any
  error_codes.ts codes appended, the convention B decision + the two labeled knownDeviations.
- Update docs/api-pipeline/state.md: the public-read surface now serves from the new dispatcher; the old
  branches remain behind the flag.
- Record surprising rules in Claude Code memory: the guild-board shape-fork and topGuilds heavy read, the
  anonymous-friendly bearer-resolver mode, and the convention B decision rationale.

STEP 7 - FINAL RESPONSE FORMAT
- Phase status (DONE / BLOCKED), files touched (absolute paths), validation results (each command +
  pass/fail), review verdicts (per dispatched reviewer), explicit deferrals, and a one-line handoff:
  "Ready for Phase 10 QA."

STOPPING RULES
- STOP if a migrated route's parity fixture diffs without a documented knownDeviation.
- STOP if the registry-completeness test shows any old public-read path absent from the new router (a
  dropped route is a silent prod 404, not a boot error).
- STOP if adopting convention B would change a response field a live client reads (per the src/net +
  src/ui audit) without a labeled knownDeviation and a consumer plan.
- STOP if the authz-gap-close changes the anonymous (no-token) behavior of /api/realms or /api/search
  (they must still serve).
- STOP if /api/perf becomes reachable without ALLOW_DEV_COMMANDS.
- STOP if any change would alter the WS wire protocol, or would require touching src/sim/ (determinism /
  sim-purity), or would add DDL / a JSONB shape change (wrong phase).
````
