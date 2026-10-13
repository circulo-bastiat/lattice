// spreadscen.mjs — the GRASS SPREAD / GRASS COVER / STEM scenarios, shared by runspread.mjs (the real 1.18.2 server) and
// spreadrefcheck.mjs (the engine). Infra I6, 25 Sept 2026. Built on gatescen.mjs (the light gate pack's measured light).
//
// Vanilla (1.18.2):
//   SpreadableBlock.randomTick (.decomp/net/minecraft/block/SpreadableBlock.java:30-45)
//     !canSurvive -> dirt. canSurvive(:10-20): the block above is snow[layers=1] -> yes; a full fluid -> no; else
//     ChunkLightProvider.getRealisticOpacity(...) < 15 (shape-aware: a bottom slab's full DOWN face occludes).
//     else if world.getLightLevel(pos.up()) >= 9 (sky DIMMED by the time of day, + block): 4 tries at
//     (nextInt(3)-1, nextInt(5)-3, nextInt(3)-1); a DIRT there that canSpread (canSurvive + no water above) becomes grass.
//     No light test on the target.
//   StemBlock.randomTick (.decomp/net/minecraft/block/StemBlock.java:54-70)
//     getBaseLightLevel(pos, 0) >= 9 (max(sky, block) at the stem, undimmed — a stem grows at midnight in the open), then
//     nextInt(25/moisture + 1) == 0: age+1 below 7; at 7 a random horizontal neighbour that is AIR over dirt/farmland gets
//     the gourd and the stem turns into the ATTACHED stem.
//   StemBlock extends PlantBlock: canPlaceAt is the soil only — a stem does NOT die in the dark (a wheat crop does).
// The engine (src/07b_behaviour.js): tickGrassSpread + canBeGrass (getRealisticOpacity via NS.DATA.sidedLight, cloud
// nifty-gauss) and tickStem (its own rule, fruits at 7) — history: stems once ran tickCrop and never fruited.
//
// Two phases on one server: A at MIDNIGHT (stems, and a grass night control), B at NOON (grass spread, grass covers).
// A phase's scenes are built at its start, so the other phase's ticks never touch them.
export const SPEED = 128;         // randomTickSpeed: a block is hit 128/4096 per tick
export const T = 2400;            // ~75 hits per block per phase
export const GY = -61;            // the flat world's grass layer (server.mjs); cells sit at GY+dy
export const TIME = { A: 18000, B: 6000 };

const row = (x0, x1, step, dy, z) => { const o = []; for (let x = x0; x <= x1; x += step) o.push([x, dy, z]); return o; };

// kind:
//   stem  — farmland[moisture=7] at dy 0, pumpkin_stem[age=0] at dy 1, a water source at (x,0,z+2) keeps it hydrated
//   fruit — as stem but age=7, dirt on its four sides at dy 0 (the gourd's soil); water at (x,0,z+3)
//   grass — the CELL is a dirt block at dy 0; its grass_block source at (x+1,0,z)
//   cover — the CELL is a grass_block at dy 0 with `cover` placed on top of it (dy 1)
// box: a closed stone box (floor, walls, roof at dy 5); open scenes get a 16x16 stone floor and nothing else.
export const SCENARIOS = [
  { id: 'stem-glow',   phase: 'A', kind: 'stem',  box: true,  src: [['minecraft:glowstone', [2, 1, 8]]], cells: row(3, 13, 2, 1, 8) },
  { id: 'stem-dark',   phase: 'A', kind: 'stem',  box: true,  src: [], cells: row(3, 13, 2, 1, 8) },
  { id: 'stem-night',  phase: 'A', kind: 'stem',  box: false, src: [], cells: row(3, 13, 2, 1, 8) },
  { id: 'stem-fruit',  phase: 'A', kind: 'fruit', box: true,  src: [['minecraft:glowstone', [1, 1, 8]], ['minecraft:glowstone', [14, 1, 8]]], cells: row(3, 11, 4, 1, 8) },
  { id: 'grass-night', phase: 'A', kind: 'grass', box: false, src: [], cells: row(3, 11, 4, 0, 8) },
  { id: 'grass-glow',  phase: 'B', kind: 'grass', box: true,  src: [['minecraft:glowstone', [2, 1, 8]]], cells: row(3, 11, 4, 0, 8) },
  { id: 'grass-dark',  phase: 'B', kind: 'grass', box: true,  src: [], cells: row(3, 11, 4, 0, 8) },
  { id: 'grass-noon',  phase: 'B', kind: 'grass', box: false, src: [], cells: row(3, 11, 4, 0, 8) },
  { id: 'cover-stone', phase: 'B', kind: 'cover', box: false, src: [], cover: 'minecraft:stone', cells: row(3, 13, 2, 0, 8) },
  { id: 'cover-glass', phase: 'B', kind: 'cover', box: false, src: [], cover: 'minecraft:glass', cells: row(3, 13, 2, 0, 8) },
  { id: 'cover-slabb', phase: 'B', kind: 'cover', box: false, src: [], cover: 'minecraft:stone_slab[type=bottom]', cells: row(3, 13, 2, 0, 8) },
  { id: 'cover-slabt', phase: 'B', kind: 'cover', box: false, src: [], cover: 'minecraft:stone_slab[type=top]', cells: row(3, 13, 2, 0, 8) },
  { id: 'cover-snow1', phase: 'B', kind: 'cover', box: false, src: [], cover: 'minecraft:snow[layers=1]', cells: row(3, 13, 2, 0, 8) },
  { id: 'cover-snow2', phase: 'B', kind: 'cover', box: false, src: [], cover: 'minecraft:snow[layers=2]', cells: row(3, 13, 2, 0, 8) },
  // melon stems: the same StemBlock class as pumpkin (gourdBlock = melon) — infra s142
  { id: 'melon-night', phase: 'A', kind: 'stem',  gourd: 'melon', box: false, src: [], cells: row(3, 13, 2, 1, 8) },
  { id: 'melon-fruit', phase: 'A', kind: 'fruit', gourd: 'melon', box: true,  src: [['minecraft:glowstone', [1, 1, 8]], ['minecraft:glowstone', [14, 1, 8]]], cells: row(3, 11, 4, 1, 8) },
];
const G = (sc) => sc.gourd || 'pumpkin';

