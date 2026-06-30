# Phase 8: Core middleware set + metric/log hook seam + thin rateLimit adapter

This phase builds the per-route onion middlewares that a migrated route needs to run, plus the
one collection seam (the metric/access-log hook) that cannot be retrofitted later once routes
are spread across many modules. It consumes Phase 5 (`compose.ts` + `context.ts`), Phase 6
(`schema.ts`), and Phase 7 (`errors.ts` + `error_codes.ts` + `mapError`), and the Phase 2 test
harness (`fakeCtx`, fake-http, `FakeRateLimitStore`, the injected `now()` clock). It deliberately
does NOT mount anything in front of the live `handleApi`: that wiring is Phase 9. Because the
work is a set of small, independently testable middleware primitives plus a thin adapter over
limiters that already exist, it stays well under the 40% context bound. It carries a documented
a/b split (8a errors/requestId/cors, 8b withBody/withRawBody/requireAccount/rateLimit-adapter):
the runner should split into two sessions if context approaches 40%.

````
### Starter Prompt

This is Phase 8 of the API Pipeline re-architecture: Core middleware set + metric/log hook seam + thin rateLimit adapter.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: this phase is NOT batch-heavy (it is ~6 small middleware modules plus their unit tests), so hand-spawn parallel agents; do not orchestrate a Workflow. Add `ultracode` only if you later decide to sweep many test fixtures at once.
Goal: Implement the per-route onion middleware set (withErrors, requestId+ALS, withCors, withBody, withRawBody, requireAccount, the thin rateLimit policy adapter), the injectable no-op metric/access-log sink seam, and the top-level clientError socket-destroy handler, each unit-tested in isolation, WITHOUT mounting any of it in front of the live handleApi (that is Phase 9).

