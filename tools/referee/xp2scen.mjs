// xp2scen.mjs — the BREEDING + FURNACE XP referee pack's scenarios (infra I6 xp2, 25 Sept 2026),
// shared by runxp2.mjs (server) and xp2refcheck.mjs (engine).
//
// (A) BREEDING: `Animal.spawnChildFromBreeding` (.decomp/net/minecraft/entity/passive/
// AnimalEntity.java:214-238) rolls `world.getRandom().nextInt(7) + 1` and spawns ONE experience
// orb at the parent the caller bred FROM, behind `doMobLoot` -- independent of any player being
// nearby (unlike mob-kill xp). Engine: `Br.breed(a, b, ctx)` -> `Br.spawnXp(a, ctx)`
// (src/07m_breed.js), which rolls `Math.floor(rand() * Br.C.xpBound) + 1` and (G21) routes it
// through `Xp.spawn` (07zz_xporb.js) exactly like every other orb.
//
// (B) FURNACE XP ON BREAK: `AbstractFurnaceBlock.onStateReplaced` (.decomp/net/minecraft/block/
// AbstractFurnaceBlock.java:65-79) calls `AbstractFurnaceBlockEntity.getRecipesUsedAndDropExperience`
// (.decomp .../block/entity/AbstractFurnaceBlockEntity.java:468-479), which for every recipe in the
// RecipesUsed ledger does `dropExperience`: `base = MathHelper.floor(count * xp)`, `frac =
// fractionalPart(count * xp)`, `+1` with probability `frac` (line 483-489), then spawns ONE
// `ExperienceOrbEntity.spawn(world, pos, amount)` per recipe. The 5 recipes below are real vanilla
// recipe ids (data/minecraft/recipes/*.json in the 1.18.2 jar), not guessed.
export const BREED_N = 100;         // pairs per species on the server
export const BREED_ENGINE_N = 800;  // breeds per species in the engine

export const BREED_SPECIES = [
  { id: 'cow', mob: 'cow' },
  { id: 'sheep', mob: 'sheep' },
  { id: 'pig', mob: 'pig' },
  { id: 'chicken', mob: 'chicken' },
  { id: 'rabbit', mob: 'rabbit' },
];

// Furnace: recipe id (exactly as the 1.18.2 jar names it) + its `experience` field (verified
// against data/minecraft/recipes/*.json, unzipped from jars/1.18.2/1.18.2.jar) + the counts to
// exercise the MathHelper.floor/fractionalPart rounding at.
export const FURNACE_RECIPES = [
  { id: 'minecraft:iron_ingot_from_smelting_iron_ore', short: 'iron_ore', xp: 0.7 },
  { id: 'minecraft:stone', short: 'cobble_stone', xp: 0.1 },
  { id: 'minecraft:dried_kelp_from_smelting', short: 'kelp', xp: 0.1 },
  { id: 'minecraft:gold_ingot_from_smelting_gold_ore', short: 'gold_ore', xp: 1.0 },
  { id: 'minecraft:glass', short: 'sand', xp: 0.1 },
];
export const FURNACE_COUNTS = [1, 3, 10, 64];
export const FURNACE_N = 100;         // breaks per (recipe, count) combo on the server
export const FURNACE_ENGINE_N = 2000; // breaks per combo in the engine (rounding is one Bernoulli draw per break)

// every (recipe, count) combo as one flat list, id-stable for both sides
export const FURNACE_VARIANTS = FURNACE_RECIPES.flatMap((r) =>
  FURNACE_COUNTS.map((n) => ({ id: `${r.short}_x${n}`, recipe: r.id, xp: r.xp, n })));
