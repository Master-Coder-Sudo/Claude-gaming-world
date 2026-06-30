# Phase 2: Shared test scaffolding harness (the phase the SPEC is missing)

This phase builds the net-new test infrastructure that the entire migration safety net depends
on, while the request spine is still un-ported. The original SPEC has no phase for it: it assumes
a faithful fake req/res/Ctx, an injectable limiter clock, FakeDb interfaces, a golden-master
normalizer, a per-pass-isolated parity driver, registry-introspection helpers, and a pure
`loadConfig(env)` all already exist. None do. Without them every later parity assertion would be
asserting a fiction (the current ad-hoc `makeRes()` copies model only `writeHead`+`end`, the
limiter hardcodes `Date.now()`, and the pg-mock routes by `sql.includes()` and mis-routes
silently). This phase also FREEZES the `RouteDef` metadata (the `requireOwned*` marker and the
per-surface envelope kind) and the `Ctx` shape, because those decisions shape every primitive and
migration phase that follows.

It is medium context risk and stays under 40% because every deliverable is either a small
type-only contract freeze, a behavior-preserving one-file clock seam, or a self-contained test
helper with its own unit test. Nothing here ports a route or reads the full 1695-line `main.ts`:
the Explore agent summarizes a handful of anchor symbols so no implementation agent loads the
monolith.

### Starter Prompt

````
This is Phase 2 of the API Pipeline re-architecture: Shared test scaffolding harness (the phase
the SPEC is missing).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: this phase is NOT a large content/test sweep; it is four tightly coupled vertical
slices that share one frozen type contract. Hand-spawn parallel Agents, do NOT orchestrate via a
Workflow.
Goal: ship the net-new, self-tested harness (faithful fake-http/fakeCtx, an injected limiter
clock, FakeRateLimitStore, FakeDb interfaces, a golden-master generator plus a tested normalizer,
a per-pass-isolated parity driver, registry-introspection helpers, and a pure loadConfig(env)) and
freeze the RouteDef + Ctx + RateLimitStore type contracts, with zero runtime behavior change.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with other sessions; if it is dirty with files you do
  not own, STOP and ask before staging anything. You commit only with EXPLICIT paths, never
  `git add -A`.
- Confirm you are stacked on top of the Phase 1 PR (the importable spine): the parity driver will
  eventually drive Phase 1's pure prefix dispatcher, and this phase delivers as its own green PR
  on top of it.
- Scan Claude Code memory for entries in this phase's domain. Suggested topics to look up:
  "Workflow-agent cwd/worktree gotcha" (pass ABSOLUTE paths to subagents), "Shared-worktree commit
  care", "server API pipeline audit / canonical", and "DISCORD_SCHEMA unwired" (the precedent that
  a defined-but-unwired schema boots silently; relevant context for why the store interface and
  its eventual wiring are kept honest, even though no DDL lands here).

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or main.ts directly; spawn ONE Explore agent)
Tell the Explore agent to read and summarize, anchored on SYMBOL NAMES and route strings (never
line numbers; main.ts is ~1695 lines and every SPEC line anchor is stale):
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (current packet state, what Phase 1
  shipped, the locked decisions this phase must not contradict).
- docs/api-pipeline/phase-02-test-harness.md (this file: the deliverables, invariants, out-of-
  scope, and acceptance criteria).
- server/ratelimit.ts: the exact signatures of `rateLimited`, `recordSlidingWindowAttempt`,
  `authThrottled`, `recordAuthFailure`, `requestIp`, `normalizeIp`, the per-surface wrappers
  (`cardUploadRateLimited`, `walletLinkRateLimited`, `discordRateLimited`, `wocBalanceRateLimited`,
  `publicReadRateLimited`), and `resetRateLimits` plus the per-surface reset helpers. Report EVERY
  hardcoded `Date.now()` call site (rateLimited, recordSlidingWindowAttempt, authThrottled,
  recordAuthFailure) so the clock seam threads through all of them, and the named maxPerMinute
  constants.
