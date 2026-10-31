// platescen.mjs — PRESSURE PLATE scenarios (entity sensing + the 20/10-tick recheck), shared by runplate.mjs (the
// real 1.18.2 server) and platerefcheck.mjs (the engine). Infra I6, 24 Sept 2026.
//
// A plate sits on a stone floor at local (0,0,0). ENTITIES are summoned on it at given ticks and KILLED at given
// ticks; the same clock as redstonescen.mjs: for k = 1..T: events for k -> sample -> one world tick. The probe is the
// plate's `powered` (0/1, simple plates) or `power` (0..15, weighted plates). A summoned entity is [tick, type, dx,
// dz, nbt, tag]; a kill is [tick, tag]. Every number the check compares is the SERVER's (D-329).

export const T = 80;
const item = (t, id, tag, dx = 0, dz = 0) => [t, 'item', 0.5 + dx, 0.5 + dz, `Item:{id:"minecraft:${id}",Count:1b},PickupDelay:32767`, tag];

export const SCENARIOS = [
  { id: 'oak_plate_item', plate: 'oak_pressure_plate', prop: 'powered',
    spawns: [item(5, 'stone', 'a')], kills: [[30, 'a']] },
  { id: 'oak_plate_item_brief', plate: 'oak_pressure_plate', prop: 'powered',
    spawns: [item(5, 'stone', 'a')], kills: [[8, 'a']] },
  { id: 'stone_plate_item', plate: 'stone_pressure_plate', prop: 'powered', stat: true,
    spawns: [item(5, 'stone', 'a')], kills: [[30, 'a']] },
  { id: 'stone_plate_armor_stand', plate: 'stone_pressure_plate', prop: 'powered',
    spawns: [[5, 'armor_stand', 0.5, 0.5, '', 'a']], kills: [[30, 'a']] },
  { id: 'light_weighted_3_items', plate: 'light_weighted_pressure_plate', prop: 'power',
    spawns: [item(5, 'stone', 'a', -0.2), item(5, 'dirt', 'b'), item(5, 'sand', 'c', 0.2)], kills: [[30, 'a'], [40, 'b'], [50, 'c']] },
  { id: 'heavy_weighted_3_items', plate: 'heavy_weighted_pressure_plate', prop: 'power',
    spawns: [item(5, 'stone', 'a', -0.2), item(5, 'dirt', 'b'), item(5, 'sand', 'c', 0.2)], kills: [[30, 'a'], [40, 'b'], [50, 'c']] },
];

/** World placement of scenario i: 8 apart along x, floor at y=-61, plate at y=-60. */
export const origin = (i) => ({ x: 8 + 8 * i, y: -60, z: 136 });

export function serverPlan() {
  const setup = [], step = [], probes = [];
  const maxX = origin(SCENARIOS.length - 1).x + 8;
  setup.push(`forceload add 0 128 ${maxX} 144`);
  setup.push(`fill 0 -63 128 ${maxX} -50 144 minecraft:air`);
  setup.push(`fill 0 -61 128 ${maxX} -61 144 minecraft:stone`);
  setup.push(`kill @e[type=!player,x=0,y=-64,z=128,dx=${maxX},dy=20,dz=16]`);
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    setup.push(`setblock ${o.x} ${o.y} ${o.z} minecraft:${sc.plate}`);
    for (const [t, type, px, pz, nbt, tag] of sc.spawns) {
      const n = [nbt, 'Motion:[0d,0d,0d]', `Tags:["mrp${i}${tag}"]`].filter(Boolean).join(',');
      step.push(`execute if score #t mclr matches ${t} run summon minecraft:${type} ${o.x + px} ${o.y + 0.1} ${o.z + pz} {${n}}`);
    }
    for (const [t, tag] of sc.kills) step.push(`execute if score #t mclr matches ${t} run kill @e[tag=mrp${i}${tag}]`);
  });
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    probes.push(`${sc.id}.plate`);
    const j = probes.length - 1;
    const P = `${o.x} ${o.y} ${o.z}`;
    step.push(`data modify storage mcliteref:pl p${j} append value 0`);
    if (sc.prop === 'powered') step.push(`execute if block ${P} minecraft:${sc.plate}[powered=true] run data modify storage mcliteref:pl p${j}[-1] set value 1`);
    else for (let L = 1; L < 16; L++) step.push(`execute if block ${P} minecraft:${sc.plate}[power=${L}] run data modify storage mcliteref:pl p${j}[-1] set value ${L}`);
  });
  return { setup, step, probes };
}
