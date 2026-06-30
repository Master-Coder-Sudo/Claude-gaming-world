# Phase 17: Migrate Admin API onto the shared seam (server/admin.ts)

This phase ports the entire `/admin/api/*` surface (the ~19-branch `handleAdminApi`
sub-dispatcher, roughly 30 method+path RouteDefs) off its inline if-ladder and onto `RouteDef`s
consumed by the spine built in Phases 4 to 9, plus the BOLA seam from Phase 12. It is the
heaviest migration phase (context risk: high) because the admin surface has its own auth model
(a bearer whose account is `is_admin`, not the account-owner scope), its own response envelope
(`{success, data, error}`, NOT problem+json), its own pagination contract (`page`/`limit`, NOT
the convention B `page`/`pageSize`), a regex enum-segment route (`suspend|unsuspend|ban|unban`)
that violates the no-regex-routing guard, ~12 operator-scoped `:id` routes that must be excluded
from the account-owner BOLA coverage clause, an isolated `admin.login` limiter store, and live
`game.*` side effects (disconnect, ban-email, filter reload) that the thin handlers must keep.
Because of that surface area this phase carries a documented a/b split (17a auth/overview/online/
accounts/ip, 17b chat-filter/moderation-queue/bug-reports/characters): if context approaches 40%,
ship 17a as its own green stacked PR first, then 17b. It adds no new DDL and changes no WS wire,
which keeps each half under the 40% bound.

The implementation Starter Prompt below is self-contained: a fresh-context Claude Code session
can paste and run it without reading the rest of this packet.

### Starter Prompt

````
This is Phase 17 of the API Pipeline re-architecture: Migrate Admin API onto the shared seam
(server/admin.ts). Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: this phase is batch-heavy (roughly 30 routes across two halves, an admin-auth gate, an
admin-scope :id loader, an enum-route restructure, and a contract + parity test sweep). Prefer
`ultracode` to orchestrate the four vertical slices via a Workflow; if you do not, hand-spawn the
four parallel Agents named in STEP 2.
Goal: convert every handleAdminApi branch into RouteDefs behind the new router, parity-clean,
KEEPING the {success,data,error} envelope and the page/limit pagination contract, restructuring the
enum-segment route to a schema-validated :param, giving admin :id routes an admin-scope loader
excluded from the account-owner BOLA clause, and keeping admin.login on its own limiter store.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with concurrent sessions. If it is dirty with files you
  do not own, STOP and ask before staging anything. You will commit with EXPLICIT paths only, never
  `git add -A`.
- Scan Claude Code memory (the MEMORY.md index) for entries in this phase's domain. Suggested topics
  to look up: (1) the server API pipeline audit + the canonical locked decisions, (2) the BOLA /
  requireOwned* loader + bearer-scope seam introduced in Phase 12 (the admin-scope loader is a
  sibling of it), (3) the prior Discord/moderation review notes on isIpBlocked + turnstile parity
  and the DISCORD_SCHEMA "defined but never wired into ensureSchema" trap (so you recognize an
  unwired schema if an admin route surfaces one), (4) the no-em-dash / admin-dashboard-i18n notes
  (the en_CA em-dash fix was Phase 13's, not yours). Report what you found in 2 to 4 lines.

STEP 1 - LOAD CONTEXT (do NOT read planning docs or large source files directly; spawn ONE Explore
agent and have it return a tight, symbol-anchored summary). Tell the Explore agent to summarize:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (where Phases 1 to 16 left the spine,
  the registry, the parity harness, the BOLA loader + deny-by-default coverage test, and which
  domains are already migrated).
- docs/api-pipeline/phase-17-admin.md (this file: the deliverables, invariants, the a/b split, and
  the acceptance criteria below).
- server/admin.ts: anchor on SYMBOLS, never line numbers. Return: the ok()/fail() helpers and the
  exact {success,data,error} envelope they emit (incl. the data:{ok:true} bodies); handleLogin and
  its ADMIN_LOGIN_MAX_PER_MINUTE rateLimited(req) call; adminAccountId(req) (the bearer is_admin
  resolver) and the 401 'admin authentication required' gate; the enum-segment regex
  /moderation/accounts/(\d+)/(suspend|unsuspend|ban|unban) and the "admin accounts cannot be
  suspended or banned" guard; every other POST branch (reactivate, chat-mute, ignore, force-rename,
  lift-mute, note, reset-strikes, chat-filter/words, chat-filter/words/:id/delete, chat-filter/config,
  blocked-ips POST, blocked-ips/delete) WITH its game.* side effects (disconnectAccount,
  muteAccountChat, reloadChatFilter, reloadBlockedIps, disconnectByIp, the best-effort
  emailSecurityIncident); the `if (req.method !== 'GET') return fail(res,405,...)` boundary and the
  final fail(res,404,'unknown admin endpoint'); every GET branch (blocked-ips, chat-filter, overview,
  online, suspicious-players, online-history, activity, perf/summary, perf/raw, accounts,
  accounts/:id, shared-ips, ip-associations, moderation/queue, moderation/accounts/:id, bug-reports,
  bug-reports/:id/screenshot, characters); parsePageParams + DEFAULT_PAGE_LIMIT/MAX_PAGE_LIMIT, the
  sharedIp sort helpers, and the perf/raw hasMore math.
