import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRetentionSweep,
  RETENTION_SWEEP_ADVISORY_LOCK_KEY,
  RETENTION_SWEEP_BATCH_SIZE,
  RETENTION_SWEEP_POLL_MS,
  type RetentionOnlineSamples,
  type RetentionSweepDeps,
  type RetentionSweepLockClient,
  type RetentionTable,
  retentionBatchVerdict,
  retentionSweepDue,
  utcDayOf,
} from '../server/retention_sweep';

describe('retention sweep constants', () => {
  it('pins the advisory lock key, batch size, and poll interval to their literals', () => {
    // A constant compared against itself proves nothing, so assert the literals:
    // changing any of them then has to be a deliberate edit that reddens this pin.
    expect(RETENTION_SWEEP_ADVISORY_LOCK_KEY).toBe(0x57_4f_43_02);
    // db.ts holds the sibling schema advisory key "WOC\x01" as a module-private
    // constant, so the collision check pins the sibling's literal here too.
    expect(RETENTION_SWEEP_ADVISORY_LOCK_KEY).not.toBe(0x57_4f_43_01);
    expect(RETENTION_SWEEP_BATCH_SIZE).toBe(1000);
    expect(RETENTION_SWEEP_POLL_MS).toBe(60_000);
  });
});

describe('utcDayOf', () => {
  it('returns the ISO date prefix of the UTC timestamp', () => {
    expect(utcDayOf(new Date('2026-01-05T23:59:59Z'))).toBe('2026-01-05');
    expect(utcDayOf(new Date('2026-01-06T00:00:00Z'))).toBe('2026-01-06');
  });
});

describe('retentionSweepDue', () => {
  it('is not due before the target hour', () => {
    expect(retentionSweepDue(new Date('2026-01-05T03:59:59Z'), 4, null)).toBe(false);
  });

  it('is due at the target hour', () => {
    expect(retentionSweepDue(new Date('2026-01-05T04:00:00Z'), 4, null)).toBe(true);
  });

  it('is still due hours after the target hour: a late wake re-arms, never misses', () => {
    // The gate compares the current hour with >=, not equality, so a process
    // that slept through 04:00 still owes the day its sweep at 09:30.
    expect(retentionSweepDue(new Date('2026-01-05T09:30:00Z'), 4, null)).toBe(true);
  });

  it('is not due again the same UTC day after firing', () => {
    expect(retentionSweepDue(new Date('2026-01-05T04:01:00Z'), 4, '2026-01-05')).toBe(false);
    expect(retentionSweepDue(new Date('2026-01-05T23:59:59Z'), 4, '2026-01-05')).toBe(false);
  });

  it('re-arms on the next UTC day', () => {
    expect(retentionSweepDue(new Date('2026-01-06T04:00:00Z'), 4, '2026-01-05')).toBe(true);
  });

  it('fires from midnight when utcHour is 0', () => {
    expect(retentionSweepDue(new Date('2026-01-05T00:00:00Z'), 0, '2026-01-04')).toBe(true);
  });

  it('treats the UTC day boundary exactly: 23:xx fired-day is quiet, 00:xx next day fires', () => {
    // With utcHour 0 every hour passes the gate, so the day comparison alone
    // must carry the once-per-day property across midnight.
    expect(retentionSweepDue(new Date('2026-01-05T23:59:00Z'), 0, '2026-01-05')).toBe(false);
    expect(retentionSweepDue(new Date('2026-01-06T00:01:00Z'), 0, '2026-01-05')).toBe(true);
  });
});

