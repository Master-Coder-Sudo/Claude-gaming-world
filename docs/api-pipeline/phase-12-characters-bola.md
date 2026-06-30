# Phase 12: Migrate character ownership + BOLA seam (server/characters.ts)

Phase 12 ports the owner-gated character surface (`/api/me/characters`, `/api/characters`
GET/POST, and the `:id` subroutes DELETE, rename, takeover, standing, owner sheet) onto
`RouteDef`s and introduces the first `requireOwned*` resource loader plus the deny-by-default
ownership coverage test the whole packet leans on. It is sized to stay under 40% context because
it is exactly one domain module (one new `server/characters.ts` + one shared loader middleware +
its tests), it consumes the spine and parity net already built in Phases 1 to 9 rather than
building primitives, and the route set is small (one list pair, one GET/POST pair, four `:id`
subroutes). The BOLA seam is cross-cutting in INTENT but narrow in surface: one account-scoped
loader factory plus one registry-wide coverage assertion, both small.

The implementation Starter Prompt below is self-contained. A fresh Claude Code session can paste
and run it without reading this table of contents.

### Starter Prompt

````text
This is Phase 12 of the API Pipeline re-architecture: Migrate character ownership + BOLA seam
(server/characters.ts).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: this phase is NOT batch-heavy (one domain module, ~6 routes, one shared loader). Do
NOT use ultracode. Hand-spawn 3 parallel agents as named in STEP 2.
Goal: port the owner-gated character endpoints onto RouteDefs behind the new dispatcher, and
introduce the requireOwnedCharacter load-then-authorize loader plus a registry-wide
deny-by-default ownership coverage test, parity-clean against the Phase 3 fixtures.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with concurrent sessions. If it is dirty with files
  outside this phase's scope (anything not under server/characters.ts, server/http/middleware/,
  tests/server/characters.test.ts, tests/server/http/require_owned.test.ts, docs/api-pipeline/),
  STOP and ask before touching anything.
- Confirm Phase 11 shipped and is on the base branch: the new dispatcher already delegates
  un-migrated paths to the old handleApi ladder (Phase 9), and the auth routes are migrated
  (Phase 11). If the Phase 9 registry/parity harness or the Phase 2 scaffolding is missing, STOP.
- Scan Claude Code memory for entries in this phase's domain. Suggested concrete topics:
  "BOLA / object-level authorization 404-vs-403", "requireOwned account-scoped loader",
  "character routes account_id realm scoping", "thin rateLimit adapter knownDeviations".

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or main.ts directly yourself; spawn ONE
Explore agent and consume only its summary)
Tell the Explore agent to summarize, anchored on SYMBOL NAMES and ROUTE STRINGS (never line
numbers; main.ts is ~1695 lines and churns):
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (current migrated-route set, the
  registered error codes, the POLICIES entries, the knownDeviation list, the RouteDef metadata
  freeze from Phase 2 including whether requireOwned* is a RouteDef field or middleware).
- docs/api-pipeline/phase-12-characters-bola.md (this file).
- server/main.ts character dispatch, anchored on these symbols/strings: the shared
  `characterListResponse` helper (the body shared by GET /api/characters and GET
  /api/me/characters), the `GET /api/me/characters` guard, the `/api/characters` GET/POST block,
  and the `:id` subroute regexes `ownerSheetMatch` (/^\/api\/characters\/(\d+)\/sheet$/),
  `renameMatch`, `takeoverMatch`, `standingMatch`, plus the DELETE /api/characters/:id path. For
  EACH route return: method, auth scope used today (read vs full session), request body fields,
  exact success response shape, every status code it can emit, and any handler-level limiter or
  throttle it calls today.
- server/db.ts character helpers: `listCharacters(accountId)`, `characterCountForAccount`,
  `deleteCharacter(accountId, characterId)`, the account-scoped find
  (`SELECT ... FROM characters WHERE id = $1 AND account_id = $2 AND realm = $3`), the
  non-account-scoped find variant (id + realm only), `highestCharacterForAccount`, and the
  rename/takeover/standing query helpers. Return each signature and whether it already filters by
  account_id (the loader MUST use an account-scoped query, never id+realm alone).
- server/character_sheet.ts (the owner sheet builder the owner /sheet route calls).
- The prior-phase spine this phase consumes, return their public surface only:
  server/http/router.ts, compose.ts, context.ts (the Ctx type and ctx.body/ctx.params/ctx.query/
  ctx.account fields), schema.ts (object()/num()/str() + Infer), errors.ts (HttpError + mapError +
  how it picks the problem+json /api serializer), error_codes.ts (the as-const catalog and its
  append-only test), registry.ts + http/index.ts barrel, and middleware/ (withErrors,
  requireAccount({scope}), withBody, the THIN rateLimit(policy) adapter, the POLICIES table).
