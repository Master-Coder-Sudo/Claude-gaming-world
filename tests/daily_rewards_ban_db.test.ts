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

  it('resolves account and IP restrictions through the exclusion view', async () => {
    mocks.query.mockResolvedValue({ rows: [{ reason: 'shared IP abuse' }] });
    await expect(new PgDailyRewardDb().banForAccount(9)).resolves.toEqual({
      reason: 'shared IP abuse',
    });
    expect(mocks.query.mock.calls[0][0]).toContain('daily_reward_excluded_accounts');
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

    await new PgDailyRewardDb().addPoints('2026-07-11', 9, 'online', 0, 'online:2026-07-11T12:00');

    const scoreUpsert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO daily_reward_scores'),
    );
    // The bump is conditioned on positive points and preserves the prior
    // timestamp otherwise; it is never an unconditional updated_at = now().
    expect(scoreUpsert?.[0]).toContain('WHEN EXCLUDED.points > 0 THEN now()');
    expect(scoreUpsert?.[0]).toContain('ELSE daily_reward_scores.updated_at');
    expect(scoreUpsert?.[0]).not.toMatch(/updated_at = now\(\)/);
  });
});
