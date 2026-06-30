# Phase 8 QA: Core middleware set + metric/log hook seam + thin rateLimit adapter

This QA phase audits the Phase 8 diff: the onion middleware primitives (withErrors, requestId+ALS,
withCors, withBody, withRawBody, requireAccount, the thin rateLimit adapter), the injectable
metric/access-log sink seam, and the top-level clientError socket-destroy handler. It verifies
every acceptance criterion from phase-08-middleware.md, the server-only / three-host non-impact
(no src/sim, no WS wire change), and the stable-code i18n boundary on every error path. It is
sized to stay under 40% context because it reviews a bounded set of small server modules and
their unit tests, with no content sweep. Split if context approaches 40% (audit 8a then 8b), but
that is usually unnecessary at QA.

````
### QA Starter Prompt

This is the QA pass for Phase 8 of the API Pipeline re-architecture: Core middleware set + metric/log hook seam + thin rateLimit adapter.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: Find and fix every correctness, coverage, dead-code, and invariant gap in the Phase 8 diff before it merges as its own stacked PR.

STEP 0 - PRE-FLIGHT: run `git status`. The worktree is SHARED; if it is dirty with files you do not own, STOP and ask. You will stage with EXPLICIT paths only, never `git add -A`. Confirm you are on the Phase 8 branch and that the Phase 8 commits are present.

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; do not read the planning docs or server source directly):
Have it summarize:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (what Phase 8 claims to have landed).
- docs/api-pipeline/phase-08-middleware.md (the acceptance criteria, the canonical onion order, the OUT OF SCOPE list, the stopping rules).
- The Phase 8 diff itself: `git diff main...HEAD -- server/http/middleware/ server/main.ts tests/server/http/ server/http/error_codes.ts` (anchor on symbol names, not line numbers). Have it list every new module, every new test, the MetricSink/RateLimitPolicy types, any code appended to error_codes.ts, and the exact onion order expressed.
Tell the Explore agent to RETURN: the list of new/changed files, each middleware's responsibility and its produced status codes, whether each error body carries a stable code (no English), whether anything is mounted in front of handleApi (it must NOT be), whether src/sim or the WS upgrade path was touched (it must NOT be), and which acceptance criteria appear unaddressed.

STEP 2 - QA AUDIT (hand-spawn parallel agents, each given ONLY the Explore summary plus the diff hunks for its surface; each told: "if your output is truncated, resume from where you stopped; do not restart"):
  - Correctness agent: verify EVERY acceptance criterion in phase-08-middleware.md against the real code, item by item. Specifically confirm: withErrors produces exactly one idempotent response on resolve, on throw, and when the handler already responded (headersSent/writableEnded guarded) and never leaves a socket hung; requestId runs the onion inside the ALS carrier and the reqId survives an await; withCors sets headers BEFORE a downstream throw so error/429 bodies carry CORS; withBody maps over-cap to 413 and bad JSON to 400, drains the body on early reject, and imposes NO 415; withRawBody serves the card binary path with Connection:close preserved; requireAccount returns 401+WWW-Authenticate on missing/invalid token, 403 on insufficient scope and on a moderation deny, populates ctx.account, and applies the moderation gate uniformly (the Discord bearer-gap is closed); rateLimit is a thin adapter that throws 429+Retry-After, is deterministic via the injected now() clock, and ip-vs-ip+account key timing matches the onion order; the metric sink receives { route-template, method, status, durationMs } with a no-op default and a :param template label (never a concrete path); the clientError handler destroys the socket without disturbing the WS upgrade. ALSO verify the three-host / server-parity invariant (nothing mounted in front of handleApi, dispatch flag and routing untouched, WS wire unchanged, no src/sim import) and the stable-code i18n boundary (every error path emits a frozen code from error_codes.ts, zero English prose, any appended code is AIP-193 append-only). Report each criterion as PASS / FAIL with the exact file + symbol.
  - Test-coverage agent: confirm each middleware has an isolation test and that the suite covers the failure modes, not just the happy path: 413 over cap, 400 bad JSON, body-drain on reject, binary-vs-JSON body, 401/403 scope+moderation denial, CORS-before-throw, exactly-one-response on double-write, ALS propagation across an await, the rateLimit ip-vs-ip+account ordering via the injected clock, the sink count+duration+status keying, and the onion-order assertion. Flag any criterion asserted in the impl doc but not actually tested, and any test that asserts a fiction (passes without exercising the behavior).
  - Dead-code / cleanup agent: flag any unused export, any limiter reset helper left dangling, any TODO, any literal that should reference an existing named constant (CARD_UPLOAD_MAX_PER_MINUTE, WALLET_LINK_MAX_PER_MINUTE, DISCORD_MAX_PER_MINUTE, WOC_BALANCE_MAX_PER_MINUTE, PUBLIC_READ_MAX_PER_MINUTE, the TokenScope values), any premature abstraction (a generalized middleware factory used once), and any module that duplicates a Phase 5 to 7 primitive instead of importing it.
  - privacy-security-review (REQUIRED; the diff touches the bearer resolver, the moderation/ban gate, the rate-limit adapter, the error path, and clientError socket handling): verify no bearer-gap (no path skips moderation/scope), the 401/403 split, no internal leakage (stack/SQL/table text) in any body, the clientError handler cannot be abused, and the body-drain prevents a socket-exhaustion vector. Prompt for COVERAGE, not filtering.
  - qa-checklist (REQUIRED): run the end-of-contribution gate over the diff.
  Do NOT dispatch migration-safety (no DDL/JSONB/db.ts change), cross-platform-sync, or architecture-reviewer (server-only, no src/sim/wire/matcher change). State this exclusion explicitly in the final response.

STEP 3 - FIX: apply every BLOCKING finding and every agreed SHOULD-FIX, test-first where a behavior changes (a failing test that reproduces the gap, then the smallest change that turns it green). Re-run the validation matrix after fixing:
- `npx tsc --noEmit`
- `npx vitest run tests/server/http/with_errors.test.ts tests/server/http/request_id.test.ts tests/server/http/cors.test.ts tests/server/http/metric_sink.test.ts tests/server/http/body.test.ts tests/server/http/raw_body.test.ts tests/server/http/require_account.test.ts tests/server/http/rate_limit.test.ts`
- `npm run build:server`
- `npm run ci:changed`
- Pre-merge mirror of CI: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`
Commit fixes as SEPARATE Conventional-Commit commits with a scope and EXPLICIT paths (for example `fix(http): drain body on requireAccount reject`, `test(server): cover CORS-before-throw on the error path`). Defer any non-blocking nice-to-have as a tracked follow-up rather than expanding scope.

STEP 4 - DOC UPDATES + MEMORY: update docs/api-pipeline/progress.md and state.md to reflect the QA outcome and any fixes (note the final module list, the onion order, that the primitives remain un-mounted until Phase 9). Record in Claude Code memory any surprising rule the QA surfaced (for example a double-write path withErrors missed, a body-drain gap, or a moderation-gate bypass), so later phases do not reintroduce it.

STEP 5 - PACKET TEARDOWN: Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT (return as text, no report file): verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts (criteria verified, BLOCKING found, BLOCKING fixed, SHOULD-FIX applied, follow-ups deferred); the reviewer verdicts (privacy-security-review, qa-checklist) and the explicit note that migration-safety / cross-platform-sync / architecture-reviewer were not in play; files touched (absolute paths); validation results; one-line handoff: "Phase 8 QA complete; proceed to Phase 9 (docs/api-pipeline/phase-09-registry-parity.md)."
````
