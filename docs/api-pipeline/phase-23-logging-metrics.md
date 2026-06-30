# Phase 23: Structured logging + /metrics exporter + drain-aware health

This phase lights up the observability layer that Phase 8's metric/log hook seam was built to
feed: an in-house structured logger facade (with secret/PII redaction and the Phase 5 ALS
request id on every line), a Prometheus `/metrics` exporter, and drain-aware `/livez` + `/readyz`
health checks. It is purely additive: it consumes the Phase 8 `MetricSink` interface (replacing
its no-op default at boot), reads the Phase 5 AsyncLocalStorage reqId, and mounts a few cheap
top-level operational handlers. It changes no routing, no dispatch flag, no WS wire, and no
persistence, which is why it stays under the 40% context bound. It carries a documented a/b
split (23a logger + access log + X-Request-Id, 23b /metrics + /livez/readyz): tell the runner to
split into two stacked PRs if context approaches 40%.

````
### Starter Prompt

This is Phase 23 of the API Pipeline re-architecture: Structured logging + /metrics exporter + drain-aware health.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
ULTRACODE: this phase is mostly a handful of new modules plus their unit tests, NOT a large content sweep, so hand-spawn parallel agents. Add `ultracode` ONLY if the request-path console.* sweep across db.ts and the domain modules turns out to be large and mechanical, to fan that one replacement out via a Workflow.
Goal: Provide the real observability sinks behind Phase 8's metric/log seam: an in-house pino-shaped structured logger facade with secret redaction and the ALS reqId on every line, an X-Request-Id response echo, a prom-client RED `/metrics` exporter with bounded cardinality, and drain-aware `/livez` + `/readyz`, without changing routing, the dispatch flag, the WS wire, or persistence.