STEP 0 - PRE-FLIGHT:
- Run `git status`. The worktree is SHARED with concurrent sessions. If it is dirty with files you do not own, STOP and ask before staging anything; you will commit with EXPLICIT paths only, never `git add -A`.
- Scan Claude Code memory (MEMORY.md index) for entries in this phase's domain. Suggested concrete topics to pull: (1) "Server API pipeline audit" / "server-api-pipeline" (the locked SPEC), (2) the "PR #1044 / #1075 Discord integration review" entries (bearer-gap + isIpBlocked + turnstile parity precedent that requireAccount must not silently re-open), (3) "Shared-worktree commit care", (4) "no em dashes or emojis". Report what you found before proceeding.

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or server source directly; spawn ONE Explore agent and have it summarize):
Files to summarize:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (current packet state, what Phases 1 to 7 landed).
- docs/api-pipeline/phase-08-middleware.md (this file).
- The Phase 5 to 7 spine modules this phase builds on: server/http/compose.ts (the compose() runner + double-next guard), server/http/context.ts (the Ctx type, buildContext, the AsyncLocalStorage reqId carrier), server/http/schema.ts (Infer + the validator), server/http/errors.ts (HttpError, mapError, the per-surface serializer selection), server/http/error_codes.ts (the as-const frozen code catalog), and server/http/index.ts (the barrel).
- The live server symbols these middlewares wrap (anchor on SYMBOL NAMES, not line numbers; server/main.ts is ~1695 lines): in server/http_util.ts the body readers `readBody` and `readBinaryBody`; in server/ratelimit.ts the boolean limiters `rateLimited`, `cardUploadRateLimited`, `walletLinkRateLimited`, `discordRateLimited`, `wocBalanceRateLimited`, `publicReadRateLimited` and their `reset*` helpers plus `requestIp` and the named caps (`CARD_UPLOAD_MAX_PER_MINUTE`, `WALLET_LINK_MAX_PER_MINUTE`, `DISCORD_MAX_PER_MINUTE`, `WOC_BALANCE_MAX_PER_MINUTE`, `PUBLIC_READ_MAX_PER_MINUTE`); in server/main.ts the bearer resolvers `bearerAccount` and `bearerScopeAccount`, the `TokenScope` type, and the CORS `setHeader('Access-Control-Allow-*', ...)` block + the OPTIONS short-circuit + the card-upload `setHeader('Connection', 'close')` short-circuit; in server/moderation_db.ts `moderationStatusForAccount` and `scopeAllowsMutation`.
- The Phase 2 harness modules: the fake-http helper, fakeCtx(overrides), FakeRateLimitStore, and the injected now() clock seam in server/ratelimit.ts.
- server/CLAUDE.md and root CLAUDE.md (server conventions, module-first, i18n stable-code rule, no-em-dash rule).
Tell the Explore agent to RETURN: the exact signatures of compose(), buildContext/Ctx, HttpError + mapError + how a serializer is chosen per route, the as-const error code names already in error_codes.ts (so you reuse them and only append if genuinely missing), the exact signatures of readBody/readBinaryBody/bearerScopeAccount/the six limiter booleans/moderationStatusForAccount/scopeAllowsMutation, where the live CORS headers + card Connection:close + OPTIONS-204 are set today, and the harness fakeCtx/FakeRateLimitStore/now() surfaces. It must NOT propose code; just facts and signatures.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE: hand-spawn a 3-agent parallel fan-out, each owning a complete vertical slice (behavior module(s) + its unit tests under tests/server/http/), each given ONLY the Explore summary. If context approaches 40%, split along the documented a/b boundary: ship 8a (Agent A) as its own PR first, then 8b (Agents B + C) as the next stacked PR.

  Agent A (slice 8a: errors + requestId + cors + the sink + clientError):
  - server/http/middleware/with_errors.ts: the OUTERMOST middleware. It awaits next(), and on BOTH the resolve and throw paths guarantees EXACTLY ONE idempotent response by calling mapError (Phase 7) and writing via the chosen per-surface serializer, guarded by headersSent / writableEnded so a handler that already responded is never double-written. Raw node:http does not auto-respond, so this is the single place that turns an uncaught throw into a response. No English strings: the body carries the stable CODE from error_codes.ts.
  - server/http/middleware/request_id.ts: generate a request id and run the rest of the onion inside the Phase 5 AsyncLocalStorage carrier (context.ts) so the reqId is readable downstream. Echoing it as an X-Request-Id response header is Phase 23, NOT here; only the generation + ALS run() lands now.
  - server/http/middleware/cors.ts: a pure withCors(originAllowClass) header-setter (the 'api' class and the wildcard public-read class, mirroring today's two setHeader blocks). It must set CORS headers BEFORE the handler runs / before withErrors maps a throw, so error and 429 bodies still carry CORS and stay readable in the browser. NOTE: the load-bearing TOP-LEVEL createServer CORS + OPTIONS-204 wrapper covering both old and new paths is Phase 9; this module is only the reusable primitive both will call. Do not wire it into createServer here.
  - server/http/middleware/metric_sink.ts: an INJECTABLE MetricSink interface (a no-op default) plus the middleware that records, per request, { route (the :param template name, never a concrete path), method, status, durationMs } and pushes one event to the sink. Place this middleware directly inside withErrors so it observes the FINAL mapped status (including errors) and the full onion duration. The real logger + /metrics exporter that consume this sink are Phase 23; only the collection point and the no-op default land now.
  - Deliverables (bullets): with_errors.ts, request_id.ts, cors.ts, metric_sink.ts; tests tests/server/http/with_errors.test.ts (exactly-one-response on resolve, on throw, and when the handler already responded; code-only body), request_id.test.ts (reqId propagates across an await), cors.test.ts (headers set before a downstream throw so the error body still carries them), metric_sink.test.ts (sink receives count + duration + status keyed by route name; default no-op swallows).

  Agent B (slice 8b part 1: body + clientError):
  - server/http/middleware/body.ts: withBody(maxBytes) for JSON routes, wrapping readBody; map an over-cap read to a 413 (Content Too Large) HttpError code and malformed JSON to a 400 HttpError code, populating ctx.body. ALWAYS drain the request stream on an early reject (so the socket can be reused). PRESERVE the card pre-auth Content-Length 413 short-circuit semantics. withBody is JSON-only and is applied ONLY to routes the registry declares JSON; it does NOT impose a 415 (Content-Type enforcement is Phase 21, log-only first).
  - server/http/middleware/raw_body.ts: withRawBody(maxBytes) / binary variant for the card route, wrapping readBinaryBody; NO JSON parse, populates a raw Buffer on ctx; preserve the existing card-upload Connection:close behavior. This is the variant that keeps a blanket JSON withBody from breaking POST /api/card (binary), GET /api/email/unsubscribe (HTML), and GET /api/auth/discord/callback (redirect): those routes opt out of JSON withBody.
  - The top-level clientError handler: add `server.on('clientError', ...)` in the createServer / startServer setup that, with no usable req/res, destroys the socket (raw node:http leaves a malformed-request socket hanging on an uncaught client error). This is top-level setup, NOT an onion middleware, and must NOT change routing or the WS upgrade path.
  - Deliverables (bullets): body.ts, raw_body.ts, the clientError handler in server/main.ts startServer; tests tests/server/http/body.test.ts (413 over cap, 400 on bad JSON, body drained on early reject, JSON populated on success) and tests/server/http/raw_body.test.ts (binary buffer populated, no JSON parse attempted, Connection:close preserved).

  Agent C (slice 8b part 2: requireAccount + rateLimit adapter):
  - server/http/middleware/require_account.ts: requireAccount({ scope }) as the ONE bearer resolver, wrapping bearerScopeAccount. Model AT LEAST the read / active / full scopes. On missing or invalid token emit a 401 with a WWW-Authenticate header (stable code); on insufficient scope or a moderation/ban deny emit a 403 (stable code). Apply the ban/moderation gate UNIFORMLY via moderationStatusForAccount + scopeAllowsMutation so no migrated route can silently skip it (this closes the bearer-gap precedent from the Discord reviews). Populate ctx.account on success. This is ACCOUNT-scope only; object-level requireOwned* loaders are Phase 12, out of scope here.
  - server/http/middleware/rate_limit.ts: a THIN rateLimit(policy) adapter over the EXISTING boolean limiters. A RateLimitPolicy descriptor names which limiter and the key class ('ip' runs before body+auth; 'ip+account' runs after requireAccount because the account is known only post-token-lookup). On a limit, throw an HttpError that mapError renders as 429 with Retry-After (a coarse adapter value is fine now; the precise {remaining, resetSeconds} return-shape rework is Phase 19). Use the injected now() clock (Phase 2) so window/Retry-After tests are deterministic. Do NOT add ratelimit_db, RATELIMIT_SCHEMA, or new limiter behavior here (Phase 19).
  - Deliverables (bullets): require_account.ts, rate_limit.ts; tests tests/server/http/require_account.test.ts (401+WWW-Authenticate on no/invalid token, 403 on insufficient scope, 403 on a moderation deny, ctx.account populated on success) and tests/server/http/rate_limit.test.ts (ip-key policy throws 429+Retry-After under flood via the injected clock, ip+account policy resolves the key after account is known, the adapter calls the right underlying boolean).

  Cross-slice contract all agents honor: the canonical onion ORDER is withErrors (outermost) -> metric/log hook -> requestId+ALS -> withCors -> rateLimit('ip') -> withBody/withRawBody -> requireAccount -> rateLimit('ip+account') -> handler. Cheap-reject-first: IP-keyed limits run BEFORE body parse and DB; account-keyed limits run AFTER auth. Write the modules so this order is expressible by the registry (Phase 9) without any module hardcoding a position. Add a small onion-order test asserting the intended sequence on a representative composed stack.

INVARIANTS THIS PHASE MUST KEEP:
- Single-flag dispatch + catch-all delegate model: Phase 8 builds PRIMITIVES only. Do NOT mount these in front of handleApi and do NOT touch the dispatch flag or routing; that is Phase 9. The middlewares must remain importable-but-unmounted.
- Server-authority unchanged; the WS wire protocol and the WS upgrade path are untouched (the clientError handler must not interfere with upgrade).
- Determinism / sim-purity: this is SERVER-ONLY. Do NOT import or modify anything in src/sim/. The rateLimit adapter and its tests use the injected now() clock (Phase 2), never a raw Date.now in the path under test.
- Stable-code i18n via userFacingApiError: every 4xx/401/403/413/429/500 body a middleware produces carries a stable CODE from error_codes.ts (Phase 7). NO English error prose in the server. If a middleware genuinely needs a code not yet in the catalog, APPEND it to error_codes.ts (AIP-193 append-only, reuse the existing domain.reason vocabulary); the client-side apiError.* catalog + matcher parity is Phase 22.
- No persistence change: the rateLimit adapter is over IN-MEMORY booleans. No DDL, no ratelimit_db, no JSONB shape change in this phase (so the migration-safety reviewer is not in play).
- No magic values: byte caps, limiter caps, and scopes reference the EXISTING named constants (CARD_UPLOAD_MAX_PER_MINUTE, WALLET_LINK_MAX_PER_MINUTE, DISCORD_MAX_PER_MINUTE, WOC_BALANCE_MAX_PER_MINUTE, PUBLIC_READ_MAX_PER_MINUTE, the TokenScope values); never re-type a literal.
- Module-first: each middleware is its own small file under server/http/middleware/; NEVER grow main.ts (the only main.ts edit is the one-block clientError handler in startServer).
- No em dashes, no en dashes, no emojis anywhere (code, comments, tests, commits, this doc).

OUT OF SCOPE (do not do these here):
- Wiring the new dispatcher in front of handleApi, registry.ts, the per-path catch-all delegate, and the parity harness (Phase 9).
- The TOP-LEVEL createServer CORS + OPTIONS-204 wrapper covering both paths (Phase 9) and the top-level security-headers wrapper + 415 Content-Type enforcement (Phase 21).
- The deep two-tier limiter rework (boolean -> {remaining, resetSeconds}), ratelimit_db.ts, RATELIMIT_SCHEMA wiring, and the draft-11 RateLimit/RateLimit-Policy structured-field headers (Phase 19).
- The real pino-shaped logger, the /metrics exporter, the X-Request-Id response echo, and /livez/readyz (Phase 23). Only the no-op sink seam + reqId generation land now.
- Any domain route migration (Phases 10 to 18) and the BOLA requireOwned* object-level loaders (Phase 12).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
Run, in order:
- `npx tsc --noEmit`
- `npx vitest run tests/server/http/with_errors.test.ts tests/server/http/request_id.test.ts tests/server/http/cors.test.ts tests/server/http/metric_sink.test.ts tests/server/http/body.test.ts tests/server/http/raw_body.test.ts tests/server/http/require_account.test.ts tests/server/http/rate_limit.test.ts` (all new primitive suites)
- `npm run build:server` (the clientError handler touches startServer setup, so confirm the server bundle still builds)
- `npm run ci:changed` (Biome on changed files only; never a whole-tree --write)
Then, before merge, mirror CI: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`.

Review-agent dispatch (run `git diff --name-only` first; spawn ONLY matching surfaces, each prompted for COVERAGE not filtering, each told: "if your output is truncated, resume from where you stopped; do not restart"):
- privacy-security-review: REQUIRED. The diff touches the bearer resolver (requireAccount), the moderation/ban gate, the rate-limit adapter, the error-response path, and the clientError socket handling. Have it verify the bearer-gap is closed (no migrated route can skip moderation/scope), the 401/403 split is correct, no internal leakage (stack/SQL/table text) reaches a body, and the clientError handler cannot be abused.
- qa-checklist: REQUIRED at phase completion.
- migration-safety: NOT dispatched (no DDL / JSONB / db.ts change this phase). Note this explicitly in the final response.
- cross-platform-sync and architecture-reviewer: NOT dispatched (server-only, no src/sim / wire / matcher change).
Do not commit until every dispatched reviewer reports no BLOCKING finding.

STEP 4 - COMMIT CADENCE (Conventional Commits with a scope, EXPLICIT paths only; this phase ships as its OWN green, bisectable PR in the stacked chain):
- `feat(http): add withErrors, requestId ALS, and withCors onion middlewares` (server/http/middleware/with_errors.ts server/http/middleware/request_id.ts server/http/middleware/cors.ts + their tests)
- `feat(http): add injectable metric/access-log sink seam` (server/http/middleware/metric_sink.ts + tests)
- `feat(http): add withBody and withRawBody body middlewares and clientError socket-destroy` (server/http/middleware/body.ts server/http/middleware/raw_body.ts server/main.ts + tests)
- `feat(http): add requireAccount bearer resolver and thin rateLimit policy adapter` (server/http/middleware/require_account.ts server/http/middleware/rate_limit.ts + tests)
- `test(server): add onion-order assertion for the composed middleware stack` (the order test) if not already folded into a slice commit.

STEP 5 - ACCEPTANCE CRITERIA (verifiable checkbox list):
- [ ] withErrors is the outermost middleware and produces EXACTLY ONE idempotent response on resolve, on throw, and when a handler already responded (headersSent / writableEnded guarded); a raw uncaught throw becomes a code-only response, never a hung socket.
- [ ] requestId generates a reqId and runs the rest of the onion inside the Phase 5 ALS carrier; the reqId is readable across an await downstream. (No X-Request-Id response echo yet.)
- [ ] withCors sets CORS headers BEFORE a downstream throw so 4xx/429 bodies still carry CORS; the two origin-allow classes mirror today's behavior. (Top-level wrapper deferred to Phase 9.)
- [ ] withBody maps over-cap to 413 and malformed JSON to 400, populates ctx.body, drains the body on early reject, and imposes NO 415; withRawBody serves the card binary route with Connection:close preserved.
- [ ] requireAccount({scope}) is the one bearer resolver: 401+WWW-Authenticate on missing/invalid token, 403 on insufficient scope or a moderation deny, ctx.account populated on success, moderation/ban gate applied uniformly.
- [ ] rateLimit(policy) is a thin adapter over the existing booleans: ip-key throws 429+Retry-After under flood, ip+account key resolves after auth, deterministic via the injected now() clock; no ratelimit_db / new limiter behavior.
- [ ] The metric/log hook pushes { route-template, method, status, durationMs } to an injectable sink whose default is a no-op; the route label is the :param template, never a concrete path.
- [ ] A top-level clientError handler destroys the socket and does not disturb the WS upgrade path.
- [ ] An onion-order test asserts withErrors -> metric hook -> requestId -> withCors -> rateLimit(ip) -> withBody/withRawBody -> requireAccount -> rateLimit(ip+account) -> handler.
- [ ] Nothing is mounted in front of handleApi; the dispatch flag and routing are untouched; the WS wire is unchanged.
- [ ] tsc clean, all new tests green, build:server green, ci:changed clean.

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/api-pipeline/progress.md: mark Phase 8 complete; name the new modules server/http/middleware/{with_errors,request_id,cors,metric_sink,body,raw_body,require_account,rate_limit}.ts, the MetricSink interface + no-op default, the RateLimitPolicy descriptor type, the clientError handler in startServer, and any error code appended to error_codes.ts.
- Update docs/api-pipeline/state.md: record that the onion middleware primitives + the metric sink seam exist but are UN-mounted (Phase 9 mounts them), the canonical onion order, and that the deep limiter rework + the top-level CORS/security-header wrappers + the logger/metrics exporter are still pending (Phases 19, 9/21, 23).
- Record in Claude Code memory the surprising rules you hit: that compose() does not respond or catch on its own so withErrors plus a wrapped single idempotent response is mandatory; that raw node:http needs an explicit clientError socket-destroy; that withBody must NOT impose 415 and the card/HTML/redirect routes opt out of JSON withBody via withRawBody; that requireAccount must apply the moderation gate uniformly to close the Discord bearer-gap.

STEP 7 - FINAL RESPONSE FORMAT (return as text, no report file): phase status (COMPLETE / BLOCKED); files touched (absolute paths); validation results (tsc / vitest / build:server / ci:changed); review verdicts (privacy-security-review, qa-checklist) with any non-blocking follow-ups; deferrals (note migration-safety/cross-platform/architecture were correctly not dispatched and why); one-line handoff: "Ready for Phase 8 QA (docs/api-pipeline/phase-08-qa.md)."

STOPPING RULES (stop and surface, do not improvise):
- Stop if any change would alter the WS wire protocol or the WS upgrade handshake.
- Stop if making a middleware work requires mounting it in front of handleApi or changing the dispatch flag / routing (that is Phase 9); these primitives must stay importable-but-unmounted.
- Stop if determinism or sim-purity would be violated (any src/sim/ import, or a raw Date.now in a limiter path under test instead of the injected now()).
- Stop if the rateLimit adapter would require NEW limiter behavior, a ratelimit_db table, or RATELIMIT_SCHEMA wiring (deep rework is Phase 19); it must remain a thin pass-through over the existing booleans.
- Stop if requireAccount would need an object-level owner loader (requireOwned*); that is Phase 12.
- Stop if a body or error path would need a new English string in the server instead of a stable code re-localized client-side.
````
