# Phase 1 QA: Importable spine + WS-auth extraction

This is the QA pass paired with Phase 1 (docs/api-pipeline/phase-01-importable-spine.md). Phase 1
is a move-behind-a-seam refactor with a hard zero-behavior-change contract, so QA is dominated by
two questions: did the WS auth handshake move byte-identically (no wire drift against
src/net/online.ts), and does the entrypoint guard keep the bundled production boot intact while
making a bare import inert. The audit is sized low-context because the diff is small (one new
module, one rewired file, two test files); it fans out a correctness agent, a test-coverage agent,
a dead-code agent, and the two domain reviewers whose surface this diff actually touches.

### QA Starter Prompt

````
This is the QA pass for Phase 1 of the API Pipeline re-architecture: Importable spine + WS-auth
extraction (the gate, zero behavior change).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: prove Phase 1 met every acceptance criterion with zero behavior change, apply any BLOCKING
and SHOULD-FIX findings, and hand off green to Phase 2.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED; if it is dirty with files you do not own, STOP and
  ask. Commit only with EXPLICIT paths, never `git add -A`.
- Scan Claude Code memory for entries on server boot / startServer, the WS auth handshake /
  ws_buffer, shared-worktree commit care, and the ESM/esbuild entrypoint-guard gotcha. Note
  anything that changes how you verify the bundled boot.

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; pass ABSOLUTE paths)
Have the Explore agent summarize, anchored on symbol names not line numbers:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (the Phase 1 entries).
- docs/api-pipeline/phase-01-importable-spine.md (the acceptance criteria and stopping rules you
  will verify against).
- The Phase 1 diff itself: `git diff` for server/ws_auth.ts, server/main.ts,
  tests/server/ws_auth.test.ts, tests/server/importable_spine.test.ts (and any docs touched).
Have it return: the exact deps-bag the ws_auth factory takes; whether the three handshake closures
moved verbatim (string-for-string, ordering preserved); how the entrypoint guard is implemented
and whether it self-invokes in both the bundled dist-server entry and a direct run while staying
inert under `import()`; and whether the prefix ladder order + await/void semantics are unchanged.

STEP 2 - QA AUDIT (fan out four agents in parallel; give each ONLY the Explore summary + the diff)
- Correctness agent. Verify EVERY acceptance criterion in phase-01-importable-spine.md item by
  item: startServer() exported and returns the http.Server; the unconditional self-invoke is gone
  and replaced by an entrypoint guard; a bare import binds no socket and opens no DB connection;
  `npm run server` (bundle) still boots; the handshake handlers live in ws_auth.ts behind the deps
  bag with byte-identical strings; the prefix dispatcher is exposed as a one-line-consumed pure
  function with identical order and void semantics. ALSO verify three-host/server parity: the WS
  handshake stays in lockstep with src/net/online.ts (no `{t:'error'|'hello'}` shape, field, or
  string drift), since that wire is shared by the offline, online, and RL hosts. ALSO verify
  stable-code i18n: NO new player-visible English string was introduced on the server, and the
  unchanged WS error strings still resolve through src/ui/server_i18n.ts. Report any criterion not
  provably met as BLOCKING.
- Test-coverage agent. Confirm tests/server/ws_auth.test.ts exercises every reject path (bad JSON,
  non-auth message, null account, non-finite character, locked moderation, missing character,
  force_rename) AND the accept path, asserting the exact strings; confirm
  tests/server/importable_spine.test.ts actually proves import-without-boot (no listen, no DB
  connect) rather than only checking export presence. Name any missing case as SHOULD-FIX (or
  BLOCKING if a reject path is untested).
- Dead-code / cleanup agent. Check for orphaned remnants of the old nested closures in main.ts, a
  now-unused import, a leftover `main()` that is never called, a duplicated handshake helper, or a
  stray export the seam does not need. Report removals.
- Domain reviewers (spawn ONLY these two; this diff touches the WS auth path and the wire
  boundary, nothing else):
  - privacy-security-review: confirm the account/moderation/character resolution and the per-IP
    connection gate run in the same order with no check dropped in the move.
  - cross-platform-sync: confirm zero WS wire drift against src/net/online.ts (verdict should be
    "no wire change"); any handshake shape/string change is BLOCKING.
  Do NOT spawn migration-safety (no DDL/JSONB) or architecture-reviewer (no src/sim/ change).
Prompt every agent for COVERAGE not filtering (report all gaps with confidence + severity). Add to
each: "If your review output is truncated, resume from the last file you completed and continue;
do not restart."

STEP 3 - FIX
Apply all BLOCKING and SHOULD-FIX findings (defer NICE-TO-HAVE with a note). Re-run the Phase 1
validation matrix after fixes:
- `npx tsc --noEmit`
- `npx vitest run tests/server/ws_auth.test.ts tests/server/importable_spine.test.ts`
- `npm run build:server`, then start the bundled entry briefly to confirm it still self-invokes,
  listens, and serves, then stop it.
- `npm run ci:changed` (scoped `npx @biomejs/biome check --write <file>` on changed files only if
  needed; never a whole-tree write).
- Full mirror gate before sign-off: `npm test && npx tsc --noEmit && npm run build:env &&
  npm run build:server && npm run build`.
Commit fixes as SEPARATE Conventional Commits with a scope and explicit paths (e.g.
`fix(server): ...` / `test(server): ...`), never `git add -A`.

STEP 4 - UPDATE DOCS + MEMORY
- Update docs/api-pipeline/progress.md (Phase 1 QA done) and docs/api-pipeline/state.md if the
  fixes changed the seam surface (the ws_auth deps bag, the startServer/dispatcher export names,
  the entrypoint-guard pattern).
- Record in memory any surprising QA finding, especially anything about the esbuild bundled-entry
  self-invoke vs the inert `import()`, or a handshake string that almost drifted.

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Return: overall verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL); counts of BLOCKING, SHOULD-FIX, and
deferred findings (found vs fixed); the validation results (tsc, the two test files, build:server
plus the bundled-boot confirmation, ci:changed, the mirror gate); the two reviewer verdicts; any
follow-ups carried forward; and a one-line handoff to the next implementation phase, "Phase 2:
Shared test scaffolding harness" (docs/api-pipeline/phase-02-test-harness.md).
````
