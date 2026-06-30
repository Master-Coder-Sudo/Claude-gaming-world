# Phase 11: Migrate auth (register/login/native-attestation)

This phase migrates the credential surface (`POST /api/register`, `POST /api/login`,
`POST /api/native-attestation/challenge`) off the inline `handleApi` ladder in `server/main.ts`
and onto the shared `server/http/` pipeline assembled in Phases 4 to 9. It is the highest
sensitivity surface, so it ships isolated as its own green PR in the stacked chain. It is sized
low context risk: three POST routes, one new per-route middleware, no persistence change, and a
parity harness that already exists from Phase 3, so a fresh session stays well under the 40%
context bound. The work is purely structural plus the documented hardening knownDeviations; the
server stays language-agnostic (stable codes, never English baked into a decision) and the WS
wire protocol is untouched.

### Starter Prompt

````
This is Phase 11 of the API Pipeline re-architecture: Migrate auth (register/login/native-attestation).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: do NOT add ultracode. This phase is small (three POST routes, one middleware, no batch
sweep); hand-spawn the parallel agents named in STEP 2.
Goal: serve /api/register, /api/login, and /api/native-attestation/challenge through the shared
server/http/ pipeline as RouteDefs, behavior-identical to today except the documented hardening
knownDeviations, with the credential-surface checks (turnstile, authThrottled, IP gate,
anti-enumeration 404) preserved in their exact order.

STEP 0 - PRE-FLIGHT
- Run `git status`. This is a SHARED worktree with concurrent sessions: if it is dirty with files
  you do not own, STOP and ask before staging anything. You will commit with EXPLICIT paths only,
  never `git add -A`.
- Scan Claude Code memory for entries in this phase's domain. Suggested topics to look up:
  "auth / turnstile", "rate limit and authThrottled", "anti-enumeration 404", "isIpBlocked
  parity gap from prior Discord reviews", "em-dash rate-limit strings". Surface anything that
  changes the plan before you start.

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or main.ts directly; spawn ONE Explore agent)
Tell the Explore agent to read and return a tight, symbol-anchored summary (no raw file dumps,
anchor on symbol names and route strings, NOT line numbers; server/main.ts is ~1695 lines) of:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (current pipeline state, which
  domains are already migrated, the dispatch-flag + per-path catch-all delegate model).
- docs/api-pipeline/phase-11-auth.md (this file).
- server/main.ts: the handleApi branches for /api/register, /api/login, and
  /api/native-attestation/challenge; the passesTurnstile helper; the isWebClientRequest +
  REQUIRE_WEB_LOGIN web-login guard; game.isIpBlocked(requestIp(req)) usage on register and on
  login (note the isAdminAccount bypass on login); and the existing success-response shapes
  (tokens, account fields).
- server/auth.ts: hashPassword, verifyPassword, newToken, validUsername, validUsernameShape,
  validPassword, offensiveUsername, MIN/MAX_PASSWORD_LENGTH.
- server/ratelimit.ts: rateLimited (IP-keyed), requestIp, and the authThrottled family
  (authThrottled, recordAuthFailure, clearAuthFailures, AUTH_FAIL_WINDOW_MS=15m,
  MAX_AUTH_FAILURES=10), plus the injected now() clock seam added in Phase 2.
- server/turnstile.ts (the verifier passesTurnstile wraps) and server/web_login_guard.ts.
- server/native_attestation.ts: nativeAttestationRequired, createNativeAttestationChallenge.
- server/CLAUDE.md and root CLAUDE.md (server-only, stable-code i18n, no em dashes/emojis,
  module-first, never grow main.ts).
