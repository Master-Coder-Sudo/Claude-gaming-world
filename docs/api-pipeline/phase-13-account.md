# Phase 13: Migrate account portal (server/account.ts) + em-dash fix

This phase ports the `/api/account/*` family (plus `/api/email/unsubscribe`) onto the shared
`server/http/` pipeline as thin Ctx handlers over the already-extracted `handleAccount*` domain
functions in `server/account.ts`, and bundles the labeled-behavioral em-dash copy fix on the
old-ladder rate-limit strings (and its paired client matcher and admin operator copy). It stays
under 40% context because it is one domain of about 14 routes whose handlers already exist, it
reuses the Phase 8 middleware and the Phase 9 parity harness rather than building new spine, and
the copy fix is a bounded sweep over three known files with exact line anchors. No DDL, no new
error codes, no wire change.

Paste the block below into a fresh Claude Code session. Do not read this whole doc first; the
block is self-contained.

### Starter Prompt

````text
This is Phase 13 of the API Pipeline re-architecture: Migrate account portal (server/account.ts) + em-dash fix.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: not needed here (one domain of ~14 routes plus a 3-file copy sweep, not a large
content/test sweep); hand-spawn the parallel agents named in STEP 2. This phase is NOT in the
canonical a/b-split list, so there is no documented a/b split; it is sized to fit one session.
Goal: serve every account-portal route through the new RouteDef pipeline at byte-for-byte parity
with the old ladder, and remove the U+2014 em-dash from the rate-limit copy (server + client
matcher + admin en_CA), keeping the client localization matcher resolving unchanged.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with concurrent sessions; if it is dirty with files
  you do not own, STOP and ask before touching anything. You will commit with EXPLICIT paths
  only, never `git add -A`.
- Scan Claude Code memory for entries in this phase's domain. Suggested concrete topics to look
  up: (1) the locked Server API pipeline audit/spec (the single source of truth for this packet),
  (2) i18n reword-staleness + the pre-push copy-scan basing on the remote (relevant to shipping an
  em-dash fix without a false copy-scan block), (3) the prior server/account.ts handler extraction,
  (4) the admin i18n resolved.generated regen flow (`npm run i18n:admin`).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly; spawn ONE Explore agent)
Tell the Explore agent to summarize, anchored on SYMBOL NAMES and route strings (server/main.ts is
~1695 lines, every line number is stale):
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (current migration state, which
  phases landed, what server/http/ primitives and harnesses exist).
- docs/api-pipeline/phase-13-account.md (this file).
- server/account.ts: the exported domain handlers handleAccountWhoami, handleAccountChangePassword,
  handleAccountLogout, handleAccountSetEmail, handleAccountDeactivate, handleAccountEmailChange,
  handleAccountEmailVerify, handleAccountExport, handleAccountMarketing, handleAccount2faSetup,
  handleAccount2faEnable, handleAccount2faDisable, handleEmailUnsubscribe, and the login helper
  verifyLoginTwoFactor (helper, NOT a route). For each: method, path, the bearer resolver it
  expects, the response shape, and the English error strings it emits.
- server/main.ts: the `/api/account/*` and `/api/email/unsubscribe` dispatch block (the inline
  `if (req.method === ... && url === '/api/account/...')` ladder, including the companion-token
  branch which has NO top-level method guard and fans GET/POST/DELETE inside), the bearer resolver
  it calls per route (anchor on bearerActiveAccount and any sibling bearer* resolver), and the
  rate-limit 429 string sites that contain the em-dash (grep them, see STEP 2 slice C).
- src/main.ts: the userFacingApiError function, specifically its account.* mapping branches and the
  two `normalized.startsWith('too many attempts')` / `startsWith('too many failed attempts')`
  branches (these prefixes sit BEFORE the em-dash, so the dash->comma swap leaves matching intact).
