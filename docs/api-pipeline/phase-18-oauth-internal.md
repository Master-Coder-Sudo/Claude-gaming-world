# Phase 18: Migrate OAuth JSON + Internal onto the shared seam (oauth.ts + internal.ts)

This phase finishes the migration wave: it ports the two remaining sub-dispatchers,
`handleOAuth` (server/oauth.ts) and `handleInternalApi` (server/internal.ts), onto the
shared `server/http/` seam built in Phases 1 to 9. It is the natural bookend to Phase 17
(admin): both are non-`/api` sub-dispatchers with their own envelope and their own auth
model. The work is deliberately sized to stay under 40% context because the two surfaces
are small and orthogonal (the OAuth POST JSON endpoints and the secret-gated `/internal`
endpoints share no state), the data and HTML-rendering cores already exist and stay
byte-identical (we wrap them in thin Ctx handlers, we do not rewrite them), and there is no
DDL, no JSONB, and no player-facing i18n in scope. The single load-bearing subtlety is
auth: OAuth POST endpoints use the web-session resolver (`fullSessionAccount`) and the
`/internal` endpoints use a shared-secret header gate, so neither routes through the API
`requireAccount` bearer middleware. The GET consent/device HTML pages stay on the top-level
prefix ladder, off the table router, exactly as today.

### Starter Prompt

````
This is Phase 18 of the API Pipeline re-architecture: Migrate OAuth JSON + Internal onto the
shared seam (oauth.ts + internal.ts).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: this phase is NOT batch-heavy (two small surfaces, ~9 internal routes + 5 OAuth
POST routes). Do NOT use ultracode. Hand-spawn 3 parallel Agents as described in STEP 2.
Goal: port the 5 OAuth POST JSON endpoints (RFC 6749 {error,error_description}) and the 9
secret-gated /internal endpoints ({success,data,error}) onto RouteDefs behind the shared
dispatcher, preserving the OAuth web-session auth, the two shared-secret header gates, and
the OAuth GET HTML pages on the top-level ladder, with zero behavior change vs the Phase 3
golden fixtures except documented knownDeviations.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with concurrent sessions. If it is dirty with
  files you do not own, STOP and ask before staging anything. You will commit with EXPLICIT
  paths only, never `git add -A`.
- Scan Claude Code memory for entries in this phase's domain. Suggested topics to look up:
  "PR #1044 Discord integration review" (the DISCORD_SCHEMA unwired-table trap, so you do
  not assume internal/discord tables exist), "PR #1075 Discord choice+unlink review" (the
  isIpBlocked/turnstile parity gaps and the schema wiring already done in Phase 16),
  "Server API pipeline audit" (the locked per-surface envelope + catch-all delegate model),
  and "Shared-worktree commit care" (stage only your files).

STEP 1 - LOAD CONTEXT (do NOT read planning docs or large source files directly; spawn ONE
Explore agent and have it return a written summary)
Tell the Explore agent to read and summarize, anchoring on SYMBOL NAMES and route strings
(main.ts is ~1695 lines; never trust a line number):
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (current pipeline state: which
  domains are migrated, the dispatcher delegate wiring, the parity harness entry point).
- docs/api-pipeline/phase-18-oauth-internal.md (this file).
- server/oauth.ts: handleOAuth (the sub-dispatcher), renderAuthorize, approveAuthorize,
  tokenEndpoint, tokenFromAuthCode, tokenFromDeviceCode, revokeEndpoint, deviceAuthorization,
  renderDevicePage, approveDevice, oauthError, htmlError, fullSessionAccount, seedOAuthClients,
  authorizeHtml. For EACH of the 7 routes record method, path, response content-type, exact
  status codes, the envelope shape, and the auth it performs.
- server/internal.ts: handleInternalApi, handleDiscordInternal, secretsMatch (timingSafeEqual,
  length-guarded), ok, fail, and the 9 route branches. Record the two secret gates
  (x-woc-deploy-secret vs env RESTART_COUNTDOWN_SECRET; x-woc-discord-secret vs env
  DISCORD_BOT_SECRET), the feature-off 404 (no secret env), the wrong-method 404 on
  restart-countdown, and the {success,data,error} envelope.