- server/social.ts (the `SocialDb` interface) and server/social_db.ts (`PgSocialDb implements
  SocialDb`): the injected-interface idiom to MIRROR for FakeDb (interface in a module, a Pg impl
  that satisfies it, tests pass a fake).
- server/db.ts: the query-function signatures the new domains call, so the Db interfaces can be
  extracted faithfully: for leaderboard (`topLifetimeXp`, `topArenaRatings`, `topGuilds`), for
  characters (the character CRUD/standing/sheet reads and writes), for reports (the report insert
  paths). Return the exact parameter and return types.
- server/main.ts: the Phase-1 importable surface (the exported `startServer` and the pure
  createServer prefix dispatcher) and the `handleApi` entry, plus the scattered `process.env.*`
  reads (PORT, TURNSTILE_SECRET, ALLOW_DEV_COMMANDS, GITHUB_*, the dispatch flag if Phase 1 added
  one) so loadConfig's initial scope is grounded. Symbol anchors only.
- server/bug_report_db.ts and server/discord_db.ts: the `*_SCHEMA` + query-module pattern the
  eventual ratelimit_db.ts (Phase 19) will mirror; report the precedent that DISCORD_SCHEMA was
  defined and only later wired into ensureSchema (informs the store-interface design, but NO DDL
  lands in this phase).
- tests/woc_balance.test.ts, tests/wallet_server.test.ts, tests/discord_server.test.ts: the ad-hoc
  `makeRes()` / `makeReq()` copies. Return the UNION of methods/properties they touch so the new
  faithful fake-http is a strict SUPERSET (these only model writeHead+end today).
- server/CLAUDE.md and root CLAUDE.md (server conventions, module-first, the IWorld/sim invariants
  this server-only phase must not violate).
- Whatever Phase 1 created under server/http/ or as server/ws_auth.ts (the importable spine
  barrel, the pure prefix dispatcher signature) that this phase's harness consumes; confirm there
  is NO existing tests/server/ directory and NO router/compose/context/schema/errors RUNTIME yet
  (those are Phases 4 to 7).
What the Explore agent returns: a tight, symbol-anchored brief covering (a) every ratelimit.ts
signature and Date.now site to thread the clock through, (b) the SocialDb/PgSocialDb conformance
idiom to copy, (c) the db.ts query signatures for characters/leaderboard/reports, (d) the Phase-1
importable-spine surface the parity driver will drive, (e) the ad-hoc makeRes/makeReq feature set
to model as a superset, (f) the process.env reads to scope loadConfig, and (g) confirmation that
no tests/server/ and no spine runtime beyond Phase 1 exist. Give EVERY subagent ABSOLUTE paths.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
First, YOU (the lead) write the single shared contract so every agent codes against the same
types: create server/http/types.ts (TYPE-ONLY, zero runtime emit) freezing:
- `Method`, `Surface`, and `EnvelopeKind` = 'problem+json' | 'oauth' | 'admin' | 'html' |
  'redirect' | 'binary' | 'legacy405' (the seven per-surface envelopes from the canonical: /api
  problem+json, /oauth RFC 6749, /admin {success,data,error}, HTML htmlError page, Discord 302
  redirect, card binary, the legacy {ok:false} 405).
- `RouteMeta`: an optional `requireOwned` marker carrying both the resource kind AND an
  `ownerScope: 'account' | 'operator'` (so the BOLA coverage helper can EXCLUDE operator-scoped
  admin :id routes from the account-owner clause), plus optional `deprecated`/`sunset` fields
  (frozen now, unused until the deferred conventions land).
- `RouteDef`: method, path, middleware, schema, params, query, handler, meta. Handler stays
  req/res-free (takes a Ctx) so the same core serves REST and WS and is unit-testable.
- `Ctx`: the shape Phase 5's buildContext will produce (url, query, params, ip, reqId, body?,
  account?, plus the res/req refs and a per-request state bag).
- `Middleware`/`Next` signatures and the tier-2 `RateLimitStore` interface (clock-parameterized,
  the {remaining, resetSeconds} shape the eventual pg store and the fake both speak).
