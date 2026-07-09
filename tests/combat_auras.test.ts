// Direct unit tests for src/sim/combat/auras.ts (C3). The per-tick aura/regen/timer
// runner is exercised against a real Sim.ctx (so the SimContext seam, entities,
// players, rng, and the heal/stat-aura delegates are the real shared ones the engine
// uses), proving the extracted module is callable on its own and that the moved
// behavior (the two e.dead guards, the DoT/HoT/expiry branches, the eat-tick regen,
// and the friendly-NPC cleanse) is intact, independent of the parity golden.

import { describe, expect, it } from 'vitest';
import {
  cleanseFriendlyNpcAuras,
  isRejectedFriendlyNpcAura,
  updateAuras,
  updateRegen,
  updateTimers,
} from '../src/sim/combat/auras';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { CONSUME_TICKS, DT } from '../src/sim/types';

type AnyEntity = Entity & Record<string, any>;
type AnySim = Sim & Record<string, any>;

function makeSim(seed = 7373): AnySim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true }) as AnySim;
}

function aura(kind: Aura['kind'], value: number, extra: Partial<Aura> = {}): Aura {
  return {
    id: `${kind}_${value}`,
    name: kind,
    kind,
    remaining: 60,
    duration: 60,
    value,
    sourceId: 0,
    school: 'physical',
    ...extra,
  } as Aura;
}

function spawnMob(sim: AnySim, hp = 1000): AnyEntity {
  const p = sim.player as AnyEntity;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 5, {
    x: p.pos.x + 40,
    y: p.pos.y,
    z: p.pos.z + 40,
  }) as AnyEntity;
  mob.maxHp = hp;
  mob.hp = hp;
  sim.addEntity(mob);
  return mob;
}

describe('auras: isRejectedFriendlyNpcAura', () => {
  it('is true for rejected control/debuff kinds and false otherwise', () => {
    expect(isRejectedFriendlyNpcAura(aura('stun', 1))).toBe(true);
    expect(isRejectedFriendlyNpcAura(aura('dot', 1))).toBe(true);
    expect(isRejectedFriendlyNpcAura(aura('tongues', 1.5))).toBe(true);
    expect(isRejectedFriendlyNpcAura(aura('hot', 1))).toBe(false);
    expect(isRejectedFriendlyNpcAura(aura('buff_ap', 1))).toBe(false);
  });
});

describe('auras: updateTimers', () => {
  it('decrements gcd, advances rule/combat timers, and expires cooldowns', () => {
    const sim = makeSim();
    const p = sim.player as AnyEntity;
    p.gcdRemaining = DT; // exactly one tick from 0
    p.fiveSecondRule = 0;
    p.combatTimer = 0;
    p.cooldowns = new Map<string, number>([
      ['a', DT],
      ['b', 5],
    ]);
    updateTimers(p);
    expect(p.gcdRemaining).toBe(0);
    expect(p.fiveSecondRule).toBeCloseTo(DT, 9);
    expect(p.combatTimer).toBeCloseTo(DT, 9);
    expect(p.cooldowns.has('a')).toBe(false); // <= 0 deleted
    expect(p.cooldowns.get('b')).toBeCloseTo(5 - DT, 9);
  });
});

describe('auras: updateAuras DoT tick', () => {
  it('a DoT tick damages the carrier (via ctx.dealDamage)', () => {
    const sim = makeSim();
    const mob = spawnMob(sim, 1000);
    mob.auras.push(aura('dot', 100, { tickInterval: DT }));
    const hp0 = mob.hp;
    updateAuras(sim.ctx, mob);
    expect(mob.hp).toBeLessThan(hp0);
  });

  it('the post-DoT e.dead guard fires once a DoT tick kills the carrier', () => {
    const sim = makeSim();
    const mob = spawnMob(sim, 50);
    // A buff at index 0 and a lethal dot at index 1: the backward walk ticks the dot
    // first, kills the mob, and the guard returns before index 0 is reached.
    mob.auras.push(aura('buff_armor', 10));
    mob.auras.push(aura('dot', 9999, { tickInterval: DT }));
    updateAuras(sim.ctx, mob);
    expect(mob.dead).toBe(true);
  });
});

describe('auras: updateAuras expiry / HoT / top guard', () => {
  it('removes an aura whose remaining has elapsed', () => {
    const sim = makeSim();
    const mob = spawnMob(sim, 1000);
    mob.auras.push(aura('buff_armor', 10, { remaining: DT / 2 })); // elapses this tick
    updateAuras(sim.ctx, mob);
    expect(mob.auras.length).toBe(0);
  });

  it('a HoT tick heals the carrier', () => {
    const sim = makeSim();
    const mob = spawnMob(sim, 1000);
    mob.hp = 500;
    mob.auras.push(aura('hot', 100, { tickInterval: DT }));
    updateAuras(sim.ctx, mob);
    expect(mob.hp).toBeGreaterThan(500);
  });

  it('the top guard skips a dead entity entirely (auras untouched)', () => {
    const sim = makeSim();
    const mob = spawnMob(sim, 1000);
    mob.dead = true;
    mob.auras.push(aura('buff_armor', 10, { remaining: DT / 2 }));
    updateAuras(sim.ctx, mob);
    expect(mob.auras.length).toBe(1); // not processed: still present
  });
});

