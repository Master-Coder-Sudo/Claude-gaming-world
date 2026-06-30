# Phase 5: Onion compose + request context (compose.ts + context.ts)

This is the third spine-primitive phase of the API Pipeline re-architecture. It builds two
small, pure, host-agnostic modules under `server/http/`: the Koa-style middleware runner
(`compose.ts`) and the request-context builder plus reqId carrier (`context.ts`). They are
co-located in one phase because each alone is trivial (compose is the ~15-line recursive
dispatch; the Ctx builder is a field-population function), and together they are the seam the
schema validator (Phase 6), error model (Phase 7), and middleware set (Phase 8) all consume.
Nothing is wired into the live server here: this phase produces primitives plus their unit
tests, so it stays well under the 40% context bound (context risk: low). The one load-bearing
subtlety is that `compose()` returns a promise and does NOT send a response or catch on its
own, so this phase also ships the outermost one-response wrapper that raw `node:http` requires.

### Starter Prompt

````
This is Phase 5 of the API Pipeline re-architecture: Onion compose + request context (compose.ts + context.ts).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: not needed. This is a small two-module primitive phase (no large content/test sweep). Hand-spawn 2 parallel agents.
Goal: ship server/http/compose.ts (the recursive middleware onion runner with a double-next guard and the outermost exactly-one-response wrapper) and server/http/context.ts (the Ctx type, buildContext, the client-IP helper reuse, and the reqId AsyncLocalStorage carrier), plus their unit tests, with NOTHING wired into the live server.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED across concurrent sessions: if it is dirty with files you do not own, STOP and ask before staging anything. You will commit with EXPLICIT paths only, never `git add -A`.
- Scan Claude Code memory for entries in this phase's domain. Suggested topics to look up: the API pipeline canonical decisions, the Phase 4 table router primitive, the Phase 2 test scaffolding (fake-http helper + fakeCtx + now() clock), and any note on the compose/onion one-response wrapper or AsyncLocalStorage reqId.

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly; spawn ONE Explore agent)
Tell the Explore agent to summarize, anchored on SYMBOL NAMES and route strings (never line numbers; main.ts is ~1695 lines):
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (current packet state: what Phases 1 to 4 delivered and what symbols already exist under server/http/).
- docs/api-pipeline/phase-05-onion-context.md (this file: scope, invariants, out-of-scope, acceptance criteria).
- server/http/router.ts (Phase 4 output): the route-match RESULT type and the Route/RouteDef shape, specifically what the matcher returns for params and the matched path template, since buildContext consumes that match result.
- The Phase 2 test scaffolding under tests/server/: the faithful fake-http helper module (setHeader/getHeader/removeHeader/headersSent/writeHead-merge/end) and the `fakeCtx(overrides)` helper, plus the current Ctx-stub shape it returns and the injected `now()` clock seam. Name the actual files and their exported helper names.
- server/CLAUDE.md (local conventions) and root CLAUDE.md (module-first doctrine + the invariants).
- The existing server client-IP helper: find the function the live server already uses to derive a client IP from a request (look in server/http_util.ts or the equivalent util module, and how the createServer callback derives it). Return its name, signature, and module so buildContext REUSES it rather than re-deriving IP.
- The live request entry in server/main.ts (the createServer callback and handleApi), ONLY to confirm the raw node:http response idioms in use today (writeHead, setHeader, end, res.headersSent, res.writableEnded) so the one-response wrapper models them faithfully.
Have the Explore agent RETURN: (a) the exact router match-result type and field names; (b) the existing client-IP helper name + signature + module; (c) the Phase 2 fake-http + fakeCtx API surface and the current Ctx-stub field list; (d) the raw response idioms used today; (e) confirmation that server/http/index.ts (the barrel) does NOT exist yet (it is Phase 9); (f) a PROPOSED locked interface to share between the two agents: the final Ctx field list and the reqId-ALS export names. Do NOT have it dump planning-doc prose.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
LOCK THE SHARED INTERFACE FIRST (contract-first parallelism): from the Explore summary, freeze before fan-out (1) the `Ctx` field list and (2) the reqId-ALS export names, so both agents compile against identical names. Suggested surface (adjust to the Explore findings, keep names stable once locked):
- compose.ts: `export type Next = () => Promise<void>`; `export type Middleware = (ctx: Ctx, next: Next) => Promise<void> | void`; `export function compose(stack: Middleware[]): (ctx: Ctx, next?: Next) => Promise<void>`; `export async function runOnion(ctx: Ctx, stack: Middleware[]): Promise<void>` (the outermost wrapper); `export function respondOnce(res, status, headers?, body?): boolean` (idempotent low-level sender, guarded by res.headersSent / res.writableEnded).
- context.ts: `export interface Ctx { req; res; method; url; path; query; params; ip; reqId; body?; account?; route?; state }` (body and account stay undefined this phase); `export function buildContext(req, res, match): Ctx`; reuse the existing client-IP helper for `ctx.ip`; `export const reqIdStorage = new AsyncLocalStorage<string>()`; `export function runWithReqId<T>(reqId: string, fn: () => T): T`; `export function currentReqId(): string | undefined`; `export function newReqId(): string` (server-side id, e.g. crypto.randomUUID; this is NOT sim randomness).

