import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));

// Partial-mock server/db: swap the pool for the capture mock but keep the real
// ELIGIBLE_ACCOUNT_SQL fragment the board reads embed alongside the ban filter.
vi.mock('../server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/db')>();
  return { ...actual, pool: mocks };
});
vi.mock('../server/realm', () => ({ REALM: 'test-realm' }));

import { PgDailyRewardDb } from '../server/daily_rewards_db';
import { ELIGIBLE_ACCOUNT_SQL } from '../server/db';

describe('Daily Rewards ban query enforcement', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.connect.mockReset();
  });

  it('resolves active account and IP restrictions with account-ban expiry', async () => {
    mocks.query.mockResolvedValue({
      rows: [{ reason: 'shared IP abuse', expires_at: '2026-07-16T03:00:00.000Z' }],
    });
    await expect(new PgDailyRewardDb().banForAccount(9)).resolves.toEqual({
      reason: 'shared IP abuse',
      expiresAt: '2026-07-16T03:00:00.000Z',
    });
    expect(mocks.query.mock.calls[0][0]).toContain('daily_reward_bans');
    expect(mocks.query.mock.calls[0][0]).toContain('expires_at > now()');
    expect(mocks.query.mock.calls[0][0]).toContain('daily_reward_ip_bans');
  });

  it('filters banned accounts from current leaderboard reads and pending payouts', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const db = new PgDailyRewardDb();

    await db.leaderboard('2026-07-11', 1, 10);
    await db.pendingPayouts(20);

    expect(mocks.query.mock.calls[0][0]).toContain('NOT EXISTS');
    expect(mocks.query.mock.calls[0][0]).toContain('daily_reward_excluded_accounts');
    expect(mocks.query.mock.calls[1][0]).toContain('NOT EXISTS');
    expect(mocks.query.mock.calls[1][0]).toContain('daily_reward_excluded_accounts');
    // Pay-time recheck: a ban or suspension landing after finalization still
    // blocks the payout row.
    expect(mocks.query.mock.calls[1][0]).toContain(ELIGIBLE_ACCOUNT_SQL);
    expect(mocks.query.mock.calls[1][0]).toContain('a.id = p.account_id');
  });

  it('filters banned accounts while selecting end-of-day winners', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });
    const release = vi.fn();
    mocks.connect.mockResolvedValue({ query, release });

    await new PgDailyRewardDb().finalizeDay('2026-07-11', 150, [1]);

    const winnerQuery = query.mock.calls.find(([sql]) =>
      String(sql).includes('FROM daily_reward_scores s'),
    );
    expect(winnerQuery?.[0]).toContain('NOT EXISTS');
    expect(winnerQuery?.[0]).toContain('daily_reward_excluded_accounts');
    // Winner selection uses the same account-eligibility predicate as the
    // displayed board, so the payout ranks match what players see.
    expect(winnerQuery?.[0]).toContain(ELIGIBLE_ACCOUNT_SQL);
    expect(winnerQuery?.[0]).toContain('a.id = s.account_id');
    expect(release).toHaveBeenCalledOnce();
  });

  it('prevents point and spin writes after a ban races an eligibility check', async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const transactionQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [] });
    mocks.connect.mockResolvedValue({ query: transactionQuery, release: vi.fn() });
    const db = new PgDailyRewardDb();

    await db.recordSpin('2026-07-11', 9, 's20', 20);
    await db.addPoints('2026-07-11', 9, 'task', 10, 'task:1');

    expect(mocks.query.mock.calls[0][0]).toContain('WHERE NOT EXISTS');
    expect(transactionQuery.mock.calls[1][0]).toContain('WHERE NOT EXISTS');
  });
});

describe('Daily Rewards finalize read and score writes', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.connect.mockReset();
  });

  it('reads the finalized flag using the realm argument, not the module realm', async () => {
    mocks.query.mockResolvedValue({ rows: [{ ok: 1 }], rowCount: 1 });

    const finalized = await new PgDailyRewardDb().dayFinalized('2026-07-01', 'other-realm');

    expect(finalized).toBe(true);
    expect(mocks.query.mock.calls[0][0]).toContain('finalized_at IS NOT NULL');
    // The bound params come from the arguments, never the mocked module REALM
    // ('test-realm'), so the guard's realm and the query's realm cannot diverge.
    expect(mocks.query.mock.calls[0][1]).toEqual(['2026-07-01', 'other-realm']);
  });

  it('reports a day with no finalized row as not finalized', async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(new PgDailyRewardDb().dayFinalized('2026-07-01', 'test-realm')).resolves.toBe(
      false,
    );
  });

  it('refreshes the score updated_at only when the incoming points are nonzero', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // event insert proceeds
      .mockResolvedValueOnce({ rows: [] }) // score UPSERT
      .mockResolvedValue({ rows: [] }); // COMMIT
    mocks.connect.mockResolvedValue({ query, release: vi.fn() });

    await new PgDailyRewardDb().addPoints('2026-07-11', 9, 'task', 10, 'task:1');

    const scoreUpsert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO daily_reward_scores'),
    );
    // The bump is conditioned on positive points and preserves the prior
    // timestamp otherwise; it is never an unconditional updated_at = now().
    expect(scoreUpsert?.[0]).toContain('WHEN EXCLUDED.points > 0 THEN now()');
    expect(scoreUpsert?.[0]).toContain('ELSE daily_reward_scores.updated_at');
    expect(scoreUpsert?.[0]).not.toMatch(/updated_at = now\(\)/);
  });

  it('skips the score write entirely for zero-point events', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // event insert proceeds
      .mockResolvedValue({ rows: [] }); // COMMIT
    mocks.connect.mockResolvedValue({ query, release: vi.fn() });

    const recorded = await new PgDailyRewardDb().addPoints(
      '2026-07-11',
      9,
      'online',
      0,
      'online:2026-07-11T12:00',
    );

    // The event row still lands (it is the online-minutes ledger and the
    // idempotency gate), but no daily_reward_scores statement is issued at all:
    // nothing reads a zero score row (every ranked read filters points > 0 and
    // scoreForAccount defaults to 0), so the skip removes one score-row write
    // per online player per minute.
    expect(recorded).toBe(true);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes('daily_reward_events'))).toBe(true);
    expect(statements.some((sql) => sql.includes('daily_reward_scores'))).toBe(false);
    expect(statements).toContain('COMMIT');
  });

  it('stops rewriting the prize pool once the day is finalized', async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await new PgDailyRewardDb().ensureDay('2026-07-11', 150, 0.5);

    const sql = String(mocks.query.mock.calls[0][0]);
    // The conflict update is fenced on the unfinalized day: after finalizeDay
    // stamps finalized_at, a straggler previous-day event can no longer drift
    // the announced prize pool away from its finalize-time value.
    expect(sql).toContain('ON CONFLICT (day, realm) DO UPDATE');
    expect(sql).toContain('WHERE daily_reward_days.finalized_at IS NULL');
    expect(mocks.query.mock.calls[0][1]).toEqual(['2026-07-11', 'test-realm', 150, 0.5]);
  });
});
