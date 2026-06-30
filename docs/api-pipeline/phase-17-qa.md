# Phase 17 QA: Migrate Admin API onto the shared seam (server/admin.ts)

This is the QA pass for Phase 17. It audits the admin migration diff for correctness, test
coverage, and dead code, then dispatches only the domain reviewers whose surface the diff actually
touches. The focus areas mirror the phase's load-bearing specifics: the frozen `{success, data,
error}` envelope (including the `data:{ok:true}` bodies), the `page`/`limit` (NOT `page`/`pageSize`)
pagination contract, the enum-segment route restructured to a schema-validated `:param`, the
admin-scope `:id` loader excluded from the account-owner BOLA clause with a 403 (not 404) denial,
the isolated `admin.login` limiter, the preserved `game.*` side effects, and parity vs the admin
fixtures. It is sized to stay under 40% context because it reviews one domain's diff (and may review
one a/b half at a time), reusing the harness and reviewers already built.

The QA Starter Prompt below is self-contained: a fresh-context Claude Code session can paste and run
it without reading the rest of this packet.

### QA Starter Prompt

````
This is the QA pass for Phase 17 of the API Pipeline re-architecture: Migrate Admin API onto the
shared seam (server/admin.ts). Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: verify the Phase 17 diff meets every acceptance criterion, preserves server-authority, the
frozen admin envelope + page/limit contract, the admin-scope BOLA exclusion, and route parity; fix
every BLOCKING and SHOULD-FIX finding; ship a green PR (or a green a/b half).

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED. If it is dirty with files you do not own, STOP and ask.
  Stage only Phase 17 files with EXPLICIT paths, never `git add -A`.
- Confirm the Phase 17 implementation commits are present (the admin RouteDefs in server/admin.ts,
  the admin-auth gate + admin-scope :id loader + page/limit decoder under server/http/, the
  registry + errors changes, and tests/server/admin.test.ts). If the phase shipped its a/b split as
  two PRs, note which half you are QA'ing (17a auth/overview/online/accounts/ip, or 17b chat-filter/
  moderation-queue/bug-reports/characters). If the implementation phase is not done, STOP and say so.
- Scan Claude Code memory for prior findings in this domain: the server API pipeline audit, the
  BOLA/bearer-scope + requireOwned* seam (Phase 12), the Discord/moderation isIpBlocked + turnstile
  parity notes, and the DISCORD_SCHEMA "unwired" trap. Note anything relevant in 2 to 3 lines.

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; it returns a tight summary, you do not read large
files directly). Have it summarize:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (the current pipeline state and what
  Phase 17 recorded).
- docs/api-pipeline/phase-17-admin.md (the deliverables, invariants, the a/b split, and the FULL
  acceptance criteria checklist: the correctness agent below must verify every item).
- The Phase 17 diff itself: `git diff` for the phase (the admin RouteDefs in server/admin.ts, the
  admin-auth gate + admin-scope loader + page/limit decoder under server/http/middleware and
  schema.ts, the server/http/registry.ts and server/http/errors.ts changes, and
  tests/server/admin.test.ts). Have the Explore agent return a per-route summary (method, path, the
  :param captured, auth = admin vs anonymous, body kind, limiter, response shape) and the exact diff
  hunks for: the {success,data,error} envelope helpers, the page/limit decoder, the enum :id/:action
  restructure + its schema enum, the admin-scope :id loader + its BOLA exclusion + 403 denial, the
  admin.login limiter store, and the preserved game.* side effects per moderation route.
Explore agent must RETURN: the diff scope (files + the admin routes), the preserved-behavior hunks,
which spine middleware (requireAdmin, the admin-scope loader, requireAccount, the rateLimit adapter,
the typed query/enum decoders) the routes wire, and the seeded knownDeviations. No line numbers in
prose; anchor on symbols and route strings.

STEP 2 - QA AUDIT (spawn these agents in parallel, each given ONLY the Explore summary + the diff;
each prompted for COVERAGE, report every gap with confidence + severity, NOT filtering):
- Correctness agent: verify EVERY acceptance criterion in phase-17-admin.md against the real diff,
  one by one, naming each as met or not:
  - every admin route resolves through the new router (registry-completeness), none falls through to
    old handleAdminApi;
  - the {success,data,error} envelope is frozen by a contract test on a success body, an error body,
    AND a data:{ok:true} body, and is selected by mapError for /admin/api (not problem+json);
  - the page/limit contract is preserved (NOT page/pageSize), DEFAULT_PAGE_LIMIT + MAX_PAGE_LIMIT are
    reused as named constants, and the rows/total/page/limit shape is unchanged;
  - the enum-segment route is restructured to :id/:action with a schema-validated enum, the
    no-regex-routing guard passes, and an invalid action is rejected (422) as a documented
    knownDeviation if the old ladder returned 404;
  - admin.login is on its own isolated per-policy limiter (ADMIN_LOGIN_MAX_PER_MINUTE), anonymous,
    with parity 429 / 401 / 403 / 200 shapes;
  - the admin operator-scoped :id routes resolve through an admin-scope loader EXCLUDED from the
    account-owner BOLA coverage clause, denial is 403 (not 404) with bola_denied logging, and
    :id-as-NaN is rejected;
  - the requireAdmin is_admin gate + the 401 'admin authentication required' parity are preserved;
  - every guard (admin accounts cannot be suspended/banned/chat-muted, 400) and every game.* side
    effect (disconnectAccount / muteAccountChat / liftChatMuteLive / resetChatStrikesLive /
    reloadChatFilter / reloadBlockedIps / disconnectByIp) and the best-effort, isolated
    emailSecurityIncident are preserved.
  It must ALSO verify: server-authority is preserved (every moderation/account/IP/chat-filter outcome
  resolves server-side as before, the dashboard decides nothing); no WS wire / snapshot change and no
  src/sim touch leaked (this packet is server-only, so the three-host determinism concern is N/A
  here, but the agent must confirm src/sim and the WS snapshot path are untouched); and the
  language-agnostic-server / stable-code i18n contract holds (server stays t()-free and DOM-free, the
  existing admin error strings are kept for parity, and the admin dashboard i18n in src/admin/ is NOT
  touched, with client localization correctly DEFERRED).
- Test-coverage agent: do the tests actually FREEZE the envelope on all three variants (success,
  error, data:{ok:true}), assert the page/limit shape (not just that a page is returned), exercise the
  enum decoder accepting the four actions AND rejecting a fifth, assert the admin-scope denial is 403
  (not 404) and that the route is excluded from the owner clause, assert admin.login's limiter fires
  independently, and assert each preserved game.* side effect fires on the FakeDb/fake-game? Flag any
  acceptance criterion with no asserting test, any happy-path-only route, and any moderation route
  whose side effect is untested.
- Dead-code / cleanup agent: any orphaned inline handleAdminApi branch left in a confusing half-state,
  unused imports, a duplicated page-limit or limiter literal that should reuse the named constant, a
  leftover regex matcher the enum restructure made dead, a stray knownDeviation that no longer
  applies, or a TODO left in the diff.
- privacy-security-review: REQUIRED (server/ touched: the admin auth gate, the operator BOLA loader +
  403 denial, the isolated admin-login limiter, IP-block writes that disconnect users, moderation
  actions that ban/disconnect accounts, SQL via the *_db modules). Confirm no internal SQL/stack text
  leaks in any 4xx/500 body, the is_admin gate cannot be bypassed, and the admin-scope loader cannot
  read or act on a cross-scope object.
- migration-safety: dispatch ONLY if `git diff --name-only` shows a *_db DDL / schema change (it
  should NOT; admin only queries existing tables). Skip otherwise and say so.
- cross-platform-sync and architecture-reviewer: SKIP (no src/sim, no wire, no client matcher change).
Give every review agent this truncation-resume line: "If your output is truncated, resume from the
last completed item and continue until you have reviewed every file in the diff; do not restart."

STEP 3 - FIX
- Apply every BLOCKING and every SHOULD-FIX finding. Defer only NICE-TO-HAVE items and record them as
  follow-ups (do not silently drop them).
- After fixing, re-run the validation matrix: `npx tsc --noEmit`; `npx vitest run
  tests/server/admin.test.ts` plus the affected admin_*_db / admin_format_i18n / i18n_admin_catalog
  suites; the Phase 4 no-regex-routing guard; the Phase 12 deny-by-default BOLA coverage test; the
  Phase 9 dual-path parity harness over the admin fixtures; the Phase 7 error_codes.ts append-only
  assertion (if a code was added); `npm run ci:changed`; `npm run build:server`. Before the PR, mirror
  CI once: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`.
