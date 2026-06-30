# Phase 6: Typed schema validator (schema.ts)

This is Phase 6 of the API Pipeline re-architecture. It adds one self-contained spine
primitive: a tiny in-house schema decoder under `server/http/schema.ts` that validates and
types request body, params, and query, collecting every field issue in one pass. It is sized
to stay well under 40% context because it is a single pure module (a ~150-line cap, zero new
dependencies) plus one test file, with no route wiring, no DB, no middleware, and no
cross-file migration. The validator is the input boundary the later error model (Phase 7),
core middleware (Phase 8), and every domain migration (Phases 10 and up) build on, so it must
land correct, typed, and codes-only before any route consumes it.

Paste the block below into a fresh Claude Code session. It is self-contained and does not
require reading this table of contents.

### Starter Prompt

````md
This is Phase 6 of the API Pipeline re-architecture: Typed schema validator (schema.ts).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: do NOT add `ultracode`. This phase is one small pure module plus one test file,
not a batch-heavy content or test sweep, so hand-spawn parallel agents instead of orchestrating
a Workflow.
Goal: ship `server/http/schema.ts`, an in-house body/params/query decoder (object/str/num/bool/
enum combinators) that conforms type-only to Standard Schema v1, derives handler input types via
`Infer<typeof S>`, and collects ALL field issues in one pass as stable CODES (never English),
with no route wiring.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with concurrent sessions: if it is dirty with files
  you do not own, STOP and ask before touching anything. You will commit only your own files,
  with EXPLICIT paths, never `git add -A`.
- Confirm you are stacked on the Phase 5 branch (compose.ts + context.ts landed). This phase is
  its own green PR on top of it.
- Scan Claude Code memory for entries in this phase's domain. Suggest 2 to 4 concrete topics to
  look up, for example: "Standard Schema v1 type-only conformance", "in-house validator
  one-pass issues", "server/http spine primitives (router, compose, context)", "stable-code
  i18n (server emits codes, not English)".

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or large server files directly; spawn ONE
Explore agent and have it summarize). Tell the Explore agent to read and summarize:
- docs/api-pipeline/state.md (current spine status, what modules already exist under server/http/)
- docs/api-pipeline/progress.md (what Phases 1 to 5 delivered)
- docs/api-pipeline/phase-06-schema-validator.md (this phase file)
- server/http/context.ts (anchor on the `Ctx` type and `buildContext`): how are `params`, `query`,
  and `body` represented and typed? Params come from the router `:param` capture as STRINGS;
  query arrives as strings (URLSearchParams or a parsed record). The validator must know this so
  `num()` coerces string to number for params and query.
- server/http/router.ts (anchor on the route-match / `:param` capture symbol): confirm params are
  literal-string captures (the no-regex-routing convention), so a `:id` reaches the validator as a
  string that must decode to a bounded number, never NaN.
- server/http/compose.ts (anchor on the `Mw` middleware signature and `compose`): for context only.
  schema.ts is CONSUMED by a future `withBody`/validate middleware (Phase 8), it does not import
  compose; confirm there is no coupling to add now.
- server/http/index.ts (the barrel): the existing export list, so schema.ts is added to it correctly.
- The Phase 2 test harness under tests/server/ and tests/server/http/: the test-file convention
  (tests/server/http/<primitive>.test.ts), and whether a type-level test helper exists
  (vitest `expectTypeOf`, or a `*.test-d.ts` pattern). Also report whether any Standard Schema v1
  type is already vendored anywhere in the repo (it should not be).
- server/CLAUDE.md and root CLAUDE.md: the module-first rule (new spine code is its own small
  module under server/http/, never grown into main.ts), the server-stays-language-agnostic rule
  (emit a stable CODE re-localized at the client boundary, NEVER English in the server), and the
  no-em-dash/no-emoji copy rule.
- docs/api-pipeline/source-spec.md (the source SPEC): the validator section (anchor on the
  "Standard Schema", "~150-line", "Infer", "all issues in one pass", "typed params and query"
  text, NOT line numbers; main.ts is ~1695 lines and every line anchor in the SPEC is stale).

