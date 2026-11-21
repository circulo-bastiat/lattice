// dispensescen.mjs — the DISPENSER / DROPPER TIMING scenarios, shared by rundispense.mjs (the real 1.18.2 server)
// and dispenserefcheck.mjs (the engine). Infra I6, 24 Sept 2026.
//
// Same clock as redstonescen.mjs: a circuit in LOCAL coordinates (x east, y up, stone floor at y=-1), placed
// before the run and left to settle; then for k = 1..T: apply the events for tick k -> sample every probe
// (log[k-1]) -> one world tick. An event is [t, 1|0] (the TRIGGER cell 0,0,0 becomes redstone_block | air) or
// [t, x, y, z, name] (a plain setblock anywhere: the neighbour update a quasi-connected dropper waits for).
// A probe is [label, x, y, z, 'count', path] (a container's slot count: `first` = the first non-empty slot, or a
// slot number) or [label, x, y, z, 'bit', name, prop, val] (the block is `name`, with prop=val when prop is set).
// Every number the check compares is the SERVER's (D-329); this file only builds circuits.

export const T = 60;
const it = (slot, id, n) => ({ slot, id, n });
const PULSES = [[5, 1], [6, 0], [10, 1], [12, 0], [20, 1], [40, 0]];
const CLOCK = []; for (let t = 5; t <= 29; t += 2) CLOCK.push([t, 1], [t + 1, 0]);

const dropper = (x, y, z, facing, items) => [x, y, z, 'dropper', { facing, triggered: 'false' }, items || []];
const dispenser = (x, y, z, facing, items) => [x, y, z, 'dispenser', { facing, triggered: 'false' }, items || []];
const chest = (x, y, z) => [x, y, z, 'chest', { facing: 'north' }, []];
const hopper = (x, y, z, facing) => [x, y, z, 'hopper', { facing, enabled: 'true' }, []];
const furnace = (x, y, z) => [x, y, z, 'furnace', { facing: 'north', lit: 'false' }, []];
const cnt = (label, x, y, z, path) => [label, x, y, z, 'count', path === undefined ? 'first' : path];
const bit = (label, x, y, z, name, prop, val) => [label, x, y, z, 'bit', name, prop || null, val || null];

export const SCENARIOS = [
  { id: 'dropper_chest_pulses', events: PULSES,
    blocks: [dropper(1, 0, 0, 'east', [it(0, 'cobblestone', 10)]), chest(2, 0, 0)],
    probes: [cnt('src', 1, 0, 0), cnt('dst', 2, 0, 0), bit('trig', 1, 0, 0, 'dropper', 'triggered', 'true')] },
  { id: 'dropper_chain', events: PULSES,
    blocks: [dropper(1, 0, 0, 'east', [it(0, 'cobblestone', 10)]), dropper(2, 0, 0, 'east'), chest(3, 0, 0)],
    probes: [cnt('d1', 1, 0, 0), cnt('d2', 2, 0, 0), cnt('dst', 3, 0, 0)] },
  { id: 'dropper_hopper_chest', events: PULSES,
    blocks: [dropper(1, 0, 0, 'east', [it(0, 'cobblestone', 10)]), hopper(2, 0, 0, 'east'), chest(3, 0, 0)],
    probes: [cnt('src', 1, 0, 0), cnt('hop', 2, 0, 0), cnt('dst', 3, 0, 0)] },
  { id: 'dropper_fast_clock', events: CLOCK,
    blocks: [dropper(1, 0, 0, 'east', [it(0, 'cobblestone', 20)]), chest(2, 0, 0)],
    probes: [cnt('src', 1, 0, 0), cnt('dst', 2, 0, 0)] },
  { id: 'dropper_up_furnace', events: PULSES,
    blocks: [dropper(1, 0, 0, 'up', [it(0, 'coal', 5)]), furnace(1, 1, 0)],
    probes: [cnt('src', 1, 0, 0), cnt('fuel', 1, 1, 0, 1), cnt('in', 1, 1, 0, 0)] },
  { id: 'dropper_side_furnace_nonfuel', events: PULSES, stat: true,
    blocks: [dropper(1, 0, 0, 'east', [it(0, 'cobblestone', 5)]), furnace(2, 0, 0)],
    probes: [cnt('src', 1, 0, 0), cnt('fuel', 2, 0, 0, 1), cnt('in', 2, 0, 0, 0)] },
  { id: 'dropper_quasi', events: [[5, 1], [15, 0], [20, 1], [25, 1, -2, 0, 'stone'], [45, 0]],
    blocks: [dropper(1, -1, 0, 'east', [it(0, 'cobblestone', 10)]), chest(2, -1, 0)],
    probes: [cnt('src', 1, -1, 0), cnt('dst', 2, -1, 0)] },
  { id: 'dispenser_cobble_at_chest', events: PULSES,
    blocks: [dispenser(1, 0, 0, 'east', [it(0, 'cobblestone', 10)]), chest(2, 0, 0)],
    probes: [cnt('src', 1, 0, 0), cnt('dst', 2, 0, 0)] },
  { id: 'dispenser_arrows', events: CLOCK,
    blocks: [dispenser(1, 0, 0, 'up', [it(0, 'arrow', 16)])],
    probes: [cnt('src', 1, 0, 0), bit('trig', 1, 0, 0, 'dispenser', 'triggered', 'true')] },
  { id: 'dispenser_water_bucket', events: PULSES,
    blocks: [dispenser(1, 0, 0, 'east', [it(0, 'water_bucket', 1)])],
    probes: [bit('water', 2, 0, 0, 'water', 'level', '0'), bit('dispenser', 1, 0, 0, 'dispenser'), cnt('slot', 1, 0, 0, 0)] },
];

