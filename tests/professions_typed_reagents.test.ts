// Professions 2.0 Phase 13: the typed disenchant secondaries and the generic
// bind-on-trade primitive they are the first consumer of.
//
// Covers three seams: the def -> material mapping (disenchant_reagents.ts
// typedSecondaryFor), the rare+ yield model on resolveDisenchant
// (professions/enchanting.ts), and the trade-lock behavior on the player trade
// (social/trade.ts). Draw counts are pinned through the Rng observer seam so
// the rng-draw-order claims (sub-rare one draw, rare zero, epic/legendary one)
// are decisive rather than incidental.

import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import { CRAFT_THROTTLE_MAX_PER_WINDOW } from '../src/sim/professions/action_throttle';
import { typedSecondaryFor } from '../src/sim/professions/disenchant_reagents';
import { disenchantYield, resolveDisenchant } from '../src/sim/professions/enchanting';
import { Sim } from '../src/sim/sim';
import * as tradeMod from '../src/sim/social/trade';
import type { ItemDef, ItemInstancePayload } from '../src/sim/types';

const TYPED_MATERIALS = [
  'resonant_thread',
  'resonant_hide',
  'resonant_links',
  'resonant_steel',
  'resonant_timber',
] as const;

function makeSim(seed = 7) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

// Run `fn` with a draw-counting observer installed on the shared rng, returning
// the result plus the exact number of rng draws it performed. The observer is
// pure (rng.ts) and never affects the returned values or the stream state.
function countDraws<T>(sim: Sim, fn: () => T): { result: T; draws: number } {
  let draws = 0;
  sim.ctx.rng.setObserver(() => {
    draws += 1;
  });
  try {
    return { result: fn(), draws };
  } finally {
    sim.ctx.rng.setObserver(null);
  }
}

function slotFor(sim: Sim, pid: number, itemId: string) {
  return sim.ctx.resolve(pid)?.meta.inventory.find((s) => s.itemId === itemId);
}

describe('typed disenchant secondary mapping (disenchant_reagents.ts)', () => {
  it('keys the secondary by material: armor class, weapon family, and the unclassified fallback', () => {
    const expectSecondary = (id: string, expected: string) =>
      expect(typedSecondaryFor(ITEMS[id]), id).toBe(expected);
    // Armor by armor class.
    expectSecondary('gravewoven_raiment', 'resonant_thread'); // cloth chest
    expectSecondary('cryptstalker_jerkin', 'resonant_hide'); // leather chest
    expectSecondary('boundstone_helm', 'resonant_links'); // mail helmet
    // Melee weapon families -> steel.
    expectSecondary('valeborn_spellblade', 'resonant_steel'); // sword
    expectSecondary('arcanite_war_axe', 'resonant_steel'); // axe
    expectSecondary('moggers_shiv', 'resonant_steel'); // dagger
    expectSecondary('moggers_copper_cudgel', 'resonant_steel'); // mace
    expectSecondary('tidereaver_gaff', 'resonant_steel'); // polearm
    // Caster/ranged haft-and-stock families -> timber. Staff and wand are the
    // mandatory pins for the maintainer-resolved "staves/wands sit in the WEAPON
    // (timber) bucket" decision; bow and crossbow share the same timber bucket
    // (disenchant_reagents.ts TIMBER_WEAPON_TYPES) for forward completeness but
    // no shipped weapon item classifies as one, so there is no real id to pin.
    expectSecondary('gravecaller_staff', 'resonant_timber'); // staff
    expectSecondary('drowned_tide_scepter', 'resonant_timber'); // wand
    // A weapon with no WEAPON_TYPE_BY_ITEM classification falls back to steel.
    const unclassified = {
      id: 'phase13_unclassified_weapon',
      name: 'x',
      kind: 'weapon',
      quality: 'rare',
      slot: 'mainhand',
      sellValue: 0,
      weapon: { min: 1, max: 2, speed: 2 },
    } as unknown as ItemDef;
    expect(typedSecondaryFor(unclassified)).toBe('resonant_steel');
  });

  it('yields no typed secondary below rare, nor for a piece with no typed material (jewelry)', () => {
    expect(typedSecondaryFor(ITEMS.eastbrook_arming_sword)).toBeNull(); // common weapon
    expect(typedSecondaryFor(ITEMS.roadwardens_helm)).toBeNull(); // uncommon armor
    // A rare necklace/ring is disenchantable but carries no armor class, so the
    // mapper returns null (the disenchant grants the primary only, no draw).
    const rareJewelry = Object.values(ITEMS).find(
      (d) => d.kind === 'armor' && (d.slot === 'neck' || d.slot === 'ring') && d.quality === 'rare',
    );
    if (rareJewelry) expect(typedSecondaryFor(rareJewelry)).toBeNull();
  });

  it('no dead-end reagents: every typed secondary the mapper can produce is an enchant reagent', () => {
    // Derive the produced set from the real item table (not a literal list) so a
    // material that stops being produced, or an enchant that stops consuming
    // one, both trip this.
    const produced = new Set<string>();
    for (const def of Object.values(ITEMS)) {
      const sec = typedSecondaryFor(def);
      if (sec) produced.add(sec);
    }
    // All five ship (cloth/leather/mail armor and melee/caster weapons all exist).
    expect([...produced].sort()).toEqual([...TYPED_MATERIALS].sort());
    const reagentIds = new Set<string>();
    for (const enchant of Object.values(ENCHANTS)) {
      for (const r of enchant.reagents) reagentIds.add(r.itemId);
    }
    for (const mat of produced) {
      expect(ITEMS[mat], `${mat} is a shipped item`).toBeDefined();
      expect(reagentIds.has(mat), `${mat} is consumed by an enchant`).toBe(true);
    }
  });
});

