# Phase 6 QA: Typed schema validator (schema.ts)

This is the QA gate for Phase 6. It audits the in-house schema validator
(`server/http/schema.ts`, the vendored `standard_schema.ts` type, the barrel export, and
`tests/server/http/schema*.ts`) for correctness, test coverage, dead code, and the two
invariants in play (host-agnostic purity and server-emits-codes-not-English), then applies any
BLOCKING and SHOULD-FIX findings. It is sized to stay under 40% context because the diff is one
small pure module plus one test file, with no DB, no route wiring, and no cross-file surface.

Paste the block below into a fresh Claude Code session. It is self-contained.

### QA Starter Prompt

````md
This is the QA pass for Phase 6 of the API Pipeline re-architecture: Typed schema validator
(schema.ts). Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: verify the Phase 6 diff meets EVERY acceptance criterion in phase-06-schema-validator.md,
fix BLOCKING and SHOULD-FIX findings, keep the validation matrix green, and hand off to Phase 7.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with concurrent sessions: if it is dirty with files you
  do not own, STOP and ask before touching anything. Commit only your own files with EXPLICIT paths,
  never `git add -A`.
- Confirm the Phase 6 commits are present (schema.ts, standard_schema.ts, barrel export, the schema
  test file).
- Scan Claude Code memory for this phase's domain. Suggest 2 to 4 topics to look up, for example:
  "Phase 6 schema validator", "Standard Schema v1 type-only conformance", "in-house validator
  one-pass issues / prototype-pollution-safe object()", "stable-code i18n (server emits codes)".

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; do not read large files directly). Have it summarize:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (the recorded Phase 6 outcome:
  modules, Issue shape, code set, deferrals).
- docs/api-pipeline/phase-06-schema-validator.md (the acceptance criteria, invariants, out-of-scope
  list, and stopping rules this QA must hold the diff to).
- The Phase 6 git diff: run `git diff --name-only` against the Phase 5 base and read the changed
  files (server/http/schema.ts, server/http/standard_schema.ts, server/http/index.ts,
  tests/server/http/schema*.ts). The Explore agent reports the actual exported surface, the
  combinator set and their option handling, the Issue/DecodeResult shapes, the one-pass collection
  logic, the object() declared-keys-only construction, and the test inventory.
The Explore agent must RETURN: the exported API as built, a checklist mapping each Phase 6
acceptance criterion to where (if anywhere) the diff satisfies it, and any obvious gap (a missing
combinator, a first-fail short-circuit, an English string, a clock/random call, a dependency add, a
line-count overflow).

STEP 2 - QA AUDIT (fan out parallel agents, each given ONLY the Explore summary plus the changed
files; each prompted for COVERAGE not filtering, with the truncation-resume line: "If your review is
truncated, resume from the last file and finding you completed; do not restart.")
- Correctness agent: verify EVERY acceptance criterion in phase-06-schema-validator.md against the
  real code, item by item:
  - object/str/num/bool/enum_/optional exist and conform type-only to the vendored Standard Schema
    v1 `~standard` shape.
  - decode() collects ALL field issues in one pass (3 bad fields yield 3 issues), each
    `{pointer, code, params?}`.
  - num() coerces string to number, rejects NaN as `type`, enforces int/min/max; "abc" -> issue,
    "7" -> 7; page/pageSize-style bounds hold at the edges.
  - str() minLength/maxLength, enum_() non-member -> `enum`, missing required -> `required`.
  - Infer<typeof S> is structurally identical to the expected type; each `~standard` is assignable
    to StandardSchemaV1.Props.
  - object() reads only declared keys; `__proto__`/`constructor` input cannot pollute
    Object.prototype.
  - <= ~150-line cap, zero new dependencies, no src/sim|render|ui|net imports, no DOM/Three, no
    Math.random/Date.now/performance.now.
  - exported from server/http/index.ts.
  Also verify the SERVER parity and stable-code i18n where relevant: schema.ts is host-agnostic and
  pure, so it decodes identically wherever the shared server core runs (REST handler path and any WS
  handler path that later reuses it), there is no DOM/Three/sim coupling that could diverge by host;
  and every Issue carries a stable CODE with no English player-facing message (the `~standard`
  `message` is a type-only seam, not a runtime English string). Report any criterion not met as
  BLOCKING.
- Test-coverage agent: confirm the test file actually exercises each criterion (valid pass/coerce,
  the one-pass count, each code+params, the :id-NaN rejection, the bounds at the boundaries, the
  prototype-pollution proof, and the type-level Infer and `~standard`-assignability assertions). Flag
  any criterion asserted in prose but not covered by a test as SHOULD-FIX (BLOCKING if it is the
  one-pass collection or the prototype-pollution proof).
- Dead-code / cleanup agent: flag any unused export, unreachable branch, a `validate` runtime path
  that is never used and not needed, an over-built combinator option with no test, or anything that
  pushes past the ~150-line cap and should be trimmed.
- privacy-security-review (matching domain reviewer; server/http input-validation surface): confirm
  object() never reads non-declared input keys, prototype pollution is impossible by construction,
  num() cannot let NaN or an out-of-bounds value through, and no internal detail leaks in an Issue.
  Do NOT dispatch migration-safety, cross-platform-sync, or architecture-reviewer: this diff has no
  DDL/JSONB, no sim/wire/i18n-matcher change, and no src/sim change.

STEP 3 - FIX
- Apply every BLOCKING finding and every reasonable SHOULD-FIX. Keep schema.ts under the ~150-line
  cap; if a fix would blow the cap, prefer trimming over growing.
- Re-run the validation matrix after fixes:
  - `npx tsc --noEmit`
  - `npx vitest run tests/server/http/schema*.ts`
  - `npm run ci:changed` (Biome on changed files only; never a whole-tree --write)
  - `npm run build:server`
- Commit fixes as separate Conventional Commits with a scope and EXPLICIT paths, for example
  `fix(http): reject NaN in num() coercion` or `test(server): add one-pass issue-collection case`.
  This phase remains its own green PR in the stacked chain.

STEP 4 - UPDATE DOCS + MEMORY
- Reconcile docs/api-pipeline/progress.md and state.md with the post-QA reality (final exported API,
  the code set, any criterion deferred with a reason).
- Record in memory anything surprising the QA surfaced (for example a subtle coercion edge, a
  prototype-pollution guard detail, or a type-level conformance gotcha with the vendored Standard
  Schema type).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Report, tightly:
- Verdict: PASS, PASS-WITH-FOLLOWUPS, or FAIL.
- Counts: BLOCKING found/fixed, SHOULD-FIX found/fixed/deferred, criteria verified out of total.
- Validation results (tsc, vitest, ci:changed, build:server: pass/fail).
- Any deferral with its reason.
- One-line handoff: "Phase 6 complete; proceed to Phase 7 (RFC 9457 error model +
  error_codes catalog, phase-07-error-model.md)."
````
