// meleescen.mjs — the MOB MELEE (mob-hits-player) referee pack's scenarios (infra W, 25 Sept 2026),
// shared by runmelee.mjs (the real 1.18.2 server) and meleerefcheck.mjs (the engine). Each scenario is
// ONE hostile mob summoned 1 block from a real survival player (a growbot fake client), AI on, in an
// open flat lane; the recorded number is the health lost on the FIRST hit landed within T ticks of the
// spawn, plus any status effect the hit itself applies (Hunger/Poison/Wither). Armour is the PLAYER's
// own (none / full iron / full diamond / diamond+Protection IV); difficulty is server-wide, so the
// extra difficulty scenarios (cave_spider's Poison duration, CaveSpider.onHit/07zs_spawner.js) run as
// their own pass at easy/hard, reusing the same lane the normal-difficulty pass already covers.
//
// Scope cut (still_owed, not guessed): hoglin/zoglin/slime/magma_cube/enderman are NOT in this pack --
// hoglin/zoglin need the engine's own random-adult-damage roll and knockback wired into a lane the same
// way fall's pig/cow lanes needed nothing extra, slime/magma_cube need a `Size` NBT <-> engine size
// convention this pass did not have time to cross-check bit-for-bit, and enderman will not anger without
// a real player action (stare/hit) this headless bot cannot perform. Every one is a DROP, not a guess.
export const REPS = 3;
export const T = 100;            // ticks to observe the first hit (5 s -- adjacent spawn, AI on)
export const PITCH = 6;          // lane spacing along x
export const Y = -59;            // flat world's grass top (server.mjs's own flat preset: bedrock 1, dirt 2, grass 1 from y -64)

// Player armour tiers (the DEFENDER's own gear). `prot4` pieces carry Protection IV; the engine's own
// `Sv.updateArmor` (src/14d_survival.js:127-164) sums ONLY `IT.defenseOf`/`toughnessOf` off the ARMOR
// slots -- no enchantment is ever read for incoming damage on the player's side (nothing in
// src/14d_survival.js or src/14j_combat.js's `Cb.mobAttack` calls `Cb.enchantLevel`/`protectionReduce`
// for the DEFENDER; that helper (14j_combat.js:416-417) only fires for a MOB's own worn armour, the
// opposite direction) -- so `diamond` and `diamond_prot4` are predicted, before any server run, to come
// back numerically IDENTICAL on the engine side while vanilla's own Protection IV knocks the hit down
// further. That prediction is the pack's headline anti-vacuity-adjacent check, not a guess to patch src.
export const ARMOR = {
  none: [],
  iron: ['iron_boots', 'iron_leggings', 'iron_chestplate', 'iron_helmet'],
  diamond: ['diamond_boots', 'diamond_leggings', 'diamond_chestplate', 'diamond_helmet'],
  diamond_prot4: ['diamond_boots', 'diamond_leggings', 'diamond_chestplate', 'diamond_helmet'],
};
export const ARMOR_TIERS = Object.keys(ARMOR);

// Each mob: `mob` (vanilla+engine type id shared, D-331: same name both sides), `nbt` (server-side
// summon NBT for a non-default weapon), `hand` (engine-side item to put in the mob's own main hand,
// mirrored 1:1 with `nbt`'s HandItems, via `Eq.setEquipped`), `effect` (the status this hit is expected
// to apply, read back from both sides -- 'hunger'/'poison'/'wither'/null).
// `NOWEP` clears the mob's own natural-equipment roll (`MobEntity.initEquipment`'s random chance of a
// spawned-in weapon/armour piece, e.g. zombie/husk) so the "unarmed" scenarios are not contaminated by
// vanilla's own randomness on TOP of the randomness this pack is trying to measure -- summon NBT is
// applied AFTER `initialize()`'s equipment roll (EntityType.loadFromEntityNbt), so an explicit empty
// HandItems/ArmorItems always wins.
const NOWEP = 'HandItems:[{},{}],ArmorItems:[{},{},{},{}],ArmorDropChances:[0f,0f,0f,0f],HandDropChances:[0f,0f]';
export const MOBS = [
  { id: 'zombie', mob: 'zombie', nbt: NOWEP, effect: null },
  { id: 'zombie_sword', mob: 'zombie', nbt: 'HandItems:[{id:"minecraft:iron_sword",Count:1b},{}],ArmorItems:[{},{},{},{}],ArmorDropChances:[0f,0f,0f,0f],HandDropChances:[0f,0f]', hand: 'iron_sword', effect: null },
  { id: 'husk', mob: 'husk', nbt: NOWEP, effect: 'hunger' },
  { id: 'vindicator', mob: 'vindicator', effect: null },     // VindicatorEntity.initEquipment always gives an iron_axe (.decomp)
  { id: 'piglin_brute', mob: 'piglin_brute', effect: null }, // PiglinBruteEntity.initEquipment always gives a golden_axe (.decomp)
  { id: 'spider', mob: 'spider', effect: null },
  { id: 'cave_spider', mob: 'cave_spider', effect: 'poison' },
  { id: 'wither_skeleton', mob: 'wither_skeleton', effect: 'wither' }, // AbstractSkeletonEntity.initEquipment: a stone_sword (.decomp)
];

// Difficulty ids -> numeric StatusEffect raw ids (StatusEffectInstance.writeNbt, .decomp:209 -- 1.18.2
// still writes the LEGACY numeric "Id" byte, not a namespaced id) used to read ActiveEffects back over
// RCON without a datapack: hunger 17, poison 19, wither 20.
export const EFFECT_RAWID = { hunger: 17, poison: 19, wither: 20 };

// The extra difficulty pass for cave_spider's Poison duration (07zs_spawner.js `CS.POISON_TICKS`);
// 'normal' is already the main matrix's own `cave_spider@none` case, so only easy/hard repeat it.
export const DIFF_EXTRA = ['easy', 'hard'];
// infra I6 (s148): the difficulty damage scaling itself (PlayerEntity.damage: easy = min(amount/2+1, amount),
// hard = amount*3/2 for a LivingEntity attacker -- read from the server, never assumed), run for every mob
// below at easy AND hard on an unarmoured player, all lanes in parallel per rep. cave_spider stays in (its
// Poison duration was the original reason for this pass).
export const DIFF_MOBS = ['zombie', 'zombie_sword', 'husk', 'vindicator', 'piglin_brute', 'spider', 'cave_spider'];
