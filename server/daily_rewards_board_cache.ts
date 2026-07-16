// The daily-rewards board cache: one TTL-cached ranked snapshot (the full
// eligible positive-scorer list for one reward day, from
// DailyRewardDb.leaderboardSnapshot) serves the four ranked reads a player
// status assembles: the leaderboard top slice, leaderboardTotal,
// rankForAccount, and leaderboardRowForAccount. Every derivation comes from
// that ONE snapshot, never a second query.
//
// Bust doctrine: every board-changing write in this process busts the cache,
// and main.ts wires the moderation hook to bust it too, so in-process
// delisting/relisting and fresh ranks are immediate here; peer realm
// processes converge within one TTL, the same tradeoff the other public
// board caches made in main.ts. Two read-side flips have no write anywhere
// to hook and are accepted as TTL-bounded staleness by the same tradeoff
// (never chase either with a timer or a poll): a timed daily-reward ban
// expiring (the expires_at predicate inside the excluded-accounts view), and
// an account's first login or play session from an already-banned IP joining
// the view's IP arm.
//
// cached_read has no day concept, so the day-mismatch-as-miss logic lives
// here: the snapshot carries the day it was fetched for, and a reader for
// any other day busts and refreshes rather than serving yesterday's board
// across the rollover.

import { type CachedRead, createCachedRead } from './cached_read';
import type { DailyRewardScoreRow } from './daily_rewards_db';

// Same 30s staleness ceiling as the other public board caches (main.ts
// LEADERBOARD_TTL_MS); a local constant because this module never imports
// main.ts.
export const DAILY_REWARD_BOARD_TTL_MS = 30_000;

interface BoardSnapshot {
  day: string;
  rows: DailyRewardScoreRow[];
}

export class DailyRewardBoardCache {
  // The day the next refresh fetches; the refresh closure captures it before
  // its first await, so a snapshot always carries the day it was fetched for.
  private targetDay = '';
  private readonly cache: CachedRead<BoardSnapshot>;
  // Refresh telemetry: unlike the fixed-cadence main.ts board warmers, this
  // cache refreshes on demand after busts, so its query rate is bust rate
  // times status arrival rate; these counters make that rate observable
  // (metrics export wires them up later, the getPoolClientErrorCount shape).
  private refreshes = 0;
  private lastRefreshMs: number | null = null;

  constructor(
    private readonly fetchSnapshot: (day: string) => Promise<DailyRewardScoreRow[]>,
    opts?: { ttlMs?: number; now?: () => number },
  ) {
    const clock = opts?.now ?? Date.now;
    this.cache = createCachedRead(
      async () => {
        const day = this.targetDay;
        const startedAt = clock();
        const rows = await this.fetchSnapshot(day);
        this.refreshes += 1;
        this.lastRefreshMs = clock() - startedAt;
        return { day, rows };
      },
      { ttlMs: opts?.ttlMs ?? DAILY_REWARD_BOARD_TTL_MS, now: opts?.now },
    );
  }

  /** Successful refreshes since boot and the last refresh duration. */
  stats(): { refreshes: number; lastRefreshMs: number | null } {
    return { refreshes: this.refreshes, lastRefreshMs: this.lastRefreshMs };
  }

  private async snapshotFor(day: string): Promise<BoardSnapshot> {
    // A cached snapshot for another day is a miss, never served across the
    // rollover: bust it so the read below refreshes for the requested day.
    const cached = this.cache.peek();
    if (cached !== null && cached.day !== day) this.cache.bust();
    this.targetDay = day;
    const snapshot = await this.cache.read();
    if (snapshot.day === day) return snapshot;
    // We shared a flight aimed at another day (concurrent readers straddling
    // the rollover): leave that day's snapshot installed for its own readers
    // and serve this reader a direct, uncached read of its day instead of
    // ping-ponging the cache between the two days.
    return { day, rows: await this.fetchSnapshot(day) };
  }

  async leaderboard(day: string, limit: number): Promise<DailyRewardScoreRow[]> {
    const snapshot = await this.snapshotFor(day);
    // Mirror the db-side LIMIT clamp so cached and uncached reads bound alike.
    // Rows are copied on the way out so a caller mutating its result can
    // never poison the shared snapshot for every other reader.
    return snapshot.rows.slice(0, Math.max(1, Math.min(100, limit))).map((row) => ({ ...row }));
  }

  // The snapshot is exactly the eligible positive-scorer population the
  // uncached COUNT(*) counts, so its length IS the total.
  async leaderboardTotal(day: string): Promise<number> {
    return (await this.snapshotFor(day)).rows.length;
  }

  async rankForAccount(day: string, accountId: number): Promise<number | null> {
    const row = (await this.snapshotFor(day)).rows.find((r) => r.accountId === accountId);
    return row ? row.rank : null;
  }

  async leaderboardRowForAccount(
    day: string,
    accountId: number,
  ): Promise<DailyRewardScoreRow | null> {
    const row = (await this.snapshotFor(day)).rows.find((r) => r.accountId === accountId);
    // Copied on the way out, same reason as leaderboard().
    return row ? { ...row } : null;
  }

  bust(): void {
    this.cache.bust();
  }
}
