#!/usr/bin/env node
// lockstep-pollinate -- #8644 (G18b-L35): lockstep scenario pollinate, 20 salts x 3000 ticks. A bee with a hive 20 blocks away and a flower patch
// that is missing for the first salt*7 ticks (so the 20..60-tick search-failure roll is drawn), then present. Per tick: pollinating, hasNectar,
// ticksSincePollination, ticksUntilCanPollinate, angerTime, cannotEnterHiveTicks, hive occupancy. At tick 1500+salt*9 the bee is hit: anger rolled
// (20..39 s), goal cancelled, cannotEnterHiveTicks = 400 (the smoke/hit path, BeeEntity line ~700). The model is written from BeeEntity.PollinateGoal
// (400-tick completedPollination, 20% finish roll, 200 ticks to next search, 1-in-25 re-aim, 5% sound roll) and EnterHiveGoal's 1-in-30 over java.util.Random.
// Flight is the pathing lane's: the bee is placed at the flower; the hive is 20 blocks away and entry is the lane's own driver, drawn from the same stream.
import { loadEngine } from './loadsrc.mjs';
const mk = (patch) => loadEngine({ patch, extra: ['02f_tags.js', '07_world.js', '07h_entities.js', '07i_entitylist.js', '07zo_bee.js'], dom: false, initReg: true });
const salts = Array.from({ length: 20 }, (_, i) => i), TICKS = 3000;
const FL = { x: 0, y: 64, z: 0 }, TX = 0.5, TY = 64.6, TZ = 0.5;
const hitAt = (s) => 1500 + s * 9, missing = (s) => s * 7;

function reference(M, salt) {
  const r = new M.JRandom(9000 + salt), tr = [];
  let tsp = 0, until = 0, nectar = false, run = false, pt = 0, last = 0, nx = TX, ny = TY, nz = TZ, anger = 0, cant = 0, inHive = 0, entered = -1;
  for (let t = 0; t < TICKS; t++) {
    if (!nectar) tsp++; if (cant > 0) cant--; if (until > 0) until--;
    if (anger > 0) anger--;
    if (t === hitAt(salt)) { anger = 400 + Math.floor(r.nextDouble() * 381); run = false; pt = 0; cant = 400; }
    const flower = t >= missing(salt);
    if (!run) {
      if (anger <= 0 && until <= 0 && !nectar) {
        if (!flower) until = 20 + Math.floor(r.nextDouble() * 41);
        else { run = true; pt = 0; last = 0; tsp = 0; }
      }
    } else {
      let cont = anger <= 0;
      if (cont && pt > 400) cont = r.nextDouble() < 0.2;
      if (!cont) { if (pt > 400) { nectar = true; tsp = 0; } run = false; pt = 0; until = 200; }
      else {
        if (Math.hypot(nx - TX, ny - TY, nz - TZ) <= 0.1 && Math.floor(r.nextDouble() * 25) === 0) { nx = TX + (r.nextDouble() * 2 - 1) * 0.33333334; nz = TZ + (r.nextDouble() * 2 - 1) * 0.33333334; }
        pt++;
        if (r.nextDouble() < 0.05 && pt > last + 60) last = pt;
      }
    }
    if (entered < 0 && !run && nectar && cant <= 0 && anger <= 0 && Math.floor(r.nextDouble() * 30) === 0) { entered = t; nectar = false; inHive = 1; }
    tr.push([run ? 1 : 0, nectar ? 1 : 0, tsp, until, anger, cant, inHive].join());
  }
  return { tr, entered };
}

function engine(M, salt) {
  const r = new M.JRandom(9000 + salt), tr = [], rnd = () => r.nextDouble();
  const e = { x: TX, y: TY, z: TZ, age: 0, angerTime: 0, hasNectar: false, ticksUntilCanPollinate: 0, ticksSincePollination: 0, cannotEnterHiveTicks: 0, flowerPos: null, silent: true };
  let flower = false;
  const g = new M.Bee.PollinateGoal(e, { findFlower: () => (flower ? FL : null), isFlowerAt: () => true, random: rnd, isRaining: () => false });
  const hive = { x: 20, y: 64, z: 0, type: 'beehive', bees: [] };
  let entered = -1;
  for (let t = 0; t < TICKS; t++) {
    e.age++; flower = t >= missing(salt);
    if (!e.hasNectar) e.ticksSincePollination++; if (e.cannotEnterHiveTicks > 0) e.cannotEnterHiveTicks--; if (e.ticksUntilCanPollinate > 0) e.ticksUntilCanPollinate--;
    if (e.angerTime > 0) e.angerTime--;
    if (t === hitAt(salt)) { M.Bee.startAnger(e, null, rnd); g.cancel(); e.cannotEnterHiveTicks = 400; }
    if (!g.isRunning()) { if (g.canUse()) g.start(); }
    else if (!g.canContinueToUse()) g.stop(); else g.tick();
    if (entered < 0 && !g.isRunning() && e.hasNectar && e.cannotEnterHiveTicks <= 0 && e.angerTime <= 0 && Math.floor(rnd() * 30) === 0) { if (M.Bee.enterHive(e, hive)) entered = t; }
    tr.push([g.isRunning() ? 1 : 0, e.hasNectar ? 1 : 0, e.ticksSincePollination, e.ticksUntilCanPollinate, e.angerTime, e.cannotEnterHiveTicks, hive.bees.length].join());
  }
  return { tr, entered };
}

let bad = 0, breaks = 0;
const run = (M, report) => {
  let n = 0;
  for (const s of salts) {
    const a = reference(M, s), b = engine(M, s), i = a.tr.findIndex((v, k) => v !== b.tr[k]);
    if (i >= 0 || a.entered !== b.entered) { n++; if (report && n <= 3) console.log(`FAIL salt ${s} tick ${i}: ${a.tr[i]} vs ${b.tr[i]} entered ${a.entered}/${b.entered}`); }
  }
  return n;
};
const M0 = mk(null);
bad += run(M0, true);
const stat = salts.map((s) => reference(M0, s));
if (!stat.every((x) => x.entered > 400)) { bad++; console.log('FAIL vacuous: a salt never gets nectar and enters the hive'); }
if (new Set(stat.map((x) => x.entered)).size < 4) { bad++; console.log('FAIL vacuous: entry ticks do not vary'); }
const mut = (name, f) => {
  const M = mk(); const o = M.Bee[f[0]]; M.Bee[f[0]] = f[1];
  const n = run(M, false); M.Bee[f[0]] = o;
  if (n) { breaks++; console.log('   ✓ break caught: ' + name); } else { bad++; console.log('NOT CAUGHT ' + name); }
};
mut('pollination 400 -> 300', ['POLLINATION_DURATION_TICKS', 300]);
mut('search roll max 60 -> 40', ['POLLINATE_ROLL_MAX', 40]);
mut('search roll min 20 -> 30', ['POLLINATE_ROLL_MIN', 30]);
console.log(`lockstep-pollinate: ${salts.length * 3 + 2 + breaks} assertions, ${bad} failures, ${breaks} breaks caught (${salts.length} salts x ${TICKS} ticks)`);
process.exit(bad ? 1 : 0);
