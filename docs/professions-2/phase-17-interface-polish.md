# Phase 17: Interface polish (crafting window + archetype ring window)

> Part of the ship-side finishing packet (P16 to P20). One branch
> (`fix/professions-2-phase-15-requa`), no PR until P20, no paired QA file:
> the VERIFY section below is mandatory and P20 runs the consolidated
> fresh-eyes QA. The standing rules block in
> `phase-16-enchant-trim.md` binds this session too (STEP 0 release sync,
> Node 26 gate recipe, no new phase vocabulary, no GitHub issues, M16 fills,
> memory list, verify subagent claims).

## Why this phase exists

The maintainer's direction, verbatim in spirit: we are an MMORPG that wants a
beautiful, spacious UI/UX, consistent with the recent windows. The crafting
window needs tabs or an otherwise better structure; the archetype (wheel/ring)
window squishes its text badly. The new root DESIGN.md HAS LANDED and these
windows should be built on it. This feature must look absolutely beautiful.

## STEP 1: study before touching anything

1. Read root DESIGN.md end to end (it landed after the packet's UI phases, so
   the professions windows predate it).
2. Identify the exemplar windows: `git log --oneline` the recent release
   history for UI windows (known candidates: the charge-pool UI #2276, the
   spellbook grid #2102, the mail parcel and tooltip work, the side-rail
   split #2177) and READ their view-core/painter/styles to extract the
   design language in practice: spacing scale, tokens, chrome, typography,
   how they breathe.
3. Read the local contracts: src/ui/CLAUDE.md, src/ui/hud/CLAUDE.md,
   src/styles/CLAUDE.md, and the existing crafting/wheel implementations
   (Phase 5 wheel: profession_identity_view and the ring painter; Phase 6
   crafting window family).
4. Capture BEFORE screenshots (desktop and mobile) of every surface you will
   touch, first thing, before any edit.

## Scope

Deep rebuilds (the two named targets):
1. **Crafting window**: restructure for clarity and beauty; tabs are the
   maintainer's suggestion, layout discretion is this session's as long as
   the result is spacious, consistent with the exemplars, and loses no
   information or actions (recipe list, reagent rows, tier coloring, combo
   gating, station state, craft/queue actions, celebration hooks).
2. **Archetype ring window**: fix the text squish, give the ring room to
   breathe, DESIGN.md tokens throughout. The ring stays DOM nodes styled from
   tokens (the Phase 5 decision; theme and language switches restyle free).
   COMPOSE profession_identity_view, never absorb it (locked ruling: the
   crafting window and quest dialog also consume it).

Included small items (settled by the maintainer 2026-07-22):
- The two Phase 5 copy calls: hide the switch-cost line for never-attuned
  full-mode players; finalize the specialized-corner CTA copy (new key plus
  its five non-Latin fills).
- The #ffd100 seal idiom moves to DESIGN.md tokens.

Consistency sweep (cheap fixes in-session, structural findings deferred with
screenshots to the maintainer's review): training rows, enchant-apply view,
commission opt-in surface, unbind window, deeds-board professions rows, the
profession intro hint row.

## Constraints (all pre-existing, all binding)

- Pure view-core plus thin painter recipe: DOM-free cores registered in
  UI_PURE_CORES (tests/architecture.test.ts), HUD-domain components under
  src/ui/hud/<domain>/ behind the index.ts barrel, painters write-elided on
  the PainterHost seam. Reuse a FAMILY before bespoke.
- Every new or reworded player-visible string is a t() key with M16 non-Latin
  fills; reworded existing keys refresh their non-Latin fills in the same
  change and strip stale Latin fills to pending.
- Graphics-settings fairness: nothing actionable hidden behind a preset.
- Mobile: layouts, tap targets, safe areas; the More-tray and rail budgets
  (NOTE: the side rail is AT CAPACITY per the Phase 5 record; if the rebuild
  touches the launcher, tests/crafting_launcher.test.ts height budgets bind).
- Keybinds unchanged (Shift+P wheel, existing crafting entry points).
- Per-frame budget: no per-frame allocation regressions in painters.
- No new dependencies; no canvas ring rewrite.

## Deliverables

1. The two rebuilt windows on DESIGN.md tokens, both hosts (the windows read
   IWorld only; no facet changes expected, flag immediately if one appears
   necessary and add it to BOTH worlds plus the parity pin).
2. Updated or new view-core tests for every layout decision that is model
   logic (tab selection, row grouping, truncation rules); painter DOM-surface
   pins per the existing suites' idiom.
3. AFTER screenshots, desktop and mobile, committed under
   docs/screenshots/professions-2-phase-17/ (git add -f per the screenshots
   memory; BROWSER_PATH recipe in the pr-screenshots skill and memory), plus
   a before/after pairing note for the eventual PR body.
4. The consistency-sweep findings list: applied fixes and deferred items with
   shots.

## VERIFY (mandatory, in-session)

- Matrix at the untouched tip first: npx vitest run tests/crafting_window*
  tests/profession_identity* tests/crafting_launcher.test.ts
  tests/crafting_view_combo_liveness.test.ts tests/prof_intro_hint.test.ts
  tests/prof_intro_hint_online.test.ts (adjust to the real file names found);
  npx tsc --noEmit.
- After: the same batch, the FULL i18n suite pair
  (tests/i18n_completeness.test.ts, tests/localization_coverage.test.ts),
  and a LIVE probe of both windows in the dev client (puppeteer with
  --use-angle=swiftshader --enable-unsafe-swiftshader; the probe recipes and
  traps live in the professions-2-program memory: HMR kills CDP probes
  mid-run, sequence probes vs edits strictly).
- Dispatch FRESH frontend-seam-reviewer and qa-checklist agents over the diff
  (30-tool-call budgets, report-first).
- A fresh-eyes coverage subagent over the whole session diff.
- Full npm run gate under Node 26, judged by GATE_EXIT= only.

## Wrap-up duties

Commits with explicit paths and bodies (screenshots in their own commit); NO
PR. Append the phase note plus RE-AUDIT EMPHASIS paragraph (what was styled by
judgment vs pinned by test, any deferred structural findings) to
docs/professions-2/progress.md. Record surprises to memory. If the rebuild
was large, note the file map for P20's scrub (new files need no scrubbing if
they were written phase-free).

## Starter prompt

```
This is Phase 17 of the Professions 2.0 finishing packet (P16 to P20): the
interface polish pass. Model: Fable 5, xhigh effort (ultracode on). Harness:
Claude Code.

Read docs/professions-2/phase-17-interface-polish.md from the worktree
~/Documents/woc-p15-requa (branch fix/professions-2-phase-15-requa) and
execute it: STEP 0 release sync per the standing rules in
phase-16-enchant-trim.md, then the study step (DESIGN.md plus the recent
exemplar windows) BEFORE touching anything, then the two deep rebuilds
(crafting window, archetype ring window) plus the included copy calls and the
consistency sweep, on DESIGN.md tokens, under the frontend contracts
(pure-core plus painter, UI_PURE_CORES, i18n with M16 fills, mobile, fairness,
rail budget). Before and after screenshots desktop and mobile are
deliverables. Use a Workflow build fan-out with disjoint file ownership if
the rebuild splits cleanly (await every parallel call; see the
workflow-parallel-missing-await memory). Run the full VERIFY section, then
the wrap-up duties including the RE-AUDIT EMPHASIS paragraph for P20. NO PR,
no GitHub issues; the branch is the history. The bar is: beautiful, spacious,
consistent with the newest windows in the game.
```