/** World placement of scenario i on the server: 16 blocks apart along x, floor at y=-61, circuits at y=-60. */
export const origin = (i) => ({ x: 4 + 16 * i, y: -60, z: 44 });

const stateStr = (name, props) => {
  const kv = Object.entries(props || {}).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}=${v}`);
  return `minecraft:${name}${kv.length ? '[' + kv.join(',') + ']' : ''}`;
};
const nbtOf = (items) => (items && items.length
  ? `{Items:[${items.map((s) => `{Slot:${s.slot}b,id:"minecraft:${s.id}",Count:${s.n}b}`).join(',')}]}` : '');

/** Setup (RCON, before the run) and the datapack tick body. */
export function serverPlan() {
  const setup = [], step = [], probes = [];
  const maxX = origin(SCENARIOS.length - 1).x + 8;
  setup.push(`forceload add 0 40 ${maxX} 56`);
  for (let x0 = 0; x0 <= maxX; x0 += 16) {
    setup.push(`fill ${x0} -63 40 ${x0 + 15} -55 52 minecraft:air`);
    setup.push(`kill @e[type=item,x=${x0},y=-64,z=40,dx=16,dy=12,dz=13]`);
    setup.push(`fill ${x0} -61 40 ${x0 + 15} -61 52 minecraft:stone`);
  }
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    for (const [x, y, z, name, props, items] of sc.blocks) setup.push(`setblock ${o.x + x} ${o.y + y} ${o.z + z} ${stateStr(name, props)}${nbtOf(items)}`);
    for (const ev of sc.events) {
      const [t] = ev;
      if (ev.length === 2) step.push(`execute if score #t mclr matches ${t} run setblock ${o.x} ${o.y} ${o.z} minecraft:${ev[1] ? 'redstone_block' : 'air'}`);
      else step.push(`execute if score #t mclr matches ${t} run setblock ${o.x + ev[1]} ${o.y + ev[2]} ${o.z + ev[3]} minecraft:${ev[4]}`);
    }
  });
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    for (const p of sc.probes) {
      const [label, x, y, z, kind] = p;
      probes.push(`${sc.id}.${label}`);
      const j = probes.length - 1;
      const P = `${o.x + x} ${o.y + y} ${o.z + z}`;
      if (kind === 'count') {
        const path = p[5] === 'first' ? 'Items[0].Count' : `Items[{Slot:${p[5]}b}].Count`;
        step.push(`data modify storage mcliteref:dsp p${j} append value 0`);
        step.push(`execute store result storage mcliteref:dsp p${j}[-1] int 1 run data get block ${P} ${path}`);
      } else {
        step.push(`execute store success score #p mclr if block ${P} ${stateStr(p[5], p[6] ? { [p[6]]: p[7] } : {})}`);
        step.push(`execute if score #p mclr matches 1 run data modify storage mcliteref:dsp p${j} append value 1`);
        step.push(`execute if score #p mclr matches 0 run data modify storage mcliteref:dsp p${j} append value 0`);
      }
    }
  });
  return { setup, step, probes };
}
