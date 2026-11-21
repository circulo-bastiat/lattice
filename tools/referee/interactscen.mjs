// interactscen.mjs — the MOB RIGHT-CLICK INTERACTIONS referee pack (infra I6, s145, 25 Sept 2026): milking, stew, shearing, dyeing,
// saddling, bucketing — shared by runinteract.mjs (the real 1.18.2 server: a growbot survival player's own right-click, Interact
// Entity type 0, on NBT-summoned NoAI mobs) and interactrefcheck.mjs (the engine's join: Use.entityUse). Per click the player's
// inventory is cleared and exactly `n` of the item put in the main hand (so a stack of 16 buckets shows what happens to the other
// 15: ItemUsage.exchangeStack keeps them), then measured: the main-hand stack after (id, count, damage), how many of `gets` are
// anywhere in the inventory, and per batch: the dropped item total for each `drops` id, the SUM of the mob's `flag` NBT, how many
// clicked mobs are still there, how many `becomes` mobs exist.
// Vanilla sources (.decomp): CowEntity/GoatEntity.interactMob (bucket, !isBaby), MooshroomEntity.interactMob (bowl, !isBaby; shears
// -> cow + 5 mushrooms), SheepEntity (isShearable: !sheared && !isBaby; 1..3 wool), DyeItem.useOnEntity, SaddledComponent/Saddleable,
// SnowGolemEntity.sheared, Bucketable.tryBucket (a WATER bucket only).
export const BATCH = 6;
export const BATCHES = 2;          // 12 clicks per scene
const B = -23900;                  // a baby, mid growUp plateau (breedscen.mjs's own reason)
export const SCEN = [
  { id: 'cow_bucket', mob: 'cow', item: 'bucket', n: 1, gets: 'milk_bucket' },
  { id: 'cow_bucket_stack16', mob: 'cow', item: 'bucket', n: 16, gets: 'milk_bucket' },
  { id: 'cow_bucket_baby', mob: 'cow', item: 'bucket', n: 1, gets: 'milk_bucket', nbt: `Age:${B}` },
  { id: 'goat_bucket', mob: 'goat', item: 'bucket', n: 1, gets: 'milk_bucket' },
  { id: 'goat_bucket_stack16', mob: 'goat', item: 'bucket', n: 16, gets: 'milk_bucket' },
  { id: 'goat_bucket_baby', mob: 'goat', item: 'bucket', n: 1, gets: 'milk_bucket', nbt: `Age:${B}` },
  { id: 'mooshroom_bucket', mob: 'mooshroom', item: 'bucket', n: 1, gets: 'milk_bucket' },
  { id: 'mooshroom_bowl', mob: 'mooshroom', item: 'bowl', n: 1, gets: 'mushroom_stew' },
  { id: 'mooshroom_bowl_stack8', mob: 'mooshroom', item: 'bowl', n: 8, gets: 'mushroom_stew' },
  { id: 'mooshroom_bowl_baby', mob: 'mooshroom', item: 'bowl', n: 1, gets: 'mushroom_stew', nbt: `Age:${B}` },
  { id: 'mooshroom_shears', mob: 'mooshroom', item: 'shears', n: 1, drops: ['red_mushroom'], becomes: 'cow' },
  { id: 'brown_mooshroom_shears', mob: 'mooshroom', item: 'shears', n: 1, nbt: 'Type:"brown"', drops: ['brown_mushroom'], becomes: 'cow' },
  { id: 'mooshroom_shears_baby', mob: 'mooshroom', item: 'shears', n: 1, nbt: `Age:${B}`, drops: ['red_mushroom'], becomes: 'cow' },
  { id: 'sheep_shears', mob: 'sheep', item: 'shears', n: 1, drops: ['white_wool'], flag: 'Sheared' },
  { id: 'red_sheep_shears', mob: 'sheep', item: 'shears', n: 1, nbt: 'Color:14b', drops: ['red_wool', 'white_wool'], flag: 'Sheared' },
  { id: 'sheep_shears_baby', mob: 'sheep', item: 'shears', n: 1, nbt: `Age:${B}`, drops: ['white_wool'], flag: 'Sheared' },
  { id: 'sheep_shears_sheared', mob: 'sheep', item: 'shears', n: 1, nbt: 'Sheared:1b', drops: ['white_wool'], flag: 'Sheared' },
  { id: 'sheep_red_dye', mob: 'sheep', item: 'red_dye', n: 4, flag: 'Color' },
  { id: 'sheep_white_dye_on_white', mob: 'sheep', item: 'white_dye', n: 4, flag: 'Color' },
  { id: 'snow_golem_shears', mob: 'snow_golem', item: 'shears', n: 1, drops: ['carved_pumpkin'], flag: 'Pumpkin' },
  { id: 'pig_saddle', mob: 'pig', item: 'saddle', n: 1, flag: 'Saddle' },
  { id: 'pig_saddle_baby', mob: 'pig', item: 'saddle', n: 1, nbt: `Age:${B}`, flag: 'Saddle' },
  { id: 'pig_saddle_saddled', mob: 'pig', item: 'saddle', n: 1, nbt: 'Saddle:1b', flag: 'Saddle' },
  { id: 'strider_saddle', mob: 'strider', item: 'saddle', n: 1, flag: 'Saddle' },
  { id: 'axolotl_water_bucket', mob: 'axolotl', item: 'water_bucket', n: 1, gets: 'axolotl_bucket' },
  { id: 'axolotl_empty_bucket', mob: 'axolotl', item: 'bucket', n: 1, gets: 'axolotl_bucket' },
  { id: 'cod_water_bucket', mob: 'cod', item: 'water_bucket', n: 1, gets: 'cod_bucket' },
  { id: 'salmon_water_bucket', mob: 'salmon', item: 'water_bucket', n: 1, gets: 'salmon_bucket' },
  { id: 'pufferfish_water_bucket', mob: 'pufferfish', item: 'water_bucket', n: 1, gets: 'pufferfish_bucket' },
  { id: 'tropical_fish_water_bucket', mob: 'tropical_fish', item: 'water_bucket', n: 1, gets: 'tropical_fish_bucket' },
  { id: 'cod_empty_bucket', mob: 'cod', item: 'bucket', n: 1, gets: 'cod_bucket' },
];
// sheep Color byte -> the engine's woolColor name (DyeColor ids, .decomp)
export const DYE = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue',
  'brown', 'green', 'red', 'black'];
