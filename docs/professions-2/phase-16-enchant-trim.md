# Phase 16: Enchanting stat trim (release-blocking)

> Ship-side finishing packet (P16 to P20), authored 2026-07-22 by the Phase 15
> RE-QA session under maintainer direction. All five phases land on ONE branch,
> `fix/professions-2-phase-15-requa`, with NO PR until P20 completes; the
> maintainer opens the single PR at the end. There are NO paired QA phase
> files: every phase carries a mandatory VERIFY section, and P20 runs one
> consolidated fresh-eyes QA over the whole branch.

## Why this phase exists

v0.29.0 ships enchanting wired to players for the first time. Community
feedback flagged the aggregate stat gain as oversized; the maintainer verified
the claims and the Phase 15 RE-QA session re-verified them against the live
table at tip 485e7b429d:

- Max int stack is exactly +48 across 10 enchantable slot types (mainhand 8,
  helmet 8, legs 8, gloves 6, neck 5, shoulder 5, ring 4 x2). Claimed BiS mage
  gear totals ~111 int, so enchants add ~43 percent on top of BiS, more for
  typical gear. The intended feel is "the last 10 to 15 percent".
- Sta is worse: +39 (base picks: helmet 10, chest 10, waist 6, legs 8, feet 5)
  to +49 (best path). hpFromStamina (src/sim/entity.ts) grants 10 HP per point
  past 20, so that is +390 to +490 HP on level-20 pools of ~700 to ~1300.
- Why before launch: resolveApplyEnchant (src/sim/professions/enchanting.ts)
  bakes statBonus additively into ItemInstancePayload.rolled.stats at apply
  time. A post-launch nerf does not retro-apply; early enchanters would keep
  grandfathered items.

RE-VERIFY AT SESSION START (the release tip may have moved): recompute the
per-axis stacks from the live ENCHANTS table (a 10-line tsx script), and
recompute the BiS budget per axis from the actual gear tables (the ~111 int
claim was NOT independently verified; do that before finalizing percentages).

## The goal

Trim the statBonus magnitudes in `src/sim/content/enchants.ts` ONLY, so a
fully enchanted character gains a noticeable finishing bonus (~15 to 25
percent of the BiS gear budget per axis) instead of a gear tier.

Change NOTHING else:
- NO reagent cost changes (costs are the reversible post-launch knob; halving
  stats already doubles cost-per-stat).
- NO access or gate changes (the no-admission-gate ruling is LOCKED).
- NO disenchant yield, throttle, or wire changes.

## Trim shape (maintainer-directed, do not halve uniformly)

1. Base tier trimmed hardest (it is the aggregate driver).
2. Greater must stay a meaningful step (+3ish over base on the same slot and
   axis) so shards keep value; if Greater collapses to +1 or +2 over base,
   nobody burns epics and the shard sink dies.
3. Sta trimmed hardest of all (the 10 HP per point conversion).
4. Runed tier keeps its existing contract: strictly between base and Greater
   on the same slot and axis, never above Greater.

Maintainer's worked example (int; other axes proportional, final numbers are
this session's to size against the recomputed budgets):
- Int base: weapon 2, helmet 4, neck 2, shoulder 2, legs 4, gloves 3, ring 2
  each; Greater Spellpower 5. New max total 24 (~22 percent on top of BiS).
- Sta base: helmet 4, chest 5, waist 3, legs 4, feet 2; Greaters 6 to 8,
  targeting the full sta path at ~+230 to 250 HP.
- Str/agi/spi: base 4 to 6 becomes 2 to 3; Greater 8 to 9 becomes 4 to 5.
- Armor: helmet 30 becomes 15, chest 40 becomes 20.
- Runed: weapon 6 becomes 3 to 4, chest runeweave 10 becomes 5, legs hide 8
  becomes 4, helmet links 10 becomes 5.

Also rewrite the magnitude-convention comment at the top of enchants.ts
("primary ~4-6, sta ~6-10") to state the NEW convention.

## Deliverables

1. The trimmed table in `src/sim/content/enchants.ts` (data-as-code,
   module-first exempt) plus the rewritten convention comment.
2. NEW table-wide invariant tests (this is the teeth; magnitudes must be
   enforced, not eyeballed). In tests/professions_enchanting.test.ts or a
   focused sibling:
   - Per-axis aggregate stack cap: computed best-per-slot stack (rings x2)
     pinned to the exact chosen totals per axis, with a comment tying each to
     its budget percentage.
   - Greater beats base by at least 3 on the same slot and axis.
   - Runed sits strictly between base and Greater on the same slot and axis.
   - The full-sta-path HP delta (via hpFromStamina) pinned inside the chosen
     band.
3. Re-pinned magnitude literals in tests/professions_enchanting.test.ts and
   tests/enchant_apply_view.test.ts; check tests/crafting_materials_quality.test.ts,
   tests/professions_typed_reagents.test.ts, tests/bag_item_context_menu.test.ts
   for incidental magnitude pins.
