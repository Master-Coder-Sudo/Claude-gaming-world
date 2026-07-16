// Unit pins for dailyRewardEventsCutoffDay, the retention cutoff derivation for
// the daily_reward_events ledger. It was extracted from the sweep wiring in
// server/main.ts precisely so this test can exist: main.ts cannot be imported,
// and a sign flip in the cutoff would mass-delete the audit ledger with every
// other test green (a future cutoff makes the prune's `day < $1` match every row).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  dailyRewardEventsCutoffDay,
  resetDailyRewardEventsCutoffMemoForTests,
  resetDailyRewardPriceCacheForTests,
} from '../server/daily_rewards';

// 2026-07-16T12:00:00Z sits BEFORE the built-in 21:00 UTC day start, so the
// reward day for this instant is '2026-07-15' (the reward clock subtracts the
// day-start offset before taking the calendar date).
const NOW = new Date('2026-07-16T12:00:00Z');
const REWARD_DAY = '2026-07-15';
// Same UTC calendar day as NOW, but PAST the 21:00 UTC day start: the reward
// day for this instant is '2026-07-16'. The pair straddles the boundary, which
// is what makes the memo observable (a memo hit and a fresh derivation return
// DIFFERENT cutoffs).
const LATER = new Date('2026-07-16T22:00:00Z');

const originalServiceUrl = process.env.WOC_DAILY_REWARD_SERVICE_URL;

beforeEach(() => {
  // Hermetic: with no service URL, dailyRewardRuntimeConfig never fetches and
  // falls back to the built-in config (21:00 UTC day start). Reset BOTH module
  // caches so no cached config or memoized cutoff leaks between tests.
  delete process.env.WOC_DAILY_REWARD_SERVICE_URL;
  resetDailyRewardPriceCacheForTests();
  resetDailyRewardEventsCutoffMemoForTests();
});

afterAll(() => {
  if (originalServiceUrl === undefined) delete process.env.WOC_DAILY_REWARD_SERVICE_URL;
  else process.env.WOC_DAILY_REWARD_SERVICE_URL = originalServiceUrl;
});

describe('dailyRewardEventsCutoffDay', () => {
  it('returns null for zero, negative, and NaN retention (keep forever)', async () => {
    // 0 and negative are the documented keep-forever contract; NaN is config
    // garbage and must fail toward keeping the ledger, never toward deleting it.
    expect(await dailyRewardEventsCutoffDay(0, NOW)).toBeNull();
    expect(await dailyRewardEventsCutoffDay(-1, NOW)).toBeNull();
    expect(await dailyRewardEventsCutoffDay(Number.NaN, NOW)).toBeNull();
  });

  it('clamps a fractional retention to one full day, never a cutoff of today', async () => {
    // Math.floor(0.5) is 0, and a zero-day offset would return the current
    // reward day itself as the cutoff: `day < today` matches every ledger row
    // before today. The clamp makes the smallest live retention one day, so
    // 0.5 days from NOW is one day before '2026-07-15'.
    expect(await dailyRewardEventsCutoffDay(0.5, NOW)).toBe('2026-07-14');
  });

  it('derives the cutoff on the reward clock: 400 days before the current reward day', async () => {
    // Pinned literal: 400 reward days before '2026-07-15'. Verified by hand:
    // 365 days back is '2025-07-15' (2026 is not a leap year), 35 more is
    // '2025-06-10'.
    expect(await dailyRewardEventsCutoffDay(400, NOW)).toBe('2025-06-10');
  });

  it('memoizes per UTC day: a same-day call past the reward boundary returns the memoized cutoff', async () => {
    // The memo exists because currentDailyRewardDay resolves runtime config for
    // both the provisional UTC day and the reward day against a single-slot
    // config cache: at the sweep hour the two days always differ, so every
    // uncached call can cost two payout-service round trips, multiplied across
    // a catch-up run's batches. Observable proof of the hit: at 22:00Z the
    // reward day has rolled to '2026-07-16' and a fresh derivation would return
    // '2025-06-11', so getting '2025-06-10' back shows the second call never
    // re-resolved the reward clock.
    expect(await dailyRewardEventsCutoffDay(400, NOW)).toBe('2025-06-10');
    expect(await dailyRewardEventsCutoffDay(400, LATER)).toBe('2025-06-10');
  });

  it('resetDailyRewardEventsCutoffMemoForTests clears the memo', async () => {
    expect(await dailyRewardEventsCutoffDay(400, NOW)).toBe('2025-06-10');
    resetDailyRewardEventsCutoffMemoForTests();
    // With the memo cleared, the same 22:00Z call re-resolves the clock, sees
    // the rolled reward day '2026-07-16', and returns the one-day-later cutoff.
    expect(await dailyRewardEventsCutoffDay(400, LATER)).toBe('2025-06-11');
  });

  it('misses the memo for a different retention on the same UTC day', async () => {
    // Prime the memo at 12:00Z with 400 days.
    expect(await dailyRewardEventsCutoffDay(400, NOW)).toBe('2025-06-10');
    // 300 days on the same UTC day must miss (the clamped day count is part of
    // the key) and re-resolve the clock at 22:00Z: 300 days before the rolled
    // reward day '2026-07-16' is '2025-09-19'. A day-only memo key would have
    // returned the stale 400-day cutoff instead.
    expect(await dailyRewardEventsCutoffDay(300, LATER)).toBe('2025-09-19');
  });

  it('returns a cutoff strictly before the current reward day (the sign tripwire)', async () => {
    // The mass-delete hazard this module exists to pin: a sign flip in the
    // offset would put the cutoff in the FUTURE, and the prune's `day < $1`
    // would then match every row in the ledger. Lexicographic order is date
    // order for YYYY-MM-DD strings.
    const clamped = await dailyRewardEventsCutoffDay(0.5, NOW);
    const normal = await dailyRewardEventsCutoffDay(400, NOW);
    for (const cutoff of [clamped, normal]) {
      expect(cutoff).not.toBeNull();
      expect((cutoff as string) < REWARD_DAY).toBe(true);
    }
  });
});
