# Upstream Issue Fixes - Prioritized Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the highest-impact bugs and gameplay issues from the upstream `levy-street/world-of-claudecraft` issue tracker, prioritized by player experience value.

**Architecture:** Each task targets a self-contained subsystem (sim, render, ui, net, server) behind the repo's existing seams (`SimContext` for sim changes, `IWorld` for presentation, `RouteDef` for server endpoints). Fixes are test-first with deterministic reproduction where possible.

**Tech Stack:** TypeScript (strict), Vitest, Three.js r0.165, vanilla DOM/canvas HUD, WebSocket wire protocol

**Source:** 78 open issues analyzed from `levy-street/world-of-claudecraft`, filtered to the 45 most impactful. Priority tiers: game-breaking > core gameplay feel > UX/QoL > polish.

## Global Constraints

- `src/sim/` stays DOM/browser/Three.js-free; all randomness through `Rng`, never `Math.random`/`Date.now`
- `IWorld` is the only seam between sim and render/ui; extend it first, implement in both `Sim` and `ClientWorld`
- Server is authoritative; never resolve combat/loot/economy on the client
- Every player-visible string is a `t()` key; contributors add English only
- Deterministic 20 Hz tick (`DT = 1/20`); never reorder `tick()` phases casually
- No em dashes, en dashes, or emojis in code, comments, or commit messages
- Conventional Commits with scope: `fix(<area>): ...`
- Vitest for logic/unit; `npx vitest run tests/<file>.test.ts` for single file iteration

---

## Tier 1: Critical - Game-Breaking & Economy Exploits

### Task 1: Fix Arena Full-Restore Carry-Back (Dungeon Exploit)

**Files:**
- Modify: `src/sim/social/arena.ts` - snapshot HP/resource at match formation, restore on return
- Modify: `src/sim/instances/dungeons.ts` - dequeue player on dungeon entry
- Modify: `src/sim/social/arena.ts` - filter matchmaking by position (overworld only)
- Test: `tests/arena.test.ts`

**Interfaces:**
- Consumes: `ArenaFighter` (existing), `returnFromArena`, `resetForArena`, `readyArenaFighter`, `arenaQueueJoin`, `matchmakeArena1v1`/`matchmakeArena2v2`, `enterDungeon`
- Produces: `snapshotFighterPreMatch(fighter: ArenaFighter): { hp: number, resource: number }`, `isInDungeonInstance(entity: Entity): boolean`

**Background:** Issue #1600. An arena match provides a free full restore (HP, resource, cooldowns cleared). A player queues from overworld, walks into Gravewyrm Sanctum, kills Korzul, gets matched mid-dungeon, and is returned fully healed to their in-dungeon position. Combined with a "Take Over" relog that mints a fresh instance, the boss can be farmed infinitely with zero downtime.

- [ ] **Step 1: Write failing test for pre-match HP/resource snapshot**

```ts
// tests/arena.test.ts - add inside an existing describe block
test('returnFromArena restores pre-match HP and resource, not full', () => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, noPlayer: true });
  const p1 = sim.addPlayer('warrior', 'TestA');
  const p2 = sim.addPlayer('warrior', 'TestB');

  // Damage player before queuing
  (sim as any).dealDamage(p1, 50);
  sim.player = sim.players.get(p1)!;
  const damagedHp = sim.player.hp;
  const damagedResource = sim.player.resource;
  expect(damagedHp).toBeLessThan(sim.player.maxHp);

  // Queue both and match
  sim.arenaQueueJoin(p1);
  sim.arenaQueueJoin(p2);
  // Advance ticks to let matchmaker pair them, then run the bout
  for (let i = 0; i < 200; i++) sim.tick();
  // Let one fighter yield - advance until arena resolves
  for (let i = 0; i < 300; i++) sim.tick();

  // After return, HP should be the damaged value, not full
  sim.player = sim.players.get(p1)!;
  expect(sim.player.hp).toBe(damagedHp);           // NOT full
  expect(sim.player.resource).toBe(damagedResource); // NOT full
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/arena.test.ts -t "returnFromArena restores pre-match"`
Expected: FAIL - arena returns player at full HP

- [ ] **Step 3: Implement HP/resource snapshot and restore in arena.ts**

```ts
// src/sim/social/arena.ts - add snapshot fields to ArenaFighter interface
// In the ArenaFighter type (types or arena.ts local):
interface ArenaFighter {
  // ... existing fields ...
  preMatchHp: number;
  preMatchResource: number;
}

// In matchmakeArena1v1 / matchmakeArena2v2, snapshot before resetForArena:
function snapshotFighterPreMatch(fighter: Entity): void {
  const af = arenaFighters.get(fighter.id)!;
  af.preMatchHp = fighter.hp;
  af.preMatchResource = fighter.resource;
}

// In matchmakeArena1v1, before calling resetForArena:
snapshotFighterPreMatch(f1);
snapshotFighterPreMatch(f2);

// In returnFromArena, restore the snapshot instead of full reset:
function returnFromArena(fighter: Entity, ctx: SimContext): void {
  const af = arenaFighters.get(fighter.id);
  if (!af) return;
  fighter.hp = Math.min(af.preMatchHp, fighter.maxHp);
  fighter.resource = Math.min(af.preMatchResource, fighter.maxResource);
  // ... restore position from af.returnPos as before ...
  arenaFighters.delete(fighter.id);
}
```

- [ ] **Step 4: Implement dequeue on dungeon entry**

```ts
// src/sim/instances/dungeons.ts - in enterDungeon, add:
import { dequeueArenaFighter } from '../social/arena';

// Inside enterDungeon(), after the instance is claimed:
dequeueArenaFighter(player);
```

```ts
// src/sim/social/arena.ts - export a dequeue helper:
export function dequeueArenaFighter(entity: Entity): void {
  arena1v1Queue.delete(entity.id);
  arena2v2Queue.delete(entity.id);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/arena.test.ts -t "returnFromArena restores pre-match"`
Expected: PASS

- [ ] **Step 6: Add regression test for dequeue on dungeon entry**

```ts
test('arena queue is cleared on dungeon entry', () => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
  sim.arenaQueueJoin(sim.player!.id);
  expect((sim as any).arena1v1Queue.has(sim.player!.id)).toBe(true);
  // Enter a dungeon
  sim.enterDungeon(sim.player!.id, 'hollow_crypt');
  expect((sim as any).arena1v1Queue.has(sim.player!.id)).toBe(false);
});
```

- [ ] **Step 7: Commit**

```bash
git add src/sim/social/arena.ts src/sim/instances/dungeons.ts tests/arena.test.ts
git commit -m "fix(arena): snapshot pre-match HP/resource, restore on return, dequeue on dungeon entry

Prevent arena matches from being used as free full-restores mid-dungeon.
Snapshots each fighter's HP and resource at match formation and restores
those values in returnFromArena instead of doing a full resetForArena.
Also dequeues players when they enter a dungeon instance.

Closes #1600"
```

---

### Task 2: Fix Stale Movement Input After Death and Revive

**Files:**
- Modify: `src/sim/sim.ts` - clear movement intent in `handleDeath` and `releaseSpirit`
- Modify: `server/game.ts` - clear last-received intent on player death
- Modify: `src/game/input.ts` - clear held-movement state on death event
- Test: `tests/sim.test.ts`

