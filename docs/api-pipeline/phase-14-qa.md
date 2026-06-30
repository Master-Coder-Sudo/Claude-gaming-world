# Phase 14 QA: Migrate wallet + cards (server/wallet.ts)

This is the QA pass for Phase 14. It audits the wallet/card/referral migration diff for
correctness, test coverage, and dead code, then dispatches only the domain reviewers whose surface
the diff actually touches. The focus areas mirror the phase's load-bearing specifics: the binary
card path with its pre-auth 413 + `Connection: close` short-circuit, the ip+account limiter
ordering (IP before body, account after auth), the four newly-coded rate-limited responses, and
parity vs the Phase 3 fixtures. It is sized to stay under 40% context because it reviews one
domain's diff, not the whole pipeline, and reuses the harness and reviewers already built.

The QA Starter Prompt below is self-contained: a fresh-context Claude Code session can paste and
run it without reading the rest of this packet.

### QA Starter Prompt

````
This is the QA pass for Phase 14 of the API Pipeline re-architecture: Migrate wallet + cards
(server/wallet.ts). Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: verify the Phase 14 diff meets every acceptance criterion, preserves server-authority and
parity, and emits stable codes correctly; fix every BLOCKING and SHOULD-FIX finding; ship a green PR.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED. If it is dirty with files you do not own, STOP and ask.
  Stage only Phase 14 files with EXPLICIT paths, never `git add -A`.
- Confirm the Phase 14 implementation commits are present (the wallet RouteDefs, the registry +
  error_codes changes, and tests/server/wallet.test.ts). If the implementation phase is not done,
  STOP and say so.
- Scan Claude Code memory for prior findings in this domain: the server API pipeline audit, the
  BOLA/bearer-scope seam, the account-portal (Phase 13) precedent, and the DISCORD_SCHEMA
  "unwired" trap. Note anything relevant in 2 to 3 lines.

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; it returns a tight summary, you do not read large
files directly). Have it summarize:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (the current pipeline state and what
  Phase 14 recorded).
- docs/api-pipeline/phase-14-wallet.md (the deliverables, invariants, and the full acceptance
  criteria checklist: the correctness agent below must verify every item).
- The Phase 14 diff itself: `git diff` for the phase (the wallet RouteDefs in server/wallet.ts, the
  server/http/registry.ts and server/http/error_codes.ts changes, and tests/server/wallet.test.ts).
  Have the Explore agent return a per-route summary (method, path, auth scope, body kind, limiter
  key, response shape) and the exact diff hunks for the card pre-auth 413 path, the ip+account
  limiter wiring, and the four newly-coded rate-limited responses.
Explore agent must RETURN: the diff scope (files + the seven routes), the preserved-behavior hunks,
and which spine middleware (withRawBody, requireAccount, rateLimit adapter) the routes wire. No
line numbers in prose; anchor on symbols and route strings.

STEP 2 - QA AUDIT (spawn these agents in parallel, each given ONLY the Explore summary + the diff;
each prompted for COVERAGE, report every gap with confidence + severity, NOT filtering):
- Correctness agent: verify EVERY acceptance criterion in phase-14-wallet.md against the real diff,
  one by one, naming each as met or not:
  - all seven routes resolve through the new router (registry-completeness), none fall through to
    old handleApi;
  - parity vs the Phase 3 fixtures is clean or carries a documented knownDeviation;
  - /api/card uses withRawBody, the pre-auth Content-Length over-cap returns 413 + Connection:close
    BEFORE auth and before the body is read, the byte cap is the existing named constant, and
    success + error responses are binary / no-JSON-wrap;
  - ip+account ordering: IP tier before withBody + requireAccount, account tier after requireAccount;
  - the four raw 'rate limited' responses now emit a stable machine code, registered append-only in
    error_codes.ts, with no English-prose-only client path left.
  It must ALSO verify: server-authority is preserved (economy/wallet/card outcomes resolve
  server-side as before, the client decides nothing); no WS wire / snapshot change and no src/sim
  touch leaked (this packet is server-only, so the three-host determinism concern is N/A here, but
  the agent must confirm src/sim and the WS snapshot path are untouched); and the stable-code i18n
  contract holds (codes emitted server-side, no English as the source of truth, with full client
  resolution correctly DEFERRED to Phase 22 not done early).
- Test-coverage agent: do the tests actually exercise the ip+account resolution ORDER (not just that
  a limit fires), the pre-auth 413 firing before the body read, the binary error shape, and each of
  the four newly-coded 429 bodies carrying the code? Flag any acceptance criterion with no asserting
  test, and any happy-path-only route.
- Dead-code / cleanup agent: any orphaned inline wallet handler now unreachable that was left in a
  confusing half-state, unused imports, a duplicated byte-cap or limiter literal that should reuse
  the named constant, a stray knownDeviation that no longer applies, or a TODO left in the diff.
- privacy-security-review: REQUIRED (server/ touched: auth scope, ip+account rate limiting, binary
  card upload + pre-auth byte cap, economy writes). Check the bearer scope is unchanged from the
  inline handlers, the card cap cannot be bypassed, and no internal SQL/stack text leaks in any 4xx
  or 500 body.
- migration-safety: dispatch ONLY if `git diff --name-only` shows wallet/referral persistence DDL or
  a *_db schema change (it should NOT). Skip otherwise and say so.
- cross-platform-sync and architecture-reviewer: SKIP (no src/sim, no wire, no client matcher change).
Give every review agent this truncation-resume line: "If your output is truncated, resume from the
last completed item and continue until you have reviewed every file in the diff; do not restart."

STEP 3 - FIX
- Apply every BLOCKING and every SHOULD-FIX finding. Defer only NICE-TO-HAVE items and record them
  as follow-ups (do not silently drop them).
- After fixing, re-run the validation matrix: `npx tsc --noEmit`; `npx vitest run
  tests/server/wallet.test.ts`; the Phase 9 dual-path parity harness over the wallet/card/referral
  fixtures; the error_codes.ts append-only assertion; `npm run ci:changed`; `npm run build:server`.
  Before the PR, mirror CI once: `npm test && npx tsc --noEmit && npm run build:env && npm run
  build:server && npm run build`.
- Commit fixes SEPARATELY from the implementation commits, Conventional Commits with a scope,
  EXPLICIT paths (e.g. `fix(wallet): ...`, `test(server): ...`). This phase ships as its own green,
  bisectable PR in the stacked chain.

STEP 4 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md and state.md if QA changed any surface (the emitted code
  names, the ip+account ordering note, the card binary precedent). Keep them accurate to the merged
  diff.
- Record any surprising rule QA uncovered in memory (for example a subtle ordering or binary-body
  pitfall future migration phases must avoid).

STEP 5 - PACKET TEARDOWN
- Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT (return, do not write a report file): a verdict of PASS /
PASS-WITH-FOLLOWUPS / FAIL, with counts (BLOCKING found/fixed, SHOULD-FIX found/fixed, deferred
follow-ups), the validation results, the review verdicts (correctness, test-coverage, dead-code,
privacy-security-review, qa-checklist, plus migration-safety only if it ran), files touched
(absolute paths), and a one-line handoff to "Phase 15 (reports + telemetry + misc, server/reports.ts)".
````
