# Phase 21 QA: Security headers top-level wrapper + Content-Type/Origin enforcement

This is the QA gate for Phase 21. It audits the security-headers diff for correctness, test coverage,
dead code, and the one matching domain reviewer (privacy-security-review, since the entire diff is
hardening: headers, Content-Type 415, cross-site Origin), then applies BLOCKING and SHOULD-FIX
findings, re-validates, and hands off to Phase 22. It is sized to stay under 40% context because the
diff is one top-level wrapper plus two small middlewares with no DDL, no JSONB change, and no WS wire
change, so the audit fans out over a bounded surface and the correctness agent re-checks a finite
acceptance list rather than re-deriving the spine. The single load-bearing check is placement: the
wrapper must be top-level and cover BOTH dispatch paths, so a flag-flip cannot drop a header.

### QA Starter Prompt

````
This is the QA pass for Phase 21 of the API Pipeline re-architecture: Security headers top-level
wrapper plus Content-Type/Origin enforcement.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: verify every Phase 21 acceptance criterion holds, fix BLOCKING and SHOULD-FIX findings, keep the
suite green, and hand off to Phase 22.

STEP 0 - PRE-FLIGHT
- Run `git status`. The worktree is SHARED with concurrent sessions: if it is dirty with files you do
  not own, STOP and ask. Commit with EXPLICIT paths only, never `git add -A`.
- Scan Claude Code memory for "API pipeline phase 9 top-level CORS wrapper + dispatcher", "security
  headers / HSTS / COEP / CSP", and "Capacitor native client + cross-realm origins". Note anything
  relevant before auditing.

STEP 1 - LOAD CONTEXT (spawn ONE Explore agent; symbol-anchored summaries, no verbatim dumps)
Have Explore summarize and return:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (what Phase 21 claims it shipped: the new
  middleware modules, the header set, the explicit NO-COEP / NO-CSP decision, the log-only flags, the two
  appended error codes and their apiError.* entries, the top-level-wrapper-covers-both-paths invariant).
- docs/api-pipeline/phase-21-security-headers.md (the acceptance criteria + stopping rules this QA enforces).
- The Phase 21 diff: `git diff --name-only` and the full `git diff` for
  server/http/middleware/security_headers.ts, content_type.ts, origin_check.ts, server/main.ts (the
  top-level wrapper wiring), server/oauth.ts (frame headers / no-store), server/http/error_codes.ts (the
  appended codes), the client apiError.* catalog entries added, tests/server/http/security_headers.test.ts
  plus the content_type + origin_check tests, and the updated Phase 3 fixtures. Return the diff scope so
  the audit agents do not re-read unrelated spine files.

STEP 2 - QA AUDIT (parallel agents; give each ONLY the Explore summary + the diff; COVERAGE not filtering)
- Correctness agent: verify EVERY acceptance criterion in phase-21-security-headers.md against the real code:
  withSecurityHeaders is a TOP-LEVEL createServer wrapper covering serveStatic, /c/ SSR, /p/ card, /avatar,
  the sitemap, the OAuth GET pages AND the route onion, present on BOTH the old-ladder and new-dispatcher
  paths (a simulated flag-off pass still carries every header); the header set is complete (nosniff,
  Referrer-Policy, Permissions-Policy deny-all, HSTS prod-only, COOP/CORP same-origin, OAuth frame headers,
  auth/token no-store, Server + X-Powered-By stripped); COEP: require-corp is NOT set and NO enforcing CSP
  header is present; the Content-Type 415 gate runs LOG-ONLY by default behind a named flag and exempts the
  binary card, HTML unsubscribe, redirect callback, and audited beacon routes via the Phase 3 content-type
  classification, returning 415 + a stable code only when flipped to enforce; the Origin check rejects a
  clear cross-site Origin with a stable code, allows same-origin + allowlisted realm/native origins, ALLOWS
  an absent Origin, and never gates GET/HEAD; all header values, flags, prod detection, and the origin
  allowlist are named constants / config reads with no magic literals. It MUST also verify (a) DUAL-PATH
  PARITY: the security headers appear IDENTICALLY on the old handleApi ladder and the new dispatcher for
  every surface, the new headers a labeled knownDeviation with fixtures updated, and a flag-off pass drops
  nothing; (b) STABLE-CODE i18n: the unsupported-media-type and cross-site-origin codes are appended to
  error_codes.ts frozen append-only with English apiError.* entries, and src/main.ts userFacingApiError was
  NOT touched (that is Phase 22). Confirm the change is SERVER-ONLY (no src/sim, no render/ui beyond the
  apiError.* English catalog entry, no RL surface), the WS upgrade handshake response is untouched, there is
  no DDL, and the WS wire is unchanged.
