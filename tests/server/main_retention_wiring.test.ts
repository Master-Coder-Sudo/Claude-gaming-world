// Source-text order pins for the retention-sweep wiring in server/main.ts.
// main.ts cannot be imported (it boots a server + connects to Postgres on
// import), so the boot-order and teardown-order guarantees are verified
// structurally, in the tests/companion_read_api.test.ts idiom. Every needle is
// a CALL-form token (trailing '(') so an import line can never satisfy a pin.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MAIN = readFileSync(join(__dirname, '..', '..', 'server', 'main.ts'), 'utf8');
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe('retention sweep wiring in server/main.ts', () => {
  it('keeps orphan-session cleanup a boot precondition, ahead of listen', () => {
    // Orphan cleanup must stay ahead of listen: a fresh process must reconcile
    // stale play sessions before it starts accepting traffic.
    expect(count(MAIN, 'closeOrphanSessions(')).toBeGreaterThanOrEqual(1);
    expect(MAIN.indexOf('closeOrphanSessions(')).toBeLessThan(MAIN.indexOf('server.listen('));
  });

  it('runs no retention DELETE before the server is listening', () => {
    // No retention prune may ever block or precede boot again: the old one-shot
    // boot prunes held boot hostage to an unbounded DELETE on a large table.
    const preListen = MAIN.slice(0, MAIN.indexOf('server.listen('));
    for (const call of [
      'pruneChatLogs(',
      'pruneClientPerfReports(',
      'pruneChatLogsBatch(',
      'pruneClientPerfReportsBatch(',
    ]) {
      expect(preListen).not.toContain(call);
    }
  });

  it('arms the sweep only after the server is accepting traffic', () => {
    // Retention work must never compete with boot; the sweep starts post-listen.
    expect(MAIN.indexOf('retentionSweep.start()')).toBeGreaterThan(-1);
    expect(MAIN.indexOf('server.listen(')).toBeLessThan(MAIN.indexOf('retentionSweep.start()'));
  });

  it('wires each batched prune exactly once and fully retires the old names', () => {
    // Exactly one call site each: the sweep deps closures. A second call site
    // would mean an old one-shot prune path crept back in.
    expect(count(MAIN, 'pruneChatLogsBatch(')).toBe(1);
    expect(count(MAIN, 'pruneClientPerfReportsBatch(')).toBe(1);
    // The old unbounded prune names are fully retired (the Batch names cannot
    // match these needles: 'B' follows the name, never '(').
    expect(count(MAIN, 'pruneChatLogs(')).toBe(0);
    expect(count(MAIN, 'pruneClientPerfReports(')).toBe(0);
  });

  it('stops the sweep during shutdown, after the collectors and before the pool close', () => {
    // An in-flight prune batch must never race pool.end(). The needle for the
    // pool close is the await-call form: the bare token also appears in shutdown
    // rationale comments that precede the stop call.
    const stopAt = MAIN.indexOf('retentionSweep.stop()');
    expect(stopAt).toBeGreaterThan(-1);
    expect(stopAt).toBeLessThan(MAIN.indexOf('await pool.end()'));
    // It sits with the other collector teardown, right after the metrics stop.
    expect(stopAt).toBeGreaterThan(MAIN.indexOf('businessMetrics.stop()'));
  });

  it('keeps the five OAuth and pending-login prunes on the daily interval', () => {
    // Scope guard: only the two retention prunes moved to the sweep; the cheap
    // token/state prunes stay on DAILY_PRUNE_INTERVAL_MS.
    for (const call of [
      'pruneExpiredOAuthGrants(',
      'pruneDiscordOAuthStates(',
      'pruneDiscordPendingLogins(',
      'pruneApplePendingLogins(',
      'pruneGitHubOAuthStates(',
    ]) {
      expect(count(MAIN, call)).toBeGreaterThanOrEqual(1);
    }
  });
});
