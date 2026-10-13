#!/usr/bin/env node
// lockstep-hoglinbrain -- #6900 (G17-L183): lockstep scenario 'hoglinbrain', 20 salts. Adult hoglin, baby hoglin, zoglin, a warped fungus (hoglin_repellents),
// a portal, a player and a villager in the nether. The engine's real NS.Hoglin (07zzg_hoglin.js) runs 300 ticks (the near-fungus hoglin is PACIFIED by the repellent, its twin away from it fights 200 ticks) and is compared per tick with an independent
// reference of HoglinBrain / HoglinEntity.tryAttack / ZoglinEntity: activity (fight / avoid / idle), attack + avoid memory, repel range 8 (nearest repellent
// 8 across 4 up/down; pathfinding favor -1 within 8; portal / fungus flee range 8), zoglin target = nearest living that is not a zoglin or creeper,
// Hoglin.tryAttack damage a/2 + nextInt(a) (a = 6; baby 0.5), Hoglin.knockback 1.0 hoglin vs 0.5 zoglin (baby none), and the CANT_REACH 200-tick forget.
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 300;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const live = (o) => Object.assign({ health: 20, vx: 0, vy: 0, vz: 0 }, o);
const f = (v) => (typeof v === 'number' ? +v.toFixed(9) : v);

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07zzg_hoglin.js'], dom: false }), Hg = M.Hoglin, rt = stream(salt), rp = stream(salt + 1000), rows = [];
  const fx = 20, fy = 64, fz = 0;
  M.EntityList = { random: rt, list: [] };
  M.World = { getBlock: (x, y, z) => (x === fx && y === fy && z === fz ? 1 : 0) };
  M.Tags = { stateIn: (tag, st) => tag === 'hoglin_repellents' && st === 1 };
  M.Ai = { canTargetLiving: () => true, canSee: () => true, attackReachSqr: () => 4, findPath: () => null };
  M.Bat = { attackScale: () => 1 }; M.Village = { attackDistanceScale: () => 1 };
  M.Entities = { isLiving: () => true, attrsOf: (t) => ({ atkKb: t === 'zoglin' ? 0.5 : 1 }) };
  const pl = live({ type: 'player', x: 8, y: 64, z: 3 }), vil = live({ type: 'villager', x: -8, y: 64, z: 0 }), creeper = live({ type: 'creeper', x: -3, y: 64, z: 0 });
  const hog = live({ type: 'hoglin', x: 12, y: 64, z: 0, isBaby: false }), twin = live({ type: 'hoglin', x: 0, y: 64, z: 0, isBaby: false });
  const baby = live({ type: 'hoglin', x: 14, y: 64, z: 1, isBaby: true }), zog = live({ type: 'zoglin', x: -10, y: 64, z: 0 });
  const stuck = live({ type: 'hoglin', x: 0, y: 64, z: 40, isBaby: false }), far = live({ type: 'villager', x: 0, y: 64, z: 50 });
  M.Player = pl; M.EntityList.list = [hog, twin, baby, zog, vil, creeper];
  const prober = live({ type: 'hoglin', x: 500, y: 64, z: 500, isBaby: false });   // its strike calls askAdultsForHelp: keep it away from the others
  Hg.syncAge(prober);
  const all = [hog, twin, baby, zog, stuck];
  all.forEach((e) => { Hg.syncAge(e); });
  for (let t = 0; t < TICKS; t++) {
    M.EntityList.random = rt;
    if (t === 5) { hog.hurtSeq = 1; hog.lastHurtByEntity = pl; twin.hurtSeq = 1; twin.lastHurtByEntity = pl; }
    if (t === 7) { baby.hurtSeq = 1; baby.lastHurtByEntity = pl; }
    if (t === 2) Hg.setAttackTarget(stuck, far, false);
    if (t === 100) vil.health = 0;
    
    all.forEach((e) => { Hg.tickEntity(e); if (t === 9 && e === zog) Hg.setAttackTarget(zog, Hg.findTarget(zog), true); });
    M.EntityList.random = rp;
    const e = { x: 10.3 + (t % 13), y: 64 + (t % 11) - 5, z: (t % 17) - 8 + 0.3 };
    const rep = Hg.nearestRepellent(e), a = Hg.attackAmount(prober, pl), b = Hg.attackAmount(baby, pl), z = Hg.attackAmount(zog, vil);
    const k1 = live({ x: 5, y: 64, z: 3 }), k2 = live({ x: -9, y: 64, z: 4 });
    const kh = Hg.knockback(hog, k1), kz = Hg.knockback(zog, k2), kb = Hg.knockback(baby, live({ x: 1, y: 64, z: 1 }));
    const fav = [6, 7, 8, 9].map((o) => Hg.pathfindingFavor({ hgRepellent: { x: fx, y: fy, z: fz } }, { x: fx - o, y: 64, z: fz }));
    const zt = Hg.findTarget(zog);
    rows.push([Hg.activity(hog), Hg.activity(twin), Hg.activity(baby), Hg.activity(zog), Hg.activity(stuck), rep ? 1 : 0, a, b, z, kh, kz, kb,
      f(k1.vx), f(k1.vy), f(k1.vz), f(k2.vx), f(k2.vy), f(k2.vz), fav.join('/'), zt && zt.type].join(','));
  }
  return rows;
}

