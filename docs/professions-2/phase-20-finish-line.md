# Phase 20: Finish line (scrub, teardown, docs, whole-branch QA)

> The closing phase of the ship-side finishing packet (P16 to P20). One
> branch (`fix/professions-2-phase-15-requa`); after this phase the
> maintainer opens the single PR. The standing rules block in
> `phase-16-enchant-trim.md` binds this session (STEP 0 release sync, Node 26
> gate, no GitHub issues, memory list, verify subagent claims). NOTE: this
> phase DELETES most of docs/professions-2/, including the phase files; do
> the in-session ordering exactly as written so nothing is consumed before
> it is read.

## In-session order (binding)

1. Phase-vocabulary scrub (code reads docs for context BEFORE they move).
2. Docs teardown and consolidation.
3. CLAUDE.md and design-doc updates.
4. The consolidated whole-branch fresh-eyes QA (audits the FINAL tree,
   including steps 1 to 3).
5. Fix pass for QA findings, then the final full gate.
6. Wrap-up: the PR-body draft for the maintainer.

## Step 1: phase-vocabulary scrub

The packet salted internal process vocabulary through shipped code. Remove it
from src/, server/, tests/, headless/, and scripts/ (docs/professions-2/ is
exempt; it is deleted in step 2).

- Sweep: case-insensitive "phase" mentions plus the packet shorthand (p13,
  p14b, 12c and similar, "QA directed", "maintainer-directed",
  "burn-down" where it names the PROCESS rather than the mechanic).
- Rewrite rule: KEEP THE CONTRACT, DROP THE PROCESS. A comment like "Phase 15
  QA directed burn-down (paired arm): sellValue re-priced below the reworked
  craft input" becomes "Economy invariant: sellValue re-priced below the
  reworked craft input (the vendor buyValue is deliberately kept)". Dates are
  fine; phase numbers and session history are not. If a comment is ONLY
  process history with no contract, delete it.
- Test files and describe strings count: rename
  tests/professions_p13_bound_surfaces.test.ts and
  tests/professions_p14b_commissions.test.ts (and any other packet-shorthand
  filenames) to behavior-named files; rewrite describe/it strings that carry
  phase numbers. Renaming test files is runtime-safe; grep for references to
  the old filenames in docs, comments, and CI configs first.
- SCOPE GUARD: other programs legitimately use "phase" (the DESIGN.md
  rollout phases in styles comments, the toolchain packet, gameplay terms).
  Only professions-packet process vocabulary is in scope; when in doubt, read
  the comment's subject.
- Also scrub the "Claude-Session:" trailers? NO: commit messages are history,
  never rewritten; the scrub is working-tree only.

## Step 2: docs teardown and consolidation

Maintainer-directed (2026-07-22): keep only what is absolutely necessary,
consolidated.

1. Author `docs/design/professions.md`: the single surviving reference.
   Contents: the final system model (ring, archetypes, masterwork,
   gathering/fishing, enchanting, commissions/bond, deeds); the tuning
   constants table (symbol, file, value, byte-verified); the locked rulings
   (no-admission-gate, deed doctrine pointers, the unbind interpretation as
   landed in P18, cosmetic-only deeds); the OPEN worklists that MUST survive:
   the release-time locale fill (pending count, the non-Latin stale-batch
   regeneration list with its refill guidance, the profPages FAQ item) and
   the maintainer-side items (Steam display names for renamed marquee deeds,
   partner-site registration); and a short "how to extend" section (new
   recipe, new deed, new enchant) pointing at the real seams. Follow the
   anchor rule: symbols and stable paths, no line numbers, no counts that
   rot.
2. Keep the designer asset catalog: move docs/professions-2/asset-manifest.json
   to docs/design/professions-asset-manifest.json and fix any references.
3. DELETE the rest of docs/professions-2/ with explicit paths (every phase
   file including P16 to P20, progress.md, state.md, qa-checklist.md,
   brainstorm.md, implementation-plan.md, the tuning evidence file, README).
   Before deleting, mine them one last time: anything load-bearing that is
   not yet in the consolidated doc, the P16 to P19 wrap notes (their re-audit
   emphasis paragraphs feed step 4), and the deferral inventory table.
4. Sweep references: grep the whole repo for docs/professions-2 paths
   (CLAUDE.mds, comments, scripts, the sitemap is unaffected) and fix each.

