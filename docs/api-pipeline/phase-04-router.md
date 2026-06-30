# Phase 4: Table router (server/http/router.ts)

Phase 4 builds the in-house request router: a `Map<method, {static, dynamic}>` table that
turns a (method, path) pair into either a matched route plus captured params, a 405 with an
Allow set, a synthesized OPTIONS allow set, or a 404. It is a PURE match function. It writes
no responses, touches no req/res, parses no body, runs no middleware, and chooses no error
envelope: it returns a small discriminated `MatchResult` that the dispatcher (Phase 9)
consumes. That tight boundary, one self-contained primitive plus a pure path-pattern helper
and their unit tests, is why this phase is low context risk and stays well under 40 percent:
there is no domain logic, no DB, no auth, and no wire surface to load.

The router only needs Phases 1 to 3 (importable spine, the `tests/server/` harness, the route
inventory and content-type classification). It consumes nothing from the not-yet-built compose,
context, schema, or error modules, and it is not wired into the live server until Phase 9.

````
### Starter Prompt

This is Phase 4 of the API Pipeline re-architecture: Table router (server/http/router.ts).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: NOT needed. This is one small primitive plus a pure helper and their unit tests
(low context risk). Hand-spawn the two parallel agents in STEP 2; do not orchestrate a Workflow.
Goal: implement an in-house static-Map + dynamic ":param" table router that returns a pure
MatchResult (matched+params / 405+Allow / synthesized OPTIONS / 404), with HEAD-for-GET,
single-trailing-slash normalization, and a build-time no-regex-routing guard, with no middleware
and no handlers.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with other sessions; if it is dirty with files you do
  not own, STOP and ask before staging anything. You will commit only with EXPLICIT paths, never
  `git add -A`.
- Scan Claude Code memory for entries in this phase's domain. Suggested topics to look up:
  "API pipeline router / server/http spine", "server-api-pipeline-audit", "no-regex routing /
  admin enum routes (suspend|unsuspend|ban|unban)", "shared-worktree commit care". Note anything
  that changes the plan below.

STEP 1 - LOAD CONTEXT (do NOT read the planning docs yourself; spawn ONE Explore agent)
Spawn a single Explore agent and have it summarize, anchored on SYMBOL NAMES and route strings
(main.ts is ~1695 lines; never cite line numbers):
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (the live phase ledger).
- docs/api-pipeline/phase-04-router.md (this file) and, for boundary only, the headers of
  phase-05-onion-context.md and phase-09-registry-parity.md so you do not build their surface.
- Whatever Phase 2 / Phase 3 produced for shared route types: the `RouteDef` shape and any
  `HttpMethod` type, and WHERE they live (a shared types module, registry.ts, or index.ts). The
  router must import an existing `HttpMethod`/route type if one exists; report the exact path and
  shape. If none exists yet, say so (the router will define a minimal local `HttpMethod` +
  `RoutePattern` to be reconciled by the Phase 9 registry).
- The Phase 2 test harness conventions: the `tests/server/` directory layout and where
  `tests/server/http/` tests should live; the fake-http / fakeCtx helpers (NOTE: the router needs
  none of them, it is pure, but tests follow the directory convention).
- The Phase 3 surface inventory: the full set of (method, path) pairs the router must eventually
  serve, focusing on (a) paths registered under MORE THAN ONE method (e.g. `/api/characters/:id`
  GET+DELETE, `/api/discord` GET+DELETE, `/api/wallet/link` POST+DELETE) for the OPTIONS/405 Allow
  tests, and (b) any path the classification marked as a regex/enum segment (the admin
  `suspend|unsuspend|ban|unban` routes) that the no-regex guard must REJECT.
- server/main.ts: the `createServer` prefix dispatcher and `handleApi`, only to confirm the
  current method semantics (which paths answer HEAD/OPTIONS today, current trailing-slash
  behavior). Anchor on the symbol names, not line numbers.
