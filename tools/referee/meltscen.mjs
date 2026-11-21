// meltscen.mjs — the ICE / SNOW-LAYER MELT scenarios, shared by runmelt.mjs (the real 1.18.2 server) and meltrefcheck.mjs
// (the engine). Infra I6, 25 Sept 2026.
//
// Vanilla (1.18.2):
//   IceBlock.randomTick  (.decomp/net/minecraft/block/IceBlock.java:38-41)
//       getLightLevel(BLOCK, pos) > 11 - state.getOpacity(world, pos)  -> melt
//   IceBlock.melt        (:44-50) ultrawarm -> removeBlock; else setBlockState(pos, WATER) (NO look at the block below:
//                                   that test is afterBreak's, :22-34, a player breaking it)
//   SnowBlock.randomTick (.decomp/net/minecraft/block/SnowBlock.java:98-102)
//       getLightLevel(BLOCK, pos) > 11 -> dropStacks + removeBlock
// LightType.field_9282 is BLOCK (names.tsv: LightType b); SKY is field_9284 — so a noon sun never melts either.
//
// Clock (as farmscen/leafscen): for k = 1..T: (k % EVERY == 0: sample) -> one world tick. Every cell is placed by RCON
// BEFORE the clock starts (randomTickSpeed 0), then the BLOCK light at each probe is MEASURED (a location_check light
// predicate at midnight; in a closed stone box the sky adds nothing, so the reading is the block light exactly), then
// time is set to noon and the random ticks start. The engine is handed the MEASURED block light — the check never types a
// light level.

export const SPEED = 128;         // randomTickSpeed: one cell is picked 128/4096 per tick (p ~ 0.031)
export const EVERY = 5;           // sample every 5th tick
export const T = 800;             // P(an eligible cell is never hit in T) = (1-p)^800 ~ 1e-11
export const GY = -61;            // the flat world's grass layer (server.mjs); cells sit at GY+dy
export const NIGHT = 18000, NOON = 6000;

const line = (x0, x1, dy, z) => { const o = []; for (let x = x0; x <= x1; x++) o.push([x, dy, z]); return o; };

// kind: 'ice' | 'snow' (snow = minecraft:snow[layers=1]); box: closed stone box over the whole 16x16 (walls, roof at dy 5)
// src: light sources [block, [x,dy,z]]
export const SCENARIOS = [
  { id: 'ice-glow',   kind: 'ice',  box: true,  src: [['minecraft:glowstone', [2, 1, 8]]], cells: line(3, 13, 1, 8) },
  // a FULL-BLOCK source below glowstone's 15: melt water washes a torch away mid-run, and an end rod too (both runs lost
  // their light when a cell melted) — a respawn anchor with 3 charges is a full block of light 11 (floor(3/4*15))
  { id: 'ice-anchor', kind: 'ice',  box: true,  src: [['minecraft:respawn_anchor[charges=3]', [2, 1, 8]]], cells: line(3, 13, 1, 8) },
  { id: 'snow-glow',  kind: 'snow', box: true,  src: [['minecraft:glowstone', [2, 1, 8]]], cells: line(3, 13, 1, 8) },
  { id: 'snow-anchor', kind: 'snow', box: true, src: [['minecraft:respawn_anchor[charges=3]', [2, 1, 8]]], cells: line(3, 13, 1, 8) },
  { id: 'ice-sun',    kind: 'ice',  box: false, src: [], cells: line(3, 13, 1, 8) },
  { id: 'snow-sun',   kind: 'snow', box: false, src: [], cells: line(3, 13, 1, 8) },
  // ice hanging over air two blocks up, lit from the side: vanilla's random-tick melt makes WATER regardless of below
  // + a floor-level control cell in the same box, lit the same (glowstone beside it)
  { id: 'ice-float',  kind: 'ice',  box: true,  src: [['minecraft:glowstone', [6, 3, 8]], ['minecraft:glowstone', [10, 1, 3]]],
    cells: [[7, 3, 8], [5, 3, 8], [11, 1, 3]] },
];

// 24 apart (no light crosses), in a 4-wide GRID near the spawn: a fake player's /tp does not move its chunk ticket, so random
// ticks only run within the simulation distance of the world spawn — the old 7-long row reached x=159, the edge, and one run
// left its last scene un-ticked (spreadscen.mjs, 25 Sept 2026).
export const origin = (i) => ({ x: (i % 4) * 24, z: Math.floor(i / 4) * 24 });
export const cellBlock = (sc) => sc.kind === 'ice' ? 'minecraft:ice' : 'minecraft:snow[layers=1]';
/** The probe positions whose block light is measured: every cell, the block above it, the block below it. */
export const probes = (sc) => sc.cells.flatMap(([x, dy, z]) => [[x, dy, z], [x, dy + 1, z], [x, dy - 1, z]]);

export function serverPlan() {
  const setup = ['gamerule doDaylightCycle false', 'gamerule doWeatherCycle false', 'gamerule doTileDrops false',
    'gamerule randomTickSpeed 0', 'gamerule doFireTick false', 'weather clear 1000000', `time set ${NIGHT}`];
  const xMax = Math.min(3, SCENARIOS.length - 1) * 24 + 15, zMax = origin(SCENARIOS.length - 1).z + 15;
  setup.push(`forceload add -16 -16 ${xMax + 16} ${zMax + 16}`);
  // per 16-wide slab: one fill over the whole row is > 32768 blocks and is REFUSED ("Too many blocks")
  for (let x = -16; x <= xMax + 16; x += 16) setup.push(`fill ${x} ${GY + 1} -16 ${x + 15} ${GY + 12} ${zMax + 16} minecraft:air`);
  for (let x = -16; x <= xMax + 16; x += 16) setup.push(`fill ${x} ${GY} -16 ${x + 15} ${GY} ${zMax + 16} minecraft:grass_block`);
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    const at = (x, dy, z) => `${o.x + x} ${GY + dy} ${o.z + z}`;
    if (sc.box) {
      setup.push(`fill ${at(0, 0, 0)} ${at(15, 5, 15)} minecraft:stone hollow`);   // floor (replaces the grass), walls, roof; air inside
    }
    for (const [b, [x, dy, z]] of sc.src) setup.push(`setblock ${at(x, dy, z)} ${b}`);
    for (const [x, dy, z] of sc.cells) setup.push(`setblock ${at(x, dy, z)} ${cellBlock(sc)}`);
  });
  const step = [], keys = [];
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    const at = (x, dy, z) => `${o.x + x} ${GY + dy} ${o.z + z}`;
    const gate = 'execute if score #s mclr matches 0';
    const j = keys.length; keys.push(sc.id);
    step.push(`${gate} run scoreboard players set #c mclr 0`);
    for (const [x, dy, z] of sc.cells) step.push(`${gate} if block ${at(x, dy, z)} ${sc.kind === 'ice' ? 'minecraft:ice' : 'minecraft:snow'} run scoreboard players add #c mclr 1`);
    step.push(`${gate} run data modify storage mcliteref:melt p${j} append value 0`);
    step.push(`${gate} store result storage mcliteref:melt p${j}[-1] int 1 run scoreboard players get #c mclr`);
  });
  step.unshift('scoreboard players operation #s mclr = #t mclr', 'scoreboard players operation #s mclr %= #every mclr');
  setup.push(`scoreboard players set #every mclr ${EVERY}`);
  for (let j = 0; j < 40; j++) setup.push(`data remove storage mcliteref:melt p${j}`);   // storage persists with the world
  return { setup, step, keys, T };
}
