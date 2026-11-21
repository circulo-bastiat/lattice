// bulletreplanscen.mjs — SHULKER BULLET waypoint REPLANNING scenarios (#9444, owed part of #7061), shared by runbullet.mjs --replan
// (real 1.18.2 server) and bulletreplancheck.mjs (engine). Same clock as bulletscen.mjs. The bullet is summoned with Steps:S > 0 (and
// sometimes a Dir), so after S ticks ShulkerBulletEntity.method_7486 (selectNextMoveDirection) runs: axis choice, RNG draws, new TXD/TYD/TZD, new Steps.
// The server's bullet RNG cannot be seeded, so the check compares the RULE, not the draws: at every replan the engine, fed the draws that make it
// pick the server's Dir/Steps, must reproduce Dir, Steps, TXD/TYD/TZD, and from there Pos/Motion every tick.
export const T = 110;
const lcg = (salt) => { let a = (salt * 2654435761 + 98765) >>> 0; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; };
const q = (v) => Math.round(v * 100) / 100;
export const SCENARIOS = [];
for (let salt = 0; salt < 20; salt++) {
  const r = lcg(salt + 1);
  const dir = salt % 3 === 0 ? null : Math.floor(r() * 6);   // none, or the axis the shulker "fired along"
  SCENARIOS.push({ id: `bulletreplan_s${salt}`, pos: [0.5, q(2 + r() * 3), 0.5], step: [q((r() - 0.3) * 0.3), q((r() - 0.5) * 0.1), q((r() - 0.5) * 0.3)],
    steps: 2 + Math.floor(r() * 7), dir, pig: [q(4 + r() * 8), q(r() * 3) + 0.007, q((r() - 0.5) * 14 + 0.5)] });
}
// [label, NBT path, scale]
export const FIELDS = [['x', 'Pos[0]', 10000], ['y', 'Pos[1]', 10000], ['z', 'Pos[2]', 10000], ['vx', 'Motion[0]', 10000], ['vy', 'Motion[1]', 10000], ['vz', 'Motion[2]', 10000],
  ['steps', 'Steps', 1], ['dir', 'Dir', 1], ['txd', 'TXD', 10000], ['tyd', 'TYD', 10000], ['tzd', 'TZD', 10000]];
export const origin = (i) => ({ x: 8 + 16 * i, y: -60, z: 104 });
const uuid = (i) => `[I;0,0,0,${300 + i}]`;

export function serverPlan() {
  const setup = [], step = [], probes = [];
  const maxX = origin(SCENARIOS.length - 1).x + 16;
  setup.push(`forceload add 0 96 ${maxX} 112`);
  for (let x0 = 0; x0 <= maxX; x0 += 16) {
    setup.push(`fill ${x0} -63 96 ${x0 + 15} -40 112 minecraft:air`);
    setup.push(`fill ${x0} -61 96 ${x0 + 15} -61 112 minecraft:stone`);
  }
  setup.push(`kill @e[type=!player,x=0,y=-64,z=96,dx=${maxX},dy=30,dz=16]`);
  SCENARIOS.forEach((sc, i) => setup.push(`kill @e[tag=mrb${i}]`, `kill @e[tag=mrp${i}]`));
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i), [px, py, pz] = sc.pos, [sx, sy, sz] = sc.step;
    setup.push(`summon minecraft:pig ${o.x + sc.pig[0]} ${o.y + sc.pig[1]} ${o.z + sc.pig[2]} {NoAI:1b,NoGravity:1b,PersistenceRequired:1b,Silent:1b,Health:100f,UUID:${uuid(i)},Tags:["mrp${i}"]}`);
    step.push(`execute if score #t mclb matches 1 run summon minecraft:shulker_bullet ${o.x + px} ${o.y + py} ${o.z + pz} {Target:${uuid(i)},Steps:${sc.steps},${sc.dir === null ? '' : `Dir:${sc.dir},`}TXD:${sx}d,TYD:${sy}d,TZD:${sz}d,Tags:["mrb${i}"]}`);
  });
  SCENARIOS.forEach((sc, i) => {
    const sel = `@e[tag=mrb${i},limit=1]`;
    FIELDS.forEach(([f, path, scale]) => {
      probes.push(`${sc.id}.${f}`);
      const j = probes.length - 1;
      step.push(`data modify storage mclitebul:mo p${j} append value 0d`);
      step.push(`execute store result storage mclitebul:mo p${j}[-1] double 1 run data get entity ${sel} ${path} ${scale}`);
    });
    probes.push(`${sc.id}.hasdir`);
    let j = probes.length - 1;
    step.push(`data modify storage mclitebul:mo p${j} append value 0`);
    step.push(`execute if data entity ${sel} Dir run data modify storage mclitebul:mo p${j}[-1] set value 1`);
    probes.push(`${sc.id}.alive`);
    j = probes.length - 1;
    step.push(`data modify storage mclitebul:mo p${j} append value 0`);
    step.push(`execute if entity ${sel} run data modify storage mclitebul:mo p${j}[-1] set value 1`);
  });
  return { setup, step, probes };
}
// pig y carries +0.007: y + height/2 (0.45) must not land on a block boundary, where the engine's relative frame and the server's absolute one round differently.
