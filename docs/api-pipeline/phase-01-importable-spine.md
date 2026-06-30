# Phase 1: Importable spine + WS-auth extraction (the gate, zero behavior change)

This is the first phase of the API Pipeline re-architecture and the gate the entire
test net stands on. Today `server/main.ts` self-invokes at module load (`main().catch(...)`
at the file tail), so the request spine cannot be imported without binding a socket and
touching the DB, and the WS auth handshake (`authenticateWebSocket`, `onConnection`, the
`server.on('upgrade', ...)` attach) lives as closures nested inside `main()`. Nothing in
later phases can unit-test routing or drive the server in-process until that changes. This
phase only makes the spine importable and lifts the WS auth handshake into its own module
with ZERO behavior change. It is sized low-context because it moves code behind a seam and
adds a smoke test, it does not design routing, middleware, the env flag, or any hardening
(those are Phases 4 and later). It is the first PR in the stacked chain.

Read the two source-of-truth files before executing: the canonical locked decisions and the
synthesis JSON (Phase 1 is `.recommendedPhases[0]`, num "1"). Do not contradict them.

### Starter Prompt

````
This is Phase 1 of the API Pipeline re-architecture: Importable spine + WS-auth extraction
(the gate, zero behavior change).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: NOT needed here. This is a small, low-context move-behind-a-seam phase, not a
batch sweep. Hand-spawn the two parallel agents named in STEP 2; do not orchestrate a Workflow.
Goal: make the server request spine importable without binding a socket, and lift the WS auth
handshake into its own module, both with zero behavior change, so every later phase can
unit-test routing and drive the server in-process.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with concurrent sessions; if it is dirty with files
  you do not own, STOP and ask before touching anything. You will commit with EXPLICIT paths
  only, never `git add -A`.
- Scan Claude Code memory for entries in this phase's domain. Suggested topics to look up:
  "server boot / startServer", "WS auth handshake / ws_buffer", "shared-worktree commit care",
  "Workflow-agent cwd/worktree gotcha" (subagents resolve relative paths against session cwd,
  so pass ABSOLUTE paths). Note anything relevant before you start.

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or main.ts directly; spawn ONE Explore agent)
Tell the Explore agent to summarize, anchored on SYMBOL NAMES and route strings (main.ts is
~1710 lines, every line number in any SPEC is stale):
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (if present; this phase may be
  the one that bootstraps them).
- docs/api-pipeline/phase-01-importable-spine.md (this file).
- server/main.ts, specifically: `async function main()` (the boot function); the
  `http.createServer((req, res) => { ... })` prefix-dispatch ladder (the `/internal/`,
  `/admin/api/`, `/api/`, `/oauth/`, `/p/`, `/avatar/`, `/c/`, sitemap, `serveStatic` arms and
  the CORS + OPTIONS-204 short-circuit above them); `new WebSocketServer({ noServer: true,
  maxPayload: 16 * 1024 })`; `server.on('upgrade', ...)`; the nested
  `async function authenticateWebSocket(ws, raw, req)`; the nested
  `async function onConnection(ws, req)`; and the `main().catch(...)` self-invoke at the file tail.
- server/ws_buffer.ts (the `bufferHandshakeMessages` seam already extracted, the pattern to mirror).
- server/CLAUDE.md (the IO/pure split exemplars `wallet_link.ts`/`wallet.ts` and
  `SocialService`/`SocialDb`; the "Wire protocol lockstep with src/net/online.ts" invariant; the
  "no browser/render/ui imports" rule).
- root CLAUDE.md (module-first doctrine, "never GROW main.ts").
- Prior phases' new modules under server/http/: there are NONE yet. Phase 1 is the first phase
  and creates no http/ spine module; it establishes the seam (an importable dispatcher + a
  startServer entrypoint) that Phases 4 and later build on. State this explicitly so no agent
  invents an http/ module here.
What the Explore agent must RETURN:
1. The exact dependency set the two nested closures reference from module scope, so the ws_auth
   deps bag is complete: at minimum `accountForToken`, `moderationStatusForAccount`,
   `getCharacter`, `chatMuteStatusForAccount`, `requestMetadata`, `isAdminAccount`,
   `isConnectionRefused`, the `game` (GameServer) instance, and `bufferHandshakeMessages`.
   List each symbol and where it is defined (module-level in main.ts vs imported).
