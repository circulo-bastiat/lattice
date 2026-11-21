// itemusescen.mjs — the ITEM-USE referee pack (infra W, 25 Sept 2026): a real growbot player's
// right-click with a SPAWN EGG or BONE MEAL, judged against the engine's REAL click path. Same
// harness as BUCKET/USE-ON-BLOCK/BLOCK-USE (runbucket.mjs --pack itemuse, bucketrefcheck.mjs
// --pack itemuse): the growbot at (0.5, F, 0.5) looking straight down, target cell (0, F-1, 0),
// face UP, cursor (0.5, 1, 0.5). `via`: 'block' sends Player Block Placement (0x2e,
// ItemStack.useOnBlock); 'item' sends Use Item (0x2f, Item.use's own raycast — the spawn-egg
// SOURCE_ONLY water case).
// Vanilla sources (.decomp): SpawnEggItem.useOnBlock/use (item/SpawnEggItem.java — no line-numbered
// Java in this .decomp subset, cited by name only, same as useonscen.mjs's own header); BoneMealItem
// .useOnFertilizable (item/BoneMealItem.java:58-75: decrements the stack whenever the target
// `isFertilizable`, REGARDLESS of whether `canGrow` rolls true — growth itself is a SEPARATE roll);
// CropBlock.grow/getGrowthAmount (block/CropBlock.java:98-99: `applyGrowth` adds a uniform
// MathHelper.nextInt(2,5) to age, clamped to MAX_AGE 7 — wheat/carrots share this via CropBlock);
// SaplingBlock.grow (block/SaplingBlock.java:38-58: `canGrow` is a 45% roll (line 53), `generate`
// at stage 0 just cycles STAGE to 1 — deterministic once canGrow passes); GrassBlock.grow (not
// scened here — a >100-line worldgen-feature call, out of scope for this pack's budget, noted below);
// MobSpawnerBlockEntity via SpawnEggItem on a spawner (14l_use.js:622-634's own citation: a spawn
// egg on the SPAWNER BLOCK ITSELF sets `SpawnData`/`entity` and spawns nothing, `Spawner.assign`).
//
// `spawner: true` scenes read the clicked cell's assigned mob type instead of a `test` block
// predicate (SpawnData carries no vanilla block-state property to test with `execute if block`) —
// see runbucket.mjs/bucketrefcheck.mjs's own `spawner` readout, added for this pack.
// `prob: true` scenes are compared with a binomial tolerance (see bucketrefcheck.mjs `tolFrac`),
// not exact fraction equality — canGrow (spawn-independent) and getGrowthAmount are both random.
//
// Deliberately NOT scened (budget; left as follow-up, not vacuity — the two mechanisms below share
// no code path with anything scened here so their absence does not hide a bug this pack could catch):
// bone meal on carrots (identical CropBlock.getGrowthAmount join to wheat, no separate code path),
// bone meal on a grass_block (GrassBlock.grow places flowers via biome feature lookups — no cheap
// deterministic-ish readout), a spawn egg clicked on a genuine SIDE face (this harness's engine half
// re-derives face from `P.retarget()`'s own straight-down ray rather than trusting the packet's
// face field, the same as every other pack here — a bot that only ever looks straight down cannot
// present the engine with a side face without first faking a raycast result no real client sends).
export const REPS = 20;
export const SCEN = [
  { id: 'egg_pig_on_stone', via: 'block', item: 'pig_spawn_egg', n: 1, count: ['pig'] },
  { id: 'egg_pig_on_stone_creative', mode: 'creative', via: 'block', item: 'pig_spawn_egg', n: 1, count: ['pig'] },
  { id: 'egg_zombie_on_stone', via: 'block', item: 'zombie_spawn_egg', n: 1, count: ['zombie'] },
  { id: 'egg_cow_on_stone', via: 'block', item: 'cow_spawn_egg', n: 1, count: ['cow'] },
  { id: 'egg_pig_on_spawner', via: 'block', item: 'pig_spawn_egg', n: 1, set: { '-1': 'spawner' }, spawner: true },
  { id: 'egg_pig_on_spawner_creative', mode: 'creative', via: 'block', item: 'pig_spawn_egg', n: 1, set: { '-1': 'spawner' }, spawner: true },
  { id: 'egg_pig_use_item_water', via: 'item', item: 'pig_spawn_egg', n: 1, set: { '-1': 'water' }, count: ['pig'] },
  { id: 'bonemeal_wheat_age0', via: 'block', item: 'bone_meal', n: 1, set: { '-1': 'wheat[age=0]' }, prob: true,
    test: ['-1:wheat[age=0]', '-1:wheat[age=2]', '-1:wheat[age=3]', '-1:wheat[age=4]', '-1:wheat[age=5]'] },
  { id: 'bonemeal_wheat_mature', via: 'block', item: 'bone_meal', n: 1, set: { '-1': 'wheat[age=7]' }, test: ['-1:wheat[age=7]'] },
  { id: 'bonemeal_sapling_stage0', via: 'block', item: 'bone_meal', n: 1, set: { '-1': 'oak_sapling[stage=0]' }, prob: true,
    test: ['-1:oak_sapling[stage=0]', '-1:oak_sapling[stage=1]'] },
  { id: 'bonemeal_on_stone', via: 'block', item: 'bone_meal', n: 1, test: ['-1:stone'] },
  { id: 'bonemeal_creative_wheat0', mode: 'creative', via: 'block', item: 'bone_meal', n: 1, set: { '-1': 'wheat[age=0]' }, prob: true,
    test: ['-1:wheat[age=0]', '-1:wheat[age=2]', '-1:wheat[age=3]', '-1:wheat[age=4]', '-1:wheat[age=5]'] },
];