- server/CLAUDE.md and root CLAUDE.md (component-first RouteDef layout; invariants).
- The Phase 9 parity harness + registry-completeness test, and the Phase 2 helpers: fakeCtx,
  FakeDb (the injected-interface Db for characters), the registry-introspection meta-test helpers,
  and the Phase 3 character golden fixtures.
The Explore agent returns: a per-route request/response/status/limiter table; the account-scoped
db helper signatures; the RouteDef + middleware seam API; the requireAccount scope model; the
Phase 2 requireOwned* metadata freeze; and the parity-driver + FakeDb + fixture API. It reads the
planning docs so the implementers never do.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Hand-spawn 3 parallel agents, each owning a complete vertical slice (behavior PLUS its tests),
each given ONLY the Explore summary. All three agree on the requireOwnedCharacter signature from
the Phase 2 metadata freeze in the summary, so B and C can write their RouteDef middleware lists
without waiting on A's body. Agent A publishes the concrete loader signature in its first message.
Context risk is medium: this phase has NO documented a/b split, so do not split it; instead, if
your own context approaches 40%, checkpoint to docs/api-pipeline/progress.md and resume.

- Agent A (the BOLA seam, cross-cutting):
  - server/http/middleware/require_owned.ts: a generic `requireOwned(loader)` load-then-authorize
    factory. Scope-before-find: it runs AFTER requireAccount, calls an account-scoped loader with
    (ctx.account.id, typed ctx.params.id), populates ctx.<resource> on success, and on miss emits
    a 404 (player-owned anti-enumeration, the locked denial status) via HttpError with a stable
    code, plus a structured `bola_denied` deny-log line through the Phase 8 log/metric sink (route
    name + accountId + requested id, NEVER leaking whether the row exists for another account).
  - server/characters.ts exports `requireOwnedCharacter = requireOwned(characterLoader)` where
    characterLoader uses the account-scoped db find (id + account_id + realm), populating
    ctx.character.
  - tests/server/http/require_owned.test.ts: loader populates ctx on owned, 404 + bola_denied on
    cross-account, 404 on absent, and the deny-log carries no cross-account existence signal.
  - The registry-wide deny-by-default coverage test (in tests/server/characters.test.ts or a
    shared registry meta-test): assert every ACCOUNT-OWNED `:id` RouteDef in the registry resolves
    through an account-scoped owner loader. EXCLUDE admin/operator-scoped `:id` routes from the
    owner clause (they get an admin-scope loader in Phase 17, not here); make the exclusion an
    explicit allowlist keyed on RouteDef metadata, not a path-prefix guess. If the metadata cannot
    express the account-owned-vs-operator distinction cleanly, STOP and surface it (it is a Phase
    17 dependency).
  - Deliverable bullets: require_owned.ts factory; requireOwnedCharacter binding; bola_denied
    deny-log; the two test files above; the registry coverage assertion.

- Agent B (read routes vertical):
  - server/characters.ts read RouteDefs: GET /api/me/characters (requireAccount read-scope), GET
    /api/characters (requireAccount full-scope), GET /api/characters/:id/standing, GET
    /api/characters/:id/sheet (owner sheet). The `:id` reads carry requireOwnedCharacter after
    requireAccount and a typed num() :id param so a non-numeric :id is rejected by the decoder
    BEFORE any DB call (never reaches a query as NaN). Reuse the shared characterListResponse body
    so GET /api/characters and GET /api/me/characters stay byte-identical.
  - tests/server/characters.test.ts (read half): parity vs the Phase 3 fixtures for each read
    route; :id-as-NaN rejected by the param decoder (422, no DB call); owner sheet success-path
    parity; standing success-path parity.
  - Deliverable bullets: 4 read RouteDefs (2 list + standing + owner sheet); shared-body reuse;
    typed :id decoder; read-half tests.

- Agent C (write/mutation routes vertical):
  - server/characters.ts write RouteDefs: POST /api/characters (create; withBody + schema), DELETE
    /api/characters/:id, POST /api/characters/:id/rename (withBody + schema), POST
    /api/characters/:id/takeover (withBody + schema). The `:id` writes carry requireOwnedCharacter
    after requireAccount with a typed num() :id param.
  - Add the NEW character.* policy entries to POLICIES (character.create, character.rename,
    character.delete, character.takeover) and attach rateLimit(policy) via the Phase 8 THIN
    adapter (these limiters do not exist today; the deep two-tier rework + {remaining,resetSeconds}
    is Phase 19). These are labeled-behavioral knownDeviations: ADD them to the parity
    harness knownDeviation list with a one-line rationale each (new per-account limiter, 429
    possible where none was before). If a NEW stable error code is needed for the new 429 (e.g.
    character rate-limited), append it to error_codes.ts (append-only, AIP-193) reusing the
    existing domain.reason vocabulary; the client matcher wiring for any new code is Phase 22, so
    flag it in progress.md for Phase 22, but the parity harness asserts the code is EMITTED here.
  - tests/server/characters.test.ts (write half): create success-path parity; DELETE owned vs
    cross-account (404 + bola_denied); rename/takeover owned vs cross-account; each new
    character.* limiter fires and is asserted as a knownDeviation.
  - Deliverable bullets: 4 write RouteDefs; the 4 character.* POLICIES entries + thin adapter
    wiring; any appended error code; write-half tests + the limiter knownDeviation assertions.