State in the doc-handoff that Phases 4 to 9 IMPORT these types and never redefine them.

Then fan out THREE parallel Agents, each owning a complete vertical slice (behavior + its tests),
each given ONLY the Explore brief plus the frozen server/http/types.ts signatures:

- Agent A (clock seam + FakeRateLimitStore):
  - Thread an injectable `now()` clock (default `Date.now`) through server/ratelimit.ts at every
    reported Date.now site (rateLimited, recordSlidingWindowAttempt, authThrottled,
    recordAuthFailure and the per-surface wrappers). Behavior-preserving: the default keeps every
    existing caller and suite green. DO NOT change any limiter's return shape (boolean stays
    boolean; the {remaining, resetSeconds} rework is Phase 19).
  - A deterministic test driving the injected clock across a window boundary (window roll, count
    reset, the values a future Retry-After will derive from).
  - tests/server/helpers/fake_ratelimit_store.ts: an in-memory FakeRateLimitStore implementing the
    RateLimitStore interface using the injected clock; self-test covers window rollover and the
    resetSeconds math. (Phase 19's PgRateLimitStore implements the SAME interface.)

- Agent B (faithful fake-http + fakeCtx):
  - tests/server/helpers/fake_http.ts: a FakeRes modeling the full superset the Explore brief
    found plus what compose needs: setHeader/getHeader/getHeaders/removeHeader, headersSent,
    writableEnded, writeHead (MERGING any already-set headers), write, end (idempotent/guarded),
    capturing status + final headers + body. A makeReq builder (method, url, headers, body).
  - tests/server/helpers/fake_ctx.ts: fakeCtx(overrides) returning a Ctx-shaped object (per the
    frozen Ctx type), written so Phase 5 can re-point it at the real buildContext with no test
    churn. Self-tests: incremental setHeader then writeHead merges; headersSent flips after
    writeHead; a second end (and a double-next) is rejected.

- Agent C (FakeDb interfaces + pure loadConfig):
  - tests/server/helpers/fake_db.ts: `CharactersDb`, `LeaderboardDb`, `ReportsDb` interfaces
    extracted from the real db.ts query signatures (SocialDb-style), plus in-memory fakes. Add a
    tsc-level conformance assertion (a `satisfies` check against the real db.ts query functions or
    a thin adapter) so interface drift FAILS the build. The migration phases (10/12/15) will
    promote each interface into its domain module and have handlers take the Db, not the pool;
    here the interface + fake are frozen so those phases drop straight in.
  - server/http/config.ts: a PURE `loadConfig(env: NodeJS.ProcessEnv): Config` returning a typed,
    Object.freeze-d Config, separate from the boot call site, scoped to what the harness needs now
    (the dispatch flag plus the few limiter/test-relevant values from the Explore brief). Self-
    test: a missing required value fails fast, defaults apply, the dispatch flag parses. DO NOT
    wire it into boot (Phase 24 consolidates every tunable and wires it).

After A/B/C land green, fan out ONE more Agent (it depends on the fakes + types being present):

- Agent D (golden-master + normalizer + parity driver + registry-introspection):
  - tests/server/helpers/normalizer.ts: a dynamic-field normalizer masking EXACTLY a named
    placeholder set (timestamps, ids, tokens, reqId/X-Request-Id, the Date response header, expiry
    seconds, nonces/csrf) and NOTHING else. Self-test proves a non-dynamic field that merely looks
    numeric is NOT masked, and that each masked field maps to a stable placeholder token. The
    placeholder set is load-bearing for Phase 3, so name it as an exported constant.
  - tests/server/helpers/golden.ts: a golden-master generator that captures a route's (status,
    headers, body) through the fake-http, runs the normalizer, and writes/compares a fixture file
    with NO manual-approve step (deterministic write then compare).
  - tests/server/helpers/parity.ts: a parity driver `runParity({ oldDispatch, newDispatch,
    fixtures, normalizer, reset })` that runs each fixture through BOTH dispatchers in-process with
    per-pass isolation (reset limiter Maps via resetRateLimits + the per-surface resets + the clock
    reset, plus an injected `reset` hook for the fresh-ALS-run and reloaded-config steps Phase 5/9
    will supply). It diffs status/body/contracted-headers and weights error and 404-vs-405 paths
    heaviest. Both dispatchers are INJECTED params (the real new dispatcher does not exist until
    Phase 9): self-test against two trivial fake dispatchers, one identical (passes) and one
    intentionally divergent (fails), plus a test proving isolation stops a limiter that tripped on
    pass 1 from bleeding into pass 2.
  - tests/server/helpers/registry_introspect.ts: helpers that take a `RouteDef[]` and assert route
    completeness (method+path+handler present) and the :id-route requireOwned* presence rule (every
    account-owned :id route carries a requireOwned loader with ownerScope 'account'; operator-scoped
    admin :id routes are EXCLUDED). Self-test with a compliant fixture and a non-compliant one
    (missing loader) proving it fails. Phases 9/12/17 feed the real registry in.
