// hopperscen.mjs — the HOPPER TIMING scenarios, shared by runhopper.mjs (the real 1.18.2 server) and
// hopperrefcheck.mjs (the engine). Infra I6, 24 Sept 2026.
//
// Every block of a scenario is placed at tick 1, in list order (which is also the block-entity tick order on
// both sides), containers filled by NBT. Then per tick both sides sample the WATCHED slot counts, on the same
// clock as redstonescen.mjs: for k = 1..T: (k == 1: place) -> sample (log[k-1]) -> one world tick.
// A watch path is `first` (Items[0].Count: the first non-empty slot) or a slot number.
const chest = (x, y, z, items) => [x, y, z, 'chest', { facing: 'north' }, items || []];
const hopper = (x, y, z, facing) => [x, y, z, 'hopper', { facing, enabled: 'true' }, []];
const furnace = (x, y, z, items) => [x, y, z, 'furnace', { facing: 'north', lit: 'false' }, items || []];
const it = (slot, id, n) => ({ slot, id, n });

export const SCENARIOS = [
  { id: 'chest_hopper_chest', T: 200,
    blocks: [chest(0, 2, 0, [it(0, 'cobblestone', 20)]), hopper(0, 1, 0, 'down'), chest(0, 0, 0)],
    watch: [['src', 0, 2, 0, 'first'], ['hop', 0, 1, 0, 'first'], ['dst', 0, 0, 0, 'first']] },
  { id: 'hopper_chain', T: 220,
    blocks: [chest(0, 2, 0, [it(0, 'cobblestone', 20)]), hopper(0, 1, 0, 'east'), hopper(1, 1, 0, 'down'), chest(1, 0, 0)],
    watch: [['src', 0, 2, 0, 'first'], ['h1', 0, 1, 0, 'first'], ['h2', 1, 1, 0, 'first'], ['dst', 1, 0, 0, 'first']] },
  { id: 'hopper_chain_reversed', T: 220,
    blocks: [chest(1, 0, 0), hopper(1, 1, 0, 'down'), hopper(0, 1, 0, 'east'), chest(0, 2, 0, [it(0, 'cobblestone', 20)])],
    watch: [['src', 0, 2, 0, 'first'], ['h1', 0, 1, 0, 'first'], ['h2', 1, 1, 0, 'first'], ['dst', 1, 0, 0, 'first']] },
  { id: 'hopper_two_items', T: 120,
    blocks: [chest(0, 2, 0, [it(0, 'cobblestone', 5), it(3, 'dirt', 5)]), hopper(0, 1, 0, 'down'), chest(0, 0, 0)],
    watch: [['cobble', 0, 2, 0, 0], ['dirt', 0, 2, 0, 3], ['d0', 0, 0, 0, 0], ['d1', 0, 0, 0, 1]] },
  { id: 'hopper_locked', T: 60, stat: true,
    blocks: [chest(0, 2, 0, [it(0, 'cobblestone', 20)]), hopper(0, 1, 0, 'down'), chest(0, 0, 0), [1, 1, 0, 'redstone_block', {}, null]],
    watch: [['src', 0, 2, 0, 'first'], ['hop', 0, 1, 0, 'first'], ['dst', 0, 0, 0, 'first']] },
  { id: 'hopper_furnace_line', T: 440,
    blocks: [chest(0, 2, 0, [it(0, 'raw_iron', 3)]), hopper(0, 1, 0, 'down'), furnace(0, 0, 0, [it(1, 'coal', 1)]),
             hopper(0, -1, 0, 'down'), chest(0, -2, 0)],
    watch: [['src', 0, 2, 0, 'first'], ['in', 0, 0, 0, 0], ['out', 0, 0, 0, 2], ['hop2', 0, -1, 0, 'first'], ['dst', 0, -2, 0, 'first']] },
  { id: 'hopper_side_fuel', T: 120,
    blocks: [furnace(0, 0, 0), chest(1, 1, 0, [it(0, 'coal', 10)]), hopper(1, 0, 0, 'west')],
    watch: [['fuel', 0, 0, 0, 1], ['src', 1, 1, 0, 'first'], ['hop', 1, 0, 0, 'first']] },
];

export const origin = (i) => ({ x: 4 + 4 * i, y: -57, z: 30 });

const stateStr = (name, props) => {
  const kv = Object.entries(props || {}).map(([k, v]) => `${k}=${v}`);
  return `minecraft:${name}${kv.length ? '[' + kv.join(',') + ']' : ''}`;
};

export function serverPlan() {
  const setup = [], step = [], keys = [];
  setup.push('forceload add 0 24 64 40');
  setup.push('fill 0 -61 26 40 -52 34 minecraft:air');
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    for (const [x, y, z, name, props, items] of sc.blocks) {
      const nbt = items ? `{Items:[${items.map((s) => `{Slot:${s.slot}b,id:"minecraft:${s.id}",Count:${s.n}b}`).join(',')}]}` : '';
      step.push(`execute if score #t mclr matches 1 run setblock ${o.x + x} ${o.y + y} ${o.z + z} ${stateStr(name, props)}${nbt}`);
    }
    for (const [label, x, y, z, path] of sc.watch) {
      keys.push(`${sc.id}.${label}`);
      const j = keys.length - 1;
      const P = `${o.x + x} ${o.y + y} ${o.z + z}`;
      const read = path === 'first' ? `data get block ${P} Items[0].Count` : `data get block ${P} Items[{Slot:${path}b}].Count`;
      step.push(`execute if score #t mclr matches ..${sc.T} run data modify storage mcliteref:hop p${j} append value 0`);
      step.push(`execute if score #t mclr matches ..${sc.T} store result storage mcliteref:hop p${j}[-1] int 1 run ${read}`);
    }
  });
  return { setup, step, keys, T: Math.max(...SCENARIOS.map((s) => s.T)) };
}
