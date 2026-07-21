import { describe, expect, it } from 'vitest';
import { ZONE1_QUESTS } from '../src/sim/content/zone1';
import { GATHER_NODES } from '../src/sim/data';
import { normalizeArchetypeState } from '../src/sim/professions/archetype';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';
import { COMMAND_NAMES } from '../src/world_api';

// Phase 14 retired the single q_archetype_acceptance / q_prof_make_amends quests
// in favor of one attune + one make-amends quest per anchor master, each pinning
// its own canonical pair. These re-pins exercise the same behaviors against the
// new per-pair quest ids (behavior-equivalent; new Phase 14 coverage lives in the
// professions_tier_mail / professions_nudges / professions_quest_cadence suites).
const HOBBY_QUEST = 'q_prof_hobby_switch';
// Canonical pair ids follow CRAFT_RING order (see archetypePairId); the smith and
// outfitter pairs are two of the four wave-one anchor masters.
const WEAPON_ARMOR = 'weaponcrafting+armorcrafting'; // Smith (Forgemistress Darva)
const LEATHER_TAILOR = 'leatherworking+tailoring'; // Outfitter (Weaver Ottilie)
const SMITH_MASTER = 'forgemistress_darva';
const OUTFITTER_MASTER = 'weaver_ottilie';
// The hobby-switch quest is given by Smith Haldren, not an anchor master.
const HOBBY_MASTER = 'smith_haldren';

function makeSim(seed = 9042): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function moveToNpc(sim: Sim, templateId: string, pid = sim.playerId): void {
  const npc = [...sim.entities.values()].find((e) => e.templateId === templateId);
  if (!npc) throw new Error(`${templateId} missing`);
  const player = sim.entities.get(pid);
  if (!player) throw new Error('player missing');
  player.pos.x = npc.pos.x + 1;
  player.pos.z = npc.pos.z;
}

function unlockProfessionQuests(sim: Sim, pid = sim.playerId): void {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error('player meta missing');
  meta.questsDone.add('q_prof_intro');
}

function acceptAt(sim: Sim, npcTemplate: string, questId: string, selection?: string): void {
  moveToNpc(sim, npcTemplate);
  sim.acceptQuest(questId, selection);
}

function completeAndTurnInAt(sim: Sim, npcTemplate: string, questId: string): void {
  const qp = sim.questLog.get(questId);
  if (!qp) throw new Error(`${questId} was not accepted`);
  qp.counts = [...(qp.resolvedCounts ?? [])];
  qp.state = 'ready';
  moveToNpc(sim, npcTemplate);
  sim.turnInQuest(questId);
}

function attune(sim: Sim, npcTemplate: string, questId: string, pairId: string): void {
  acceptAt(sim, npcTemplate, questId, pairId);
  completeAndTurnInAt(sim, npcTemplate, questId);
}

