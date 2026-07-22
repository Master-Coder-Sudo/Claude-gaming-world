# Phase 19: Name originality sweep + wiki truth pass

> Part of the ship-side finishing packet (P16 to P20). One branch
> (`fix/professions-2-phase-15-requa`), no PR until P20, no paired QA file.
> The standing rules block in `phase-16-enchant-trim.md` binds this session
> (STEP 0 release sync, Node 26 gate, no new phase vocabulary, no GitHub
> issues, M16 fills, memory list, verify subagent claims).

## Why this phase exists

Maintainer directive: every profession-related name must be original to this
game and free of other games' IP. Anything that collides with a distinctive
coin from another game gets renamed. Separately, the wiki gets its final
truth pass now that P16 (enchant numbers), P17 (window UX), and P18 (fixes)
have settled the system.

## Part 1: the originality sweep

Name classes to sweep (player-visible names, not internal ids):
- Items: gathered materials, harvest components, specimens, vendor reagents,
  fish, crafted outputs, enchanting materials (dust/essence/shard names),
  tool names.
- Recipes and enchant display names (incl. the Runed family).
- Deeds and their titles (incl. the marquee titles wired to Steam).
- NPCs (masters, spokesman, vendors involved in professions).
- Archetype pair titles (Smith, Outfitter, Apothecary, Bombardier, Trapper,
  Mageweaver, Arcanist, Gembinder, Bladewright, Cogsmith).
- Quest names, guild letters, station names, and distinctive guide coins
  (for example "Ravenpost").

Method: enumerate the full name list from src/sim/content/ (a tsx script),
then a Workflow web-search fan-out checking each DISTINCTIVE coin against the
major MMO and fantasy properties (WoW, RuneScape, FFXIV, GW2, ESO, LotRO,
D&D, MtG). Classification rule: real words and generic fantasy compounds are
FINE (copper ore, rough hide, smithing flux); distinctive invented coins that
match another game's distinctive coin are COLLISIONS (rename). Judgment calls
go in the table with a recommendation.

Known suspects to check first (from the RE-QA session's memory, verify, do
not assume): silverleaf_herb (a Warcraft herb name), arcanite_bar (a
distinctive Warcraft coin), glimmerfin (check against Warcraft murloc
naming), runeweave, thorium (a real element, likely defensible), any
"Elixir of the X" patterns matching famous recipes.

Rename mechanics (this is the part that keeps saves safe):
- Content shipped in v0.28.0 or earlier IS in live saves: rename the DISPLAY
  NAME only (ItemDef.name, deed name/desc text, NPC display name); ids stay.
  Ids are never player-visible.
- Content that exists only on release/v0.29.0 (never launched: fishing items,
  Phase 15 deeds, and similar): id renames are allowed where consistency is
  worth it, using the shipped-items golden hand-swap recipe (the golden is
  append-only; a rename needs a hand row-swap so the diff stays honest).
  Determine shipped-vs-unshipped by which release each id first landed in,
  not by guessing.
- Deed IDS never change regardless (catalog append-only; the frozen digest
  canonicalizes id/trigger/renown). Deed NAMES and titles are i18n text and
  rename freely.
- Renamed marquee deeds: note them in the wrap note so the maintainer updates
  the Steam partner-site display names later (the ACH id mapping in
  server/steam/achievement_map.ts does not change).

i18n consequences (binding): every renamed player-visible string refreshes
its five non-Latin fills in the SAME change (the M16 completeness gate
forbids English fallback, and leaving old-name translations in place would
recreate the exact stale-fill class the RE-QA cleaned up); stale Latin fills
strip to pending. Check tests/i18n_semantic_regressions.test.ts for pins on
any renamed key FIRST (the reword-staleness trap) and re-point in the same
change.

Also in this part: fix the raw_stonescale_carp id/name mismatch (a Phase 15
deferral; v0.29.0-only, so either side may move).

## Part 2: the wiki truth pass

1. Regen: npm run wiki:content picks up P16 numbers and Part 1 renames
   automatically (tests/guide.test.ts freshness-gates it).
2. Prose sweep: read the professions guide prose (src/ui/i18n.catalog/guide.ts
   and the per-skill pages) against the final system: enchant magnitudes and
   the new convention, any window/UX references P17 changed, renamed
   entities, fee and economy claims. Fix every stale claim; every reword
   follows the i18n rule above.
3. The transparency policy holds: exact numbers, not vague ranges.
4. Verify the generated tables one more time by sampling: three recipe rows,
   three enchant rows (post-trim), three fee rows, against src/sim/ ground
   truth with file citations in the wrap note.

## Deliverables

1. The rename table: every swept name, classification, evidence for each
   collision (what it collided with, where), old and new name, and the
   save-safety class (display-only vs id). The table goes in the wrap note
   verbatim; it is the maintainer's review surface in the eventual PR.
2. The renames applied, with i18n refreshed per the rule above.
3. The wiki regen plus prose fixes.
4. Convention-suite runs for any item changes: tests/ip_scrub (the G0
   denylist), tests/item_level, tests/twohand_rebudget, tests/weapon_skins,
   tests/item_icons (the five suites the packet learned catch item-content
   conventions), plus the shipped-items golden test.

## VERIFY (mandatory, in-session)

- Matrix at the untouched tip first: the five convention suites,
  tests/deeds_content.test.ts, tests/deed_i18n.test.ts, tests/guide.test.ts,
  tests/i18n_completeness.test.ts, tests/localization_coverage.test.ts,
  tests/parity/ (renames must not touch draws; goldens with renamed STATE
  strings will need a deliberate regen commit if display names appear in
  golden state, verify byte-what-changed), tsc.
- After: same batch; any golden regen isolated in its own commit with the
  byte-level justification (names only, draws identical).
- Dispatch: qa-checklist plus test-coverage-auditor; architecture-reviewer if
  any src/sim file beyond content tables was touched.
- A fresh-eyes coverage subagent over the whole session diff.
- Full npm run gate under Node 26, judged by GATE_EXIT= only (the malware
  scanner rewording trap binds: avoid wallet-seed vocabulary in comments).

## Wrap-up duties

Commits with explicit paths and bodies (renames grouped by class, wiki pass
separate); NO PR. Append the phase note with the FULL rename table and the
RE-AUDIT EMPHASIS paragraph (judgment-call classifications, anything renamed
without a perfect substitute) to docs/professions-2/progress.md. Record
surprises to memory.

## Starter prompt

```
This is Phase 19 of the Professions 2.0 finishing packet (P16 to P20): the
name originality sweep and the wiki truth pass. Model: Fable 5, xhigh effort
(ultracode on). Harness: Claude Code.

Read docs/professions-2/phase-19-originality-and-wiki.md from the worktree
~/Documents/woc-p15-requa (branch fix/professions-2-phase-15-requa) and
execute it: STEP 0 release sync per the standing rules in
phase-16-enchant-trim.md, then enumerate every profession-related
player-visible name, run the web-search collision fan-out (Workflow; await
every parallel call), classify with evidence, apply the renames under the
save-safety rules (display-only for shipped content, id renames allowed for
never-launched v0.29.0 content via the golden hand-swap recipe, deed ids
never), refresh the five non-Latin fills for every renamed string in the same
change, fix raw_stonescale_carp, then run the wiki truth pass (regen plus
prose sweep against the final system). Run the full VERIFY section, then the
wrap-up duties: the rename table verbatim in the progress.md note plus the
RE-AUDIT EMPHASIS paragraph for P20. NO PR, no GitHub issues; the branch is
the history. When a name is borderline, prefer renaming with a better
original coin over defending a collision.
```
