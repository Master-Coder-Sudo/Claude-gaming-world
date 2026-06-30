# Phase 9: Registry + dispatcher-in-front + dual-path parity harness + top-level CORS wrapper

This is the integration phase. It assembles the per-domain route tables (built in the migration
phases that follow) into one `registry.ts`, places the new in-house dispatcher in front of the
legacy `/api` `handleApi` with a per-path catch-all delegate so un-migrated paths fall through
unchanged, keeps CORS and the OPTIONS-204 preflight short-circuit as a single top-level
`createServer` wrapper covering BOTH the old and new paths, and stands up the load-bearing
dual-path parity net plus a registry-completeness gate. At this point ZERO domain routes are
migrated (those begin in Phase 10), so the registry is empty and every `/api` path delegates:
the whole value of this phase is proving, before any route moves, that the new seam is
byte-for-byte identical to today.

It is sized under 40% context because it adds only two small spine modules (`registry.ts`,
`dispatch.ts`) plus a thin `main.ts` swap and two test files, all written against the frozen
Phase 4 to 8 interfaces. It carries a documented 9a (registry + wiring) / 9b (parity harness)
split: if context approaches 40%, ship 9a as its own green PR and stack 9b on top.

### Starter Prompt

````
This is Phase 9 of the API Pipeline re-architecture: Registry + dispatcher-in-front + dual-path
parity harness + top-level CORS wrapper.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: do NOT use ultracode here. This phase is integration-shaped (two small modules, a thin
main.ts swap, two test files), not a large content or test sweep, so hand-spawn 2 to 4 parallel
agents rather than orchestrating a Workflow.
Goal: place the in-house dispatcher in front of the legacy /api handleApi with a per-path
catch-all delegate, assemble the route registry, keep CORS and the OPTIONS-204 preflight as one
top-level wrapper over both paths, and prove byte-for-byte parity with today via a dual-path
harness and a registry-completeness gate, with zero routes migrated.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with concurrent sessions: if it is dirty with files
  you do not own, STOP and ask before staging anything. You will commit with EXPLICIT paths only,
  never `git add -A`.
- Scan Claude Code memory for entries in this phase's domain. Suggested topics to look up:
  "Server API pipeline audit (2026-06-29)" (the locked SPEC for this packet), "Shared-worktree
  commit care" (explicit-path staging on this tree), "Workflow-agent cwd/worktree gotcha" (pass
  ABSOLUTE paths to every subagent), and "PR #1044 Discord integration review" (the unwired
  DISCORD_SCHEMA precedent: a defined-but-unwired seam that booted green but did nothing, the same
  silent-gap failure mode this phase's completeness gate guards against).

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or main.ts directly; spawn ONE Explore agent)
Tell the Explore agent to read and summarize, anchored on SYMBOL NAMES and route strings (never
line numbers, main.ts is ~1695 lines and all SPEC anchors are stale):
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (current packet state, what Phases
  1 to 8 actually shipped and their exported surfaces).
- docs/api-pipeline/phase-09-registry-parity.md (this file).
- server/main.ts: the `createServer` request callback and its prefix dispatch ORDER (serveStatic,
  /c/ SSR, /p/ card, /avatar, sitemap, /admin, /oauth, /internal, the /api branch, and the /ws
  upgrade handler); the `handleApi` function and EXACTLY how it is invoked from the /api branch
  (awaited or fire-and-forget void); the CORS allow-origin helper and the OPTIONS-204 preflight
  short-circuit (which prefixes it currently applies to); and `startServer`.
