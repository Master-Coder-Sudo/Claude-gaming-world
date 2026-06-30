# Phase 20: World Market realm-scope fix + partitioned backfill (own PR, migration-safety)

This phase fixes the single highest-consequence bug in the packet: every realm process shares
one `DATABASE_URL`, yet the World Market persists to one bare `world_state` key `'market'`
(a PRIMARY KEY row), so two realms collide last-writer-wins and silently lose listings and
escrowed gold during normal operation. The fix realm-scopes that key at both writers and the
reader in lockstep, then backfills the existing global blob by partitioning it per seller
realm, gated under the boot advisory lock so no realm can autosave the new key before the
backfill runs. It is intentionally narrow: persistence only, no JSON route, no WS wire, no
dispatch flag. It sits OUTSIDE the routing rollback story (the flag does not revert
persistence), which is why it is its own PR under the migration-safety reviewer. The blast
radius is `server/db.ts` plus one new backfill module and its tests, which keeps it well
under 40% context.

The implementation Starter Prompt below is self-contained: a fresh Claude Code session can
paste and run it without reading this table of contents.

### Starter Prompt

````
This is Phase 20 of the API Pipeline re-architecture: World Market realm-scope fix +
partitioned backfill (own PR, migration-safety).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: do NOT add `ultracode`. This phase is not batch-heavy (it is a focused
persistence change in one file plus one new module and its tests), so hand-spawn parallel
agents instead of orchestrating a Workflow.
Goal: realm-scope the `world_state` 'market' key at both writers and the read in lockstep,
and backfill the existing global blob per seller realm under the boot advisory lock, so two
realms on one DATABASE_URL stop clobbering each other and no existing market data is lost.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with concurrent sessions. If it is dirty with
  files you do not own, STOP and ask before staging anything. You will commit with EXPLICIT
  paths only, never `git add -A`.
- Scan Claude Code memory for entries in this phase's domain. Suggested topics to look up:
  "World Market realm-scope / world_state market key", "saveCharacterAndMarketState escrow
  txn", "ensureSchema advisory lock + the unwired DISCORD_SCHEMA trap precedent",
  "migration-safety backfill / idempotent DDL". Report what you find before changing code.

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly; spawn ONE Explore agent)
Tell the Explore agent to read and return a tight summary of:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (current packet state; which
  phases are merged ahead of this one).
- docs/api-pipeline/phase-20-market-realm-fix.md (this file: deliverables, invariants,
  acceptance criteria, stopping rules).
- server/db.ts, anchored on SYMBOL NAMES not line numbers (db.ts is large): the function
  `saveCharacterAndMarketState` (its `BEGIN` escrow txn and the `INSERT INTO world_state ...
  ['market', ...]` write), `saveWorldState`, `saveMarketState`, `loadMarketState`,
  `loadWorldState`, `ensureSchema` (the `SELECT pg_advisory_xact_lock($1)` boot lock and the
  DDL statement list), and `serializeCharacter` (the defensive `??` default load path).