Also create tests/server/ and tests/server/helpers/ and a small index/barrel; standardize the
tests/server/<domain>.test.ts naming for the migration phases (do NOT convert existing suites; see
OUT OF SCOPE).

If context approaches 40%: Phase 2 has NO documented a/b split. Commit the slices that are already
green (each commit green) and resume the rest IN THE SAME PR; do not split into two PRs.

INVARIANTS THIS PHASE MUST KEEP
- Determinism is the whole point of the clock seam: server-side `now()` injected with a `Date.now`
  default so limiter windows/Retry-After are deterministic in tests. This is SERVER-ONLY; do NOT
  touch src/sim/ (sim randomness still goes only through Rng; src/sim purity guarded by
  tests/architecture.test.ts). No `Math.random`/`Date.now`/`performance.now` is added to sim.
- Behavior-preserving: the clock default, the type-only contracts, and the test-only helpers add
  ZERO runtime behavior change. No limiter return shape changes (that is Phase 19). No WS wire or
  snapshot change.
- Single-flag dispatch + catch-all delegate model: this phase FREEZES the RouteDef metadata
  (requireOwned*, ownerScope, per-surface EnvelopeKind) and the Ctx shape the dispatch model and
  every later phase depend on; loadConfig parses the dispatch flag (but does not wire it).
- Stable-code i18n: NO player-visible strings or error codes are added here (test infrastructure).
  Do not introduce any English server-facing user string. The frozen EnvelopeKind is the seam the
  codes will serialize through later (Phase 7/22), not a code source itself.
- Persistence: NO DDL, NO change to ensureSchema. The FakeDb fakes are in-memory; RATELIMIT_SCHEMA
  and ratelimit_db.ts are Phase 19. The RateLimitStore interface is type-only.
- No magic values: loadConfig reads env once into named, frozen config; the normalizer placeholder
  tokens and any limiter constants are NAMED, single-source.
- Module-first: contracts in server/http/types.ts and server/http/config.ts; helpers in
  tests/server/helpers/. NEVER grow main.ts. No em dashes, en dashes, or emojis anywhere.

OUT OF SCOPE (do not do these here; they are later phases)
- The router/compose/context/schema/errors RUNTIME (Phases 4 to 7): this phase freezes only the
  TYPE contracts, not buildContext, compose, the validator, or mapError.
- The registry and the new dispatcher wiring (Phase 9): the parity driver and registry-introspect
  helpers ship PARAMETERIZED; no real registry is assembled.
- The characterization corpus / actual fixtures (Phase 3): ship the generator + normalizer + their
  self-tests, NOT the route fixtures.
- The {remaining, resetSeconds} limiter return-shape rework, ratelimit_db.ts, and RATELIMIT_SCHEMA
  wiring (Phase 19): only inject the clock and define the store interface + fake.
- Wiring loadConfig into boot and the full no-magic-values consolidation (Phase 24).
- Converting the existing ad-hoc makeRes/makeReq suites (woc_balance/wallet_server/discord_server)
  to the shared fake-http: leave them; the migration phases re-home their domain tests.