describe('disenchant yield model (professions/enchanting.ts)', () => {
  it('sub-rare (uncommon) stays byte-identical: one rng draw, ladder material, no secondary', () => {
    const seed = 123;
    const id = 'roadwardens_helm'; // uncommon mail
    const sim = makeSim(seed);
    const pid = sim.playerId;
    sim.addItem(id, 1, pid);
    const { result, draws } = countDraws(sim, () => resolveDisenchant(sim.ctx, pid, id));
    expect(result.ok).toBe(true);
    // Exactly one draw: disenchantYield's +0/+1 bonus, unchanged from pre-Phase-13.
    expect(draws).toBe(1);
    expect(result.materialItemId).toBe('arcane_dust');
    expect(result.secondaryItemId).toBeUndefined();
    expect(result.secondaryCount).toBeUndefined();
    // The count equals the untouched formula against an identically-seeded rng.
    const mirror = makeSim(seed);
    mirror.addItem(id, 1, mirror.playerId);
    expect(result.count).toBe(disenchantYield(ITEMS[id], mirror.ctx.rng));
    expect(sim.countItem('arcane_dust', pid)).toBe(result.count);
    for (const mat of TYPED_MATERIALS) expect(sim.countItem(mat, pid)).toBe(0);
  });

  it('rare: exactly one arcane_essence plus one typed, bind-on-trade secondary, zero rng draws', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem('moggers_copper_cudgel', 1, pid); // rare mace -> steel
    const { result, draws } = countDraws(sim, () =>
      resolveDisenchant(sim.ctx, pid, 'moggers_copper_cudgel'),
    );
    expect(result.ok).toBe(true);
    expect(draws).toBe(0); // rare is fully fixed: no draw for primary or secondary
    expect(result.materialItemId).toBe('arcane_essence');
    expect(result.count).toBe(1);
    expect(result.secondaryItemId).toBe('resonant_steel');
    expect(result.secondaryCount).toBe(1);
    expect(sim.countItem('arcane_essence', pid)).toBe(1);
    expect(sim.countItem('resonant_steel', pid)).toBe(1);
    // The secondary is an instanced stack armed bind-on-trade, unstamped.
    const secondary = slotFor(sim, pid, 'resonant_steel');
    expect(secondary?.instance?.bindOnTrade).toBe(true);
    expect(secondary?.instance?.boundTo).toBeUndefined();
    // The primary ladder material is a plain (non-bound) stack.
    expect(slotFor(sim, pid, 'arcane_essence')?.instance).toBeUndefined();
  });

  it('epic and legendary: one arcane_shard plus one-or-two secondaries via a single rng draw', () => {
    for (const id of ['gravewyrm_cleaver', 'deathless_heartwood']) {
      const sim = makeSim();
      const pid = sim.playerId;
      sim.addItem(id, 1, pid);
      const expectedSecondary = typedSecondaryFor(ITEMS[id]);
      const { result, draws } = countDraws(sim, () => resolveDisenchant(sim.ctx, pid, id));
      expect(result.ok, id).toBe(true);
      expect(draws, id).toBe(1); // one draw decides the 1-or-2 secondary count
      expect(result.materialItemId, id).toBe('arcane_shard');
      expect(result.count, id).toBe(1);
      expect(result.secondaryItemId, id).toBe(expectedSecondary);
      expect(result.secondaryCount === 1 || result.secondaryCount === 2, id).toBe(true);
      expect(sim.countItem('arcane_shard', pid)).toBe(1);
      expect(sim.countItem(expectedSecondary as string, pid)).toBe(result.secondaryCount);
      expect(slotFor(sim, pid, expectedSecondary as string)?.instance?.bindOnTrade).toBe(true);
    }
  });

  it('is deterministic: the same seed yields the same secondary count (all rng via ctx.rng)', () => {
    const run = () => {
      const sim = makeSim(999);
      const pid = sim.playerId;
      sim.addItem('gravewyrm_cleaver', 1, pid);
      return resolveDisenchant(sim.ctx, pid, 'gravewyrm_cleaver').secondaryCount;
    };
    expect(run()).toBe(run());
  });

  it('the shared action throttle gates disenchant before any rng draw or grant', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.ctx.resolve(pid)!.meta;
    sim.addItem('gravewyrm_cleaver', 1, pid); // epic: a success would draw once
    // Exhaust the shared 10-per-60s window.
    meta.craftThrottle.windowStart = sim.ctx.time;
    meta.craftThrottle.count = CRAFT_THROTTLE_MAX_PER_WINDOW;
    const { result, draws } = countDraws(sim, () =>
      resolveDisenchant(sim.ctx, pid, 'gravewyrm_cleaver'),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('throttled');
    expect(draws).toBe(0); // gated before the secondary-count draw
    expect(sim.countItem('gravewyrm_cleaver', pid)).toBe(1); // nothing consumed
    expect(sim.countItem('arcane_shard', pid)).toBe(0);
    for (const mat of TYPED_MATERIALS) expect(sim.countItem(mat, pid)).toBe(0);
  });
});

