#!/usr/bin/env node
// gen-legacy-tiles.mjs — real 1.13.2 pixels for the 57 tiles the current engine draws.
//
//   node tools/gen-legacy-tiles.mjs [--assets assets]
//
// The full 900-block roster is decoded and proven (tools/regcheck.mjs) but the engine's
// mesher still draws the hand-written 49-block table through a 57-layer PROCEDURAL atlas,
// and swapping the mesher changes the vertex format — a bigger job that should not be done
// half-way (PLAN F8b).
//
// This is the step in between, and it is worth doing on its own: keep the 57 layers and
// their indices exactly as they are, and fill them with the REAL textures instead of
// generated noise. Dan, on the current build: "that screenshot is rough on block textures,
// next step is getting real mc texutres. preferably the old ones."
//
// Nothing downstream changes. Same layer count, same indices, same texture-array upload.
// Only the pixels are different, and they are Mojang's.
//
// ⚠ REWRITTEN, an hour after the first version. It used to carry PIXELS — a second copy of
// 57 tiles, with the plains grass and foliage colours baked in. Two things were wrong with
// that, and the second one was a bug:
//
//   1. The engine already has a 764-tile atlas in the payload for the full roster. A second
//      57-tile image is the same pixels twice, and it means the legacy path and the model
//      path sample different textures — so a fence and the stone beside it could not share
//      a draw call, ever.
//   2. The legacy blocks ALREADY carry a `tint` field (grass_block tint:1, leaves tint:2)
//      and the shader already multiplies by it. Baking the plains colour in as well tinted
//      them TWICE. It was not visible in the snow biome the smoke test happens to spawn in,
//      which is exactly how that kind of bug survives.
//
// So this now emits a MAP — 57 indices into the real atlas — and no pixels at all. The
// greyscale textures stay greyscale and the existing tint machinery does its job, which is
// also what W5's per-biome colour dispatch will need.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator



const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const ASSETS = opt('assets', MCLITE_ROOT + 'assets');
const TILE = 16;

// The order IS the tile index. It must match `B.T` in src/02_blocks.js exactly, and
// tools/tilecheck.mjs asserts that it does rather than trusting this comment.

