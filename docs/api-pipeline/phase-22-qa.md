# Phase 22 QA: REST i18n matcher + per-surface code-parity guard

This QA phase audits the Phase 22 diff (the `userFacingApiError` rework to code-based lookup with a
prose fallback, the new `apiError.*` English catalog domain, and the per-surface code-parity guard
`tests/api_error_code_parity.test.ts`). It is sized to stay under 40% context because it reviews
exactly one client function, one declarative catalog domain, and two test files against a fixed,
short acceptance list, and it spawns only the reviewer whose surface the diff actually touches (the
client i18n matcher mirror, cross-platform-sync) plus the QA gate, not the whole bench.

The QA Starter Prompt below is self-contained. A fresh Claude Code session can paste and run it
without reading this table of contents.

### QA Starter Prompt

````text
This is the QA pass for Phase 22 of the API Pipeline re-architecture: REST i18n matcher +
per-surface code-parity guard.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: verify every Phase 22 acceptance criterion, the server-language-agnostic plus
client-localizes-by-code parity, and the stable-code i18n model; apply BLOCKING and SHOULD-FIX
findings; leave the phase green.

STEP 0 - PRE-FLIGHT
- Run `git status`. SHARED worktree: if dirty outside this phase's scope (src/main.ts,
  src/ui/i18n.catalog/, the regenerated resolved i18n artifact, tests/api_error_code_parity.test.ts,
  tests/main_api_error.test.ts, docs/api-pipeline/), STOP and ask.
- Confirm the Phase 22 implementation PR is the current branch's diff and the suite was reported
  green by the implementer. Scan Claude Code memory for "REST matcher userFacingApiError unguarded",
  "i18n resolved baseline and assembly", "M16 wordy-English requires non-Latin fills",
  "i18n reword-staleness blind spot".

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; do not read planning docs yourself)
Ask it to summarize, anchored on SYMBOL NAMES and CODE STRINGS (never line numbers):
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (the Phase 22 entries: the apiError.*
  domain, the userFacingApiError code-lookup rework with prose fallback, the new parity guard, the
  code-to-apiError-key mapping table location, and the old-ladder prose-fallback dependency).
- docs/api-pipeline/phase-22-rest-i18n.md (the acceptance criteria and stopping rules to audit
  against).
- The Phase 22 git diff: `git diff` of src/main.ts (userFacingApiError), src/ui/i18n.catalog/ (the
  apiError.* domain + barrel), the regenerated resolved i18n artifact, tests/main_api_error.test.ts,
  and tests/api_error_code_parity.test.ts. Return it symbol-anchored (the matcher branches, the
  code-to-key mapping, the parity assertion), never line numbers.
- server/http/error_codes.ts (the as-const code catalog the guard enumerates from) and
  server/http/errors.ts (where the problem+json serializer places the code + params), so the auditor
  can confirm the guard reads the real source of truth and the matcher reads the real wire field.
The Explore agent returns: the as-shipped userFacingApiError branch order (code first, prose
fallback, diagnostic English); the apiError.* entries and which are wordy (M16); the parametric
{code,params} ports and their client-side formatters; the parity guard's enumeration source, its
every-locale assertion, its append-only freeze, and its failure-message text; and the full
server-emitted code set from error_codes.ts.