- The spine modules this phase consumes: server/http/router.ts (Phase 4: the Map<method,{static,
  dynamic}> matcher, 404-vs-405+Allow, HEAD-for-GET, synthesized OPTIONS, trailing-slash, the
  no-regex guard), server/http/compose.ts + server/http/context.ts (Phase 5: compose(Mw[]), the
  Ctx + buildContext, the ALS reqId carrier, and the outermost exactly-one-idempotent-response
  wrapper contract), server/http/schema.ts (Phase 6), server/http/errors.ts + error_codes.ts
  (Phase 7: mapError + the per-surface serializers), server/http/middleware/*.ts (Phase 8:
  withErrors, requestId, withCors, withBody/withRawBody, requireAccount, the thin rateLimit
  adapter, and the INJECTABLE metric/access-log sink), plus any existing server/http/registry.ts
  stub and server/http/index.ts barrel.
- The Phase 2 test scaffolding under tests/server/: the parity-harness driver (how it feeds a
  fixture through BOTH dispatchers with per-pass isolation, resetting limiter Maps / fresh ALS
  run() / reloaded config), the golden-master normalizer, the registry-introspection meta-test
  helpers, the fake-http + fakeCtx helpers, and the pure loadConfig(env) loader.
- The Phase 3 corpus under tests/server/: the golden-master fixtures over every /api route and the
  createServer prefix dispatch, the route-count freshness gate, and the seeded knownDeviation list.
- server/CLAUDE.md and the root CLAUDE.md (server seam + module-first rules).
Have the Explore agent RETURN: the exact exported signatures of router / compose / buildContext /
the registry stub / each Phase 8 middleware and the injectable sink; the precise current /api
dispatch call site in createServer (awaited vs void, what args handleApi takes); how and where
CORS + OPTIONS-204 are applied today and to which prefixes; the parity driver's API (function to
run a fixture old-vs-new, the fixture shape, the per-pass reset hooks); the registry-introspection
helper API; the loadConfig(env) shape and whether a dispatch flag field already exists; and the
current contents of the knownDeviation list. NO large verbatim dumps, just seams and signatures.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Default plan: a 4-agent parallel fan-out, each owning a complete vertical slice (behavior plus its
tests) and given ONLY the Explore summary plus the frozen interfaces it depends on. File ownership
is disjoint (no two agents write the same file):
- Agent A (9a-registry): server/http/registry.ts + the server/http/index.ts barrel.
  - registry.ts assembles one lookup by spreading the per-domain `routes: RouteDef[]` arrays into
    a single router instance (the arrays are EMPTY or near-empty today; the migration phases
    populate them). Expose a `resolve(method, path)` returning the matched RouteDef + captured
    params, or a router-level 404/405 decision, reusing the Phase 4 router (do NOT reimplement
    matching).
  - index.ts barrel re-exports the public spine surface (router, compose, context, schema, errors,
    error_codes, registry, the dispatcher from Agent B) and nothing private.
  - Unit tests: tests/server/http/registry.test.ts (resolve hits a registered RouteDef with params;
    an unregistered path yields the no-match decision the dispatcher will delegate on; duplicate
    (method,path) registration is rejected at build time).
- Agent B (9a-wiring): server/http/dispatch.ts + the server/main.ts swap + the top-level CORS/
  OPTIONS wrapper.
  - dispatch.ts exports the dispatcher-in-front: a function with the SAME external call signature
    as today's handleApi (so main.ts swaps one call), taking the registry and the legacy handleApi
    as an injected DELEGATE. For a path the registry owns, run the Phase 5 onion under the Phase 5
    exactly-one-idempotent-response wrapper; for any other /api path, call the delegate (legacy
    handleApi) UNCHANGED. The dispatcher is gated by a single named dispatch flag read via
    loadConfig (Phase 2); when the flag is off, main.ts calls the legacy handleApi directly (full
    rollback). Reproduce the createServer prefix ORDER and the non-awaited void semantics of the
    current /api call site EXACTLY (if today's call is fire-and-forget void, keep it fire-and-forget;
    the Phase 5 wrapper owns the single response, the dispatcher must not await-and-respond twice).
  - In server/main.ts: swap ONLY the /api branch's handleApi invocation for the dispatcher, passing
    the registry and the legacy handleApi as the delegate. Lift the existing CORS + OPTIONS-204
    preflight short-circuit into ONE top-level wrapper at the createServer entry so BOTH the legacy
    ladder and the new dispatcher inherit it from a single source of truth. PRESERVE exactly which
    prefixes get CORS today (do not broaden or narrow coverage); reuse the existing allow-origin
    logic, do not fork the CORS decision. Do NOT touch the /admin, /oauth, /internal, or /ws
    branches (those sub-dispatchers are fronted in Phases 17, 18; the /ws upgrade path stays byte-
    identical). Read the dispatch flag via loadConfig, never a scattered process.env read.
  - DISPATCH FLAG DEFAULT: introduce the flag as a single named boolean owned by loadConfig. This
    phase only WIRES it; flipping the production default to the new path is Phase 25's explicit
    deliverable, so do NOT flip the production default here. The parity harness and the suite run
    with the flag ON (the new dispatcher is the path the suite targets).
  - OPTIONS interaction to PRESERVE (not change): the top-level OPTIONS-204 preflight short-circuit
    keeps handling CORS preflight (OPTIONS carrying Access-Control-Request-Method) before dispatch,
    exactly as today. The Phase 4 router-synthesized OPTIONS applies only to routes the new router
    owns, of which there are none this phase, so the top-level OPTIONS handling stays authoritative
    and unchanged. Parity must confirm OPTIONS behavior is identical.
  - Unit tests: tests/server/http/dispatch.test.ts (a registered path runs the onion exactly once;
    an unregistered path calls the injected delegate with the untouched req/res; flag-off bypasses
    the dispatcher entirely; the top-level CORS wrapper emits identical CORS on both a delegated and
    a future onion path; exactly one response on the throw path).
- Agent C (9b-parity): tests/server/http/parity.test.ts (extend the Phase 2 parity driver, do not
  rebuild it).
  - Run EVERY Phase 3 fixture through both dispatchers in-process with per-pass isolation, diffing
    status, normalized body, and the CONTRACTED headers (Content-Type, CORS set, Allow, Retry-After,
    WWW-Authenticate where present). Weight the error paths and the 404-vs-405 paths heaviest. BLOCK
    on any diff that is not on the seeded knownDeviation list.
  - Explicit named assertions: POST or wrong-method /api/perf-report still returns 405 (its by-design
    {ok:false} 405 case); /api/characters on a wrong-method unauthenticated request still returns 401
    before any handler; CORS and preflight (OPTIONS) responses are identical old-vs-new for every
    route; zero silent diffs across the whole corpus.
- Agent D (9b-completeness): tests/server/http/completeness.test.ts (use the Phase 2 registry-
  introspection helpers).
  - The registry-completeness gate: derive the old-ladder path set (the legacy handleApi route set
    from the Phase 3 inventory) and the new dispatcher's effective coverage (registered router paths
    UNION the per-path delegate fall-through). Assert every old-ladder path is served by the new
    dispatcher via one of those two, and HARD-FAIL if any old path is served by neither (a dropped
    route is a prod 404, not a boot error). This gate runs on every rebase and stays meaningful as
    routes migrate (each route moves from delegate-covered to router-owned without a coverage gap).
A and B share a frozen interface (the registry resolve signature) carried in the Explore summary,
so they run in parallel against that interface, not against each other's code. C and D depend only
on the dispatcher's external call signature (identical to handleApi) and the Phase 2/3 helpers, also
in the summary.
SPLIT RULE: if context approaches 40%, ship 9a (agents A + B: registry + wiring + CORS) as its own
green PR first, then stack 9b (agents C + D: parity harness + completeness gate) as a second PR on
top. 9b naturally stacks on 9a because the parity tests exercise the wired dispatcher.

INVARIANTS THIS PHASE MUST KEEP
- Single dispatch flag + per-path catch-all delegate model: one named env flag (read via loadConfig)
  selects the new pipeline in front of the legacy /api handleApi; within the new pipeline,
  un-migrated paths delegate per-path to the legacy ladder UNCHANGED. Rollback is flipping the one
  flag. This is the core deliverable, get it exactly right.
- Server-authority and behavior parity: zero behavior change. Every /api response is byte-for-byte
  identical to today (proven by the parity harness), since no route is migrated. Preserve the
  createServer prefix order and the non-awaited void semantics of the /api call site exactly.
- Exactly-one idempotent response: the Phase 5 outermost wrapper owns the single response on both
  the resolve and the throw paths (headersSent/writableEnded guarded). The dispatcher must not emit
  a second response or double-await.
- Top-level CORS single source of truth: CORS + OPTIONS-204 preflight is one top-level wrapper over
  both paths; identical CORS old-vs-new per route; today's CORS application surface unchanged.
- No WS wire change: do not touch the /ws upgrade handler or any snapshot/wire shape.
- Stable-code i18n: emit no new English player-facing strings on the dispatcher or delegate path;
  any error body still comes from the Phase 7 mapError -> codes, never English assembled here.
- No magic values: the dispatch flag is a named constant owned by loadConfig; no scattered
  process.env reads; no bare literals for the flag or any header name.
- No em dashes, en dashes, or emojis anywhere (code, comments, tests, commits, docs).
- Module-first: the registry and dispatcher live under server/http/; main.ts gets only a minimal
  one-call swap plus the lifted CORS wrapper. Do NOT grow main.ts with new logic.

OUT OF SCOPE (do not let these creep in)
- Migrating ANY domain route or handler (Phase 10 public reads onward). The registry stays empty or
  near-empty; everything delegates.
- Fronting the /admin, /oauth, or /internal sub-dispatchers (Phases 17, 18). This phase fronts only
  the main /api handleApi.
- The security-headers top-level wrapper (Phase 21). CORS is in scope here; security headers are not.
- The two-tier rate limiter and ratelimit_db (Phase 19); only the Phase 8 thin adapter exists.
- The structured logger and /metrics exporter (Phase 23); only the Phase 8 injectable no-op sink
  exists, leave it a no-op.
- The REST i18n matcher and code-parity guard (Phase 22); the em-dash fix (Phase 13).
- Config consolidation and server timeouts (Phase 24); flipping the flag default and the new:endpoint
  scaffold (Phase 25).
- Any DDL, JSONB, or persistence change. None in this phase.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order:
- `npx tsc --noEmit`
- `npx vitest run tests/server/http/registry.test.ts tests/server/http/dispatch.test.ts tests/server/http/parity.test.ts tests/server/http/completeness.test.ts`
- `npx vitest run tests/server/` (the parity driver and any existing affected server suite)
- `npm run build:server`
- `npm run ci:changed` (Biome on changed files only; never a whole-tree --write)
- Pre-merge gate, mirror CI before the PR is green: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`
The WS wire is NOT expected to change; if any step would change it, STOP and surface it.
Then dispatch review agents for COVERAGE (report every correctness or requirement gap with
confidence and severity, do NOT pre-filter). Per the canonical review-dispatch rules, check
`git diff --name-only` and spawn ONLY the surfaces this diff touches:
- privacy-security-review: server/ is touched and the dispatcher now sits in front of auth, CORS,
  and the delegate. Verify the delegate cannot drop an auth check, the dispatcher cannot leak an
  un-authed path, CORS is not weakened, and a flag-off rollback restores the legacy path cleanly.
- qa-checklist: the end-of-phase gate.
Do NOT spawn migration-safety (no DDL/JSONB), cross-platform-sync (no IWorld/sim/wire/matcher
change), or architecture-reviewer (no src/sim/ change). Give every review agent ABSOLUTE paths and
the line: "If your output is truncated, resume from the last file you completed and continue; do not
restart." Do not commit until each reports no BLOCKING finding.

STEP 4 - COMMIT CADENCE (Conventional Commits with a scope, EXPLICIT paths)
- `feat(http): assemble route registry and barrel (server/http/registry.ts, server/http/index.ts)`
- `feat(http): front legacy /api handleApi with the new dispatcher and per-path delegate (server/http/dispatch.ts, server/main.ts)`
- `feat(server): lift CORS and OPTIONS-204 preflight into one top-level wrapper over both paths (server/main.ts)`
- `test(server): dual-path parity harness over the Phase 3 fixtures (tests/server/http/parity.test.ts)`
- `test(server): registry-completeness gate, old-ladder vs new-dispatcher coverage (tests/server/http/completeness.test.ts)`
Delivery is a STACKED PR CHAIN: this phase ships as its own green, bisectable PR stacked on Phase 8.
If you split, 9a is the first three commits as one PR and 9b is the last two stacked on it.

STEP 5 - ACCEPTANCE CRITERIA (verifiable)
- [ ] server/http/registry.ts assembles one lookup from the per-domain RouteDef arrays (empty today)
      and exposes a resolve that reuses the Phase 4 router; duplicate (method,path) is build-time
      rejected.
- [ ] server/http/dispatch.ts exports the dispatcher-in-front with the same external signature as
      handleApi, gated by the named dispatch flag (loadConfig), delegating un-migrated /api paths
      per-path to the legacy handleApi unchanged.
- [ ] server/http/index.ts re-exports only the public spine surface.
- [ ] server/main.ts routes /api through the dispatcher when the flag is on (legacy handleApi as the
      delegate) and through legacy handleApi directly when off; prefix order and non-awaited void
      semantics preserved.
- [ ] CORS + OPTIONS-204 preflight is one top-level wrapper covering both paths from a single source
      of truth; today's CORS application surface is unchanged.
- [ ] The parity harness runs every Phase 3 fixture old-vs-new with zero undocumented diffs; error
      and 404-vs-405 paths weighted heaviest.
- [ ] /api/perf-report stays 405 and /api/characters stays 401 on a wrong-method unauthenticated
      request (explicit parity assertions green).
- [ ] CORS and preflight responses are identical old-vs-new per route (assertion green).
- [ ] The registry-completeness gate hard-fails if any old-ladder path is served by neither the
      router nor the delegate.
- [ ] tsc clean, build:server green, ci:changed clean, the full pre-merge gate green.
- [ ] No WS wire change, no src/sim/ touch, no new player-facing English string.

STEP 6 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md: mark Phase 9 done and name the new surface: server/http/
  registry.ts, server/http/dispatch.ts, the finalized server/http/index.ts barrel, the named
  dispatch flag (record its exact env name and loadConfig field), tests/server/http/parity.test.ts,
  and tests/server/http/completeness.test.ts.
- Update docs/api-pipeline/state.md: record that the new dispatcher now fronts the /api handleApi via
  a per-path catch-all delegate gated by the single flag; the registry is empty until Phase 10;
  CORS + OPTIONS-204 is now a single top-level wrapper over both paths; the dual-path parity net and
  the completeness gate are now load-bearing and run on every rebase.
- Record in Claude Code memory: the single-flag + per-path-delegate reconciliation (the flag is the
  master on/off, the delegate is the partial-migration mechanism); that the dispatcher must preserve
  the createServer non-awaited void semantics so the Phase 5 wrapper owns the one response; the
  registry-completeness gate semantics (router UNION delegate must equal the old-ladder path set);
  and that CORS must stay a single top-level source of truth so a rollback cannot drop preflight.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status (done / blocked); files touched (absolute paths); validation results (each
command pass/fail); review verdicts (privacy-security-review, qa-checklist, each no-BLOCKING or the
findings); any deferrals; and a one-line handoff to "Phase 9 QA".

STOPPING RULES
- STOP if any parity fixture diffs old-vs-new without a matching entry on the documented
  knownDeviation list.
- STOP if any change would alter the WS wire protocol or the /ws upgrade handling.
- STOP if the createServer prefix order or the non-awaited void semantics of the /api call site
  cannot be preserved identically (the parity harness must prove it).
- STOP if the registry-completeness gate finds any old-ladder path served by neither the router nor
  the delegate (a dropped route is a prod 404).
- STOP if CORS or preflight would differ old-vs-new for any route, or if the CORS application surface
  would change.
- STOP if the dispatcher could emit more than one response on any path (the Phase 5 exactly-one
  wrapper must hold).
- STOP if determinism or sim-purity would be violated (this is server-only and must not touch
  src/sim/; the parity harness must use the injected now() clock so it stays deterministic).
````
