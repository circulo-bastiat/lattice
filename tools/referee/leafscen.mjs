// leafscen.mjs — the LEAF DECAY scenarios, shared by runleaf.mjs (the real 1.18.2 server) and
// leafrefcheck.mjs (the engine). Infra I6, 25 Sept 2026.
//
// Vanilla (1.18.2, .decomp/net/minecraft/block/LeavesBlock.java):
//   getStateForNeighborUpdate :60-63  d = distanceFromLog(neighbour)+1; if (d != 1 || DISTANCE != d) schedule(pos, 1)
//   scheduledTick             :50-51  setBlockState(pos, updateDistanceFromLogs(state), 3)   (flag 3: neighbours hear it)
//   hasRandomTicks/randomTick :37-47  DISTANCE == 7 && !PERSISTENT -> dropStacks + removeBlock
// ServerWorld.tick (:288-303): tickTime -> block ticks -> fluid ticks -> chunk source (RANDOM ticks). The `#minecraft:tick`
// function runs before the worlds tick, so the shared clock is, for k = 1..T:
//   (k == 1: place every cell, list order) (k == CUT: remove the scenario's `cut` logs, list order) -> sample -> one world tick
// A sample per scenario is two counts over its leaf cells: n (still a leaf) and d7 (a leaf at distance=7).
// Every cell is written by `setblock` (flags 2 -> the six neighbours' getStateForNeighborUpdate run), never `fill`
// and never a glass swap: a probe that edits blocks would itself schedule leaf ticks. Reads are `execute if block`.
//
// Leaf distances are laid down CORRECT (a BFS from the logs through leaves, capped at 7) so placement changes nothing
// and the wave after the cut is the only thing being measured.

export const SPEED = 64;          // randomTickSpeed: a leaf at 7 is picked 64/4096 per tick -> mean life 64 ticks
export const CUT = 20;            // the tick the `cut` logs are removed
export const T = 620;             // CUT + ~9 mean lives: every decayable leaf is gone by then (P(miss) ~ 1e-4 per leaf)
export const GY = -61;            // the flat world's grass layer (server.mjs); cells sit at GY+dy, dy >= 1
export const LEAF = 'oak_leaves', LOG = 'oak_log';

function blob() {                  // a small oak-like canopy: 5-log trunk at (8,*,8), two 5x5 (no corners) + two 3x3 layers
  const logs = [], leaves = [];
  for (let dy = 1; dy <= 5; dy++) logs.push([8, dy, 8]);
  for (let dy = 3; dy <= 6; dy++) {
    const r = dy <= 4 ? 2 : 1;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.abs(dx) === r && Math.abs(dz) === r && (r === 2 || dy === 6)) continue;
      if (dx === 0 && dz === 0 && dy <= 5) continue;
      leaves.push([8 + dx, dy, 8 + dz]);
    }
  }
  return { logs, leaves, cut: logs.slice().reverse() };
}
function line() {                  // one log, a 10-leaf line along +x: distances 1..6 then four 7s that decay, the log stays
  const logs = [[2, 1, 8]], leaves = [];
  for (let x = 3; x <= 12; x++) leaves.push([x, 1, 8]);
  return { logs, leaves, cut: [] };
}
function twoLogs() {               // a slab between two trunks; cut the west one: the canopy re-counts to the east trunk
  const logs = [], leaves = [];
  for (let dy = 1; dy <= 4; dy++) { logs.push([2, dy, 8]); logs.push([13, dy, 8]); }
  for (let dy = 4; dy <= 5; dy++) for (let x = 3; x <= 12; x++) for (let z = 7; z <= 9; z++) leaves.push([x, dy, z]);
  return { logs, leaves, cut: logs.filter((c) => c[0] === 2).reverse() };
}

/** BFS distance from logs through leaves (6-neighbour), capped at 7 — vanilla's DISTANCE values for a settled canopy. */
export function distances(sc) {
  const key = (c) => c.join(',');
  const leafSet = new Set(sc.leaves.map(key));
  const d = new Map(sc.leaves.map((c) => [key(c), 7]));
  let frontier = sc.logs.map((c) => [c, 0]);
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  while (frontier.length) {
    const next = [];
    for (const [c, v] of frontier) for (const [ax, ay, az] of DIRS) {
      const n = [c[0] + ax, c[1] + ay, c[2] + az], k = key(n);
      if (!leafSet.has(k) || v + 1 >= 7 || d.get(k) <= v + 1) continue;
      d.set(k, v + 1); next.push([n, v + 1]);
    }
    frontier = next;
  }
  return sc.leaves.map((c) => d.get(key(c)));
}

const mk = (id, shape, persistent) => ({ id, persistent: !!persistent, ...shape });
export const SCENARIOS = [
  mk('felled_a', blob()), mk('felled_b', blob()), mk('felled_c', blob()),
  mk('felled_persistent', blob(), true),
  mk('line_a', line()), mk('line_b', line()),
  mk('twologs_a', twoLogs()), mk('twologs_b', twoLogs()),
];
for (const sc of SCENARIOS) sc.dist = distances(sc);

/** chunk i of a contiguous row along +x (growthscen.mjs's reason: bots keep random ticks alive per chunk) */
export const origin = (i) => ({ x: i * 16, z: 0 });

export const leafState = (sc, i) => `minecraft:${LEAF}[distance=${sc.dist[i]},persistent=${sc.persistent}]`;

/** The server plan: setup commands, the per-tick step function, the storage keys. */
export function serverPlan() {
  const setup = ['gamerule doDaylightCycle false', 'gamerule doWeatherCycle false', 'gamerule doTileDrops false',
    'gamerule randomTickSpeed ' + SPEED, 'time set day', 'weather clear 1000000'];
  const xMax = SCENARIOS.length * 16 - 1;
  setup.push(`forceload add -16 -16 ${xMax + 16} 31`);
  // one 16-wide slab per fill: a single fill over the whole row is > 32768 blocks and the server REFUSES it ("Too many
  // blocks") -- a previous pack's blocks then survive into this one (they did: leaves left on the line turned farmland to dirt)
  for (let x = -16; x <= xMax + 16; x += 16) setup.push(`fill ${x} ${GY + 1} -16 ${x + 15} ${GY + 12} 31 minecraft:air`);
  for (let j = 0; j < 32; j++) setup.push(`data remove storage mcliteref:leaf p${j}`);   // storage persists in the world between runs
  const step = [];
  const keys = [];
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    const at = (c) => `${o.x + c[0]} ${GY + c[1]} ${o.z + c[2]}`;
    for (const c of sc.logs) step.push(`execute if score #t mclr matches 1 run setblock ${at(c)} minecraft:${LOG}`);
    sc.leaves.forEach((c, j) => step.push(`execute if score #t mclr matches 1 run setblock ${at(c)} ${leafState(sc, j)}`));
    for (const c of sc.cut) step.push(`execute if score #t mclr matches ${CUT} run setblock ${at(c)} minecraft:air`);
    for (const what of ['n', 'd7']) {
      const k = `${sc.id}.${what}`, j = keys.length; keys.push(k);
      step.push(`scoreboard players set #c mclr 0`);
      const pred = what === 'n' ? `minecraft:${LEAF}` : `minecraft:${LEAF}[distance=7]`;
      for (const c of sc.leaves) step.push(`execute if block ${at(c)} ${pred} run scoreboard players add #c mclr 1`);
      step.push(`data modify storage mcliteref:leaf p${j} append value 0`);
      step.push(`execute store result storage mcliteref:leaf p${j}[-1] int 1 run scoreboard players get #c mclr`);
    }
  });
  return { setup, step, keys, T };
}
