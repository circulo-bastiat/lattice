// fluidscen.mjs — the FLUID FLOW TIMING scenarios, shared by runfluid.mjs (the real 1.18.2 server) and
// fluidrefcheck.mjs (the engine). Infra I6, 24 Sept 2026.
//
// A scenario is built in LOCAL coordinates on a stone floor at y=-1 (the static `blocks`, placed before the run and
// settled), then EVENTS setblock fluids/air at given ticks. Same clock as redstonescen.mjs: for k = 1..T: events
// for tick k -> sample every probe (log[k-1]) -> one world tick. A probe is
//   [label, x, y, z, 'water'|'lava']  -> the fluid's `level` (0 source, 1-7 flowing, 8+ falling), or -1 if that
//                                       cell is not that fluid, or
//   [label, x, y, z, 'bit', name]     -> 1 if the block is `name`.
// Every number the check compares is the SERVER's (D-329); this file only builds the scenes.

const stone = (x, y, z) => [x, y, z, 'stone'];
/** a 1-wide channel along +x from x=-1 to x=len: stone walls at z=+-1 and a stone end cap at x=-1 */
function channel(len, y = 0) {
  const b = [];
  for (let x = -1; x <= len; x++) { b.push(stone(x, y, -1), stone(x, y, 1)); }
  b.push(stone(-1, y, 0));
  return b;
}
const line = (kind, n, y = 0, z = 0) => Array.from({ length: n }, (_, i) => [`${kind[0]}${i}`, i, y, z, kind]);

export const SCENARIOS = [
  { id: 'water_channel', T: 60, blocks: channel(10),
    events: [[1, 0, 0, 0, 'water']], probes: line('water', 10) },
  { id: 'water_open_floor', T: 60, blocks: [],
    events: [[1, 0, 0, 0, 'water']],
    probes: [...line('water', 9), ['d1', 1, 0, 1, 'water'], ['d2', 2, 0, 2, 'water'], ['d3', 3, 0, 3, 'water'], ['k', 2, 0, 1, 'water']] },
  { id: 'water_removed', T: 80, blocks: channel(10),
    events: [[1, 0, 0, 0, 'water'], [30, 0, 0, 0, 'air']], probes: line('water', 9) },
  { id: 'water_ledge', T: 60, blocks: [...[0, 1, 2].flatMap((y) => [stone(0, y, 0)]), stone(-1, 3, 0), stone(0, 3, -1), stone(0, 3, 1)],
    events: [[1, 0, 3, 0, 'water']],
    probes: [['src', 0, 3, 0, 'water'], ['lip', 1, 3, 0, 'water'], ['f2', 1, 2, 0, 'water'], ['f1', 1, 1, 0, 'water'],
             ['f0', 1, 0, 0, 'water'], ['b2', 2, 0, 0, 'water'], ['b4', 4, 0, 0, 'water'], ['side', 1, 0, 2, 'water']] },
  { id: 'water_seeks_hole', T: 60,
    // open floor with a hole 3 east of the source (y=-1 air, y=-2 stone under it): vanilla getSpread sends the
    // flow only toward the shortest way down (within 4 blocks), not in all four directions
    blocks: [[3, -1, 0, 'air'], stone(3, -2, 0)],
    events: [[1, 0, 0, 0, 'water']],
    probes: [['e1', 1, 0, 0, 'water'], ['e2', 2, 0, 0, 'water'], ['hole', 3, -1, 0, 'water'], ['w1', -1, 0, 0, 'water'],
             ['n1', 0, 0, -1, 'water'], ['s1', 0, 0, 1, 'water']] },
  { id: 'water_infinite', T: 40, blocks: channel(4),
    events: [[1, 0, 0, 0, 'water'], [1, 2, 0, 0, 'water']],
    probes: [['a', 0, 0, 0, 'water'], ['mid', 1, 0, 0, 'water'], ['b', 2, 0, 0, 'water'], ['c', 3, 0, 0, 'water']] },
  { id: 'lava_channel', T: 200, blocks: channel(6),
    events: [[1, 0, 0, 0, 'lava']], probes: line('lava', 5) },
  { id: 'lava_meets_water', T: 120, blocks: channel(8),
    events: [[1, 0, 0, 0, 'lava'], [1, 5, 0, 0, 'water']],
    probes: [['l1', 1, 0, 0, 'lava'], ['l2', 2, 0, 0, 'lava'], ['w4', 4, 0, 0, 'water'], ['w3', 3, 0, 0, 'water'],
             ['cob2', 2, 0, 0, 'bit', 'cobblestone'], ['cob3', 3, 0, 0, 'bit', 'cobblestone'], ['cob1', 1, 0, 0, 'bit', 'cobblestone'], ['obs0', 0, 0, 0, 'bit', 'obsidian'], ['w1', 1, 0, 0, 'water']] },
  { id: 'water_on_lava_source', T: 40, blocks: channel(3),
    events: [[1, 0, 0, 0, 'lava'], [5, 0, 1, 0, 'water']],
    probes: [['obs', 0, 0, 0, 'bit', 'obsidian'], ['lava', 0, 0, 0, 'lava'], ['fall', 0, 1, 0, 'water']] },
];

export const Tmax = Math.max(...SCENARIOS.map((s) => s.T));

/** World placement of scenario i on the server: 24 blocks apart along x, floor at y=-61, scenes at y=-60. */
export const origin = (i) => ({ x: 8 + 24 * i, y: -60, z: 72 });

export function serverPlan() {
  const setup = [], step = [], probes = [];
  const maxX = origin(SCENARIOS.length - 1).x + 16;
  setup.push(`forceload add 0 60 ${maxX} 84`);
  for (let x0 = 0; x0 <= maxX; x0 += 16) {
    setup.push(`fill ${x0} -63 60 ${x0 + 15} -52 84 minecraft:air`);
    setup.push(`fill ${x0} -61 60 ${x0 + 15} -61 84 minecraft:stone`);
    setup.push(`fill ${x0} -62 60 ${x0 + 15} -62 84 minecraft:stone`);
  }
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    for (const [x, y, z, name] of sc.blocks) setup.push(`setblock ${o.x + x} ${o.y + y} ${o.z + z} minecraft:${name}`);
    for (const [t, x, y, z, name] of sc.events) step.push(`execute if score #t mclr matches ${t} run setblock ${o.x + x} ${o.y + y} ${o.z + z} minecraft:${name}`);
  });
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    for (const p of sc.probes) {
      const [label, x, y, z, kind] = p;
      probes.push({ key: `${sc.id}.${label}`, T: sc.T });
      const j = probes.length - 1;
      const P = `${o.x + x} ${o.y + y} ${o.z + z}`;
      const G = `execute if score #t mclr matches ..${sc.T}`;
      if (kind === 'bit') {
        step.push(`${G} run data modify storage mcliteref:fl p${j} append value 0`);
        step.push(`${G} if block ${P} minecraft:${p[5]} run data modify storage mcliteref:fl p${j}[-1] set value 1`);
      } else {
        step.push(`${G} run data modify storage mcliteref:fl p${j} append value -1`);
        for (let L = 0; L < 16; L++) step.push(`${G} if block ${P} minecraft:${kind}[level=${L}] run data modify storage mcliteref:fl p${j}[-1] set value ${L}`);
      }
    }
  });
  return { setup, step, probes };
}