After the three land, integrate: server/characters.ts exports `export const routes: RouteDef[]`
spreading all six route surfaces, and is added to registry.ts. Re-run the Phase 9
registry-completeness diff so none of these paths is dropped from the new router.

INVARIANTS THIS PHASE MUST KEEP
- Single-flag dispatch + catch-all delegate model: these six paths now resolve in the new router;
  every still-un-migrated path keeps delegating to the old handleApi ladder unchanged. Do not
  touch the delegate or the top-level CORS/OPTIONS/security-header wrappers.
- Server-authority: handlers stay THIN; the character core (listCharacters, create, delete,
  rename, takeover, standing, owner-sheet) takes no req/res so the same core is unit-testable and
  is the one authority. The client never decides ownership.
- BOLA: load-then-authorize, scope-BEFORE-find, account-scoped query only. Cross-account /
  absent -> 404 (player-owned anti-enumeration, the locked status). Structured bola_denied deny
  log. Deny-by-default registry coverage over every account-owned :id route; admin operator routes
  excluded by explicit metadata, not assumed.
- Stable-code i18n via problem+json: every player-visible error carries a stable machine `code`
  re-localized client-side, never English prose in the server. New codes are append-only in
  error_codes.ts; the matcher wiring is Phase 22.
- No magic values: the character.* limit numbers and the new code strings are named constants /
  catalog entries, not inline literals.
- No em dashes, en dashes, or emojis anywhere (code, comments, tests, docs, commits).
- Determinism / sim-purity: this phase is SERVER-ONLY. Do NOT import or touch src/sim/. Limiter
  tests use the Phase 2 injected now() clock, not Date.now directly.
- Persistence: this phase adds NO DDL and NO JSONB shape change (it reuses existing account-scoped
  db helpers). If you find yourself writing CREATE TABLE / ADD COLUMN, STOP, that is Phase 19/20.

OUT OF SCOPE (do not do these here)
- GET /api/public/characters/:id/sheet (the ANONYMOUS public sheet): migrated in Phase 10 as a
  public read. Only the OWNER sheet /api/characters/:id/sheet is in this phase.