// A 4-wide GRID, 24 apart (no light crosses): every scene stays within ~110 blocks of the world spawn. A fake player's /tp
// does NOT move its chunk ticket (it never confirms the teleport), so only chunks within the simulation distance (10 chunks)
// of the SPAWN get random ticks — a first run laid out in one 336-block row left every scene past x~160 un-ticked.
export const origin = (i) => ({ x: (i % 4) * 24, z: Math.floor(i / 4) * 24 });
export const EXTENT = Math.max(3, Math.floor((SCENARIOS.length - 1) / 4)) * 24 + 19;   // the grid's far edge, both axes

/** Every block a scene places, relative [block, [x, dy, z]], in placement order (soil before plants). */
export function placements(sc) {
  const o = [];
  for (const s of sc.src) o.push(s);
  for (const [x, dy, z] of sc.cells) {
    if (sc.kind === 'stem') o.push(['minecraft:farmland[moisture=7]', [x, 0, z]], ['minecraft:water', [x, 0, z + 2]], [`minecraft:${G(sc)}_stem[age=0]`, [x, 1, z]]);
    else if (sc.kind === 'fruit') {
      for (const [ax, az] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) o.push(['minecraft:dirt', [x + ax, 0, z + az]]);
      o.push(['minecraft:farmland[moisture=7]', [x, 0, z]], ['minecraft:water', [x, 0, z + 3]], [`minecraft:${G(sc)}_stem[age=7]`, [x, 1, z]]);
    } else if (sc.kind === 'grass') o.push(['minecraft:dirt', [x, 0, z]], ['minecraft:grass_block', [x + 1, 0, z]]);
    else if (sc.kind === 'cover') o.push(['minecraft:grass_block', [x, 0, z]], [sc.cover, [x, 1, z]]);
  }
  return o;
}

/** The probes whose block light is measured (closed boxes only — the open scenes carry no block light): the 3x4x3 around
 *  every cell, which covers every position the engine's rules ask about (a cell, its source, the cells above them). */
export function probes(sc) {
  if (!sc.box) return [];
  const seen = new Set(), o = [];
  for (const [x, , z] of sc.cells) for (let dx = -1; dx <= 2; dx++) for (let dy = -1; dy <= 2; dy++) for (let dz = -1; dz <= 1; dz++) {
    const k = `${x + dx},${dy},${z + dz}`; if (!seen.has(k)) { seen.add(k); o.push([x + dx, dy, z + dz]); }
  }
  return o;
}

/** A block name + props -> the scene's bucket. Shared by the server's final read and the engine. */
export function bucket(sc, name, props) {
  if (name === 'air') return 'GONE';
  if (sc.kind === 'stem') return name === G(sc) + '_stem' ? (+props.age > 0 ? 'GROW' : 'STAY') : 'OTHER(' + name + ')';
  if (sc.kind === 'fruit') return name === 'attached_' + G(sc) + '_stem' ? 'FRUIT' : name === G(sc) + '_stem' ? 'STAY' : 'OTHER(' + name + ')';
  if (sc.kind === 'grass') return name === 'dirt' ? 'STAY' : name === 'grass_block' ? 'GROW' : 'OTHER(' + name + ')';
  if (sc.kind === 'cover') return name === 'grass_block' ? 'STAY' : name === 'dirt' ? 'GONE' : 'OTHER(' + name + ')';
  return 'OTHER(' + name + ')';
}
/** The server's final-state probes, first hit wins: [label(name,props), block predicate]. */
export function finalProbes(sc) {
  if (sc.kind === 'stem' || sc.kind === 'fruit') return [...[0, 1, 2, 3, 4, 5, 6, 7].map((a) => [[G(sc) + '_stem', { age: a }], `minecraft:${G(sc)}_stem[age=${a}]`]),
    [['attached_' + G(sc) + '_stem', {}], `minecraft:attached_${G(sc)}_stem`], [['air', {}], 'minecraft:air']];
  return [[['dirt', {}], 'minecraft:dirt'], [['grass_block', {}], 'minecraft:grass_block'], [['air', {}], 'minecraft:air']];
}

export function buildCommands(i) {
  const sc = SCENARIOS[i], o = origin(i), c = [];
  const at = (x, dy, z) => `${o.x + x} ${GY + dy} ${o.z + z}`;
  c.push(`fill ${at(-4, 1, -4)} ${at(19, 12, 19)} minecraft:air`);
  c.push(`fill ${at(-4, 0, -4)} ${at(19, 0, 19)} minecraft:grass_block`);
  if (sc.box) c.push(`fill ${at(0, 0, 0)} ${at(15, 5, 15)} minecraft:stone hollow`);
  else c.push(`fill ${at(0, 0, 0)} ${at(15, 0, 15)} minecraft:stone`);
  for (const [b, [x, dy, z]] of placements(sc)) c.push(`setblock ${at(x, dy, z)} ${b}`);
  return c;
}