describe('retentionBatchVerdict', () => {
  it('continues on a full batch under budget', () => {
    expect(
      retentionBatchVerdict({
        rowsThisRun: 1000,
        maxRowsPerRun: 10_000,
        lastBatchRows: 1000,
        batchSize: 1000,
      }),
    ).toBe('continue');
  });

  it('stops caught-up on a short batch', () => {
    expect(
      retentionBatchVerdict({
        rowsThisRun: 999,
        maxRowsPerRun: 10_000,
        lastBatchRows: 999,
        batchSize: 1000,
      }),
    ).toBe('stop-caught-up');
  });

  it('stops on budget when rowsThisRun reaches or passes the cap', () => {
    expect(
      retentionBatchVerdict({
        rowsThisRun: 10_000,
        maxRowsPerRun: 10_000,
        lastBatchRows: 1000,
        batchSize: 1000,
      }),
    ).toBe('stop-budget');
    expect(
      retentionBatchVerdict({
        rowsThisRun: 10_500,
        maxRowsPerRun: 10_000,
        lastBatchRows: 1000,
        batchSize: 1000,
      }),
    ).toBe('stop-budget');
  });

  it('reads a short batch as caught up even when the budget is also spent', () => {
    // Precedence pin: the caller treats the two stops differently (caught-up
    // moves to the next realm, budget ends the whole group), so a table that
    // drains exactly as the budget runs out must report caught-up.
    expect(
      retentionBatchVerdict({
        rowsThisRun: 10_003,
        maxRowsPerRun: 10_000,
        lastBatchRows: 3,
        batchSize: 1000,
      }),
    ).toBe('stop-caught-up');
  });
});

// Shell test scaffolding. Every stub records its calls so assertions can pin
// exact call counts and ordering, mirroring the decisive-pin style of the
// keepalive sweep tests.

interface StubClient {
  client: RetentionSweepLockClient;
  queries: Array<{ text: string; values: unknown[] | undefined }>;
  releaseCount: number;
}

function stubClient(acquired = true): StubClient {
  const stub: StubClient = {
    queries: [],
    releaseCount: 0,
    client: {
      async query(text: string, values?: unknown[]) {
        stub.queries.push({ text, values });
        if (text.includes('pg_try_advisory_lock')) return { rows: [{ acquired }] };
        return { rows: [] };
      },
      release() {
        stub.releaseCount += 1;
      },
    },
  };
  return stub;
}

// A table whose pruneBatch answers from a queue, repeating the last entry once
// the queue is exhausted (so [10] means "full batches forever" and [3] means
// one short batch).
function stubTable(name: string, batches: number[], order?: string[]) {
  const calls: number[] = [];
  const table: RetentionTable = {
    name,
    async pruneBatch(batchSize: number) {
      order?.push(name);
      calls.push(batchSize);
      return batches[Math.min(calls.length - 1, batches.length - 1)] ?? 0;
    },
  };
  return { table, calls };
}

// Online-samples stub with the same repeat-last queue semantics per realm.
// Failed folds appear in `order` as attempts but never in `folds`.
function stubSamples(
  realmBatches: Record<string, number[]>,
  opts: { foldFails?: string[]; order?: string[] } = {},
) {
  const folds: string[] = [];
  const prunes: Array<{ realm: string; batchSize: number }> = [];
  const pruneCounts: Record<string, number> = {};
  const samples: RetentionOnlineSamples = {
    async listRealms() {
      return Object.keys(realmBatches);
    },
    async foldPeak(realm: string) {
      opts.order?.push(`fold:${realm}`);
      if (opts.foldFails?.includes(realm)) throw new Error(`fold failed: ${realm}`);
      folds.push(realm);
    },
    async pruneBatch(realm: string, batchSize: number) {
      opts.order?.push(`prune:${realm}`);
      prunes.push({ realm, batchSize });
      const idx = pruneCounts[realm] ?? 0;
      pruneCounts[realm] = idx + 1;
      const batches = realmBatches[realm] ?? [];
      return batches[Math.min(idx, batches.length - 1)] ?? 0;
    },
  };
  return { samples, folds, prunes };
}

function baseDeps(overrides: Partial<RetentionSweepDeps>): RetentionSweepDeps {
  return {
    connect: async () => stubClient().client,
    utcHour: 4,
    maxRowsPerRun: 1_000_000,
    batchSize: 10,
    tables: [],
    pollIntervalMs: 1_000,
    onError: () => {},
    onInfo: () => {},
    ...overrides,
  };
}

