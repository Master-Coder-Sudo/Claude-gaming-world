# Phase 18: Deferral burn-down (make it perfect)

> Part of the ship-side finishing packet (P16 to P20). One branch
> (`fix/professions-2-phase-15-requa`), no PR until P20, no paired QA file.
> The standing rules block in `phase-16-enchant-trim.md` binds this session
> (STEP 0 release sync, Node 26 gate, no new phase vocabulary, no GitHub
> issues, M16 fills, memory list, verify subagent claims).

## Why this phase exists

The maintainer wants every deferred item across the whole packet addressed:
todos, should-fixes, nice-to-haves, observations. Each must be re-verified
against the CURRENT tree first (P16 and P17 have landed by now and may have
mooted or moved items), then fixed test-first where it is a bug.

## Settled dispositions (maintainer-confirmed 2026-07-22, do not re-litigate)

CLOSED, do not touch:
- Pacing acceptance (gathering-100 / fishing-200 fast; data-only levers
  post-launch).
- ALL sound and SFX items (another engineer owns sound now; skip every
  audio-related deferral including the #2208 ledger).
- Enchanting depth (gems, jewelcrafting, inscription content) stays deferred
  to the post-level-20 zone expansion; the no-admission-gate ruling is LOCKED.
- #2156 (giveaway feature request): ignore entirely.
- Steam partner-site registration of the three achievement ids: the
  maintainer wires it later in a separate PR.
- #2088 (bareClient 22-copy extraction): OUT of scope, a separate repo chore.

RULED, implement as specified:
1. **Mixed bound/unbound stack sell notice** (replaces the silent partial):
   when a sell request skips bound copies but sells the rest, emit one info
   line (a "Kept {count} bound copies." family message), sim-side stable
   English plus its src/ui/sim_i18n.ts matcher row in the SAME change (the S3
   guard binds), pinned on both arms: fires on a mixed stack, silent on a
   clean one. The zero-unbound full-deny arm stays exactly as shipped.
2. **Unbind fee interpretation**: FIRST re-read the open flag's original text
   (the Phase 14b record and the PR #2293 body) against the live code in
   src/sim/professions/ and src/sim/content. The proposed ruling: any bound
   item whose quality sits below the fee ladder's first rung pays the first
   rung (2500c), symmetric with the existing clamp-to-last-above arm. The
   three principles that decide it if the real ambiguity differs from that
   reconstruction: (a) no quality unbinds free, ever (the fee is the
   wash-guard and the sink); (b) the fee is monotonic in quality; (c) the
   shape mirrors clamp-to-last-above. Land the interpretation that satisfies
   all three, pin the boundary, and record the decision in the wrap note.
3. **#2139 (corpse focus-harvest bag overflow, pre-existing)**: IN scope.
   Fix with the same policy the node-gather path got: every signed unit
   needs a genuinely free slot, unsigned stack top-up fallback, truncation
   wins over signing. Test-first: reproduce the overflow, then the smallest
   fix. Draw order must be untouched (parity suite proves it).
4. **Overlay stale-refill guard**: DO NOT build a mechanical guard
   (staleness detection would need per-fill English hashes, out of
   proportion). Instead make sure the refill checklist and the rationale
   survive into P20's consolidated doc; nothing to code here beyond
   confirming the progress.md guidance block is complete.

## The inventory step (do this before fixing anything)

Build the complete deferral inventory from: docs/professions-2/state.md
(drift notes plus OPEN items), docs/professions-2/progress.md (every phase
note's deferral lines, including the Phase 15 and RE-QA notes),
docs/professions-2/phase-15-tuning-evidence.md addendum, the PR #2303 body,
and the professions-2-program memory entry. For EVERY item record: source,
claim, does-it-still-apply at the current tree (verify, do not trust), and
disposition (fix now, moot, closed-by-ruling, or deferred-with-reason).
The inventory table goes in the wrap note verbatim; it is P20's checklist.

Known actionable set (verify each still applies, then fix):
- Gossip dialog does not repaint when a cprof identity delta lands (the
  intro hint row can linger in an open dialog online; self-heals on reopen).
  Fix: re-render the open gossip dialog when craftingIdentity is replaced,
  with a liveness pin. (P17 may have already fixed this in the restyle;
  verify first.)
- HUD Sell Junk preview omits the soulbound arm the sim sweep applies
  (src/ui/hud.ts junk-proceeds predicate vs src/sim/items.ts sellAllJunk).
  Mirror the clause, pin it.
- Wiki generator hardcodes payoutPctOfVendorValue 50 and listingDepositCopper
  0 (scripts/wiki/build_content.mjs) while everything around them imports
  real constants. Export named sim constants (or derive) and import them,
  plus a guard test recomputing a work order's copperReward from the
  constants.
- Legacy IWorldProfessions surface (an old drift note marks it a retirement
  candidate): verify whether it still exists at tip; if yes, retire it from
  BOTH worlds and the parity pin in the same change.
- Windfall per-instance loot-line/cue burst (Phase 4 polish deferral): verify
  whether Phase 15 or P17 already smoothed it; fix or record moot.
- Station copy level arm (Phase 6 deferral): almost certainly moot since the
  hub level rule was retired in Phase 8; verify and record.
- The small Phase 5/6 QA leftovers: RingArc endpoint symmetry,
  open-while-open branch pins, a real-ClientWorld empty-craftSkills pin, the
  two-procs-one-log coalesce, pr_shot_targets stateIsFn dead guard. Verify
  each; land the cheap ones; anything structural goes to the wrap note with
  a reason.
- The sellAllJunk future-hole and armed-copy wash observations (Phase 15
  notes): re-read the original observations, verify, and either fix or
  document why they are acceptable.
- eqi interest-scope and live rolled ref observation (Phase 6): server-owned
  JSON-snapshotted; verify still true, record, no code expected.

## VERIFY (mandatory, in-session)

- Matrix at the untouched tip first (the suites named per item above plus
  tests/parity/, tests/localization_fixes.test.ts, tsc).
- Every new negative-arm test gets a MUTATION CHECK (plant the bug, expect
  red, restore; the tree must end porcelain-clean).
- Dispatch per the diff: architecture-reviewer (sim changes), cross-platform-
  sync (any facet or wire touch), test-coverage-auditor, qa-checklist.
- A fresh-eyes coverage subagent over the whole session diff.
- Full npm run gate under Node 26, judged by GATE_EXIT= only.

## Wrap-up duties

Commits with explicit paths and bodies, grouped by concern (one commit per
fix family); NO PR. Append the phase note with the FULL inventory table and
the RE-AUDIT EMPHASIS paragraph (which fixes were judgment calls, which items
were declared moot and why) to docs/professions-2/progress.md. Record
surprises to memory.

## Starter prompt

```
This is Phase 18 of the Professions 2.0 finishing packet (P16 to P20): the
deferral burn-down. Model: Fable 5, xhigh effort (ultracode on). Harness:
Claude Code.

Read docs/professions-2/phase-18-deferral-burndown.md from the worktree
~/Documents/woc-p15-requa (branch fix/professions-2-phase-15-requa) and
execute it: STEP 0 release sync per the standing rules in
phase-16-enchant-trim.md, then build the complete deferral inventory from the
named sources BEFORE fixing anything (a Workflow fan-out of readers works
well; await every parallel call), verify every item still applies at the
current tree, then fix the actionable set test-first under the settled
dispositions in the phase file (the maintainer's rulings there are final: the
sell notice, the never-free unbind clamp principles, #2139 in scope, sound
and #2088 and #2156 out). Mutation-check every new negative arm. Run the full
VERIFY section, then the wrap-up duties: the inventory table verbatim in the
progress.md note plus the RE-AUDIT EMPHASIS paragraph for P20. NO PR, no
GitHub issues; the branch is the history. The goal is zero open loose ends
that are actually ours.
```
