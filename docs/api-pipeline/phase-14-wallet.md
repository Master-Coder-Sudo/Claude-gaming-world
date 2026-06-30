# Phase 14: Migrate wallet + cards (server/wallet.ts)

This phase ports the economy-adjacent write surface (`/api/wallet/*`, `/api/woc/balance`,
`/api/card`, `/api/referrals`) off the inline `handleApi` ladder and onto `RouteDef`s consumed
by the spine built in Phases 4 to 9. It is a single-domain migration with two load-bearing
specifics: the `ip+account`-keyed limiter ordering (the account is known only after the DB token
lookup, so the IP tier must gate before the body and DB, the account tier after auth) and the
binary card upload, which goes through the `withRawBody` variant and must keep its pre-auth
byte-cap 413 short-circuit plus `Connection: close`. It also gives the four previously-raw
`{error:'rate limited'}` responses (wallet link challenge, wallet link, woc balance, card) stable
machine codes via the error model. It is sized to stay under 40% context because it is one domain,
consumes the already-built spine and harness, adds no new DDL, and changes no WS wire.

The implementation Starter Prompt below is self-contained: a fresh-context Claude Code session
can paste and run it without reading the rest of this packet.

### Starter Prompt

````
This is Phase 14 of the API Pipeline re-architecture: Migrate wallet + cards (server/wallet.ts).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: this phase is NOT batch-heavy (one domain, ~7 routes). Do NOT use ultracode; hand-spawn
a small parallel Agent fan-out as described in STEP 2.
Goal: port /api/wallet/link/challenge, /api/wallet/link (POST and DELETE), /api/wallet (GET),
/api/woc/balance, /api/card (binary), and /api/referrals onto RouteDefs behind the new router,
parity-clean, preserving the ip+account limiter ordering and the card pre-auth 413 short-circuit,
and emit stable codes for the four raw "rate limited" responses.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with concurrent sessions. If it is dirty with files you
  do not own, STOP and ask before staging anything. You will commit with EXPLICIT paths only,
  never `git add -A`.
- Scan Claude Code memory (the MEMORY.md index) for entries in this phase's domain. Suggested
  topics to look up: (1) the server API pipeline audit and the canonical locked decisions,
  (2) the BOLA / requireOwned seam and bearer-scope model introduced in Phase 12, (3) the
  account-portal migration precedent and the em-dash/code work from Phase 13, (4) the
  DISCORD_SCHEMA "defined but never wired into ensureSchema" trap (so you recognize an unwired
  schema if the card or referral path surfaces one). Report what you found in 2 to 4 lines.

STEP 1 - LOAD CONTEXT (do NOT read planning docs or large source files directly; spawn ONE Explore
agent and have it return a tight, symbol-anchored summary). Tell the Explore agent to summarize:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (where Phases 1 to 13 left the spine,
  the registry, the parity harness, and which domains are already migrated).
- docs/api-pipeline/phase-14-wallet.md (this file: the deliverables, invariants, and acceptance
  criteria below).
- server/wallet.ts: anchor on the wallet/card/referral handler SYMBOLS (the link-challenge, link,
  unlink, get-wallet, woc-balance, card-upload, and referrals functions), their current method +
  path + auth scope, the limiter call sites and their KEYS, and the two raw `{error:'rate limited'}`
  responses (historically near wallet.ts:39 and wallet.ts:62; re-anchor on the route + the literal
  'rate limited' string, NOT the line number).