- server/CLAUDE.md (module-first + server conventions) and root CLAUDE.md (invariants).
- Confirm: the `server/http/index.ts` barrel and `registry.ts` are owned by Phase 9. Do NOT edit
  them this phase; the router and its test import the router module directly.
The Explore agent returns: the import path + shape of any existing `HttpMethod`/route type; the
multi-method path list and the regex/enum paths to reject; the test directory convention; and a
yes/no on whether index.ts/registry.ts already exist (so you avoid touching them).

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Hand-spawn TWO parallel agents. To keep them truly parallel and conflict-free, they own DIFFERENT
files and code to a SHARED INTERFACE CONTRACT (below) that you give to both in the Explore
summary. This is the module-first split: the pure path-pattern logic (compile + guard +
normalize + segment match) is a host-agnostic helper a Vitest imports directly, and the router is
its thin consumer.

SHARED CONTRACT (paste into both agents' briefs verbatim):
```ts
// server/http/path_pattern.ts (pure; no req/res, no Node http, no src/sim/render/ui/game/net)
export type HttpMethod =
  | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type PatternSegment =
  | { kind: 'literal'; value: string }
  | { kind: 'param'; name: string };
export interface CompiledPattern {
  raw: string;
  segments: PatternSegment[];
  isStatic: boolean;        // true when no param segments
  paramNames: string[];
}
// Build-time guard + compile. THROWS on anything that is not a literal segment
// or a plain ":name" param: regex, "*", "(a|b)" groups, empty ":", a malformed
// param name, or a duplicate param name. This is the no-regex-routing guard.
export function compilePattern(path: string): CompiledPattern;
// Strip exactly ONE trailing slash unless the path is root "/". Does NOT collapse
// internal slashes, decode percent-encoding, or resolve "..".
export function normalizePath(path: string): string;
// Match a normalized request path against a compiled pattern. Returns captured
// params (possibly empty) or null on no match. NO per-request RegExp.
export function matchPattern(p: CompiledPattern, path: string): Record<string, string> | null;

// server/http/router.ts (pure; consumes path_pattern.ts only)
export interface RoutePattern { method: HttpMethod; path: string }
export type MatchResult<R> =
  | { kind: 'matched'; route: R; params: Record<string, string>; head: boolean }
  | { kind: 'methodNotAllowed'; allow: HttpMethod[] }
  | { kind: 'options'; allow: HttpMethod[] } // dispatcher serves 204 + Allow + Vary: Origin
  | { kind: 'notFound' };
export interface Router<R extends RoutePattern> {
  match(method: string, path: string): MatchResult<R>;
}
export function createRouter<R extends RoutePattern>(routes: R[]): Router<R>;
```
If the Explore agent found an existing `HttpMethod` or route type from Phase 2/3, IMPORT it
instead of re-declaring; do not create a second source of truth.

Agent A - pure path-pattern helper. Deliverables:
- `server/http/path_pattern.ts` implementing `compilePattern`, `normalizePath`, `matchPattern`,
  and the `HttpMethod` / `PatternSegment` / `CompiledPattern` types per the contract.
- `compilePattern` splits on "/", classifies each non-empty segment as a literal or a single
  `:name` param (name matches `[A-Za-z_][A-Za-z0-9_]*`), and THROWS a clear Error on any regex
  metacharacter, `*`, `(`/`)`/`|` group, a bare `:`, a `:` not at the start of a segment, or a
  duplicate param name. No `new RegExp` anywhere.
- `normalizePath` strips one trailing slash (root "/" preserved); leaves internal slashes,
  percent-encoding, and ".." untouched.
- `matchPattern` compares segment counts then segment-by-segment with literal equality and param
  capture, returning the param map or null; NO RegExp at match time.
- `tests/server/http/path_pattern.test.ts`: literal compile, param compile + capture, the guard
  REJECTING `/a/(b|c)`, `/a/*`, `/a/:`, `/a/:1bad`, `/^x$/`, and duplicate `:id/:id`; trailing
  slash normalize incl. root; mismatch on segment-count; param name extraction order.

Agent B - the router table + match. Deliverables:
- `server/http/router.ts` implementing `createRouter` and `Router`/`MatchResult` per the contract,
  importing `compilePattern`/`normalizePath`/`matchPattern`/`HttpMethod` from path_pattern.ts.
- Build a `Map<HttpMethod, { static: Map<string, R>; dynamic: { pattern: CompiledPattern; route: R }[] }>`:
  static (no-param) paths in the inner Map for O(1) exact lookup; param paths in `dynamic` in
  registration order. THROW on a duplicate (method, path) registration at build time.
- `match(method, path)`: normalize the path first; treat `HEAD` as `GET` for lookup and set
  `head: true` on the result; static lookup before dynamic (a literal segment beats a `:param` at
  the same position); `OPTIONS` synthesizes `{ kind: 'options', allow }` from the real method set
  for that path (404 if the path matches no method); a known path under a wrong method returns
  `{ kind: 'methodNotAllowed', allow }`; otherwise `{ kind: 'notFound' }`.
- The Allow set is the canonical computed list of methods that match the path, ALWAYS including
  synthesized `OPTIONS`, and `HEAD` whenever `GET` is registered. Sorted deterministically.
- `tests/server/http/router.test.ts`: exact + param match with captured params; static beats
  dynamic; HEAD on a GET route matches with `head: true`; wrong method -> 405 with the full Allow
  list (incl. HEAD+OPTIONS); OPTIONS on a known path -> options allow set, on an unknown path ->
  notFound; trailing-slash request matches the slashless route; duplicate-registration throw; the
  match path uses NO `new RegExp` (assert structurally or by inspection in a comment + test that
  param capture works with regex-special characters as literal path values, e.g. an id like
  `a.b+c`).

INVARIANTS THIS PHASE MUST KEEP
- Server-only purity: router.ts and path_pattern.ts import NOTHING from `src/sim/`, `render/`,
  `ui/`, `game/`, or `net/`, and touch no DOM/Three. No req/res, no `node:http`. (Determinism is
  not directly in play, but do not touch `src/sim/`; this packet is server-only.)
- The router is PURE: it returns a `MatchResult` and never writes a header, sends a response, or
  chooses an error envelope. The 405/404/OPTIONS WRITES belong to the Phase 9 dispatcher and the
  Phase 7 error model.
- No magic values: the HTTP method set, the param-name rule, and the Allow-synthesis rule are
  named types/constants, not scattered string literals.
- Stable-code i18n: the router emits NO player-visible string (no English text at all). It returns
  status-class descriptors; the localized 404/405 bodies are produced later by the error model.
- Single-flag dispatch + catch-all delegate model: the router is DISPATCH-AGNOSTIC. It is the
  match primitive the Phase 9 dispatcher places ahead of the old `handleApi`; keep it free of any
  delegate/flag logic.
- No em dashes, en dashes, or emojis anywhere (code, comments, tests, commits, docs).
- Conventional Commits with a scope; EXPLICIT paths; shared-worktree care.

OUT OF SCOPE (do not build these here; later phases own them)
- Any middleware, the Koa-compose onion, or the request context / Ctx (Phase 5).
- Query, body, or URL parsing; percent-decoding; ".." resolution. The router receives an already
  clean pathname from the dispatcher (Phase 5 context owns URL parsing). If you find the router
  would need to decode or resolve "..", STOP and flag it to Phase 5; do not add it here.
- Schema validation (Phase 6).
- The error model, mapError, problem+json / RFC 6749 / {success,data,error} envelopes, status-body
  text, and WWW-Authenticate (Phase 7). The router returns descriptors, not responses.
- registry.ts assembly, the dispatcher-in-front, the per-path catch-all delegate, and the
  `server/http/index.ts` barrel (Phase 9). Do not edit index.ts/registry.ts.
- The actual CORS implementation and the `Vary: Origin` header WRITE (top-level wrapper, Phase 9 /
  Phase 21). This phase only SIGNALS, via the synthesized-OPTIONS contract, that the dispatcher
  must serve OPTIONS with Allow + Vary: Origin; the router writes nothing.
- The anti-enumeration 404-instead-of-405 knownDeviation on auth routes (Phase 9 applies it from
  an explicit list). The router default is an HONEST 405 + Allow; do not special-case auth paths.
- Rate limiting, auth, BOLA, security headers (Phases 8, 12, 19, 21). No real RouteDefs are wired
  in; tests use small synthetic route fixtures.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run the spine/primitive validation set:
- `npx tsc --noEmit`
- `npx vitest run tests/server/http/router.test.ts tests/server/http/path_pattern.test.ts`
- `npm run ci:changed` (Biome on changed files only; never a whole-tree --write; if you must
  format, `npx @biomejs/biome check --write server/http/router.ts server/http/path_pattern.ts
  tests/server/http/router.test.ts tests/server/http/path_pattern.test.ts`)
PR pre-merge gate (mirror CI before opening the PR):
- `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`

Then dispatch reviewers. Check `git diff --name-only` first; the diff touches only
server/http/router.ts, server/http/path_pattern.ts, and tests/server/http/*.test.ts. Per the
canonical Review dispatch rules, spawn ONLY:
- `privacy-security-review`: server/ is touched and this is the request-routing boundary. Prompt
  it for COVERAGE (not filtering): does `normalizePath` open a routing-bypass (mixed/encoded
  slashes, trailing-slash, or absent ".." handling letting `/api/x/../admin`-style input reach a
  different route than the dispatcher's auth gate expects); does the honest 405+Allow leak more
  than intended given the anti-enumeration deviation lands in Phase 9; is the no-regex guard
  ReDoS-safe by construction.
- `qa-checklist`: at phase completion.
- Plus a fresh COVERAGE subagent reviewing your own diff: its job is to report every correctness
  or requirement gap against this file's acceptance criteria with confidence + severity, NOT to
  filter.
Do NOT dispatch migration-safety (no DB/DDL/JSONB), cross-platform-sync (no sim/wire/matcher), or
architecture-reviewer (no src/sim) this phase.
Give every reviewer this truncation-resume line: "If your review is cut off, resume from the last
file and finding you completed and continue; do not restart." Do not commit until each reports no
BLOCKING finding.

STEP 4 - COMMIT CADENCE (stacked PR chain; this phase ships as its OWN green, bisectable PR)
Use Conventional Commits with a scope and EXPLICIT paths:
- `feat(http): add pure path-pattern compiler, no-regex guard, and matcher` -> server/http/path_pattern.ts
- `feat(http): add static-Map + dynamic table router with 404/405/Allow + HEAD/OPTIONS synthesis` -> server/http/router.ts
- `test(http): cover router match, params, 405+Allow, HEAD/OPTIONS, trailing-slash, no-regex guard` -> tests/server/http/router.test.ts tests/server/http/path_pattern.test.ts
- `docs(api-pipeline): record Phase 4 router contract in progress + state` -> docs/api-pipeline/progress.md docs/api-pipeline/state.md
Open the Phase 4 PR on its own branch atop the Phase 3 branch; keep the suite green at every commit.

STEP 5 - ACCEPTANCE CRITERIA (verifiable)
- [ ] `server/http/path_pattern.ts` exports `compilePattern`, `normalizePath`, `matchPattern`, and
      the `HttpMethod`/`PatternSegment`/`CompiledPattern` types.
- [ ] `compilePattern` THROWS on regex, `*`, `(a|b)` groups, a bare `:`, a malformed param name,
      and duplicate param names; accepts only literal segments and plain `:name`.
- [ ] `normalizePath` strips exactly one trailing slash, preserves root "/", and leaves internal
      slashes / percent-encoding / ".." untouched.
- [ ] `server/http/router.ts` exports `createRouter`, `Router`, `RoutePattern`, `MatchResult`.
- [ ] The table is `Map<method, {static: Map, dynamic[]}>`; static lookup is O(1) (no scan) and
      dynamic capture uses NO per-request `RegExp`.
- [ ] `match` returns matched (with params + `head`), methodNotAllowed (with a complete Allow
      list), options (synthesized allow set), or notFound, correctly.
- [ ] HEAD on a GET route matches the GET route with `head: true`.
- [ ] Wrong method on a known path returns 405 with an Allow list including synthesized HEAD (when
      GET present) and OPTIONS.
- [ ] OPTIONS on a known path synthesizes the allow set; OPTIONS on an unknown path returns
      notFound. The contract documents Vary: Origin on the served OPTIONS response (written in
      Phase 9, not here).
- [ ] A single-trailing-slash request matches the slashless route; root "/" is preserved.
- [ ] `createRouter` throws on a duplicate (method, path); a literal segment beats a `:param` at
      the same position.
- [ ] The router imports nothing from src/sim/render/ui/game/net, touches no req/res, writes no
      header, and sends no response.
- [ ] `npx tsc --noEmit` clean; the two http test files green; `npm run ci:changed` clean; no em
      dashes / en dashes / emojis in the diff.

STEP 6 - DOC UPDATES + MEMORY
- docs/api-pipeline/progress.md: mark Phase 4 done; name the new modules `server/http/path_pattern.ts`
  and `server/http/router.ts` plus their tests; state the public surface (`createRouter`, the
  `MatchResult` union, `compilePattern` guard).
- docs/api-pipeline/state.md: record the router contract for the consuming phases: `match()`
  returns descriptors not responses; HEAD maps to GET; OPTIONS is synthesized from the real method
  set and must be served with Allow + Vary: Origin by the dispatcher (Phase 9); single-trailing-
  slash normalization (convention H); the no-regex guard forces the admin enum routes
  (suspend|unsuspend|ban|unban) to restructure to `:param` + schema in Phase 17; the router does
  NOT decode percent-encoding or resolve "..", so the dispatcher must hand it a clean pathname
  (Phase 5).
- Memory: record the surprising rules: the router is a PURE match function (no req/res, no header
  writes); the no-regex guard is what forces Phase 17's enum routes to `:param`; path
  normalization deliberately omits "../percent-decode (Phase 5 owns URL parsing).

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status (done / blocked); files touched (absolute paths); validation results (tsc,
the two test files, ci:changed, and the PR pre-merge gate if run); review verdicts
(privacy-security-review, qa-checklist, the coverage subagent: BLOCKING/SHOULD-FIX/none);
deferrals; and a one-line handoff to "Phase 4 QA" (docs/api-pipeline/phase-04-qa.md).

STOPPING RULES
- STOP if the router would need to import or call any middleware, handler, context builder,
  schema, or error serializer (Phases 5 to 8). The router stays a pure match function.
- STOP if you find yourself making the router send a response, write a header, or touch req/res:
  it must return a MatchResult only.
- STOP and do NOT add regex/wildcard/enum-group support to the path patterns. If a real route
  cannot be expressed as literal segments + plain `:param` (the admin enum routes), the guard MUST
  reject it; restructuring those routes is Phase 17's job, not the router's.
- STOP if the router would need to decode percent-encoding or resolve ".." to route correctly:
  surface it to Phase 5 (URL parsing owner); do not add it here.
- STOP if any change would touch `src/sim/` (determinism / sim-purity) or alter the WS wire
  protocol (nothing in this phase should).
- STOP if a change would edit `server/http/index.ts` or `registry.ts` (owned by Phase 9).
````