- server/realm.ts: the `REALM` export (this process's realm identity, the scope key source)
  and `REALM_DIRECTORY`.
- server/CLAUDE.md (persistence model: JSONB character state, 30s autosave, "World Market is
  one global JSONB row (world_state key 'market')"; the one-process-one-realm + shared
  DATABASE_URL + pg_advisory_xact_lock invariant; SQL-lives-only-in-db.ts rule).
- root CLAUDE.md (additive idempotent DDL invariant; JSONB back-compat; no em dashes/emojis;
  Conventional Commits with explicit paths; server stays language-agnostic).
- tests/save_character_and_market.test.ts and tests/parity/golden/market_round_trip.json
  (the existing market persistence coverage you will extend).
NOTE: this phase consumes NO prior server/http/ spine modules. It is a standalone persistence
change outside the routing pipeline. The Explore agent should NOT load router/compose/registry.
Ask the Explore agent to return: the exact present signatures of the four db.ts functions
above, every site that reads or writes the bare 'market' key, how REALM is derived, the shape
of MarketSave (listings + per-seller collections + escrow), how a listing/collection maps back
to a seller character (so the backfill can resolve a seller's realm), and how ensureSchema
serializes DDL under the advisory lock.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
First, FREEZE the shared contract so the agents cannot diverge (state these names to every
agent in their brief):
- A single named key helper is the only source of the storage key: `MARKET_KEY_PREFIX`
  (constant, e.g. value 'market:') plus `marketKey(realm: string): string`. No inline
  'market:' or bare 'market' literal may remain at any call site after this phase.
- The backfill idempotency marker is its own `world_state` row under a named constant key
  (e.g. `MARKET_BACKFILL_MARKER_KEY`), set once after a successful partition.
- The legacy global key stays the constant `LEGACY_MARKET_KEY` ('market') used ONLY by the
  backfill reader and the back-compat read fallback, never by a new write.

Hand-spawn THREE parallel agents, each owning a complete vertical slice (behavior + its
tests). Give each ONLY the Explore summary plus the frozen contract above.

- Agent A (in-place realm-scoping in server/db.ts):
  - Realm-scope the 'market' write inside `saveCharacterAndMarketState` (the escrow txn) and
    inside `saveWorldState`/`saveMarketState`, both using `marketKey(REALM)`, in lockstep.
  - Change `loadMarketState` to read `marketKey(REALM)` with a back-compat fallback to
    `LEGACY_MARKET_KEY` that applies ONLY until the backfill marker is set (so a not-yet-
    backfilled boot still serves the old data, but a backfilled DB never reads the stale
    global row).
  - Add a boot-ordering GATE: the realm-scoped write path must refuse to run before the
    backfill marker exists (so a 30s autosave cannot race ahead of the backfill across N
    realms). Surface the gate as a checked precondition, not a silent skip.
  - Deliverables: edited server/db.ts; extended tests/save_character_and_market.test.ts
    covering the escrow-txn write going to the realm key, the saveWorldState/saveMarketState
    realm key, and the load fallback before/after the marker.

- Agent B (new module server/market_backfill.ts + ensureSchema wiring):
  - New module `server/market_backfill.ts`: read the existing global `LEGACY_MARKET_KEY`
    blob, PARTITION its listings and per-seller collections by each seller character's realm
    (resolved via the character->realm lookup), and write each partition to `marketKey(realm)`.
    Sellers whose realm cannot be resolved follow a documented rule (do NOT silently drop:
    route to this process's REALM or quarantine under a named key, and log a count).
  - Run the backfill ONCE under `pg_advisory_xact_lock` during boot (wire it into ensureSchema
    or a boot step that runs inside the same advisory-lock critical section), set
    `MARKET_BACKFILL_MARKER_KEY` on success, and make every subsequent realm boot a no-op
    (re-run safe / idempotent). Any DDL stays additive and idempotent (CREATE/ALTER ... IF NOT
    EXISTS); there is NO migrations directory.
  - A `dryRun` mode that logs the partition plan (per-realm listing counts + escrow sums)
    WITHOUT writing, plus a verification that asserts post-partition per-realm escrow-sum and
    listing row-count equal the pre-partition global totals.
  - Deliverables: server/market_backfill.ts; the ensureSchema/boot wiring; new
    tests/server/market_backfill.test.ts (partition correctness, idempotent re-run is a no-op,
    escrow-sum + row-count conservation, the unresolved-seller rule, dry-run writes nothing).

- Agent C (verification harness + back-compat + docs/rollback):
  - The shared escrow-sum + row-count verification helper (consumed by Agent B's dry-run and
    by the regression test) so totals are computed one way.
  - A two-realm isolation regression test: two realms on one in-memory/fake DATABASE_URL each
    save and reload their market without clobbering the other (this is the bug this phase
    fixes; assert it RED-then-GREEN against the old global-key behavior in a comment).
  - A JSONB `serializeCharacter` round-trip test proving a new state field with a defensive
    `??` default stays back-compatible (load of an old row without the field does not throw).
  - A documented data-rollback runbook: how to restore from the retained `LEGACY_MARKET_KEY`
    row (the backfill must NOT delete it), and the dry-run-then-apply operator procedure.
    Put the runbook in docs/api-pipeline/ (a phase-20 rollback note) and add a one-line
    persistence pointer in server/CLAUDE.md.
Because A and B both touch server/db.ts (the call sites vs the ensureSchema wiring), have B
land the new module + marker constant first, then A rebase onto B's constants so the
`marketKey`/marker names match exactly. There is NO documented a/b split for this phase; if
context approaches 40%, land Agent A + C as the first green commit (in-place realm-key + tests)
and Agent B (the backfill module) as a later commit in the SAME PR.

INVARIANTS THIS PHASE MUST KEEP
- Persistence: additive idempotent DDL at boot under `pg_advisory_xact_lock` (CREATE/ALTER ...
  IF NOT EXISTS); the inline DDL IS the schema, there is no migrations directory. The backfill
  is idempotent and re-run safe.
- JSONB back-compat: `serializeCharacter` keeps a defensive `??` default so old character rows
  load unchanged; round-trip stays green.
- Server-authority + server stays language-agnostic: no `t()`, no DOM; this phase emits NO new
  player-facing text. If you touch any emit, it must be a stable CODE re-localized client-side,
  never English in the server (it should not be needed here).
- Determinism / sim-purity: this is server-only and MUST NOT touch src/sim/; no Math.random in
  sim; server time is fine.
- No magic values: the storage key prefix, the marker key, and the legacy key are NAMED
  constants with a single helper, never re-typed literals.
- Single-flag dispatch model is NOT touched: no RouteDef, no catch-all delegate, no dispatch
  flag. This change is outside the routing rollback story.
- No em dashes, en dashes, or emojis anywhere (code, comments, tests, docs, commits).

OUT OF SCOPE (do not let these creep in)
- No JSON/HTTP route migration, no RouteDef, no server/http/ spine work (that is Phases 9 to 18).
- No rate limiter or ratelimit_db change (Phase 19) and no security headers (Phase 21).
- No REST i18n matcher or apiError.* catalog work (Phase 22), no metrics/logging (Phase 23),
  no config/timeouts (Phase 24).
- No change to MarketSave gameplay shape or to the in-sim market logic; only the STORAGE key
  and an additive, defaulted state field if one is genuinely required.
- No WS wire / snapshot change. No edits under src/sim/.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Validation (persistence/DDL change type, from the canonical matrix):
- `npx tsc --noEmit`
- `npx vitest run tests/save_character_and_market.test.ts tests/server/market_backfill.test.ts`
  (plus any existing affected suite the Explore agent flagged, e.g. tests/market.test.ts).
- Idempotent-DDL / backfill re-run test: run the backfill twice and assert the second run is a
  no-op and the data is unchanged. JSONB save/load round-trip test green.
- `npm run build:server`
- `npm run ci:changed` (Biome on changed files only; scoped `npx @biomejs/biome check --write
  <changed-file.ts>` if a format diff appears, NEVER a whole-tree --write).
- Pre-merge gate (mirror CI before opening the PR): `npm test && npx tsc --noEmit && npm run
  build:env && npm run build:server && npm run build`.

Review-agent dispatch (run `git diff --name-only` first; spawn ONLY surfaces this diff
touches). This diff is server/db.ts + server/market_backfill.ts + tests + docs:
- migration-safety (PRIMARY): the market fix, the backfill, the ensureSchema wiring, any JSONB
  shape change. Prompt it for COVERAGE: every data-loss, ordering, and idempotency gap.
- privacy-security-review: server/ + SQL touched. Prompt for COVERAGE on the new queries and
  the advisory-lock critical section (no SQL/error leakage, no injection via realm/key).
- qa-checklist: at phase completion.
- Do NOT spawn cross-platform-sync or architecture-reviewer: no IWorld/src/sim/wire/matcher/RL
  surface changes here.
Each reviewer is prompted for COVERAGE (report every correctness or requirement gap with
confidence and severity), NOT filtering. If a review response is truncated, resume from the
last completed file and continue; do not restart. Do NOT commit until each reports no BLOCKING.

STEP 4 - COMMIT CADENCE (Conventional Commits, scope, EXPLICIT paths)
- `feat(server): add partitioned market backfill gated under the boot advisory lock`
  -- server/market_backfill.ts, server/db.ts (ensureSchema wiring + marker constant),
  tests/server/market_backfill.test.ts
- `fix(server): realm-scope the world_state market key at both writers and the read`
  -- server/db.ts, tests/save_character_and_market.test.ts
- `test(server): two-realm market isolation and JSONB market back-compat round-trip`
  -- tests/server/market_backfill.test.ts (or a new tests/server/market_realm_isolation.test.ts),
  tests/save_character_and_market.test.ts
- `docs(api-pipeline): document the market backfill dry-run and data-rollback runbook`
  -- docs/api-pipeline/phase-20-market-realm-fix.md notes, server/CLAUDE.md persistence pointer
This phase ships as its OWN green, bisectable PR in the stacked chain, but it is OUTSIDE the
dispatch-flag rollback story (persistence is not reverted by the flag). Say so in the PR body.

STEP 5 - ACCEPTANCE CRITERIA (verifiable)
- [ ] No bare-'market' world_state write remains: both the `saveCharacterAndMarketState` escrow
      txn and `saveWorldState`/`saveMarketState` write `marketKey(REALM)` via the one named
      helper; grep for a remaining inline 'market' write returns nothing.
- [ ] `loadMarketState` reads `marketKey(REALM)` with a back-compat fallback to
      `LEGACY_MARKET_KEY` that applies ONLY until `MARKET_BACKFILL_MARKER_KEY` is set.
- [ ] The key prefix, marker key, and legacy key are NAMED constants; one `marketKey()` helper
      is the single source of truth (no duplicated literal).
- [ ] The backfill partitions the existing global blob by each seller character's realm and
      writes per-realm keys; unresolved-seller rows follow a documented rule (logged, not
      silently dropped).
- [ ] The backfill runs once under `pg_advisory_xact_lock`, sets the marker, and is a no-op on
      every subsequent realm boot (re-run safe / idempotent).
- [ ] A boot-ordering gate prevents any realm-scoped market write before the marker exists (no
      autosave can race the backfill across N realms on one DATABASE_URL).
- [ ] A dry-run mode logs the per-realm plan WITHOUT writing; verification asserts post-backfill
      per-realm escrow-sum and listing row-count equal the pre-backfill global totals.
- [ ] Two realms sharing one DATABASE_URL no longer clobber each other's market (regression
      test green; old global-key behavior shown to fail it in a comment).
- [ ] `serializeCharacter` round-trips with a defensive `??` default; loading an old row
      without a new field does not throw (round-trip test green).
- [ ] No JSON route, no WS wire, no RouteDef, no dispatch flag, no src/sim/ file touched.
- [ ] A documented data-rollback runbook exists (retained legacy row + dry-run-then-apply).
- [ ] `tsc` clean, persistence suites green, `npm run ci:changed` clean, no em/en dashes or
      emojis.

STEP 6 - DOC UPDATES + MEMORY
- docs/api-pipeline/progress.md: mark Phase 20 done; name the new surfaces: server/
  market_backfill.ts, the `MARKET_KEY_PREFIX` constant + `marketKey(realm)` helper, the
  `MARKET_BACKFILL_MARKER_KEY` row, the `LEGACY_MARKET_KEY` fallback, and the boot-ordering gate.
- docs/api-pipeline/state.md: record the realm-scoped market key scheme, the backfill gate
  ordering (backfill under the advisory lock BEFORE the first new-key write), and the
  migration-safety verdict.
- Record in Claude Code memory: the boot-ordering gate pattern (backfill under the advisory
  lock before any realm-key write across N realms on one DATABASE_URL), the escrow-sum +
  row-count conservation check, and the unwired-DISCORD_SCHEMA precedent that motivated the
  explicit ensureSchema wiring.

STEP 7 - FINAL RESPONSE FORMAT
Return: phase status (done / blocked); files touched (absolute paths); validation results (tsc,
the persistence suites, ci:changed, build:server, the full pre-merge gate); review verdicts
(migration-safety, privacy-security-review, qa-checklist, each BLOCKING/SHOULD-FIX/none);
deferrals; and a one-line handoff to "Phase 20 QA".

STOPPING RULES (stop and surface, do not push through)
- STOP if any change would alter the WS wire protocol or a snapshot shape.
- STOP if any DDL would be non-idempotent or destructive (no DROP COLUMN, no data-destroying
  ALTER; only additive CREATE/ALTER ... IF NOT EXISTS). The backfill must NOT delete the legacy
  global row.
- STOP if the backfill cannot be made idempotent + re-run safe under the advisory lock, or if a
  realm-key write could occur before the marker gate.
- STOP if post-backfill per-realm escrow-sum or listing row-count diverges from the pre-backfill
  global totals without a documented knownDeviation.
- STOP if the realm-scoped read has no safe back-compat path for a not-yet-backfilled DB.
- STOP if the change would touch src/sim/ (determinism / sim-purity) or require a JSON-route,
  RouteDef, or dispatch-flag change (that is Phases 9 to 18 and 21+).
````