- server/main.ts (~1695 lines, anchor on ROUTE STRINGS and `handleApi`, never line numbers): the
  inline dispatch for /api/wallet/*, /api/woc/balance, /api/card, /api/referrals, the card pre-auth
  Content-Length byte-cap check that returns 413 + `Connection: close` BEFORE auth and reads the
  body via the binary reader (readBinaryBody), and the two further raw 'rate limited' responses
  historically near main.ts:1266 and main.ts:1285 (woc balance and card). Re-anchor on the route +
  the literal.
- The spine modules this phase CONSUMES: server/http/router.ts, compose.ts, context.ts, schema.ts,
  errors.ts, error_codes.ts, registry.ts, index.ts, and middleware/* (specifically withErrors,
  withBody, the withRawBody/binary variant, requireAccount({scope}), and the thin rateLimit(policy)
  adapter). Return each one's PUBLIC signature only.
- The Phase 13 account.ts route module as the PRECEDENT for how a `server/<domain>.ts` exports
  `export const routes: RouteDef[]` and how its routes got registered.
- The Phase 9 dual-path parity harness and the Phase 2/3 scaffolding it depends on (the fake-http +
  fakeCtx helper, the FakeDb interface for the wallet/referral domain, the golden-master normalizer,
  and the wallet/card/referral characterization fixtures from Phase 3, including any seeded
  knownDeviation entries).
- server/CLAUDE.md and the root CLAUDE.md (the server/http seam rules + the module-first doctrine).
Explore agent must RETURN: a per-route table (method, path, auth scope, request body kind JSON vs
binary, limiter key, current response shape) for the seven routes; the exact preserved behaviors
(card pre-auth 413 + Connection:close, binary no-JSON-wrap, ip+account ordering); the four raw
'rate limited' call sites with their surrounding response; the spine signatures; the account.ts
RouteDef + registration pattern; and the names of the parity harness entry point and the relevant
fixtures. NO planning-doc prose, NO line numbers.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Hand-spawn 3 parallel Agents, each owning a COMPLETE vertical slice (behavior + its tests), each
given ONLY the Explore summary (not the raw files):
- Agent A (wallet link family): RouteDefs + thin Ctx handlers for POST /api/wallet/link/challenge,
  POST /api/wallet/link, DELETE /api/wallet/link, GET /api/wallet in server/wallet.ts. Deliverables:
  - RouteDefs with the existing method + path + auth scope (requireAccount with the same scope the
    inline handlers used); thin handlers that call the existing domain functions with no req/res.
  - Preserve the ip+account limiter ordering: the IP-keyed portion of the policy gates BEFORE
    withBody + requireAccount; the account-keyed portion gates AFTER requireAccount (account known
    only after the DB token lookup). Use the Phase 8 thin rateLimit(policy) adapter; do NOT do the
    boolean->{remaining,resetSeconds} rework (that is Phase 19).
  - tests/server/wallet.test.ts cases: parity vs the Phase 3 fixtures for all four routes, plus an
    explicit assertion that the IP tier is consulted before the body/DB and the account tier after
    auth (the resolution order, via the FakeRateLimitStore + injected clock).
- Agent B (card binary upload): RouteDef + handler for POST /api/card through the withRawBody/binary
  variant. Deliverables:
  - Route classified NON-JSON (binary image/png): no 415, no JSON withBody, response is binary /
    no-JSON-wrap on success and on error (per the Phase 7 per-route serializer selection).
  - PRESERVE the pre-auth Content-Length over-cap short-circuit: 413 + `Connection: close` BEFORE
    auth, using the EXISTING named byte-cap constant (do not introduce a new literal; full
    no-magic-values consolidation is Phase 24).
  - tests/server/wallet.test.ts cases: pre-auth 413 + Connection:close fires before the body is read
    and before requireAccount; an over-cap body never buffers past the cap; success path parity vs
    fixture; error body is binary, not problem+json.
- Agent C (woc/balance + referrals + stable codes + wiring): RouteDefs for GET /api/woc/balance and
  GET /api/referrals, the stable-code rework, and the registry wiring. Deliverables:
  - RouteDefs + thin handlers for the two GET routes with their existing auth scope and limiter.
  - Give the four previously-raw `{error:'rate limited'}` responses (wallet link challenge, wallet
    link, woc balance, card) a stable machine code emitted through the error model's 429 path so the
    body carries a `code` field instead of bare English prose. REUSE the existing rate-limit
    `domain.reason` vocabulary in server/http/error_codes.ts if one exists; otherwise APPEND a new
    frozen reason per AIP-193 (append-only, do not renumber or reuse). Do NOT touch the client
    userFacingApiError matcher or add apiError.* catalog entries here (that is Phase 22); this phase
    only emits the code server-side.
  - Register all seven wallet/card/referral routes into server/http/registry.ts (spread the
    server/wallet.ts `routes` table into the lookup) so the new router resolves them and they no
    longer fall through the catch-all to the old handleApi ladder.
  - tests/server/wallet.test.ts cases: each emitted 429 body now carries the stable code; the
    error_codes.ts append-only assertion stays green; registry-completeness confirms all seven paths
    are present in the new router.
No documented a/b split exists for this phase. If context approaches 40%, peel Agent B's
/api/card binary slice into its own stacked commit/PR (it is the most self-contained) and finish
the wallet/woc/referral routes first.

INVARIANTS THIS PHASE MUST KEEP
- Single dispatch model + catch-all delegate: registering the wallet routes makes the NEW router
  resolve them; un-migrated paths still delegate per-path to the old handleApi ladder unchanged. Do
  NOT delete the old inline wallet branches (the old ladder is removed in a later release once the
  metric gate is clean, per Phase 25). The new path is the default.
- Server-authority: economy/wallet writes resolve server-side exactly as before. No gameplay change.
  The client never decides balance, link, or card outcomes.
- Stable-code i18n: every player-visible server response carries a stable CODE re-localized at the
  client boundary, never English prose as the source of truth. The four raw 'rate limited' bodies
  become coded. (The client matcher + apiError.* parity is Phase 22; here you only emit the code.)
- Determinism / sim-purity: this work is SERVER-ONLY and must NOT touch src/sim/. No Math.random /
  Date.now in any new limiter test path; use the Phase 2 injected now() clock.
- No new DDL expected. Persistence for wallet/referrals already exists. If migrating a route reveals
  a defined-but-unwired schema (the DISCORD_SCHEMA trap), STOP and surface it; do not silently wire.
  Any DDL you do touch must be additive idempotent under the boot advisory lock, with JSONB
  back-compat.
- No magic values: reuse the existing byte-cap, limiter-window, and policy constants; do not retype
  literals (consolidation is Phase 24).
- No em dashes, no en dashes, no emojis anywhere (code, comments, tests, commits, docs).
- No WS wire / snapshot change. If a change would touch the WS protocol, STOP.

OUT OF SCOPE (do not do these here; they are owned by other phases)
- The two-tier limiter rework (boolean -> {remaining,resetSeconds}) and server/ratelimit_db.ts +
  RATELIMIT_SCHEMA wiring: Phase 19. Use the Phase 8 thin adapter over today's limiter booleans.
- The userFacingApiError client matcher extension, the apiError.* English catalog entries, and the
  per-surface code-parity guard: Phase 22. Emit codes only.
- The top-level security-headers wrapper (the card Connection:close + byte cap stay as the existing
  pre-auth short-circuit, NOT re-implemented as headers): Phase 21.
- Reports + telemetry (server/reports.ts): Phase 15. Discord family: Phase 16. Admin: Phase 17.
- Validated config + server timeouts + no-magic-values consolidation: Phase 24.
- World Market realm-scope fix: Phase 20. No market touch here.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run the validation matrix for a server-domain migration (code + tests, no new DDL, new codes):
- `npx tsc --noEmit`
- `npx vitest run tests/server/wallet.test.ts` (and re-run any existing wallet/economy suite the
  Explore agent named)
- `npx vitest run` the Phase 9 dual-path parity harness over the wallet/card/referral fixtures;
  every fixture must diff clean (status, body, contracted headers) or carry a documented
  knownDeviation. Block on any undocumented diff.
- The error_codes.ts append-only assertion test (from Phase 7) must stay green.
- `npm run ci:changed` (Biome on changed files only; scoped `npx @biomejs/biome check --write
  <changed-file.ts>` if it flags format, never a whole-tree --write).
- `npm run build:server`.
Then dispatch the review agents whose SURFACE this diff touches (check `git diff --name-only`
first), each prompted for COVERAGE (report every correctness or requirement gap with confidence and
severity), NOT filtering:
- privacy-security-review: REQUIRED (server/ touched: auth scope, ip+account rate limiting, the
  binary card upload + pre-auth byte cap, economy writes).
- migration-safety: ONLY if the diff touches wallet/referral persistence DDL or a *_db schema (it
  should NOT). Skip otherwise.
- cross-platform-sync and architecture-reviewer: SKIP (no src/sim, no wire, no client matcher change
  in this phase).
- qa-checklist: at phase completion.
Give every review agent this truncation-resume line: "If your output is truncated, resume from the
last completed item and continue until you have reviewed every file in the diff; do not restart."
Do NOT commit until each dispatched agent reports no BLOCKING findings.

STEP 4 - COMMIT CADENCE (Conventional Commits with a scope, EXPLICIT paths only). Delivery is a
STACKED PR CHAIN: this phase ships as its own green, bisectable PR. Suggested headlines:
- `feat(wallet): port wallet link + balance routes onto RouteDefs (server/wallet.ts)`
- `feat(http): register wallet routes + emit stable rate-limit codes (server/http/registry.ts,
  server/http/error_codes.ts)`
- `feat(wallet): serve /api/card via withRawBody preserving pre-auth 413 (server/wallet.ts)`
- `test(server): wallet/card parity, ip+account ordering, pre-auth 413 (tests/server/wallet.test.ts)`

STEP 5 - ACCEPTANCE CRITERIA (verifiable; every box must be checked before handoff)
- [ ] All seven routes resolve through the NEW router (registry-completeness green): POST
      /api/wallet/link/challenge, POST /api/wallet/link, DELETE /api/wallet/link, GET /api/wallet,
      GET /api/woc/balance, POST /api/card, GET /api/referrals. None fall through to old handleApi.
- [ ] Parity harness diffs every wallet/card/referral fixture old vs new clean (status, body,
      contracted headers), or with a documented knownDeviation.
- [ ] /api/card is served via the withRawBody binary variant: pre-auth Content-Length over-cap
      returns 413 + `Connection: close` BEFORE auth and before the body is read, the byte cap is the
      existing named constant, and both success and error responses are binary / no-JSON-wrap.
- [ ] ip+account ordering preserved: the IP-keyed tier is consulted before withBody + requireAccount;
      the account-keyed tier after requireAccount (account resolved by the DB token lookup).
- [ ] The four previously-raw `{error:'rate limited'}` responses (wallet link challenge, wallet
      link, woc balance, card) now emit a stable machine code in the 429 body; codes are registered
      append-only in error_codes.ts; no English-prose-only client path remains for them.
- [ ] Any typed params/query decode safely (no NaN reaches a DB call).
- [ ] `npx tsc --noEmit` clean, tests/server/wallet.test.ts green, append-only assertion green,
      `npm run ci:changed` clean, `npm run build:server` green.
- [ ] No WS wire change, no src/sim touch, no new DDL, no client matcher change.

STEP 6 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md: mark Phase 14 complete; list the new RouteDefs exported from
  server/wallet.ts (the seven routes), the new/reused rate-limit codes added to error_codes.ts, and
  note that /api/card is the binary withRawBody precedent for later phases.
- Update docs/api-pipeline/state.md: the wallet/card/referral domain now sits on the new seam; record
  the exact stable code names emitted, the ip+account ordering decision, and that the card pre-auth
  413 + Connection:close short-circuit was preserved (not replaced by a header).
- Record in memory: the ip+account two-position ordering pattern (IP before body, account after
  auth) and the card binary withRawBody + pre-auth 413 precedent, since later phases reuse both.

STEP 7 - FINAL RESPONSE FORMAT (return, do not write a report file): phase status (DONE / BLOCKED),
files touched (absolute paths), validation results (tsc / wallet.test.ts / parity harness /
ci:changed / build:server), review verdicts (privacy-security-review and qa-checklist, plus
migration-safety only if it ran), any deferrals, and a one-line handoff to "Phase 14 QA".

STOPPING RULES (stop and surface, do not push through)
- Stop if any migrated wallet/card/referral route's parity fixture diffs without a documented
  knownDeviation.
- Stop if the card pre-auth 413 + Connection:close short-circuit cannot be preserved under the new
  router, or if withRawBody would buffer a body past the byte cap.
- Stop if emitting a stable code would require touching the client userFacingApiError matcher or
  apiError.* catalog (that is Phase 22): emit the server code only and confirm scope.
- Stop if migrating a route surfaces a defined-but-unwired schema (the DISCORD_SCHEMA precedent):
  surface it, do not silently wire.
- Stop if any change would alter the WS wire protocol or snapshots.
- Stop if determinism or sim-purity would be violated (any reach into src/sim, or any Math.random /
  Date.now in a limiter test instead of the injected now() clock).
````