- Commit fixes SEPARATELY from the implementation commits, Conventional Commits with a scope, EXPLICIT
  paths (e.g. `fix(admin): ...`, `test(server): ...`). This phase (or each a/b half) ships as its own
  green, bisectable PR in the stacked chain.

STEP 4 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md and state.md if QA changed any surface (the admin-scope loader
  name + its BOLA exclusion, the 403 denial, the page/limit decision, the enum :param restructure, the
  isolated admin.login limiter, the 405/404-before-auth + enum-invalid-422 knownDeviations). Keep them
  accurate to the merged diff.
- Record any surprising rule QA uncovered in memory (for example a subtle admin-scope-vs-account-owner
  loader pitfall, the page/limit-vs-page/pageSize divergence, or the GameServer-in-Ctx requirement that
  Phase 18 must respect).

STEP 5 - PACKET TEARDOWN
- Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT (return, do not write a report file): a verdict of PASS /
PASS-WITH-FOLLOWUPS / FAIL, with counts (BLOCKING found/fixed, SHOULD-FIX found/fixed, deferred
follow-ups), the validation results, the review verdicts (correctness, test-coverage, dead-code,
privacy-security-review, qa-checklist, plus migration-safety only if it ran), files touched (absolute
paths), and a one-line handoff to "Phase 18 (OAuth JSON + Internal, server/oauth.ts + server/internal.ts)".
````