The Explore agent must RETURN, in one tight summary (no source dumps):
1. The exact `Ctx` shape for params/query/body (types, string vs typed), so coercion is correct.
2. The current server/http/index.ts barrel export list (so the new export slots in).
3. The tests/server/http/ test convention and the available type-level test mechanism
   (expectTypeOf vs test-d), plus confirmation no Standard Schema type is already vendored.
4. The two invariants in play verbatim enough to obey: module-first spine layout, and
   server-emits-codes-not-English.
5. The SPEC's validator requirements distilled: Standard Schema v1 `~standard` type-only
   conformance, `Infer<typeof S>`-derived handler types, all-issues-in-one-pass collection,
   typed params AND query, the ~150-line cap, no zod/valibot.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
This phase has NO documented a/b split and is sized to one session; do not split. Hand-spawn TWO
parallel agents along a clean, non-overlapping file-ownership seam (so they never edit the same
file), giving each ONLY the Explore summary plus the frozen contract below. If context is
trivially low, you MAY collapse to a single agent, but the file ownership stays the same.

FROZEN CONTRACT (both agents code against this so there is no rework):
```ts
// server/http/schema.ts (~150-line cap, zero new deps, no src/sim|render|ui|net imports)
export interface Issue {
  pointer: string;                                   // JSON-pointer-ish, e.g. "/page" or "/name"
  code: string;                                      // stable CODE: 'type'|'required'|'min'|'max'
                                                     // |'int'|'minLength'|'maxLength'|'enum'
  params?: Record<string, string | number>;         // e.g. { min: 1 } for code 'min'
}
export type DecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: Issue[] };                  // ALL field issues, one pass, never first-fail
export interface Schema<T> {
  decode(input: unknown, pointer?: string): DecodeResult<T>;
  readonly '~standard': StandardSchemaV1.Props<unknown, T>;  // type-only conformance seam
}
export type Infer<S> = S extends Schema<infer T> ? T : never;
// Combinators (enum is a reserved word, name it enum_):
//   object(shape), str(opts?), num(opts?), bool(opts?), enum_(values), optional(schema, default?)
//   str opts: { minLength?, maxLength? }   num opts: { int?, min?, max? }
```
- Agent A owns server/http/schema.ts (the implementation) and its RUNTIME unit tests in
  tests/server/http/schema.test.ts. Deliverables:
  - The `object()` combinator: reads ONLY declared keys from input (never copies arbitrary input
    keys, so a malicious `__proto__`/`constructor`/`prototype` key is never read and cannot pollute
    Object.prototype); builds the output from declared keys; collects issues from EVERY field in one
    pass; nests child pointers ("/parent/child").
  - The scalar combinators `str()`, `num()`, `bool()`, `enum_()` and the `optional(schema, default?)`
    wrapper. `num()` COERCES a string to a number (params and query arrive as strings), rejects NaN
    with `{ code: 'type' }`, and enforces `int`/`min`/`max` with `{ code: 'int'|'min'|'max', params }`.
    `str()` enforces `minLength`/`maxLength`. `enum_()` rejects non-members with `{ code: 'enum' }`.
    A missing required field yields `{ code: 'required' }`.
  - Runtime tests: valid coerce/pass; the one-pass collection (an object with 3 bad fields yields 3
    issues, not 1); min/max/int/type/required/minLength/maxLength/enum each produce the right code
    and params; a `:id`-style decode of "abc" yields an issue and "7" yields the number 7;
    page/pageSize-style bounds (num({ int: true, min, max }) with optional default) clamp/reject at
    the boundaries; the prototype-pollution test (object() given input carrying `__proto__` does not
    mutate Object.prototype).
- Agent B owns the type seam, the barrel, and the type-level tests, and does NOT edit schema.ts's
  implementation (it reads the frozen exported signatures). Deliverables:
  - server/http/standard_schema.ts: a vendored TYPE-ONLY copy (~30 lines, no runtime, NO dependency)
    of the Standard Schema v1 interface (`'~standard'` with `version: 1`, `vendor`, `validate`,
    `types`), so `Schema<T>['~standard']` conforms type-only and a future zero-churn swap to Valibot
    stays open. Do NOT add `@standard-schema/spec` or any package.
  - Add schema.ts (and standard_schema.ts types) to the server/http/index.ts barrel export list.
  - Type-level tests (expectTypeOf or a *.test-d.ts): `Infer<typeof S>` is structurally identical to
    the hand-written expected type for a representative object schema; each combinator's `~standard`
    property is assignable to `StandardSchemaV1.Props`.
  Coordinate the merge so Agent A's file lands first (or both agree on the frozen signatures up
  front); they must not both write server/http/schema.ts.

