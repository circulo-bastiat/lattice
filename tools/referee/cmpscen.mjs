// cmpscen.mjs — COMPARATOR READOUT scenarios (a comparator reading the block behind it), shared by runcmp.mjs (the
// real 1.18.2 server) and cmprefcheck.mjs (the engine). Infra I6, 24 Sept 2026.
//
// Scene: the READ block at local (0,0,0) (a container filled by NBT, a cauldron/composter/cake at a level), a
// comparator at (1,0,0) facing west (its input side is -x) in compare mode, a redstone wire at (2,0,0). Everything is
// placed before the run and settled; the probe is the WIRE's `power` sampled for T ticks (it must be steady, and it is
// the comparator's output). Every number the check compares is the SERVER's (D-329).

export const T = 6;
const st = (n, id, c) => ({ slot: n, id, n: c });
const fillSlots = (k, id, c) => Array.from({ length: k }, (_, i) => st(i, id, c));

export const SCENARIOS = [
  { id: 'chest_empty', block: ['chest', { facing: 'north' }], items: [] },
  { id: 'chest_1_cobble', block: ['chest', { facing: 'north' }], items: [st(0, 'cobblestone', 1)] },
  { id: 'chest_64_cobble', block: ['chest', { facing: 'north' }], items: [st(0, 'cobblestone', 64)] },
  { id: 'chest_2_stacks', block: ['chest', { facing: 'north' }], items: fillSlots(2, 'cobblestone', 64) },
  { id: 'chest_14_stacks', block: ['chest', { facing: 'north' }], items: fillSlots(14, 'cobblestone', 64) },
  { id: 'chest_full', block: ['chest', { facing: 'north' }], items: fillSlots(27, 'cobblestone', 64) },
  { id: 'chest_1_pearl', block: ['chest', { facing: 'north' }], items: [st(0, 'ender_pearl', 1)] },
  { id: 'chest_16_pearls', block: ['chest', { facing: 'north' }], items: [st(0, 'ender_pearl', 16)] },
  { id: 'chest_1_sword', block: ['chest', { facing: 'north' }], items: [st(0, 'iron_sword', 1)] },
  { id: 'chest_3_swords', block: ['chest', { facing: 'north' }], items: fillSlots(3, 'iron_sword', 1) },
  { id: 'hopper_1_item', block: ['hopper', { facing: 'down', enabled: 'false' }], items: [st(0, 'cobblestone', 1)] },
  { id: 'hopper_5_stacks', block: ['hopper', { facing: 'down', enabled: 'false' }], items: fillSlots(5, 'cobblestone', 64) },
  { id: 'dispenser_1_item', block: ['dispenser', { facing: 'up' }], items: [st(4, 'cobblestone', 1)] },
  { id: 'furnace_fuel_8', block: ['furnace', { facing: 'north' }], items: [st(1, 'oak_planks', 8)] },
  { id: 'barrel_half', block: ['barrel', { facing: 'up' }], items: fillSlots(13, 'dirt', 64).concat([st(13, 'dirt', 32)]) },
  { id: 'water_cauldron_1', block: ['water_cauldron', { level: '1' }] },
  { id: 'water_cauldron_3', block: ['water_cauldron', { level: '3' }] },
  { id: 'cauldron_empty', block: ['cauldron', {}] },
  { id: 'composter_3', block: ['composter', { level: '3' }] },
  { id: 'composter_8', block: ['composter', { level: '8' }] },
  { id: 'cake_full', block: ['cake', { bites: '0' }] },
  { id: 'cake_bites_4', block: ['cake', { bites: '4' }] },
  { id: 'end_portal_frame_eye', block: ['end_portal_frame', { facing: 'north', eye: 'true' }] },
  { id: 'jukebox_empty', block: ['jukebox', {}] },
];

export const origin = (i) => ({ x: 4 + 6 * i, y: -60, z: 168 });
export const stateStr = (name, props) => {
  const kv = Object.entries(props || {}).map(([k, v]) => `${k}=${v}`);
  return `minecraft:${name}${kv.length ? '[' + kv.join(',') + ']' : ''}`;
};
const COMP = stateStr('comparator', { facing: 'west', mode: 'compare' });
const WIRE = stateStr('redstone_wire', { east: 'side', west: 'side', north: 'none', south: 'none' });

export function serverPlan() {
  const setup = [], step = [], probes = [];
  const maxX = origin(SCENARIOS.length - 1).x + 6;
  setup.push(`forceload add 0 160 ${maxX} 176`);
  for (let x0 = 0; x0 <= maxX; x0 += 16) {
    setup.push(`fill ${x0} -62 160 ${x0 + 15} -52 176 minecraft:air`);
    setup.push(`fill ${x0} -61 160 ${x0 + 15} -61 176 minecraft:stone`);
  }
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    const nbt = sc.items && sc.items.length ? `{Items:[${sc.items.map((s) => `{Slot:${s.slot}b,id:"minecraft:${s.id}",Count:${s.n}b}`).join(',')}]}` : '';
    setup.push(`setblock ${o.x} ${o.y} ${o.z} ${stateStr(sc.block[0], sc.block[1])}${nbt}`);
    setup.push(`setblock ${o.x + 1} ${o.y} ${o.z} ${COMP}`);
    setup.push(`setblock ${o.x + 2} ${o.y} ${o.z} ${WIRE}`);
    probes.push(`${sc.id}.wire`);
    const j = probes.length - 1;
    const P = `${o.x + 2} ${o.y} ${o.z}`;
    step.push(`data modify storage mcliteref:cmp p${j} append value 0`);
    for (let L = 1; L < 16; L++) step.push(`execute if block ${P} minecraft:redstone_wire[power=${L}] run data modify storage mcliteref:cmp p${j}[-1] set value ${L}`);
  });
  return { setup, step, probes, COMP, WIRE };
}