STEP 0 - PRE-FLIGHT:
- Run `git status`. The worktree is SHARED with concurrent sessions. If it is dirty with files you do not own, STOP and ask before staging anything; you will commit with EXPLICIT paths only, never `git add -A`.
- Scan Claude Code memory (MEMORY.md index) for entries in this phase's domain. Suggested concrete topics to pull: (1) "Server API pipeline audit" / "server-api-pipeline" (the locked SPEC and the prom-client weighed-exception decision), (2) "Backend scaling / rewrite verdict" (the single event loop the metric write and ALS now share with the 20 Hz world loop, so the logger and exporter must stay cheap), (3) "No em dashes or emojis" and "Biome on touched files", (4) "Shared-worktree commit care". Report what you found before proceeding.

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or server source directly; spawn ONE Explore agent and have it summarize):
Files to summarize:
- docs/api-pipeline/state.md and docs/api-pipeline/progress.md (current packet state, what Phases 1 to 22 landed, especially that the dispatcher is mounted with the metric sink defaulting to a no-op).
- docs/api-pipeline/phase-23-logging-metrics.md (this file).
- The Phase 8 seam this phase fills: server/http/middleware/metric_sink.ts (the MetricSink interface, the per-request event shape { route-template, method, status, durationMs }, the no-op default, and WHERE that default is injected at boot so you can replace it).
- The Phase 5 reqId carrier: server/http/context.ts (the AsyncLocalStorage carrier + the reqId getter), and server/http/middleware/request_id.ts (the Phase 8 middleware that generates the reqId and runs the onion inside the ALS; it does NOT yet echo X-Request-Id, which is this phase).
- server/http/middleware/with_errors.ts (the outermost middleware that writes a thrown response, so the X-Request-Id header must already be set before it runs).
- The boot/wiring surface (anchor on SYMBOL NAMES, not line numbers; server/main.ts is ~1695 lines): the `createServer` prefix dispatcher / the Phase 1 pure prefix-dispatch function (where top-level operational handlers can mount BEFORE the /api onion and outside auth), the `startServer` setup, the `shutdown` closure and its `process.on('SIGINT'|'SIGTERM', shutdown)` wiring, and the registry/index boot point where the dispatcher is constructed.
- The Phase 21 top-level `withSecurityHeaders` wrapper (so /livez, /readyz, /metrics inherit nosniff + strip-Server and get Cache-Control no-store).
- The request-path console.* call sites to route through the logger: server/main.ts request handlers, server/internal.ts, server/oauth.ts, and server/db.ts plus any domain module that logs on the request path. Have the agent COUNT them (the SPEC estimates ~70) and report whether db.ts / domain functions can read the ALS reqId today.
- package.json dependencies (confirm prom-client is ABSENT and that pino is NOT present, since the logger facade is in-house and prom-client is the ONLY sanctioned new dependency).
- server/CLAUDE.md and root CLAUDE.md (server conventions, module-first, the dev-channel-text English-only rule, the tiny-dependency-set rule and its prom-client exception, no-em-dash rule).
Tell the Explore agent to RETURN: the exact MetricSink interface + event shape + the boot injection point, the ALS reqId getter signature and whether db.ts can read it, the request_id middleware signature, the createServer prefix-dispatch shape and where a top-level GET handler mounts, the `shutdown` closure symbol and its SIGTERM/SIGINT wiring, the security-headers wrapper coverage, the count and locations of request-path console.* calls, and confirmation that prom-client and pino are both absent from package.json. It must NOT propose code; just facts, signatures, and counts.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE: hand-spawn a 3-agent parallel fan-out, each owning a complete vertical slice (behavior module(s) + its unit tests under tests/server/http/), each given ONLY the Explore summary. If context approaches 40%, split along the documented a/b boundary: ship 23a (Agent A) as its own stacked PR first, then 23b (Agents B + C) as the next stacked PR.

  Agent A (slice 23a: logger + redactor + access log + X-Request-Id echo):
  - server/http/redact.ts: a PURE, host-agnostic redactor that scrubs EVERY named secret/PII class from a logged value (object or string) before it reaches the transport: Authorization header, bearer 64-hex tokens, password fields, cookie headers, OAuth authorization codes, TOTP codes, wallet private keys. It must replace each match with a stable placeholder (for example "[redacted]"), recurse into nested objects/arrays, be idempotent, and preserve non-secret fields untouched. Node-tested directly.
  - server/http/logger.ts: an IN-HOUSE, pino-SHAPED structured JSON logger facade (info/warn/error + child(bindings)), NOT a pino dependency. Every line is one JSON object carrying the ALS reqId read from server/http/context.ts (so lines emitted from db.ts and domain functions across an await still carry it) and is passed through redact.ts before write. Do NOT add pino or any logging dependency; write structured JSON to stdout/stderr.
  - server/http/access_log.ts: a MetricSink implementation (consuming the Phase 8 seam) that emits ONE structured access line per request via logger: { reqId, method, route-template, status, durationMs, ip }. The route is the :param template the Phase 8 sink already carries, never a concrete path.
  - X-Request-Id echo: extend server/http/middleware/request_id.ts so it sets the X-Request-Id response header from the ALS reqId EARLY (before any handler or withErrors writes headers), so the id is echoed on BOTH 2xx and thrown 5xx responses. Do not introduce a separate middleware if the echo fits cleanly in request_id.
  - Route the request-path console.* calls (server/main.ts request handlers, server/internal.ts, server/oauth.ts, server/db.ts, request-path domain modules) through logger. These are DEV-CHANNEL: English is correct here, NO t() keys, no player-facing strings.
  - Deliverables (bullets): redact.ts, logger.ts, access_log.ts, the X-Request-Id echo in request_id.ts, the console.* -> logger sweep; tests tests/server/http/redact.test.ts (every secret class scrubbed, non-secret fields preserved, nested + string inputs, idempotent), tests/server/http/logger.test.ts (a line emitted across an await carries the ALS reqId; redactor applied; valid JSON shape), tests/server/http/access_log.test.ts (one access line per request with route-template/status/durationMs/reqId; a secret in the request never appears in the line), and an extension to tests/server/http/request_id.test.ts (X-Request-Id echoed on a 2xx AND on a thrown 5xx response).

  Agent B (slice 23b part 1: prom-client RED /metrics exporter):
  - package.json: add prom-client pinned to an EXACT version. This is the ONE sanctioned new runtime dependency for the whole packet; add nothing else. Run the install so the lockfile updates.
  - server/http/metrics.ts: a prom-client Registry plus the RED request-layer catalog fed from the Phase 8 MetricSink seam: a Counter http_requests_total{route,method,status}, a Histogram http_request_duration_seconds{route,method,status} with a NAMED bucket-boundary constant (no inline literal array), and optionally an in-flight Gauge. Export a MetricsSink (a MetricSink implementation) that records each event. CRITICAL: the route label is the Phase 8 :param TEMPLATE, never a concrete path, so a flood of distinct ids cannot explode label cardinality; the status and method labels are bounded by construction. Export a function returning registry.metrics() for the exporter route. You MAY enable prom-client collectDefaultMetrics (process/event-loop, bounded cardinality, cheap) but it is optional.
  - Deliverables (bullets): the pinned prom-client dependency, server/http/metrics.ts (Registry, RED catalog, named bucket constant, MetricsSink, metrics() accessor); tests tests/server/http/metrics.test.ts (the counter + histogram increment on an event; feeding many distinct concrete-id-like routes through the sink keeps the series/label set BOUNDED because only the template is used; status/method labels bounded; the metrics() text parses as Prometheus exposition).

  Agent C (slice 23b part 2: drain-aware health + top-level handler wiring):
  - server/http/health.ts: a small readiness state module exporting markDraining(), isReady(), and isLive() (the drain flag lives here). isLive() is true while the process runs; isReady() is true until markDraining() is called.
  - Top-level operational handlers mounted in the createServer prefix ladder BEFORE the /api onion and OUTSIDE auth/rate-limit (so they answer even while the rest is draining): GET /livez (200 while live), GET /readyz (200 when isReady(), 503 during the SIGTERM drain), GET /metrics (serves metrics() from Agent B). They inherit the Phase 21 security-headers wrapper; add Cache-Control: no-store. These are operational/dev-channel responses, NOT player-facing: no t() keys, no problem+json envelope.
  - server/main.ts: the existing `shutdown` closure calls markDraining() FIRST, before game.stop()/saveAll/saveMarket, so /readyz flips to NOT-ready at the START of the SIGTERM drain while in-flight work completes.
  - Boot wiring: inject a composite MetricSink (access_log + metrics, a tiny tee) into the Phase 8 seam at the dispatcher boot point, replacing the no-op default. The no-op default STAYS the default for unit tests; only the live boot path swaps it.
  - Deliverables (bullets): server/http/health.ts, the /livez + /readyz + /metrics top-level handlers, the markDraining() call in shutdown, the composite-sink boot injection; tests tests/server/http/health.test.ts (isReady() true at boot then false after markDraining(); /readyz 200 then 503 during drain; /livez stays 200 during drain).

  Cross-slice contract all agents honor: the metric/access-log/X-Request-Id all derive from the SAME Phase 8 event + the SAME ALS reqId; the route dimension is ALWAYS the :param template, never a concrete path, on BOTH the access line and the metric label. No agent changes routing, the dispatch flag, or the WS path.