describe('createRetentionSweep', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('gates on the off-peak hour: quiet before it, one run at it, quiet after, next day re-arms', async () => {
    let now = new Date('2026-01-05T02:00:00Z');
    const connect = vi.fn(async () => stubClient().client);
    const t = stubTable('t', [0]);
    const sweep = createRetentionSweep(baseDeps({ connect, tables: [t.table], now: () => now }));
    sweep.start();

    // Three polls before 04:00 UTC: the hour gate holds and nothing connects.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(connect).not.toHaveBeenCalled();

    // The first poll at or past the hour runs exactly once.
    now = new Date('2026-01-05T04:00:10Z');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(1);

    // Later polls the same UTC day are inert: the day is marked.
    now = new Date('2026-01-05T18:00:00Z');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(connect).toHaveBeenCalledTimes(1);

    // The next UTC day re-arms.
    now = new Date('2026-01-06T04:00:10Z');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(2);
    await sweep.stop();
  });

  it('still fires once when the first poll lands hours past the target hour (late boot)', async () => {
    let now = new Date('2026-01-05T07:00:00Z');
    const connect = vi.fn(async () => stubClient().client);
    const sweep = createRetentionSweep(baseDeps({ connect, now: () => now }));
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(1);

    // Only once for the day, even though every remaining hour passes the gate.
    now = new Date('2026-01-05T11:00:00Z');
    await vi.advanceTimersByTimeAsync(4_000);
    expect(connect).toHaveBeenCalledTimes(1);
    await sweep.stop();
  });

  it('marks the day and prunes nothing when a peer holds the advisory lock', async () => {
    let now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient(false);
    const connect = vi.fn(async () => stub.client);
    const t = stubTable('t', [10]);
    const sweep = createRetentionSweep(baseDeps({ connect, tables: [t.table], now: () => now }));
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.calls).toHaveLength(0);
    expect(stub.releaseCount).toBe(1);
    // Only the try-lock ran: no unlock, because this process never held the lock.
    expect(stub.queries).toHaveLength(1);
    expect(stub.queries[0].text).toContain('pg_try_advisory_lock');

    // The miss still consumes the day: the peer that holds the lock IS today's
    // sweep, so a later poll the same day must not retry.
    now = new Date('2026-01-05T12:00:00Z');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(connect).toHaveBeenCalledTimes(1);
    await sweep.stop();
  });

  it('does not consume the day on a connect failure: the next poll retries', async () => {
    let now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient();
    const onError = vi.fn();
    const boom = new Error('db down');
    const connect = vi.fn().mockRejectedValueOnce(boom).mockResolvedValue(stub.client);
    const t = stubTable('t', [0]);
    const sweep = createRetentionSweep(
      baseDeps({ connect, tables: [t.table], now: () => now, onError }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('connect', boom);
    expect(t.calls).toHaveLength(0);

    // A down database must not eat the day: the very next poll retries and wins.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(t.calls).toHaveLength(1);

    // And now the day is marked, so a third poll is inert.
    now = new Date('2026-01-05T14:00:00Z');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(2);
    await sweep.stop();
  });

  it('sweeps tables in array order and stops a table after one short batch', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const order: string[] = [];
    const a = stubTable('a', [3], order);
    const b = stubTable('b', [2], order);
    const sweep = createRetentionSweep(baseDeps({ tables: [a.table, b.table], now: () => now }));
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // One call each: 3 < 10 and 2 < 10 both read caught-up on the first batch.
    expect(order).toEqual(['a', 'b']);
    expect(a.calls).toEqual([10]);
    expect(b.calls).toEqual([10]);
    await sweep.stop();
  });

  it('stops a table at the per-run budget when batches keep coming back full', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const t = stubTable('t', [10]); // repeat-last: full batches forever
    const sweep = createRetentionSweep(
      baseDeps({ tables: [t.table], maxRowsPerRun: 20, now: () => now }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // Two full batches reach the 20-row budget exactly; a third would be over it.
    expect(t.calls).toHaveLength(2);
    await sweep.stop();
  });

  it('a zero budget takes the lock and marks the day but issues zero batches', async () => {
    let now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient();
    const connect = vi.fn(async () => stub.client);
    const t = stubTable('t', [10]);
    const online = stubSamples({ r1: [10] });
    const sweep = createRetentionSweep(
      baseDeps({
        connect,
        tables: [t.table],
        onlineSamples: online.samples,
        maxRowsPerRun: 0,
        now: () => now,
      }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // The verdict runs BEFORE the first batch, so a zero budget means zero
    // pruneBatch calls anywhere, and no fold either (no prune would follow it).
    expect(t.calls).toHaveLength(0);
    expect(online.folds).toHaveLength(0);
    expect(online.prunes).toHaveLength(0);
    expect(stub.queries.some((q) => q.text.includes('pg_try_advisory_lock'))).toBe(true);

    // The day is still consumed: budget zero is a configuration, not a failure.
    now = new Date('2026-01-05T15:00:00Z');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(connect).toHaveBeenCalledTimes(1);
    await sweep.stop();
  });

  it('normalizes batchSize 0 to 1 instead of looping forever on empty batches', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const t = stubTable('t', [0]);
    const sweep = createRetentionSweep(
      baseDeps({ tables: [t.table], batchSize: 0, now: () => now }),
    );
    sweep.start();

    // The single terminating call is the whole point: an unnormalized LIMIT 0
    // batch deletes zero rows, zero is never short of a zero batch size, and the
    // loop would never end. Normalized, the 0-row batch reads short of 1.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.calls).toEqual([1]);
    await sweep.stop();
  });

  it('contains one table batch failure: siblings sweep, unlock rides the same client', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient();
    const boom = new Error('prune failed');
    const bad: RetentionTable = {
      name: 'bad',
      pruneBatch: async () => {
        throw boom;
      },
    };
    const good = stubTable('good', [4]);
    const onError = vi.fn();
    const sweep = createRetentionSweep(
      baseDeps({
        connect: async () => stub.client,
        tables: [bad, good.table],
        now: () => now,
        onError,
      }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onError).toHaveBeenCalledWith('bad', boom);
    expect(good.calls).toHaveLength(1);
    // The lock and unlock rode the same client object, in that order, and the
    // client went back to the pool exactly once.
    expect(stub.queries.map((q) => q.text)).toEqual([
      expect.stringContaining('pg_try_advisory_lock'),
      expect.stringContaining('pg_advisory_unlock'),
    ]);
    expect(stub.releaseCount).toBe(1);
    await sweep.stop();
  });

  it('folds a realm before its first prune', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const order: string[] = [];
    const online = stubSamples({ r1: [0] }, { order });
    const sweep = createRetentionSweep(baseDeps({ onlineSamples: online.samples, now: () => now }));
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // The fold is the precondition that makes the prune safe, so it must come
    // first for the realm.
    expect(order).toEqual(['fold:r1', 'prune:r1']);
    await sweep.stop();
  });

  it('a fold failure skips only that realm: the next realm still folds and prunes', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const order: string[] = [];
    const onError = vi.fn();
    const online = stubSamples({ r1: [0], r2: [0] }, { foldFails: ['r1'], order });
    const sweep = createRetentionSweep(
      baseDeps({ onlineSamples: online.samples, now: () => now, onError }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // r1's fold attempt failed, so r1 was never pruned this run; r2 was
    // unaffected. The next scheduled run retries r1 from its oldest rows.
    expect(order).toEqual(['fold:r1', 'fold:r2', 'prune:r2']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('online-samples:r1');
    await sweep.stop();
  });

  it('a listRealms failure skips the group but the run still counts for the day', async () => {
    let now = new Date('2026-01-05T04:00:00Z');
    const connect = vi.fn(async () => stubClient().client);
    const onError = vi.fn();
    const t = stubTable('t', [0]);
    const online: RetentionOnlineSamples = {
      listRealms: async () => {
        throw new Error('realms unavailable');
      },
      foldPeak: async () => {},
      pruneBatch: async () => 0,
    };
    const sweep = createRetentionSweep(
      baseDeps({ connect, tables: [t.table], onlineSamples: online, now: () => now, onError }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // The plain tables still swept; only the online group was skipped.
    expect(t.calls).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('online-samples');

    // The run happened, so the day is marked and no later poll retries it.
    now = new Date('2026-01-05T16:00:00Z');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(connect).toHaveBeenCalledTimes(1);
    await sweep.stop();
  });

  it('shares one budget across realms and stops later realms without folding them', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    // Budget 15, batch size 10. r1 drains with one short batch of 5 rows;
    // r2 answers full batches forever; r3 exists to prove the group ends.
    const online = stubSamples({ r1: [5], r2: [10], r3: [10] });
    const sweep = createRetentionSweep(
      baseDeps({ onlineSamples: online.samples, maxRowsPerRun: 15, now: () => now }),
    );
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    // r2 stopped after ONE batch only because r1's 5 rows counted against the
    // shared budget (5 + 10 = 15); an unshared budget would grant r2 a second
    // batch. r3 never folded: a spent budget stops the group before the fold,
    // because no prune would follow it.
    expect(online.folds).toEqual(['r1', 'r2']);
    expect(online.prunes.map((p) => p.realm)).toEqual(['r1', 'r2']);
    await sweep.stop();
  });

  it('logs one summary line only when rows were pruned', async () => {
    let now = new Date('2026-01-05T04:00:00Z');
    const onInfo = vi.fn();
    const t = stubTable('t', [7, 0]); // day one prunes 7 rows, day two finds none
    const sweep = createRetentionSweep(baseDeps({ tables: [t.table], now: () => now, onInfo }));
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onInfo).toHaveBeenCalledTimes(1);
    expect(onInfo).toHaveBeenCalledWith('retention sweep pruned 7 rows');

    // A quiet night stays quiet: the zero-row run logs nothing.
    now = new Date('2026-01-06T04:00:00Z');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.calls).toHaveLength(2);
    expect(onInfo).toHaveBeenCalledTimes(1);
    await sweep.stop();
  });

  it('coalesces polls while a run is in flight instead of stacking runs', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient();
    let resolveConnect!: (client: RetentionSweepLockClient) => void;
    const connect = vi.fn(
      () =>
        new Promise<RetentionSweepLockClient>((resolve) => {
          resolveConnect = resolve;
        }),
    );
    const sweep = createRetentionSweep(baseDeps({ connect, now: () => now }));
    sweep.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(1);

    // Three more polls land while the run hangs on connect: the in-flight guard
    // coalesces them all, so no second run stacks on the same budget.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(connect).toHaveBeenCalledTimes(1);

    resolveConnect(stub.client);
    await sweep.stop();
    expect(stub.releaseCount).toBe(1);
  });

  it('stops the poll loop: no runs fire after stop()', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const connect = vi.fn(async () => stubClient().client);
    const sweep = createRetentionSweep(baseDeps({ connect, now: () => now }));
    sweep.start();
    await sweep.stop();

    // The clock is due the whole time; only the cleared interval keeps it quiet.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(connect).not.toHaveBeenCalled();
  });

  it('stop() settles only after an in-flight run finishes, and the unlock still ran', async () => {
    const now = new Date('2026-01-05T04:00:00Z');
    const stub = stubClient();
    let resolveBatch!: (rows: number) => void;
    const t: RetentionTable = {
      name: 't',
      pruneBatch: () =>
        new Promise<number>((resolve) => {
          resolveBatch = resolve;
        }),
    };
    const sweep = createRetentionSweep(
      baseDeps({ connect: async () => stub.client, tables: [t], now: () => now }),
    );
    sweep.start();

    // The run is now blocked inside its first batch.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(stub.queries.some((q) => q.text.includes('pg_try_advisory_lock'))).toBe(true);

    let settled = false;
    const stopping = sweep.stop().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    // stop() must wait for the run: a prune query racing pool.end() at shutdown
    // is exactly what the await exists to prevent.
    expect(settled).toBe(false);

    resolveBatch(0); // the short batch lets the run finish and unlock
    await stopping;
    expect(settled).toBe(true);
    expect(stub.queries.some((q) => q.text.includes('pg_advisory_unlock'))).toBe(true);
    expect(stub.releaseCount).toBe(1);
  });
});