4. Wiki regen (npm run wiki:content; tests/guide.test.ts freshness-gates it).
5. A worked before/after stack table per axis in the wrap-up note (the PR-body
   material for the eventual single PR).

Known-safe facts (verified by RE-QA, re-confirm cheaply): no parity scenario
applies an enchant, so parity goldens are untouched; enchant NAMES do not
change, so there is no i18n impact.

After launch (context, not this phase's work): the maintainer monitors shard
prices and clear speed; drift is tuned via reagent costs, never by re-touching
magnitudes.

## VERIFY (mandatory, in-session)

- Run the validation matrix at the UNTOUCHED tip first and record it as ground
  truth: npx vitest run tests/professions_enchanting.test.ts
  tests/enchant_apply_view.test.ts tests/professions_typed_reagents.test.ts
  tests/recipe_economy.test.ts tests/guide.test.ts; npx tsc --noEmit.
- After the change: the same batch plus tests/parity/ (must stay green with
  ZERO golden diffs) and the new invariant tests.
- Dispatch a FRESH architecture-reviewer over the src/sim/ diff and a FRESH
  test-coverage-auditor over the test diff (30-tool-call budgets, report-first
  framing).
- A fresh-eyes coverage subagent reviews the session's whole diff before
  wrap-up.
- Full npm run gate under Node 26 (see the standing rules), judged ONLY by the
  log's GATE_EXIT= marker and "[gate] FAIL" lines.

## Wrap-up duties

- Commit with explicit paths, Conventional Commits with scope and body. NO PR.
- Append a short phase note to docs/professions-2/progress.md Notes including
  a RE-AUDIT EMPHASIS paragraph for P20: the exact chosen numbers, anything
  decided inline, anything verified only by suites.
- Record surprises to Claude Code memory (professions-2-program).

## Standing rules (apply to every P16 to P20 session)

- Branch: `fix/professions-2-phase-15-requa`, worktree
  `~/Documents/woc-p15-requa` (node_modules and i18n gen already present; a
  FRESH worktree would need npm ci plus npm run i18n:gen first).
- STEP 0 every session: git status must be clean; re-resolve the newest
  release/** branch by version sort; if it moved past this branch's merge
  base, merge it in via the release-merge-audit skill BEFORE working.
- Node 26 for everything: prepend ~/.nvm/versions/node/v26.5.0/bin to PATH
  (the shell default node 25 breaks jsdom suites). Judge gates only by
  GATE_EXIT= and "[gate] FAIL" in the log, never by the background task
  notification.
- NO PR, no auto-merge, nothing outward: the maintainer opens the single PR
  after P20.
- NO phase vocabulary ("Phase N", packet process history) in any NEW code
  comment, test name, or player-visible string; describe the why, not the
  process (P20 scrubs the old ones; do not add new ones).
- i18n: every new player-visible string is a t() key; new wordy keys get
  their five non-Latin fills in the same change (the M16 completeness gate,
  tests/i18n_completeness.test.ts, forbids English fallback on non-Latin
  surfaces); rewording existing player-visible English requires refreshing
  its non-Latin fills in the same change and stripping stale Latin fills to
  pending.
- NO GitHub issues for anything in this packet (maintainer-directed,
  2026-07-22): follow-ups and findings are recorded in the branch's docs and
  wrap notes; the branch IS the history.
- Memory to read at session start: professions-2-program,
  node25-breaks-jsdom-gate (now the Node 26 recipe), fanout-agent-delivery-traps,
  workflow-parallel-missing-await, round-trip-pins-reference-aliasing,
  i18n-semantic-regressions-gate-trap, malware-scan-comment-keywords,
  big-diff-reviewer-turn-budgets.
- Verify every subagent claim yourself before acting on it.

## Starter prompt

```
This is Phase 16 of the Professions 2.0 finishing packet (P16 to P20): the
release-blocking enchanting stat trim. Model: Fable 5, xhigh effort
(ultracode on). Harness: Claude Code.

Read docs/professions-2/phase-16-enchant-trim.md from the worktree
~/Documents/woc-p15-requa (branch fix/professions-2-phase-15-requa) and
execute it exactly: STEP 0 release sync first, re-verify the stack numbers
and the BiS budgets at the current tip, size the trim against the maintainer's
worked example and the four trim-shape rules, land the table edit plus the
table-wide invariant tests and re-pins, regen the wiki, run the VERIFY
section, and finish with the wrap-up duties (progress.md phase note with the
RE-AUDIT EMPHASIS paragraph for P20, memory update). Commits with explicit
paths and bodies; NO PR (the branch accumulates until P20; the maintainer
opens the single PR). The standing rules block in the phase file binds this
session: Node 26 gate recipe, no new phase vocabulary in code, verify every
subagent claim. If a trim-shape rule and a budget percentage conflict, prefer
the rule and record the tension in the wrap note rather than inventing a
fifth rule.
```
