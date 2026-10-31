// beepollenlockstepcheck.mjs -- #6666 (G17-L95): lockstep scenario 'beepollen': a bee at a poppy pollinates, flies to its bee_nest (12 blocks), enters, honey_level +1 on release; 20 salts.
// Reference = .decomp BeeEntity.PollinateGoal (:1063-1170: start/stop, completedPollination = pollinationTicks > 400, canBeeContinue 20% roll after it, ticksUntilCanPollinate = 200 on stop,
// the 1-in-25 re-aim and 5% sound draws per tick), BeeEntity.tick (ticksSincePollination++ :369), BeehiveBlockEntity.tickBees (release when TicksInHive > MinOccupation, nectar min 2400, read BEFORE ++)
// and releaseBee's honey_level +1, written out independently over java.util.Random (NS.JRandom). Per tick: running, hasNectar, ticksSincePollination, hive occupants, honey level, plus the exit tick.
// NOTE: the brief says 200 ticks; vanilla PollinateGoal is 400 (field_30300, completedPollination). The break check moves it 400 -> 200. The 12-block flight itself is the flyMove/pathing lane (not here): the bee is
// placed at the flower and the hive-return 1-in-30 roll is this lane's own driver, drawn from the same stream in both runs.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07h_entities.js', '07i_entitylist.js', '07zo_bee.js'], dom: false, initReg: true });
const Bee = M.Bee;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const salts = Array.from({ length: 20 }, (_, i) => i), TICKS = 3400;
const FL = { x: 0, y: 64, z: 0 };
const TX = FL.x + 0.5, TY = FL.y + 0.6, TZ = FL.z + 0.5;

function reference(salt) {
  const r = new M.JRandom(7000 + salt), tr = [];
  let age = 0, tsp = 0, until = 0, nectar = false, running = false, pt = 0, last = 0, ticks = 0, nx = TX, ny = TY, nz = TZ;
  let phase = 0, inHive = -1, honey = 2, exit = -1, enter = -1;
  const done = () => pt > 400;
  for (let t = 0; t < TICKS; t++) {
    age++; tsp++; if (until > 0) until--;
    if (phase === 0) {
      if (!running) {
        if (until <= 0 && !nectar) { running = true; pt = 0; ticks = 0; last = 0; tsp = 0; }
      } else {
        let cont;
        if (done()) cont = r.nextDouble() < 0.2; else cont = true;   // flower stays valid
        if (!cont) { if (done()) { nectar = true; tsp = 0; } running = false; pt = 0; until = 200; }
        else {
          ticks++;
          if (Math.hypot(nx - TX, ny - TY, nz - TZ) <= 0.1) {
            if (Math.floor(r.nextDouble() * 25) === 0) { nx = TX + (r.nextDouble() * 2 - 1) * 0.33333334; ny = TY; nz = TZ + (r.nextDouble() * 2 - 1) * 0.33333334; }
          }
          pt++;
          if (r.nextDouble() < 0.05 && pt > last + 60) last = pt;
        }
      }
      if (!running && nectar && Math.floor(r.nextDouble() * 30) === 0) { phase = 1; inHive = 0; enter = t; nectar = false; }
    } else if (phase === 1) {
      if (inHive > 2400) { phase = 2; exit = t; honey = 3; }   // releaseBee: honey_level 2 -> +1 (the 1% double roll is the block-state lane's own stub, not drawn here)
      else inHive++;
    }
    tr.push([running ? 1 : 0, nectar ? 1 : 0, tsp, phase, honey].join());
  }
  return { tr, exit, enter };
}

function engine(salt) {
  const r = new M.JRandom(7000 + salt), tr = [];
  const e = { x: TX, y: TY, z: TZ, age: 0, angerTime: 0, hasNectar: false, ticksUntilCanPollinate: 0, ticksSincePollination: 0, flowerPos: null, silent: true };
  const g = new Bee.PollinateGoal(e, { findFlower: () => FL, isFlowerAt: () => true, random: () => r.nextDouble(), isRaining: () => false });
  const hive = { x: 12, y: 64, z: 0, type: 'beehive', bees: [] };
  let phase = 0, honey = 2, exit = -1, enter = -1;
  for (let t = 0; t < TICKS; t++) {
    e.age++; e.ticksSincePollination++; if (e.ticksUntilCanPollinate > 0) e.ticksUntilCanPollinate--;
    if (phase === 0) {
      if (!g.isRunning()) { if (g.canUse()) g.start(); }
      else if (!g.canContinueToUse()) g.stop(); else g.tick();
      if (!g.isRunning() && e.hasNectar && Math.floor(r.nextDouble() * 30) === 0) { if (Bee.enterHive(e, hive)) { phase = 1; enter = t; } }
    } else if (phase === 1) {
      Bee.tickHive(hive, { isNight: () => false, isRaining: () => false, deliverHoney: () => { honey += 1; }, spawnBee: () => { phase = 2; exit = t; } });
    }
    tr.push([g.isRunning() ? 1 : 0, e.hasNectar ? 1 : 0, e.ticksSincePollination, phase, honey].join());
  }
  return { tr, exit, enter };
}
const dirty = () => salts.some((s) => { const a = reference(s), b = engine(s); return a.exit !== b.exit || a.tr.some((v, i) => v !== b.tr[i]); });
const res = salts.map((s) => { const a = reference(s), b = engine(s); const i = a.tr.findIndex((v, k) => v !== b.tr[k]); return { a, b, bad: i >= 0 || a.exit !== b.exit ? 'tick ' + i + ' ' + (a.tr[i] || '') + ' vs ' + (b.tr[i] || '') + ' exit ' + a.exit + '/' + b.exit : '' }; });
ok(!res.some((x) => x.bad), 'divergence: ' + res.map((x, i) => x.bad && i + ':' + x.bad).filter(Boolean).slice(0, 3));
ok(res.every((x) => x.a.enter > 400 && x.a.exit - x.a.enter >= 2400), 'every seed pollinates >400 ticks, enters, stays >=2400 (not vacuous)');
ok(res.every((x) => x.a.tr[TICKS - 1].endsWith(',2,3') || x.a.tr[TICKS - 1].split(',')[4] === '3'), 'honey level 2 -> 3 after the stay');
ok(new Set(res.map((x) => x.a.exit)).size > 3, 'exit ticks vary by seed');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = Bee.POLLINATION_DURATION_TICKS; Bee.POLLINATION_DURATION_TICKS = 200; brk(dirty(), 'pollinate duration 400 -> 200 caught'); Bee.POLLINATION_DURATION_TICKS = o; }
{ const o = Bee.MIN_OCCUPATION_TICKS_NECTAR; Bee.MIN_OCCUPATION_TICKS_NECTAR = 600; brk(dirty(), 'nectar stay 2400 -> 600 caught'); Bee.MIN_OCCUPATION_TICKS_NECTAR = o; }
console.log(`beepollenlockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