STEP 2 - QA AUDIT (spawn these agents in parallel, each given ONLY the Explore summary; add to every
prompt: "If your output is truncated, resume from the last completed file and continue; do not
restart.")
- Correctness agent: verify EVERY acceptance criterion from phase-22-rest-i18n.md one by one, and
  explicitly:
  (a) userFacingApiError looks up an emitted stable code DIRECTLY via t('apiError.<key>') when the
      error carries a problem+json code, and the legacy prose-matching branches REMAIN as a fallback
      for un-migrated old-ladder raw-English errors (resolution order: code, then prose, then
      diagnostic English). No prose branch for a not-yet-migrated route was removed.
  (b) The parametric cases (account-suspended {date}, the {seconds} rate-limit families) are ported
      to {code, params} and formatted CLIENT-SIDE via formatDateTime/formatDuration/Intl, never
      server-formatted; the interpolation is preserved.
  (c) apiError.* English entries exist for every server-emitted code (the mapping), added to the en
      catalog ONLY; no src/ui/i18n.locales/<lang>.ts overlay was edited EXCEPT the M16 non-Latin
      fills (zh/zh_TW/ja/ko/ru) for new WORDY English values.
  (d) tests/api_error_code_parity.test.ts enumerates EVERY code from server/http/error_codes.ts (not
      a hand-copied list), asserts each resolves to a non-empty client entry in EVERY locale, covers
      the ~30 to 45 existing REST strings AND the new Discord and guild codes, enforces append-only,
      and its failure message names the EXACT apiError.<key> English key to add.
  (e) Server-language-agnostic plus client-localizes-by-code parity: the server emits a stable CODE
      (no English the client localizes, no DOM, no t() in server/), and the SAME code localizes
      identically across hosts at the client boundary. The matcher's dual role is preserved: the
      WS-disconnect-reason branches (loading.connectionLost/Rejected, the tServer moderation.* kicks)
      and the intentionally-English diagnostic branches resolve unchanged.
  (f) Stable-code i18n hygiene: no concat, no ?? 'English' fallback, no default param, no
      setAttribute path bypassing t(); the S3 guard (tests/localization_fixes.test.ts) stays green.
- Test-coverage agent: are these each asserted by a REAL test (not merely present): a code-bearing
  problem+json error resolving via apiError.<key>; an un-migrated raw-English error resolving via the
  prose fallback; both parametric families interpolating + client-formatting; a WS-disconnect reason
  unchanged; a diagnostic error staying English; every-code-in-every-locale resolution; the
  append-only freeze failing on a removed/reordered code; and the failure message naming the exact
  key? Name any uncovered branch (especially a code in error_codes.ts with no parity-test coverage
  and any new Discord/guild code).
- Dead-code / cleanup agent: any prose branch in userFacingApiError now fully shadowed by a migrated
  code (safe to note for next-release removal, NOT to delete here while the old ladder lives); any
  unused import; any inline code string literal that should be the named mapping entry; any duplicated
  apiError key; any debug log left in; any locale-overlay edit beyond the M16 fills.
- Domain reviewers (spawn ONLY these; the diff is src/main.ts + the catalog + tests, the client i18n
  matcher mirror; no server behavior, no DDL/JSONB, no wire/sim change):
  - cross-platform-sync: the client matcher correctly mirrors every server-emitted code; the server
    stays language-agnostic; parametric params reach the client formatter (no server-side number/date
    formatting); the prose fallback still covers un-migrated routes; the WS-disconnect role is
    unchanged; no English prose leaks from the server.
  - qa-checklist: the end-of-contribution gate.
  Do NOT spawn privacy-security-review (no server behavior/auth/BOLA/SQL change), migration-safety
  (no DDL/JSONB), or architecture-reviewer (no src/sim change). Each reviewer is prompted for
  COVERAGE (report every gap with confidence + severity), not filtering.

STEP 3 - FIX
- Apply every BLOCKING and SHOULD-FIX finding. Re-run the validation matrix after fixes:
  `npx tsc --noEmit`;
  `npx vitest run tests/api_error_code_parity.test.ts tests/main_api_error.test.ts`;
  `npx vitest run tests/localization_fixes.test.ts` (S3);
  regenerate the resolved i18n catalog the way the build does (confirm pending rows for non-wordy new
  keys and the five non-Latin fills for wordy keys);
  `npm run ci:changed`; `npm run build`;
  and the full pre-merge gate `npm test && npx tsc --noEmit && npm run build:env && npm run
  build:server && npm run build`.
- Commit fixes SEPARATELY from the implementation commits, Conventional Commits with a scope and
  EXPLICIT paths (e.g. `fix(i18n): add missing apiError entry for the discord unlink code`,
  `test(i18n): cover the prose fallback for an un-migrated route`). Never git add -A.

STEP 4 - DOC + MEMORY
- Update docs/api-pipeline/progress.md and state.md with the QA outcome and any newly-discovered rule
  (e.g. a code that was emitted but had no client entry, or a parametric case that was being
  server-formatted).
- Record in memory anything surprising future i18n/matcher phases need (the prose-fallback lifetime
  tied to the old ladder; the M16 fills required for wordy apiError values; the once-unguarded REST
  matcher now covered by the parity guard).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
Report: PASS / PASS-WITH-FOLLOWUPS / FAIL; counts (acceptance criteria verified, BLOCKING found +
fixed, SHOULD-FIX found + fixed, deferrals); validation results (each command PASS/FAIL); reviewer
verdicts (cross-platform-sync, qa-checklist); and a one-line handoff to "Phase 23: Structured logging
+ /metrics exporter + drain-aware health".
````
