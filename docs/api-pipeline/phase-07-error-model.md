# Phase 7: RFC 9457 error model + per-surface serializers + error_codes catalog

Phase 7 builds the error PRIMITIVES the whole pipeline serializes through: two pure spine
files (`server/http/errors.ts` and `server/http/error_codes.ts`) plus three focused test
files. It defines `HttpError`, the `mapError` status-and-surface table, the seven per-surface
serializers (problem+json, RFC 6749, admin `{success,data,error}`, HTML error page, redirect,
binary, legacy `{ok:false}` 405), and the append-only `as const` code catalog. It wires NO
routes, adds NO endpoints, and touches NO client code, so the surface is small and bounded:
two new modules driven entirely behind the Phase 2 `fakeCtx`. That is why this phase stays
well under 40% context. The middleware that makes `mapError` the outermost handler is Phase 8;
the client matcher that localizes these codes is Phase 22.

### Starter Prompt

````
This is Phase 7 of the API Pipeline re-architecture: RFC 9457 error model + per-surface
serializers + error_codes catalog.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: NOT needed here. This phase is two small files plus three test files, not a batch
content/test sweep, so hand-spawn the parallel agents below; do not orchestrate a Workflow.
Goal: land HttpError + a single mapError that maps thrown values to the right STATUS and the
right per-route ENVELOPE, backed by an append-only as-const error_codes catalog, with zero
endpoints and zero client changes.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with concurrent sessions; if it is dirty with files
  you do not own, STOP and ask before staging anything. You will only ever stage explicit paths
  (never `git add -A`).
- Confirm you are stacked on the Phase 6 branch (this is a STACKED PR CHAIN; Phase 7 is its own
  green, bisectable PR on top of Phase 6).
- Scan Claude Code memory for entries in this phase's domain. Suggested concrete topics:
  (1) "Server API pipeline audit" (the locked SPEC, userFacingApiError = the REST matcher),
  (2) the existing server error shapes (admin {success,data,error}, oauth RFC 6749, htmlError),
  (3) the DISCORD_SCHEMA unwired trap as the precedent for "defined but not the source of truth"
      (here the analogue is: error_codes.ts must be the ONLY source of codes),
  (4) i18n stable-code rule (server emits a CODE, never English prose, client localizes).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly; spawn ONE Explore agent)
Tell the Explore agent to summarize, anchored on SYMBOL NAMES and route strings (never line
numbers; main.ts is ~1695 lines and all SPEC line anchors are stale):
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (current packet state, what
  Phases 1 to 6 landed and the exact module/symbol names they expose).
- docs/api-pipeline/phase-07-error-model.md (this file) and docs/api-pipeline/phase-03-surface-inventory.md
  (Phase 3's content-type classification + the seeded knownDeviation list: perf_report 405,
  anti-enumeration 404 on register/login). The per-route serializer choice DERIVES from Phase 3's
  classification, so the Explore agent must return that classification table.
