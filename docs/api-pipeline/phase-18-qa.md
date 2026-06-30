# Phase 18 QA: OAuth JSON + Internal migration

This is the QA pass for Phase 18 (porting `handleOAuth` and `handleInternalApi` onto the
shared `server/http/` seam). It audits the implementation diff for correctness, test coverage,
and dead code, then dispatches only the domain reviewers whose surface the diff actually
touches (server, secrets, auth). It is sized to stay under 40% context because the diff is two
small domain modules plus one middleware, with no DDL, no JSONB, no wire change, and no
player-facing i18n: the audit is bounded to envelope/auth/secret-gate correctness and the
dual-path parity already established by the harness. The correctness agent re-verifies every
acceptance criterion from phase-18-oauth-internal.md, the server-side parity (old ladder vs new
router), and the per-surface contract shapes.

### QA Starter Prompt

````
This is the QA pass for Phase 18 of the API Pipeline re-architecture: Migrate OAuth JSON +
Internal onto the shared seam (oauth.ts + internal.ts).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: verify the Phase 18 implementation is correct, fully tested, dead-code-free, and parity-
clean, then apply BLOCKING and SHOULD-FIX findings and re-validate.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED. If it is dirty with files you do not own, STOP and
  ask before staging. Commit with EXPLICIT paths only, never `git add -A`.
- Confirm Phase 18 implementation commits are present (the requireInternalSecret middleware, the
  oauth.ts + internal.ts route tables, their tests). If they are absent, STOP: there is nothing
  to QA.
- Scan Claude Code memory for: "PR #1044 Discord integration review" and "PR #1075 Discord
  choice+unlink review" (isIpBlocked/turnstile parity + the schema-wiring history), and "Server
  API pipeline audit" (the locked envelope + delegate model).

STEP 1 - EXPLORE LOAD (spawn ONE Explore agent; do not read large files directly)
Have it read and summarize, anchoring on symbol names and route strings:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (post-Phase-18 state).
- docs/api-pipeline/phase-18-oauth-internal.md (THE acceptance criteria, invariants, and out-of-
  scope list this QA verifies against).
- The Phase 18 git diff: `git diff main...HEAD -- server/oauth.ts server/internal.ts
  server/http/middleware/require_internal_secret.ts tests/server/oauth.test.ts
  tests/server/internal.test.ts tests/server/http/require_internal_secret.test.ts
  tests/server/http/error_contract.test.ts tests/server/parity` (adjust the base to the phase's
  branch point if not main).
What the Explore agent must return: the list of routes actually migrated (5 OAuth POST + 9
internal), the envelope + serializer each route resolves through, how each handler authenticates
(web session vs secret gate vs none), which routes stay on the top-level ladder, and the exact
set of tests added and what each asserts.

STEP 2 - QA AUDIT (spawn these agents in parallel; give each ONLY the Explore summary + the
specific diff hunks it needs)
- Correctness agent. Verify EVERY acceptance criterion in phase-18-oauth-internal.md against the
  real code, plus:
  - Server parity / three-host consistency: the migrated /oauth POST and /internal routes
    produce byte-identical responses (status, body, contracted headers) to the old ladder for
    every Phase 3 fixture, with any diff backed by a documented knownDeviation. This is a server-
    only change, so the relevant parity is old-ladder vs new-router (not client/headless), but
    confirm no behavior the offline/headless hosts depend on (none here) was disturbed.
  - Per-surface envelopes: OAuth POST errors are RFC 6749 {error[, error_description]} (frozen by
    the contract test), /internal is {success,data,error}, the OAuth GET pages still return HTML
    and are NOT in the registry, selection is per route via mapError not per prefix.
  - Auth integrity: approveAuthorize/approveDevice still use fullSessionAccount (web session),
    NOT requireAccount; the token/revoke/device flows keep their exact authorization; revoke is
    still always-200.
  - Secret gate: requireInternalSecret compares timing-safely (timingSafeEqual, length-guarded),
    returns 404 on empty env and 401 on mismatch, with the correct (header, env) pair per surface
    (x-woc-deploy-secret/RESTART_COUNTDOWN_SECRET; x-woc-discord-secret/DISCORD_BOT_SECRET) from
    named constants; restart-countdown still 404s on wrong method and 409s on already-active.
  - Stable-code i18n scope: confirm NO player-facing string was introduced and NO RFC 6749 code
    or internal {error} string was wrongly added to userFacingApiError or the apiError.* catalog
    (these surfaces are out of player i18n scope); the server stays language-agnostic.