INVARIANTS THIS PHASE MUST KEEP
- Module-first spine: this is a new self-contained module under server/http/, never a method bank
  added to main.ts.
- Server stays language-agnostic (stable-code i18n): every Issue carries a stable `code` (+ params),
  NEVER an English player-facing message. The `~standard.validate` `message` field is a type-only
  seam (our runtime path is `decode()` returning codes); if a `validate` adapter is provided at
  runtime it is thin and off the hot path, and still emits codes, not English. There is NO client
  matcher or catalog change in this phase (that is Phase 22).
- Server-authority: validation is server-side input gating; bounds and types are enforced
  server-side and never trusted from the client. A `:id` can never reach a DB call as NaN; page and
  pageSize are bounded by the schema, not the handler.
- Host-agnostic purity: schema.ts imports nothing from src/sim, render, ui, net, no DOM, no Three;
  it must run identically in Node. No `Math.random`, `Date.now`, or `performance.now` in the
  validator (it is pure of clocks and randomness).
- No magic values: the combinators are GENERIC (min/max/length/int are caller-supplied); schema.ts
  hardcodes no domain limits. The concrete page/pageSize numeric bounds are set by callers in later
  phases, not here.
- No new runtime dependency (no zod, valibot, ajv, or @standard-schema/spec): vendor the type.
- No em dashes, en dashes, or emojis anywhere (code, comments, tests, commit text).

OUT OF SCOPE (do not touch; these are later phases)
- Error serialization, `mapError`, problem+json, the 422/400/413 status mapping: Phase 7.
- error_codes.ts as the as-const catalog and mapping a validator code to an HTTP status or a client
  i18n key: Phases 7 and 22.
- `withBody`/`withRawBody`/the validate middleware that calls `decode()` on `ctx.body`: Phase 8.
- RouteDef.schema wiring and the registry: Phases 8 and 9.
- The concrete pagination response envelope `{items,page,pageCount,total,pageSize}` (convention B)
  and the actual page/pageSize numeric bounds: Phase 10.
- Any async validation (Standard Schema permits a Promise; our runtime stays synchronous, the type
  may allow it but do not implement an async path).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run the validation matrix for a spine/primitive change:
- `npx tsc --noEmit`
- `npx vitest run tests/server/http/schema.test.ts` (plus the type-level test file if separate)
- `npm run ci:changed` (Biome on changed files only; never a whole-tree --write)
- `npm run build:server`
Then dispatch review agents, ONLY those whose surface this diff touches (run `git diff --name-only`
first; this diff is server/http/schema.ts, server/http/standard_schema.ts, server/http/index.ts,
and tests/server/http/schema*.ts):
- privacy-security-review: the in-house object decoder is an input-validation and
  prototype-pollution surface. Prompt it for COVERAGE: confirm object() never reads non-declared
  input keys, a `__proto__`/`constructor` key cannot pollute Object.prototype, num() cannot let NaN
  through, bounds cannot be bypassed, and no internal detail leaks in an Issue.
- qa-checklist: the end-of-contribution gate.
Do NOT dispatch migration-safety (no DDL/JSONB here), cross-platform-sync (no sim/wire/i18n-matcher
change), or architecture-reviewer (no src/sim change).
Prompt each agent for COVERAGE, not filtering (report every correctness or requirement gap with
confidence and severity). Add the truncation-resume line: "If your review is truncated, resume from
the last file and finding you completed; do not restart." Do not commit until each reports no
BLOCKING finding.

STEP 4 - COMMIT CADENCE (Conventional Commits with a scope, EXPLICIT paths; this phase ships as its
own green, bisectable PR in the stacked chain)
- `feat(http): add in-house typed schema validator` -> server/http/schema.ts,
  server/http/standard_schema.ts