- The prior spine modules this phase consumes:
  - server/http/schema.ts (Phase 6): the EXACT ValidationError / issue shape it throws or returns
    (pointer/code/params), because mapError must convert it to a 422 carrying ALL issues in one pass.
  - server/http/context.ts (Phase 5): the Ctx type, and the RouteDef metadata field that names a
    route's error surface / envelope (frozen in Phase 2). mapError reads that tag; report its exact name.
  - server/http/compose.ts (Phase 5): the outermost-wrapper contract (mapError is what Phase 8's
    withErrors will call; confirm the agreed signature so this phase's mapError fits it).
  - server/http/router.ts (Phase 4): how 405 + Allow are produced, so the legacy {ok:false} 405
    serializer does not fight the router's own 405 path.
- The Phase 2 test harness under tests/server/: the fake-http helper, fakeCtx(overrides), and any
  injectable log/onUnexpected sink seam. Report the exact helper names so the new tests use them.
- server/CLAUDE.md and root CLAUDE.md (server conventions, the i18n stable-code rule, no em dashes).
- The EXISTING server error shapes to reuse verbatim (read-only; do not edit them this phase):
  server/http_util.ts (the current JSON error helper), server/oauth.ts (the RFC 6749
  {error, error_description} JSON path AND the htmlError consent/device GET pages),
  server/admin.ts (the {success, data, error} envelope helper), server/perf_report.ts (the
  {ok:false} 405 returner), server/discord.ts (the callback bouncePage / redirect-to-error), and
  the htmlError helper used by email/unsubscribe.
- READ-ONLY for vocabulary only: src/main.ts userFacingApiError (the live REST matcher). Extract
  the EXISTING domain.reason code vocabulary and its parametric families (suspended-until {date},
  the {seconds} rate-limit families) so error_codes.ts REUSES those names, never invents parallel
  ones. DO NOT EDIT src/main.ts here (that is Phase 22).
What the Explore agent returns: (a) the Ctx shape + the route error-surface tag name and its
default; (b) the schema.ts issue shape; (c) the seven existing response shapes verbatim with their
exact field names and Content-Types; (d) the existing domain.reason vocabulary + parametric param
keys to reuse; (e) the Phase 2 fakeCtx + fake-http + sink seam names; (f) the Phase 3 content-type
classification table + the relevant knownDeviations. No code dumps: signatures, field names, tags.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Hand-spawn THREE parallel agents, each owning a complete vertical slice (behavior + its tests),
each given ONLY the Explore summary. Have all three code against this AGREED minimal contract so
they integrate mechanically (the catalog agent reconciles the real names from the Explore vocabulary):

  // server/http/error_codes.ts (agreed shape; codes are domain.reason, params is the placeholder set)
  export const ERROR_CODES = {
    'validation.failed':   { params: ['issues'] },
    'json.malformed':      { params: [] },
    'auth.token_missing':  { params: [] },
    'auth.token_invalid':  { params: [] },
    'auth.forbidden':      { params: [] },
    'body.too_large':      { params: ['maxBytes'] },
    'db.conflict':         { params: [] },
    'rate_limit.exceeded': { params: ['retryAfterSeconds'] },
    'internal.error':      { params: [] },
    // PLUS the existing domain.reason codes harvested from userFacingApiError (reuse, do not rename)
  } as const;
  export type ErrorCode = keyof typeof ERROR_CODES;

  // server/http/errors.ts
  export class HttpError extends Error {
    constructor(
      readonly status: number,
      readonly code: ErrorCode,
      readonly params?: Record<string, string | number>,
      readonly headers?: Record<string, string>, // e.g. WWW-Authenticate, Retry-After
    ) { super(code); }
  }
  type ErrorSurface = 'problem' | 'oauth' | 'admin' | 'html' | 'redirect' | 'binary' | 'ok_false';
  // mapError(err, ctx, opts?) -> { status, headers, contentType, body } ; reads ctx's route
  // error-surface tag (default 'problem'); opts.onUnexpected(err) receives the original on a 500.

- Agent A (catalog): OWNS server/http/error_codes.ts + tests/server/http/error_codes.test.ts.
  Deliverables:
  - The `as const` ERROR_CODES object reconciled to REUSE the existing domain.reason vocabulary
    from userFacingApiError (suspended-until, the rate-limit families, invalid token, etc.) plus the
    structural codes the mapError table emits. Every code declares its param keys.
  - `ErrorCode` type, a deep `Object.freeze`, and an AIP-193 append-only invariant.
  - Test: a frozen snapshot of the full code set that FAILS if any code is removed or renamed
    (append-only), asserts no duplicate code, asserts every code's params is a string[] of the
    placeholder names, and asserts the object is frozen at runtime.

- Agent B (mapError + serializers): OWNS server/http/errors.ts + tests/server/http/errors.test.ts.
  Deliverables:
  - `HttpError` per the contract, plus a `toAppError(err)` normalizer: the EXHAUSTIVE status table:
    malformed JSON -> 400 (json.malformed); a schema ValidationError -> 422 (validation.failed) with
    ALL field issues collected (not first-fail); missing/invalid bearer -> 401 (auth.token_*) WITH a
    `WWW-Authenticate` header; no-entitlement -> 403 (auth.forbidden); over byte cap -> 413
    (body.too_large, "Content Too Large"); pg unique violation (error.code === '23505') -> 409
    (db.conflict); a rate-limit signal -> 429 (rate_limit.exceeded) WITH `Retry-After`; ANY unknown
    throwable -> 500 (internal.error), passing the ORIGINAL to opts.onUnexpected and putting NOTHING
    internal in the body.
  - The seven per-surface serializers selected per the route's error-surface tag, NOT per-prefix:
    'problem' = application/problem+json with { type, title, status, detail, instance, code, ...params }
    (clients localize by `code`, never by parsing `detail`); 'oauth' = RFC 6749 { error, error_description }
    (map the internal code to the nearest RFC error token); 'admin' = the existing { success:false,
    data:null, error } envelope carrying the stable code; 'html' = the existing htmlError page;
    'redirect' = 302 with a Location to an error URL (the Discord-callback case, NOT problem+json);
    'binary' = a non-JSON minimal error (no application/json wrap), preserving the card pre-auth 413
    short-circuit shape; 'ok_false' = { ok: false } with 405 (the perf_report legacy case).
  - `mapError(err, ctx, opts?)` = serialize(toAppError(err), tagFrom(ctx)). Default surface 'problem'.
  - Test: the exhaustive status-mapping table AND a per-surface CONTRACT test freezing each of the
    seven shapes' exact fields + Content-Type + status (including the {ok:false}/HTML/redirect/binary
    cases), asserting WWW-Authenticate on 401 and Retry-After on 429.