- server/oauth_db.ts (only the functions the handlers call: revokeReadToken, the grant/device
  lookups) and server/internal.ts's discord_db/discord_activity/discord_relay imports (so you
  know the data cores stay untouched).
- server/CLAUDE.md and root CLAUDE.md (the server invariants: SQL only in *_db.ts, no
  render/ui imports, English-at-source i18n, no WS wire change).
- The prior-phase modules under server/http/ this phase CONSUMES: router.ts (RouteDef shape +
  static/dynamic match + 404-vs-405), compose.ts + context.ts (the onion + Ctx/buildContext),
  schema.ts (object()/str()/num()/enum() validators for the POST bodies + query), errors.ts +
  error_codes.ts + the per-surface mapError serializers from Phase 7 (the RFC 6749
  {error,error_description} serializer, the {success,data,error} serializer, and htmlError),
  registry.ts + index.ts (the barrel + the registry-completeness diff), the middleware set
  (withErrors, withBody, requireAccount and its scope model), config.ts, the Phase 2
  fakeCtx/fake-http + parity-harness driver, and the Phase 3 golden fixtures for /oauth +
  /internal.
What the Explore agent must return: a tight written brief covering (1) the RouteDef metadata
fields and how a domain module exports `export const routes: RouteDef[]`; (2) how the
dispatcher delegates un-migrated paths to the old ladder and how the registry-completeness
diff is run; (3) exactly how mapError picks the RFC 6749 serializer and the {success,data,error}
serializer per route (NOT per prefix), and where htmlError lives; (4) why requireAccount's
API-bearer scope gate does NOT fit either OAuth web-session auth or the internal secret gate;
(5) a per-route table of today's status/envelope/auth/knownDeviation for all 7 OAuth + 9
internal routes; (6) the parity-harness and fixture entry points and the fakeCtx helper
signature.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Hand-spawn 3 parallel Agents, each owning a complete vertical slice (behavior PLUS its tests),
each given ONLY the Explore summary (not the raw files):

- Agent A (oauth-json): port the 5 OAuth POST JSON endpoints to RouteDefs in server/oauth.ts.
  Deliverables:
  - `export const routes: RouteDef[]` covering POST /oauth/authorize (approveAuthorize),
    POST /oauth/token (tokenEndpoint), POST /oauth/revoke (revokeEndpoint),
    POST /oauth/device_authorization (deviceAuthorization), POST /oauth/device (approveDevice).
  - Thin Ctx handlers that call the EXISTING core functions unchanged; the RFC 6749
    {error,error_description} serializer is selected per route via mapError, replacing the
    inline oauthError() sends. Map the existing failure sites onto HttpError + an error_codes
    reason (reuse the RFC 6749 vocabulary: invalid_request, invalid_grant, unsupported_grant_type,
    invalid_client, unauthorized_client, server_error); revoke stays always-200 {ok:true}.
  - Preserve the web-session auth: approveAuthorize and approveDevice resolve the account via
    fullSessionAccount(req), NOT requireAccount. Do NOT route them through the API-bearer scope
    gate. If a tiny middleware is warranted, add requireWebSession (its own module) rather than
    overloading requireAccount; otherwise keep the in-handler fullSessionAccount call.
  - Keep GET /oauth/authorize (renderAuthorize) and GET /oauth/device (renderDevicePage) on the
    top-level prefix ladder, OFF the table router. Do NOT move authorizeHtml/renderDevicePage
    copy (leave their pre-existing text untouched so no copy change enters your diff).
  - Tests in tests/server/oauth.test.ts: RFC 6749 envelope contract (frozen shape per route),
    grant=authorization_code and grant=device both routed by tokenEndpoint, revoke always-200,
    unsupported_grant_type -> 400, unknown OAuth path -> 404 not_found, parity vs the Phase 3
    /oauth fixtures.