- Any handler refactor to take a Db param (Phases 10/12/15), BOLA loader runtime, security
  headers, the REST i18n matcher.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Validation (this is a spine/primitive + baseline code change, server-only, no DDL):
- `npx tsc --noEmit` (the type-only contracts, the FakeDb `satisfies` conformance, and Infer-free
  helper types must all check).
- `npx vitest run tests/server/http` and `npx vitest run tests/server/helpers` (the new harness
  self-tests).
- Behavior-preservation proof for the clock seam: `npx vitest run tests/woc_balance.test.ts
  tests/wallet_server.test.ts tests/discord_server.test.ts` plus any auth-throttle suite the
  Explore brief named; all must pass UNCHANGED.
- `npm run ci:changed` (Biome on changed files only; never a whole-tree --write; scoped
  `npx @biomejs/biome check --write <file>` only on files you changed).
- `npm run build:server` (the server still bundles with the new type-only modules and the clock
  seam).
- PR pre-merge gate (mirror CI): `npm test && npx tsc --noEmit && npm run build:env && npm run
  build:server && npm run build`.
Review dispatch (run `git diff --name-only` first; spawn ONLY the surfaces this diff touches):
- privacy-security-review: REQUIRED (server/ touched: the limiter clock seam and loadConfig's env
  parsing are security-adjacent; confirm the clock seam cannot weaken a limiter and loadConfig does
  not log or leak secrets).
- qa-checklist: REQUIRED at phase completion.
- migration-safety: NOT dispatched (no DDL, no JSONB, no ensureSchema change; ratelimit.ts is not
  persistence).
- cross-platform-sync: NOT dispatched (no IWorld/src/sim/wire/sim_i18n|server_i18n/RL change).
- architecture-reviewer: NOT dispatched (no src/sim change).
Prompt each reviewer for COVERAGE (report every correctness or requirement gap with confidence and
severity), not filtering. If a reviewer's output is truncated, tell it: "resume from where you
were truncated and continue; do not restart." Do NOT commit the PR as ready until every dispatched
reviewer reports no BLOCKING finding.

STEP 4 - COMMIT CADENCE (Conventional Commits, a scope, EXPLICIT paths; stacked PR chain)
This phase ships as its OWN green, bisectable PR on top of the Phase 1 PR. Suggested commits:
1. `feat(http): freeze RouteDef, Ctx and RateLimitStore contracts` -- paths: server/http/types.ts
2. `feat(ratelimit): inject now() clock seam (default Date.now)` -- paths: server/ratelimit.ts
3. `feat(http): pure loadConfig(env)` -- paths: server/http/config.ts, tests/server/http/config.test.ts
4. `test(server): faithful fake-http, fakeCtx, FakeDb, FakeRateLimitStore harness` -- paths:
   tests/server/helpers/fake_http.ts, fake_ctx.ts, fake_db.ts, fake_ratelimit_store.ts and their
   *.test.ts files
5. `test(server): golden generator, normalizer, parity driver, registry-introspect helpers` --
   paths: tests/server/helpers/golden.ts, normalizer.ts, parity.ts, registry_introspect.ts and
   their *.test.ts files
Keep every commit green. Stage with explicit paths, never `git add -A` (shared worktree).

STEP 5 - ACCEPTANCE CRITERIA (verifiable; tick each)
- [ ] server/http/types.ts is TYPE-ONLY (zero runtime emit) and exports RouteDef (with the
  requireOwned* marker carrying ownerScope 'account'|'operator', the seven-value EnvelopeKind, and
  deprecated/sunset), Ctx, Method, Surface, Middleware/Next, and the RateLimitStore interface.
- [ ] server/ratelimit.ts threads an injectable now() defaulting to Date.now through every former
  Date.now site; no limiter return shape changed; the three named existing suites pass UNCHANGED;
  a new test drives the clock across a window boundary deterministically.
- [ ] tests/server/helpers/fake_http.ts FakeRes models setHeader/getHeader/getHeaders/removeHeader/
  headersSent/writableEnded/writeHead-merge/write/end; a self-test proves incremental-header merge,
  the headersSent flip, and double-end/double-next rejection.