- `feat(http): export schema validator from the http barrel` -> server/http/index.ts
- `test(server): cover schema decode, one-pass issues, coercion and Infer` ->
  tests/server/http/schema.test.ts (+ the type-level test file if separate)

STEP 5 - ACCEPTANCE CRITERIA (verifiable)
- [ ] `object()`, `str()`, `num()`, `bool()`, `enum_()`, and `optional()` exist and conform
      type-only to the vendored Standard Schema v1 `~standard` shape.
- [ ] `decode()` collects ALL field issues in one pass (an object with 3 bad fields yields 3
      issues), each `{ pointer, code, params? }` with a stable code, never English.
- [ ] `num()` coerces a string to a number, rejects NaN with `code: 'type'`, and enforces
      `int`/`min`/`max`; a `:id`-style "abc" yields an issue and "7" yields `7`.
- [ ] `str()` enforces `minLength`/`maxLength`; `enum_()` rejects a non-member with `code: 'enum'`;
      a missing required field yields `code: 'required'`.
- [ ] `Infer<typeof S>` is structurally identical to the hand-written expected type (expectTypeOf or
      test-d passes); each combinator's `~standard` is assignable to `StandardSchemaV1.Props`.
- [ ] `object()` reads only declared keys; an input `__proto__`/`constructor` key does not pollute
      Object.prototype (test proves it).
- [ ] schema.ts is at or under the ~150-line cap, adds zero new dependencies, imports nothing from
      src/sim/render/ui/net, and uses no DOM, Three, `Math.random`, or `Date.now`.
- [ ] schema.ts and the vendored type are exported from server/http/index.ts.
- [ ] `npx tsc --noEmit`, `npx vitest run tests/server/http/schema*.ts`, `npm run ci:changed`, and
      `npm run build:server` are all green.
- [ ] No em dashes, en dashes, or emojis anywhere in the diff.

STEP 6 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md: mark Phase 6 done; name the new modules
  (server/http/schema.ts, server/http/standard_schema.ts), the Issue shape `{pointer, code, params}`,
  the combinator set, and the validation code set (type, required, min, max, int, minLength,
  maxLength, enum).
- Update docs/api-pipeline/state.md: add schema.ts and standard_schema.ts to the spine inventory and
  the barrel export list; note that code->HTTP-status mapping (Phase 7), the validate middleware
  (Phase 8), and the concrete page/pageSize bounds and client i18n (Phases 10 and 22) are deferred.
- Record in Claude Code memory the surprising rules: the `~standard` conformance is TYPE-ONLY (a
  vendored ~30-line type, no dependency), the runtime path is `decode()` returning CODES not
  English, `Infer<typeof S>` derives handler input (no parallel interface), all issues collected in
  one pass, and object() reads only declared keys (prototype-pollution-safe by construction).

STEP 7 - FINAL RESPONSE FORMAT
Report, tightly:
- Phase status (DONE / BLOCKED).
- Files touched (absolute or repo-relative paths).
- Validation results (tsc, vitest, ci:changed, build:server: pass/fail).
- Review verdicts (privacy-security-review, qa-checklist: BLOCKING count, SHOULD-FIX count).
- Deferrals (what was correctly left to Phases 7, 8, 10, 22).
- One-line handoff: "Ready for Phase 6 QA (phase-06-qa.md)."

STOPPING RULES
- STOP if any change would need a new runtime dependency (zod, valibot, ajv, @standard-schema/spec):
  vendor the ~30-line Standard Schema type instead.
- STOP if schema.ts grows well past the ~150-line cap: the cap is a design signal, the design is
  wrong, re-scope before continuing.
- STOP if you find yourself wiring schema into a RouteDef, mapError, error_codes.ts, withBody, or the
  registry: those are Phases 7 to 10, out of scope here.
- STOP if the validator would need to emit an English player-facing string: it emits stable codes
  only (server stays language-agnostic).
- STOP if determinism or host-agnostic purity would be violated (any src/sim import, any DOM/Three,
  or any `Math.random`/`Date.now`/`performance.now` in the validator).
- STOP if any change would alter the WS wire protocol (it must not; this phase does not touch it).
````
