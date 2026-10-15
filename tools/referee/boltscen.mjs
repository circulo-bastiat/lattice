// boltscen.mjs — LIGHTNING BOLT scenarios (#6085), shared by runbolt.mjs (the real 1.18.2 server) and boltrefcheck.mjs
// (the engine). One victim (NoAI) at the scenario origin; a lightning_bolt is summoned on it at tick BOLT_AT; per tick:
// (summons) -> sample (log[k-1]) -> one world tick. Samples per tick: which types stand in the cell (1/0 each), the
// victim's health x100, Fire ticks, Creeper powered, and whether the origin cell holds fire / the scenario's probe block.
// Every number the check compares is the SERVER's (D-329). The player victim is OWED (a fake player needs a connection).

export const T = 40;
export const BOLT_AT = 3;

export const SCENARIOS = [
  { id: 'bolt_pig', victim: 'pig', types: ['pig', 'zombified_piglin'] },
  { id: 'bolt_villager', victim: 'villager', types: ['villager', 'witch'] },
  { id: 'bolt_creeper', victim: 'creeper', types: ['creeper'] },
  { id: 'bolt_mooshroom', victim: 'mooshroom', types: ['mooshroom'] },
  { id: 'bolt_cow', victim: 'cow', types: ['cow'] },
  { id: 'bolt_copper', victim: null, types: [], floor: 'exposed_copper', probe: [0, -1, 0, 'copper_block'] },
];

export const origin = (i) => ({ x: 8 + 16 * i, y: -60, z: 104 });
export const SEL = (o) => `@e[type=!minecraft:lightning_bolt,type=!minecraft:player,x=${o.x},y=${o.y - 1},z=${o.z},dx=1,dy=3,dz=1,limit=1]`;

export function serverPlan() {
  const setup = [], step = [], probes = [];
  const maxX = origin(SCENARIOS.length - 1).x + 16;
  setup.push('difficulty normal', 'gamerule doFireTick true', 'gamerule doMobSpawning false', 'weather clear');
  setup.push(`forceload add 0 96 ${maxX} 112`);
  for (let x0 = 0; x0 <= maxX; x0 += 16) {
    setup.push(`fill ${x0} -63 96 ${x0 + 15} -40 112 minecraft:air`);
    setup.push(`fill ${x0} -61 96 ${x0 + 15} -61 112 minecraft:stone`);
  }
  setup.push(`kill @e[type=!player,x=0,y=-64,z=96,dx=${maxX},dy=30,dz=16]`);
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    if (sc.floor) setup.push(`setblock ${o.x} ${o.y - 1} ${o.z} minecraft:${sc.floor}`);
    if (sc.victim) setup.push(`summon minecraft:${sc.victim} ${o.x + 0.5} ${o.y} ${o.z + 0.5} {NoAI:1b,PersistenceRequired:1b,Silent:1b,Age:0}`);
    step.push(`execute if score #t mclr matches ${BOLT_AT} run summon minecraft:lightning_bolt ${o.x + 0.5} ${o.y} ${o.z + 0.5}`);
  });
  const add = (id, label, run) => {
    probes.push(`${id}.${label}`);
    const j = probes.length - 1;
    step.push(`data modify storage mcliteref:bo p${j} append value 0`, ...run(j));
  };
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i), sel = SEL(o);
    for (const t of sc.types) add(sc.id, 'n_' + t, (j) => [`execute if entity @e[type=minecraft:${t},x=${o.x},y=${o.y - 1},z=${o.z},dx=1,dy=3,dz=1] run data modify storage mcliteref:bo p${j}[-1] set value 1`]);
    if (sc.victim) {
      add(sc.id, 'hp', (j) => [`execute store result storage mcliteref:bo p${j}[-1] int 1 run data get entity ${sel} Health 100`]);
      add(sc.id, 'fire', (j) => [`execute store result storage mcliteref:bo p${j}[-1] int 1 run data get entity ${sel} Fire`]);
      add(sc.id, 'powered', (j) => [`execute store result storage mcliteref:bo p${j}[-1] int 1 run data get entity ${sel} powered`]);
    }
    add(sc.id, 'fireblock', (j) => [`execute if block ${o.x} ${o.y} ${o.z} minecraft:fire run data modify storage mcliteref:bo p${j}[-1] set value 1`]);
    if (sc.probe) { const [x, y, z, n] = sc.probe; add(sc.id, 'block', (j) => [`execute if block ${o.x + x} ${o.y + y} ${o.z + z} minecraft:${n} run data modify storage mcliteref:bo p${j}[-1] set value 1`]); }
  });
  return { setup, step, probes };
}