describe('live profession attunement quests', () => {
  it('exposes each master quest per the unattuned / matching / wrong-with-history matrix', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);

    // Unattuned: the smith's attune is available, its make-amends is not, and the
    // hobby switch is not (there is no pair to give a hobby yet).
    expect(sim.questState('q_prof_attune_smith')).toBe('available');
    expect(sim.questState('q_prof_amends_smith')).toBe('unavailable');
    expect(sim.questState(HOBBY_QUEST)).toBe('unavailable');

    attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    // Attuned to the matching pair: the one-time smith attune is now done (never
    // repeatable), its amends is unavailable (it is the current pair), and the
    // hobby switch is now available.
    expect(sim.questState('q_prof_attune_smith')).toBe('done');
    expect(sim.questState('q_prof_amends_smith')).toBe('unavailable');
    expect(sim.questState(HOBBY_QUEST)).toBe('available');

    attune(sim, OUTFITTER_MASTER, 'q_prof_attune_outfitter', LEATHER_TAILOR);
    // Attuned to a wrong pair with the smith pair in history: the smith's amends
    // is available (return), its one-time attune stays done (the way back is
    // make-amends, never the lore quest again).
    expect(sim.questState('q_prof_amends_smith')).toBe('available');
    expect(sim.questState('q_prof_attune_smith')).toBe('done');
  });

  it('attunes a pair only when the persisted per-pair attune selection completes', () => {
    const sim = makeSim();

    acceptAt(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    expect(sim.activeArchetype).toBeNull();
    expect(sim.questLog.get('q_prof_attune_smith')?.selection).toBe(WEAPON_ARMOR);

    completeAndTurnInAt(sim, SMITH_MASTER, 'q_prof_attune_smith');
    expect(sim.craftingIdentity).toMatchObject({
      activeArchetype: 'weaponcrafting',
      pairedMajor: 'armorcrafting',
      attunedPairs: [WEAPON_ARMOR],
    });
    expect(sim.archetypeSwitchCount).toBe(0);
  });

  it('rejects a selection other than the quest pinned pair, and a re-attune once seen', () => {
    const sim = makeSim();
    moveToNpc(sim, SMITH_MASTER);

    sim.acceptQuest('q_prof_attune_smith', 'not-a-pair');
    sim.acceptQuest('q_prof_attune_smith', LEATHER_TAILOR); // a real pair, but not the smith's
    expect(sim.questLog.has('q_prof_attune_smith')).toBe(false);

    attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    moveToNpc(sim, SMITH_MASTER);
    sim.acceptQuest('q_prof_attune_smith', WEAPON_ARMOR); // already attuned to it (mode 'new' seen)
    expect(sim.questLog.has('q_prof_attune_smith')).toBe(false);
  });

  it('uses attune for a new pair and escalating make-amends for a previously held pair', () => {
    const sim = makeSim();
    attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    attune(sim, OUTFITTER_MASTER, 'q_prof_attune_outfitter', LEATHER_TAILOR);
    expect(sim.archetypeSwitchCount).toBe(0);

    acceptAt(sim, SMITH_MASTER, 'q_prof_amends_smith', WEAPON_ARMOR);
    expect(sim.questLog.get('q_prof_amends_smith')?.resolvedCounts).toEqual([5]);
    completeAndTurnInAt(sim, SMITH_MASTER, 'q_prof_amends_smith');
    expect(sim.craftingIdentity.activeArchetype).toBe('weaponcrafting');
    expect(sim.archetypeSwitchCount).toBe(1);

    acceptAt(sim, OUTFITTER_MASTER, 'q_prof_amends_outfitter', LEATHER_TAILOR);
    expect(sim.questLog.get('q_prof_amends_outfitter')?.resolvedCounts).toEqual([8]);
  });

  it('resolves amends availability without crashing when a non-wave-one pair is in history', () => {
    // A player attuned before Phase 14 (via the retired un-narrowed acceptance
    // quest) can hold any of the ten ring pairs. The four make-amends quests pin
    // only the wave-one pairs, so a non-wave-one pair has no return path (an
    // accepted consequence, flagged in the PR body); the masters must still
    // resolve availability without crashing on the unrecognized history entry.
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId);
    if (!meta) throw new Error('player meta missing');
    meta.archetype.activeArchetype = 'tailoring';
    meta.archetype.pairedMajor = 'inscription';
    meta.archetype.attunedPairs = ['tailoring+inscription'];

    // None of the wave-one amends quests offers the non-wave-one pair.
    expect(sim.questState('q_prof_amends_smith')).toBe('unavailable');
    expect(sim.questState('q_prof_amends_outfitter')).toBe('unavailable');
    expect(sim.questState('q_prof_amends_apothecary')).toBe('unavailable');
    expect(sim.questState('q_prof_amends_bombardier')).toBe('unavailable');
    // A wave-one attune is still reachable (that pair is new to this character).
    expect(sim.questState('q_prof_attune_smith')).toBe('available');
  });

  it('switches the explicit hobby only to the other opposite candidate', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);
    attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    expect(sim.hobbyCraft).toBe('leatherworking');

    acceptAt(sim, HOBBY_MASTER, HOBBY_QUEST, 'tailoring');
    completeAndTurnInAt(sim, HOBBY_MASTER, HOBBY_QUEST);
    expect(sim.hobbyCraft).toBe('tailoring');

    acceptAt(sim, HOBBY_MASTER, HOBBY_QUEST, 'alchemy'); // not an opposite candidate
    expect(sim.questLog.has(HOBBY_QUEST)).toBe(false);
  });

  it('round-trips active pair, explicit hobby, history, and an accepted quest selection', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);
    attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
    acceptAt(sim, HOBBY_MASTER, HOBBY_QUEST, 'tailoring');

    const saved = sim.serializeCharacter(sim.playerId);
    const reloaded = makeSim(9043);
    const pid = reloaded.addPlayer('warrior', 'Reloaded', { state: saved ?? undefined });

    expect(reloaded.craftingIdentityFor(pid)).toMatchObject({
      activeArchetype: 'weaponcrafting',
      pairedMajor: 'armorcrafting',
      hobbyCraft: 'leatherworking',
      attunedPairs: [WEAPON_ARMOR],
    });
    expect(reloaded.players.get(pid)?.questLog.get(HOBBY_QUEST)).toMatchObject({
      selection: 'tailoring',
      resolvedCounts: [3],
    });
  });

  it('normalizes an old pair save with deterministic hobby and deduplicated history', () => {
    expect(
      normalizeArchetypeState({
        activeArchetype: 'armorcrafting',
        pairedMajor: 'weaponcrafting',
        switchCount: 2,
        amendsProgress: 4,
      }),
    ).toEqual({
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'leatherworking',
      attunedPairs: [WEAPON_ARMOR],
      switchCount: 2,
      amendsProgress: 4,
    });
  });

  it('drops a stale or unknown attuned pair id by design and keeps the rest of the save intact', () => {
    // normalizeArchetypeState filters attunedPairs through isAdjacentPairTarget.
    // The stale id below ('armorcrafting+weaponcrafting') is the pre-reorder
    // canonical form of the armor/weapon pair; no deployed build ever persisted
    // attunedPairs before the ring reorder landed, so dropping it silently (no
    // throw, no repair) is the intended semantics for any unrecognized id.
    const state = normalizeArchetypeState({
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'tailoring',
      attunedPairs: ['armorcrafting+weaponcrafting', WEAPON_ARMOR, 'not+a+pair'],
      switchCount: 3,
      amendsProgress: 2,
    });
    expect(state.attunedPairs).toEqual([WEAPON_ARMOR]);
    expect(state).toEqual({
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'tailoring',
      attunedPairs: [WEAPON_ARMOR],
      switchCount: 3,
      amendsProgress: 2,
    });
  });

  it('does not add a direct profession-transition command to the client protocol', () => {
    expect(COMMAND_NAMES).not.toContain('attune_profession');
    expect(COMMAND_NAMES).not.toContain('switch_hobby');
    expect(COMMAND_NAMES).not.toContain('advance_amends');
  });

  // Phase 1 changed sim LOGIC, not just content data: the quest-effect
  // transitions (profession_quest_effects.ts), the gather/craft quest-credit
  // arms (quest_credit.ts), the removed bespoke node quest grant
  // (gathering.ts), and the attunement-gated combo craft path (crafting.ts,
  // combo_eligibility.ts). So the whole flow gets a same-seed determinism pin:
  // two sims with the same seed running the identical command script must end
  // byte-identical, including every rng-drawing step (harvest rarity rolls and
  // the craft path's masterwork proc draw share the one world rng stream).
  it('same-seed runs of the gather, craft, attune, and hobby-switch flow are identical', () => {
    const run = () => {
      const sim = makeSim(4242);
      const pid = sim.playerId;
      unlockProfessionQuests(sim);

      const oreNodes = GATHER_NODES.filter((node) => node.type === 'ore').slice(0, 2);
      expect(oreNodes).toHaveLength(2);
      for (const node of oreNodes) {
        const player = sim.entities.get(pid)!;
        player.pos.x = node.pos.x;
        player.pos.z = node.pos.z;
        player.pos.y = terrainHeight(node.pos.x, node.pos.z, sim.cfg.seed);
        player.prevPos = { ...player.pos };
        sim.harvestNode(node.id, pid); // rarity roll: draws rng
        sim.tick();
      }

      attune(sim, SMITH_MASTER, 'q_prof_attune_smith', WEAPON_ARMOR);
      sim.addItem('linen_scrap', 1, pid);
      sim.addItem('spider_leg', 1, pid);
      sim.craftItem('recipe_minor_healing_potion', pid); // masterwork proc: draws rng
      acceptAt(sim, HOBBY_MASTER, HOBBY_QUEST, 'tailoring');
      completeAndTurnInAt(sim, HOBBY_MASTER, HOBBY_QUEST);
      for (let i = 0; i < 20; i++) sim.tick();

      return {
        save: sim.serializeCharacter(pid),
        identity: sim.craftingIdentity,
        lastCraft: sim.meta(pid)?.lastCraftResult,
      };
    };

    const first = run();
    // Decisive anchors so a doubly-failed script can never pass vacuously.
    expect(first.identity).toMatchObject({
      hobbyCraft: 'tailoring',
      attunedPairs: [WEAPON_ARMOR],
    });
    expect(first.lastCraft?.ok).toBe(true);
    expect(run()).toEqual(first);
  });
});

// Phase 12c appendix row: the hobby-switch quest pays no XP. It is a
// repeatable identity toggle; any XP on it becomes a farmable trickle
// (gather 3 herbs, toggle, repeat), so the reward re-pins to 0 while the
// quest itself stays repeatable.
describe('q_prof_hobby_switch reward shape (Phase 12c)', () => {
  it('grants 0 XP and stays repeatable', () => {
    const quest = ZONE1_QUESTS[HOBBY_QUEST];
    expect(quest.xpReward).toBe(0);
    expect(quest.repeatable).toBe(true);
  });
});
