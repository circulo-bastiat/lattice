// bucketscen.mjs — the BUCKET referee pack (infra I6, s146, 25 Sept 2026): a real player's right-click with a bucket AT A BLOCK —
// picking a fluid up (water/lava sources, a waterlogged slab, powder snow, a flowing cell), pouring one out (water/lava on stone,
// water on a slab it can waterlog, a fish bucket), each with a single bucket, a 16-stack, and in creative. Shared by runbucket.mjs
// (the real 1.18.2 server: a growbot player at (0.5, F, 0.5) looking STRAIGHT DOWN — `/tp ... 0 90` — sends one Use Item packet;
// BucketItem.use raycasts from the eye itself) and bucketrefcheck.mjs (the engine's own join: P.retarget() then Use.rightClick(P)
// on the same cells, same look).
// Cells are (0, F+dy, 0). A stone box is rebuilt around the column before every click: stone at dy -3..-1 in a 5x5, air above.
// `set` overrides cells (dy -> block state string); `test` are block predicates read after the click (`execute if block`);
// `gets` are item ids counted anywhere in the inventory after the click; `count` entity types counted in the box.
// Vanilla sources (.decomp): BucketItem.use (raycast SOURCE_ONLY when empty, NONE when full; FluidDrainable.tryDrainFluid;
// FluidFillable for a waterloggable target with WATER only; placeFluid), ItemUsage.exchangeStack (a stack keeps n-1 and the filled
// bucket goes to the inventory; creative keeps the held stack and adds the output only if absent), EntityBucketItem (fish),
// PowderSnowBlock.tryDrainFluid, Waterloggable.tryDrainFluid.
export const REPS = 3;
const STONE = 'stone';
export const SCEN = [
  // ── pick up ──
  { id: 'water_source_bucket', item: 'bucket', n: 1, set: { '-1': 'water' }, gets: ['water_bucket'], test: ['-1:air', '-1:water'] },
  { id: 'water_source_bucket_stack16', item: 'bucket', n: 16, set: { '-1': 'water' }, gets: ['water_bucket', 'bucket'], test: ['-1:air', '-1:water'] },
  { id: 'lava_source_bucket', item: 'bucket', n: 1, set: { '-1': 'lava' }, gets: ['lava_bucket'], test: ['-1:air', '-1:lava'] },
  { id: 'lava_source_bucket_stack16', item: 'bucket', n: 16, set: { '-1': 'lava' }, gets: ['lava_bucket', 'bucket'], test: ['-1:air', '-1:lava'] },
  { id: 'water_flowing_bucket', item: 'bucket', n: 1, set: { '-1': 'water[level=1]', '-2': 'barrier' }, gets: ['water_bucket'] },   // no block test: the server's un-sourced flowing cell dries up by fluid ticks the engine harness doesn't run
  { id: 'waterlogged_slab_bucket', item: 'bucket', n: 1, set: { '-1': 'oak_slab[type=bottom,waterlogged=true]' }, gets: ['water_bucket'],
    test: ['-1:oak_slab[waterlogged=false]', '-1:oak_slab[waterlogged=true]'] },
  { id: 'powder_snow_bucket', item: 'bucket', n: 1, set: { '-1': 'powder_snow' }, gets: ['powder_snow_bucket'], test: ['-1:air', '-1:powder_snow'] },
  { id: 'water_source_bucket_creative', mode: 'creative', item: 'bucket', n: 1, set: { '-1': 'water' }, gets: ['water_bucket', 'bucket'],
    test: ['-1:air', '-1:water'] },
  // ── pour out ──
  { id: 'water_bucket_on_stone', item: 'water_bucket', n: 1, gets: ['bucket'], test: ['0:water[level=0]', '-1:stone'] },
  { id: 'lava_bucket_on_stone', item: 'lava_bucket', n: 1, gets: ['bucket'], test: ['0:lava[level=0]', '-1:stone'] },
  { id: 'water_bucket_on_slab', item: 'water_bucket', n: 1, set: { '-1': 'oak_slab[type=bottom]' }, gets: ['bucket'],
    test: ['-1:oak_slab[waterlogged=true]', '0:water', '0:air'] },
  { id: 'lava_bucket_on_slab', item: 'lava_bucket', n: 1, set: { '-1': 'oak_slab[type=bottom]' }, gets: ['bucket'],
    test: ['-1:oak_slab[waterlogged=false]', '0:lava', '0:air'] },
  { id: 'water_bucket_on_stone_creative', mode: 'creative', item: 'water_bucket', n: 1, gets: ['bucket', 'water_bucket'], test: ['0:water[level=0]'] },
  { id: 'cod_bucket_on_stone', item: 'cod_bucket', n: 1, gets: ['bucket'], test: ['0:water[level=0]'], count: ['cod'] },
  { id: 'axolotl_bucket_on_stone', item: 'axolotl_bucket', n: 1, gets: ['bucket'], test: ['0:water[level=0]'], count: ['axolotl'] },
];
export const STONE_BLOCK = STONE;
/** 'oak_slab[type=bottom,waterlogged=true]' -> { name, props } */
export function parseState(s) {
  const m = /^([a-z_]+)(?:\[(.*)\])?$/.exec(s);
  const props = {};
  if (m && m[2]) for (const kv of m[2].split(',')) { const [k, v] = kv.split('='); props[k] = v; }
  return { name: m ? m[1] : s, props };
}