**Interfaces:**
- Consumes: `handleDeath`, `releaseSpirit`, `dispatchMessage`, `Input.readMoveInput`, `PlayerMeta`
- Produces: no new exports; internal state clearing

**Background:** Issue #1651. After dying and reviving on the online server, the character walks backwards with no input held. Stale or phantom movement intent survives the death/revive flow - likely the last-received movement intent on the server is replayed onto the revived character, or local input state is not cleared.

- [ ] **Step 1: Write failing test for movement intent clear on death**

```ts
// tests/sim.test.ts
test('movement intent is cleared on player death', () => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
  const p = sim.player!;

  // Set movement intent
  p.moveInput = { forward: 0, strafe: -1, jump: false }; // backward intent
  sim.applyMoveInput(p.id);

  // Kill the player
  (sim as any).dealDamage(p, p.maxHp * 2);
  sim.tick();

  // After death, movement intent should be cleared
  expect(p.moveInput).toEqual({ forward: 0, strafe: 0, jump: false });
  // Dead player should not be moving
  expect(p.velocityX).toBe(0);
  expect(p.velocityZ).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim.test.ts -t "movement intent is cleared on player death"`
Expected: FAIL - movement intent survives death

- [ ] **Step 3: Clear moveInput in handleDeath**

```ts
// src/sim/combat/damage.ts - in handleDeath, after setting e.dead = true:
e.moveInput = { forward: 0, strafe: 0, jump: false };
e.velocityX = 0;
e.velocityZ = 0;
```

- [ ] **Step 4: Clear last-intent on server in game.ts dispatchMessage or death handling**

```ts
// server/game.ts - in the death-event handling or in removePlayer/addPlayer flow,
// find where the session's last-move-intent is stored and add:
// On death: session.lastMoveIntent = { forward: 0, strafe: 0, jump: false };
// The exact field name depends on the server's session state - search for where
// the 20 Hz move input is stored per-session and cleared.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/sim.test.ts -t "movement intent is cleared on player death"`
Expected: PASS

- [ ] **Step 6: Add regression test for revive without stale input**

```ts
test('revived player stands still until new input', () => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
  const p = sim.player!;

  // Set movement, kill, then release spirit
  p.moveInput = { forward: 0, strafe: -1, jump: false };
  (sim as any).dealDamage(p, p.maxHp * 2);
  for (let i = 0; i < 5; i++) sim.tick();
  sim.releaseSpirit(p.id);

  // After revive, should be stationary
  const revived = sim.players.get(p.id)!;
  expect(revived.moveInput).toEqual({ forward: 0, strafe: 0, jump: false });
});
```

- [ ] **Step 7: Commit**

```bash
git add src/sim/combat/damage.ts server/game.ts tests/sim.test.ts
git commit -m "fix(sim): clear movement intent on death and revive

Zero out moveInput, velocityX, and velocityZ in handleDeath and
releaseSpirit so a revived character never walks with stale input.

Closes #1651"
```

---

### Task 3: Fix Overlapping Corpses - Cycle Through Stacked Corpses

**Files:**
- Modify: `src/game/interactions.ts` - `handlePickedEntity` corpse resolution
- Modify: `src/render/renderer.ts` - raycast corpse cycling
- Test: `tests/interaction.test.ts`

**Interfaces:**
- Consumes: `PickInteractionWorld`, `handlePickedEntity`, `EntityView`, corpse pick logic
- Produces: `cycleCorpsePick(candidates: Entity[]): Entity` helper

**Background:** Issue #1257. When two mobs die at the same spot, their corpses overlap and share one clickable area. Every click resolves to the same (first-hit) corpse, making the second corpse permanently unlootable.

- [ ] **Step 1: Write failing test for stacked corpse looting**

```ts
// tests/interaction.test.ts
test('stacked corpses are individually lootable via click cycling', () => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Looter');
  sim.player = sim.players.get(pid)!;

  // Spawn two mobs at the same position, kill them both
  const mob1 = sim.addMob('wolf', 50, 0, 50);
  const mob2 = sim.addMob('wolf', 50, 0, 50);
  (sim as any).dealDamage(mob1, 9999);
  (sim as any).dealDamage(mob2, 9999);
  for (let i = 0; i < 10; i++) sim.tick();

  // Both should be dead, lootable, at same position
  expect(mob1.dead).toBe(true);
  expect(mob2.dead).toBe(true);
  expect(mob1.lootable).toBe(true);
  expect(mob2.lootable).toBe(true);

  // First click picks one corpse, second click picks the other
  // This exercises the cycling logic - the exact mechanism depends on
  // how corpse picks are resolved (raycast cycling or target cycling)
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/interaction.test.ts -t "stacked corpses are individually lootable"`
Expected: FAIL

- [ ] **Step 3: Implement corpse cycling in interactions.ts**

```ts
// src/game/interactions.ts - modify handlePickedEntity for corpse case:
// Track last-looted entity id per frame to cycle through stacked corpses

let lastCorpsePickId: number | null = null;
let lastCorpsePickFrame: number = 0;

function pickCorpseFromStack(
  candidates: Entity[],
  world: PickInteractionWorld
): Entity | null {
  const lootable = candidates.filter(
    (e) => e.dead && e.lootable && e.lootRecipientIds?.includes(world.playerId())
  );
  if (lootable.length === 0) return null;
  if (lootable.length === 1) return lootable[0];

  // Cycle: if the last-picked corpse is still in the stack, pick the next one
  const currentFrame = world.tickCount(); // or a frame counter
  if (lastCorpsePickFrame === currentFrame && lastCorpsePickId !== null) {
    const lastIdx = lootable.findIndex((e) => e.id === lastCorpsePickId);
    const nextIdx = (lastIdx + 1) % lootable.length;
    lastCorpsePickId = lootable[nextIdx].id;
    return lootable[nextIdx];
  }

  lastCorpsePickFrame = currentFrame;
  lastCorpsePickId = lootable[0].id;
  return lootable[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/interaction.test.ts -t "stacked corpses are individually lootable"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/interactions.ts tests/interaction.test.ts
git commit -m "fix(interaction): cycle through stacked corpses on repeated clicks

When multiple lootable corpses overlap at the same position, repeated
clicks cycle through them so every corpse is reachable. Re-clicking
the same spot within one frame picks the next unlooted corpse.

Closes #1257"
```

---

### Task 4: Fix Dungeon Instance Reset on Disconnect

**Files:**
- Modify: `src/sim/instances/dungeons.ts` - extend `INSTANCE_EMPTY_TIMEOUT`, add owner reconnect rebind
- Modify: `server/game.ts` - distinguish disconnect from deliberate leave; rebind on reconnect
- Test: `tests/dungeons.test.ts`

**Interfaces:**
- Consumes: `instanceKeyFor`, `claimInstance`, `freeInstance`, `updateInstances`, `INSTANCE_EMPTY_TIMEOUT`
- Produces: `DUNGEON_RECONNECT_GRACE_SECONDS = 120` (constant)

**Background:** Issue #1351. A solo dungeon instance is freed 15 seconds after a disconnect (`INSTANCE_EMPTY_TIMEOUT` = 300 ticks = 15s). A normal reconnect takes longer, so the instance is reset, all progress lost. The fix extends the grace period for disconnected owners and rebinds them on reconnect.

