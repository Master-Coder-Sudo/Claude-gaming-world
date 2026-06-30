# Phase 20 QA: World Market realm-scope fix + partitioned backfill

This is the QA gate for Phase 20, the persistence change that realm-scopes the `world_state`
'market' key and backfills the existing global blob per seller realm. Because this is the
highest-consequence change in the packet (normal-operation item and gold loss), the QA bar is
data safety: prove no data is lost, the backfill is idempotent and gated, both writers and the
read use the realm key, and two realms on one DATABASE_URL no longer clobber each other. The
diff is small and local (server/db.ts + server/market_backfill.ts + tests + a rollback note),
so this QA pass stays well under 40% context.

The QA Starter Prompt below is self-contained: a fresh Claude Code session can paste and run it
without reading this table of contents.

### QA Starter Prompt

````
This is the QA pass for Phase 20 of the API Pipeline re-architecture: World Market realm-scope
fix + partitioned backfill.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: verify every Phase 20 acceptance criterion holds, the backfill loses no data and is
idempotent under the advisory lock, and the change stays strictly persistence-only (no route,
no WS wire, no src/sim/, no dispatch flag); then apply BLOCKING and SHOULD-FIX findings.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with concurrent sessions; if it is dirty with files
  you do not own, STOP and ask before staging. Commit later with EXPLICIT paths only.
- Scan Claude Code memory for this phase's domain: "World Market realm-scope", "market
  backfill / world_state", "ensureSchema advisory lock + unwired DISCORD_SCHEMA precedent",
  "migration-safety". Report 2 to 4 relevant entries before auditing.

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; do not read planning docs directly)
Have the Explore agent read and summarize:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (Phase 20 entry + recorded
  surfaces: server/market_backfill.ts, MARKET_KEY_PREFIX/marketKey, MARKET_BACKFILL_MARKER_KEY,
  LEGACY_MARKET_KEY, the boot-ordering gate).
- docs/api-pipeline/phase-20-market-realm-fix.md (the acceptance criteria, invariants, and
  stopping rules this QA must enforce).
- The actual Phase 20 diff: `git diff` (and `git diff --name-only`) for the phase commits,
  anchored on the changed symbols in server/db.ts (`saveCharacterAndMarketState`,
  `saveWorldState`, `saveMarketState`, `loadMarketState`, `loadWorldState`, `ensureSchema`,
  `serializeCharacter`), server/market_backfill.ts in full, and the test + doc changes.
Ask Explore to return: which exact write/read sites now use `marketKey(REALM)`; whether any
bare 'market' literal write remains; how the backfill resolves a seller's realm and what it
does with unresolved sellers; how the marker gate is enforced; and the precise list of changed
files. The Explore agent should NOT load the server/http/ spine (this phase does not touch it).

STEP 2 - QA AUDIT (hand-spawn parallel agents; give each only the Explore summary + the diff)
- Correctness agent: verify EVERY acceptance criterion in phase-20-market-realm-fix.md item by
  item, and specifically:
  - Both writers (the `saveCharacterAndMarketState` escrow txn AND `saveWorldState`/
    `saveMarketState`) and the read (`loadMarketState`) use `marketKey(REALM)`; no bare-'market'
    write survives.
  - The backfill conserves data: post-backfill per-realm escrow-sum + listing row-count equal
    the pre-backfill global totals; unresolved sellers are logged and routed, not dropped; the
    legacy global row is RETAINED (never deleted) for rollback.
  - Idempotency: a second backfill run is a no-op; the marker gates any realm-key write so a
    30s autosave cannot race the backfill across N realms on one DATABASE_URL.
  - Three-host / server parity: this is server-only persistence; confirm the offline browser
    Sim and the headless RL path are UNAFFECTED (no src/sim/ change, MarketSave gameplay shape
    unchanged, serializeCharacter round-trip back-compatible). The realm-key change must not
    leak into any non-server host.
  - Stable-code i18n: confirm NO new English player-facing string was added to the server; if
    any emit was touched, it routes through a stable CODE re-localized client-side, never
    English in the server.
- Test-coverage agent: confirm tests actually exercise the escrow-txn realm write, both
  saveWorldState/saveMarketState writes, the load fallback before AND after the marker, the
  two-realm isolation regression (old global-key behavior shown to fail it), idempotent re-run,
  escrow-sum + row-count conservation, the dry-run-writes-nothing path, the unresolved-seller
  rule, and the JSONB defaulted-field round-trip. Flag any criterion asserted in prose but not
  covered by a test.
- Dead-code / cleanup agent: flag any duplicated key literal that should be the named constant,
  any unused helper, any leftover bare 'market' string, any commented-out scratch, and any
  whole-tree biome reformat creeping outside the changed files.
- Domain review agents (spawn ONLY surfaces this diff touches; run `git diff --name-only`
  first): migration-safety (PRIMARY: data-loss, ordering, idempotency, advisory-lock
  correctness, additive-DDL) and privacy-security-review (the new SQL + the advisory-lock
  critical section: no injection via realm/key, no SQL/error leakage). Do NOT spawn
  cross-platform-sync or architecture-reviewer (no IWorld/src/sim/wire/RL surface here).
Each agent is prompted for COVERAGE (report every gap with confidence + severity), not
filtering. If a review response is truncated, resume from the last completed file and continue;
do not restart.

STEP 3 - FIX (apply BLOCKING + SHOULD-FIX; defer NICE-TO-HAVE with a note)
- Apply every BLOCKING and SHOULD-FIX finding test-first where a behavior changes (a failing
  test that reproduces the gap, then the smallest fix).
- Re-run the validation matrix after fixes: `npx tsc --noEmit`; `npx vitest run
  tests/save_character_and_market.test.ts tests/server/market_backfill.test.ts` (plus any
  affected suite); the idempotent re-run + JSONB round-trip tests; `npm run build:server`;
  `npm run ci:changed`. Before declaring PASS, run the full pre-merge gate: `npm test && npx
  tsc --noEmit && npm run build:env && npm run build:server && npm run build`.
- Commit fixes as SEPARATE Conventional Commits with a scope and EXPLICIT paths (e.g.
  `fix(server): ...`, `test(server): ...`), never `git add -A`.

STEP 4 - UPDATE DOCS + MEMORY
- Update docs/api-pipeline/progress.md and state.md to reflect the QA verdict and any fixes
  (note the final names: server/market_backfill.ts, marketKey/MARKET_KEY_PREFIX,
  MARKET_BACKFILL_MARKER_KEY, LEGACY_MARKET_KEY, the boot-ordering gate).
- Record in memory any surprising rule found during QA (e.g. a backfill ordering subtlety
  across N realms, or an escrow-sum conservation edge case).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Return one verdict line: PASS / PASS-WITH-FOLLOWUPS / FAIL, then counts (BLOCKING fixed,
SHOULD-FIX fixed, deferred follow-ups), the validation + full-gate results, the migration-safety
and privacy-security-review verdicts, and a one-line handoff to the next implementation phase:
"Phase 21: security-headers (Security headers top-level wrapper + Content-Type/Origin
enforcement)."
````
