// Entering a dungeon must never put a mob within aggro range of the arrival point:
// zoning in should never pull a pack. Mob aggro radius is clamped to at most 20 yards
// (mob/locomotion.ts: Math.min(20, template.aggroRadius + leveldiff * 1.5)), so a
// spawn strictly beyond 20 yards from the entry can never aggro on arrival, at any
// level difference (this is what bites heroic, where mobs pin to level 20). This guard
// pins that clearance so a future spawn edit or entry move can't reintroduce the pull.
import { describe, expect, it } from 'vitest';
import { DUNGEONS, MOBS } from '../src/sim/data';

// The upper clamp on aggro radius in mob/locomotion.ts. A spawn farther than this from
// the entry cannot aggro the player the instant they arrive, regardless of level diff.
const MAX_AGGRO_RADIUS = 20;

describe('dungeon entry clearance: zoning in never aggros a pack', () => {
  for (const dungeon of Object.values(DUNGEONS)) {
    const spawns = dungeon.spawns ?? [];
    if (spawns.length === 0) continue; // e.g. the Nythraxis attunement crypt has no spawns
    it(`${dungeon.id}: no spawn within ${MAX_AGGRO_RADIUS} yd of the entry`, () => {
      for (const s of spawns) {
        const dist = Math.hypot(s.x - dungeon.entry.x, s.z - dungeon.entry.z);
        expect(
          dist,
          `${dungeon.id}: ${s.mobId} at (${s.x},${s.z}) is ${dist.toFixed(1)} yd from entry ` +
            `(${dungeon.entry.x},${dungeon.entry.z}), within aggro range`,
        ).toBeGreaterThanOrEqual(MAX_AGGRO_RADIUS);
      }
    });
  }
});