## Step 3: CLAUDE.md and design-doc updates

The house rule: ONLY what is strictly beneficial to the agent working there;
no bloat; fix what is now outdated. Candidates (verify each against the
final tree, add only what earns its line):
- src/sim/professions/CLAUDE.md: the seam map as it ENDED (modules, the
  SimContext callbacks professions use, the invariants: draw-order
  neutrality of deed bumps, the free-slot signing policy, the economy
  invariant pointer).
- src/ui/hud/ CLAUDE.mds touched by P17: the window families as rebuilt.
- tests/CLAUDE.md: the renamed test files from step 1, the parity golden
  regen convention if its wording references phases.
- Root CLAUDE.md: ONLY if something there is now wrong (the content bullet
  naming professions content files, the deeds line). Do not add a professions
  section for its own sake; the consolidated design doc is the reference.
- docs/design/deeds.md: verify the professions deed rows still read true.

## Step 4: whole-branch fresh-eyes QA

The consolidated independent audit that replaced the five paired QA sessions.
Audit target: the ENTIRE finishing branch, `485e7b429d..HEAD`, zero trust in
the P16 to P19 sessions' claims.

- Build the emphasis list from the RE-AUDIT EMPHASIS paragraphs the P16 to
  P19 wrap notes left in progress.md (mined in step 2 before deletion), plus:
  anything done inline at speed, every table-wide invariant P16 added
  (recompute independently), P17's judgment-styled surfaces (screenshot
  spot-check), P18's moot-declarations (verify a sample really was moot),
  P19's rename table (spot-check collisions and the non-Latin refills).
- Run as a Workflow fan-out (await every parallel call): audit charters per
  phase plus the dispatch-matrix reviewers the combined diff matches
  (architecture, frontend-seam, cross-platform-sync, test-coverage,
  qa-checklist, privacy-security if server/ moved), plus sequential
  behavioral probes for anything an audit flags as unproven (mutation checks,
  live window probes). 30-tool-call budgets, report-first, schema-forced
  output for generic charters, verify every claim before acting.
- Matrix first: run the full validation battery at the pre-QA tip and hand
  it to the agents as verified ground.

## Step 5: fix pass and final gate

Apply every blocking and should-fix finding (defer only true nice-to-haves,
recorded in the consolidated doc's follow-ups section). Then the final full
npm run gate under Node 26 (GATE_EXIT= is the only truth), plus
npx tsc --noEmit and a porcelain-clean tree check.

## Step 6: wrap-up

- Commits with explicit paths and bodies per step; NO PR (the maintainer
  opens it).
- Draft the PR body into the wrap message for the maintainer: the finishing
  packet summary (P16 to P20 one-liners), the enchant before/after table,
  the P17 before/after screenshot references, the deferral inventory
  disposition summary, the rename table, the release-fill flag (pending
  count plus the non-Latin regeneration worklist), and the screenshots
  requirement satisfied via P17's committed shots.
- Update memory: professions-2-program gets the finishing-packet completion
  record (verdicts, the consolidated doc's location, the teardown
  completion, and that the packet docs no longer exist on disk).
- Leave the maintainer a one-line final status.

## Starter prompt

```
This is Phase 20 of the Professions 2.0 finishing packet, the finish line:
phase-vocabulary scrub, docs teardown, CLAUDE.md updates, and the
consolidated whole-branch QA. Model: Fable 5, xhigh effort (ultracode on).
Harness: Claude Code.

Read docs/professions-2/phase-20-finish-line.md from the worktree
~/Documents/woc-p15-requa (branch fix/professions-2-phase-15-requa) and
execute its six steps IN ORDER (the ordering is binding: the docs are mined
and consolidated before deletion, and the whole-branch QA audits the final
tree). STEP 0 release sync per the standing rules in phase-16-enchant-trim.md
first. The scrub keeps contracts and drops process vocabulary; the teardown
keeps exactly docs/design/professions.md plus the relocated asset manifest
and deletes the rest with explicit paths; the CLAUDE.md pass adds only what
earns its line; the QA is a zero-trust fresh-eyes audit of 485e7b429d..HEAD
built from the P16 to P19 re-audit emphasis notes; then the fix pass, the
final gate under Node 26, and the wrap-up with the PR-body draft. NO PR, no
GitHub issues. When this phase completes, the branch is the finished feature
and the maintainer opens the single PR.
```
