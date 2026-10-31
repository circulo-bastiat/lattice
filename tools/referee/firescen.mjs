// firescen.mjs — the FIRE scenarios (burn-out, infiniburn, burning fuel away, priming TNT), shared by runfire2.mjs (the
// real 1.18.2 server) and firerefcheck.mjs (the engine). Infra I6, 25 Sept 2026.
//
// Vanilla (1.18.2), .decomp/net/minecraft/block/FireBlock.java:
//   scheduledTick :144-216 — reschedules 30 + nextInt(10) (:290); doFireTick; !canPlaceAt -> removed.
//     infiniburn = the block BELOW is in the dimension's #infiniburn_overworld (netherrack, magma_block): such a fire
//     skips the rain test, the no-fuel burn-out AND the age-15 burn-out (:152, :163) — it burns forever.
//     age += nextInt(3)/2; no flammable neighbour -> removed when the floor is not a full up face OR age > 3 (:164-170).
//     trySpreadingFire on all six neighbours (:181-186), odds 300 (sides) / 250 (up, down): nextInt(odds) < the
//     neighbour's spreadChance (registerFlammableBlock's 2nd int: planks 20, log 5, wool 60, tnt 100) -> the neighbour
//     is REPLACED (by fire, nextInt(age+10) < 5, else air); a TNT neighbour is primed (:231-247).
//     then a 3x6x3 box (-1..1, -1..4, -1..1): each AIR cell next to fuel catches with nextInt(100 + 100*(dy-1)) <=
//     (burnChance + 40 + difficulty*7) / (age + 30) (:188-212).
// The engine (src/07b_behaviour.js:734 tickFire): the canSurvive / age / no-fuel burn-out rules only — no infiniburn,
// no trySpreadingFire (fuel never burns away, TNT is never lit), no spread into the air box. Its own header names this
// (D-210: "WHICH blocks burn, and how fast ... not ported").
//
// Every scene sits on a stone floor near the world origin (scheduled ticks need only a forceloaded chunk — no player).
// The fire is /setblock'ed at `fire`; `fuel` are the blocks it may burn; each scene is repeated REPS times.
export const T = 1200;            // game ticks watched (60 s): ~34 fire ticks
export const DT = 20;             // one sample per ~DT ticks
export const REPS = 6;
export const GY = -61;            // the flat world's top layer (server.mjs); the floor is stone at GY, scenes at GY+1..
export const DIFFICULTY = 'normal';

const box = (x0, x1, y0, y1, z0, z1) => { const o = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) o.push([x, y, z]); return o; };

// fire: [x,dy,z] of the lit fire; fuel: [[block, [x,dy,z]]...]; floor: the block under the fire (default stone)
export const SCENARIOS = [
  { id: 'stone',      fire: [0, 1, 0], fuel: [] },
  { id: 'netherrack', fire: [0, 1, 0], fuel: [], floor: 'minecraft:netherrack' },
  { id: 'magma',      fire: [0, 1, 0], fuel: [], floor: 'minecraft:magma_block' },
  { id: 'planks1',    fire: [0, 2, 0], fuel: [['minecraft:oak_planks', [0, 1, 0]]] },
  { id: 'log1',       fire: [0, 2, 0], fuel: [['minecraft:oak_log', [0, 1, 0]]] },
  { id: 'wool1',      fire: [0, 2, 0], fuel: [['minecraft:white_wool', [0, 1, 0]]] },
  { id: 'pile',       fire: [0, 3, 0], fuel: box(-1, 1, 1, 2, -1, 1).map((p) => ['minecraft:oak_planks', p]) },
  { id: 'tnt',        fire: [0, 1, 0], fuel: [['minecraft:tnt', [1, 1, 0]]] },
  // RAIN (a second phase, `weather rain`, open sky): a fire under rain is put out with 0.2 + age*0.03 per tick unless it
  // is infiniburn (FireBlock:154), and it never spreads to a rained-on cell (:206, :236)
  { id: 'rain-stone',      rain: true, fire: [0, 1, 0], fuel: [] },
  { id: 'rain-netherrack', rain: true, fire: [0, 1, 0], fuel: [], floor: 'minecraft:netherrack' },
  { id: 'rain-planks1',    rain: true, fire: [0, 2, 0], fuel: [['minecraft:oak_planks', [0, 1, 0]]] },
  { id: 'rain-pile',       rain: true, fire: [0, 3, 0], fuel: box(-1, 1, 1, 2, -1, 1).map((p) => ['minecraft:oak_planks', p]) },
];
/** The verdict family of a scene: burnout (stone), survive (bare infiniburn), pile, tnt, consumed (one fuel block). */
export const kindOf = (sc) => (/stone$/.test(sc.id) ? 'burnout' : !sc.fuel.length ? 'survive' : /pile$/.test(sc.id) ? 'pile' : /tnt$/.test(sc.id) ? 'tnt' : 'consumed');

// scene i, rep r: its own 8x8 cell, rows of 8 scenes, near the origin (x -28..28, z 4..52)
export const SPACING = 8;
export function origin(i, r) { return { x: -28 + SPACING * (i % 8), z: 4 + SPACING * r }; }   // the rain phase reuses the columns
export const EXTENT = { x0: -40, x1: 40, z0: -8, z1: 64 };
