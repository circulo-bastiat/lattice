// cartscen.mjs — MINECART MOTION scenarios (#6084), shared by runcart.mjs (the real 1.18.2 server) and cartrefcheck.mjs
// (the engine). Same clock as motionscen.mjs: k == 1: summon -> sample -> one world tick. Local coords: x east, y up,
// stone floor at y=-1. Every number compared is the SERVER's (D-329); this file only builds scenes.
export const T = 50;
export const SCALE = 10000;
const line = (x0, x1, shape = 'east_west', y = 0, z = 0, nm = 'rail', props = '') =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y, z, `${nm}[shape=${shape}${props}]`]);
const SOLID = (x, y, z) => [x, y, z, 'stone'];
const flat = line(0, 14);
export const SCENARIOS = [
  { id: 'flat', pos: [1.5, 0, 0.5], motion: [0.3, 0, 0], blocks: flat },
  { id: 'slope_up', pos: [1.5, 0, 0.5], motion: [0.3, 0, 0],
    blocks: [...line(0, 2), [3, 0, 0, 'rail[shape=ascending_east]'], SOLID(4, 0, 0), [4, 1, 0, 'rail[shape=ascending_east]'], SOLID(5, 0, 0), SOLID(5, 1, 0),
      [5, 2, 0, 'rail[shape=ascending_east]'], SOLID(6, 0, 0), SOLID(6, 1, 0), SOLID(6, 2, 0), ...line(6, 12, 'east_west', 3)] },
  { id: 'slope_down', pos: [1.5, 2, 0.5], motion: [0.3, 0, 0],
    blocks: [...[0, 1, 2].flatMap((x) => [0, 1].map((y) => SOLID(x, y, 0))), SOLID(3, 0, 0), ...line(0, 2, 'east_west', 2),
      [3, 1, 0, 'rail[shape=ascending_west]'], [4, 0, 0, 'rail[shape=ascending_west]'], ...line(5, 14)] },
  { id: 'curve', pos: [1.5, 0, 0.5], motion: [0.3, 0, 0],
    blocks: [...line(0, 4), [5, 0, 0, 'rail[shape=south_west]'], ...Array.from({ length: 6 }, (_, i) => [5, 0, 1 + i, 'rail[shape=north_south]'])] },
  { id: 'powered_on', pos: [1.5, 0, 0.5], motion: [0.3, 0, 0],
    blocks: [...line(0, 3), ...line(4, 9, 'east_west', 0, 0, 'powered_rail', ',powered=true'), SOLID(4, 0, 1), [4, 0, 1, 'redstone_block'], ...line(10, 14)] },
  { id: 'powered_off', pos: [1.5, 0, 0.5], motion: [0.3, 0, 0],
    blocks: [...line(0, 3), ...line(4, 9, 'east_west', 0, 0, 'powered_rail', ',powered=false'), ...line(10, 14)] },
  { id: 'off_end', pos: [1.5, 0, 0.5], motion: [0.3, 0, 0], blocks: line(0, 4) },
  { id: 'pig_rider', pos: [1.5, 0, 0.5], motion: [0.3, 0, 0], blocks: flat, rider: true },
];
export const FIELDS = [['x', 'Pos[0]'], ['y', 'Pos[1]'], ['z', 'Pos[2]'], ['vx', 'Motion[0]'], ['vy', 'Motion[1]'], ['vz', 'Motion[2]']];
/** World placement of scenario i: 24 apart along z (curves run +z), floor at y=-61. */
export const origin = (i) => ({ x: 8, y: -60, z: 100 + 24 * i });

export function serverPlan() {
  const setup = [], step = [], probes = [];
  const n = SCENARIOS.length, z1 = origin(n - 1).z + 24;
  setup.push(`forceload add 0 96 40 ${z1}`);
  setup.push(`kill @e[type=!player,x=0,y=-64,z=96,dx=40,dy=30,dz=${z1 - 96}]`);
  for (let z0 = 96; z0 <= z1; z0 += 16) {
    setup.push(`fill 0 -63 ${z0} 40 -40 ${z0 + 15} minecraft:air`);
    setup.push(`fill 0 -61 ${z0} 40 -61 ${z0 + 15} minecraft:stone`);
  }
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    setup.push(`kill @e[tag=mrc${i}]`);
    // stone first, rails after (a rail cannot stand on air)
    const bl = sc.blocks.slice().sort((a, b) => (a[3].startsWith('stone') ? 0 : 1) - (b[3].startsWith('stone') ? 0 : 1));
    for (const [x, y, z, name] of bl) setup.push(`setblock ${o.x + x} ${o.y + y} ${o.z + z} minecraft:${name}`);
    const [px, py, pz] = sc.pos, [mx, my, mz] = sc.motion;
    const pass = sc.rider ? ',Passengers:[{id:"minecraft:pig",NoAI:1b,Silent:1b,PersistenceRequired:1b}]' : '';
    step.push(`execute if score #t mclr matches 1 run summon minecraft:minecart ${o.x + px} ${o.y + py} ${o.z + pz} {Motion:[${mx}d,${my}d,${mz}d],Tags:["mrc${i}"]${pass}}`);
  });
  SCENARIOS.forEach((sc, i) => {
    const sel = `@e[tag=mrc${i},limit=1]`;
    FIELDS.forEach(([f, path]) => {
      probes.push(`${sc.id}.${f}`);
      const j = probes.length - 1;
      step.push(`data modify storage mcliteref:mo p${j} append value 0d`);
      step.push(`execute store result storage mcliteref:mo p${j}[-1] double 1 run data get entity ${sel} ${path} ${SCALE}`);
    });
  });
  return { setup, step, probes };
}
