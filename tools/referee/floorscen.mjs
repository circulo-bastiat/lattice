// floorscen.mjs — infra I6 (s150): the NATURAL-SPAWN FLOOR pack's boxes, shared by runfloor.mjs (the real 1.18.2
// server, natural spawning ON) and floorrefcheck.mjs (the engine). The question is a SET one, not a rate one (the
// engine's search order is named non-parity in 07l_spawn.js's header): on which floor blocks may a MONSTER spawn
// naturally? SpawnHelper.canSpawn -> SpawnRestriction -> HostileEntity.canSpawnInDark -> MobEntity.canMobSpawn:
// reason != SPAWNER, so `world.getBlockState(pos.down()).allowsSpawning(world, pos.down(), type)` — the per-block
// override (Blocks.java `.allowsSpawning(...)`: never / always / leaves-only-for-ocelot+parrot / fire-immune /
// polar-bear) else a solid full top face.
// One sealed dark box per chunk, on the flat world's ground: floor at y=-61 (the grass layer, replaced), interior
// 14x14 (chunk-local x/z 1..14 — a 5x5 box drew only 0-8 spawns in 6000 ticks: a spawn pack's random walk mostly
// left it), 3 high (-60..-58), stone shell, roof at -57 (so the heightmap top is -57 and a random
// spawn Y lands inside a box about a third of the time). Boxes in the chunks at chebyshev distance 2..4 around the
// player's chunk (0,0) — inside simulation distance 4, outside the 24-block no-spawn ring.
export const FLOOR_Y = -61;
export const T = 2000;   // ~250 spawns a box on a legal floor
export const PLAYER = { x: 8.5, y: -60, z: 8.5 };
export const FLOORS = [
  'stone', 'glass', 'tinted_glass', 'oak_leaves[persistent=true]', 'jungle_leaves[persistent=true]', 'azalea_leaves[persistent=true]',
  'ice', 'packed_ice', 'blue_ice', 'magma_block', 'soul_sand', 'soul_soil', 'farmland', 'dirt_path', 'snow[layers=1]',
  'snow[layers=8]', 'snow_block', 'white_carpet', 'stone_slab[type=bottom]', 'stone_slab[type=top]',
  'stone_stairs[half=bottom]', 'stone_stairs[half=top]', 'bedrock', 'barrier', 'hopper', 'obsidian', 'slime_block',
  'honey_block', 'mycelium', 'sand', 'white_stained_glass', 'redstone_block', 'chest', 'spawner', 'glass_pane',
  'oak_fence',
];
export const CHUNKS = [];
for (let r = 2; r <= 4; r++) for (let cx = -r; cx <= r; cx++) for (let cz = -r; cz <= r; cz++) if (Math.max(Math.abs(cx), Math.abs(cz)) === r) CHUNKS.push([cx, cz]);
// box k: floor FLOORS[k % FLOORS.length] (72 chunks -> every floor twice)
export const W = 14;   // interior width
export const BOXES = CHUNKS.map(([cx, cz], k) => ({ k, floor: FLOORS[k % FLOORS.length], x0: cx * 16 + 1, z0: cz * 16 + 1 }));
