// Deeds records: an OBSERVER of the sim's deedUnlocked events, never an
// authority. The sim alone decides unlocks (src/sim/deeds.ts grantDeed) and
// persists them inside the characters.state blob; this module only mirrors
// each unlock into the queryable character_deeds index. It copies the
// bank_ledger runtime shape minus the diffing (deeds are event-driven, so
// there is no before/after snapshot to compare): each insert chains onto a
// per-process FIFO promise tail the game loop NEVER awaits, a rejected insert
// logs and never blocks or reorders anything, and the whole body is guarded
// so the observer can never throw into the caller. Idempotence lives in the
// SQL (ON CONFLICT DO NOTHING over UNIQUE (character_id, deed_id)), so retro
// re-emits on every login and crash-replays are free.

import type { DeedDef } from '../src/sim/types';
import { insertCharacterDeed } from './deeds_db';
import { REALM } from './realm';

// Per-process FIFO tail. A character lives on one realm process, so chaining
// preserves that character's unlock order; a rejection is caught (logged) and
// the chain continues.
let tail: Promise<void> = Promise.resolve();

/** The marquee bar for the guild/friend broadcast: notable-or-better Renown,
 *  or any cosmetic reward. Pure so the gate is unit-testable. */
export function isMarqueeDeed(def: DeedDef): boolean {
  return def.renown >= 25 || def.reward !== undefined;
}

/** Mirror one sim-decided unlock into character_deeds, fire-and-forget.
 *  Returns void immediately (never a promise, never awaited by the game
 *  loop); gameplay never depends on the write landing. */
export function recordDeedUnlock(
  who: { characterId: number; accountId: number },
  deedId: string,
): void {
  try {
    tail = tail
      .then(() =>
        insertCharacterDeed({
          realm: REALM,
          characterId: who.characterId,
          accountId: who.accountId,
          deedId,
        }),
      )
      .catch((err) => {
        console.error('character_deeds write failed:', err);
      });
  } catch (err) {
    // The observer must never fault the event-routing path.
    console.error('deeds recordDeedUnlock failed:', err);
  }
}

/** The current FIFO tail, for tests to await the queue draining deterministically. */
export function deedRecordsIdle(): Promise<void> {
  return tail;
}