Fan out 2 parallel Agent subagents, each owning a COMPLETE vertical slice (behavior + its tests), each given ONLY the Explore summary plus the locked interface:
- Agent A (the runner): server/http/compose.ts + tests/server/http/compose.test.ts.
  - compose(stack) recursive dispatch in onion order (each middleware awaits next(), unwinds in reverse).
  - Double-next guard: calling next() twice in the same middleware frame throws a clear Error.
  - runOnion(ctx, stack): runs the composed stack INSIDE reqIdStorage.run(ctx.reqId, ...), then guarantees EXACTLY ONE idempotent response on BOTH paths: on resolve-with-no-response, send a bare fallback; on uncaught throw, send a bare 500 with NO stack, SQL, table text, or English prose (the real RFC 9457 envelope is Phase 7). respondOnce is the headersSent/writableEnded-guarded sender it uses; the fallback sends attach X-Request-Id from ctx.reqId.
  - Tests: middleware order + reverse unwind; short-circuit on throw (downstream not reached); double-next rejection; resolve-no-response fallback; uncaught-throw single 500 with no leakage; already-responded middleware is NOT double-sent.
- Agent B (the context): server/http/context.ts + tests/server/http/context.test.ts.
  - buildContext(req, res, match): populate method, url, path, parsed query, params (from the router match), ip (via the REUSED existing helper), reqId (fresh via newReqId, unique per request), state scratch bag; body and account undefined.
  - reqId ALS: reqIdStorage + runWithReqId + currentReqId + newReqId.
  - Reconcile the Phase 2 `fakeCtx(overrides)` so it backs onto the REAL buildContext / Ctx shape if the Phase 2 stub diverged (this is the same spine; keep it a small alignment, not a rewrite).
  - Tests: buildContext field population (url/path/query/params/ip/reqId; body+account undefined); reqId uniqueness across calls; currentReqId() returns ctx.reqId inside runWithReqId AND survives across an `await` boundary; the reconciled fakeCtx still compiles against Ctx.
Because compose.ts imports the Ctx type and reqIdStorage from context.ts, give Agent A the locked names so it codes against them; there is no import cycle as long as context.ts never imports compose.ts. This phase is low context risk with NO documented a/b split; it should finish in one session. If context unexpectedly approaches 40%, land compose.ts + its tests as a green commit first, then context.ts.

INVARIANTS THIS PHASE MUST KEEP
- src/sim purity / determinism: this phase is SERVER-ONLY and must not touch src/sim. newReqId may use crypto/server time (that is fine, it is not sim randomness); never introduce a sim-side dependency.
- compose() does NOT respond or catch on its own; raw node:http leaves the socket hanging on an uncaught throw, so the runOnion wrapper guaranteeing EXACTLY ONE idempotent response (headersSent/writableEnded guarded) is mandatory, not optional. withErrors (the error-mapping middleware) is Phase 8 and sits INSIDE this wrapper later; do not build it here.
- Stable-code i18n: the fallback responses emit NO English player prose and NO internal detail (no stack/SQL/table text). The real error envelope and stable codes are Phase 7; the Phase 5 fallback body is empty or a bare machine status only.
- Single-flag dispatch + catch-all delegate: NOT wired this phase. Do not touch the createServer dispatch ladder or main.ts.
- Module-first: two small tested modules under server/http/, never a method cluster on main.ts. Do NOT create the server/http/index.ts barrel (Phase 9 owns it); consumers import the modules directly until then.
- No magic values: any constant (id length, fallback status) is a named const with a comment.
- No em dashes, no en dashes, no emojis anywhere (code, comments, tests, commits, docs).

