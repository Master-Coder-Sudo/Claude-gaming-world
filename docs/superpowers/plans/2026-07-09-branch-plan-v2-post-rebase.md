# Branch Plan v2: Refreshed After Rebase Onto Upstream (post v0.24.0-era)

> Supersedes `2026-07-09-upstream-issue-fixes.md`. That plan was written against the
> v0.22.0-era tracker. `develop` has since been rebased onto `origin/main`
> (`0f0a4c531`, +683 upstream commits), so the issue landscape was re-checked against
> the LIVE upstream tracker (`levy-street/world-of-claudecraft`, 62 open issues) and
> re-prioritized here.

**Goal:** Keep fixing the highest-player-value upstream bugs and UX gaps on the fork's
`develop` branch, prioritized by player experience, now reconciled with what upstream
has already fixed and what has newly appeared.

**Method:** Same as before. Subagent-driven, test-first, deterministic reproduction where
possible, behind the repo's existing seams (`SimContext`, `IWorld`, `RouteDef`).

## Global Constraints (unchanged, YOU MUST keep)

- `src/sim/` stays DOM/browser/Three.js-free; all randomness through `Rng`, never `Math.random`/`Date.now`/`performance.now`.
- `IWorld` is the only seam between sim and render/ui; extend it first, implement in both `Sim` and `ClientWorld`.
- Server is authoritative; never resolve combat/loot/economy on the client.
- Deterministic 20 Hz tick (`DT = 1/20`); never reorder `tick()` phases casually. Golden parity traces regenerate only via `UPDATE_PARITY=1`, with rng draw-order preserved.
- Every player-visible string is a `t()` key; contributors add English only.
- No em dashes, en dashes, or emojis anywhere. Conventional Commits with scope.
- Do NOT invent balance numbers; ground them in `docs/design/` or existing constants.

---

## 1. Status of the original plan (v1)

### DONE and pushed (origin/develop, 15 commits ahead of origin/main)

All Tier 1 + Tier 2 fixes are complete, tested (full suite 11320 passing on the merged
base), and pushed. Of these, most remain OPEN upstream (genuine fork contributions not
yet upstreamed):

| Issue | Fix | Upstream state |
|---|---|---|
| #1600 | Arena full-restore carry-back exploit (+ Yumi variant) | OPEN (our fix) |
| #1651 | Stale movement input after death/revive | OPEN (our fix) |
| #1351 | Dungeon instance reset on disconnect (reconnect grace) | OPEN (our fix) |
| #1539 | Mob respawn over unlooted corpses | OPEN (our fix) |
| #1668 | Line-of-sight over fences | OPEN (our fix) |
| #1667 | NPC follow-up quest dialog refresh | OPEN (our fix) |
| #1608 | Food stacks with natural regen | OPEN (our fix) |
| #1676 | Apple Silicon defaults to medium preset | OPEN (our fix) |
| #1356 | Voidwalker auto-taunt + tank-pet threat | OPEN (our fix) |
| #1257 | Overlapping corpse cycle | CLOSED upstream (our work was no-op: fix pre-existed) |
| #1362 | Defer auto-attack to cast completion | CLOSED upstream (our work was no-op: fix pre-existed in hud.ts) |

Note: #1257 and #1362 confirm the v1 findings (both fixes already lived in the code);
upstream has since closed them. No action needed.

### DEFERRED (maintainer decision required, not a code gap)

| Issue | Why deferred |
|---|---|
| #1326 | Potion retuning: "30 to 40 percent of bracket pool" has no single defensible target (cross-class pools vary 2 to 3x). Needs maintainer-supplied numbers. Commit references it (Refs #1326), does not close it. |

