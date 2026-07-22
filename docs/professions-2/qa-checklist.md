# Professions 2.0: whole-feature QA matrix

Verified once at packet completion (Phase 15 QA), on top of the per-phase QA
sessions. Every row must be checked with evidence (test name, command output,
or screenshot path), not vibes.

Evidence recorded 2026-07-22 by the Phase 15 RE-QA session (the independent
fresh-eyes re-audit of merged PR #2303 at release/v0.29.0 tip 485e7b429d),
which ran every cited command itself under Node 24. "RE-QA" below means that
session's own run or probe; per-phase citations name the pinned suite that
carries the behavior permanently.

## Three-host parity
- [x] Craft skills, archetype identity (title, majors, hobby, history), combo
      eligibility, masterwork results, station gating, node cooldowns, corpse
      claims, fishing proficiency, and known recipes read identically in the
      offline `Sim` and online `ClientWorld`; the headless env is unaffected or
      consistent where it reads professions state.
      Evidence: RE-QA ran the full parity suite, `npx vitest run tests/parity/`
      = 183 passed (professions_craft seed 21, professions_gather seed 3,
      inventory_vendor goldens byte-stable); cprof mirror pins in
      tests/snapshots.test.ts; station gating online in
      tests/professions_station_online.test.ts; the RE-QA liveness probe drove
      a real GameServer broadcast into a real ClientWorld and is now the
      permanent pin tests/prof_intro_hint_online.test.ts.
- [x] `tests/world_api_parity.test.ts` pins every new member; no ClientWorld
      stub defaults remain for any surface this packet ships (the shape-only
      pin trap: verify liveness, not just member presence).
      Evidence: RE-QA ran tests/world_api_parity.test.ts green (in the 606-test
      wire batch); liveness pins: tests/crafting_view_combo_liveness.test.ts
      (both hosts), tests/prof_intro_hint_online.test.ts (cprof to decision),
      the Phase 3 hcb corpse-claim liveness suite in
      tests/corpse_harvest_sim.test.ts.
- [x] Wire suites green: `npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts tests/bandwidth.test.ts`.
      Evidence: RE-QA ran exactly these three plus seven more in one batch:
      606 passed, exit 0 (2026-07-22).

## Determinism
- [x] All new randomness (masterwork proc, rare gather events, node rarity,
      fishing catches, the Phase 12b hidden bite delay) draws through `Rng`
      with pinned draw-order tests; no
      `Math.random` / `Date.now` / `performance.now` anywhere in `src/sim/`.
      Evidence: tests/architecture.test.ts green (RE-QA run); RE-QA verified
      both Phase 15 golden regens (1ff3561004, d1d290db26) are byte-identical
      on draws/drawDigest (zero draw lines in either golden diff); the
      architecture reviewer's draw-order pass found every new deed stat bump
      sits strictly after its draw and draws nothing.
- [x] `npx vitest run tests/architecture.test.ts` green.
      Evidence: RE-QA matrix run, 309 passed across the phase validation batch
      including this suite (2026-07-22).
- [x] Same-seed determinism test covers a full gather-craft-masterwork sequence.
      Evidence: the parity goldens ARE the same-seed pins for the full
      sequence: professions_gather (seed 3, two-draw harvest contract) and
      professions_craft (seed 21, hunted masterwork proc) pin state, events,
      and rng digests byte-exactly; deed-layer determinism pinned by
      tests/deeds.test.ts 'two sims with the same seed and script produce
      identical earned sets and event streams' plus tests/sim.test.ts 'same
      seed + same actions => identical trajectories'.

## Server authority
- [x] Every new command (train recipe, disenchant, enchant apply, salvage,
      quest advance, the Phase 14b commission opt-in and master unbind)
      validates server-side; the client never decides craft
      outcomes, masterwork procs, harvest rewards, quest credit, the
      Phase 12b bite deadline, or a bind-on-trade stamp.
      Evidence: per-phase privacy-security reviews (Phases 2, 6, 8, 12, 13,
      14b) each PASS; the Phase 15 wash closure is server-side in
      src/sim/items.ts sellItem with the deny pinned at
      tests/professions_p14b_commissions.test.ts (RE-QA ran the suite green);
      RE-QA architecture review confirmed the wash fix is server-authoritative
      and draw-free.
- [x] Invalid or replayed commands cannot duplicate rewards, recipes, or skill.
      Evidence: tests/professions_mastery_reset.test.ts 125-recross idempotence
      and no-double-grant arms (RE-QA ran green); deed re-crossing no-ops
      pinned in tests/deeds.test.ts; commission opt-in is one-shot
      (craftCommissionOptIn delete pinned in
      tests/professions_p14b_commissions.test.ts).

## Persistence
- [x] Characters saved before this packet load cleanly: legacy `ArchetypeState`
      (no history), legacy craft skills, legacy known recipes (grandfathered),
      legacy instances (no masterwork flag) all default correctly.
      Evidence: normalizeArchetypeState pins (Phase 1), professions_grandfather
      suite (Phase 10), the enchant-marker legacy arm (Phase 2 QA), tier-mail
      and cadence load normalization pinned in
      tests/professions_tier_mail.test.ts and
      tests/professions_quest_cadence.test.ts (both re-verified by the RE-QA
      test-coverage audit as decisive, both green in the RE-QA runs).
- [x] Save/load round-trip tests cover archetype history, fishing proficiency,
      known recipes, and masterwork instances.
      Evidence: serialize-load-serialize fixed point pinned for cadence
      (tests/professions_quest_cadence.test.ts) and tier mail
      (tests/professions_tier_mail.test.ts); gather_event visited marks now
      have a direct restore round-trip arm in tests/deeds.test.ts (added by
      RE-QA after its audit found the fix was only indirectly pinned);
      masterwork instance payloads round-trip in tests/trade.test.ts and the
      Phase 2 save/load pins.
- [x] All DDL (if any) is additive and idempotent under the boot advisory lock.
      Evidence: the packet shipped ZERO DDL; all persisted professions state
      rides the characters.state JSONB blob (migration-safety reviewer joined
      the Phase 15 dispatch for the cadence serialize prune and passed it; the
      RE-QA sync-merge audit confirmed no schema surface in the packet range).
- [x] The Phase 12c one-time reset: fires exactly once per character (relog,
      reconnect, restart, second deploy); the keep/reset ledger is fully
      pinned; the blob-diff rehearsal evidence is on record; re-crossing any
      threshold after reset double-grants no deed, renown, or letter.
      Evidence: tests/professions_mastery_reset.test.ts (RE-QA ran green)
      including the Phase 15 re-cross extension with its positive control; the
      12c QA rehearsal evidence stands in the 12c packet records.

## Pacing (the Mastery Curve, Phase 12c)
- [x] The free floor is gone: no recipe tier grants full gain forever; the
      four-state curve (1 / 0.5 / 0.25 / 0) is pinned at every boundary for
      crafting, gathering, fishing, and enchanting.
      Evidence: the 12c curve suites (tests/professions_mastery_reset.test.ts
      and the per-surface curve pins landed in 12c); RE-QA ran the mastery
      reset suite green 2026-07-22.
- [x] Every per-profession cap (crafts and enchanting 125,
      mining/logging/herbalism 100, fishing 200) is enforced at gain time and
      load time; at cap, crafting still procs masterwork and harvests still
      yield.
      Evidence: tests/professions_skill_caps.test.ts green (RE-QA wire batch);
      the Phase 15 deed catalog guard loops EVERY deed threshold against the
      resolved caps (tests/deeds_content.test.ts, RE-QA verified zero '300'
      hits remain in src/sim/content/deeds.ts).
- [x] Crafting, disenchant, enchant-apply, and salvage share ONE throttle
      window; no action type has a parallel budget.
      Evidence: the 12c shared-throttle pins (tests suite landed in 12c);
      unchanged by Phase 15 (RE-QA architecture pass: no tick-phase or
      entry-point changes in the phase diff).
- [x] The enchanting soft ceiling holds: rarer input never grants less skill,
      and never zero above a pre-archetype ceiling.
      Evidence: Phase 13 enchanting suites; Phase 15 touched enchanting only
      for the disenchant evidence check (sub-rare stays byte-identical,
      src/sim/professions/enchanting.ts, confirmed by the RE-QA docs audit).
- [x] A real playthrough spot-check lands inside the state.md time-to-master
      target ranges (arithmetic recorded, not vibes).
      Evidence: phase-15-tuning-evidence.md Row 5 records the arithmetic; the
      gathering-100 and fishing-200 FAST misses are explicitly ACCEPTED by the
      maintainer for this release (data-only levers, post-release tuning), so
      the row is evidenced with that caveat on record rather than silently
      green.

## Economy invariants
- [x] Pinned test: no recipe's output vendors for more than its inputs.
      Evidence: tests/recipe_economy.test.ts THE ECONOMY INVARIANT now enforces
      EVERY recipe (legacy list EMPTY, checked-count guard proves the sweep is
      non-empty); RE-QA independently recomputed all four paired-arm margins
      (80<88, 72<85, 84<93, 105<117) and the six input-only reworks under the
      reagentUnitValue rule; suite green 2026-07-22.
- [x] Training fees, craft fees (#1301), and market cut are the sinks; NPC
      shops never buy crafted goods above trivial value.
      Evidence: TRAINING_FEE_BY_TIER frozen-literal pin
      (tests/professions_training.test.ts, RE-QA green), MARKET_CUT 0.05
      (src/sim/market.ts, byte-verified by the RE-QA docs audit), craft gold
      sink pins; the burn-down closed the last vendor-positive recipes; the
      Phase 15 RE-QA additionally capped the market suggested ask at 10x sell
      value so the four re-priced commons cannot suggest their preserved
      20x-29x shop buyValues (tests/market_view.test.ts).
- [x] Masterwork power stays within the tuning bounds in `state.md` (below the
      raid floor); baseline crafted gear sits below dungeon best-in-slot.
      Evidence: Phase 2/10 raid-floor pins (tests/professions_masterwork.test.ts,
      item_level budgets); RE-QA docs audit byte-verified every FINAL tuning
      constant against state.md.
- [x] Recurring destruction is live: consumables at every cooking/alchemy
      tier, salvage and disenchant, and the cadence-capped work orders all
      consume materials or items in play; the Phase 15 faucet-vs-sink review
      is recorded with evidence.
      Evidence: tests/recipe_economy.test.ts 'cooking and alchemy have a
      consumable output at every rung' (RE-QA green);
      phase-15-tuning-evidence.md rows with the as-executed addendum;
      WORK_ORDER_CADENCE_TICKS pin (tests/professions_work_orders.test.ts).
- [x] The masterwork signed-reagent term counts ANY player's signature
      (buying a gatherer's signed materials works; the count-1 case works).
      Evidence: the any-signed pins from PR #2085 (hunted seed 69) still green
      in tests/professions_masterwork.test.ts (RE-QA wire batch); the
      vestments' count-1 spider_leg row survives the burn-down rework (RE-QA
      verified the live reagent list) so the count-1 premise stands.
- [x] The market ruling holds: gold buys materials, never skill directly; no
      gathered or monster material carries a vendor buyValue; fungible
      materials remain market-listable.
      Evidence: RE-QA printed the live ItemDefs: rough_hide, spider_leg,
      linen_scrap, homespun_cloth, bone_fragments, copper_ore, wolf_fang all
      carry no buyValue (vendor staples spool_of_thread and smithing_flux do,
      by design); the RE-QA buyValue consumer enumeration found no
      skill-for-gold surface.
- [x] Storage is honest (Phase 12d): identical-payload material stacks merge
      in bags and bank; mail attachments expire per the model with system
      mail exempt; the bank expansion ladder is the standing storage sink.
      Evidence: the 12d provenance-stacking suites; unchanged by Phase 15
      (no storage surface in the phase diff per the RE-QA file map).

## i18n completeness
- [x] Every new player-visible string (window chrome, recipe rows, station
      badges, toasts, broadcasts, NPC names and dialogue, quest text, letters,
      deed names) is a `t()` key in ENGLISH in the matching
      `src/ui/i18n.catalog/<domain>.ts`; locale overlays untouched; M16 wordy
      strings carry their five non-Latin fills.
      Evidence: tests/localization_coverage.test.ts, tests/deed_i18n.test.ts,
      and the M16 enforcement suite tests/i18n_completeness.test.ts all green
      after the RE-QA overlay rework. NOTE the two-arm disposition: the six
      reworded guide.professions keys' STALE Latin fills are stripped (pending
      now 4020 rows for the release fill), while the five non-Latin locales
      keep the phase's machine fills in place because the M16 completeness
      gate forbids English fallback on non-Latin surfaces; those fills
      translate an older English draft and are recorded as an explicit
      regenerate-from-current-English worklist in the progress.md RE-QA note.
- [x] Sim/server-origin player text has matcher rules in `src/ui/sim_i18n.ts`
      or `src/ui/server_i18n.ts` in the same change; the S3 guard
      (`npx vitest run tests/localization_fixes.test.ts`) is green AND the
      Phase 7 scanner-gap fix means `src/sim/quests/quest_commands.ts` is in
      scope.
      Evidence: RE-QA ran the S3 guard green twice (at the untouched tip and
      after its fixes); the one new Phase 15 sim emit ('That item is bound and
      cannot be sold.') landed with its matcher row in the same commit
      (error.sellBound, src/ui/sim_i18n.ts).
- [x] Numbers, money, and dates go through `formatNumber` / `formatMoney` /
      `formatDateTime`.
      Evidence: per-phase frontend-seam reviews; the Phase 15 guide tables
      render through the guide formatters (tests/guide.test.ts green in the
      RE-QA matrix).

## Design language and UX (the deeds bar)
- [x] The wheel window and crafting-window upgrades follow DESIGN.md tokens and
      chrome (no hardcoded colors, correct layer usage per `src/styles/CLAUDE.md`).
      Evidence: Phase 5/6 frontend-seam-reviewer passes (zero blocking);
      Phase 15 shipped no new window chrome (hint row rides the existing
      qd-req hint family, RE-QA verified the render path).
- [x] Desktop and mobile screenshots captured (`scripts/mobile_*.mjs` family)
      and committed under `docs/screenshots`, referenced from the PR body.
      Evidence: docs/screenshots/professions-2-phase-15/ (commit 5d8abf26a1);
      RE-QA sync-merge audit notes the shots predate the upstream xp-bar move
      by hours (cosmetic-only drift, accepted).
- [x] Tap targets comfortable; no hover-only information; safe areas respected.
      Evidence: Phase 5/6 QA live mobile probes (More-tray, tray overflow
      19-button arm); Phase 15 added no new interactive surface beyond the
      non-interactive hint row.
- [x] Graphics-settings fairness: no preset hides actionable profession info.
      Evidence: per-phase frontend-seam reviews against
      docs/design/graphics-settings-fairness.md; no profession surface reads
      the FPS governor (Phase 5/6 QA pins).
- [x] The eight-step journey (the Phase 7 vertical-slice checkpoint)
      re-verified end to end on the finished packet, desktop and mobile.
      Evidence: behaviorally re-verified by the seed-4242 scripted playthrough
      (tests/professions_deeds_playthrough.test.ts, RE-QA green: quest intro,
      gather, rare event, letter-path attunement, tier crossings, masterwork
      proc, fishing bite-and-reel, deed celebrations); the interactive
      desktop and mobile walk stands on the Phase 7 QA vertical slice plus the
      Phase 15 screenshot set (not re-walked interactively by RE-QA).

## Content integrity
- [x] Placement-safety test green: no profession NPC or station within
      aggro-plus-buffer of hostile spawns.
      Evidence: tests/professions_station_placement.test.ts (green in the
      RE-QA full-suite gate run).
- [x] Every deep craft has a full tier ladder; every recipe's materials are
      obtainable in-world; referential integrity tests green.
      Evidence: tests/recipe_economy.test.ts LADDER SHAPE PINS (9 per craft,
      3 per rung) and REFERENTIAL INTEGRITY suites green (RE-QA run); the
      burn-down commit's zone-1 obtainability was live-probed by the
      implementing session and the reagent palette re-verified by RE-QA.
- [x] Corpse component rewards no longer grant unrelated quest credit; every
      mapped tag yields a real item.
      Evidence: Phase 10 HARVEST_COMPONENT_ITEMS remap pins (quest credit
      verified questId-gated before the remap); MATERIAL DEMAND COVERAGE suite
      green (RE-QA run).
- [x] Every gathering family has its rare-event fantasy and each fires,
      localizes, and celebrates: pristine vein (ore), ancient heartwood
      (wood), moonlit bloom (herb), the glimmerfin catch (fishing), the
      perfect specimen (corpse harvesting).
      Evidence: tests/professions_deeds_playthrough.test.ts beats for
      col_pristine_vein, col_ancient_heartwood, col_moonlit_bloom,
      col_glimmerfin (real bite-and-reel), col_perfect_specimen, each
      asserting the deed EARNED through the real event path (RE-QA
      deeds-coverage audit mapped all five); the truncation negative arm was
      mutation-verified decisive by the RE-QA probe (both planted mutations
      killed).
- [x] The visible ladder holds end to end: locked Train rows name their tier
      requirement, the wheel window's next-unlock and switch-cost lines
      render, tier crossings toast (and mail for attuned majors), and a known
      recipe is NEVER use-gated (the no-admission-gate rule).
      Evidence: tests/professions_training.test.ts (RE-QA green),
      tests/professions_tier_mail.test.ts (RE-QA green, re-pins verified
      equal-or-stronger by the test-coverage audit), Phase 6 tier-up toast
      pins; enchanting remains admission-gate-free per the locked ruling.
- [x] All existing deeds remain earnable; new profession deeds registered and
      pinned in `tests/deeds_content.test.ts`; first attunement and first
      masterwork carry titles and marquee-tier renown and the pipeline fires
      (nameplate, banner, marquee broadcast).
      Evidence: RE-QA deeds-coverage audit: catalog append-only (only the
      26-deed tail plus a desc-only reword the frozen digest deliberately
      excludes), digest re-baseline sanctioned, no pre-existing pin weakened;
      prog_guildsworn and prog_masterwright carry titles at renown 25 with
      Steam marquee mappings (tests/steam_achievement_map.test.ts, 75/100
      pinned); Guildsworn retro heal pinned positive, negative, and online.

## Classic fidelity and copy
- [x] No invented balance formulas where a classic-era reference exists; XP and
      gray-out curves match the documented model.
      Evidence: the 12c curve replaced the free floor with the documented
      four-state model (state.md targets, byte-verified constants); no combat
      or XP formula changed in Phase 15 (RE-QA architecture pass).
- [x] No em dashes, en dashes, or emojis in any player-facing text, code,
      comments, or docs from this packet.
      Evidence: the qa-stop hook gated every packet commit; the RE-QA docs
      audit swept the phase diff and found only ONE pre-existing em dash
      (src/sim/market.ts comment, authored 2026-06-26 before the packet),
      fixed by RE-QA.

## Build gate and cleanup
- [x] `npm run gate` green on the release branch tier (run under Node 24 per
      memory: node25-breaks-jsdom-gate).
      Evidence: RE-QA gate run 2026-07-22 (see the Phase 15 RE-QA note in
      progress.md for the exact contract: the known environmental armory
      browser red and the local biome release-side sweep are excluded per
      memory, with error-level biome over the actual diff clean and the tail
      finished manually).
- [x] No dead code from the replaced systems: five-way quality roll consumers,
      `trivialAt`, practitioner-title keys, placeholder junk table entries,
      stale test pins (tool no-op, one-recipe-per-craft) all removed or
      re-pinned.
      Evidence: per-phase QA removals (clampMaterialRarity, CRAFTING_HUB_*,
      crafting_hub.ts, requiresHubStation); RE-QA architecture pass found no
      orphaned exports or dead arms in the Phase 15 diff (all new
      DeedStatKeys wired, all cadence imports referenced).
- [x] `asset-manifest.json` lists every placeholder asset shipped, with size,
      format, usage, and replacement notes for designers.
      Evidence: finalized in commit c1397220ca; the deed-crest and profession
      icon rows verified against the icons manifest lockstep test
      (tests suite green in the RE-QA runs).
- [x] Packet teardown offered (delete `docs/professions-2/` before the final PR)
      only on explicit maintainer confirmation.
      Evidence: offered 2026-07-22 and DEFERRED by the maintainer pending a
      selective keep-list (recorded in progress.md Notes and session memory);
      the packet stays in place in full.