- Agent C (500-no-leak security hardening): OWNS tests/server/http/error_leak.test.ts ONLY (no impl
  file, so no conflict with B). Codes against Agent B's mapError signature.
  Deliverables:
  - Feed adversarial throwables through mapError on EVERY surface: a pg-style error whose .message
    contains SQL + a .table + .detail + .column, a generic Error with a populated .stack, a thrown
    string, and a thrown plain object carrying .stack/.table. Assert: status 500, the generic
    `internal.error` code, and that the serialized body AND headers contain NONE of the stack, SQL
    text, table, column, or detail substrings on any surface.
  - Assert the ORIGINAL error reaches opts.onUnexpected (we log internally, leak externally nothing).
If context approaches 40% while a single agent runs hot, this phase has NO documented a/b split
(it is medium risk, two files): instead reduce to Agents A and B and fold the leak assertions into
errors.test.ts rather than splitting a file across two writers.

INVARIANTS THIS PHASE MUST KEEP
- Stable-code i18n: every player-visible error identity is a stable CODE from error_codes.ts plus
  params. The server NEVER puts a localizable English sentence as the source of truth in the body.
  problem+json `detail`/`title` may be English developer text, but the client localizes by `code`,
  never by parsing `detail`. error_codes.ts is the SINGLE source of truth for codes.
- No internal leakage: the 500 body carries a generic code and NO stack, SQL, table, column, or
  driver `detail` text. The leak test is a hard gate.
- Append-only catalog (AIP-193): codes are frozen `(domain, reason)`; never renumber, rename, or
  remove an existing code.
- Per-surface, NOT per-prefix: the serializer is chosen by the route's error-surface tag, resolving
  the non-JSON /api classification (card=binary, email/unsubscribe=html, discord callback=redirect).
- Single-flag dispatch + catch-all delegate model: this phase WIRES NOTHING into dispatch; it only
  produces a mapError that Phase 8's outermost withErrors (and thereby both the old and new paths)
  can call. Do not touch the dispatcher.
- Server-authority + server-only: no src/sim, no client, no WS wire. Determinism and sim-purity are
  not in play (no src/sim import; no Math.random/Date.now in any code that could feed the sim, of
  which there is none here), and must not be violated.
