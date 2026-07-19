// Phase 10 profession materials: dedicated corpse-harvest components, their
// rare Pristine specimen counterparts, and the cheap master-stocked craft
// reagents. Merged into ITEMS by data.ts (mergeItems), same pattern as
// ZONE2_ITEMS.
//
// Crafting materials are common (white): they are reagents, not vendor trash,
// so they must never fall into the junk sweep (sellAllJunk in src/sim/items.ts
// vendors every quality 'poor' item). Enforced by
// tests/crafting_materials_quality.test.ts.
import type { ItemDef } from '../types';

export const PROFESSION_ITEMS: Record<string, ItemDef> = {
  // --- Corpse-harvest components (HARVEST_COMPONENT_ITEMS) -----------------
  // One material per component tag; never vendor-stocked (no buyValue), so
  // the only supply is harvesting tagged corpses. The old quest items
  // (boar_hide/webwood_silk/widow_venom_sac) keep their quest roles only.
  rough_hide: {
    id: 'rough_hide',
    name: 'Rough Hide',
    kind: 'junk',
    quality: 'common',
    sellValue: 5,
  },
  spider_silk: {
    id: 'spider_silk',
    name: 'Spider Silk',
    kind: 'junk',
    quality: 'common',
    sellValue: 5,
  },
  venom_gland: {
    id: 'venom_gland',
    name: 'Venom Gland',
    kind: 'junk',
    quality: 'common',
    sellValue: 6,
  },
  game_meat: {
    id: 'game_meat',
    name: 'Game Meat',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
  },
  homespun_cloth: {
    id: 'homespun_cloth',
    name: 'Homespun Cloth',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
  },

  // --- Pristine specimens (HARVEST_COMPONENT_SPECIMENS) --------------------
  // The signed jackpot a rare-or-better corpse-harvest rarity roll grants IN
  // ADDITION to the plain component (src/sim/interaction.ts harvestCorpse).
  // Rare so they read as a find, sellValue modest so they never outearn real
  // drops.
  pristine_hide: {
    id: 'pristine_hide',
    name: 'Pristine Hide',
    kind: 'junk',
    quality: 'rare',
    sellValue: 25,
  },
  pristine_silk: {
    id: 'pristine_silk',
    name: 'Pristine Silk',
    kind: 'junk',
    quality: 'rare',
    sellValue: 25,
  },
  pristine_venom_gland: {
    id: 'pristine_venom_gland',
    name: 'Pristine Venom Gland',
    kind: 'junk',
    quality: 'rare',
    sellValue: 30,
  },
  prime_cut: {
    id: 'prime_cut',
    name: 'Prime Cut',
    kind: 'junk',
    quality: 'rare',
    sellValue: 20,
  },

  // --- Vendor craft reagents ----------------------------------------------
  // Cheap staples each deep-craft master stocks at their own station hub
  // (forge/loom/tannery/kitchens/apothecary). buyValue is what the player
  // pays; sellValue is the floor(buyValue / 4) staple ratio used by the
  // premium reagents above this file's merge (thorium_ore and friends).
  smithing_flux: {
    id: 'smithing_flux',
    name: 'Smithing Flux',
    kind: 'junk',
    quality: 'common',
    sellValue: 5,
    buyValue: 20,
  },
  spool_of_thread: {
    id: 'spool_of_thread',
    name: 'Spool of Thread',
    kind: 'junk',
    quality: 'common',
    sellValue: 3,
    buyValue: 12,
  },
  tanning_agent: {
    id: 'tanning_agent',
    name: 'Tanning Agent',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
    buyValue: 16,
  },
  cooking_salt: {
    id: 'cooking_salt',
    name: 'Cooking Salt',
    kind: 'junk',
    quality: 'common',
    sellValue: 2,
    buyValue: 8,
  },
  glass_vial: {
    id: 'glass_vial',
    name: 'Glass Vial',
    kind: 'junk',
    quality: 'common',
    sellValue: 3,
    buyValue: 12,
  },

  // --- Phase 10 crafted weapon ladder (weaponcrafting) ---------------------
  // Trainer-taught outputs of LADDER_RECIPES (content/recipes.ts), three rungs
  // at skillReq 0/25/50. Stats and values were budgeted against real weapon
  // comparables; never vendor-stocked (no buyValue), and every crafted output's
  // sellValue clears strictly below its summed reagent value per the economy
  // invariant.
  copper_bearded_axe: {
    id: 'copper_bearded_axe',
    name: 'Copper Bearded Axe',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 6, max: 11, speed: 2.7 },
    sellValue: 40,
  },
  copper_flanged_mace: {
    id: 'copper_flanged_mace',
    name: 'Copper Flanged Mace',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 7, max: 11, speed: 2.9 },
    sellValue: 42,
  },
  ironbark_boar_spear: {
    id: 'ironbark_boar_spear',
    name: 'Ironbark Boar Spear',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'common',
    weapon: { min: 8, max: 14, speed: 3.2 },
    sellValue: 36,
  },
  ironedge_longsword: {
    id: 'ironedge_longsword',
    name: 'Ironedge Longsword',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 8, max: 13, speed: 2.4 },
    stats: { str: 2, sta: 1 },
    sellValue: 52,
  },
  ironshod_maul: {
    id: 'ironshod_maul',
    name: 'Ironshod Maul',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'uncommon',
    weapon: { min: 14, max: 22, speed: 3.3 },
    stats: { str: 3, sta: 2 },
    sellValue: 95,
  },
  whetted_iron_dirk: {
    id: 'whetted_iron_dirk',
    name: 'Whetted Iron Dirk',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 5, max: 9, speed: 1.8, dagger: true },
    stats: { agi: 2, sta: 1 },
    sellValue: 45,
  },
  thorium_warblade: {
    id: 'thorium_warblade',
    name: 'Thorium Warblade',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 20, max: 32, speed: 2.5 },
    stats: { str: 4, sta: 2 },
    sellValue: 275,
  },
  arcanite_war_axe: {
    id: 'arcanite_war_axe',
    name: 'Arcanite War Axe',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 22, max: 34, speed: 2.7 },
    stats: { agi: 4, sta: 2 },
    sellValue: 300,
  },
  elderwood_battle_staff: {
    id: 'elderwood_battle_staff',
    name: 'Elderwood Battle Staff',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 19, max: 31, speed: 3.0 },
    stats: { int: 4, spi: 2 },
    sellValue: 285,
  },

  // --- Phase 10 crafted armor ladder (armorcrafting) -----------------------
  // Trainer-taught outputs of LADDER_RECIPES, three rungs at skillReq 0/25/50.
  // All mail. Armor and primary stats sit on the repo budget formula
  // (src/sim/item_budget.ts) per the ladder design notes; common-rung pieces
  // are armor-only (common quality carries no primary-stat budget). Never
  // vendor-stocked, sellValue below summed reagent value.
  riveted_copper_girdle: {
    id: 'riveted_copper_girdle',
    name: 'Riveted Copper Girdle',
    kind: 'armor',
    armorType: 'mail',
    slot: 'waist',
    quality: 'common',
    stats: { armor: 33 },
    sellValue: 42,
  },
  coppermail_sabatons: {
    id: 'coppermail_sabatons',
    name: 'Coppermail Sabatons',
    kind: 'armor',
    armorType: 'mail',
    slot: 'feet',
    quality: 'common',
    stats: { armor: 38 },
    sellValue: 40,
  },
  coppermail_gauntlets: {
    id: 'coppermail_gauntlets',
    name: 'Coppermail Gauntlets',
    kind: 'armor',
    armorType: 'mail',
    slot: 'gloves',
    quality: 'common',
    stats: { armor: 36 },
    sellValue: 26,
  },
  ironlink_hauberk: {
    id: 'ironlink_hauberk',
    name: 'Ironlink Hauberk',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 88, str: 3, sta: 3 },
    sellValue: 80,
  },
  ironlink_legguards: {
    id: 'ironlink_legguards',
    name: 'Ironlink Legguards',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 78, agi: 3, sta: 3 },
    sellValue: 78,
  },
  ironlink_spaulders: {
    id: 'ironlink_spaulders',
    name: 'Ironlink Spaulders',
    kind: 'armor',
    armorType: 'mail',
    slot: 'shoulder',
    quality: 'uncommon',
    stats: { armor: 66, str: 3, sta: 2 },
    sellValue: 48,
  },
  thoriumscale_greathelm: {
    id: 'thoriumscale_greathelm',
    name: 'Thoriumscale Greathelm',
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'rare',
    stats: { armor: 102, str: 6, sta: 5 },
    sellValue: 340,
  },
  thoriumscale_cuirass: {
    id: 'thoriumscale_cuirass',
    name: 'Thoriumscale Cuirass',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 122, str: 6, sta: 7 },
    sellValue: 420,
  },
  thoriumscale_leggings: {
    id: 'thoriumscale_leggings',
    name: 'Thoriumscale Leggings',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'rare',
    stats: { armor: 110, str: 6, sta: 6 },
    sellValue: 350,
  },
};
