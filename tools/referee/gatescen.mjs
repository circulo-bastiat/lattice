// gatescen.mjs — the LIGHT-GATED GROWTH scenarios (wheat, oak sapling), shared by rungate.mjs (the real 1.18.2 server)
// and gaterefcheck.mjs (the engine). Infra I6, 25 Sept 2026. Built on meltscen.mjs's light measurement.
//
// Vanilla (1.18.2) — the two rules read DIFFERENT light:
//   CropBlock.randomTick    (.decomp/net/minecraft/block/CropBlock.java:77)   getBaseLightLevel(pos, 0) >= 9
//        = max(sky, block) at the CROP's own position with NO time-of-day darkening: a crop grows at midnight in the open
//   SaplingBlock.randomTick (.decomp/net/minecraft/block/SaplingBlock.java:33) getLightLevel(pos.up()) >= 9 && nextInt(7)==0
//        = max(sky - ambientDarkness, block) ABOVE the sapling: at midnight in the open that is the night sky, too dark
// The engine (src/07b_behaviour.js) asks one `w.light(x, y+1, z) < 9` for both (crops :1088, saplings :1235).
//
// Clock: every cell placed before the clock (randomTickSpeed 0, midnight — and it STAYS midnight: the night scenes are the
// point), the block light at every probe measured (meltscen's predicate method), then randomTickSpeed SPEED for T ticks.
// Compared per cell: did it ADVANCE (wheat age > 0, sapling stage 1 or a tree) — exact.
export const SPEED = 128;         // randomTickSpeed: one cell is picked 128/4096 per tick (p ~ 0.031)
export const EVERY = 20;          // sample every 20th tick
export const T = 2400;            // ~75 hits a cell: a lit sapling (1/7 a hit) stays put with P ~ 1e-5, a lit wheat (>= 1/12) ~ 1e-3
export const GY = -61;            // the flat world's grass layer (server.mjs); cells sit at GY+dy
export const NIGHT = 18000, NOON = 6000;

const line = (x0, x1, dy, z) => { const o = []; for (let x = x0; x <= x1; x++) o.push([x, dy, z]); return o; };

// kind: 'wheat' (farmland[moisture=7] at dy 0, wheat[age=0] at dy 1) | 'sapling' (dirt at dy 0, oak_sapling[stage=0]);
// box: closed stone box (floor, walls, roof at dy 5); night: the open scenes run at midnight (the whole run is midnight)
export const SCENARIOS = [
  // every OTHER cell: a crop below light 8 without sky fails CropBlock.canPlaceAt (:148), and a neighbour's placement would
  // pop it (PlantBlock.getStateForNeighborUpdate) — spaced cells are never a neighbour's neighbour
  { id: 'wheat-glow',   kind: 'wheat',   box: true,  src: [['minecraft:glowstone', [2, 1, 8]]], cells: line(3, 13, 1, 8).filter((c, j) => j % 2 === 0) },
  { id: 'wheat-dark',   kind: 'wheat',   box: true,  src: [], cells: line(3, 13, 1, 8).filter((c, j) => j % 2 === 0) },
  { id: 'wheat-night',  kind: 'wheat',   box: false, src: [], cells: line(3, 13, 1, 8).filter((c, j) => j % 2 === 0) },
  { id: 'sapling-glow', kind: 'sapling', box: true,  src: [['minecraft:glowstone', [2, 1, 8]]], cells: line(3, 13, 1, 8).filter((c, j) => j % 2 === 0) },
  { id: 'sapling-dark', kind: 'sapling', box: true,  src: [], cells: line(3, 13, 1, 8).filter((c, j) => j % 2 === 0) },
  { id: 'sapling-night', kind: 'sapling', box: false, src: [], cells: line(3, 13, 1, 8).filter((c, j) => j % 2 === 0) },
];

export const origin = (i) => ({ x: i * 24, z: 0 });   // 24 apart: no light (max 15) crosses between scenarios
export const cellBlock = (sc) => sc.kind === 'wheat' ? 'minecraft:wheat[age=0]' : 'minecraft:oak_sapling[stage=0]';
export const groundBlock = (sc) => sc.kind === 'wheat' ? 'minecraft:farmland[moisture=7]' : 'minecraft:dirt';
/** The probe positions whose block light is measured: every cell, the block above it, the block below it. */
export const probes = (sc) => sc.cells.flatMap(([x, dy, z]) => [[x, dy, z], [x, dy + 1, z], [x, dy - 1, z]]);

export function serverPlan() {
  const setup = ['gamerule doDaylightCycle false', 'gamerule doWeatherCycle false', 'gamerule doTileDrops false',
    'gamerule randomTickSpeed 0', 'gamerule doFireTick false', 'gamerule doMobSpawning false', 'weather clear 1000000', `time set ${NIGHT}`];
  const xMax = origin(SCENARIOS.length - 1).x + 15;
  setup.push(`forceload add -16 -16 ${xMax + 16} 31`);
  // per 16-wide slab: one fill over the whole row is > 32768 blocks and is REFUSED ("Too many blocks")
  for (let x = -16; x <= xMax + 16; x += 16) setup.push(`fill ${x} ${GY + 1} -16 ${x + 15} ${GY + 12} 31 minecraft:air`);
  for (let x = -16; x <= xMax + 16; x += 16) setup.push(`fill ${x} ${GY} -16 ${x + 15} ${GY} 31 minecraft:grass_block`);
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    const at = (x, dy, z) => `${o.x + x} ${GY + dy} ${o.z + z}`;
    if (sc.box) {
      setup.push(`fill ${at(0, 0, 0)} ${at(15, 5, 15)} minecraft:stone hollow`);   // floor (replaces the grass), walls, roof; air inside
    }
    for (const [b, [x, dy, z]] of sc.src) setup.push(`setblock ${at(x, dy, z)} ${b}`);
    for (const [x, dy, z] of sc.cells) { setup.push(`setblock ${at(x, dy - 1, z)} ${groundBlock(sc)}`); setup.push(`setblock ${at(x, dy, z)} ${cellBlock(sc)}`); }
  });
  const step = [], keys = [];
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    const at = (x, dy, z) => `${o.x + x} ${GY + dy} ${o.z + z}`;
    const gate = 'execute if score #s mclr matches 0';
    const j = keys.length; keys.push(sc.id);
    step.push(`${gate} run scoreboard players set #c mclr 0`);
    for (const [x, dy, z] of sc.cells) step.push(`${gate} if block ${at(x, dy, z)} ${sc.kind === 'wheat' ? 'minecraft:wheat[age=0]' : 'minecraft:oak_sapling[stage=0]'} run scoreboard players add #c mclr 1`);
    step.push(`${gate} run data modify storage mcliteref:gate p${j} append value 0`);
    step.push(`${gate} store result storage mcliteref:gate p${j}[-1] int 1 run scoreboard players get #c mclr`);
  });
  step.unshift('scoreboard players operation #s mclr = #t mclr', 'scoreboard players operation #s mclr %= #every mclr');
  setup.push(`scoreboard players set #every mclr ${EVERY}`);
  for (let j = 0; j < 40; j++) setup.push(`data remove storage mcliteref:gate p${j}`);   // storage persists with the world
  return { setup, step, keys, T };
}
