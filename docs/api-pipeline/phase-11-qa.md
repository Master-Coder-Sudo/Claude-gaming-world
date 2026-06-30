# Phase 11 QA: Migrate auth (register/login/native-attestation)

This is the QA gate for Phase 11. It audits the migrated credential surface
(`/api/register`, `/api/login`, `/api/native-attestation/challenge`) for correctness, test
coverage, dead code, and the credential-surface security invariants, then applies BLOCKING and
SHOULD-FIX findings. It is sized low context risk: one diff over three POST routes, one
middleware, and three test files, so a fresh session loads only state.md, progress.md, the
implementation file, and the phase diff and stays under the 40% context bound. The correctness
agent must verify EVERY acceptance criterion from phase-11-auth.md plus dual-path server parity
and the stable-code i18n boundary.

### QA Starter Prompt

````
This is the QA pass for Phase 11 of the API Pipeline re-architecture: Migrate auth
(register/login/native-attestation). Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: confirm the auth migration is correct, fully covered, and free of weakened credential
controls, then apply BLOCKING + SHOULD-FIX findings and re-validate.

STEP 0 - PRE-FLIGHT
- Run `git status`. Shared worktree with concurrent sessions: if dirty with files you do not own,
  STOP and ask. You will commit fixes with EXPLICIT paths only, never `git add -A`.
- Scan Claude Code memory for this phase's domain: "auth / turnstile", "authThrottled accrual",
  "anti-enumeration 404", "isIpBlocked parity gap", "em-dash rate-limit strings". Note anything
  that should change the audit.

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; do NOT read planning docs directly)
Have the Explore agent read and return a tight, symbol-anchored summary of:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (what Phase 11 claims to have
  landed: the migrated routes, server/auth.ts `routes` export, server/http/middleware/turnstile.ts,
  the appended auth.* error codes, the auth fixture knownDeviations).
- docs/api-pipeline/phase-11-auth.md (the implementation file: read its STEP 5 acceptance
  criteria verbatim; the QA correctness agent must verify each one).
- The phase diff: `git diff` of the Phase 11 commits (server/auth.ts, server/main.ts,
  server/http/middleware/turnstile.ts, server/http/error_codes.ts, server/http/registry.ts,
  tests/server/auth.*.test.ts, docs/api-pipeline/*). Anchor on symbol names and route strings,
  not line numbers.
Ask the Explore agent to RETURN: the final shape of each migrated handler (validation, turnstile
ordering, IP gate, web-login guard, rate-limit ordering, authThrottled accrual + clear-on-success,
anti-enumeration 404, success shape + tokens), what the turnstile middleware is attached to, the
appended codes, and which acceptance criteria the diff visibly satisfies vs leaves unproven.

STEP 2 - QA AUDIT (parallel agents; give EACH only the Explore summary). Add to every agent
prompt: "If your review is truncated, resume from the last file you finished and continue; do
not restart."
- Correctness agent: verify EVERY STEP 5 acceptance criterion from phase-11-auth.md against the
  real diff (not the docs). Specifically confirm:
  - All three routes resolve through the new router as RouteDefs; inline handleApi branches are
    removed or cleanly delegate.
  - Handlers are thin and take Ctx + a Db interface (no req/res), so the same core serves REST,
    WS, and unit tests (server parity: the domain functions are host-agnostic).
  - Turnstile runs AFTER withBody and ONLY on register + login (not the challenge route, not a
    global prologue).
  - authThrottled is handler-level on login: per-username, failed-only via recordAuthFailure,
    clears on success via clearAuthFailures, 15m/10-fail.
  - IP-keyed rate limit fires BEFORE the DB token lookup / write on both register and login.
  - isIpBlocked preserved (register, and login with the isAdminAccount bypass); REQUIRE_WEB_LOGIN
    guard preserved; anti-enumeration 404 preserved and documented as a knownDeviation.
  - Dual-path parity: the migrated routes match the Phase 3 fixtures through old vs new dispatch,
    or every diff is a documented knownDeviation (the dash-to-comma 429 detail is matcher-safe;
    confirm userFacingApiError still resolves the "too many attempts" prefix).
  - Stable-code i18n: every player-visible response is emitted as a stable CODE through the error
    model, never English baked into a branch; the server stays language-agnostic (no t(), no DOM);
    new codes are append-only in error_codes.ts.
  - No WS wire/snapshot change; no src/sim/ touch.
- Test-coverage agent: confirm tests cover turnstile ordering after body parse, authThrottled
  accrual AND clear-on-success (using the injected now() clock), the anti-enum 404 deviation,
  the IP-keyed limit firing before the DB lookup, the isAdminAccount login bypass, the
  REQUIRE_WEB_LOGIN 403 guard, the challenge success shape, and cross-fixture parity. Flag any
  acceptance criterion with no test and any happy-path-only handler.
- Dead-code / cleanup agent: confirm the old inline register/login/challenge branches in
  handleApi are actually removed (not left dead alongside the new path), no unused imports remain
  in main.ts, passesTurnstile is not duplicated between main.ts and the middleware, and no
  scaffolding or commented-out code shipped.
- Domain review agents (dispatch ONLY those whose surface this diff touches; check
  `git diff --name-only`):
  - privacy-security-review: REQUIRED (credential surface: auth, IP gate, turnstile, rate limit,
    anti-enum 404, token issuance). Prompt for COVERAGE, not filtering.
  - qa-checklist: REQUIRED.
  Do NOT dispatch migration-safety, cross-platform-sync, or architecture-reviewer (no DDL/JSONB,
  no sim/wire/matcher, no src/sim change).

STEP 3 - FIX
- Apply every BLOCKING and SHOULD-FIX finding. Defer NICE-TO-HAVE to a follow-up note.
- Re-run the validation matrix after fixes:
```
npx tsc --noEmit
npx vitest run tests/server/auth.register.test.ts tests/server/auth.login.test.ts tests/server/auth.attestation.test.ts
npx vitest run tests/server/http/parity.test.ts
npx vitest run tests/localization_fixes.test.ts
npm run ci:changed
npm run build:server
```
- Commit fixes as SEPARATE Conventional Commits with EXPLICIT paths, for example:
  `fix(http): correct turnstile ordering on the login RouteDef (server/auth.ts)`,
  `test(server): cover authThrottled clear-on-success (tests/server/auth.login.test.ts)`.

STEP 4 - UPDATE DOCS + MEMORY
- Update docs/api-pipeline/progress.md and state.md to reflect the QA outcome and any newly
  documented knownDeviation.
- Record in memory any non-obvious rule the audit surfaced (for example: a credential handler
  that returns a distinct status for an unknown username silently breaks the anti-enumeration
  404; or the turnstile middleware must be off the challenge route).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Return one verdict: PASS / PASS-WITH-FOLLOWUPS / FAIL, plus counts (BLOCKING found/fixed,
SHOULD-FIX found/fixed, deferred follow-ups), the validation results, the review verdicts, and a
one-line handoff to "Phase 12: Migrate character ownership + BOLA seam (server/characters.ts)".
````
