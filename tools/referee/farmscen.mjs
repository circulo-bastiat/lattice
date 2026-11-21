// farmscen.mjs — the FARMLAND MOISTURE scenarios, shared by runfarm.mjs (the real 1.18.2 server) and farmrefcheck.mjs
// (the engine). Infra I6, 25 Sept 2026.
//
// Vanilla (1.18.2, .decomp/net/minecraft/block/FarmlandBlock.java:71-110), one random tick:
//   water within (-4,0,-4)..(4,1,4) (a FLUID-state test: a waterlogged block counts) or rain above -> MOISTURE 7
//   else MOISTURE > 0 -> MOISTURE - 1; else, unless the block above is a CropBlock / StemBlock / AttachedStemBlock -> dirt
// Clock (the same as leafscen.mjs): for k = 1..T: (k == 1: place, list order) -> (k % EVERY == 0: sample) -> one world tick.
// A sample per scenario is ten counts over its farmland cells: dirt, m0..m7 (farmland at that moisture), and `other`.
// Reads are `execute if block` (no probe edits a block).

export const SPEED = 128;         // randomTickSpeed: one cell is picked 128/4096 = 1/32 per tick
export const EVERY = 4;           // sample every 4th tick (a per-tick sample is ~4k commands a tick)
export const T = 1000;            // bare farmland needs 9 hits (mean 288 ticks, sd ~96): T is > 7 sd out
export const GY = -61;            // the flat world's grass layer: farmland REPLACES it, crops sit at GY+1

const grid = (x0, x1, z0, z1) => { const o = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) o.push([x, z]); return o; };
const row = (x, z0 = 0, z1 = 7) => { const o = []; for (let z = z0; z <= z1; z++) o.push([x, z]); return o; };

// cells: [dx,dz] farmland at GY; top: block at GY+1 over every cell; water: [dx,dz] at GY (a source, or `waterBlock`)
export const SCENARIOS = [
  { id: 'bare',        moisture: 7, cells: grid(4, 11, 4, 11), water: [] },
  { id: 'wheat',       moisture: 7, cells: grid(4, 11, 4, 11), water: [], top: 'minecraft:wheat[age=0]' },
  { id: 'stem',        moisture: 7, cells: grid(4, 11, 4, 11), water: [], top: 'minecraft:melon_stem[age=0]' },
  { id: 'hydrate',     moisture: 0, cells: [...grid(4, 7, 4, 11), ...grid(9, 12, 4, 11)], water: row(8, 4, 11) },
  { id: 'edge',        moisture: 7, cells: grid(1, 14, 4, 11).filter(([x]) => x !== 0), water: row(0, 4, 11) },
  { id: 'waterlogged', moisture: 0, cells: [...grid(4, 7, 4, 11), ...grid(9, 12, 4, 11)], water: row(8, 4, 11),
    waterBlock: 'minecraft:oak_slab[type=bottom,waterlogged=true]' },
];

/** What each cell must be after T ticks (vanilla's own rule, per scenario): 'd' dirt, or a moisture number. */
export function expectedFinal(sc) {
  return sc.cells.map(([x, z]) => {
    const wet = sc.water.some(([wx, wz]) => Math.abs(wx - x) <= 4 && Math.abs(wz - z) <= 4);
    if (wet) return 7;
    return sc.top ? 0 : 'd';
  });
}
/** The number of random-tick HITS a cell needs to reach its final state (for the variance of the decay statistic). */
export function hitsNeeded(sc, i) { const f = expectedFinal(sc)[i]; if (f === 7) return sc.moisture === 7 ? 0 : 1; return f === 'd' ? sc.moisture + 1 : sc.moisture; }

export const origin = (i) => ({ x: i * 16, z: 0 });
export const LABELS = ['dirt', 'm0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];

export function serverPlan() {
  const setup = ['gamerule doDaylightCycle false', 'gamerule doWeatherCycle false', 'gamerule doTileDrops false',
    'gamerule randomTickSpeed ' + SPEED, 'time set day', 'weather clear 1000000'];
  const xMax = SCENARIOS.length * 16 - 1;
  setup.push(`forceload add -16 -16 ${xMax + 16} 31`);
  // one 16-wide slab per fill: a single fill over the whole row is > 32768 blocks and the server REFUSES it ("Too many
  // blocks") -- a previous pack's blocks then survive into this one (they did: leaves left on the line turned farmland to dirt)
  for (let x = -16; x <= xMax + 16; x += 16) setup.push(`fill ${x} ${GY + 1} -16 ${x + 15} ${GY + 12} 31 minecraft:air`);
  setup.push(`fill -16 ${GY} -16 ${xMax + 16} ${GY} 31 minecraft:grass_block`);
  for (let j = 0; j < 80; j++) setup.push(`data remove storage mcliteref:farm p${j}`);   // storage persists in the world between runs
  const step = [], keys = [];
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    const at = (x, z, dy = 0) => `${o.x + x} ${GY + dy} ${o.z + z}`;
    for (const [x, z] of sc.water) step.push(`execute if score #t mclr matches 1 run setblock ${at(x, z)} ${sc.waterBlock || 'minecraft:water'}`);
    for (const [x, z] of sc.cells) {
      step.push(`execute if score #t mclr matches 1 run setblock ${at(x, z)} minecraft:farmland[moisture=${sc.moisture}]`);
      if (sc.top) step.push(`execute if score #t mclr matches 1 run setblock ${at(x, z, 1)} ${sc.top}`);
    }
    for (const lab of LABELS) {
      const k = `${sc.id}.${lab}`, j = keys.length; keys.push(k);
      const pred = lab === 'dirt' ? 'minecraft:dirt' : `minecraft:farmland[moisture=${lab.slice(1)}]`;
      const gate = `execute if score #s mclr matches 0`;
      step.push(`${gate} run scoreboard players set #c mclr 0`);
      for (const [x, z] of sc.cells) step.push(`${gate} if block ${at(x, z)} ${pred} run scoreboard players add #c mclr 1`);
      step.push(`${gate} run data modify storage mcliteref:farm p${j} append value 0`);
      step.push(`${gate} store result storage mcliteref:farm p${j}[-1] int 1 run scoreboard players get #c mclr`);
    }
  });
  // #s = #t % EVERY, computed before the scenarios sample
  step.unshift(`scoreboard players operation #s mclr = #t mclr`, `scoreboard players operation #s mclr %= #every mclr`);
  setup.push(`scoreboard players set #every mclr ${EVERY}`);
  return { setup, step, keys, T };
}