INVARIANTS THIS PHASE MUST KEEP:
- Single-flag dispatch + catch-all delegate model: this phase only fills the Phase 8 sink seam and mounts cheap top-level operational handlers. Do NOT change the dispatcher, the dispatch flag, the per-path delegate, or any route table.
- Server-authority unchanged; the WS wire protocol and the WS upgrade path are UNTOUCHED (the logger replaces console.* on the HTTP request path only; do not alter WS message handling or snapshots).
- Determinism / sim-purity: this is SERVER-ONLY. Do NOT import or modify anything in src/sim/, and do NOT use the logger inside src/sim/. Server wall-clock time in an access log line and a metric timestamp is fine (this is not sim logic); the injected now() limiter clock from Phase 2 is unrelated here.
- Stable-code i18n: the logger, the access line, and /livez//readyz//metrics are DEV-CHANNEL / operational, English-only by the CLAUDE.md rule (console.* and operational health text are out of i18n scope). This phase adds NO player-facing string and does NOT touch userFacingApiError, error_codes.ts, or the apiError.* catalog. If any output here would be shown to a player, STOP: it is the wrong surface.
- No persistence change: no DDL, no JSONB shape change, no new table (so the migration-safety reviewer is NOT in play).
- Tiny-dependency-set rule: prom-client is the ONLY new runtime dependency, pinned exact. The logger facade is IN-HOUSE and pino-SHAPED; do NOT add pino or any other dependency.
- No magic values: the histogram bucket boundaries, the redaction placeholder, and any metric/label name are NAMED constants in their module; never an inline literal repeated across files.
- Module-first: each capability is its own small file under server/http/ (redact.ts, logger.ts, access_log.ts, metrics.ts, health.ts); NEVER grow main.ts (the only main.ts edits are the one-line markDraining() in shutdown, the top-level health/metrics handler mounts, and the composite-sink injection at boot).
- No em dashes, no en dashes, no emojis anywhere (code, comments, tests, commits, this doc).

