// fallscen.mjs — the FALL DAMAGE referee pack's scenarios (infra I6, 25 Sept 2026), shared by runfall.mjs (the real 1.18.2
// server) and fallrefcheck.mjs (the engine). Deterministic: LivingEntity.handleFallDamage -> computeFallDamage =
// ceil((fallDistance - 3 - jumpBoost) * damageMultiplier), the landing block's own onLandedUpon multiplier (hay/honey 0.2,
// slime 0, water resets fallDistance), per-type overrides (chicken/cat/goat/horse/iron golem...), feather falling through
// the protection EPF. Each scenario: ONE mob (AI on -- a NoAI mob never travels, so never falls: MobEntity.canMoveVoluntarily)
// summoned at `h` blocks above a 3x3 landing pad of `land` inside a glass shaft, at night; the damage taken is
// Health(before) - Health(after 80 ticks). Every scenario runs REPS times on the server (it must be constant).
export const REPS = 3;
export const SCEN = [
  { id: 'pig_h4', mob: 'pig', h: 4, land: 'stone' },
  { id: 'pig_h5', mob: 'pig', h: 5, land: 'stone' },
  { id: 'pig_h8', mob: 'pig', h: 8, land: 'stone' },
  { id: 'cow_h12', mob: 'cow', h: 12, land: 'stone' },
  { id: 'cow_h12_hay', mob: 'cow', h: 12, land: 'hay_block' },
  { id: 'cow_h12_honey', mob: 'cow', h: 12, land: 'honey_block' },
  { id: 'cow_h12_slime', mob: 'cow', h: 12, land: 'slime_block' },
  { id: 'cow_h12_water', mob: 'cow', h: 12, land: 'water' },
  { id: 'zombie_h12', mob: 'zombie', h: 12, land: 'stone' },
  { id: 'zombie_h23', mob: 'zombie', h: 23, land: 'stone' },
  { id: 'zombie_h12_ff4', mob: 'zombie', h: 12, land: 'stone',
    nbt: 'ArmorItems:[{id:"minecraft:diamond_boots",Count:1b,tag:{Enchantments:[{id:"minecraft:feather_falling",lvl:4s}]}},{},{},{}],ArmorDropChances:[0f,0f,0f,0f]' },
  { id: 'zombie_h12_armor', mob: 'zombie', h: 12, land: 'stone',
    nbt: 'ArmorItems:[{id:"minecraft:diamond_boots",Count:1b},{id:"minecraft:diamond_leggings",Count:1b},{id:"minecraft:diamond_chestplate",Count:1b},{id:"minecraft:diamond_helmet",Count:1b}],ArmorDropChances:[0f,0f,0f,0f]' },
  { id: 'skeleton_h12', mob: 'skeleton', h: 12, land: 'stone' },
  { id: 'villager_h12', mob: 'villager', h: 12, land: 'stone' },
  { id: 'wolf_h12', mob: 'wolf', h: 12, land: 'stone' },
  { id: 'chicken_h23', mob: 'chicken', h: 23, land: 'stone' },
  { id: 'cat_h12', mob: 'cat', h: 12, land: 'stone' },
  { id: 'goat_h12', mob: 'goat', h: 12, land: 'stone' },
  { id: 'goat_h23', mob: 'goat', h: 23, land: 'stone' },
  { id: 'horse_h12', mob: 'horse', h: 12, land: 'stone', nbt: 'Attributes:[{Name:"minecraft:generic.max_health",Base:30d}],Health:30f' },
  { id: 'iron_golem_h23', mob: 'iron_golem', h: 23, land: 'stone' },
  { id: 'spider_h12', mob: 'spider', h: 12, land: 'stone' },
  { id: 'sheep_h23', mob: 'sheep', h: 23, land: 'stone' },
];
export const T = 80;          // ticks after the summon (a 23-block fall lands by tick ~27)
export const PITCH = 6;       // shaft spacing: 3x3 pad + glass walls