- The prior-phase spine this phase CONSUMES under server/http/: router.ts, compose.ts,
  context.ts (Ctx + buildContext), schema.ts (object/str/num/enum + Infer), errors.ts
  (HttpError + mapError, problem+json serializer), error_codes.ts (the as-const append-only
  catalog), registry.ts + index.ts (barrel), middleware/* (withErrors, requestId, withCors,
  withBody, requireAccount, the thin rateLimit adapter), and config.ts.
- The Phase 2 harness (fakeCtx, fake-http, FakeDb, the per-pass-isolated parity driver) and the
  Phase 3 characterization fixtures for the auth routes (the seeded knownDeviation list).
- server/leaderboard.ts from Phase 10 as the migration TEMPLATE (how a domain exports
  `export const routes: RouteDef[]` with thin no-req/res handlers).
Ask the Explore agent to RETURN: the exact current request flow for each of the three routes
(validation, turnstile ordering, IP gate, web-login guard, rate-limit ordering, authThrottled
accrual + clear-on-success, anti-enumeration 404, success shape + emitted tokens), the RouteDef
and middleware type signatures, how the parity driver runs a fixture through both dispatchers,
and the leaderboard.ts pattern to copy.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
There is NO documented a/b split for this phase; run it as one session. Give EACH agent ONLY the
Explore summary (not the planning docs). Hand-spawn three parallel agents, each a complete
vertical slice (behavior + its own test file). To keep the fan-out conflict-free, agents A and B
EXPORT their domain function + RouteDef object; agent C OWNS the single `routes` array assembly,
the new error codes, the turnstile middleware, and the registry wiring (so only C edits the
shared seams). Each agent writes its OWN test file.
- Agent A (register): extract the register request logic from main.ts handleApi into a thin
  no-req/res domain function on server/auth.ts (handlers take Ctx + a Db interface, never
  req/res), behind a RouteDef. Preserve in order: the REQUIRE_WEB_LOGIN + isWebClientRequest 403
  guard, the IP-keyed rate limit BEFORE the DB write, game.isIpBlocked(requestIp) gate, then
  the username/password validation and account create. Carry forward the isIpBlocked parity
  gap (register must keep the IP-block check). Deliverables: domain fn + RouteDef + tests in
  tests/server/auth.register.test.ts.
- Agent B (login): same extraction for /api/login. Preserve in order: web-login guard, IP-keyed
  rate limit BEFORE the DB token lookup, then authThrottled(username) as a HANDLER-level check
  (per-username, failed-only via recordAuthFailure, clears on success via clearAuthFailures, the
  15m/10-fail window), then game.isIpBlocked(requestIp) WITH the isAdminAccount bypass. Keep the
  anti-enumeration 404 (no signal that the account or block exists). Deliverables: domain fn +
  RouteDef + tests in tests/server/auth.login.test.ts.
- Agent C (attestation + shared seams): port /api/native-attestation/challenge (calls
  createNativeAttestationChallenge, returns {challengeId, nonce, expiresInMs}; NO turnstile on
  this route); write server/http/middleware/turnstile.ts as a per-route POST-body middleware
  that runs AFTER withBody and is attached ONLY to the register + login RouteDefs (not a global
  prologue, not on the challenge route); APPEND the auth.* reason codes the three handlers emit
  to server/http/error_codes.ts (reuse the existing domain.reason vocabulary, append-only per
  AIP-193: credential failure, username conflict (409), turnstile failure, web-login-required,
  ip-blocked, rate-limited, attestation-challenge errors); assemble `export const routes:
  RouteDef[]` on server/auth.ts from A and B's RouteDefs plus the challenge route; register it
  in server/http/registry.ts. Record the auth fixture knownDeviations (see below). Deliverables:
  challenge domain fn + RouteDef, turnstile middleware, error codes, routes barrel + registry
  wiring, tests in tests/server/auth.attestation.test.ts.
After the three slices land, run the parity harness over the auth fixtures and reconcile any
diff against the knownDeviation list (do not let an undocumented diff through).

INVARIANTS THIS PHASE MUST KEEP
- Server-authority: the server decides every auth outcome; the migrated handlers stay
  authoritative. No outcome moves to the client.
- Single-flag dispatch + per-path catch-all delegate: the new router sits in front; only these
  three paths now resolve on the new path, every other auth-adjacent path still delegates
  unchanged to the old ladder. Do not touch the delegate or the dispatch flag.
- Stable-code i18n: every player-visible response is emitted through the shared error model as a
  stable CODE (problem+json with a machine `code`), re-localized client-side, never English baked
  into a branch. The server stays language-agnostic (no t(), no DOM).
- No em dashes, en dashes, or emojis anywhere (code, comments, commits, docs). The new path's
  rate-limit message routes through the Phase 7 error model, which already uses a comma, so the
  429 detail differs from the old ladder's U+2014 string by dash-to-comma only. That diff is a
  documented, matcher-safe knownDeviation (userFacingApiError matches the "too many attempts"
  prefix before the dash). Do NOT reintroduce an em dash, and do NOT edit the OLD-ladder em-dash
  strings here (that is Phase 13).
- No magic values: reuse the existing named constants (AUTH_FAIL_WINDOW_MS, MAX_AUTH_FAILURES,
  the rateLimited default max, the turnstile scope). Do not retype literals.
- Additive idempotent DDL + JSONB back-compat: NOT APPLICABLE, this phase adds no tables or
  columns and changes no persisted shape. If you find yourself writing DDL, STOP, it is out of
  scope.
- Determinism / sim-purity: server-only. Do NOT touch src/sim/. Limiter-dependent tests use the
  injected now() clock from Phase 2 so windows and accrual are deterministic.

OUT OF SCOPE (do not let scope creep in)
- Character ownership, /api/me/characters, and the requireOwned* BOLA loader: that is Phase 12.
  Register/login/challenge own no resource, so introduce NO ownership loader here.
- The /api/account/* portal and the OLD-ladder em-dash string fix: Phase 13.
- Extending userFacingApiError to look up codes directly and the per-surface code-parity guard:
  Phase 22. Here you only APPEND codes to error_codes.ts; the existing prose-matcher still
  resolves the migrated responses (parity preserved).
- The Discord auth routes (/api/auth/discord/*): Phase 16.
- The deep two-tier rate-limiter rework and ratelimit_db.ts: Phase 19. Use the THIN rateLimit
  adapter from Phase 8 as-is.
- WS auth and the importable spine: done in Phase 1. Do not re-extract it.
- Flipping the dispatch-flag default to the new path: Phase 25.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run the validation matrix for a migration phase that adds player-facing codes:
```
npx tsc --noEmit
npx vitest run tests/server/auth.register.test.ts tests/server/auth.login.test.ts tests/server/auth.attestation.test.ts
npx vitest run tests/server/http/parity.test.ts   # the dual-path parity harness over the auth fixtures
npx vitest run tests/localization_fixes.test.ts    # S3 guard (server stays language-agnostic)
npm run ci:changed                                  # Biome on changed files only
npm run build:server
```
Pre-merge gate (mirror CI) before opening the PR:
```
npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build
```
Then dispatch ONLY the review agents whose surface this diff touches (check `git diff
--name-only` first; this diff is server/ auth + http/ + tests only):
- privacy-security-review: REQUIRED. This is the credential surface (auth, IP gate, turnstile,
  rate limit, anti-enumeration 404, token issuance). Prompt it for COVERAGE, not filtering:
  report every correctness or requirement gap with confidence and severity, especially any
  weakening of the turnstile ordering, the authThrottled accrual/clear, the IP-block gate, or
  token handling.
- qa-checklist: REQUIRED at phase completion (the end-of-contribution gate).
Do NOT dispatch migration-safety (no DDL/JSONB change), cross-platform-sync (no sim/wire/matcher
change), or architecture-reviewer (no src/sim change).
Add this line to each review dispatch: "If your review is truncated, resume from the last file
you finished and continue; do not restart."
Do not commit the PR as ready until each dispatched reviewer reports no BLOCKING finding.

STEP 4 - COMMIT CADENCE (Conventional Commits, scope, EXPLICIT paths; this phase ships as its
own green PR in the stacked chain)
- feat(http): add auth RouteDefs and per-route turnstile middleware
  (server/auth.ts, server/http/middleware/turnstile.ts, server/http/error_codes.ts,
   server/http/registry.ts)
- refactor(server): extract register/login/native-attestation handlers from handleApi into thin
  Ctx handlers (server/main.ts, server/auth.ts)
- test(server): parity + unit coverage for migrated auth routes
  (tests/server/auth.register.test.ts, tests/server/auth.login.test.ts,
   tests/server/auth.attestation.test.ts)
- docs(api-pipeline): record Phase 11 auth migration
  (docs/api-pipeline/progress.md, docs/api-pipeline/state.md)

STEP 5 - ACCEPTANCE CRITERIA (verifiable checkboxes)
- [ ] /api/register, /api/login, /api/native-attestation/challenge resolve through the new
      router as RouteDefs; their inline branches are removed from handleApi (or delegate cleanly).
- [ ] Handlers are thin and take Ctx + a Db interface (no req/res), so the same core is unit
      testable and host-agnostic.
- [ ] passesTurnstile runs as a per-route POST-body middleware AFTER withBody, attached ONLY to
      register + login (NOT the challenge route, NOT a global prologue).
- [ ] authThrottled preserved as a handler-level check on login: per-username, failed-only via
      recordAuthFailure, cleared on success via clearAuthFailures, 15m window / 10 failures.
- [ ] The IP-keyed rate limit fires BEFORE the DB token lookup / account write on both register
      and login (onion order verified).
- [ ] game.isIpBlocked(requestIp) preserved: on register (no bypass) and on login (with the
      isAdminAccount bypass), reusing the rate-limit message so a blocked client gets no signal.
- [ ] REQUIRE_WEB_LOGIN + isWebClientRequest 403 guard preserved for register + login.
- [ ] The anti-enumeration 404 on register/login is preserved and recorded in the parity
      knownDeviation list (documented, not silent).
- [ ] The parity harness is green over the auth fixtures, or every diff is a documented
      knownDeviation (the dash-to-comma 429 detail is matcher-safe).
- [ ] New auth.* codes are APPENDED to error_codes.ts (append-only); the S3 guard is green.
- [ ] tsc clean, build:server clean, ci:changed clean; WS wire protocol unchanged.

STEP 6 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md: mark Phase 11 done; name the migrated endpoints
  (/api/register, /api/login, /api/native-attestation/challenge), the new module pieces
  (server/auth.ts `routes` export, server/http/middleware/turnstile.ts), and the appended
  auth.* error codes.
- Update docs/api-pipeline/state.md: auth domain now on the new path; turnstile is a per-route
  middleware scoped to register+login; authThrottled stays handler-level; the auth fixture
  knownDeviations (anti-enum 404, dash-to-comma 429 detail).
- Record in memory any surprising rule you hit (for example: the dash-to-comma 429 detail is a
  knownDeviation only because the new error model already uses a comma and the matcher keys on
  the prefix; the old-ladder em-dash fix is Phase 13's job, not this one).

STEP 7 - FINAL RESPONSE FORMAT
Return: phase status (done / blocked), files touched (absolute paths), validation results
(tsc / vitest / parity / S3 / build:server / ci:changed), review verdicts (privacy-security-review,
qa-checklist), any deferrals, and a one-line handoff to "Phase 11 QA".

STOPPING RULES
- STOP if a migrated route's parity fixture diffs without a matching documented knownDeviation.
- STOP if any change would alter the WS wire protocol or snapshots.
- STOP if determinism or sim-purity would be violated (any src/sim/ touch).
- STOP if a fix would require editing the OLD-ladder em-dash strings (Phase 13) or extending
  userFacingApiError (Phase 22): surface it and defer, do not pull it forward.
- STOP if a new error code is not append-only to error_codes.ts.
- STOP if the IP-keyed rate-limit ordering (before the DB token lookup) cannot be preserved
  through the onion.
- STOP if this turns into a BOLA/ownership change: register/login/challenge own no resource and
  must NOT gain a requireOwned* loader (that is Phase 12).
````