OUT OF SCOPE (do not do these here):
- The validated loadConfig(env) consolidation, the requestTimeout/headersTimeout/keepAliveTimeout/maxHeaderSize server timeouts, the named drain-WINDOW duration constant, the boot log of the active dispatch path, and the perf/tick-jitter acceptance gate (Phase 24). This phase adds the drain FLAG and flips /readyz; the timed drain window and its constant are Phase 24.
- Any gate/authn on /metrics (a METRICS_TOKEN or bind-address restriction): if exposure is a concern, surface it as a Phase 24 config decision; default here is unauthenticated internal-scrape. Do NOT invent an env read.
- The REST i18n matcher, apiError.* catalog, and per-surface code-parity guard (Phase 22, already done) and any new error code.
- The two-tier rate limiter, ratelimit_db, and RATELIMIT_SCHEMA (Phase 19); the market realm-scope fix (Phase 20); the security-headers wrapper itself (Phase 21, consumed here, not authored).
- Replacing console.* OUTSIDE the request path (the world-loop boot banner, WS lifecycle logs) is optional and should not expand into a whole-server logging migration.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
Run, in order:
- `npx tsc --noEmit`
- `npx vitest run tests/server/http/redact.test.ts tests/server/http/logger.test.ts tests/server/http/access_log.test.ts tests/server/http/request_id.test.ts tests/server/http/metrics.test.ts tests/server/http/health.test.ts` (the new + extended suites)
- `npm run build:server` (confirm esbuild bundles prom-client into the server bundle and the new top-level handlers + composite sink build)
- `npm run ci:changed` (Biome on changed files only; never a whole-tree --write)
Then, before merge, mirror CI: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`.
NOTE: tests/localization_fixes.test.ts (S3) and the per-surface code-parity test are NOT required this phase (no player-facing string or code added); say so explicitly rather than running them as a gate.

Review-agent dispatch (run `git diff --name-only` first; spawn ONLY matching surfaces, each prompted for COVERAGE not filtering, each told: "if your output is truncated, resume from where you stopped; do not restart"):
- privacy-security-review: REQUIRED. The diff adds a logger with secret/PII redaction, a new runtime dependency (prom-client), an unauthenticated /metrics exporter, and access-log lines that include the client ip. Have it verify: every named secret class (Authorization/bearer 64-hex/password/cookie/OAuth code/TOTP/wallet key) is actually redacted before write (try to find a path that logs a raw token), no metric label can be a concrete path (cardinality/memory DoS), /metrics does not leak sensitive internal data and its exposure posture is acceptable or flagged for a Phase 24 gate, the prom-client dependency (and its transitive deps such as tdigest/bintrees) is the pinned weighed exception and nothing else was added, and the ip-in-access-log handling is acceptable (decide truncate vs full).
- qa-checklist: REQUIRED at phase completion.
- migration-safety: NOT dispatched (no DDL / JSONB / db.ts schema change). State this explicitly in the final response.
- cross-platform-sync and architecture-reviewer: NOT dispatched (server-only, no src/sim / wire / matcher change). State this explicitly.
- The new prom-client dependency will also be covered by the release-malware-audit gate at release time; note that, but do not run a release scan as a per-phase gate.
Do not commit until every dispatched reviewer reports no BLOCKING finding.

STEP 4 - COMMIT CADENCE (Conventional Commits with a scope, EXPLICIT paths only; this phase ships as its OWN green, bisectable PR in the stacked chain, or as 23a then 23b if you split):
- `feat(http): add in-house structured logger facade and secret redactor` (server/http/logger.ts server/http/redact.ts + tests)
- `feat(http): emit structured access log and echo X-Request-Id` (server/http/access_log.ts server/http/middleware/request_id.ts + tests)
- `refactor(server): route request-path console.* through the logger facade` (server/main.ts server/internal.ts server/oauth.ts server/db.ts + any request-path domain module)
- `feat(http): add prom-client RED /metrics exporter` (package.json package-lock.json server/http/metrics.ts + tests)
- `feat(http): add drain-aware /livez and /readyz health checks` (server/http/health.ts server/main.ts + tests)

STEP 5 - ACCEPTANCE CRITERIA (verifiable checkbox list):
- [ ] An IN-HOUSE pino-shaped logger facade (NO new pino dependency) carries the ALS reqId on every line, including lines emitted from db.ts / domain functions across an await; the request-path console.* calls are routed through it.
- [ ] redact.ts scrubs every named secret/PII class (Authorization, bearer 64-hex, password, cookie, OAuth authorization code, TOTP, wallet private key) from logged payloads, recurses into nested values, is idempotent, and preserves non-secret fields.
- [ ] One structured access line is emitted per request via the Phase 8 MetricSink seam; the no-op default remains the default for unit tests and only the live boot path swaps in the real composite sink.
- [ ] X-Request-Id is echoed on the response for BOTH a 2xx and a thrown 5xx path.
- [ ] prom-client `/metrics` emits the RED request-layer catalog (http_requests_total, http_request_duration_seconds with a named bucket constant); the route label is the :param template and a flood of distinct ids does NOT grow the label set.
- [ ] /livez returns 200 while the process is live; /readyz returns 200 when ready and 503 during the SIGTERM drain; markDraining() is called FIRST in the shutdown closure.
- [ ] prom-client is the ONLY new runtime dependency, pinned exact; no pino, no second dependency.
- [ ] No src/sim import, no WS wire change, no routing / dispatch-flag change, no DDL / JSONB change.
- [ ] No new player-facing string; userFacingApiError, error_codes.ts, and apiError.* are untouched; the new endpoints and log lines are dev-channel / operational.
- [ ] tsc clean; all new + extended tests green; build:server green (prom-client bundles); ci:changed clean.

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/api-pipeline/progress.md: mark Phase 23 complete; name the new modules server/http/{redact,logger,access_log,metrics,health}.ts, the X-Request-Id echo added to request_id.ts, the composite MetricSink injected at boot (replacing the no-op default), the prom-client dependency (pinned version), the RED metric names (http_requests_total, http_request_duration_seconds) + the named histogram-bucket constant, the new endpoints /livez, /readyz, /metrics, and the markDraining() call in shutdown.
- Update docs/api-pipeline/state.md: record that the observability seam is now LIVE (real sinks injected, no-op default retained for tests), that /readyz is drain-aware via the health.ts flag, and that the timed drain WINDOW constant, the loadConfig consolidation, the server timeouts, the metrics-exposure gate, and the perf/tick-jitter acceptance gate remain Phase 24.
- Record in Claude Code memory the surprising rules you hit: that the logger facade is IN-HOUSE pino-SHAPED and pino must NOT be added (prom-client is the ONLY weighed dependency); that the metric and access-log route dimension MUST be the :param template or cardinality explodes; that /readyz must flip on drain via markDraining() called BEFORE saveAll in shutdown; that the logger and health/metrics endpoints are dev-channel so they carry NO t() keys; and that the reqId reaches db.ts / domain functions only through the Phase 5 ALS, not a passed argument.

STEP 7 - FINAL RESPONSE FORMAT (return as text, no report file): phase status (COMPLETE / BLOCKED); files touched (absolute paths); validation results (tsc / vitest / build:server / ci:changed, and the explicit note that S3 + code-parity were not in play); review verdicts (privacy-security-review, qa-checklist) with any non-blocking follow-ups; deferrals (note migration-safety / cross-platform-sync / architecture-reviewer were correctly not dispatched and why, and that the release-malware-audit will cover prom-client at release); one-line handoff: "Ready for Phase 23 QA (docs/api-pipeline/phase-23-qa.md)."

STOPPING RULES (stop and surface, do not improvise):
- Stop if any change would alter the WS wire protocol or the WS upgrade handshake.
- Stop if determinism or sim-purity would be violated (any src/sim/ import, or using the logger inside src/sim/).
- Stop if a metric label or access-log route dimension would be a CONCRETE path (unbounded cardinality) instead of the :param template.
- Stop if any named secret class would reach a log line unredacted, or if you cannot prove redaction with a test.
- Stop if the logger or /metrics would require a SECOND new runtime dependency, or if pino (rather than the in-house facade) would be added.
- Stop if wiring the sink, health, or metrics would require changing routing, the dispatch flag, or the per-path delegate (that is Phase 9, already done), or if /readyz cannot answer during drain because it routes through the path being drained.
- Stop if any output here would need a player-facing string / t() key rather than dev-channel English.
````
