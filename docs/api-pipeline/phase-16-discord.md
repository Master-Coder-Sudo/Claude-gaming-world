# Phase 16: Migrate Discord family (server/discord.ts): net-new since SPEC

Phase 16 migrates the Discord identity family (OAuth start, OAuth callback, link status, unlink,
plus the orphaned swag-claim) off the inline `handleApi` ladder and onto `RouteDef`s in
`server/discord.ts`, wires the currently-unwired `DISCORD_SCHEMA` into `ensureSchema`, and adds a
`discord.*` rate-limit policy with the matching error codes. This family is net-new since the
SPEC, which predates the Discord, guild, and moderation merge, so there is no SPEC batch for it.

It stays under 40% context because it touches exactly one domain module (`server/discord.ts`), one
DDL wiring point (`ensureSchema`), one policy entry, and a bounded set of error codes, all behind
the spine that Phases 1 to 9 already built and the per-domain migration pattern that Phases 10 to
15 already established. The runner ports against existing primitives; it does not design new ones.

### Starter Prompt

````
This is Phase 16 of the API Pipeline re-architecture: Migrate Discord family (server/discord.ts), net-new since SPEC.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: do NOT use ultracode here. This phase is not a large content or test sweep (five routes, one DDL wiring point, one policy, a bounded code set); hand-spawn parallel agents instead.
Goal: Move the Discord OAuth + link + unlink + swag-claim endpoints onto RouteDefs behind the shared spine, wire DISCORD_SCHEMA into ensureSchema, and add the discord.* policy and codes, keeping the OAuth callback a non-JSON redirect and closing the isIpBlocked/turnstile gap, all parity-clean.