const TILES = [
  ['MISSING', null],
  ['STONE', 'block/stone'],
  ['DIRT', 'block/dirt'],
  ['GRASS_TOP', 'block/grass_block_top'],
  ['GRASS_SIDE', 'block/grass_block_side'],
  ['SAND', 'block/sand'],
  ['GRAVEL', 'block/gravel'],
  ['COBBLESTONE', 'block/cobblestone'],
  ['BEDROCK', 'block/bedrock'],
  ['DEEPSLATE', 'block/deepslate'],
  ['OAK_LOG_SIDE', 'block/oak_log'],
  ['OAK_LOG_TOP', 'block/oak_log_top'],
  ['OAK_PLANKS', 'block/oak_planks'],
  ['OAK_LEAVES', 'block/oak_leaves'],
  ['WATER', 'block/water_still'],
  ['SNOW', 'block/snow'],
  // ⚠ There is NO sculk block in 1.18.2 — it arrived in 1.19, and the deep dark of 1.18 is
  // plain deepslate. The engine has a SCULK tile for the deep dark anyway, so it gets the
  // closest thing that actually exists in the target version: the sculk sensor's underside,
  // which is the same dark blue-green organic texture. Recorded rather than substituted
  // silently, because "1.18.2 has no sculk" is a fact somebody will need later.
  ['SCULK', 'block/sculk_sensor_bottom'],
  ['GLOWSTONE', 'block/glowstone'],
  ['SHORT_GRASS', 'block/grass'],
  ['COAL_ORE', 'block/coal_ore'],
  ['IRON_ORE', 'block/iron_ore'],
  ['COPPER_ORE', 'block/copper_ore'],
  ['GOLD_ORE', 'block/gold_ore'],
  ['REDSTONE_ORE', 'block/redstone_ore'],
  ['LAPIS_ORE', 'block/lapis_ore'],
  ['DIAMOND_ORE', 'block/diamond_ore'],
  ['EMERALD_ORE', 'block/emerald_ore'],
  ['DEEPSLATE_COAL_ORE', 'block/deepslate_coal_ore'],
  ['DEEPSLATE_IRON_ORE', 'block/deepslate_iron_ore'],
  ['DEEPSLATE_GOLD_ORE', 'block/deepslate_gold_ore'],
  ['DEEPSLATE_DIAMOND_ORE', 'block/deepslate_diamond_ore'],
  ['DEEPSLATE_REDSTONE_ORE', 'block/deepslate_redstone_ore'],
  ['DEEPSLATE_COPPER_ORE', 'block/deepslate_copper_ore'],
  ['DEEPSLATE_LAPIS_ORE', 'block/deepslate_lapis_ore'],
  ['DEEPSLATE_EMERALD_ORE', 'block/deepslate_emerald_ore'],
  ['PODZOL_TOP', 'block/podzol_top'],
  ['PODZOL_SIDE', 'block/podzol_side'],
  ['SANDSTONE_TOP', 'block/sandstone_top'],
  ['SANDSTONE_SIDE', 'block/sandstone'],
  ['SANDSTONE_BOTTOM', 'block/sandstone_bottom'],
  ['BIRCH_LOG_SIDE', 'block/birch_log'],
  ['BIRCH_LOG_TOP', 'block/birch_log_top'],
  ['BIRCH_PLANKS', 'block/birch_planks'],
  ['BIRCH_LEAVES', 'block/birch_leaves'],
  ['SPRUCE_LOG_SIDE', 'block/spruce_log'],
  ['SPRUCE_LOG_TOP', 'block/spruce_log_top'],
  ['SPRUCE_PLANKS', 'block/spruce_planks'],
  ['SPRUCE_LEAVES', 'block/spruce_leaves'],
  ['LAVA', 'block/lava_still'],
  ['ICE', 'block/ice'],
  ['CACTUS_TOP', 'block/cactus_top'],
  ['CACTUS_SIDE', 'block/cactus_side'],
  ['GLASS', 'block/glass'],
  ['TORCH', 'block/torch'],
  ['POPPY', 'block/poppy'],
  ['DANDELION', 'block/dandelion'],
  ['DEAD_BUSH', 'block/dead_bush'],
];

const atlasIndex = JSON.parse(readFileSync(join(ASSETS, 'atlas-index.json'), 'utf8')).index;
const map = new Int32Array(TILES.length).fill(-1);
const report = { count: TILES.length, mapped: [], unmapped: [] };

// tile 0 is the missing-texture marker. The real atlas has no such tile, so it maps to -1
// and 06_atlas.js draws the magenta checkerboard for it — "no texture" must always look
// like a bug rather than like a block.
for (let t = 1; t < TILES.length; t++) {
  const [name, tex] = TILES[t];
  const idx = atlasIndex[tex];
  if (idx === undefined) { report.unmapped.push(`${name} -> ${tex}`); continue; }
  map[t] = idx;
  report.mapped.push(name);
}

writeFileSync(join(ASSETS, 'legacy-tiles.meta.json'), JSON.stringify({
  count: TILES.length, tile: TILE,
  names: TILES.map((t) => t[0]),
  textures: TILES.map((t) => t[1]),
  map: Array.from(map),
  ...report,
}, null, 2));

console.log('');
console.log('================ gen-legacy-tiles ================');
console.log(` legacy tiles ...... ${TILES.length}`);
console.log(` mapped into the real atlas: ${report.mapped.length}`);
console.log(` unmapped .......... ${report.unmapped.length}  ${report.unmapped.join(' ')}`);
console.log('');
console.log(' No pixels are emitted: the engine now samples the SAME 764-tile atlas as the');
console.log(' model stream, and the greyscale grass and leaf textures stay greyscale so the');
console.log(" existing per-block tint (and later W5's per-biome dispatch) can colour them.");
console.log('==================================================');
process.exit(report.unmapped.length ? 1 : 0);
