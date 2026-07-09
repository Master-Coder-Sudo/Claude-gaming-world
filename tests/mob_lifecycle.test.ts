// Direct unit tests for the mob death-lifecycle module (src/sim/mob/lifecycle.ts),
// extracted from Sim in session M4. These import the module entry points and drive
// them against a real Sim's SimContext (so dealDamage / dropEntity / rebucket /
// despawnPersistentPet / clearNonPlayerStatAuras / resetNythraxisEncounter + the
// rng/emit/grid/players/entities/cfg primitives resolve through the live seam). They
// prove the slice in isolation: a packFrenzy death buffs same-template neighbors, a
// deathThroes corpse arms then bursts the in-radius player, a slain wild mob resets to
// its spawn point, and a boss's summoned adds are despawned.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  armDeathThroes,
  despawnSummonedAdds,
  detonateCorpse,
  frenzyPackmates,
  respawnMob,
} from '../src/sim/mob/lifecycle';
import { updateMob } from '../src/sim/mob/locomotion';
import { Sim } from '../src/sim/sim';
import type { CorpseLoot, PlayerClass } from '../src/sim/types';

const SEED = 88;

const makeSim = (cls: PlayerClass = 'warrior') => {
  const sim = new Sim({ seed: SEED, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(12);
  return sim;
};

const ctxOf = (sim: Sim) => (sim as any).ctx;

const spawn = (sim: Sim, key: string, level: number, x = 0, z = 0): any => {
  const mob = createMob((sim as any).nextId++, MOBS[key], level, { x, y: 0, z }) as any;
  (sim as any).addEntity(mob);
  return mob;
};

describe('mob_lifecycle module: frenzyPackmates', () => {
  it('a packFrenzy death gives same-template hostile neighbors the Pack Frenzy haste aura', () => {
    const sim = makeSim();
    const dead = spawn(sim, 'forest_wolf', 5, 0, 0);
    const packA = spawn(sim, 'forest_wolf', 5, 2, 0);
    const packB = spawn(sim, 'forest_wolf', 5, 4, 0);
    const boar = spawn(sim, 'wild_boar', 5, 3, 0); // different template -> unaffected
    for (const m of [packA, packB, boar]) m.hostile = true;

    frenzyPackmates(ctxOf(sim), dead);

    expect(packA.auras.some((a: any) => a.id === 'pack_frenzy' && a.kind === 'buff_haste')).toBe(
      true,
    );
    expect(packB.auras.some((a: any) => a.id === 'pack_frenzy')).toBe(true);
    expect(boar.auras.some((a: any) => a.id === 'pack_frenzy')).toBe(false);
  });

  it('a second death refreshes the aura rather than stacking it', () => {
    const sim = makeSim();
    const dead = spawn(sim, 'forest_wolf', 5, 0, 0);
    const pack = spawn(sim, 'forest_wolf', 5, 2, 0);
    pack.hostile = true;

    frenzyPackmates(ctxOf(sim), dead);
    pack.auras.find((a: any) => a.id === 'pack_frenzy').remaining = 1; // burn it down
    frenzyPackmates(ctxOf(sim), dead); // a second packmate falls

    const frenzies = pack.auras.filter((a: any) => a.id === 'pack_frenzy');
    expect(frenzies.length).toBe(1); // refreshed, not stacked
    expect(frenzies[0].remaining).toBe(MOBS.forest_wolf.packFrenzy!.duration);
  });
});

describe('mob_lifecycle module: Death Throes', () => {
  it('armDeathThroes sets the detonate fuse + emits the swell telegraph', () => {
    const sim = makeSim();
    const bog = spawn(sim, 'bog_bloat', 10, 0, 0);

    armDeathThroes(ctxOf(sim), bog);

    expect(bog.detonateTimer).toBe(MOBS.bog_bloat.deathThroes!.delay);
    const evs = (sim as any).drainEvents() as any[];
    expect(
      evs.some(
        (e) => e.type === 'log' && typeof e.text === 'string' && e.text.includes('begins to swell'),
      ),
    ).toBe(true);
  });

  it('detonateCorpse bursts the in-radius player for min..max damage + emits the cloud log', () => {
    const sim = makeSim();
    const p = sim.player as any;
    const bog = spawn(sim, 'bog_bloat', 10, p.pos.x, p.pos.z); // on top of the player -> in blast radius
    const hpBefore = p.hp;

    detonateCorpse(ctxOf(sim), bog);

    expect(p.hp).toBeLessThan(hpBefore); // took the burst
    const evs = (sim as any).drainEvents() as any[];
    expect(
      evs.some(
        (e) =>
          e.type === 'log' && typeof e.text === 'string' && e.text.includes('bursts in a cloud of'),
      ),
    ).toBe(true);
    expect(evs.some((e) => e.type === 'damage' && e.targetId === p.id)).toBe(true);
  });

  it('detonateCorpse on a non-deathThroes mob is a no-op (no rng, no damage)', () => {
    const sim = makeSim();
    const p = sim.player as any;
    const wolf = spawn(sim, 'forest_wolf', 5, p.pos.x, p.pos.z);
    const hpBefore = p.hp;

    detonateCorpse(ctxOf(sim), wolf);

    expect(p.hp).toBe(hpBefore);
  });
});

describe('mob_lifecycle module: respawnMob + despawnSummonedAdds', () => {
  it('respawnMob resets a slain wild mob to its spawn point at full hp, idle', () => {
    const sim = makeSim();
    const mob = spawn(sim, 'forest_wolf', 5, 40, 40);
    mob.spawnPos = { x: 40, y: mob.pos.y, z: 40 };
    // simulate a death far from spawn
    mob.dead = true;
    mob.hp = 0;
    mob.aiState = 'attack';
    mob.inCombat = true;
    mob.pos = { x: 55, y: mob.pos.y, z: 55 };

    respawnMob(ctxOf(sim), mob);

    expect(mob.dead).toBe(false);
    expect(mob.hp).toBe(mob.maxHp);
    expect(mob.aiState).toBe('idle');
    expect(mob.inCombat).toBe(false);
    expect(mob.pos.x).toBe(40);
    expect(mob.pos.z).toBe(40);
    expect(mob.wanderTimer).toBeGreaterThanOrEqual(2);
    expect(mob.wanderTimer).toBeLessThanOrEqual(8);
  });

  it('respawnMob despawns any adds the mob summoned this pull', () => {
    const sim = makeSim();
    const boss = spawn(sim, 'forest_wolf', 5, 40, 40);
    boss.spawnPos = { x: 40, y: boss.pos.y, z: 40 };
    boss.dead = true;
    boss.hp = 0;
    const add = spawn(sim, 'wild_boar', 5, 42, 40);
    boss.summonedIds = [add.id];

    respawnMob(ctxOf(sim), boss);

    expect((sim as any).entities.has(add.id)).toBe(false);
    expect(boss.summonedIds.length).toBe(0);
  });

  it('despawnSummonedAdds drops every add + clears stale player target refs', () => {
    const sim = makeSim();
    const p = sim.player as any;
    const boss = spawn(sim, 'forest_wolf', 5, 40, 40);
    const add = spawn(sim, 'wild_boar', 5, 42, 40);
    boss.summonedIds = [add.id];
    p.targetId = add.id;

    despawnSummonedAdds(ctxOf(sim), boss);

    expect((sim as any).entities.has(add.id)).toBe(false);
    expect(boss.summonedIds.length).toBe(0);
    expect(p.targetId).toBe(null);
  });

  it('despawnSummonedAdds early-returns on a mob with no summons', () => {
    const sim = makeSim();
    const mob = spawn(sim, 'forest_wolf', 5, 40, 40);
    mob.summonedIds = [];
    expect(() => despawnSummonedAdds(ctxOf(sim), mob)).not.toThrow();
    expect(mob.summonedIds.length).toBe(0);
  });
});

// Regression pins for issue #1539: when a mob respawns in place, the reused Entity
// is scrubbed of all corpse-loot state so the fresh spawn is never lootable off the
// old drop. The current ~60s corpse window (CORPSE_DURATION) is intentional: while
// the corpse is still lootable AND its corpseTimer has not elapsed, the respawn gate
// in updateMob withholds the respawn, keeping the drop reachable. These tests pin
// both halves so a future change cannot silently revive a mob over its unlooted loot.
describe('mob_lifecycle module: respawn clears unlooted corpse state (regression #1539)', () => {
  const makeLoot = (): CorpseLoot => ({
    copper: 42,
    items: [{ itemId: 'coarse_leather', count: 1 }],
  });

  it('respawnMob scrubs loot/lootable/tap state from a corpse that was never looted', () => {
    const sim = makeSim();
    const p = sim.player as any;
    const mob = spawn(sim, 'forest_wolf', 5, 40, 40);
    mob.spawnPos = { x: 40, y: mob.pos.y, z: 40 };
    // Simulate a slain, unlooted corpse: dead with live drops still on it.
    mob.dead = true;
    mob.hp = 0;
    mob.lootable = true;
    mob.loot = makeLoot();
    mob.tappedById = p.id;
    mob.lootRecipientIds = [p.id];
    mob.harvestClaimedBy = p.id;

    respawnMob(ctxOf(sim), mob);

    // The reused entity must carry NO stale loot: a fresh spawn is not lootable
    // off the old drop, and no player still owns the tap.
    expect(mob.dead).toBe(false);
    expect(mob.lootable).toBe(false);
    expect(mob.loot).toBe(null);
    expect(mob.tappedById).toBe(null);
    expect(mob.lootRecipientIds).toBeUndefined();
    expect(mob.harvestClaimedBy).toBe(null);
  });

  it('the dead prologue WITHHOLDS respawn while an unlooted corpse is still within its window', () => {
    const sim = makeSim();
    // A dead, lootable, non-instance corpse whose respawn timer has elapsed but
    // whose corpse window has not: the gate must not respawn it yet, so the drop
    // stays reachable for the full window.
    const mob = spawn(sim, 'forest_wolf', 5, 40, 40);
    mob.spawnPos = { x: 40, y: mob.pos.y, z: 40 };
    mob.dead = true;
    mob.hp = 0;
    mob.aiState = 'dead';
    mob.lootable = true;
    mob.loot = makeLoot();
    mob.respawnTimer = 0;
    mob.corpseTimer = 5; // still inside the ~60s corpse window

    updateMob(ctxOf(sim), mob);

    expect(mob.dead).toBe(true); // withheld: loot is still reachable
    expect(mob.lootable).toBe(true);
    expect(mob.loot).not.toBe(null);
    expect(mob.corpseTimer).toBeLessThan(5); // the prologue still counts the window down
  });

  it('the dead prologue respawns (clearing loot) once the corpse window elapses', () => {
    const sim = makeSim();
    const mob = spawn(sim, 'forest_wolf', 5, 40, 40);
    mob.spawnPos = { x: 40, y: mob.pos.y, z: 40 };
    mob.dead = true;
    mob.hp = 0;
    mob.aiState = 'dead';
    mob.lootable = true;
    mob.loot = makeLoot();
    mob.tappedById = (sim.player as any).id;
    mob.respawnTimer = 0;
    mob.corpseTimer = 0; // window elapsed: the gate now fires respawnMob

    updateMob(ctxOf(sim), mob);

    expect(mob.dead).toBe(false); // respawned in place
    expect(mob.lootable).toBe(false);
    expect(mob.loot).toBe(null);
    expect(mob.tappedById).toBe(null);
    expect(mob.hp).toBe(mob.maxHp);
  });
});