- src/admin/i18n.locales/en_CA.ts: the operator-facing strings that contain the em-dash.
- server/CLAUDE.md and root CLAUDE.md (server conventions, module-first, i18n stable-code rule).
- The prior-phase server/http/ modules this phase CONSUMES (do not modify them): router.ts,
  compose.ts, context.ts, schema.ts, errors.ts, error_codes.ts, registry.ts, index.ts, and
  middleware/* (especially withErrors, withBody, requireAccount, the thin rateLimit adapter); plus
  the Phase 2 test harness under tests/server/ (fakeCtx/fake-http, FakeDb), the Phase 3 golden
  fixtures for the account routes, and the Phase 9 dual-path parity harness + registry-completeness
  test.
- scripts/i18n_admin_build.mjs (how src/admin/i18n.resolved.generated/en_CA.ts is regenerated; it
  is GENERATED, never hand-edit it).
The Explore agent returns: a per-route table (method, path, bearer resolver, scope, response shape,
error strings), the exact RouteDef shape + the names/signatures of the middleware to compose, the
requireAccount scope options, the parity-harness + registry-completeness entrypoints to run, the
exact em-dash string literals with their grep anchors, and the admin regen command. No planning
prose beyond state.md/progress.md.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE (hand-spawn 3 parallel agents, each a full vertical slice,
each given ONLY the Explore summary)

Agent A - Account route migration:
- In server/account.ts add `export const routes: RouteDef[]` covering: GET /api/account (whoami),
  POST /api/account/password, POST /api/account/logout, POST /api/account/email, POST
  /api/account/deactivate, POST /api/account/email/change, GET /api/account/email/verify, POST
  /api/account/export, POST /api/account/marketing, POST /api/account/2fa/setup, POST
  /api/account/2fa/enable, POST /api/account/2fa/disable, and /api/account/companion-token as THREE
  separate RouteDefs (POST create, GET list, DELETE revoke), plus GET /api/email/unsubscribe.
- Each handler is THIN: compose requireAccount (preserving the EXACT bearer resolver/scope each
  route uses today, anchored on the bearerActiveAccount/bearer* call, do not invent a scope),
  withBody where the old route parsed a body, then call the existing handleAccount* domain function
  unchanged. Do not move logic into main.ts; this is module-first.
- Classify /api/email/unsubscribe by its ACTUAL Phase 3 characterization fixture, not by the
  planning label. The planning calls it HTML, but the live handler returns JSON {ok:true}; reconcile
  against the fixture and pick the serializer that reproduces today's bytes. If they conflict,
  follow the fixture and record the reconciliation as a knownDeviation note (see STOPPING RULES).
- Wire the table into server/http/registry.ts so the new dispatcher resolves these paths and the
  per-path catch-all delegate stops sending them to the old ladder.
- Deliverables: server/account.ts `export const routes`, the thin Ctx handlers, registry wiring.

Agent B - Tests + parity:
- tests/server/account.test.ts: per-route parity against the Phase 3 fixtures through the Phase 9
  dual-path harness (status, body, contracted headers) with zero undocumented diffs; scope/auth
  gating per route (a missing/invalid bearer yields the same 401 as today); the companion-token
  CRUD trio; an explicit assertion for the companion-token method-fan knownDeviation (an unsupported
  method now returns 405 + Allow where the old ladder fell through to 404).
- Extend the registry-completeness assertion so every old account path is present in the new router.
- Assert the email/unsubscribe serializer matches its fixture.
- Use the FakeDb/fakeCtx harness, not a live pg or a booted server.
- Deliverables: tests/server/account.test.ts, the completeness-diff extension.

Agent C - Em-dash copy fix (labeled behavioral, three files):
- Locate the exact sites with `grep -rnP "\x{2014}" server/main.ts src/admin/i18n.locales/en_CA.ts`.
  In server/main.ts the rate-limit 429 responses read `'too many attempts<U+2014>wait a minute and
  try again'` (about three sites) and `'too many failed attempts<U+2014>wait a few minutes and try
  again'` (about one site). Swap each U+2014 to a comma so they read `'too many attempts, wait a
  minute and try again'` and `'too many failed attempts, wait a few minutes and try again'`. The
  prefix before the comma is unchanged.
- In src/main.ts, in the SAME change, keep userFacingApiError in sync: the two branches match on the
  prefixes `'too many attempts'` and `'too many failed attempts'` via startsWith, so the swap leaves
  resolution intact and NO matcher logic change is required; do not introduce a new error code. If a
  touched line in the matcher region carries the paired English copy or a sync comment with a
  U+2014, swap that dash too so the touched lines stay copy-clean.
- In src/admin/i18n.locales/en_CA.ts swap every U+2014 to a comma (operator-facing strings, including
  the admin error.tooManyAttempts copy), then regenerate the resolved copy with `npm run i18n:admin`
  (which rewrites src/admin/i18n.resolved.generated/en_CA.ts). NEVER hand-edit the generated file.
- Add a focused assertion: a test that `grep -P "\x{2014}"` over the touched strings is empty, and a
  regression assertion that userFacingApiError still resolves each fixed string to its t() key.
- Deliverables: the three-file swap, the admin regen, the two assertions.

INVARIANTS THIS PHASE MUST KEEP
- Single-flag dispatch + per-path catch-all delegate: account paths migrate behind the new path
  (the default); un-migrated paths still delegate to the old ladder unchanged. A flag-flip reverts
  these routes to the old ladder atomically.
- Server-authority: every account mutation resolves server-side; the client is unchanged except for
  the matcher copy.
- Stable-code i18n via userFacingApiError: PRESERVE the existing English-source-string ->
  userFacingApiError mapping for every account route (this is what the Phase 3 fixtures encode); do
  NOT convert account errors to new stable CODES here (that holistic migration is Phase 22). The
  only copy change is the em-dash swap, and it must not change any matcher prefix.
- No magic values: reuse the existing named constants (the companion-token TTL constant already
  exists locally); do not introduce a new literal. Tunable consolidation is Phase 24.
- No em dashes, en dashes, or emojis anywhere (this phase REMOVES them; do not add any). Plain ASCII.
- Determinism / sim-purity: not in play (server-only, zero src/sim/ touch) and must not be violated.
- Persistence: no DDL, no new tables, no JSONB shape change this phase.

OUT OF SCOPE (do not do these here)
- Wallet/cards (Phase 14), reports/telemetry (Phase 15), Discord family (Phase 16), the Admin API
  ROUTE migration (Phase 17, note the admin en_CA i18n COPY fix IS in scope here), OAuth/Internal
  (Phase 18).
- The deep two-tier rate-limiter rework + ratelimit_db (Phase 19). Use only the thin Phase 8
  rateLimit adapter; do not change limiter return shapes.
- Converting account error strings to stable error CODES or the per-surface code-parity guard
  (Phase 22). Preserve English-string parity.
- The auth surface register/login route migration (Phase 11). The em-dash strings happen to sit on
  the login/register throttle path; you only swap the dash here, you do NOT migrate those routes.
- Any new BOLA loader: account routes are bearer-account-scoped and carry no account-owned `:id`
  object, so requireOwned* is not introduced this phase.
- Security headers (Phase 21), config/timeouts (Phase 24), the metrics exporter (Phase 23).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run the validation matrix for this change type (a domain migration plus a player-text copy change):
```bash
npx tsc --noEmit
npx vitest run tests/server/account.test.ts
npx vitest run tests/localization_fixes.test.ts
npm run i18n:admin && npm run check:admin
npm run ci:changed
npm run build:server
grep -rnP "\x{2014}" server/main.ts src/main.ts src/admin/i18n.locales/en_CA.ts src/admin/i18n.resolved.generated/en_CA.ts
```
(The final grep must print nothing.) Also run any existing account or auth suite the Explore agent
flagged as affected, and the Phase 9 parity + registry-completeness tests over the account paths.
Pre-merge gate (mirror CI) before the PR is green: `npm test && npx tsc --noEmit && npm run
build:env && npm run build:server && npm run build`.

Then dispatch ONLY the review agents whose surface this diff touches (check `git diff --name-only`
first). For this phase that is:
- privacy-security-review: REQUIRED (server/ auth-adjacent: account portal, password re-verify, 2fa,
  deactivate, bearer scope, companion-token minting).
- qa-checklist: REQUIRED at phase completion.
- cross-platform-sync is NOT triggered this phase: the userFacingApiError edit is a copy-only
  em-dash swap with the matcher prefix and logic unchanged, and nothing touches IWorld, src/sim,
  the wire, sim_i18n/server_i18n, or the RL surface. Dispatch it ONLY if you end up changing matcher
  LOGIC (you should not).
- migration-safety and architecture-reviewer are NOT triggered (no DDL/JSONB, no src/sim).
Prompt each reviewer for COVERAGE (report every correctness or requirement gap with confidence and
severity), not filtering. If a review reply is truncated, tell the agent: "resume from the last
complete finding and continue." Do not commit until each reports no BLOCKING.

STEP 4 - COMMIT CADENCE (stacked PR chain: this phase ships as its own green, bisectable PR)
Use Conventional Commits with a scope and EXPLICIT paths (never `git add -A`):
- `feat(http): migrate account portal routes onto RouteDefs` (paths: server/account.ts
  server/main.ts server/http/registry.ts)
- `test(server): parity and scope coverage for account routes` (paths: tests/server/account.test.ts)
- `fix(server): comma not em-dash in rate-limit copy` (paths: server/main.ts)
- `fix(i18n): remove em-dashes from account matcher and admin en_CA` (paths: src/main.ts
  src/admin/i18n.locales/en_CA.ts src/admin/i18n.resolved.generated/en_CA.ts)
If the pre-push copy-scan bases on the remote and flags pre-existing release copy unrelated to your
diff, confirm your touched lines are clean and push with `--no-verify` only if that is the cause.

STEP 5 - ACCEPTANCE CRITERIA (verifiable)
- [ ] All ~14 account routes (the 13 /api/account/* handlers plus /api/email/unsubscribe) ported to
      `export const routes: RouteDef[]` in server/account.ts as thin Ctx handlers calling the
      existing handleAccount* domain functions; companion-token is three RouteDefs (POST/GET/DELETE).
- [ ] Each route's existing bearer resolver and scope preserved exactly (anchored on the
      bearerActiveAccount/bearer* call, not invented).
- [ ] /api/email/unsubscribe classified per its real characterization fixture (JSON {ok:true} today);
      the serializer reproduces today's bytes; the HTML-vs-JSON planning discrepancy is reconciled
      and noted.
- [ ] companion-token method-fan documented as a knownDeviation (unsupported method now 405 + Allow,
      was 404) with an asserting test.
- [ ] Phase 9 parity harness runs every account-route Phase 3 fixture old-vs-new with zero
      undocumented diffs; registry-completeness shows no account path missing from the new router.
- [ ] The four server/main.ts rate-limit em-dash strings swapped to commas; the prefix is unchanged.
- [ ] userFacingApiError still resolves each fixed string (regression assertion green); no new error
      code introduced.
- [ ] src/admin/i18n.locales/en_CA.ts em-dashes swapped to commas; resolved copy regenerated via
      `npm run i18n:admin` (not hand-edited).
- [ ] `grep -rnP "\x{2014}"` over server/main.ts, src/main.ts, src/admin/i18n.locales/en_CA.ts, and
      src/admin/i18n.resolved.generated/en_CA.ts prints nothing.
- [ ] S3 guard (tests/localization_fixes.test.ts) green; no new untranslated player string added.
- [ ] tsc clean; tests/server/account.test.ts green; ci:changed clean on changed files;
      build:server green; check:admin green; the Stop-hook floor passes (no dash/emoji/.only/debugger).

STEP 6 - DOC UPDATES + MEMORY
- docs/api-pipeline/progress.md: mark Phase 13 done; name the new surface (server/account.ts
  `export const routes: RouteDef[]` with the ported account routes), the registry wiring, the
  em-dash copy fix (server/main.ts rate-limit strings, src/main.ts matcher, src/admin en_CA + regen).
- docs/api-pipeline/state.md: list the account paths now on the new pipeline, the companion-token
  405 knownDeviation, the unsubscribe classification reconciliation, and that NO new codes/tables/DDL
  were added.
- Record in memory: (1) the unsubscribe HTML-vs-JSON planning discrepancy (live handler returns JSON
  {ok:true}); (2) the companion-token route having no top-level method guard, so it becomes three
  RouteDefs plus a 405 knownDeviation; (3) the em-dash matcher-safety (the matcher prefix sits before
  the dash, so dash->comma is resolution-neutral); (4) the admin resolved copy is GENERATED, regen
  via `npm run i18n:admin`, never hand-edited.

STEP 7 - FINAL RESPONSE FORMAT
Report, in order: phase status (done / blocked); files touched (absolute paths); validation results
(each command pass/fail); review verdicts (privacy-security-review, qa-checklist: BLOCKING counts);
deferrals/knownDeviations carried; and a one-line handoff: "Ready for Phase 13 QA (phase-13-qa.md)."

STOPPING RULES
- Stop if a migrated account route's parity fixture diffs without a documented knownDeviation (the
  companion-token method-fan 405 is the one allowed deviation; anything else stops).
- Stop if the em-dash swap would change any userFacingApiError matcher prefix such that a fixed
  string no longer resolves (the prefix must stay before the comma).
- Stop if classifying /api/email/unsubscribe as HTML would contradict its real characterization
  fixture; reconcile to the fixture (JSON today) before choosing the serializer, do not blindly
  apply the planning's HTML label.
- Stop if any change would alter the WS wire protocol or a snapshot shape (it must not).
- Stop if any change touches src/sim/ or would violate determinism or sim-purity.
- Stop if you would hand-edit src/admin/i18n.resolved.generated/en_CA.ts (regenerate via
  `npm run i18n:admin` instead).
- Stop if you would introduce a new error CODE for an account string (that is Phase 22's surface;
  preserve the existing English-string + matcher parity here).
````
