// fangsscen.mjs — #6080: EVOKER FANGS scenarios, shared by runfangs.mjs (the real 1.18.2 server) and fangsrefcheck.mjs
// (the engine). A fang summoned with Warmup 0/5/10 on a NoAI pig and on a NoAI witch standing in the same spot.
// Clock as motionscen.mjs: for k = 1..T: (k == 1: summon) -> sample -> one world tick.
// Samples: victim health x100 (floored), victim alive, fang alive.
export const T = 40;
export const SCALE = 100;
export const SCENARIOS = [];
for (const victim of ['pig', 'witch']) for (const warmup of [0, 5, 10]) SCENARIOS.push({ id: `${victim}_w${warmup}`, victim, warmup });
export const origin = (i) => ({ x: 8 + 16 * i, y: -60, z: 104 });

export function serverPlan() {
  const setup = [], step = [], probes = [];
  const maxX = origin(SCENARIOS.length - 1).x + 16;
  setup.push(`forceload add 0 96 ${maxX} 112`);
  for (let x0 = 0; x0 <= maxX; x0 += 16) {
    setup.push(`fill ${x0} -63 96 ${x0 + 15} -40 112 minecraft:air`);
    setup.push(`fill ${x0} -61 96 ${x0 + 15} -61 112 minecraft:stone`);
  }
  setup.push(`kill @e[type=!player,x=0,y=-64,z=96,dx=${maxX},dy=30,dz=16]`);
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i), at = `${o.x + 0.5} ${o.y} ${o.z + 0.5}`;
    setup.push(`summon minecraft:${sc.victim} ${at} {NoAI:1b,PersistenceRequired:1b,Silent:1b,Tags:["mrv${i}"]}`);
    step.push(`execute if score #t mclr matches 1 run summon minecraft:evoker_fangs ${at} {Warmup:${sc.warmup},Tags:["mrf${i}"]}`);
  });
  SCENARIOS.forEach((sc, i) => {
    const hp = `${sc.id}.hp`, fa = `${sc.id}.fang`, va = `${sc.id}.alive`;
    probes.push(hp, fa, va);
    const j = probes.length - 3;
    step.push(`data modify storage mcliteref:fa p${j} append value 0`);
    step.push(`execute store result storage mcliteref:fa p${j}[-1] int 1 run data get entity @e[tag=mrv${i},limit=1] Health ${SCALE}`);
    step.push(`data modify storage mcliteref:fa p${j + 1} append value 0`);
    step.push(`execute if entity @e[tag=mrf${i},limit=1] run data modify storage mcliteref:fa p${j + 1}[-1] set value 1`);
    step.push(`data modify storage mcliteref:fa p${j + 2} append value 0`);
    step.push(`execute if entity @e[tag=mrv${i},limit=1] run data modify storage mcliteref:fa p${j + 2}[-1] set value 1`);
  });
  return { setup, step, probes };
}
