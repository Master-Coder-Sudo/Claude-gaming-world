// ClientWorld.deedsRarity: the online facet arm is a lazy anonymous REST read
// with a hard null-on-failure contract (the window hides the rarity slot on
// null), so every failure arm gets its own pin: non-ok status, malformed
// payload (including a null earned map), and a rejecting fetch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';

// The xp.test.ts bare-prototype idiom: deedsRarity reads only `base`, so no
// socket or snapshot machinery is needed.
function bareClient(): ClientWorld {
  const c = Object.create(ClientWorld.prototype) as ClientWorld;
  (c as unknown as { base: string }).base = '';
  return c;
}

function stubFetch(response: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ClientWorld.deedsRarity', () => {
  it('resolves the endpoint payload verbatim on a 200, hitting the anonymous route', async () => {
    const payload = { totalEligible: 120, earned: { prog_veteran: 30 } };
    const mock = stubFetch({ ok: true, json: async () => payload });
    await expect(bareClient().deedsRarity()).resolves.toEqual(payload);
    // Anonymous by design: one positional URL argument, no headers object.
    expect(mock).toHaveBeenCalledWith('/api/deeds/rarity');
  });

  it('resolves null on a non-ok status', async () => {
    stubFetch({ ok: false, status: 429, json: async () => ({ error: 'rate limited' }) });
    await expect(bareClient().deedsRarity()).resolves.toBeNull();
  });

  it('resolves null on a malformed payload (wrong shape, and a null earned map)', async () => {
    stubFetch({ ok: true, json: async () => ({ hello: 'world' }) });
    await expect(bareClient().deedsRarity()).resolves.toBeNull();
    stubFetch({ ok: true, json: async () => ({ totalEligible: 5, earned: null }) });
    await expect(bareClient().deedsRarity()).resolves.toBeNull();
  });

  it('resolves null (never rejects) when the fetch itself throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await expect(bareClient().deedsRarity()).resolves.toBeNull();
  });
});