Also open for maintainer sign-off (from the branch review): whether the Voidwalker
(#1356) should use a bespoke threat multiplier instead of the reused generic
`DEFENSIVE_STANCE_THREAT_MULT` (1.3).

### DROPPED (upstream already fixed and CLOSED, remove from our plan)

These v1 tasks are resolved upstream and pulled in by the rebase; do NOT re-implement:

| Issue | Was | Now |
|---|---|---|
| #1501 | T3: destroy items from bags | CLOSED upstream |
| #1229 | T4: mobile touch drift | CLOSED upstream |
| #1353 | T4: Esc double-action | CLOSED upstream |
| #1357 | T4: self-only ability indicator | CLOSED upstream |
| #1359 | T4: fishing poles single vendor | CLOSED upstream |
| #1538 | T4: bags takes two clicks | CLOSED upstream |
| #1541 | T4: show game version | CLOSED upstream |
| #1559 | T4: map not scaling with UI | CLOSED upstream |

---

## 2. Refreshed priorities (remaining + new)

Re-tiered by player-experience value. Issues marked NEW were opened since the v1 plan
and are not in v1. Bug issues carry a VERIFY-FIRST flag (see section 3).

### Tier A: Critical / blocking (verify repro first, then fix)

| # | Issue | Why it matters | Rough scope |
|---|---|---|---|
| A1 | #1484 (NEW, bug) | "Stuck on death screen", no respawn, reported on mobile online. A respawn blocker is game-breaking if it still repros. | Death/respawn UI flow (`hud.ts` death overlay + respawn command); verify on current mobile online path first. |
| A2 | #1050 (NEW, titled Critical) | Lower-level mobs cannot threaten higher-level players/pets, so pets on Defensive passively farm XP risk-free (anti-exploit + classic fidelity). Complements our #1356. | Level-difference hit/damage rules (`types.ts` hit tables, `mob_swing.ts`/`combat_profile.ts`). Ground in classic formulas; parity scenario + golden. Larger effort. |

### Tier B: High (core feel, mobile, and remaining v1 Tier 3)

| # | Issue | Why it matters | Rough scope |
|---|---|---|---|
| B1 | #1686 (NEW) | Mobile HUD chat/map/pinch regressions in v0.23.0; the release gate `scripts/mobile_hud_overlap_audit.mjs --gate` reports 14 strict violations. Well-defined acceptance (make the gate pass). | `hud.mobile` CSS + mobile chat/map layout. Gate-driven. |
| B2 | #1652 (NEW) | Movement desync at high ping (180 ms+), worst when jumping. Core online feel. | Display-only reconciliation in `src/render/self_motion.ts` (bounded, blend-to-authoritative per net/CLAUDE.md); do NOT widen prediction into gameplay. Higher effort/risk. |
| B3 | #1360 | Spell queue (queue one ability behind the current cast). Big responsiveness win. | `casting_lifecycle.ts` queue slot + `hud.ts` press path. |
| B4 | #1358 | Option to stop auto-attack when switching targets. | Setting + `auto_attack.ts`/`targeting.ts`. |

### Tier C: Medium (UX / QoL, mostly render/ui/css)

| # | Issue | Area |
|---|---|---|
| C1 | #1361 | Lock action bar slots (option) |
| C2 | #1670 + #1659 (NEW) | Chat: separate game-event lines from player chat; channel chat only visible in chat window. Treat together. |
| C3 | #1653 | Options menu redesign as a full settings window |
| C4 | #1660 | Cooldown sweep readability against bright icons |
| C5 | #1646 | Loot Settings dropdowns use unstyled native selects |
| C6 | #1657 | Remember zoom level across sessions |
| C7 | #1500 (NEW, bug) | Pier at Deepfen shallows has no collision (add collider) |
| C8 | #1626 (bug) | Item tooltip shows wrong item when dragging |
| C9 | #1464 (bug) | Character creator preview inconsistent |
| C10 | #1355 | Re-summoning a warlock pet dismisses instead of resummoning |
| C11 | #1444 + #1443 | Mailbox: quantity selection + attach should not reset the form |
| C12 | #1452 | Chat input color does not indicate active channel |
| C13 | #1365 + #1232 | Chat window/tab overflow + input box height/clipping |
| C14 | #1696 (NEW, bug) | Hand-glove disappears while drag-rotating the camera |
| C15 | #1639 (NEW, bug) | Overhead names with dev-tier glow look blurred |

### Tier D: Larger features / lower priority

| # | Issue | Note |
|---|---|---|
| D1 | #1021 | Party/raid Ready Check (leader-triggered) |
| D2 | #110 | Public guild directory + request-to-join |
| D3 | #103 | Mana recovery pacing + regen/consumable hooks (balance; ground it) |
| D4 | #1238 | On-bar action-bar keybinding mode |
| D5 | #1230 | Discord button + surface the "!" chat command |
| D6 | #1658 (NEW) | Turn unwanted items into coin (may overlap upstream professions; confirm ownership) |
| D7 | #1577 (NEW) | Mobile HUD polish (party frame stacking, rewards icon overlap) |
| D8 | #1620 (NEW, perf) | terrainHeight recomputes rim-crest noise on every ground sample |
| D9 | #1703 (NEW) | /playtime command (trivial) |

---

## 3. Verify-first protocol for bug issues

Several candidates are older bug reports (#1484, #1500, #1626, #1464, #1355) filed
before the +683-commit upstream history. Upstream may have partially or fully addressed
them. For every bug task, step 1 is: reproduce on the CURRENT merged code with a failing
test (or a documented manual repro if UI-only). If it no longer repros, close it out as
"resolved upstream" in the ledger and move on. Do NOT write a fix for a bug that no
longer exists.

## 4. Explicitly EXCLUDED (upstream / maintainer-owned, not fork daily-iteration work)

Do not pull these into the fork plan without an explicit maintainer request:

- Professions epic and its sub-issues: #1152, #1148, #1292, #1293, #1295, #1296, #1298, #1302, #1701 (upstream is actively building this system).
- $WOC / token / PvP-currency economy: #1589, #1157, #1576 (maintainer-owned crypto layer).
- Meta / vision / research: #203 (self-building MMO), #554 (on-device AI NPC dialogue).
- Maintainer i18n and infra: #738 (it_IT accents), #859 (Discord triage bot), #1574 (audio asset standards), #1698 (release v0.24.0).
- Duel-stealth desync #491 and dev-glow blur are niche; keep low unless they recur.

## 5. Suggested next step

Start Tier A with the VERIFY-FIRST protocol: confirm #1484 (death-screen) and #1050
(mob threat) still reproduce on the merged base, then fix the ones that do. Both are
verification-gated because they are older reports on a heavily-changed base.