STEP 0 - PRE-FLIGHT
- Verify `git status` is clean. This is a shared worktree with concurrent sessions; if it is dirty, STOP and ask before touching anything. Stage only your files with EXPLICIT paths later, never `git add -A`.
- Scan Claude Code memory for entries in this phase's domain. Suggested concrete topics: "PR #1044 Discord integration review" (the unwired DISCORD_SCHEMA blocker), "PR #1075 Discord choice+unlink review" (the schema-wiring fix and the isIpBlocked/turnstile parity gap), "Server API pipeline audit", and "i18n resolved baseline & assembly".

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly; spawn ONE Explore agent)
Tell the Explore agent to summarize, anchored on SYMBOL NAMES and ROUTE STRINGS (never line numbers; main.ts is ~1695 lines and every SPEC anchor is stale):
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (current packet status and what Phases 1 to 15 shipped).
- docs/api-pipeline/phase-16-discord.md (this file).
- server/discord.ts: the Discord start, callback, status, and unlink handlers, the orphaned handleSwagClaim, the bouncePage HTML helper, and discordRateLimited. Note which take req/res today vs which are already thin.
- server/main.ts: the inline handleApi branches that currently dispatch /api/auth/discord/start, /api/auth/discord/callback, /api/discord (GET and DELETE), and confirm POST /api/discord/swag/claim is NOT dispatched anywhere (it is orphaned).
- server/discord_db.ts: DISCORD_SCHEMA (the 5 tables: discord_links, discord_oauth_states, reward_points, reward_ledger, swag_claims) and the link/unlink/state/swag query functions.
- The ensureSchema statement list and the boot advisory lock that wraps it (confirm the module; likely server/db.ts), plus how the wired schemas (SOCIAL_SCHEMA, main SCHEMA) are listed so DISCORD_SCHEMA can join them.
- The POLICIES rate-limit table and the shape of an existing ip+account policy (confirm the module; likely server/ratelimit.ts), and the existing DISCORD_MAX_PER_MINUTE constant.
- server/ip_block_db.ts (isIpBlocked) and the passesTurnstile helper: their signatures and current call sites on register/login.
- The prior-phase spine under server/http/: router.ts, compose.ts, context.ts, schema.ts, errors.ts (mapError + the redirect and HTML-error serializer selection from Phase 7), error_codes.ts, registry.ts, index.ts, and middleware/* (withErrors, withBody, requireAccount({scope}), withCors, and the THIN rateLimit(policy) adapter from Phase 8).
- A prior migration module to mirror exactly: server/reports.ts (Phase 15) and server/wallet.ts (Phase 14, for the ip+account keyBy ordering and the "new codes resolve client-side" pattern); also server/auth.ts (Phase 11, for passesTurnstile scoped AFTER withBody).
- src/main.ts userFacingApiError (the live REST error matcher) and the client i18n catalog conventions, so the new Discord codes resolve client-side.
- The Phase 3 golden-master fixtures for the Discord routes (the parity baseline).
- server/CLAUDE.md and root CLAUDE.md (the server/http seam, the stable-code i18n rule, the additive-DDL rule).
Return: a symbol-anchored map of the five Discord handlers and their current dispatch, the discord_db query surface, the exact ensureSchema insertion point under the advisory lock, the POLICIES shape and the DISCORD_MAX_PER_MINUTE constant, the mapError redirect/HTML selection seam, the thin rateLimit adapter signature, the isIpBlocked/passesTurnstile signatures, the userFacingApiError shape, and the Phase 3 fixture names. No code, just the map.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Hand-spawn 4 parallel Agents, each owning a complete vertical slice (behavior plus its tests). Give each ONLY the Explore summary, not the planning docs.
- Agent A (routes): port POST /api/auth/discord/start (JSON {url}; full-scope session in link mode, anonymous otherwise), GET /api/auth/discord/callback (HTML bouncePage on success, 302 redirect-to-error on failure; classified NON-JSON; no auth; not web-login-guarded), GET /api/discord (status; JSON; full-scope session), and DELETE /api/discord (unlink; JSON {unlinked}; full-scope session; account-scoped ownership) as `export const routes: RouteDef[]` in server/discord.ts with THIN Ctx handlers (no req/res). Wire them into registry.ts. Deliverables: the RouteDefs, the registry spread, the mapError selection so the callback uses the redirect/HTML serializer (NEVER problem+json), parity tests vs the Phase 3 fixtures for all four routes, and a contract test asserting the callback body is the HTML bouncePage or a 302 redirect, not problem+json.
- Agent B (persistence): wire DISCORD_SCHEMA into the ensureSchema statement list under the boot advisory lock, with a boot-time table-existence assertion (this is the exact trap DISCORD_SCHEMA fell into; it is a precedent warning for RATELIMIT_SCHEMA in Phase 19). Deliverables: the ensureSchema edit (additive, CREATE TABLE IF NOT EXISTS only), the table-existence assertion, an idempotent-DDL re-run test (running ensureSchema twice is a no-op), and a test that the assertion fires when a table is missing.
- Agent C (policy + security parity): add a discord.* ip+account policy to POLICIES deriving its value from the existing DISCORD_MAX_PER_MINUTE constant (do NOT re-type the literal 15); wire the thin rateLimit(policy) adapter onto all the Discord routes; carry forward the isIpBlocked + turnstile parity gap from the PR #1044 and #1075 reviews by applying isIpBlocked on start and callback and passesTurnstile (after withBody) on the start POST, matching how Phase 11 scoped turnstile to register and login. Deliverables: the policy entry, the adapter wiring, the isIpBlocked and turnstile application, and tests that the discord.* bucket fires with ip-keyed-before-account ordering, that an ip-blocked request is denied, and that turnstile runs after body parse on start.
- Agent D (codes + client matcher + swag-claim wiring): append the Discord error codes to server/http/error_codes.ts (frozen domain.reason, append-only per AIP-193, reusing the existing vocabulary); extend src/main.ts userFacingApiError MINIMALLY so each Discord code resolves client-side (this closes the discordRateLimited "raw {error:'rate limited'} with no client matcher" gap), with a scoped Vitest asserting each Discord code resolves; AND dispatch the orphaned handleSwagClaim as POST /api/discord/swag/claim (full-scope session, discord.* policy) so it is reachable over HTTP, keeping its existing unit tests green and recording the previously-404 behavior as a documented knownDeviation. If any new English matcher value is wordy (four-plus lowercase letters per word, multiple words), add its five non-Latin fills (zh, zh_TW, ja, ko, ru) in the SAME change per the M16 rule (src/ui/CLAUDE.md).
There is NO formal a/b split for this phase. If context approaches 40%, serialize the four agents in two waves: wave 1 = A + B (routes + persistence), wave 2 = C + D (policy/security + codes/matcher/swag). Each agent owns its own tests; they integrate through registry.ts and tests/server/discord.test.ts.

INVARIANTS THIS PHASE MUST KEEP
- Server-authority: Discord link, unlink, and swag-claim resolve server-side; unlink ownership is enforced by an account-scoped query, never trust client-supplied identity.
- Single-flag dispatch + catch-all delegate: the migrated Discord routes register in the new router and are served on the default (new) path; the old handleApi Discord branches stay for the flag-off rollback path (deleted next release). The catch-all keeps un-migrated paths delegating to the old ladder.
- Non-JSON classification: GET /api/auth/discord/callback is a redirect/HTML surface, NEVER problem+json. Serving it as JSON would break window.opener.postMessage in the popup.
- Stable-code i18n: the server stays language-agnostic and emits a stable CODE (no English prose decides client rendering); src/main.ts userFacingApiError re-localizes by code. No `?? 'English'`, no concat, no English in server responses.
- Additive idempotent DDL: DISCORD_SCHEMA joins ensureSchema with CREATE TABLE IF NOT EXISTS only, under the advisory lock, with a boot-time table-existence assertion. No migrations directory; the inline DDL is the schema. No JSONB shape change to existing character state.
- No magic values: DISCORD_MAX_PER_MINUTE is the single source; the discord.* policy derives from it.
- No em dashes, en dashes, or emojis anywhere (code, comments, docs, commits, copy).
- Determinism and sim-purity: this phase is SERVER-ONLY and must not touch src/sim/. Server time is fine here (no limiter clock rework in this phase).

OUT OF SCOPE (do not let these creep in)
- The 8 secret-gated /internal/discord/* bot-channel endpoints (x-woc-discord-secret): Phase 18 (oauth + internal).
- The deep rate-limiter rework (boolean to {remaining,resetSeconds}, respond429, ratelimit_db, RateLimit structured-field headers): Phase 19. Phase 16 uses ONLY the thin rateLimit adapter from Phase 8.
- The full userFacingApiError REWORK (lookup-by-code instead of prose, parametric cases) and the comprehensive per-surface code-parity guard covering all ~30-45 existing REST strings plus the new Discord/guild codes, and the apiError.* catalog domain introduction: Phase 22. Phase 16 only adds the Discord codes and their minimal matcher resolution.
- Guild leaderboard board=guilds and the public reads: Phase 10. Admin: Phase 17. OAuth JSON: Phase 18. Market realm-scope fix: Phase 20. Security-headers top-level wrapper: Phase 21.
- No WS wire or snapshot change.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run the canonical validation matrix for this change type (code + persistence DDL + player codes + client touch):
- `npx tsc --noEmit`
- `npx vitest run tests/server/discord.test.ts` (plus any existing affected suite the Explore agent named, e.g. an existing discord unit suite)
- `npx vitest run tests/localization_fixes.test.ts` (S3 i18n guard) plus the new scoped Discord-code-resolve test
- The idempotent-DDL re-run test and the boot-time table-existence assertion test
- The parity harness over the Phase 3 Discord fixtures (start, callback, status, unlink, swag-claim)
- `npm run ci:changed` (Biome on changed files only; never a whole-tree --write)
- `npm run build:server` and `npm run build` (client touched via src/main.ts)
Then dispatch the review agents whose surface this diff actually touches (check `git diff --name-only` first), each prompted for COVERAGE not filtering (report every correctness or requirement gap with confidence and severity):
- privacy-security-review (server/ auth, OAuth, unlink ownership, isIpBlocked, turnstile, the Discord OAuth state secret, the new policy).
- migration-safety (DISCORD_SCHEMA wiring into ensureSchema, the boot-time assertion, DDL idempotency).
- qa-checklist (phase-completion gate).
- cross-platform-sync is NOT dispatched: this phase touches the REST matcher (userFacingApiError), which is outside that reviewer's trigger set (sim_i18n / server_i18n / wire / IWorld / RL). Only dispatch it if your actual diff unexpectedly touches one of those.
Truncation-resume line for every review agent: "If your review is truncated, resume from the last file and finding you completed; do not restart from the top."
Do NOT commit until each dispatched reviewer reports no BLOCKING.

STEP 4 - COMMIT CADENCE
Conventional Commits with a scope and EXPLICIT paths (no `git add -A`). This phase ships as its own green, bisectable PR in the stacked chain. Suggested headlines:
- `feat(discord): port OAuth + link + unlink routes onto RouteDefs` (server/discord.ts, server/http/registry.ts)
- `fix(discord): dispatch orphaned handleSwagClaim as POST /api/discord/swag/claim` (server/discord.ts, server/http/registry.ts)
- `fix(discord): wire DISCORD_SCHEMA into ensureSchema with boot-time table assertion` (server/discord_db.ts, server/db.ts)
- `feat(ratelimit): add discord.* ip+account policy from DISCORD_MAX_PER_MINUTE` (server/ratelimit.ts)
- `feat(http): add Discord error codes and client matcher resolution` (server/http/error_codes.ts, src/main.ts, the client catalog, tests/server/discord.test.ts)

STEP 5 - ACCEPTANCE CRITERIA (verifiable)
- [ ] POST /api/auth/discord/start, GET /api/auth/discord/callback, GET /api/discord, DELETE /api/discord, and POST /api/discord/swag/claim are all RouteDefs in server/discord.ts and resolve through the new router on the default path.
- [ ] GET /api/auth/discord/callback is served as the HTML bouncePage on success and a 302 redirect-to-error on failure, NEVER problem+json (frozen by a contract test).
- [ ] handleSwagClaim is reachable over HTTP and its existing unit tests pass; the previously-404 behavior is recorded as a documented knownDeviation.
- [ ] DISCORD_SCHEMA (discord_links, discord_oauth_states, reward_points, reward_ledger, swag_claims) is in the ensureSchema statement list under the advisory lock; a boot-time table-existence assertion fires; the idempotent-DDL re-run test passes.
- [ ] A discord.* ip+account policy exists in POLICIES, deriving from DISCORD_MAX_PER_MINUTE (no re-typed literal); the limiter bucket fires with ip-keyed-before-account ordering.
- [ ] isIpBlocked is applied to start and callback; passesTurnstile runs after withBody on the start POST (parity with Phase 11); the prior-review gap is closed.
- [ ] DELETE /api/discord unlink is account-scoped; a cross-account unlink is denied.
- [ ] Discord error codes are appended to server/http/error_codes.ts (frozen, append-only); userFacingApiError resolves each Discord code; the scoped resolve test passes; S3 (tests/localization_fixes.test.ts) is green; any wordy new English matcher value has its five non-Latin M16 fills.
- [ ] The parity harness matches every migrated Discord route against its Phase 3 fixture except the documented knownDeviations (swag-claim now reachable, isIpBlocked/turnstile now applied, discord.* limiter now emits a stable code). No WS wire change.
- [ ] All gates green: tsc, the discord suite, S3, the DDL tests, ci:changed, build:server, build.

STEP 6 - DOC UPDATES + MEMORY
- docs/api-pipeline/progress.md: mark Phase 16 done; list the new surface: the server/discord.ts `routes` export, the five migrated endpoints (start, callback, status, unlink, swag/claim), DISCORD_SCHEMA now wired into ensureSchema, the discord.* policy, the DISCORD_MAX_PER_MINUTE-derived value, the new Discord error codes, and the handleSwagClaim dispatch fix.
- docs/api-pipeline/state.md: record that DISCORD_SCHEMA is now wired (closing the PR #1044/#1075 unwired-schema gap), that the discord.* policy is in POLICIES, that the isIpBlocked/turnstile parity gap is closed, and that the Discord codes still need Phase 22's comprehensive per-surface code-parity guard.
- Memory: record the surprising rules: DISCORD_SCHEMA was defined-but-unwired and is wired here; handleSwagClaim was orphaned and is now dispatched; the callback MUST stay HTML/redirect not problem+json; the Discord codes are added but the cross-surface parity guard is Phase 22.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status (done / blocked); files touched (absolute paths); validation results (each command pass/fail); review verdicts (per dispatched reviewer, BLOCKING/SHOULD-FIX/none); deferrals (Phase 18 internal/discord endpoints, Phase 19 limiter rework, Phase 22 matcher rework and parity guard); and a one-line handoff to "Phase 16 QA".

STOPPING RULES (stop and surface, do not push through)
- Stop if a migrated Discord route's parity fixture diffs without a documented knownDeviation (the only intended deviations are: swag-claim now reachable, isIpBlocked/turnstile now applied, the discord.* limiter now emits a stable code).
- Stop if any change would alter the WS wire protocol or snapshot shape (Discord is REST-only; no WS change is expected).
- Stop if the callback would be served as problem+json instead of the HTML bouncePage or a 302 redirect-to-error.
- Stop if wiring DISCORD_SCHEMA would require a non-additive DDL or a JSONB shape change to existing character state, or if the boot-time table assertion does not actually run under the advisory lock.
- Stop if the discord.* policy would re-type a literal instead of deriving from DISCORD_MAX_PER_MINUTE.
- Stop if determinism or sim-purity would be violated (this phase must not touch src/sim/).
````