- No magic values: status codes and the surface union are named; the codes are the as-const catalog.
- Persistence invariants are NOT in play (this phase adds no DDL and no JSONB shape).
- No em dashes, en dashes, or emojis anywhere (code, comments, tests, commits, docs).

OUT OF SCOPE (explicit exclusions; do not let these creep in)
- The withErrors middleware, the requestId/ALS hook, the top-level single-idempotent-response
  wrapper, and the clientError socket-destroy handler: ALL Phase 8. This phase only produces mapError.
- Any RouteDef wiring, the registry, the dispatcher-in-front, the parity harness: Phase 9.
- Any endpoint migration and any NEW domain codes for un-migrated endpoints: Phases 10 to 18 each
  append their own codes. Seed ONLY the structural codes plus the existing harvested vocabulary.
- The client-side userFacingApiError extension, the apiError.* client catalog, and the per-surface
  code-parity Vitest: Phase 22. Do NOT edit src/main.ts or any src/ui i18n here.
- The em-dash rate-limit string fix: Phase 13.
- The real Retry-After VALUE sourcing ({remaining,resetSeconds} from the limiter): Phase 19. Here,
  mapError only SETS Retry-After when the HttpError already carries one; it does not compute it.
- The structured logger and /metrics exporter: Phase 23. Here, use the injectable opts.onUnexpected
  sink (default a single console.error) as the placeholder; do not build a logger.
- Security headers: Phase 21.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Validation commands for this primitive phase (run after integration):
- `npx tsc --noEmit`
- `npx vitest run tests/server/http/error_codes.test.ts tests/server/http/errors.test.ts tests/server/http/error_leak.test.ts`
- `npx vitest run tests/server/http` (confirm no regression against the Phase 4 to 6 spine tests)
- `npx vitest run tests/localization_fixes.test.ts` (S3 no-regression: this phase does not touch the
  WS server_i18n matcher; the REST code-parity guard itself lands in Phase 22)
- `npm run build:server` (the server still bundles with the new modules)
- Biome on changed files only: `npx @biomejs/biome check --write server/http/errors.ts
  server/http/error_codes.ts tests/server/http/error_codes.test.ts tests/server/http/errors.test.ts
  tests/server/http/error_leak.test.ts` then `npm run ci:changed`. NEVER a whole-tree --write.
- PR pre-merge gate (mirror CI): `npm test && npx tsc --noEmit && npm run build:env &&
  npm run build:server && npm run build`.