- Test-coverage agent. Confirm a test exists for each acceptance criterion and each knownDeviation
  (RFC 6749 contract, grant=authorization_code and grant=device, revoke always-200, unsupported
  grant 400, unknown path 404; each /internal route reachable behind the gate; empty-env 404,
  mismatch 401, wrong-method 404, already-active 409; the {success,data,error} contract; the GET-
  pages-off-table boundary; the registry-completeness diff). Flag any path asserted by prose but
  not by a test, and any test that asserts a fiction (e.g. a fake req/res that does not model the
  real headers path).
- Dead-code / cleanup agent. Find leftover inline oauthError()/ok()/fail() sends that the
  RouteDef path made unreachable, dual-defined handlers, unused imports, an orphaned old
  dispatch arm in handleOAuth/handleInternalApi, or a hand-rolled secret compare that duplicates
  secretsMatch. Confirm no GET-page HTML core (authorizeHtml/renderDevicePage) was needlessly
  edited (no copy churn, no new em dash).
- Domain reviewers (dispatch ONLY those whose surface the diff touches; run `git diff
  --name-only` first):
  - privacy-security-review: REQUIRED (OAuth credential flow, web-session auth, two shared-secret
    gates). Prompt for COVERAGE: timing-safe compare preserved, feature-off 404 + bad-secret 401
    intact, no secret/bearer logged or echoed, no auth widening on the consent POSTs.
  - migration-safety: ONLY if the diff touches ensureSchema / a *_SCHEMA / discord_db wiring (it
    must NOT; flag as out-of-scope if it does).
  - cross-platform-sync / architecture-reviewer: NOT applicable (no wire, no src/sim, no client
    matcher). Do not dispatch.
If any agent or reviewer is truncated, resume it with: "Continue from where you stopped; do not
restart."

STEP 3 - FIX (apply BLOCKING + SHOULD-FIX; defer NICE-TO-HAVE with a note)
- Make the smallest change that turns each finding green; add or tighten a test first when the
  finding is a missing assertion.
- After fixes, re-run the validation matrix for this change type (server code, no DDL, no player
  text):
  - `npx tsc --noEmit`
  - `npx vitest run tests/server/oauth.test.ts tests/server/internal.test.ts
    tests/server/http/require_internal_secret.test.ts` plus the parity + registry-completeness
    suites
  - `npm run ci:changed` (Biome on changed files only)
  - `npm run build:server`
  - Pre-merge gate (mirror CI) once green: `npm test && npx tsc --noEmit && npm run build:env &&
    npm run build:server && npm run build`
- Commit fixes as SEPARATE Conventional-Commit commits with explicit paths, e.g.
  `fix(internal): return feature-off 404 before reading the request body`,
  `test(oauth): assert approveDevice rejects an API bearer that is not a web session`.

STEP 4 - UPDATE DOCS + MEMORY
- Update docs/api-pipeline/progress.md and state.md to reflect the QA outcome and any fix-time
  deltas (new tests, a corrected knownDeviation).
- Record in memory any surprising rule confirmed during QA (e.g. the OAuth consent POST web-
  session auth, the two distinct secret headers, /internal being bot-facing and i18n-exempt).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT (return exactly this, concise)
- Verdict: PASS / PASS-WITH-FOLLOWUPS / FAIL.
- Counts: findings by severity (BLOCKING / SHOULD-FIX / NICE-TO-HAVE), how many fixed, how many
  deferred.
- Validation results: tsc, the test files, parity/registry diff, ci:changed, build:server, and
  the pre-merge gate.
- Review verdicts: privacy-security-review, qa-checklist (and migration-safety only if it ran).
- Deferrals / follow-ups (e.g. the consent-page em-dash copy sweep).
- One-line handoff: "Ready for Phase 19 implementation (phase-19-rate-limiter.md)."
````