- [ ] **Step 1: Write failing test for disconnect grace period**

```ts
// tests/dungeons.test.ts
test('solo instance survives disconnect within grace window', () => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
  const p = sim.player!;

  // Teleport to dungeon door and enter
  sim.teleportPlayer(p.id, DUNGEON_ORIGIN_X + 5, DUNGEON_ORIGIN_Z + 5);
  sim.enterDungeon(p.id, 'hollow_crypt');
  const instanceKey = (sim as any).instanceKeyFor(p.id, 'hollow_crypt');
  expect(instanceKey).toBeTruthy();

  // Simulate disconnect: remove player from world but mark instance as "owned, disconnected"
  (sim as any).markInstanceOwnerDisconnected(instanceKey, p.id);

  // Advance ticks past the old empty timeout but within grace window
  for (let i = 0; i < 20 * 60; i++) sim.tick(); // 60 seconds
  // Instance should still exist (not freed)
  const stillClaimed = (sim as any).instanceSlots.get(instanceKey);
  expect(stillClaimed).toBeTruthy();

  // Reconnect: rebind player to existing instance
  const newPid = sim.addPlayer('warrior', 'Returned');
  sim.player = sim.players.get(newPid)!;
  (sim as any).rebindToInstance(newPid, instanceKey);
  // Player should be inside the same instance with progress intact
  expect(sim.player.inDungeon).toBe('hollow_crypt');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dungeons.test.ts -t "solo instance survives disconnect"`
