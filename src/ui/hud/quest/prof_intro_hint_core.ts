// Pure decision for the profession-introduction hint row in the NPC gossip
// dialog (Phase 15 QA directed fix, the letter-to-Haldren dead end): an
// unattuned player who follows the Guild trend letter to Smith Haldren before
// completing q_prof_intro used to see only greeting plus vendor, because
// Haldren's one quest (q_prof_hobby_switch) is gated behind the intro. The
// dialog now shows one short non-interactive line pointing at the intro
// quest's giver (Foreman Odell) until the intro is completed.
//
// Surface: Smith Haldren (the letter's named spokesman) PLUS the six resident
// station masters (STATIONS masterNpcId via train_view's isStationMasterNpc),
// since renderGossip is shared and the gate is one template-id check.
//
// Semantics, pinned by tests/prof_intro_hint.test.ts: the row shows in EVERY
// q_prof_intro state except 'done' (available, active, ready, unavailable).
// While the intro is merely accepted or ready it still points home to the
// giver/turn-in NPC; only completion retires it.

import type { QuestState } from '../../../sim/types';
import { isStationMasterNpc } from '../vendor/train_view';

/** The professions onboarding quest the hint row points at (zone1.ts). */
export const PROF_INTRO_QUEST_ID = 'q_prof_intro';

/** The i18n key of the hint row's text (questUi.dialog, quests catalog). */
export const PROF_INTRO_HINT_KEY = 'questUi.dialog.profIntroHint';

/** The Guild trend letter's named destination (content/letters.ts). */
export const GUILD_LETTER_SPOKESMAN_NPC_ID = 'smith_haldren';

/** True for the NPCs whose gossip dialog carries the hint row: the letter's
 *  spokesman plus every resident station master (template id, never an
 *  entity id). */
export function isProfessionMasterNpc(templateId: string): boolean {
  return templateId === GUILD_LETTER_SPOKESMAN_NPC_ID || isStationMasterNpc(templateId);
}

/** Whether the hint row renders for this NPC given the viewer's q_prof_intro
 *  state (IWorld.questState, so it holds in both the offline Sim and the
 *  online ClientWorld). */
export function professionIntroHintVisible(templateId: string, introState: QuestState): boolean {
  return isProfessionMasterNpc(templateId) && introState !== 'done';
}
