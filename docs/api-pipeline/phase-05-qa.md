# Phase 5 QA: Onion compose + request context (compose.ts + context.ts)

This is the QA pass for Phase 5, which delivered two spine primitives under `server/http/`: the
Koa-style onion runner (`compose.ts`, with the double-next guard and the outermost
one-response wrapper `runOnion`) and the request-context builder plus reqId AsyncLocalStorage
carrier (`context.ts`). The QA scope is small and bounded (the diff is two source modules plus
their unit tests, no live wiring), so it stays well under the 40% context bound. The audit
focuses on the load-bearing properties that are easy to get subtly wrong: onion ordering and
the double-next guard, the EXACTLY-ONE idempotent response on both the resolve and throw paths
with no internal leakage, and reqId propagation across an `await` through the AsyncLocalStorage.

### QA Starter Prompt

````
This is the QA pass for Phase 5 of the API Pipeline re-architecture: Onion compose + request context (compose.ts + context.ts).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: audit the Phase 5 diff for correctness, test coverage, and dead code; apply BLOCKING and SHOULD-FIX findings; keep the phase a green, bisectable PR.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED across concurrent sessions: if it is dirty with files you do not own, STOP and ask before staging. Commit with EXPLICIT paths only, never `git add -A`.
- Scan Claude Code memory for entries in this phase's domain: the API pipeline canonical decisions, the compose/onion one-response wrapper rule, the reqId AsyncLocalStorage carrier, and the Phase 2 fake-http/fakeCtx scaffolding.

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; anchor on symbol names, not line numbers)
Have it summarize:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (what Phase 5 recorded and what stays pending).
- docs/api-pipeline/phase-05-onion-context.md (the implementation prompt: its acceptance criteria, invariants, and out-of-scope list are the checklist this QA verifies).
- The Phase 5 diff itself: `git diff` for server/http/compose.ts, server/http/context.ts, tests/server/http/compose.test.ts, tests/server/http/context.test.ts (and the Phase 2 fakeCtx helper if it was touched). Have the Explore agent return the exported symbols, the runOnion fallback behavior on resolve vs throw, the double-next guard implementation, and the reqId-ALS wiring.
Return a tight summary only; no planning-doc prose dumps.

STEP 2 - QA AUDIT (fan out parallel agents; give each ONLY the Explore summary + the diff)
Add to EVERY agent prompt: "If your output is truncated, resume from the last completed item; do not restart. Report findings as BLOCKING / SHOULD-FIX / NIT with a confidence and a one-line rationale; this is a COVERAGE pass, not a filtering pass."
- Correctness agent: verify EVERY acceptance criterion from phase-05-onion-context.md against the real code, specifically:
  - compose runs in onion order and unwinds in reverse; the double-next guard throws on a second next() in the same frame; a throwing middleware short-circuits downstream.
  - runOnion guarantees EXACTLY ONE response on BOTH paths: resolve-with-no-response sends a bare fallback; an uncaught throw sends a bare 500 with NO stack, SQL, table text, or English player prose (stable-code i18n boundary preserved; the real RFC 9457 envelope is Phase 7); an already-responded middleware is not double-sent (headersSent/writableEnded guarded); X-Request-Id from ctx.reqId is on the fallback responses.
  - buildContext populates method/url/path/query/params/ip/reqId; body and account are undefined; ip reuses the EXISTING client-IP helper (not a re-derivation).
  - reqId is unique per request; currentReqId() returns ctx.reqId inside runWithReqId and survives across an `await`.
  - Server-only parity: confirm NO file under src/sim/ changed, NO change to the WS wire protocol or any snapshot shape, and NOTHING wired into server/main.ts or the createServer ladder; server/http/index.ts was NOT created (Phase 9 owns it).
- Test-coverage agent: confirm tests/server/http/compose.test.ts and context.test.ts actually exercise: order + reverse unwind, double-next rejection, throw short-circuit, resolve-no-response fallback, uncaught-throw single 500 with no leakage, already-responded no-double-send, buildContext field population, reqId uniqueness, and ALS-across-await. Flag any criterion asserted in the impl file but not covered by a test, and any test that asserts a fiction (passes without exercising the property).
- Dead-code / cleanup agent: flag unused exports or params, an unreferenced helper, a constant that should be named, a leftover console.* or debugger, any em dash / en dash / emoji, and any premature surface that belongs to a later phase (real middleware, error mapping, the barrel) that leaked in.
- privacy-security-review (server/ touched; this is the matching domain reviewer): focus on the no-leakage fallback (no stack/SQL/table on 500), the response idempotency (no double-send, no hung socket), and the reqId carrier. Do NOT dispatch migration-safety, cross-platform-sync, or architecture-reviewer: this diff has no DDL/JSONB, no IWorld/sim/wire/matcher change, and no src/sim change.

STEP 3 - FIX
- Apply every BLOCKING and SHOULD-FIX finding. Defer NITs only with a one-line reason in the final report.
- Re-run the validation matrix after fixes: `npx tsc --noEmit`; `npx vitest run tests/server/http/compose.test.ts tests/server/http/context.test.ts`; `npm run ci:changed`; `npm run build:server`. Before declaring the PR green, run the pre-merge gate: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`.
- Commit fixes as SEPARATE Conventional Commits with a scope and EXPLICIT paths (for example `fix(http): guard runOnion against double-send when a middleware already ended` over server/http/compose.ts, or `test(server): cover ALS reqId survival across an await`). Never `git add -A`.

STEP 4 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md and docs/api-pipeline/state.md to reflect the QA outcome and any fixes (the final exported surface of compose.ts and context.ts, and what stays pending for Phases 6 to 9).
- Record in memory anything surprising the audit surfaced (for example a subtle double-send path, an ALS context-loss across a particular await, or a fakeCtx divergence from the real Ctx shape).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Report: overall verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL); finding counts by severity (BLOCKING / SHOULD-FIX / NIT) and how many were fixed vs deferred; the validation results (tsc, the two vitest files, ci:changed, build:server, and the pre-merge gate); files touched (absolute paths); and a one-line handoff to "Phase 6: Typed schema validator (schema.ts)".
````