// A real two-player Sim so the trade path exercises the actual instanced
// inventory hub (unbound counting, the removal skip, and the grantOffer stamp),
// which a flat-count fake cannot model.
function makeTradeSim(seed = 42) {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, noPlayer: true });
  const a = sim.addPlayer('warrior', 'Ayla');
  const b = sim.addPlayer('warrior', 'Borin');
  const ea = sim.ctx.entities.get(a)!;
  const eb = sim.ctx.entities.get(b)!;
  eb.pos.x = ea.pos.x + 2;
  eb.pos.z = ea.pos.z;
  return { sim, a, b };
}

function grantInstance(sim: Sim, itemId: string, payload: ItemInstancePayload, pid: number) {
  sim.ctx.addItemInstance(itemId, payload, pid);
}

function doTrade(sim: Sim, from: number, to: number, offer: { itemId: string; count: number }[]) {
  tradeMod.tradeRequest(sim.ctx, to, from);
  tradeMod.tradeAccept(sim.ctx, to);
  tradeMod.tradeSetOffer(sim.ctx, offer, 0, from);
  tradeMod.tradeConfirm(sim.ctx, from);
  tradeMod.tradeConfirm(sim.ctx, to);
}

describe('bind-on-trade primitive (social/trade.ts)', () => {
  it('binds an armed copy to the recipient on the first completed trade; mint is unstamped', () => {
    const { sim, a, b } = makeTradeSim();
    grantInstance(sim, 'resonant_steel', { bindOnTrade: true }, a);
    // Minted: armed but unstamped.
    expect(slotFor(sim, a, 'resonant_steel')?.instance?.bindOnTrade).toBe(true);
    expect(slotFor(sim, a, 'resonant_steel')?.instance?.boundTo).toBeUndefined();

    doTrade(sim, a, b, [{ itemId: 'resonant_steel', count: 1 }]);

    expect(slotFor(sim, a, 'resonant_steel')).toBeUndefined();
    expect(sim.countItem('resonant_steel', b)).toBe(1);
    const received = slotFor(sim, b, 'resonant_steel');
    expect(received?.instance?.boundTo).toBe(b); // stamped to the recipient
    expect(received?.instance?.bindOnTrade).toBe(true); // arm marker persists
  });

  it('refuses to trade a bound copy again: the offer is denied and the item stays put', () => {
    const { sim, a, b } = makeTradeSim();
    grantInstance(sim, 'resonant_steel', { bindOnTrade: true, boundTo: b }, b);
    tradeMod.tradeRequest(sim.ctx, a, b);
    tradeMod.tradeAccept(sim.ctx, a);
    tradeMod.tradeSetOffer(sim.ctx, [{ itemId: 'resonant_steel', count: 1 }], 0, b);
    // The deny fired and the bound item was excluded from the offer.
    expect(
      sim.events.some(
        (e) => e.type === 'error' && e.text === 'That item is bound and cannot be traded.',
      ),
    ).toBe(true);
    const session = tradeMod.tradeFor(sim.ctx, b);
    const myOffer = session?.a === b ? session?.offerA : session?.offerB;
    expect(myOffer?.items).toEqual([]);
    tradeMod.tradeConfirm(sim.ctx, b);
    tradeMod.tradeConfirm(sim.ctx, a);
    expect(sim.countItem('resonant_steel', b)).toBe(1); // stayed with B
    expect(sim.countItem('resonant_steel', a)).toBe(0); // never crossed
  });

  it('a trade removal consumes an unbound copy and never a bound one', () => {
    const { sim, a, b } = makeTradeSim();
    // A holds one bound copy and one freely-tradeable copy of the same material
    // (distinct payloads, so two slots).
    grantInstance(sim, 'resonant_steel', { bindOnTrade: true, boundTo: a }, a);
    grantInstance(sim, 'resonant_steel', { bindOnTrade: true }, a);
    expect(sim.countItem('resonant_steel', a)).toBe(2);

    doTrade(sim, a, b, [{ itemId: 'resonant_steel', count: 1 }]);

    const aSlots =
      sim.ctx.resolve(a)?.meta.inventory.filter((s) => s.itemId === 'resonant_steel') ?? [];
    expect(aSlots.reduce((n, s) => n + s.count, 0)).toBe(1); // one copy left
    expect(aSlots.every((s) => s.instance?.boundTo === a)).toBe(true); // and it is the bound one
    expect(sim.countItem('resonant_steel', b)).toBe(1);
    expect(slotFor(sim, b, 'resonant_steel')?.instance?.boundTo).toBe(b);
  });

  it('byte-equal armed copies stack into one counted slot (Phase 12d model)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantInstance(sim, 'resonant_steel', { bindOnTrade: true }, pid);
    grantInstance(sim, 'resonant_steel', { bindOnTrade: true }, pid);
    const slots =
      sim.ctx.resolve(pid)?.meta.inventory.filter((s) => s.itemId === 'resonant_steel') ?? [];
    expect(slots.length).toBe(1);
    expect(slots[0].count).toBe(2);
    expect(slots[0].instance?.bindOnTrade).toBe(true);
  });

  it('a signer (non-armed) instance still trades exactly as before and is never stamped', () => {
    const { sim, a, b } = makeTradeSim();
    grantInstance(sim, 'moggers_copper_cudgel', { signer: 'Smith' }, a);
    doTrade(sim, a, b, [{ itemId: 'moggers_copper_cudgel', count: 1 }]);
    expect(sim.countItem('moggers_copper_cudgel', a)).toBe(0);
    const received = slotFor(sim, b, 'moggers_copper_cudgel');
    expect(received?.instance?.signer).toBe('Smith');
    expect(received?.instance?.boundTo).toBeUndefined(); // not armed, so never bound
  });
});
