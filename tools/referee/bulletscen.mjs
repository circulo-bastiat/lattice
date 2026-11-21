// bulletscen.mjs — SHULKER BULLET homing scenarios (#6079), shared by runbullet.mjs (real 1.18.2 server) and
// bulletrefcheck.mjs (engine). Clock as motionscen.mjs: k==1 summon -> sample (log[k-1]) -> one world tick.
// The bullet is summoned with Steps:0 and no Dir, so the server never replans (stepCount 0, dir null): the flight is the
// pure blend  v += (t - v) * 0.2  with t = TXD/TYD/TZD * 1.025 clamped to [-1,1] -- deterministic, no RNG.
// The target is a NoAI pig (fixed UUID); `tp` scenarios teleport it at tick `tpAt` ("moving"). Hit = bullet removed.
export const T = 40;
export const SCALE = 10000;
export const STEP = 0.15;
export const SCENARIOS = [
  { id: 'bullet_still', pos: [0.5, 1.5, 0.5], step: [STEP, 0, 0], pig: [6.5, 1, 0.5] },
  { id: 'bullet_diag', pos: [0.5, 1.5, 0.5], step: [0.1, 0.05, 0.08], pig: [5.5, 1.3, 4.5] },
  { id: 'bullet_moving', pos: [0.5, 1.5, 0.5], step: [STEP, 0, 0], pig: [8.5, 1, 0.5], tpAt: 12, tpTo: [8.5, 1, 6.5] },
];
// salts 0..19 (#7061): integer-LCG positions/steps so both sides get the same exact doubles; some hit, some chase a teleported pig.
const lcg = (salt) => { let a = (salt * 2654435761 + 12345) >>> 0; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; };
const q = (v) => Math.round(v * 100) / 100;
for (let salt = 0; salt < 20; salt++) {
  const r = lcg(salt + 1);
  const sc = { id: `bullet_s${salt}`, pos: [0.5, q(1 + r()), 0.5], step: [q((r() - 0.3) * 0.3), q((r() - 0.5) * 0.1), q((r() - 0.5) * 0.3)],
    pig: [q(3 + r() * 7), q(r() * 1.5), q((r() - 0.5) * 12 + 0.5)] };
  if (salt % 3 === 0) { sc.tpAt = 5 + (salt % 11); sc.tpTo = [q(3 + r() * 7), q(r() * 1.5), q((r() - 0.5) * 12 + 0.5)]; }
  SCENARIOS.push(sc);
}
export const FIELDS = [['x', 'Pos[0]'], ['y', 'Pos[1]'], ['z', 'Pos[2]'], ['vx', 'Motion[0]'], ['vy', 'Motion[1]'], ['vz', 'Motion[2]']];
export const origin = (i) => ({ x: 8 + 16 * i, y: -60, z: 104 });
const uuid = (i) => `[I;0,0,0,${100 + i}]`;

export function serverPlan() {
  const setup = [], step = [], probes = [];
  const maxX = origin(SCENARIOS.length - 1).x + 16;
  setup.push(`forceload add 0 96 ${maxX} 112`);
  for (let x0 = 0; x0 <= maxX; x0 += 16) {
    setup.push(`fill ${x0} -63 96 ${x0 + 15} -40 112 minecraft:air`);
    setup.push(`fill ${x0} -61 96 ${x0 + 15} -61 112 minecraft:stone`);
  }
  setup.push(`kill @e[type=!player,x=0,y=-64,z=96,dx=${maxX},dy=30,dz=16]`);
  SCENARIOS.forEach((sc, i) => setup.push(`kill @e[tag=mbb${i}]`, `kill @e[tag=mbp${i}]`));   // leftovers of an earlier run, wherever they flew
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i), [px, py, pz] = sc.pos, [sx, sy, sz] = sc.step;
    setup.push(`summon minecraft:pig ${o.x + sc.pig[0]} ${o.y + sc.pig[1]} ${o.z + sc.pig[2]} {NoAI:1b,NoGravity:1b,PersistenceRequired:1b,Silent:1b,Health:100f,UUID:${uuid(i)},Tags:["mbp${i}"]}`);
    step.push(`execute if score #t mclb matches 1 run summon minecraft:shulker_bullet ${o.x + px} ${o.y + py} ${o.z + pz} {Target:${uuid(i)},Steps:0,TXD:${sx}d,TYD:${sy}d,TZD:${sz}d,Tags:["mbb${i}"]}`);
    if (sc.tpAt) step.push(`execute if score #t mclb matches ${sc.tpAt} run tp @e[tag=mbp${i},limit=1] ${o.x + sc.tpTo[0]} ${o.y + sc.tpTo[1]} ${o.z + sc.tpTo[2]}`);
  });
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i), sel = `@e[tag=mbb${i},limit=1]`;
    void o;
    FIELDS.forEach(([f, path]) => {
      probes.push(`${sc.id}.${f}`);
      const j = probes.length - 1;
      step.push(`data modify storage mclitebul:mo p${j} append value 0d`);
      step.push(`execute store result storage mclitebul:mo p${j}[-1] double 1 run data get entity ${sel} ${path} ${SCALE}`);
    });
    probes.push(`${sc.id}.alive`);
    let j = probes.length - 1;
    step.push(`data modify storage mclitebul:mo p${j} append value 0`);
    step.push(`execute if entity ${sel} run data modify storage mclitebul:mo p${j}[-1] set value 1`);
    probes.push(`${sc.id}.lev`);   // the pig carries Levitation (hit landed)
    j = probes.length - 1;
    step.push(`data modify storage mclitebul:mo p${j} append value 0`);
    step.push(`execute if entity @e[tag=mbp${i},nbt={ActiveEffects:[{Id:25b}]},limit=1] run data modify storage mclitebul:mo p${j}[-1] set value 1`);
  });
  return { setup, step, probes };
}
