import { describe, expect, it } from 'vitest';
import {
  createRealmReadoutMemo,
  realmReadoutJson,
  realmReadoutObject,
} from '../../server/realm_readout_memo';
import type { VcSharedCupInfo } from '../../src/world_api/vale_cup';

// A plain VcSharedCupInfo-shaped literal built locally: the memo is payload-agnostic,
// so the test never imports cupSharedInfoFor. Slot 3 of queueSizes carries the value
// we mutate between ticks to prove a stale-tick string is never served.
const sample = (): VcSharedCupInfo => ({
  queueSizes: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 0 },
  live: null,
  board: [{ name: 'A', wins: 3 }],
  guildBoard: [],
  practicing: ['B'],
});

describe('realm readout per-pass memo', () => {
  it('starts fully zeroed', () => {
    expect(createRealmReadoutMemo()).toEqual({
      tick: -1,
      shared: null,
      json: null,
      objectBuilds: 0,
      stringifies: 0,
    });
  });

  it('builds and stringifies the shared readout at most once per tick', () => {
    const memo = createRealmReadoutMemo();
    // Injected spy build thunk: real builds bump `builds`; the tick-6 build returns a
    // different queueSizes so case 5 can prove the tick-6 string reflects the tick-6 object.
    let builds = 0;
    const build = (): VcSharedCupInfo => {
      builds++;
      return builds === 1
        ? sample()
        : { ...sample(), queueSizes: { 1: 0, 2: 0, 3: 9, 4: 0, 5: 0 } };
    };

    // Case 2: first object read at tick 5 builds exactly once and returns the payload.
    const obj5 = realmReadoutObject(memo, 5, build);
    expect(obj5).toEqual(sample());
    expect(memo.objectBuilds).toBe(1);
    expect(builds).toBe(1);

    // Case 3: first JSON read at tick 5 stringifies exactly once; a repeat does not.
    const json5 = realmReadoutJson(memo, 5, build);
    expect(memo.stringifies).toBe(1);
    expect(JSON.parse(json5)).toEqual(obj5);
    realmReadoutJson(memo, 5, build);
    expect(memo.stringifies).toBe(1);

    // Case 4: repeated object/JSON reads at the SAME tick 5 recompute NEITHER. Dropping
    // the short-circuit entirely (always rebuild) reds this case: every repeated call
    // would rebuild (objectBuilds/builds would climb past 1). NOTE the narrower mutation
    // of dropping ONLY the `memo.tick !== tick` operand (leaving `memo.shared === null`)
    // does NOT red here, because memo.shared is already set; that mutation is caught by
    // case 5 instead (a new tick would never rebuild).
    realmReadoutObject(memo, 5, build);
    realmReadoutObject(memo, 5, build);
    realmReadoutJson(memo, 5, build);
    expect(memo.objectBuilds).toBe(1);
    expect(memo.stringifies).toBe(1);
    expect(builds).toBe(1);

    // Case 5: a different tick 6 rebuilds the object and restringifies. Dropping the
    // `memo.tick !== tick` operand reds THIS case (a new tick would never rebuild, so
    // objectBuilds would stay 1 instead of reaching 2). The tick-6 build returns
    // queueSizes slot 3 === 9; JSON.parse of the tick-6 string must show 9, proving the
    // rebuild invalidated the cached JSON and a stale-tick string is never served.
    const obj6 = realmReadoutObject(memo, 6, build);
    expect(memo.objectBuilds).toBe(2);
    expect(obj6.queueSizes[3]).toBe(9);
    const json6 = realmReadoutJson(memo, 6, build);
    expect(memo.stringifies).toBe(2);
    expect(JSON.parse(json6).queueSizes[3]).toBe(9);
  });
});