function reference(salt) {
  const rt = stream(salt), rp = stream(salt + 1000), rows = [], avoidUntil = 8 + 100 + Math.floor(rt() * 301);
  const kb = (d, tx, tz) => {
    const ang = Math.floor(rp() * 21) - 10, h = d * (rp() * 0.5 + 0.2), len = Math.hypot(tx, tz), nx = tx / len * h, nz = tz / len * h;
    const vy = d * rp() * 0.5, c = Math.cos(ang), s = Math.sin(ang);
    return { vx: nx * c + nz * s, vy, vz: nz * c - nx * s };
  };
  for (let t = 0; t < TICKS; t++) {
    const twin = t >= 5 && t <= 205 ? 'fight' : 'idle', baby = t >= 7 && t + 1 <= avoidUntil ? 'avoid' : 'idle';
    const zog = t >= 9 && t <= 99 ? 'fight' : 'idle', stuck = t >= 2 && t <= 219 ? 'fight' : 'idle';
    const bx = Math.floor(10.3 + (t % 13)), by = 64 + (t % 11) - 5, bz = Math.floor((t % 17) - 8 + 0.3);
    const rep = Math.abs(bx - 20) <= 8 && Math.abs(by - 64) <= 4 && Math.abs(bz) <= 8 ? 1 : 0;
    const a = 3 + Math.floor(rp() * 6), z = 3 + Math.floor(rp() * 6);   // hoglin draws first, then zoglin
    const k1 = kb(1, 5 - 12, 3), k2 = kb(0.5, -9 + 10, 4);
    rows.push(['idle', twin, baby, zog, stuck, rep, a, 0.5, z, true, true, false,
      f(k1.vx), f(k1.vy), f(k1.vz), f(k2.vx), f(k2.vy), f(k2.vz), '-1/-1/0/0', t >= 100 ? 'hoglin' : 'villager'].join(','));
  }
  return rows;
}

function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    const a = engine(s, patch), b = reference(s);
    for (let i = 0; i < TICKS; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${s} tick ${i}: engine ${a[i]} ref ${b[i]}`; break; }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0, caught = 0;
const breaks = [
  ['repel range 8 -> 7 (nearestRepellent)', (fl, s) => fl === '07zzg_hoglin.js' ? s.replace('Hg.REPEL_H = 8;', 'Hg.REPEL_H = 7;') : s],
  ['repel favor range 8 -> 7', (fl, s) => fl === '07zzg_hoglin.js' ? s.replace('Hg.FAVOR_REPELLENT_DIST = 8;', 'Hg.FAVOR_REPELLENT_DIST = 7;') : s],
  ['adult damage a/2 + nextInt(a) -> a + nextInt(a)', (fl, s) => fl === '07zzg_hoglin.js' ? s.replace('a / 2 + Math.floor', 'a + Math.floor') : s],
  ['cant-reach 200 -> 201', (fl, s) => fl === '07zzg_hoglin.js' ? s.replace('Hg.CANT_REACH_TICKS = 200;', 'Hg.CANT_REACH_TICKS = 201;') : s],
  ['zoglin ignores creeper -> hoglin', (fl, s) => fl === '07zzg_hoglin.js' ? s.replace('{ zoglin: 1, creeper: 1 }', '{ zoglin: 1, villager: 1 }') : s],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`hoglinbrain: ${caught} breaks caught, ${base.bad} divergences${base.first ? ' ' + base.first : ''}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