- [ ] fakeCtx(overrides) returns a Ctx-shaped object refactor-ready for Phase 5 buildContext.
- [ ] FakeRateLimitStore implements RateLimitStore on the injected clock; self-test covers window
  rollover and resetSeconds.
- [ ] CharactersDb/LeaderboardDb/ReportsDb interfaces + in-memory fakes exist; a tsc `satisfies`
  conformance check against the real db.ts query functions fails the build on drift.
- [ ] The normalizer masks EXACTLY the named placeholder set (timestamps, ids, tokens,
  reqId/X-Request-Id, Date header, expiry seconds, nonce) and a self-test proves a look-alike
  numeric non-dynamic field is NOT masked; no manual-approve step.
- [ ] The parity driver runs a fixture through two injected dispatchers with per-pass isolation; a
  self-test proves it detects a divergence and that isolation prevents pass-2 limiter bleed.
- [ ] The registry-introspection helpers take RouteDef[] and assert completeness + :id
  requireOwned* presence (operator routes excluded), proven against a compliant and a
  non-compliant fixture.
- [ ] loadConfig(env) is pure and frozen; self-test: missing-required fails fast, defaults apply,
  dispatch flag parses; it is NOT wired into boot.
- [ ] tests/server/ and tests/server/helpers/ exist; no existing suite was converted; full
  `npm test`, `npx tsc --noEmit`, and `npm run build:server` are green; NO DDL, NO ensureSchema
  change, NO WS wire change, NO src/sim touch.

STEP 6 - DOC UPDATES + MEMORY
- docs/api-pipeline/progress.md: mark Phase 2 done; list the new modules (server/http/types.ts,
  server/http/config.ts, the server/ratelimit.ts clock seam, and tests/server/helpers/{fake_http,
  fake_ctx, fake_db, fake_ratelimit_store, golden, normalizer, parity, registry_introspect}.ts).
- docs/api-pipeline/state.md: record the FROZEN contracts so later phases import them verbatim: the
  RouteDef metadata shape (requireOwned* + ownerScope), the seven-value EnvelopeKind, the Ctx
  fields, the RateLimitStore interface, the loadConfig signature, and the normalizer placeholder
  set (load-bearing for Phase 3).
- Memory: record the surprising rules for the next session: the harness driver and registry-
  introspect helpers are PARAMETERIZED because the real router/registry/new-dispatcher do not exist
  until Phases 4/5/9; the clock injection MUST stay behavior-preserving (no return-shape change
  until Phase 19); server/http/types.ts is the SINGLE home of RouteDef/Ctx (later phases import,
  never redefine); the normalizer placeholder set is load-bearing for the Phase 3 corpus.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status (done / blocked); files touched (absolute paths); validation results (tsc,
the harness self-tests, the three behavior-preservation suites, ci:changed, build:server, the PR
gate); review verdicts per dispatched reviewer (privacy-security-review, qa-checklist) with any
BLOCKING/SHOULD-FIX counts; deferrals (the Phase 19 store rework, Phase 3 corpus, Phase 9 registry
wiring, Phase 24 boot wiring); and a one-line handoff to "Phase 2 QA" (docs/api-pipeline/
phase-02-qa.md).

STOPPING RULES
- STOP if injecting the clock would CHANGE any limiter's return shape (boolean to object): that is
  Phase 19; keep Phase 2 behavior-preserving with the Date.now default.
- STOP if any existing ratelimit, auth-throttle, wallet, woc, or discord suite regresses (the clock
  seam must be a no-op by default).
- STOP if a deliverable would require the router/registry/compose/validator RUNTIME to exist (it
  does not until Phases 4/5/6/9): keep the parity driver and registry-introspect helpers
  parameterized.
- STOP and surface it if any change would alter the WS wire protocol or a snapshot shape.
- STOP if any change would touch src/sim/ (determinism or sim-purity) or add `Math.random`/
  `Date.now`/`performance.now` to sim code.
- STOP if Phase 2 would add DDL or change ensureSchema (RATELIMIT_SCHEMA is Phase 19).
````