describe('auras: updateRegen', () => {
  it('eat heals an out-of-combat player on the 40-tick boundary, decrementing the food', () => {
    const sim = makeSim();
    const p = sim.player as AnyEntity;
    const meta = sim.players.get(p.id) as PlayerMeta;
    p.inCombat = false;
    p.hp = Math.max(1, p.maxHp - 500);
    p.eating = { itemId: 'food', kind: 'food', hpPer2s: 90, manaPer2s: 0, remaining: 6 };
    sim.tickCount = 40; // a multiple of 40 so the regen body runs
    const hp0 = p.hp;
    updateRegen(sim.ctx, p, meta);
    expect(p.hp).toBeGreaterThan(hp0); // the food healed
    expect(p.eating?.remaining).toBe(4); // remaining decremented by 2
  });

  it('does nothing off the 40-tick boundary', () => {
    const sim = makeSim();
    const p = sim.player as AnyEntity;
    const meta = sim.players.get(p.id) as PlayerMeta;
    p.inCombat = false;
    p.hp = Math.max(1, p.maxHp - 500);
    p.eating = { itemId: 'food', kind: 'food', hpPer2s: 90, manaPer2s: 0, remaining: 6 };
    sim.tickCount = 41; // not a multiple of 40
    const hp0 = p.hp;
    updateRegen(sim.ctx, p, meta);
    expect(p.hp).toBe(hp0);
    expect(p.eating?.remaining).toBe(6); // untouched
  });

  it('eating recovers HP strictly faster than natural regen: food STACKS, not replaces (#1608/#1326)', () => {
    // Regression pin for the eat-vs-idle crossover. Before the fix, natural HP regen was
    // gated behind !p.eating, so eating REPLACED it: once stamina-based regen out-paced a
    // tier-1 food's per-tick heal, sitting to eat healed slower than standing idle. The fix
    // lets natural regen always run out of combat and adds the food ON TOP (matching how
    // natural mana regen already stacks with drinking). We drive updateRegen directly on the
    // 40-tick (2s) boundary for the CONSUME_TICKS-long window, isolating regen from any
    // incidental world aggro a full tick() loop could introduce.
    const FOOD_ID = 'baked_bread'; // real tier-1 vendor food (foodHp 61 -> ~7 hp / 2s tick)

    // Natural regen only (no eating) over the window. Level 20 gives a large HP pool so the
    // nine regen ticks never cap out (which would flatten the comparison).
    const simN = makeSim();
    simN.setPlayerLevel(20);
    const pN = simN.player as AnyEntity;
    const metaN = simN.players.get(pN.id) as PlayerMeta;
    pN.inCombat = false;
    pN.hp = Math.floor(pN.maxHp / 2);
    const naturalBefore = pN.hp;
    for (let i = 1; i <= CONSUME_TICKS; i++) {
      simN.tickCount = 40 * i; // land on the 2s regen boundary each step
      updateRegen(simN.ctx, pN, metaN);
    }
    const naturalGain = pN.hp - naturalBefore;

    // Eating a real tier-1 food over the same window, via the real useItem path.
    const simE = makeSim();
    simE.setPlayerLevel(20);
    const pE = simE.player as AnyEntity;
    const metaE = simE.players.get(pE.id) as PlayerMeta;
    pE.inCombat = false;
    simE.addItem(FOOD_ID, 1);
    simE.useItem(FOOD_ID); // sets p.eating with hpPer2s = round(foodHp / CONSUME_TICKS)
    expect(pE.eating).toBeTruthy();
    pE.hp = Math.floor(pE.maxHp / 2);
    const eatingBefore = pE.hp;
    for (let i = 1; i <= CONSUME_TICKS; i++) {
      simE.tickCount = 40 * i;
      updateRegen(simE.ctx, pE, metaE);
    }
    const eatingGain = pE.hp - eatingBefore;

    // Same class/level/seed -> identical natural regen; eating must beat idling by the
    // food's contribution. Strictly faster is the whole point of #1608.
    expect(eatingGain).toBeGreaterThan(naturalGain);
  });
});

describe('auras: cleanseFriendlyNpcAuras', () => {
  it('strips rejected control/debuff auras and leaves benign ones', () => {
    const sim = makeSim();
    const npc = {
      id: 999,
      auras: [aura('stun', 1), aura('hot', 1), aura('root', 1)],
    } as unknown as AnyEntity;
    cleanseFriendlyNpcAuras(sim.ctx, npc);
    expect(npc.auras.map((a: Aura) => a.kind)).toEqual(['hot']); // stun + root stripped
  });
});