- The /api/account/* portal family and the em-dash rate-limit string fix: Phase 13.
- The deep two-tier rate limiter, ratelimit_db.ts, and wiring RATELIMIT_SCHEMA into ensureSchema:
  Phase 19. Here only thin-adapter POLICIES entries.
- The REST i18n matcher in src/main.ts (userFacingApiError) and the per-surface code-parity guard:
  Phase 22. Append the code here; wire the client matcher there.
- Admin operator-scoped :id routes and the admin-scope loader: Phase 17. Here, only EXCLUDE them
  from the owner coverage clause.
- Security headers wrapper (Phase 21). No WS wire change. No src/sim change.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Validation commands (the canonical matrix for this change type: code change + new tests + a
possibly-appended code):
- `npx tsc --noEmit`
- `npx vitest run tests/server/characters.test.ts tests/server/http/require_owned.test.ts`
- Re-run the Phase 9 parity harness + registry-completeness test over the character fixtures
  (every character route diffs clean except the asserted character.* limiter knownDeviations).
- If you appended a code to error_codes.ts: `npx vitest run` its append-only catalog test, and
  `npx vitest run tests/localization_fixes.test.ts` (S3).
- `npm run ci:changed` (Biome on changed files only; never a whole-tree --write).
- `npm run build:server`.
- Pre-merge gate (mirror CI): `npm test && npx tsc --noEmit && npm run build:env && npm run
  build:server && npm run build`.
Review-agent dispatch (spawn ONLY surfaces this diff touches; check `git diff --name-only` first):
- privacy-security-review: REQUIRED. This phase is the BOLA seam plus the new per-account
  limiters. Prompt it for COVERAGE not filtering: every account-owned :id route is account-scoped
  before find; cross-account is 404 with no existence leak in body or deny-log; the param decoder
  blocks NaN :id; the new limiters cannot be bypassed by path casing/trailing slash.
- qa-checklist: at phase completion.
- Do NOT spawn migration-safety (no DDL/JSONB change here), cross-platform-sync (no wire/sim/
  matcher change here), or architecture-reviewer (no src/sim change).
Add to every review prompt: "If your output is truncated, resume from the last completed file and
continue; do not restart." Do not commit until each reviewer reports no BLOCKING finding.

STEP 4 - COMMIT CADENCE (Conventional Commits with a scope, EXPLICIT paths, never git add -A)
This phase ships as ONE green, bisectable PR in the stacked chain. Suggested headlines:
- `feat(http): add requireOwned load-then-authorize loader + bola_denied deny log`
  (paths: server/http/middleware/require_owned.ts, tests/server/http/require_owned.test.ts)
- `feat(server): migrate character read routes (me/characters, characters, standing, owner sheet)`
  (paths: server/characters.ts, server/http/registry.ts, tests/server/characters.test.ts)
- `feat(server): migrate character write routes + character.* limiter policies`
  (paths: server/characters.ts, the POLICIES module, server/http/error_codes.ts if appended,
  tests/server/characters.test.ts)
- `test(server): deny-by-default ownership coverage over account-owned :id routes`
  (paths: tests/server/characters.test.ts or the shared registry meta-test)
- `docs(api-pipeline): record Phase 12 character/BOLA migration`
  (paths: docs/api-pipeline/progress.md, docs/api-pipeline/state.md)

STEP 5 - ACCEPTANCE CRITERIA (verifiable checkboxes)
- [ ] server/characters.ts exports `export const routes: RouteDef[]` covering GET
      /api/me/characters, GET+POST /api/characters, DELETE /api/characters/:id, POST
      /api/characters/:id/rename, POST /api/characters/:id/takeover, GET
      /api/characters/:id/standing, GET /api/characters/:id/sheet (owner), and is in registry.ts.
- [ ] requireOwnedCharacter loads via an account-scoped query (id + account_id + realm), populates
      ctx.character, runs AFTER requireAccount, and denies cross-account/absent with 404.
- [ ] A structured bola_denied deny-log fires on every denial with NO cross-account existence
      signal in body or log.
- [ ] The deny-by-default registry coverage test passes: every account-owned :id route resolves
      through an account-scoped owner loader; admin operator :id routes are excluded by explicit
      metadata.
- [ ] A non-numeric :id is rejected by the num() param decoder (422) before any DB call; no query
      ever receives NaN.
- [ ] The four character.* limiters (create/rename/delete/takeover) fire and are recorded as
      asserted knownDeviations in the parity harness, with named-constant limits.
- [ ] GET /api/characters and GET /api/me/characters stay byte-identical (shared response body).
- [ ] The Phase 9 parity harness diffs clean on every character route except the asserted
      knownDeviations; the registry-completeness diff shows no dropped path.
- [ ] tsc, the new vitest suites, the parity + completeness tests, ci:changed, build:server, and
      the full pre-merge gate are green.
- [ ] No DDL/JSONB change; no src/sim import; no WS wire change; no em/en dashes or emojis.

STEP 6 - DOC UPDATES + MEMORY
- docs/api-pipeline/progress.md: mark Phase 12 done; list the migrated character routes, the new
  module server/characters.ts, the new middleware server/http/middleware/require_owned.ts, the
  requireOwnedCharacter loader, the four new character.* POLICIES entries, and any appended
  error_codes.ts code (flag it for Phase 22 client-matcher wiring).
- docs/api-pipeline/state.md: record the new registered routes, the BOLA loader seam, the
  bola_denied deny-log, the 404 player-owned denial decision, and the open Phase 17 dependency (the
  admin-scope loader / operator-route exclusion metadata).
- Memory: record any surprising rule you hit, e.g. the account-owned-vs-operator exclusion metadata
  shape, the shared characterListResponse byte-identity constraint, or the 404 anti-enumeration
  decision for player-owned objects.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status (DONE / BLOCKED); files touched (absolute paths); validation results (tsc,
vitest suites, parity + completeness, ci:changed, build:server, full gate, each PASS/FAIL); review
verdicts (privacy-security-review, qa-checklist); deferrals (new code -> Phase 22 matcher; operator
exclusion -> Phase 17); and a one-line handoff to "Phase 12 QA".

STOPPING RULES (stop and surface, do not work around)
- Stop if a migrated character route's parity fixture diffs without a documented knownDeviation.
- Stop if a cross-account or absent request resolves to anything other than 404 for these
  player-owned routes (403 is for admin/operator scope only, Phase 17).
- Stop if the deny-by-default coverage test cannot cleanly EXCLUDE admin operator :id routes via
  RouteDef metadata (that is a Phase 17 dependency; surface it, do not hack a path-prefix guess).
- Stop if a typed :id could reach a DB call as NaN.
- Stop if any change would alter the WS wire protocol or snapshots.
- Stop if determinism or sim-purity would be violated (any src/sim import, any Math.random/Date.now
  in tested limiter logic instead of the injected now() clock).
- Stop if the work requires new DDL or a JSONB shape change (that is Phase 19/20).
````
