// Voidwalker (Gloomshade) aggro: the warlock tank demon must auto-cast its
// taunt (Growl) by default and generate elevated tank-pet threat so it can hold
// aggro against the owner's damage output, matching a classic-era Voidwalker.
// Regression coverage for issue #1356.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TANK_PET_THREAT_MULT } from '../src/sim/threat';
import type { Entity } from '../src/sim/types';
import { dist2d } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function makeWarlock(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warlock', autoEquip: true });
}

function teleport(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function nearestMob(sim: Sim, templateId: string): Entity {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.ownerId !== null) continue;
    if (e.templateId !== templateId) continue;
    const d = dist2d(sim.player.pos, e.pos);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) throw new Error(`no ${templateId} found`);
  return best;
}

// Keep the low-level target alive through scripted damage: a death wipes the
// hate table and ends the aggro contest we are measuring.
function beefUp(mob: Entity): void {
  mob.maxHp = 5000;
  mob.hp = 5000;
}

// Summon the warlock's tank demon (Gloomshade) and wait out the 5s cast.
function summonVoidwalker(sim: Sim): Entity {
  sim.setPlayerLevel(10);
  sim.player.resource = sim.player.maxResource;
  sim.castAbility('summon_voidwalker');
  for (let i = 0; i < 20 * 6; i++) sim.tick();
  const vw = sim.petOf(sim.playerId);
  if (!vw) throw new Error('expected summoned voidwalker');
  return vw;
}

describe('voidwalker aggro (#1356)', () => {
  it('summons the Gloomshade with Growl autocast on by default', () => {
    const sim = makeWarlock();
    const vw = summonVoidwalker(sim);

    expect(vw.templateId).toBe('gloomshade');
    // classic-era Voidwalkers Torment automatically; the tank demon defaults its
    // auto-taunt ON so it holds aggro without the owner toggling autocast.
    expect(vw.petAutoTaunt).toBe(true);
  });

  it('auto-taunts the mob it is sent to attack without the owner enabling autocast', () => {
    const sim = makeWarlock();
    const vw = summonVoidwalker(sim);
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    teleport(sim, vw, wolf.pos.x + 2, wolf.pos.z);
    teleport(sim, sim.player, wolf.pos.x + 8, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.petAttack();

    // no setPetAutoTaunt(true): the tank demon must Growl on its own
    for (let i = 0; i < 20 * 2 && wolf.forcedTargetId !== vw.id; i++) sim.tick();
    expect(wolf.forcedTargetId).toBe(vw.id);
    expect(vw.petTauntTimer).toBeGreaterThan(0);
  });

  it('generates elevated threat from its damage (tank-pet threat bonus)', () => {
    const sim = makeWarlock();
    const vw = summonVoidwalker(sim);
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);

    // 100 shadow damage from the tank demon lands on the hate table at the tank
    // threat factor (parity with Defensive Stance / Bear Form), plus the 1-point
    // aggro seed from entering combat.
    (
      sim as unknown as {
        dealDamage(
          s: Entity,
          t: Entity,
          a: number,
          c: boolean,
          school: string,
          ability: string | null,
          k: string,
          noRage: boolean,
        ): void;
      }
    ).dealDamage(vw, wolf, 100, false, 'shadow', null, 'hit', true);

    expect(wolf.threat.get(vw.id)).toBeCloseTo(100 * TANK_PET_THREAT_MULT + 1, 5);
  });

  it('reclaims aggro via auto-taunt after the warlock out-threats the tanked mob', () => {
    const sim = makeWarlock();
    const vw = summonVoidwalker(sim);
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    teleport(sim, vw, wolf.pos.x + 2, wolf.pos.z);
    teleport(sim, sim.player, wolf.pos.x + 6, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.petAttack();

    // the voidwalker establishes itself as the wolf's target
    for (let i = 0; i < 20 * 3 && wolf.aggroTargetId !== vw.id; i++) sim.tick();
    expect(wolf.aggroTargetId).toBe(vw.id);

    // the warlock opens up with real Gloom Bolt damage on the mob its pet tanks
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.player.resource = sim.player.maxResource;
    sim.player.gcdRemaining = 0;
    sim.castAbility('shadow_bolt');

    // across the next Growl cycle the tank demon Torments the wolf back onto
    // itself: impossible without the default auto-taunt.
    let reclaimed = false;
    for (let i = 0; i < 20 * 12 && !reclaimed; i++) {
      sim.tick();
      if (wolf.forcedTargetId === vw.id) reclaimed = true;
    }
    expect(reclaimed).toBe(true);
    expect(wolf.aggroTargetId).toBe(vw.id);
  });
});