OUT OF SCOPE (explicit exclusions)
- The schema validator (object/str/num/enum, Infer, one-pass issues): Phase 6.
- The error model: HttpError/AppError, mapError, RFC 9457 problem+json, the per-surface serializers, error_codes.ts: Phase 7. The runOnion fallback is a structural bare 500 only.
- Real middleware: withErrors, requestId echo-on-every-response, withCors, withBody/withRawBody, requireAccount, the rateLimit adapter, the metric/access-log sink: Phase 8 (and the logger/metrics in Phase 23). compose is tested with SYNTHETIC middleware only; author no real middleware here.
- Registry, the dispatcher-in-front, the createServer wiring, the top-level CORS wrapper, and the parity harness: Phase 9. No live route change ships this phase.
- Router matching internals: Phase 4 (already delivered). This phase CONSUMES the router match-result type; it does not re-implement matching.
- Body parsing: ctx.body stays undefined this phase (withBody is Phase 8).
- The server/http/index.ts barrel: Phase 9.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run the canonical validation for a spine/primitive change:
- `npx tsc --noEmit`
- `npx vitest run tests/server/http/compose.test.ts tests/server/http/context.test.ts`
- `npm run ci:changed` (Biome on changed files only; never a whole-tree --write)
- `npm run build:server`
Then, before the PR, the pre-merge gate that mirrors CI: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`.

Review dispatch: check `git diff --name-only` first; this diff touches only server/http/compose.ts, server/http/context.ts, and tests/server/http/* (plus possibly the Phase 2 fakeCtx helper). Spawn ONLY the matching surfaces:
- privacy-security-review: server/ is touched and this phase owns the no-leakage fallback (no stack/SQL/table text on an uncaught throw), the socket/response idempotency, and the reqId carrier. Prompt it for COVERAGE (report every gap with confidence and severity), not filtering.
- qa-checklist: the end-of-contribution gate.
- One fresh coverage-review subagent over your own diff: COVERAGE of every acceptance criterion, not filtering.
Do NOT dispatch migration-safety (no DDL/JSONB), cross-platform-sync (no IWorld/sim/wire/matcher change), or architecture-reviewer (no src/sim change).
Add to every review-agent prompt: "If your output is truncated, resume from the last completed item; do not restart." Do not commit until each reviewer reports no BLOCKING.

STEP 4 - COMMIT CADENCE (Conventional Commits with a scope, EXPLICIT paths)
This phase ships as its OWN green, bisectable PR in the stacked chain. Suggested headlines:
- `feat(http): add compose onion runner with double-next guard and one-response wrapper` (server/http/compose.ts)
- `feat(http): add request context builder and reqId AsyncLocalStorage carrier` (server/http/context.ts)
- `test(server): cover compose order/double-next, runOnion idempotency, buildContext, ALS propagation` (tests/server/http/compose.test.ts, tests/server/http/context.test.ts)
- (if needed) `test(server): align Phase 2 fakeCtx onto the real Ctx shape` (the Phase 2 helper file)
Stage every file by explicit path. Never `git add -A` on the shared worktree.

STEP 5 - ACCEPTANCE CRITERIA (verifiable)
- [ ] compose([a,b,c]) runs middleware in order, each awaiting next(), and unwinds in reverse (onion semantics).
- [ ] Calling next() twice in one middleware frame throws a clear, named double-next Error.
- [ ] A middleware that throws short-circuits: downstream middleware do not run; the rejection propagates to runOnion.
- [ ] buildContext populates method, url, path, parsed query, params (from the router match), and ip (via the REUSED existing client-IP helper); reqId is fresh and unique per request; body and account are undefined.
- [ ] currentReqId() returns ctx.reqId inside runWithReqId AND the value survives across an `await` boundary inside the onion.
- [ ] runOnion guarantees EXACTLY ONE response: resolve-with-no-response sends a bare fallback; an uncaught throw sends a bare 500 carrying NO stack/SQL/table/English text; a middleware that already responded is not double-sent (headersSent/writableEnded guarded); the fallback responses carry X-Request-Id from ctx.reqId.
- [ ] No file under src/sim/ changed; nothing wired into server/main.ts or the createServer ladder; server/http/index.ts NOT created.
- [ ] `npx tsc --noEmit` clean; the two new vitest files green; `npm run ci:changed` clean; `npm run build:server` green.

STEP 6 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md and docs/api-pipeline/state.md: record that Phase 5 added server/http/compose.ts (exports compose, Middleware, Next, runOnion, respondOnce) and server/http/context.ts (exports Ctx, buildContext, reqIdStorage, runWithReqId, currentReqId, newReqId; reuses the existing client-IP helper), with tests under tests/server/http/. Note what is still pending (schema Phase 6, error model Phase 7, middleware Phase 8, barrel + wiring Phase 9).
- Record in memory the surprising rules: compose() does not respond or catch and raw node:http hangs the socket on an uncaught throw, so the runOnion one-response wrapper (idempotent, no-leakage) is mandatory; the double-next guard convention; the reqId AsyncLocalStorage carrier name and that it must wrap the composed run so db.ts/domain functions can read currentReqId() without threading ctx (the X-Request-Id echo itself lands in Phase 8/23).

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status (DONE / BLOCKED); files touched (absolute paths); validation results (tsc, the two vitest files, ci:changed, build:server, and the pre-merge gate); review verdicts per agent (BLOCKING/SHOULD-FIX/none); any deferrals; and a one-line handoff to "Phase 5 QA".

STOPPING RULES
- STOP if building these primitives would require touching src/sim (determinism or sim-purity would be violated); they must not.
- STOP if any change would alter the WS wire protocol or a snapshot shape; this is a server-only HTTP primitive and must not.
- STOP if you find yourself authoring real middleware (withErrors/withBody/requireAccount/rateLimit) or wiring the dispatcher into createServer; that is Phase 8/9. Keep this phase to the two primitive modules plus tests.
- STOP if the fallback response would emit any English player prose or internal detail (stack/SQL/table); the real error envelope and stable codes are Phase 7.
- STOP if any Phase 3 parity fixture diffs: this phase ships no live route change, so a fixture diff means something was wired that should not have been.
````