- server/main.ts (~1695 lines; anchor on the '/admin/api' prefix dispatch and how handleAdminApi is
  invoked from the createServer prefix ladder, never line numbers).
- The spine modules this phase CONSUMES (PUBLIC signatures only): server/http/router.ts (the
  no-regex-routing guard and 404-vs-405+Allow behavior), compose.ts, context.ts (how ctx is built and
  whether it carries the GameServer), schema.ts (the typed query + enum decoders), errors.ts +
  error_codes.ts (the per-surface mapError selection and the {success,data,error} admin serializer
  case), registry.ts, index.ts, middleware/* (withErrors, withBody, requireAccount({scope}), the thin
  rateLimit(policy) adapter), and the Phase 12 requireOwned* loader + the deny-by-default BOLA
  coverage test and HOW it scopes the owner clause (you need to EXCLUDE admin :id routes from it).
- How Phases 10 to 16 threaded the GameServer into their thin Ctx handlers (the admin handlers need
  game.adminStats/liveSessions/disconnectAccount/etc.): return the exact pattern (a ctx.game carrier,
  a registration-time injection, or a closure), so the admin handlers reuse it, NOT a global.
- The Phase 9 dual-path parity harness and the Phase 2/3 scaffolding: the fake-http + fakeCtx helper,
  the FakeDb interface for the admin reads (admin_db / moderation_db / chat_filter_db / ip_block_db /
  bug_report_db), the golden-master normalizer, the admin characterization fixtures, and any seeded
  knownDeviation entries (especially the planned 405-before-auth and 404-before-auth position changes
  under the table router).
- tests/server/admin.test.ts and the existing admin suites (admin_account_db, admin_characters_db,
  admin_ip_db, admin_metrics_db, admin_format_i18n, i18n_admin_catalog): which assert response SHAPE
  vs which assert DB-layer behavior.
- server/CLAUDE.md (the SQL-only-in-*_db rule, the admin-auth model) and root CLAUDE.md (the
  server/http seam + module-first doctrine).
Explore agent must RETURN: a per-route table (method, path, the :param it captures, auth = admin vs
anonymous, request body kind, limiter, current response shape) for every admin route; the exact
{success,data,error} envelope (success + error + data:{ok:true} variants); the page/limit decoder +
its two named constants; the enum-segment route + its action guard; the full list of game.* side
effects per moderation route; the spine + BOLA-loader signatures; how game is threaded into handlers;
and the parity harness entry point + the admin fixtures + seeded knownDeviations. NO planning-doc
prose, NO line numbers.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
First FIX the shared admin seam contract up front (a short interface decided by the runner, handed to
every agent alongside the Explore summary so the four slices wire against the same shapes): the
admin-auth gate signature (e.g. requireAdmin resolving the bearer is_admin scope to ctx, 401 on
absent/non-admin), the admin-scope :id loader signature (e.g. requireAdminTarget(kind) populating
ctx.adminTarget via the relevant *_db read, EXCLUDED from the account-owner BOLA clause, 403 on
deny), and the typed page/limit query decoder (reusing DEFAULT_PAGE_LIMIT/MAX_PAGE_LIMIT, NOT
page/pageSize). Then fan out FOUR parallel Agents, each owning a COMPLETE vertical slice (behavior +
its tests), each given ONLY the Explore summary + that seam contract:
- Agent A (admin seam: auth gate + admin-scope loader + envelope + login limiter + page/limit decoder).
  Deliverables:
  - The requireAdmin auth-gate middleware (bearer -> accountForToken -> isAdminAccount; 401 'admin
    authentication required' parity on absent/non-admin), and the admin.login RouteDef on its OWN
    per-policy limiter store keyed by ADMIN_LOGIN_MAX_PER_MINUTE via the Phase 8 thin rateLimit
    adapter, anonymous by design (no requireAdmin), preserving the 429 / 401 / 403 / 200 shapes.
  - The admin-scope :id loader populating ctx for the operator-scoped routes, EXCLUDED from the
    Phase 12 account-owner deny-by-default coverage clause; cross-scope/absent denial returns 403
    (operator-scoped, per the locked BOLA status decision) with structured bola_denied logging.
  - The typed page/limit query decoder (Phase 6 schema) bounding page/limit ONCE, reusing
    DEFAULT_PAGE_LIMIT + MAX_PAGE_LIMIT (do not retype literals); confirm the admin {success,data,error}
    serializer case in errors.ts/mapError is selected for the whole /admin/api surface.
  - tests/server/admin.test.ts cases: an envelope CONTRACT test freezing {success,data,error} on a
    success body, an error body, and a data:{ok:true} body; admin.login limiter isolation (its bucket
    fires independently of any account/IP policy); requireAdmin 401 on non-admin; the admin-scope
    loader returns 403 (not 404) and excludes the route from the owner clause; :id-as-NaN rejected.
- Agent B (17a reads + ip-block writes). Deliverables:
  - RouteDefs + thin Ctx handlers (calling the existing *_db / game functions with no req/res) for
    GET overview, online, suspicious-players, online-history, activity, perf/summary, perf/raw,
    accounts, accounts/:id, shared-ips, ip-associations, blocked-ips (GET); and POST blocked-ips,
    blocked-ips/delete. Preserve the perf/raw hasMore math and the shared-ips online=1 / sort / dir
    branches EXACTLY; reuse the page/limit decoder from Agent A.
  - Preserve every game.* read/side effect: overview's adminStats merge, online/suspicious live
    reads, shared-ips/ip-associations live blocked + online flags, blocked-ips POST's reloadBlockedIps
    + disconnectByIp(IP_BLOCK_KICK_MESSAGE).
  - tests/server/admin.test.ts cases: parity vs the admin fixtures for each route; page/limit contract
    on accounts/shared-ips/ip-associations (rows/total/page/limit shape unchanged); the ip-block write
    side effects fire; 'a valid IP address is required' guards preserved.
- Agent C (17b moderation + the enum restructure). Deliverables:
  - Restructure the enum-segment route to POST /admin/api/moderation/accounts/:id/:action with a
    schema-validated enum action in {suspend,unsuspend,ban,unban} (Phase 6 enum decoder) so the
    no-regex-routing guard passes; an invalid action fails validation (422) as a documented
    knownDeviation if the old ladder returned 404.
  - RouteDefs + thin handlers for the moderate action, reactivate, chat-mute, ignore, force-rename,
    lift-mute, note, reset-strikes via the admin-scope :id loader. PRESERVE every guard and side
    effect: "admin accounts cannot be suspended or banned" (400), "admin accounts cannot be chat
    muted" (400), game.disconnectAccount/muteAccountChat/liftChatMuteLive/resetChatStrikesLive, the
    force-rename disconnect message, and the best-effort emailSecurityIncident (isolated: a mail
    failure must never turn a successful moderation into an error). GET moderation/queue and
    moderation/accounts/:id (detail) too.
  - tests/server/admin.test.ts cases: the enum decoder accepts the four actions and rejects a fifth;
    the admin-account guards return 400; :id-as-NaN rejected; parity vs fixtures incl. the data:{ok:true}
    bodies; the moderation side effects fire on the FakeDb/fake-game.
- Agent D (17b chat-filter + bug-reports + characters + registry wiring). Deliverables:
  - RouteDefs + thin handlers for GET chat-filter, POST chat-filter/words, POST
    chat-filter/words/:id/delete, POST chat-filter/config (each preserving game.reloadChatFilter), the
    cleanTier 'soft'|'hard' guard, GET bug-reports + bug-reports/:id/screenshot, GET characters; reuse
    the page/limit decoder.
  - Register ALL admin RouteDefs into server/http/registry.ts (spread the server/admin.ts routes table
    into the lookup) so the new router resolves every /admin/api path and none falls through the
    catch-all to the old handleAdminApi ladder.
  - tests/server/admin.test.ts cases: parity vs fixtures; reloadChatFilter fires; tier guard; page/limit
    on bug-reports/characters; a registry-completeness assertion that every admin path is present in the
    new router (the old-vs-new path-set diff hard-fails on a dropped admin route).
A/B SPLIT: this phase has a documented a/b split. If context approaches 40%, SHIP 17a (Agents A + B:
the admin seam + reads + ip-block writes) as its own green, bisectable stacked PR FIRST, then start a
fresh session for 17b (Agents C + D: moderation + chat-filter + bug-reports + characters), which
consumes 17a's admin seam unchanged. Each half registers its own routes; the catch-all delegate keeps
the un-registered half on the old ladder until it lands.

INVARIANTS THIS PHASE MUST KEEP
- Single dispatch model + catch-all delegate: registering the admin routes makes the NEW router
  resolve them; un-migrated paths still delegate per-path to the old ladder unchanged. Do NOT delete
  the old handleAdminApi branches (the old ladder is removed in a later release once the metric gate
  is clean, per Phase 25). The new path is the default.
- Server-authority: every moderation / account / IP / chat-filter outcome resolves server-side exactly
  as before. The admin dashboard is a client; it decides nothing. The game.* side effects
  (disconnect, ban-email, filter/IP reload) MUST be preserved.
- {success,data,error} envelope is FROZEN by a contract test (success, error, and data:{ok:true}
  variants). It is NOT problem+json; the admin serializer case in mapError selects it for /admin/api.
- page/limit pagination contract is FROZEN (NOT the convention B page/pageSize). Reuse
  DEFAULT_PAGE_LIMIT + MAX_PAGE_LIMIT named constants; keep the rows/total/page/limit response shape.
- no-regex-routing guard: the enum-segment route becomes :action :param + a schema-validated enum;
  every admin pattern is literal segments or a plain :param.
- BOLA / object-level authz: admin operator-scoped :id routes use an admin-scope loader EXCLUDED from
  the account-owner deny-by-default coverage clause; denial is 403 (operator-scoped) with bola_denied
  logging. admin.login keeps its own per-policy limiter store, isolated from account/IP policies.
- Stable-code i18n / language-agnostic server: server/ stays language-agnostic (no t(), no DOM). Keep
  the existing admin `error` strings for parity (the contract test freezes them); do NOT introduce a
  new English-as-source-of-truth localization path, and do NOT touch the admin dashboard i18n
  (src/admin/i18n.*) here. Operator-facing localization is the admin SPA's own concern, not this phase.
- Persistence: NO new DDL expected (admin reads/writes existing tables via *_db modules). If a route
  surfaces a defined-but-unwired schema (the DISCORD_SCHEMA trap), STOP and surface it. Any DDL you do
  touch must be additive idempotent under the boot advisory lock with JSONB back-compat.
- No magic values: reuse ADMIN_LOGIN_MAX_PER_MINUTE, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT,
  ACTIVITY_WINDOW_DAYS, IP_BLOCK_KICK_MESSAGE and the perf/raw bound; do not retype literals
  (consolidation is Phase 24).
- No em dashes, no en dashes, no emojis anywhere (code, comments, tests, commits, docs).
- No WS wire / snapshot change. If a change would touch the WS protocol, STOP.

OUT OF SCOPE (do not do these here; they are owned by other phases)
- OAuth JSON + the secret-gated /internal endpoints: Phase 18. Do not touch oauth.ts or internal.ts.
- The two-tier limiter rework (boolean -> {remaining,resetSeconds}) + server/ratelimit_db.ts +
  RATELIMIT_SCHEMA wiring: Phase 19. Use the Phase 8 thin adapter over today's admin-login limiter.
- The userFacingApiError client matcher, apiError.* English catalog, and the per-surface code-parity
  guard: Phase 22. The admin dashboard's own i18n is a separate SPA, not touched here at all.
- The em-dash fix in src/admin/i18n.locales/en_CA.ts: that was Phase 13. Do not redo it here.
- The top-level security-headers wrapper + Content-Type/Origin enforcement: Phase 21.
- Validated config + server timeouts + no-magic-values consolidation: Phase 24.
- World Market realm-scope fix: Phase 20. No market touch here.
- Do NOT delete the old handleAdminApi ladder (Phase 25 / next release owns that).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run the validation matrix for a server-domain migration (code + tests, restructured routes, a new
admin-scope loader, no new DDL):
- `npx tsc --noEmit`
- `npx vitest run tests/server/admin.test.ts` plus the existing admin suites the Explore agent named
  that the diff affects (admin_account_db, admin_characters_db, admin_ip_db, admin_metrics_db,
  admin_format_i18n, i18n_admin_catalog).
- `npx vitest run` the Phase 4 no-regex-routing guard (must pass with the enum route restructured) and
  the Phase 12 deny-by-default BOLA coverage test (must stay green with admin :id routes EXCLUDED from
  the account-owner clause).
- `npx vitest run` the Phase 9 dual-path parity harness over the admin fixtures; every admin route must
  diff clean (status, body, contracted headers) or carry a documented knownDeviation (the
  405-before-auth and 404-before-auth position changes under the table router, and the enum-invalid
  422-vs-404 if applicable). Block on any undocumented diff.
- The Phase 7 error_codes.ts append-only assertion (only if you add an admin code).
- `npm run ci:changed` (Biome on changed files only; scoped `npx @biomejs/biome check --write
  <changed-file.ts>` if it flags format, never a whole-tree --write).
- `npm run build:server`.
Then dispatch the review agents whose SURFACE this diff touches (check `git diff --name-only` first),
each prompted for COVERAGE (report every correctness or requirement gap with confidence and severity),
NOT filtering:
- privacy-security-review: REQUIRED (server/ touched: the admin auth gate, the operator BOLA loader +
  403 denial, the isolated admin-login limiter, IP-block writes that disconnect users, moderation
  actions that ban/disconnect accounts, and SQL via the *_db modules). Confirm no internal SQL/stack
  text leaks in any 4xx/500 body, the is_admin gate cannot be bypassed, and the admin-scope loader
  cannot read a cross-scope object.
- migration-safety: ONLY if `git diff --name-only` shows a *_db DDL / schema change (it should NOT;
  admin only queries existing tables). Skip otherwise and say so.
- cross-platform-sync and architecture-reviewer: SKIP (no src/sim, no wire, no client matcher change).
- qa-checklist: at phase completion.
Give every review agent this truncation-resume line: "If your output is truncated, resume from the
last completed item and continue until you have reviewed every file in the diff; do not restart."
Do NOT commit until each dispatched agent reports no BLOCKING findings.

STEP 4 - COMMIT CADENCE (Conventional Commits with a scope, EXPLICIT paths only). Delivery is a
STACKED PR CHAIN: this phase (or each half of the a/b split) ships as its own green, bisectable PR.
Suggested headlines:
- `feat(http): add admin-auth gate + admin-scope :id loader + page/limit decoder (server/http/middleware/, server/http/schema.ts)`
- `feat(admin): port admin reads + ip-block routes onto RouteDefs (server/admin.ts)`  (17a)
- `feat(admin): port moderation + chat-filter + bug-reports + characters routes, enum :param (server/admin.ts)`  (17b)
- `feat(http): register admin routes + admin {success,data,error} serializer (server/http/registry.ts, server/http/errors.ts)`
- `test(server): admin envelope contract, page/limit, enum schema, admin-scope 403 parity (tests/server/admin.test.ts)`

STEP 5 - ACCEPTANCE CRITERIA (verifiable; every box must be checked before handoff)
- [ ] Every admin route resolves through the NEW router (registry-completeness green); none falls
      through to the old handleAdminApi ladder.
- [ ] The {success,data,error} envelope is frozen by a contract test on a success body, an error body,
      AND a data:{ok:true} body; it is selected by mapError for /admin/api, not problem+json.
- [ ] The page/limit pagination contract is preserved (NOT page/pageSize); DEFAULT_PAGE_LIMIT +
      MAX_PAGE_LIMIT reused as named constants; the rows/total/page/limit response shape unchanged.
- [ ] The enum-segment route is restructured to :id/:action with a schema-validated enum
      {suspend,unsuspend,ban,unban}; the no-regex-routing guard passes; an invalid action is rejected
      (422) as a documented knownDeviation if the old ladder returned 404.
- [ ] admin.login is on its own per-policy limiter store (ADMIN_LOGIN_MAX_PER_MINUTE), isolated from
      account/IP policies, anonymous by design; its 429 / 401 / 403 / 200 shapes match parity.
- [ ] admin operator-scoped :id routes (the moderation actions + account/moderation detail) resolve
      through an admin-scope loader EXCLUDED from the account-owner BOLA coverage clause; cross-scope /
      absent denial returns 403 with bola_denied logging; :id-as-NaN is rejected by the param decoder.
- [ ] The requireAdmin gate preserves the is_admin check and the 401 'admin authentication required'
      parity for an absent/non-admin bearer.
- [ ] Every guard and side effect preserved: "admin accounts cannot be suspended or banned" (400) and
      "admin accounts cannot be chat muted" (400); game.disconnectAccount / muteAccountChat /
      liftChatMuteLive / resetChatStrikesLive / reloadChatFilter / reloadBlockedIps / disconnectByIp;
      the best-effort emailSecurityIncident stays isolated (a mail failure never fails the action).
- [ ] The parity harness diffs every admin route old vs new clean, or with a documented knownDeviation
      (405-before-auth, 404-before-auth, enum-invalid 422).
- [ ] `npx tsc --noEmit` clean; tests/server/admin.test.ts green; the no-regex guard green; the BOLA
      coverage test green; `npm run ci:changed` clean; `npm run build:server` green.
- [ ] No WS wire change, no src/sim touch, no new DDL, no admin-dashboard-i18n change.

STEP 6 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md: mark Phase 17 complete (note the a/b split state if you shipped
  17a and 17b as separate PRs); list the admin RouteDefs now exported from server/admin.ts, the new
  admin-auth gate + admin-scope :id loader modules, the enum :id/:action restructure, and that the
  {success,data,error} envelope and page/limit contract are frozen by contract tests.
- Update docs/api-pipeline/state.md: the admin domain now sits on the new seam; record the admin-scope
  loader name and its EXCLUSION from the account-owner BOLA clause, the 403 operator-scoped denial, the
  isolated admin.login limiter, the page/limit (not page/pageSize) decision, and the 405/404-before-auth
  + enum-invalid-422 knownDeviations.
- Record in memory: the admin-scope-loader BOLA exclusion + 403 denial (vs 404 for player-owned), the
  page/limit-vs-page/pageSize divergence, the fact that admin handlers need the GameServer threaded
  into the Ctx for their side effects, and the enum :param restructure pattern, since Phase 18 (oauth/
  internal) reuses the seam and the secret-gate analogue.

STEP 7 - FINAL RESPONSE FORMAT (return, do not write a report file): phase status (DONE / BLOCKED /
SPLIT-17a-DONE), files touched (absolute paths), validation results (tsc / admin.test.ts / no-regex
guard / BOLA coverage / parity harness / ci:changed / build:server), review verdicts
(privacy-security-review and qa-checklist, plus migration-safety only if it ran), any deferrals, and a
one-line handoff to "Phase 17 QA".

STOPPING RULES (stop and surface, do not push through)
- Stop if any migrated admin route's parity fixture diffs without a documented knownDeviation.
- Stop if the {success,data,error} envelope shape would change for any route (including the
  data:{ok:true} bodies).
- Stop if the page/limit contract would change to page/pageSize, or if DEFAULT_PAGE_LIMIT /
  MAX_PAGE_LIMIT would be retyped as literals.
- Stop if the admin-scope :id loader would land in the account-owner BOLA coverage clause (it MUST be
  excluded), or if its denial would be 404 instead of 403.
- Stop if restructuring the enum route cannot satisfy the no-regex-routing guard, or would change the
  response for a valid action.
- Stop if admin.login's limiter would merge into the shared account/IP policy table.
- Stop if migrating a route surfaces a defined-but-unwired schema (the DISCORD_SCHEMA precedent):
  surface it, do not silently wire.
- Stop if any change would alter the WS wire protocol or snapshots.
- Stop if determinism or sim-purity would be violated (any reach into src/sim, or any Math.random /
  Date.now in a limiter test instead of the injected now() clock).
````
