import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return { query: vi.fn() };
});

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: dbMock.query };
  }),
}));

import { loadMarketState, marketStateKey, saveMarketState } from '../server/db';
import { REALM } from '../server/realm';

beforeEach(() => {
  dbMock.query.mockReset();
});

describe('market state realm scoping', () => {
  it('keys the market on the realm, never the bare shared "market" row', () => {
    // The bare 'market' key is shared across every realm process pointed at the
    // same DATABASE_URL, so two realms would clobber each other. Each realm must
    // get its own namespaced key.
    expect(marketStateKey(REALM)).toBe(`market:${REALM}`);
    expect(marketStateKey('Ironforge')).toBe('market:Ironforge');
    expect(marketStateKey('Stormhaven')).toBe('market:Stormhaven');
    expect(marketStateKey('Ironforge')).not.toBe(marketStateKey('Stormhaven'));
  });

  it('saves under the realm-scoped key', async () => {
    dbMock.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const save = { listings: [], collections: [], nextListingId: 1 } as never;
    await saveMarketState(save);

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('INTO world_state');
    expect(params[0]).toBe(`market:${REALM}`);
  });

  it('loads the realm-scoped row when it exists, untouched', async () => {
    const own = { listings: [{ id: 7 }], collections: [], nextListingId: 8 };
    dbMock.query.mockResolvedValueOnce({ rows: [{ data: own }] });

    const loaded = await loadMarketState();

    expect(loaded).toEqual(own);
    // exactly one read, keyed to this realm; no legacy fallback, no write-back
    expect(dbMock.query).toHaveBeenCalledTimes(1);
    expect(dbMock.query.mock.calls[0][1][0]).toBe(`market:${REALM}`);
  });

  it('migrates the legacy shared "market" row into the realm key on first boot', async () => {
    const legacy = { listings: [{ id: 3 }], collections: [], nextListingId: 4 };
    // realm-scoped key absent, legacy bare key present
    dbMock.query
      .mockResolvedValueOnce({ rows: [] }) // SELECT market:<realm>
      .mockResolvedValueOnce({ rows: [{ data: legacy }] }) // SELECT market
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT market:<realm>

    const loaded = await loadMarketState();

    expect(loaded).toEqual(legacy);
    // the legacy listings are copied into this realm's key so they are not stranded
    const writeCall = dbMock.query.mock.calls[2];
    expect(writeCall[0]).toContain('INTO world_state');
    expect(writeCall[1][0]).toBe(`market:${REALM}`);
    expect(writeCall[1][1]).toBe(JSON.stringify(legacy));
    // the legacy read targeted the bare shared key
    expect(dbMock.query.mock.calls[1][1][0]).toBe('market');
  });

  it('returns null and writes nothing when neither key exists', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [] }) // SELECT market:<realm>
      .mockResolvedValueOnce({ rows: [] }); // SELECT market

    const loaded = await loadMarketState();

    expect(loaded).toBeNull();
    expect(dbMock.query).toHaveBeenCalledTimes(2); // no write-back
  });
});