Multi-agent review: `git diff --name-only` shows only server/http/*.ts and tests/server/http/*.ts
plus the doc files. Dispatch ONLY the matching surfaces:
- privacy-security-review (server/ touched; its surface here is the 500-no-leak contract and error
  body hygiene, the 401/403/429 status semantics, and that codes carry no PII).
- qa-checklist (the end-of-phase gate).
Do NOT dispatch migration-safety (no DDL/JSONB), cross-platform-sync (no sim/wire/client matcher;
that is Phase 22), or architecture-reviewer (no src/sim). Prompt each reviewer for COVERAGE (report
every correctness or requirement gap with confidence and severity), not filtering. Add to each: "If
your output is truncated, resume from the last file you completed and continue; do not restart."
Do not commit until each reviewer reports no BLOCKING.

STEP 4 - COMMIT CADENCE (Conventional Commits, scope, EXPLICIT paths; stacked PR on Phase 6)
- `feat(http): add append-only error_codes catalog`
  paths: server/http/error_codes.ts tests/server/http/error_codes.test.ts
- `feat(http): add HttpError, mapError status table, and per-surface serializers`
  paths: server/http/errors.ts tests/server/http/errors.test.ts
- `test(http): assert the 500 path leaks no stack, SQL, or table text`
  paths: tests/server/http/error_leak.test.ts
- `docs(api-pipeline): record Phase 7 error-model state`
  paths: docs/api-pipeline/progress.md docs/api-pipeline/state.md
Open this phase as its own green PR in the stacked chain.

STEP 5 - ACCEPTANCE CRITERIA (verifiable)
- [ ] error_codes.ts exports an `as const` ERROR_CODES, deep-frozen; every key is `domain.reason`;
      every value declares its param keys; the snapshot test FAILS on any removed or renamed code.
- [ ] The structural codes (validation.failed, json.malformed, auth.token_missing, auth.token_invalid,
      auth.forbidden, body.too_large, db.conflict, rate_limit.exceeded, internal.error) exist AND the
      existing userFacingApiError domain.reason vocabulary was REUSED, not re-invented.
- [ ] toAppError maps every case: bad JSON 400, schema ValidationError 422 with all issues,
      missing/invalid token 401 + WWW-Authenticate, no-entitlement 403, over-cap 413, pg 23505 409,
      rate-limited 429 + Retry-After, anything else 500.
- [ ] mapError selects the serializer by the route's error-surface tag (default problem+json), NOT by
      prefix; all seven shapes (problem+json, RFC 6749, admin {success,data,error}, htmlError, 302
      redirect, binary no-wrap, {ok:false} 405) are frozen by the contract test with exact fields +
      Content-Type + status.
- [ ] The problem+json body has type/title/status/detail/instance + a stable machine `code` (+ params);
      the leak test proves the 500 body and headers carry no stack/SQL/table/column/detail text and the
      original reaches opts.onUnexpected.
- [ ] `npx tsc --noEmit` clean; the three new test files green; `npm run build:server` succeeds; Biome
      clean on changed files; Stop hook clean (no em dashes/emojis).
- [ ] No route wiring, no endpoints, no src/ changes, no client i18n edit, no DDL.

STEP 6 - DOC UPDATES + MEMORY
- progress.md: mark Phase 7 done. Name the new modules (server/http/errors.ts,
  server/http/error_codes.ts), the mapError status table, the seven error-surface serializers, the
  seeded code vocabulary, and the opts.onUnexpected sink seam.
- state.md: record the ErrorCode type, the route error-surface tag name + default, the per-surface
  serializer map, the append-only AIP-193 catalog rule, and the 500-no-leak contract. Note the
  explicit deferrals (withErrors -> Phase 8, client matcher + parity -> Phase 22, Retry-After value
  -> Phase 19).
- Memory: record the surprising rules: serializer is per-surface NOT per-prefix; problem+json `code`
  is the localization key, `detail` is not; {ok:false} 405 + HTML + redirect + binary are first-class
  contract cases; AIP-193 append-only; the leak fuzz test is a security gate; the REST code-parity
  CLIENT guard is deferred to Phase 22.

STEP 7 - FINAL RESPONSE FORMAT
Return: phase status (DONE or BLOCKED + why); files touched (repo-relative paths); validation results
(tsc, the three test files, tests/server/http, S3, build:server, Biome); review verdicts
(privacy-security-review, qa-checklist: no BLOCKING); deferrals (Phase 8 withErrors, Phase 22 client
matcher, Phase 19 Retry-After value); one-line handoff to "Phase 7 QA".

STOPPING RULES
- STOP if landing the error model would require wiring a route, the registry, or the dispatcher: the
  primitive MUST stand alone behind fakeCtx. If it cannot, the seam is wrong; surface it.
- STOP if any change would touch src/main.ts, src/ui i18n, or the WS server_i18n matcher (Phase 22),
  or would alter the WS wire protocol.
- STOP if a 500 body cannot be proven leak-free (the leak test must be green before any commit).
- STOP if append-only would force RENAMING or REMOVING an existing code: append-only is hard; surface
  the conflict rather than mutating a code.
- STOP if reproducing an existing per-surface SHAPE would diverge from the Phase 3 golden fixture
  without a documented knownDeviation. The 422/400/413/429 STATUS changes are the documented
  deviations; the envelope FIELD shapes (problem-ish, oauth, admin, ok_false, html) stay as today.
- STOP if determinism or sim-purity would be violated (do not import src/sim; this is server-only).
````