- Test-coverage agent: confirm tests exist for header presence on a static path, an SSR path, an OAuth GET
  page, and an /api route; the NO-COEP and NO-enforcing-CSP assertions; HSTS-prod-only; the OAuth-only frame
  headers and auth-only no-store; the 415 log-only pass-through + sink record, the per-route exemptions in
  both modes, and 415 + code on enforce; the Origin check for same-origin/allowlisted/absent-Origin/clear-
  cross-site and the GET/HEAD non-gating; and the dual-path parity including a flag-off pass that still
  carries headers. Flag any header, flag, or rejection path that ships without a test.
- Dead-code / cleanup agent: flag duplicated header-setting logic that should live in one wrapper, a
  hardcoded path list that should read the Phase 3 content-type classification, leftover inline scaffolding,
  unused imports/exports, magic header values that should be named constants, and any premature abstraction.
- privacy-security-review: REQUIRED (this IS the security-headers + content-type + origin phase). Verify the
  header set is correct and complete, COEP and an enforcing CSP are absent, the 415 ships log-only and cannot
  break the card/HTML/redirect/beacon routes, the Origin check allows absent-Origin and allowlisted realm/
  native (Capacitor) origins so it cannot break cross-realm or native clients, and no rejection leaks
  internals. Fold the native-client (Capacitor Origin + Content-Type) risk into this review.
- migration-safety: SKIP (no DDL/JSONB change). cross-platform-sync: SKIP (server-only; the native-client
  risk is covered by privacy-security-review). architecture-reviewer: SKIP (no src/sim change).
Give every agent: "If your review is truncated, note exactly where you stopped and resume from that point
in a follow-up pass; do not silently drop coverage."

STEP 3 - FIX
Apply every BLOCKING and SHOULD-FIX finding. Re-run the validation matrix after fixing:
- `npx tsc --noEmit`
- `npx vitest run tests/server/http/security_headers.test.ts` + the content_type + origin_check tests + the
  Phase 9 dual-path parity harness over the affected surfaces (including a flag-off pass)
- `npx vitest run tests/localization_fixes.test.ts` (S3) + the per-surface code-parity assertion if present
- `npm run ci:changed` and `npm run build:server`
- full pre-merge gate: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server &&
  npm run build`
Commit fixes SEPARATELY with EXPLICIT paths and a scoped Conventional-Commit headline
(e.g. `fix(http): ...`, `test(server): ...`). Defer NICE-TO-HAVE findings to a tracked follow-up.

STEP 4 - DOC UPDATES + MEMORY
- Update docs/api-pipeline/progress.md and state.md to reflect the QA outcome and any fixes (new
  constants/codes/knownDeviations introduced during the fix pass).
- Record surprising rules in Claude Code memory (e.g. a parity diff the harness missed, a header that an
  upstream proxy/Cloudflare already sets, an Origin-allowlist subtlety for native clients).

STEP 5 - PACKET TEARDOWN
Not the final phase; skip teardown.

STEP 6 - FINAL RESPONSE FORMAT
- Verdict: PASS / PASS-WITH-FOLLOWUPS / FAIL.
- Counts: BLOCKING found/fixed, SHOULD-FIX found/fixed, deferred follow-ups.
- Validation results (each command + pass/fail) and reviewer verdicts.
- One-line handoff: "Ready for Phase 22: REST i18n matcher + per-surface code-parity guard."
````