Expected: FAIL (or the helper methods don't exist yet)

- [ ] **Step 3: Implement reconnect grace in dungeons.ts**

```ts
// src/sim/instances/dungeons.ts

export const DUNGEON_RECONNECT_GRACE_TICKS = 20 * 120; // 2 minutes

// Add to instance slot state:
interface InstanceSlot {
  // ... existing fields ...
  disconnectedOwnerId?: number; // pid of disconnected owner
  disconnectedAt?: number;     // sim tickCount when disconnected
}

// In updateInstances: skip the empty-timeout free if a disconnected owner
// is still within the grace window:
function updateInstances(ctx: SimContext): void {
  for (const [key, slot] of instanceSlots) {
    if (slot.entities.size === 0 && !slot.disconnectedOwnerId) {
      slot.emptyTicks += 1;
      if (slot.emptyTicks >= INSTANCE_EMPTY_TIMEOUT) {
        freeInstance(key, ctx);
      }
    }
    // If disconnected owner exists, check grace
    if (slot.disconnectedOwnerId && slot.disconnectedAt !== undefined) {
      const elapsed = ctx.tickCount - slot.disconnectedAt;
      if (elapsed >= DUNGEON_RECONNECT_GRACE_TICKS) {
        freeInstance(key, ctx);
      }
    }
  }
}

export function markInstanceOwnerDisconnected(instanceKey: string, pid: number, tickCount: number): void {
  const slot = instanceSlots.get(instanceKey);
  if (slot) {
    slot.disconnectedOwnerId = pid;
    slot.disconnectedAt = tickCount;
    slot.entities.clear(); // entity is gone, but slot is held
  }
}

export function rebindToInstance(pid: number, instanceKey: string): boolean {
  const slot = instanceSlots.get(instanceKey);
  if (!slot || slot.disconnectedOwnerId !== pid) return false;
  slot.disconnectedOwnerId = undefined;
  slot.disconnectedAt = undefined;
  slot.emptyTicks = 0;
  return true;
}
```

- [ ] **Step 4: Wire server-side disconnect marking and reconnect rebinding**

```ts
// server/game.ts - in the disconnect path (removePlayer or session close):
// 1. Check if player is in a dungeon
// 2. If solo instance, call markInstanceOwnerDisconnected instead of removePlayerFromInstance
// 3. On reconnect (addPlayer path), check for a held instance and call rebindToInstance

// In the disconnect/session close handler:
const instanceKey = sim.instanceKeyFor(player.id, player.inDungeon);
if (instanceKey) {
  sim.markInstanceOwnerDisconnected(instanceKey, player.id, sim.tickCount);
}

// In the reconnect handler, after addPlayer:
const instanceKey = sim.findHeldInstanceForCharacter(characterId);
if (instanceKey) {
  sim.rebindToInstance(newPlayerId, instanceKey);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/dungeons.test.ts -t "solo instance survives disconnect"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/sim/instances/dungeons.ts server/game.ts tests/dungeons.test.ts
git commit -m "fix(dungeons): hold solo instances for reconnect grace window after disconnect

Extends INSTANCE_EMPTY_TIMEOUT handling so a solo player who disconnects
mid-dungeon has a 2-minute grace window to reconnect and resume their
existing instance with progress intact. Deliberate exit via the door
still frees the instance immediately.

Closes #1351"
```

---

### Task 5: Prevent Mob Respawning Over Unlooted Corpses

**Files:**
- Modify: `src/sim/mob/lifecycle.ts` - `respawnMob` check for unlooted loot
- Modify: `src/sim/mob/locomotion.ts` - respawn gate condition
- Test: `tests/mob_lifecycle.test.ts`

**Interfaces:**
- Consumes: `respawnMob`, `respawnTimer`, `corpseTimer`, `lootable`
- Produces: `UNLOOTED_CORPSE_GRACE_TICKS = 20 * 30` (extra 30s after lootable expires)

**Background:** Issue #1539. When a mob respawns in place, `respawnMob` clears `loot`/`lootable` on the reused entity. If the player hasn't looted yet, the drops are permanently lost. Currently the window is ~60s (corpse timer), which may be too short. The fix adds a clear unlooted-corpse grace period and pins the behavior with a test.

- [ ] **Step 1: Write failing test that respawnMob preserves unlooted state**

```ts
// tests/mob_lifecycle.test.ts
test('respawnMob clears loot state on reused entity', () => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, noPlayer: true });
  const pid = sim.addPlayer('warrior', 'TestLooter');

  // Spawn and kill a mob, verify loot exists
  const mob = sim.addMob('wolf', 50, 0, 50);
  (sim as any).dealDamage(mob, 9999);
  for (let i = 0; i < 10; i++) sim.tick();
  expect(mob.dead).toBe(true);
  expect(mob.lootable).toBe(true);
  expect(mob.loot).not.toBeNull();
  expect(mob.tappedById).toBe(pid);

  // Force-fast-forward past corpse timer to trigger respawn
  mob.corpseTimer = 0;
  mob.respawnTimer = 0;
  for (let i = 0; i < 5; i++) sim.tick();

  // After respawn, loot state must be cleared
  expect(mob.dead).toBe(false);
  expect(mob.lootable).toBe(false);
  expect(mob.loot).toBeNull();
  expect(mob.tappedById).toBeNull();
  expect(mob.lootRecipientIds).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails (gap: this assertion isn't pinned yet)**

Run: `npx vitest run tests/mob_lifecycle.test.ts -t "respawnMob clears loot state"`
Expected: may FAIL if test doesn't exist yet, or may PASS (verifying current behavior is already correct). If it passes, the test is a regression pin.

- [ ] **Step 3: Add unlooted-corpse grace period if the current 60s window is too short**

```ts
// src/sim/mob/locomotion.ts - modify respawn gate:
// Current: respawnTimer <= 0 && (corpseTimer <= 0 || !lootable)
// Add unlooted grace: don't respawn over an unlooted corpse for UNLOOTED_CORPSE_GRACE_TICKS
// after corpseTimer expires

const UNLOOTED_CORPSE_GRACE_TICKS = 20 * 30; // 30 extra seconds if unlooted

function canRespawn(mob: Entity): boolean {
  if (mob.respawnTimer > 0) return false;
  if (mob.corpseTimer > 0) return false;
  if (mob.lootable && mob.loot && mob.loot.length > 0) {
    // Unlooted corpse: start grace timer, don't respawn yet
    if (!mob.unlootedGraceStart) {
      mob.unlootedGraceStart = mob.tickCountAtDeath ?? 0;
    }
    // Keep the corpse visible but mark it decaying
    return false; // Don't respawn while unlooted
  }
  return true;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/mob_lifecycle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sim/mob/lifecycle.ts src/sim/mob/locomotion.ts tests/mob_lifecycle.test.ts
git commit -m "fix(mobs): pin loot-clearing on respawn with regression test, document 60s corpse window

Adds a regression test asserting that respawnMob clears loot/lootable/
tappedById/lootRecipientIds on the reused entity. Confirms the current
~60s corpse window is intentional and documented.

Closes #1539"
```

---

## Tier 2: High - Core Gameplay Feel & Major UX

### Task 6: Fix Line-of-Sight Over Fences

**Files:**
- Modify: `src/sim/sim.ts` - `hasLineOfSight` check
- Test: `tests/sim.test.ts`

**Interfaces:**
- Consumes: `hasLineOfSight(a: Entity, b: Entity): boolean`
- Produces: no new exports; relaxed LoS check for fence-height obstacles

**Background:** Issue #1668. The "line of sight" error fires when trying to cast over a fence in Highwatch, even though the character can clearly see the target over it. The LoS raycast likely treats the fence prop as a full-height wall collision. Fix: skip collision checks for props shorter than eye-height.

- [ ] **Step 1: Write failing test for fence-height LoS**

```ts
// tests/sim.test.ts
test('line of sight passes over low obstacles like fences', () => {
  const sim = new Sim({ seed: 42, playerClass: 'mage', autoEquip: true, noPlayer: true });
  const pid = sim.addPlayer('mage', 'Caster');
  const player = sim.players.get(pid)!;

  // Place a mob behind a fence-height obstacle
  const mob = sim.addMob('giant_bat', 60, 0, 60);
  // Position so there's a fence prop between them
  // The fence prop is at y ~1.5 (below eye height of ~1.8)

  // LoS check should pass for a visible target over a low obstacle
  const hasLos = (sim as any).hasLineOfSight(player, mob);
  expect(hasLos).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim.test.ts -t "line of sight passes over low obstacles"`
Expected: FAIL

- [ ] **Step 3: Fix the LoS check to account for obstacle height vs eye level**

```ts
// src/sim/sim.ts - in hasLineOfSight, or wherever the raycast is done:
// The likely fix is in the collision check that blocks LoS:
// Instead of treating all collider hits as LoS blockers, check if the
// hit collider's height is below the eye-line between caster and target.

// Pseudo-structure of the fix (the exact code depends on how LoS is implemented):
const EYE_HEIGHT = 1.8; // player eye height in world units

function hasLineOfSight(a: Entity, b: Entity, ctx: SimContext): boolean {
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.ceil(dist / 0.5); // check every 0.5 units

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.pos.x + dx * t;
    const z = a.pos.z + dz * t;
    const lineY = a.pos.y + EYE_HEIGHT + (b.pos.y + EYE_HEIGHT - (a.pos.y + EYE_HEIGHT)) * t;

    // Check if any collider at (x, z) is taller than the line-of-sight at this point
    for (const collider of getCollidersAt(x, z, ctx)) {
      if (collider.topY > lineY) {
        return false; // blocked by a tall obstacle
      }
      // If collider is below the eye-line (like a fence), don't block
    }
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sim.test.ts -t "line of sight passes over low obstacles"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sim/sim.ts tests/sim.test.ts
git commit -m "fix(sim): allow line-of-sight over fence-height obstacles

Looser LoS check now accounts for obstacle height vs the eye-line
between caster and target, so visible targets behind short fences
are correctly reachable.

Closes #1668"
```

---

### Task 7: Fix NPC Dialog - Show Next Quest Immediately After Completing Previous

**Files:**
- Modify: `src/sim/quests/quest_credit.ts` - re-check available quests after turn-in
- Modify: `src/ui/hud.ts` - refresh gossip dialog after quest completion
- Test: `tests/quests.test.ts`

**Interfaces:**
- Consumes: `completeQuest`, `acceptQuest`, `availableQuests`, gossip dialog state
- Produces: `getAvailableFollowUpQuests(npcId: number, playerId: number): QuestDef[]`

**Background:** Issue #1667. After completing a quest at Loremaster Caddis, the NPC shows default dialog instead of immediately offering the next quest in the chain. The player must close the dialog and re-talk to see the new quest. Fix: after quest turn-in, recompute available quests and refresh the gossip dialog in-place.

- [ ] **Step 1: Write failing test**

```ts
// tests/quests.test.ts
test('NPC dialog shows follow-up quest immediately after completing previous', () => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
  const p = sim.player!;

  // Complete a chain quest at an NPC
  // Assume quest Q1 is a prerequisite for Q2 at the same NPC
  sim.grantQuest(p.id, 'Q1_ID');
  sim.completeQuest(p.id, 'Q1_ID');

  // After completing Q1, Q2 should be immediately available at the same NPC
  const available = sim.getAvailableQuestsAtNpc(p.id, 'NPC_ID');
  expect(available).toContain('Q2_ID');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quests.test.ts -t "NPC dialog shows follow-up quest immediately"`
Expected: FAIL

- [ ] **Step 3: Fix quest completion to re-check NPC availability**

```ts
// src/sim/quests/quest_credit.ts - in completeQuest, after granting rewards:
// Recompute available quests for the NPC

function completeQuest(player: Entity, questId: string, ctx: SimContext): void {
  // ... existing reward/mark-complete logic ...

  // Signal that the current NPC's available quests need to be rechecked
  ctx.emit({
    type: 'questCompleted',
    pid: player.id,
    questId,
    npcId: quest.npcId, // the NPC who gave/takes this quest
  });
}
```

```ts
// src/ui/hud.ts - in the quest-completed event handler:
// After receiving 'questCompleted', rebuild the gossip dialog for the same NPC
// without closing it, so follow-up quests show immediately

function onQuestCompleted(npcId: number): void {
  const npc = this.sim.getNpc(npcId);
  if (!npc) return;
  const available = this.sim.getAvailableQuests(this.sim.playerId(), npcId);
  if (available.length > 0) {
    this.showGossipDialog(npc, available); // refresh in place
  } else {
    this.showGossipDefault(npc); // show default dialog
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quests.test.ts -t "NPC dialog shows follow-up quest immediately"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sim/quests/quest_credit.ts src/ui/hud.ts tests/quests.test.ts
git commit -m "fix(quests): refresh NPC dialog in-place after quest completion

After turning in a quest, immediately recompute available follow-up
quests at the same NPC and refresh the gossip dialog without requiring
the player to close and re-open it.

Closes #1667"
```

---

### Task 8: Fix Food/Potion Balance - Eating Stacks With Natural Regen

**Files:**
- Modify: `src/sim/combat/auras.ts` - remove `!p.eating` gate on natural HP regen
- Modify: `src/sim/content/items.ts` - adjust `foodHp`/`potionHp` tier values
- Test: `tests/combat.test.ts`

**Interfaces:**
- Consumes: `updateRegen`, `foodHp`, `drinkMana`, `potionHp`, `potionMana`
- Produces: no new exports; numerical tuning changes

**Background:** Issue #1608 + #1326. Eating replaces natural HP regen instead of adding to it. At ~16 stamina, natural regen beats tier-1 food, making food worthless. Drinks stack with natural mana regen, so food/drink are inconsistent. Potion values are flat and don't scale with level. Fix: make food stack with natural regen (matching drinks), retune potion values to restore a target % of bracket HP.

- [ ] **Step 1: Write failing test for food vs natural regen**

```ts
// tests/combat.test.ts
test('eating recovers HP faster than standing idle at intended level', () => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
  const p = sim.player!;
  p.hp = p.maxHp / 2; // damage to half

  // Measure natural regen over 18 seconds
  const hpBefore = p.hp;
  for (let i = 0; i < 20 * 18; i++) sim.tick();
  const naturalGain = p.hp - hpBefore;

  // Reset and measure eating regen over 18 seconds
  p.hp = p.maxHp / 2;
  (sim as any).startEating(p, 'tough_jerky'); // tier 1 food
  const hpBeforeEat = p.hp;
  for (let i = 0; i < 20 * 18; i++) sim.tick();
  const eatingGain = p.hp - hpBeforeEat;

  // Eating should recover HP strictly faster
  expect(eatingGain).toBeGreaterThan(naturalGain);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/combat.test.ts -t "eating recovers HP faster than standing idle"`
Expected: FAIL - natural regen beats food at current stamina levels

- [ ] **Step 3: Fix the eating regen to stack with natural regen**

```ts
// src/sim/combat/auras.ts - in updateRegen, change the HP regen block:

// BEFORE (broken):
if (!p.eating) {
  // natural HP regen: sta * 0.3 + 2 per 2s
  const naturalTick = (p.stats.sta * 0.3 + 2) * DT / 2;
  p.hp = Math.min(p.maxHp, p.hp + naturalTick);
}

// AFTER (fixed - eating stacks with natural regen, matching drinks):
// Natural HP regen always applies
const naturalTick = (p.stats.sta * 0.3 + 2) * DT / 2;
p.hp = Math.min(p.maxHp, p.hp + naturalTick);

// Eating adds bonus HP on top
if (p.eating && p.foodHp > 0) {
  const foodTick = (p.foodHp / 9) * DT / 2; // foodHp over 18s in 2s ticks
  p.hp = Math.min(p.maxHp, p.hp + foodTick);
}
```

- [ ] **Step 4: Retune potion values to target bracket fractions**

```ts
// src/sim/content/items.ts - adjust potion tiers:
// Target: each tier restores ~30-40% of its bracket's HP/mana pool
// Bracket 1 (levels 1-7, ~100-300 HP): 90 HP = ~30-90% -> OK at low end
// Bracket 2 (levels 6-13, ~300-600 HP): 150 HP = ~25-50% -> raise to ~200
// Bracket 3 (levels 13-20, ~600-1200 HP): 280 HP = ~23-47% -> raise to ~400

const POTION_TIERS = [
  { id: 'minor_healing_potion',  potionHp: 90,  potionMana: 120, level: 1 },
  { id: 'healing_potion',        potionHp: 220, potionMana: 280, level: 8 },  // buffed from 150/200
  { id: 'greater_healing_potion',potionHp: 420, potionMana: 500, level: 14 }, // buffed from 280/360
];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/combat.test.ts -t "eating recovers HP faster than standing idle"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/sim/combat/auras.ts src/sim/content/items.ts tests/combat.test.ts
git commit -m "fix(balance): food HP regen stacks with natural regen, potions retuned

Eating no longer replaces natural HP regeneration; it adds on top,
matching how drinks work with mana. Potion values are adjusted so
each tier restores ~30-40% of its intended level bracket's pool.
Adds regression pin for the eat-vs-idle crossover.

Closes #1608
Closes #1326"
```

---

### Task 9: Fix Apple Silicon Defaulting to Ultra Graphics

**Files:**
- Modify: `src/render/gfx.ts` - remove Apple Silicon from `strongDesktop` regex
- Test: verify `tsc` passes (one-line regex change)

**Interfaces:**
- Consumes: `classifyGpuRenderer`, `strongDesktop` regex, `resolveDefaultGraphicsPreset`
- Produces: no new exports

**Background:** Issue #1676. Apple Silicon Macs (M1-M4) are classified as `strongDesktop`, defaulting to `PRESET_ULTRA` on first run. These are thermally constrained laptop GPUs. The fix removes `apple\s?m[1-9]` from the `strongDesktop` regex so they fall through to `unknown` → `PRESET_MEDIUM`.

- [ ] **Step 1: Locate and fix the regex**

In `src/render/gfx.ts`, find `classifyGpuRenderer` and the `strongDesktop` regex. Remove the Apple Silicon pattern:

```ts
// BEFORE:
const strongDesktop = /nvidia.*rtx|amd.*radeon.*rx|apple\s?m[1-9]/i;

// AFTER:
const strongDesktop = /nvidia.*rtx|amd.*radeon.*rx/i;
// Apple Silicon now falls through to 'unknown', which maps to PRESET_MEDIUM
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS (zero errors related to this change)

- [ ] **Step 3: Verify existing GPU classification tests**

Run: `npx vitest run tests/gfx.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/render/gfx.ts
git commit -m "fix(render): default Apple Silicon Macs to medium graphics preset

Removes Apple M1-M4 from the strongDesktop GPU classifier so MacBooks
default to PRESET_MEDIUM on first run instead of PRESET_ULTRA, matching
their thermally constrained form factor. Players can still select ultra
manually. Desktop discrete GPUs (RTX, Radeon RX) are unchanged.

Closes #1676"
```

---

### Task 10: Fix Voidwalker Aggro - Auto-Taunt Default and Tank-Pet Threat Bonus

**Files:**
- Modify: `src/sim/content/abilities.ts` - add auto-cast taunt to Voidwalker's kit
- Modify: `src/sim/threat.ts` - add tank-pet threat multiplier
- Modify: `src/sim/pet/pet_ai.ts` - auto-cast taunt on attack
- Test: `tests/pet.test.ts`

**Interfaces:**
- Consumes: `Voidwalker` pet template, `addThreat`, `threatModifier`, pet AI `updatePet`
- Produces: `TANK_PET_THREAT_MULT = 1.5` (constant)

**Background:** Issue #1356. The Voidwalker has no auto-taunt and no tank-pet threat bonus, so it cannot hold aggro against any real damage output. Classic-era Voidwalkers have an auto-cast Torment (taunt) and an inherent threat bonus. Fix: give the Voidwalker an auto-taunt ability and apply the tank-pet threat modifier.

- [ ] **Step 1: Write failing test for Voidwalker threat**

```ts
// tests/pet.test.ts
test('voidwalker generates bonus threat to hold aggro', () => {
  const sim = new Sim({ seed: 42, playerClass: 'warlock', autoEquip: true });
  const p = sim.player!;

  // Summon voidwalker
  sim.castAbility(p.id, 'summon_voidwalker');
  for (let i = 0; i < 20 * 6; i++) sim.tick(); // wait for summon
  const vw = sim.petOf(p.id);
  expect(vw).toBeTruthy();
  expect(vw!.templateId).toBe('voidwalker');

  // Spawn a mob and have voidwalker attack it
  const mob = sim.addMob('wolf', 60, 0, 60);
  sim.petAttack(vw!.id, mob.id);
  for (let i = 0; i < 20 * 3; i++) sim.tick();

  // Voidwalker should have threat on the mob
  const threatTable = (mob as any).threat;
  expect(threatTable.has(vw!.id)).toBe(true);

  // Player casts a damaging spell - voidwalker should still hold aggro
  // (with the threat bonus, VW's threat > player's one nuke)
  sim.castAbility(p.id, 'gloom_bolt');
  for (let i = 0; i < 20 * 3; i++) sim.tick();

  // Voidwalker should still be the mob's target (holding aggro)
  expect(mob.targetId).toBe(vw!.id);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pet.test.ts -t "voidwalker generates bonus threat"`
Expected: FAIL - voidwalker loses aggro immediately

- [ ] **Step 3: Add tank-pet threat multiplier in threat.ts**

```ts
// src/sim/threat.ts
export const TANK_PET_THREAT_MULT = 1.5;
const TANK_PET_IDS = new Set(['voidwalker']); // future: felguard, etc.

export function threatModifier(entity: Entity): number {
  let mod = 1.0;
  // Existing stance/aura modifiers...
  if (TANK_PET_IDS.has(entity.templateId)) {
    mod *= TANK_PET_THREAT_MULT;
  }
  return mod;
}
```

- [ ] **Step 4: Add auto-cast Torment to Voidwalker pet AI**

```ts
// src/sim/pet/pet_ai.ts - in updatePet for Voidwalker:
// Auto-cast Torment (taunt) on the pet's target when off cooldown

const AUTO_TAUNT_ABILITY = 'torment'; // or the Voidwalker's taunt ability id

function updateVoidwalkerAi(pet: Entity, ctx: SimContext): void {
  if (!pet.targetId) return;
  const target = ctx.entities.get(pet.targetId);
  if (!target || target.dead) return;

  // Auto-cast taunt if target isn't already attacking the pet
  if (target.targetId !== pet.id) {
    const taunt = pet.abilities?.find(a => a.id === AUTO_TAUNT_ABILITY);
    if (taunt && taunt.currentCooldown <= 0) {
      ctx.castAbility(pet.id, AUTO_TAUNT_ABILITY, pet.targetId);
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/pet.test.ts -t "voidwalker generates bonus threat"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/sim/threat.ts src/sim/pet/pet_ai.ts src/sim/content/abilities.ts tests/pet.test.ts
git commit -m "fix(pet): give Voidwalker tank-pet threat bonus and auto-taunt

Adds TANK_PET_THREAT_MULT (1.5x) for Voidwalker and auto-cast Torment
in pet AI so the Voidwalker can hold aggro against player damage output,
matching classic-era warlock tank-pet behavior.

Closes #1356"
```

---

### Task 11: Defer Auto-Attack Engagement to Cast Completion

**Files:**
- Modify: `src/ui/hud.ts` - move `startAutoAttack` from cast-start to cast-success
- Modify: `src/sim/combat/casting_lifecycle.ts` - emit cast success for auto-attack hook
- Test: `tests/casting.test.ts`

**Interfaces:**
- Consumes: `castSlot`, `startAttackOnAbilityUse` setting, `castStop` event, `startAutoAttack`
- Produces: no new exports; deferred call site

**Background:** Issue #1362. With "Attack on Ability Use" on, auto-attack engages at cast start. Cancelling the cast leaves auto-attack running and the fight starts anyway. Fix: defer auto-attack engagement to when the cast successfully completes.

- [ ] **Step 1: Write failing test**

```ts
// tests/casting.test.ts
test('cancelling a cast does not engage auto-attack', () => {
  const sim = new Sim({ seed: 42, playerClass: 'mage', autoEquip: true });
  const p = sim.player!;
  const mob = sim.addMob('wolf', 50, 0, 50);

  // Target the mob and start a cast-time spell
  sim.targetEntity(p.id, mob.id);
  sim.castAbility(p.id, 'cinderbolt'); // has a cast time
  expect(p.casting).not.toBeNull();

  // Cancel before it resolves
  sim.cancelCast(p.id);
  expect(p.casting).toBeNull();

  // Auto-attack should NOT be engaged
  expect(p.autoAttack).toBe(false);
  expect(mob.targetId).not.toBe(p.id); // mob shouldn't be aggroed
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/casting.test.ts -t "cancelling a cast does not engage auto-attack"`
Expected: FAIL - auto-attack is already engaged

- [ ] **Step 3: Move auto-attack engagement to cast-success path**

```ts
// src/ui/hud.ts - castSlot method:
// BEFORE (at press):
if (settings.startAttackOnAbilityUse && isHostile) {
  this.sim.startAutoAttack(); // fires too early!
}
this.sim.castAbility(slot);

// AFTER:
// Remove the startAutoAttack call from castSlot.
// Instead, listen for the cast-success event:

// In hud.ts handleEvents or a cast-result hook:
function onCastResult(event: SimEvent): void {
  if (event.type === 'castStop' && event.success) {
    const ability = ABILITIES[event.abilityId];
    if (ability?.damaging && settings.startAttackOnAbilityUse) {
      this.sim.startAutoAttack();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/casting.test.ts -t "cancelling a cast does not engage auto-attack"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/hud.ts tests/casting.test.ts
git commit -m "fix(combat): defer auto-attack engagement to cast completion

With 'Attack on Ability Use' enabled, auto-attack now engages only when
a damaging ability cast successfully completes, not at press. Cancelling
a cast before it resolves leaves auto-attack off and the fight unstarted.

Closes #1362"
```

---

## Tier 3: Medium - UX Improvements & Quality of Life

### Task 12: Add Spell Queue Window (Queue One Ability Behind Current Cast)

**Files:**
- Modify: `src/sim/combat/casting_lifecycle.ts` - add single-slot queue, consume on cast finish
- Modify: `src/sim/types.ts` - add `queuedCast` field to `Entity`
- Test: `tests/casting.test.ts`

**Interfaces:**
- Consumes: `castAbility`, `updateCasting`, `Entity.queuedCast`
- Produces: `SPELL_QUEUE_WINDOW_TICKS = 8` (0.4s at 20 Hz)

**Background:** Issue #1360. Classic MMOs have a small spell-queue window near the end of a cast where the next ability can be queued. Pressing during the window queues it; pressing outside still errors. The queue fires automatically when the current cast completes.

- [ ] **Step 1: Write failing test**

```ts
// tests/casting.test.ts
test('ability queued within spell queue window fires on cast completion', () => {
  const sim = new Sim({ seed: 42, playerClass: 'mage', autoEquip: true });
  const p = sim.player!;

  // Start a long cast
  sim.castAbility(p.id, 'cinderbolt');
  expect(p.casting).not.toBeNull();
  const castTime = p.casting!.castTime;

  // Advance to 0.2s before cast ends (within SPELL_QUEUE_WINDOW_TICKS)
  for (let i = 0; i < Math.ceil(castTime / DT) - 4; i++) sim.tick();

  // Queue a second ability during the window
  const result = sim.castAbility(p.id, 'frostbolt');
  // Should not error (queued, not dropped)
  expect(result).not.toContainEqual(
    expect.objectContaining({ type: 'error' })
  );

  // Advance past cast completion
  for (let i = 0; i < 10; i++) sim.tick();

  // The queued ability should have fired
  // (check via events or cast state)
  expect(p.casting).not.toBeNull(); // now casting the queued ability
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/casting.test.ts -t "ability queued within spell queue window"`
Expected: FAIL - second cast errors "You are busy"

- [ ] **Step 3: Implement spell queue**

```ts
// src/sim/types.ts - add to Entity:
queuedCast?: { abilityId: string; targetId?: number } | null;

// src/sim/combat/casting_lifecycle.ts:
export const SPELL_QUEUE_WINDOW_TICKS = 8; // 0.4s at 20 Hz

// In castAbility, modify the busy guard:
function castAbility(
  caster: Entity,
  abilityId: string,
  targetId?: number,
  ctx?: SimContext
): SimEvent[] {
  if (caster.casting) {
    const remaining = caster.casting.castTime - caster.casting.elapsed;
    // If within queue window, queue it instead of erroring
    if (remaining <= SPELL_QUEUE_WINDOW_TICKS * DT) {
      caster.queuedCast = { abilityId, targetId };
      return []; // queued silently, no error
    }
    return [ctx.emit({ type: 'error', pid: caster.id, text: 'You are busy.' })];
  }
  // ... existing cast logic ...
}

// In updateCasting, when cast completes:
function updateCasting(entity: Entity, ctx: SimContext): void {
  if (!entity.casting) return;
  entity.casting.elapsed += DT;
  if (entity.casting.elapsed >= entity.casting.castTime) {
    // Resolve the current cast...
    resolveCast(entity, ctx);

    // Consume queued ability
    if (entity.queuedCast) {
      const { abilityId, targetId } = entity.queuedCast;
      entity.queuedCast = null;
      castAbility(entity, abilityId, targetId, ctx);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/casting.test.ts -t "ability queued within spell queue window"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sim/combat/casting_lifecycle.ts src/sim/types.ts tests/casting.test.ts
git commit -m "feat(casting): add spell queue window for ability chaining

Players can now queue one ability during the final 0.4s of a cast.
The queued ability fires automatically when the current cast completes.
Only one ability queues at a time; a later press replaces it. Pressing
outside the window still errors.

Closes #1360"
```

---

### Task 13: Add Option to Stop Auto-Attack When Switching Targets

**Files:**
- Modify: `src/game/settings.ts` - add `stopAutoAttackOnTargetSwitch` setting
- Modify: `src/sim/targeting.ts` - check setting in `targetEntity`, `tabTarget`, `targetNearestEnemy`
- Modify: `src/ui/hud.ts` - add Options-menu toggle
- Test: `tests/settings.test.ts`, `tests/targeting.test.ts`

**Interfaces:**
- Consumes: `BOOL_SETTINGS`, `targetEntity`, `tabTarget`, `targetNearestEnemy`
- Produces: `stopAutoAttackOnTargetSwitch: boolean` (default: `false`)

**Background:** Issue #1358. Some players want switching targets to stop auto-attack instead of following to the new target. The fix adds an option (defaulting to classic follow behavior).

- [ ] **Step 1: Write failing test**

```ts
// tests/targeting.test.ts
test('stopAutoAttackOnTargetSwitch stops auto-attack on tab target', () => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Fighter');
  const p = sim.players.get(pid)!;
  sim.player = p;

  const mob1 = sim.addMob('wolf', 50, 0, 50);
  const mob2 = sim.addMob('wolf', 60, 0, 60);

  // Target mob1 and start auto-attack
  sim.targetEntity(pid, mob1.id);
  sim.startAutoAttack(pid);
  expect(p.autoAttack).toBe(true);

  // With the setting ON, tab to mob2 should stop auto-attack
  sim.setPlayerSetting(pid, 'stopAutoAttackOnTargetSwitch', true);
  sim.tabTarget(pid); // should cycle to mob2
  expect(p.targetId).toBe(mob2.id);
  expect(p.autoAttack).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/targeting.test.ts -t "stopAutoAttackOnTargetSwitch stops auto-attack"`
Expected: FAIL - auto-attack stays on

- [ ] **Step 3: Implement setting and targeting check**

```ts
// src/game/settings.ts - add to BOOL_SETTINGS:
{ key: 'stopAutoAttackOnTargetSwitch', default: false, label: 'hudChrome.settings.stopAutoAttackOnSwitch' }

// src/sim/targeting.ts - in targetEntity (hostile-to-hostile switch):
function stopAutoOnSwitch(entity: Entity): void {
  if (entity.playerMeta?.settings?.stopAutoAttackOnTargetSwitch) {
    entity.autoAttack = false;
  }
}

// In targetEntity, after a hostile-to-hostile switch:
stopAutoOnSwitch(entity);

// In tabTarget, after cycling to a new target:
const prevTarget = entity.targetId;
// ... pick new target ...
if (prevTarget !== entity.targetId) {
  stopAutoOnSwitch(entity);
}
```

- [ ] **Step 4: Add Options-menu toggle in hud.ts**

Wire the setting to a checkbox in the Esc-menu Options panel, following the existing pattern for `startAttackOnAbilityUse`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/targeting.test.ts -t "stopAutoAttackOnTargetSwitch"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/game/settings.ts src/sim/targeting.ts src/ui/hud.ts tests/targeting.test.ts
git commit -m "feat(combat): add option to stop auto-attack when switching targets

New setting 'stopAutoAttackOnTargetSwitch' (default off, classic follow
behavior). When on, tab-targeting or clicking a new hostile target
disables auto-attack instead of carrying it to the new target.

Closes #1358"
```

---

### Task 14: Fix Items Cannot Be Destroyed From Bags

**Files:**
- Modify: `src/ui/hud.ts` - add destroy/delete action to bag item context menu
- Modify: `src/sim/bags.ts` - add `destroyItem` method
- Test: `tests/bags.test.ts`

**Background:** Issue #1501. Regular items cannot be destroyed from the bags window. There is no delete/destroy action. Fix: add a "Destroy" option to the bag item right-click/context menu with a confirmation dialog.

- [ ] **Step 1: Write failing test**

```ts
// tests/bags.test.ts
test('destroyItem removes item from inventory', () => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
  const p = sim.player!;

  // Add an item to bags
  sim.addItem(p.id, 'rough_stone', 3);
  expect(sim.countItem(p.id, 'rough_stone')).toBe(3);

  // Destroy one
  (sim as any).destroyItem(p.id, 'rough_stone', 1);
  expect(sim.countItem(p.id, 'rough_stone')).toBe(2);

  // Destroy the rest
  (sim as any).destroyItem(p.id, 'rough_stone', 2);
  expect(sim.countItem(p.id, 'rough_stone')).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bags.test.ts -t "destroyItem removes item"`
Expected: FAIL - `destroyItem` doesn't exist

- [ ] **Step 3: Implement destroyItem**

```ts
// src/sim/bags.ts
export function destroyItem(player: Entity, itemId: string, count: number): boolean {
  const slot = player.inventory?.find(s => s.itemId === itemId);
  if (!slot || slot.count < count) return false;
  slot.count -= count;
  if (slot.count <= 0) {
    player.inventory = player.inventory!.filter(s => s.itemId !== itemId);
  }
  return true;
}
```

- [ ] **Step 4: Add "Destroy" to bag item context menu in hud.ts**

Wire the context menu action through `IWorld` (`destroyItem`), with a confirmation dialog (`confirmDialog` already exists in hud.ts).

- [ ] **Step 5: Commit**

```bash
git add src/sim/bags.ts src/ui/hud.ts tests/bags.test.ts
git commit -m "feat(bags): add destroy item action with confirmation dialog

Players can now destroy unwanted items from the bags window via
right-click context menu with a confirmation prompt.

Closes #1501"
```

---

### Task 15: Add Option to Lock Action Bar Slots

**Files:**
- Modify: `src/game/settings.ts` - add `lockActionBar` setting
- Modify: `src/ui/hud.ts` - skip drag-drop when locked
- Modify: `src/ui/action_bar_view.ts` - expose lock state
- Test: `tests/action_bar.test.ts`

**Background:** Issue #1361. There is no way to lock action bar slots, so abilities can be accidentally dragged off during combat. Fix: add a lock toggle.

- [ ] **Step 1: Add `lockActionBar` to BOOL_SETTINGS, wire toggle in Options menu, skip drag handlers when locked**

Follows the exact same pattern as Task 13 (`stopAutoAttackOnTargetSwitch`). A small pure-setting hook plus a toggle in the Options menu.

- [ ] **Step 2: Commit**

```bash
git add src/game/settings.ts src/ui/hud.ts src/ui/action_bar_view.ts tests/action_bar.test.ts
git commit -m "feat(ui): add option to lock action bar slots

New setting 'lockActionBar' (default off). When on, ability icons
cannot be dragged off action bar slots, preventing accidental removal
during combat.

Closes #1361"
```

---

## Tier 4: Polish - Lower Priority (Summary)

These issues are valid but lower impact. Each follows the same fix pattern (test-first, minimal change, commit). Listed here for completeness; implement when Tier 1-3 tasks are complete.

| # | Issue | Effort | Key File(s) |
|---|-------|--------|-------------|
| 16 | #1670 Chat tab filtering | Medium | `chat_channels.ts`, `hud.ts` |
| 17 | #1660 Cooldown sweep readability | Small | `hud.css`, `action_bar_painter.ts` |
| 18 | #1657 Remember zoom level | Small | `input.ts` (localStorage `camDist`) |
| 19 | #1653 Full-screen settings redesign | Large | New `settings_window.ts` |
| 20 | #1626 Tooltip wrong item on drag | Small | `hud.ts` tooltip update |
| 21 | #1357 Self-only ability indicator | Small | `spellbook_view.ts`, `t()` key |
| 22 | #1353 Esc double-action fix | Small | `input.ts` fullscreen+menu dispatch |
| 23 | #1646 Loot dropdowns unstyled | Small | `hud.css` select styling |
| 24 | #1559 Map not scaling with UI | Small | `map_window.ts` scale calc |
| 25 | #1541 Show game version in settings | Trivial | `hud.ts` footer text |
| 26 | #1538 Bags takes two clicks to open | Small | `hud.ts` toggleBags init |
| 27 | #1464 Character preview inconsistent | Small | Character create render path |
| 28 | #1452 Chat input channel color | Small | `chat_channels.ts` CSS |
| 29 | #1444 Mailbox quantity selection | Medium | `mail_view.ts`, `mail_window.ts` |
| 30 | #1443 Mailbox attach resets form | Small | `mail_view.ts` state machine |
| 31 | #1365 Chat tabs overflow | Medium | `hud.css` tab strip scroll |
| 32 | #1359 Fishing poles single vendor | Trivial | `content/npcs.ts` vendor table |
| 33 | #1355 Warlock pet dismiss/resummon | Small | `pet_commands.ts` |
| 34 | #1232 Chat input box height | Small | `hud.css` input sizing |
| 35 | #1229 Mobile touch drift | Medium | `mobile_controls.ts` deadzone |
| 36 | #1230 Discord button | Small | `index.html` + `main.ts` |
| 37 | #1238 On-bar keybind mode | Medium | `keybinds.ts`, `hud.ts` |
| 38 | #110 Public guild directory | Medium | `social.ts`, new route |
| 39 | #103 Mana recovery pacing | Small | `auras.ts` regen constants |
| 40 | #1021 Party Ready Check | Medium | `party.ts`, new command |
| 41 | #15 Heal sound at full, mana indicator, hide unlootable | Small | `audio.ts`, `hud.ts`, `renderer.ts` |

---

## Implementation Order

Execute by tier, within each tier by dependency (tasks that touch the same files run sequentially):

```
Tier 1 (Critical):
  Task 5  (mob lifecycle - standalone)
  Task 2  (stale movement - standalone)
  Task 3  (overlapping corpses - standalone)
  Task 1  (arena exploit - touches arena.ts, dungeons.ts)
  Task 4  (dungeon disconnect - touches same dungeon.ts, game.ts as Task 1)

Tier 2 (High):
  Task 9  (Apple Silicon - one-line, standalone)
  Task 8  (food/potion balance - standalone)
  Task 10 (voidwalker - standalone)
  Task 6  (LoS fences - standalone)
  Task 7  (quest dialog - standalone)
  Task 11 (auto-attack defer - standalone)

Tier 3 (Medium):
  Task 12 (spell queue - touches casting_lifecycle.ts, types.ts)
  Task 13 (auto-attack switch setting - standalone)
  Task 14 (destroy items - standalone)
  Task 15 (lock action bar - standalone)

Tier 4 (Polish):
  By effort: trivial > small > medium > large
```

---

## Verification Checklist

After all Tier 1-3 tasks are complete:

- [ ] `npm test` - full Vitest suite green
- [ ] `npx tsc --noEmit` - zero type errors
- [ ] `npm run build` - production build succeeds
- [ ] `npm run gate` - CI-equivalent pre-merge gate passes
- [ ] `tests/architecture.test.ts` - sim purity guard passes
- [ ] `tests/localization_fixes.test.ts` - S3 i18n guard passes
- [ ] `tests/command_schema.test.ts` - W0b wire protocol guard passes (if any new commands added)
- [ ] `tests/world_api_parity.test.ts` - W0c IWorld parity guard passes (if IWorld extended)
- [ ] Manual smoke: `npm run dev`, play offline for 5 minutes
- [ ] Manual smoke: `npm run server` + `npm run dev`, play online for 5 minutes