2. Every top-level side effect that runs at import TODAY (pg Pool creation in db.ts, any
   module-level setInterval/setTimeout, the `main().catch(...)` self-invoke) so the
   import-without-boot claim is verifiable. Flag anything that would still touch the DB or bind a
   handle on a bare `import`.
3. The exact prefix-ladder order and which arms are `await`ed vs fired as non-awaited `void`,
   verbatim, so the extracted dispatcher reproduces the order and the void semantics one-to-one.
4. How the repo already detects "run as entrypoint" elsewhere, if anywhere (grep for
   `import.meta`, `process.argv`, `fileURLToPath`); the server is ESM and is esbuild-bundled to
   dist-server by `npm run build:server`, so the guard must self-invoke in BOTH the bundled entry
   and a direct run, while a Vitest `import()` must NOT boot.
5. Confirmation of every WS handshake string and event the closures send (`'bad auth message'`,
   `'authentication required'`, `'not authenticated'`, the moderation `status.message`,
   `'no such character'`, the force-rename line, the `{t:'error', error}` / `{t:'hello'}` shapes)
   so the move can be proven byte-identical and no wire drift slips in.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Hand-spawn TWO parallel agents, partitioned by FILE OWNERSHIP so they never stomp the shared
main.ts. Give each ONLY the Explore summary (not the raw files). No documented a/b split exists
for this low-context phase; if context unexpectedly approaches 40%, finish Agent A first, then
Agent B.
- Agent A (WS auth module slice). OWNS: server/ws_auth.ts (new) + tests/server/ws_auth.test.ts (new).
  Deliverables:
  - Create server/ws_auth.ts exporting a factory (mirror the wallet_link.ts/SocialService IO-pure
    split, NOT a one-line re-export) that takes an injected deps bag (the symbols from Explore
    item 1) and returns the handshake handlers: `authenticateWebSocket`, `onConnection`, and an
    `attachUpgrade(server, wss)` (or equivalent) that registers the `server.on('upgrade', ...)`
    listener. Move the three closures VERBATIM behind the deps bag; change references only from
    closed-over names to deps-bag fields. No logic, no string, no ordering edit.
  - tests/server/ws_auth.test.ts: drive `authenticateWebSocket` with a fake ws and fake deps over
    every reject path (bad JSON, non-auth message, null account, non-finite character, locked
    moderation status, missing character, force_rename) and the accept path, asserting the exact
    unchanged strings/events and that the accept path reaches `onConnection`/`game.join`.
  - Return (do NOT edit main.ts) a precise rewire spec for Agent B: which lines/closures to delete
    from `main()` and the exact factory-construction + `attachUpgrade` call to insert in their place.
- Agent B (entrypoint + dispatcher slice). OWNS: server/main.ts + tests/server/importable_spine.test.ts (new).
  Deliverables:
  - Export `startServer()` that performs today's `main()` boot and returns the `http.Server`
    instance (so later phases and tests can drive it in-process). Keep boot behavior identical.
  - Replace the unconditional `main().catch(...)` tail with an entrypoint-guarded self-invoke
    (per Explore item 4) so the bundled entry and a direct run still boot, but a bare `import()`
    binds NO socket and opens NO DB connection.
  - Expose the createServer prefix-dispatch ladder as an importable pure function (e.g.
    `routeHttpRequest(req, res)`) that the `http.createServer(...)` callback consumes in one line,
    reproducing the prefix order, the CORS + OPTIONS-204 short-circuit position, and the
    non-awaited `void` semantics EXACTLY (Explore item 3). This is the seam Phase 9 puts the new
    dispatcher in front of; do not add the flag or the new dispatcher here.
  - Apply Agent A's rewire spec so `main()`/`startServer()` constructs the ws_auth factory and
    calls `attachUpgrade`; main() becomes a thin consumer.
  - tests/server/importable_spine.test.ts: `await import` the entry module and assert it completes
    without binding a socket or connecting to the DB (no listening handle on the configured port),
    and that the new exports (`startServer`, the dispatcher function) exist with the right types.

INVARIANTS THIS PHASE MUST KEEP
- Zero behavior change. This is a move-behind-a-seam refactor: same routes, same prefix order,
  same WS handshake, same boot. Any diff that changes runtime behavior is a bug.
- WS wire protocol stays in lockstep with src/net/online.ts. The handshake message handling, the
  `{t:'error', error}` / `{t:'hello'}` shapes, and every error string move byte-identical. (STOP
  rule if not.)
