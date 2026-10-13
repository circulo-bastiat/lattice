// breedscen.mjs — the BREEDING / FEEDING referee pack (infra I6, s145, 25 Sept 2026), shared by runbreed.mjs (the real 1.18.2
// server: a growbot survival player's own right-click, Interact Entity type 0, plus AI pens for the mating itself) and
// breedrefcheck.mjs (the engine's joins: Use.entityUse for a right-click, Breed.breed for the birth).
//
// FEED scenes — AnimalEntity.interactMob (.decomp): a breeding item on an adult with Age 0 that can fall in love -> eat + love;
// on a baby -> eat + growUp(toGrowUpAge(-age), true) (the (int)((float)(-age/20)*0.1F) arithmetic); anything else -> PASS
// (nothing used). Each batch: BATCH fed mobs (clicked) + BATCH control mobs (never clicked, same Age at summon, same ticks
// elapsed) — so "Age after the click" is measured as SUM(fed Age) - SUM(control Age), which cancels the per-tick age drift and
// leaves exactly the growUp step. `age` is the Age the mob is summoned with.
// MATE scenes — two adults summoned with InLove:600 in their own glass pen, real AI (AnimalMateGoal): after WAIT_MATE_MS,
// per pen: babies born, and the invariant 2*SUM(baby Age) + SUM(parent Age) — both tick at the same rate in opposite
// directions, so it equals 2*babyStartAge + 2*breedCooldownAge regardless of when the birth happened — plus XP orb value.
// ⚠ BABY AGES SIT MID-PLATEAU: toGrowUpAge only changes every 200 ticks of age, and Age keeps ticking between the summon and the
// click (NoAI does not stop PassiveEntity.tickMovement), so -24000 exactly would be measured at -23999.. (119 s, not 120 s: an
// empirical first run). -23900 / -1100 / -350 each give the same growUp for any click within ~100-150 ticks of the summon.
export const BATCH = 10;
export const BATCHES = 2;              // 20 clicks per feed scene
export const PENS = 6;                 // pairs per mate scene
export const WAIT_MATE_MS = 14000;
export const FEED = [
  // adults with Age 0: love
  { id: 'cow_wheat', mob: 'cow', item: 'wheat', age: 0 },
  { id: 'mooshroom_wheat', mob: 'mooshroom', item: 'wheat', age: 0 },
  { id: 'sheep_wheat', mob: 'sheep', item: 'wheat', age: 0 },
  { id: 'goat_wheat', mob: 'goat', item: 'wheat', age: 0 },
  { id: 'pig_carrot', mob: 'pig', item: 'carrot', age: 0 },
  { id: 'pig_potato', mob: 'pig', item: 'potato', age: 0 },
  { id: 'pig_beetroot', mob: 'pig', item: 'beetroot', age: 0 },
  { id: 'chicken_wheat_seeds', mob: 'chicken', item: 'wheat_seeds', age: 0 },
  { id: 'chicken_melon_seeds', mob: 'chicken', item: 'melon_seeds', age: 0 },
  { id: 'chicken_pumpkin_seeds', mob: 'chicken', item: 'pumpkin_seeds', age: 0 },
  { id: 'chicken_beetroot_seeds', mob: 'chicken', item: 'beetroot_seeds', age: 0 },
  { id: 'rabbit_dandelion', mob: 'rabbit', item: 'dandelion', age: 0 },
  { id: 'rabbit_carrot', mob: 'rabbit', item: 'carrot', age: 0 },
  { id: 'rabbit_golden_carrot', mob: 'rabbit', item: 'golden_carrot', age: 0 },
  { id: 'fox_sweet_berries', mob: 'fox', item: 'sweet_berries', age: 0 },
  { id: 'fox_glow_berries', mob: 'fox', item: 'glow_berries', age: 0 },
  { id: 'bee_poppy', mob: 'bee', item: 'poppy', age: 0 },
  { id: 'bee_wither_rose', mob: 'bee', item: 'wither_rose', age: 0 },
  { id: 'turtle_seagrass', mob: 'turtle', item: 'seagrass', age: 0 },
  { id: 'panda_bamboo', mob: 'panda', item: 'bamboo', age: 0 },
  { id: 'strider_warped_fungus', mob: 'strider', item: 'warped_fungus', age: 0 },
  { id: 'hoglin_crimson_fungus', mob: 'hoglin', item: 'crimson_fungus', age: 0 },
  { id: 'axolotl_fish_bucket', mob: 'axolotl', item: 'tropical_fish_bucket', age: 0 },
  // the wrong food: PASS, nothing used
  { id: 'cow_carrot', mob: 'cow', item: 'carrot', age: 0 },
  { id: 'pig_wheat', mob: 'pig', item: 'wheat', age: 0 },
  { id: 'chicken_wheat', mob: 'chicken', item: 'wheat', age: 0 },
  { id: 'sheep_seeds', mob: 'sheep', item: 'wheat_seeds', age: 0 },
  // breeding cooldown (adult, Age > 0): PASS
  { id: 'cow_wheat_cooldown', mob: 'cow', item: 'wheat', age: 6000 },
  { id: 'pig_carrot_cooldown', mob: 'pig', item: 'carrot', age: 6000 },
  // babies: growUp
  { id: 'cow_wheat_baby', mob: 'cow', item: 'wheat', age: -23900 },
  { id: 'cow_wheat_baby_small', mob: 'cow', item: 'wheat', age: -1100 },
  { id: 'cow_wheat_baby_tiny', mob: 'cow', item: 'wheat', age: -350 },
  { id: 'pig_carrot_baby', mob: 'pig', item: 'carrot', age: -23900 },
  { id: 'chicken_seeds_baby', mob: 'chicken', item: 'wheat_seeds', age: -23900 },
  { id: 'sheep_wheat_baby', mob: 'sheep', item: 'wheat', age: -23900 },
  { id: 'rabbit_carrot_baby', mob: 'rabbit', item: 'carrot', age: -23900 },
  { id: 'fox_berries_baby', mob: 'fox', item: 'sweet_berries', age: -23900 },
  { id: 'hoglin_fungus_baby', mob: 'hoglin', item: 'crimson_fungus', age: -23900 },
  { id: 'strider_fungus_baby', mob: 'strider', item: 'warped_fungus', age: -23900 },
  { id: 'goat_wheat_baby', mob: 'goat', item: 'wheat', age: -23900 },
  { id: 'panda_bamboo_baby', mob: 'panda', item: 'bamboo', age: -23900 },
  { id: 'turtle_seagrass_baby', mob: 'turtle', item: 'seagrass', age: -23900 },
  { id: 'bee_poppy_baby', mob: 'bee', item: 'poppy', age: -23900 },
  { id: 'axolotl_bucket_baby', mob: 'axolotl', item: 'tropical_fish_bucket', age: -23790 },
];
// (goat left out: in 14 s only 2 of 6 goat pairs had bred on the server -- too slow for a fixed wait, empirical)
export const MATE = [
  { id: 'cow_mate', mob: 'cow' },
  { id: 'pig_mate', mob: 'pig' },
  { id: 'sheep_mate', mob: 'sheep' },
  { id: 'chicken_mate', mob: 'chicken' },
  { id: 'rabbit_mate', mob: 'rabbit' },
];