- Agent B (internal): port the 9 /internal endpoints to RouteDefs in server/internal.ts.
  Deliverables:
  - `export const routes: RouteDef[]` covering POST /internal/restart-countdown and the 8
    /internal/discord/* endpoints: GET flex, GET roles, POST presence, POST grant, POST member,
    GET relay, GET activity, POST members-meta. Thin Ctx handlers call the existing cores
    (game.startRestartCountdown, discordFlexForAccount, grantRewardPoints, drainRelay,
    drainActivity, setDiscordPresenceCache, setDiscordGuildMember, setDiscordMemberMeta)
    unchanged; the {success,data,error} envelope is selected per route via mapError, replacing
    the inline ok()/fail() sends.
  - Consume the requireInternalSecret middleware from Agent C: restart-countdown carries
    {header:'x-woc-deploy-secret', envVar:'RESTART_COUNTDOWN_SECRET'}; every /internal/discord/*
    route carries {header:'x-woc-discord-secret', envVar:'DISCORD_BOT_SECRET'}. The gate stays
    timing-safe (secretsMatch / timingSafeEqual) and returns 401 'not authenticated' on a bad
    secret and a feature-off 404 'unknown endpoint' when the env var is empty.
  - PRESERVE the knownDeviations: restart-countdown is POST-only and returns 404 (NOT 405) on a
    wrong method (anti-enumeration / feature-hiding), so mark it requireOwned*-irrelevant and
    add a knownDeviation entry so the table router's default 405+Allow does not regress it;
    feature-off (empty env) returns 404; countdown-already-active returns 409 with the status
    payload.
  - Tests in tests/server/internal.test.ts: bad secret -> 401, empty-env -> 404, wrong method ->
    404 on restart-countdown, each of the 8 discord routes reachable behind the gate, the
    {success,data,error} envelope frozen, parity vs the Phase 3 /internal fixtures.

- Agent C (middleware + boundary): the shared secret-gate middleware plus the cross-surface
  guards. Deliverables:
  - server/http/middleware/require_internal_secret.ts: requireInternalSecret({header, envVar})
    returning a Mw that reads the header, compares it timing-safely against process.env[envVar]
    (reuse the existing timingSafeEqual length-guarded compare; do not hand-roll a new one),
    short-circuits with the feature-off 404 when the env is empty and 401 when it mismatches,
    and otherwise calls next(). The header names and env var names are NAMED constants, single
    source of truth (no magic strings).
  - tests/server/http/require_internal_secret.test.ts: empty-env 404, mismatch 401 (and that
    the compare is constant-time-shaped, i.e. length-guarded), pass-through on match.
  - The per-surface CONTRACT test freezing the RFC 6749 {error,error_description} shape and the
    {success,data,error} shape (extend the Phase 7 contract test, do not fork it).
  - A boundary assertion that GET /oauth/authorize and GET /oauth/device are NOT in the route
    registry (they stay on the top-level ladder) and still dispatch to HTML, plus a
    registry-completeness check that every migrated /oauth POST path and every /internal path is
    present in the new router (the Phase 9 old-vs-new path-set diff includes them).

This phase has NO documented a/b split. If your context approaches 40%, split along the
existing agent seam: ship Agent A (OAuth) as one PR and Agents B+C (internal + middleware) as
the next stacked PR; do not interleave them.

INVARIANTS THIS PHASE MUST KEEP
- Single-flag dispatch + per-path catch-all delegate: the new dispatcher runs ahead of the old
  ladder; any path you do NOT migrate still delegates to the old handler unchanged. Migrate
  every listed route in this phase so no /oauth POST or /internal path is left dual-pathed.
- Server-authority + trust-nothing: every handler stays thin and calls the existing server-side
  core; no outcome moves to the client. The OAuth token/revoke/device flows and the internal
  reward-grant path keep their exact current authorization.
- Per-surface envelopes via mapError, never one global serializer: RFC 6749 {error,
  error_description} for OAuth POST JSON; {success,data,error} for /internal; htmlError for the
  OAuth GET pages (which stay off the table). Selection is per route, not per prefix.
- Stable-code i18n: server stays language-agnostic. NOTE the scope here: /internal endpoints are
  bot/operator-facing and OAuth protocol codes (invalid_grant, etc.) are RFC 6749 tokens, so
  NONE of this phase's strings are player-visible game text and NONE feed userFacingApiError or
  the apiError.* catalog. Do not add client catalog entries here; do not localize RFC 6749 codes.
- Secret-gate integrity: the x-woc-deploy-secret and x-woc-discord-secret compares stay
  timing-safe (timingSafeEqual, length-guarded). Never log, echo, or leak a secret or a bearer.
- No magic values: header names, env var names, status codes, and the RFC 6749 reason strings
  are named constants / error_codes entries, single source of truth.
- No DDL / no JSONB change this phase: the discord_db tables were wired in Phase 16 and oauth_db
  is already wired; you only CONSUME them. If you find yourself editing ensureSchema or a
  *_SCHEMA, STOP (out of scope).
- No WS wire change, no src/sim/ touch (this is server-only; determinism and sim-purity are not
  in play but must not be disturbed).
- No em dashes, en dashes, or emojis in code, comments, tests, commits, or docs. Leave the
  pre-existing consent-page copy untouched so no copy change (and no stray em dash) enters your
  diff; the systematic copy sweep is a separate deferred follow-up.

OUT OF SCOPE (do not do these here)
- The Discord /api family (POST /api/auth/discord/start, the callback, GET/DELETE /api/discord):
  migrated in Phase 16, done.
- The two-tier rate limiter rework and any NEW limiter: Phase 19. Do not add an IP/account
  limiter to OAuth or internal; keep whatever (if any) they have today.
- The security-headers top-level wrapper and 415/Origin enforcement: Phase 21. Just keep the
  GET pages on the top-level ladder so the future wrapper covers them; do not add headers here.
- The REST i18n matcher and apiError.* catalog: Phase 22, and not applicable to these surfaces.
- Fixing the pre-existing em dashes in the consent-page HTML copy: deferred copy sweep, not a
  routing-migration task.
- The market realm-scope fix, config consolidation, metrics/logging: Phases 20, 23, 24.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order:
- `npx tsc --noEmit`
- `npx vitest run tests/server/oauth.test.ts tests/server/internal.test.ts tests/server/http/require_internal_secret.test.ts`
- `npx vitest run` the parity harness and the registry-completeness suite (the Phase 9 dual-path
  diff) so the /oauth POST + /internal paths show zero undocumented diff and zero dropped route.
- `npm run ci:changed` (Biome on changed files only; never a whole-tree --write).
- `npm run build:server`
Then dispatch the review agents whose surface this diff touches (run `git diff --name-only`
first; this phase touches server/ only, no DDL, no src/sim, no wire, no client i18n):
- privacy-security-review: REQUIRED. This diff carries the OAuth token/revoke/device credential
  flow, the web-session auth on the consent POSTs, and two shared-secret header gates. Prompt it
  for COVERAGE (every authz/secret-handling gap with confidence + severity), not filtering:
  confirm the timing-safe compare is preserved, the feature-off 404 + bad-secret 401 are intact,
  no secret/bearer is logged, and approveAuthorize/approveDevice did not silently widen auth.
- qa-checklist: REQUIRED at completion (the end-of-contribution gate).
- migration-safety: ONLY if your diff unexpectedly touches ensureSchema / a *_SCHEMA / discord_db
  wiring (it should NOT). If it does, you are out of scope; stop and re-scope.
- cross-platform-sync / architecture-reviewer: NOT applicable (no wire, no sim, no client matcher).
If a review is truncated, resume it with: "Continue the review from where you stopped; do not
restart." Do NOT commit until each dispatched reviewer reports no BLOCKING findings.

STEP 4 - COMMIT CADENCE (Conventional Commits with a scope, EXPLICIT paths; stacked-PR chain:
this phase ships as its own green, bisectable PR)
- `feat(http): add requireInternalSecret timing-safe header-secret gate middleware`
  -- server/http/middleware/require_internal_secret.ts,
     tests/server/http/require_internal_secret.test.ts
- `feat(oauth): port /oauth POST JSON endpoints onto RouteDefs with the RFC 6749 envelope`
  -- server/oauth.ts, tests/server/oauth.test.ts
- `feat(internal): port /internal endpoints onto RouteDefs preserving the secret gates`
  -- server/internal.ts, tests/server/internal.test.ts
- `test(server): freeze oauth+internal per-surface contracts and dual-path parity`
  -- tests/server/http/error_contract.test.ts (extend), tests/server/parity/*.test.ts
- `docs(api-pipeline): record phase 18 oauth+internal migration`
  -- docs/api-pipeline/progress.md, docs/api-pipeline/state.md

STEP 5 - ACCEPTANCE CRITERIA (verifiable; every box must be checked before STEP 6)
- [ ] server/oauth.ts exports `routes: RouteDef[]` for POST /oauth/authorize, /oauth/token,
      /oauth/revoke, /oauth/device_authorization, /oauth/device; GET /oauth/authorize and GET
      /oauth/device remain on the top-level ladder and still return HTML.
- [ ] OAuth POST errors serialize as RFC 6749 {error[, error_description]} via mapError (frozen
      by the contract test); revoke is still always-200 {ok:true}; unsupported_grant_type is 400;
      unknown /oauth path is 404 not_found.
- [ ] approveAuthorize and approveDevice still authenticate via the web session
      (fullSessionAccount), NOT requireAccount; cross-checked by a test.
- [ ] server/internal.ts exports `routes: RouteDef[]` for /internal/restart-countdown and the 8
      /internal/discord/* endpoints; all dispatch through the new router.
- [ ] requireInternalSecret enforces a timing-safe compare, returns 404 when the env secret is
      empty, 401 on mismatch, and passes through on match; restart-countdown uses
      x-woc-deploy-secret/RESTART_COUNTDOWN_SECRET and every discord route uses
      x-woc-discord-secret/DISCORD_BOT_SECRET, from named constants.
- [ ] restart-countdown still returns 404 (not 405) on a wrong method and 409 on already-active,
      recorded as knownDeviations.
- [ ] /internal responses serialize as {success,data,error} via mapError (frozen by the contract
      test).
- [ ] The dual-path parity harness shows zero undocumented diff for every /oauth POST and
      /internal path; the registry-completeness diff shows no dropped route.
- [ ] `npx tsc --noEmit`, the three new test files, `npm run ci:changed`, and `npm run
      build:server` are all green; no em dash / en dash / emoji in the diff.
- [ ] privacy-security-review and qa-checklist report no BLOCKING findings.

STEP 6 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md: mark Phase 18 done; name the new module
  server/http/middleware/require_internal_secret.ts, the two domain route tables
  (server/oauth.ts, server/internal.ts), and the migrated paths (5 OAuth POST + 9 internal).
- Update docs/api-pipeline/state.md: record that OAuth and Internal are now on the shared seam,
  that the OAuth GET HTML pages remain on the top-level ladder, the two secret-gate (header,env)
  pairs, and the restart-countdown 404-on-wrong-method knownDeviation.
- Record in Claude Code memory anything surprising: the OAuth POST consent endpoints use the
  web-session resolver not the API bearer; /internal uses {success,data,error} (admin-style) not
  problem+json and is bot-facing so it is OUT of player i18n scope; the two distinct secret
  headers (x-woc-deploy-secret vs x-woc-discord-secret) and their env vars.

STEP 7 - FINAL RESPONSE FORMAT (return exactly this, concise)
- Phase status: DONE / BLOCKED.
- Files touched (absolute paths).
- Validation results: tsc, the test files, parity/registry diff, ci:changed, build:server.
- Review verdicts: privacy-security-review, qa-checklist (and migration-safety only if it ran).
- Deferrals (e.g. the consent-page em-dash copy sweep).
- One-line handoff: "Ready for Phase 18 QA (phase-18-qa.md)."

STOPPING RULES (stop and surface, do not push through)
- Stop if a migrated /oauth or /internal route's parity fixture diffs without a documented
  knownDeviation.
- Stop if any change would alter the WS wire protocol or require touching src/sim/ (it must not).
- Stop if preserving the secret gate would require weakening the timing-safe compare, or if you
  cannot keep both secret-header/env pairs distinct.
- Stop if migrating an OAuth POST endpoint would change its auth model (e.g. routing the consent
  POSTs through requireAccount instead of the web session).
- Stop if the change would touch ensureSchema, a *_SCHEMA, or any DDL/JSONB shape (out of scope;
  no persistence change this phase).
- Stop if you cannot keep the OAuth GET HTML pages on the top-level ladder (they must NOT enter
  the table router).
````