- Server-authority preserved: WS auth still resolves account, moderation, character, and the
  per-IP connection gate server-side, in the same order.
- Module-first: the WS handshake lands as its own server/ws_auth.ts module behind an injected deps
  bag; main.ts must not GROW. No new server/http/ spine module is created in this phase.
- server/ stays Node-only: no imports from render/ui/game/net, no DOM/Three. (server/CLAUDE.md.)
- Determinism / sim-purity: this is server-only and must NOT touch src/sim/; introduce no
  `Math.random`/`Date.now`/`performance.now` into any sim path. (No clock injection here; that is
  Phase 2.)
- Stable-code i18n: introduce NO new player-visible English strings on the server. Existing WS
  error strings are unchanged and still re-localized client-side via src/ui/server_i18n.ts.
- No magic values: reuse the existing constants (PORT, the `16 * 1024` maxPayload, etc.) as-is;
  introduce none.
- No em dashes, no en dashes, no emojis anywhere (code, comments, commits, docs).
- Conventional Commits with a scope and EXPLICIT paths, never `git add -A`.

OUT OF SCOPE (do not do these; they are later phases)
- The env dispatch flag and the catch-all per-path delegate (Phase 9, default-flip Phase 25).
- The server/http/ spine: router.ts, compose.ts, context.ts, schema.ts, errors.ts,
  error_codes.ts, registry.ts, middleware/* (Phases 4 to 8).
- The shared test harness: fake-http/fakeCtx, the injected now() clock, FakeRateLimitStore,
  FakeDb interfaces, the golden-master normalizer, the parity driver, loadConfig(env) (Phase 2).
- Characterization/golden fixtures and the route-count freshness gate (Phase 3).
- Any hardening: new limiters, BOLA loaders, security headers, 415/withRawBody, the bearer-gap
  close, the em-dash rate-limit string fix, the market realm-scope fix, the REST i18n matcher.
- Wiring DISCORD_SCHEMA or RATELIMIT_SCHEMA into ensureSchema (Phases 16/19).
- Creating server/account.ts or any per-domain route module (Phases 10 to 18).
- Splitting or extracting the prefix ladder's individual handlers; only EXPOSE the ladder as a
  function, do not refactor its arms.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Validation (change type: code + server build + new tests; not persistence, not player text):
- `npx tsc --noEmit`
- `npx vitest run tests/server/ws_auth.test.ts tests/server/importable_spine.test.ts`
- `npm run build:server`, then confirm the BUNDLED entry still self-invokes and boots (the
  entrypoint guard must not regress `npm run server`): start the bundled server briefly, confirm
  it listens and serves, then stop it. This is the load-bearing check for this phase.
- `npm run ci:changed` (Biome on changed files only; scoped `npx @biomejs/biome check --write
  <file>` on your changed files only if it flags format, never a whole-tree write).
- Full pre-merge mirror gate before opening the PR:
  `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`.
Review dispatch (spawn ONLY the surfaces this diff touches; run `git diff --name-only` first):
- privacy-security-review: REQUIRED. The WS auth handshake and the per-IP connection gate moved
  into a new module; confirm the account/moderation/character checks and the IP gate run in the
  same order with no path skipped.
- cross-platform-sync: REQUIRED here specifically because the diff touches the WS auth handshake,
  which is the wire boundary shared by the offline/online/RL hosts. Its job is to CONFIRM zero
  wire drift against src/net/online.ts (the verdict should be "no wire change"). If it finds any
  handshake shape or string changed, that is a BLOCKING stop.
- qa-checklist: REQUIRED at phase completion.
- NOT dispatched: migration-safety (no DDL/JSONB), architecture-reviewer (no src/sim/ change).
Prompt each reviewer for COVERAGE, not filtering: report every correctness or requirement gap
with confidence and severity. Add to each: "If your review output is truncated, resume from the
last file you completed and continue; do not restart." Do NOT commit until each reviewer reports
no BLOCKING findings.

STEP 4 - COMMIT CADENCE (stacked PR chain; this phase is the FIRST green, bisectable PR)
Use Conventional Commits with a scope and explicit paths:
1. `refactor(server): lift WS auth handshake into importable ws_auth module`
   paths: server/ws_auth.ts server/main.ts
2. `refactor(server): export startServer + prefix dispatcher, guard module self-invoke`
   paths: server/main.ts
3. `test(server): import-without-boot smoke + ws_auth handshake coverage`
   paths: tests/server/ws_auth.test.ts tests/server/importable_spine.test.ts
Optionally fold the docs bootstrap into a 4th `docs(api-pipeline): ...` commit (see STEP 6).
Open this as its own PR; the suite must be green at every commit.

STEP 5 - ACCEPTANCE CRITERIA (verifiable)
- [ ] `server/main.ts` exports `startServer()` returning the `http.Server`, and the module no
      longer self-invokes unconditionally: the boot is behind an entrypoint guard.
- [ ] `await import('server/main.ts')` (or the built entry) completes WITHOUT binding a socket and
      WITHOUT opening a DB connection (no listening handle on the configured port); the smoke test
      asserts this.
- [ ] `npm run server` (the esbuild bundle) still boots, listens, and serves identically; the
      bundled entry still self-invokes.
- [ ] `authenticateWebSocket`, `onConnection`, and the `upgrade` attach live in server/ws_auth.ts
      behind an injected deps bag; main() is a thin consumer; every WS error string and handshake
      shape is byte-identical.
- [ ] The createServer prefix ladder is exposed as an importable pure function consumed one-line
      by `http.createServer(...)`, with the SAME prefix order, the SAME CORS/OPTIONS-204
      short-circuit position, and the SAME non-awaited `void` semantics.
- [ ] tests/server/ws_auth.test.ts covers every reject path and the accept path with unchanged
      strings; tests/server/importable_spine.test.ts asserts import-without-boot and the new exports.
- [ ] `npx tsc --noEmit`, the new tests, `npm run build:server`, and `npm run ci:changed` are all
      green; the full pre-merge mirror gate passes.
- [ ] Zero WS wire change and zero route behavior change confirmed (nothing in the prefix ladder
      reordered, no arm flipped between await and void).

STEP 6 - DOC UPDATES + MEMORY
- If docs/api-pipeline/progress.md and docs/api-pipeline/state.md do not exist yet, bootstrap them
  here (this is the first phase). progress.md: a phase table mirroring the 25-phase list with
  Phase 1 marked done. state.md: the live seam inventory. Record the NEW surface this phase adds:
  module `server/ws_auth.ts` (the ws_auth factory + deps bag + `attachUpgrade`); the new exports
  `startServer()` and the prefix-dispatcher function name; the entrypoint-guard pattern; the new
  test files under tests/server/. Note that Phase 2 standardizes the tests/server/ directory.
- Record in Claude Code memory the surprising rule worth keeping: the ESM + esbuild entrypoint
  guard must self-invoke in BOTH the bundled dist-server entry and a direct run while staying
  inert under a Vitest `import()`, and that bare-importing main.ts must not trigger db.ts pool
  connection or a `.listen()`. Also record the ws_auth deps-bag symbol set.

STEP 7 - FINAL RESPONSE FORMAT
Return, in order: (1) phase status (done / blocked); (2) files touched (absolute paths);
(3) validation results (tsc, the two test files, build:server + the bundled-boot confirmation,
ci:changed, the mirror gate); (4) review verdicts (privacy-security-review, cross-platform-sync
wire-drift verdict, qa-checklist), each with BLOCKING/SHOULD-FIX/none; (5) any deferrals;
(6) a one-line handoff to "Phase 1 QA" (docs/api-pipeline/phase-01-qa.md).

STOPPING RULES (stop and surface, do not push through)
- STOP if any change would alter the WS wire protocol: an auth message field, the `{t:'error',
  error}` or `{t:'hello'}` shape, an error string, or the handshake ordering. The wire stays in
  lockstep with src/net/online.ts.
- STOP if the entrypoint guard regresses the production boot path (`npm run server` must still
  self-invoke and listen) or if a bare `import()` still binds a socket or connects to the DB.
- STOP if the prefix-dispatch order changes or any ladder arm flips between `await` and
  non-awaited `void`. Zero behavior change is the contract.
- STOP if you find yourself adding the env dispatch flag, a server/http/ spine module, any
  middleware, FakeDb/clock scaffolding, or any hardening: that belongs to a later phase.
- STOP if a change would touch src/sim/ or introduce `Math.random`/`Date.now`/`performance.now`
  into a sim path (determinism/sim-purity).
````
