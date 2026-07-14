// Crafting materials must never be vendor junk. The "sell junk" sweep (items.ts
// sellJunk) vendors every quality:'poor' item, so any material used as a recipe
// reagent has to be common (white), not 'poor'. This guard enforces it across the
// crafting recipes (ALL_RECIPES) and the enchanting recipes (ENCHANTS), so a future
// material added as grey junk fails here instead of getting auto-vendored in game.
import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';

function reagentIds(): string[] {
  const ids = new Set<string>();
  for (const r of ALL_RECIPES) for (const rg of r.reagents ?? []) ids.add(rg.itemId);
  for (const e of Object.values(ENCHANTS)) for (const rg of e.reagents ?? []) ids.add(rg.itemId);
  return [...ids];
}

describe('crafting materials are not vendor junk', () => {
  it('every recipe / enchant reagent resolves to a real item', () => {
    const missing = reagentIds().filter((id) => !ITEMS[id]);
    expect(missing, `reagents with no ITEMS def: ${missing.join(', ')}`).toEqual([]);
  });

  it('no crafting-material reagent is quality "poor" (would be auto-vendored as junk)', () => {
    const poor = reagentIds().filter((id) => ITEMS[id]?.quality === 'poor');
    expect(poor, `these reagents would be swept by "sell junk": ${poor.join(', ')}`).toEqual([]);
  });

  it('material reagents (kind "junk") are common/white, not a rarity colour', () => {
    // Tools (kind 'tool') are equipment, not materials, so they keep their tier
    // rarity. Only the consumable materials (the repo reuses the 'junk' kind for
    // them) are forced to white.
    const offenders = reagentIds()
      .map((id) => ITEMS[id])
      .filter((it) => it && it.kind === 'junk' && (it.quality ?? 'common') !== 'common')
      .map((it) => `${it!.id}=${it!.quality}`);
    expect(offenders, `material reagents that are not white: ${offenders.join(', ')}`).toEqual([]);
  });
});
