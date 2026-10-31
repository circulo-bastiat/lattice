#!/usr/bin/env node
// firerefcheck.mjs — infra I6 (25 Sept 2026): FIRE — burn-out on stone, infiniburn (netherrack, magma), fuel burning
// away (planks, log, wool, a planks pile), TNT lit by a fire beside it — the engine against the REAL 1.18.2 server.
// Scenes and the vanilla rules: firescen.mjs (read its header). Golden: runfire2.mjs.
//
//   node tools/referee/runfire2.mjs           # once per machine/store (~2 min, the real server)
//   node tools/referee/firerefcheck.mjs [--verbose]
//
// The engine runs each scene x rep in a mock world (stone floor, the scene's blocks, the fire /setblock'ed and scheduled
// 30 + rand(10) like FireBlock.onBlockAdded) for T scheduled-tick rounds (B.tick), its own seeded RNG as B.rng. Compared
// per scene over the REPS reps, times clipped to T (the server's watcher ran a little past T):
//   burn-out   stone: every rep's fire is gone by T on both; the engine's median lifetime within 0.5x..2x of the server's
//   survive    netherrack, magma: the count of reps whose fire is still burning at T, exact
//   consumed   planks1, log1, wool1: the count of reps whose fuel is gone by T, within 2 of the server's
//   pile       the mean fraction of the 18 planks gone by T, within 0.35 (the server's own run-to-run spread is wide: 23%..58%)
//   tnt        the count of reps whose TNT got primed by T, within 2
// Both directions (rule 6): an engine fire that burns what vanilla's does not is as red as the reverse.
// No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, REPS, GY, origin, kindOf } from './firescen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'fire.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'fire.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('firerefcheck: SKIP (golden not generated -- run node tools/referee/runfire2.mjs)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const T = golden.T;
const clip = (t) => (t === null || t === undefined || t > T ? null : t);

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js'], dom: false });
const S = M.States, B = M.Behave, R = M.Reg;
const nameOf = (st) => (st === 0 ? 'air' : R.names[S.block[st]]);

function runEngine(sc, i, r, { ticks = T, noFloor = false, noResched = false } = {}) {
  const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
  const w = {
    get: (x, y, z) => cells.get(key(x, y, z)) || 0,
    set: (x, y, z, s) => { if (s === 0) cells.delete(key(x, y, z)); else cells.set(key(x, y, z), s); B.changed(x, y, z); },
    blockLightAt: () => 0, getLight: () => 15 << 4,
  };
  w.getBlock = w.get; w.setBlock = w.set;
  const o = origin(i, r);
  const stone = S.stateOf('stone');
  for (let x = o.x - 3; x <= o.x + 3; x++) for (let z = o.z - 3; z <= o.z + 3; z++) cells.set(key(x, GY, z), stone);
  B.init(w); B.world = w;
  if (B.clearSchedule) B.clearSchedule();
  const RNG = seeded(0xf17e + 7919 * i + 104729 * r);
  B.rng = RNG;
  // the server's flat plains, open sky (runfire2): rain falls on a cell with nothing that blocks motion above it
  // (World.hasRain: top MOTION_BLOCKING y > pos.y -> dry; fire itself has no collision); plains is never humid.
  const blocksRain = (st) => st !== 0 && nameOf(st) !== 'fire';
  B.isRaining = () => !!sc.rain;
  B.hasRain = (x, y, z) => { if (!sc.rain) return false; for (let yy = y; yy <= GY + 8; yy++) if (blocksRain(w.get(x, yy, z))) return false; return true; };
  B.highHumidity = () => false;
  B.difficultyId = () => 2;                                   // firescen DIFFICULTY 'normal'
  const fx = o.x + sc.fire[0], fy = GY + sc.fire[1], fz = o.z + sc.fire[2];
  if (sc.floor) cells.set(key(fx, fy - 1, fz), S.stateOf(sc.floor.replace('minecraft:', '')));
  if (noFloor) cells.delete(key(fx, fy - 1, fz));
  for (const [b, [x, dy, z]] of sc.fuel) cells.set(key(o.x + x, GY + dy, o.z + z), S.stateOf(b.replace('minecraft:', '')));
  cells.set(key(fx, fy, fz), S.stateOf('fire'));
  const sched = B.schedule;
  if (noResched) B.schedule = function (x, y, z) { if (nameOf(w.get(x, y, z)) === 'fire') return; return sched.apply(B, arguments); };
  try {
    B.schedule(fx, fy, fz, 30 + ((RNG() * 10) | 0));          // FireBlock.onBlockAdded
    const rec = { fireGone: null, fuelGone: sc.fuel.map(() => null), tntPrimed: null };
    for (let t = 1; t <= ticks; t++) {
      B.tick();
      if (rec.fireGone === null && nameOf(w.get(fx, fy, fz)) !== 'fire') rec.fireGone = t;
      sc.fuel.forEach(([b, [x, dy, z]], k) => {
        if (rec.fuelGone[k] !== null) return;
        if (nameOf(w.get(o.x + x, GY + dy, o.z + z)) !== b.replace('minecraft:', '')) {
          rec.fuelGone[k] = t;
          if (b === 'minecraft:tnt') rec.tntPrimed = t;              // vanilla primes EVERY TNT fire replaces (FireBlock:244-246)
        }
      });
    }
    return rec;
  } finally { B.schedule = sched; }
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };

function verdicts(eng) {
  const f = [], rows = [];
  SCENARIOS.forEach((sc, i) => {
    const g = golden.cases[sc.id];
    if (!g) { f.push(`${sc.id}: missing from golden`); return; }
    const gs = g.reps.map((x) => ({ fireGone: clip(x.fireGone), fuelGone: x.fuelGone.map(clip), tntPrimed: clip(x.tntPrimed) }));
    const es = eng[i];
    const alive = (xs) => xs.filter((x) => x.fireGone === null).length;
    const eaten = (xs) => xs.filter((x) => x.fuelGone.every((v) => v !== null)).length;
    const frac = (xs) => xs.reduce((a, x) => a + x.fuelGone.filter((v) => v !== null).length / x.fuelGone.length, 0) / xs.length;
    const primed = (xs) => xs.filter((x) => x.tntPrimed !== null).length;
    let line;
    const K = kindOf(sc);
    if (K === 'burnout') {
      const gm = median(gs.map((x) => x.fireGone ?? T)), em = median(es.map((x) => x.fireGone ?? T));
      line = `${sc.rain ? 'IN RAIN ' : ''}burn-out: server alive ${alive(gs)}/${REPS} median ${gm}t | engine alive ${alive(es)}/${REPS} median ${em}t`;
      if (alive(es) !== alive(gs) || !(em >= gm / 2 && em <= gm * 2)) f.push(`${sc.id}: ${line}`);
    } else if (K === 'survive') {
      line = `${sc.rain ? 'IN RAIN ' : ''}still burning at T: server ${alive(gs)}/${REPS} | engine ${alive(es)}/${REPS}`;
      if (alive(es) !== alive(gs)) f.push(`${sc.id} (fire on ${sc.floor}): ${line}`);
    } else if (K === 'pile') {
      line = `${sc.rain ? 'IN RAIN ' : ''}planks burnt away by T: server ${(frac(gs) * 100).toFixed(0)}% | engine ${(frac(es) * 100).toFixed(0)}%`;
      if (Math.abs(frac(es) - frac(gs)) > 0.35) f.push(`${sc.id}: ${line}`);
    } else if (K === 'tnt') {
      line = `TNT primed by the fire beside it: server ${primed(gs)}/${REPS} | engine ${primed(es)}/${REPS}`;
      if (Math.abs(primed(es) - primed(gs)) > 2) f.push(`${sc.id}: ${line}`);
    } else {
      line = `${sc.rain ? 'IN RAIN ' : ''}fuel (${sc.fuel[0][0]}) burnt away by T: server ${eaten(gs)}/${REPS} | engine ${eaten(es)}/${REPS}`;
      if (Math.abs(eaten(es) - eaten(gs)) > 2) f.push(`${sc.id}: ${line}`);
    }
    rows.push(`  ${sc.id.padEnd(11)} ${line}`);
  });
  return { f, rows };
}

let pass = 0;
const fails = [];
if (golden.notes && golden.notes.length) fails.push('golden has notes: ' + golden.notes.slice(0, 3).join('; ')); else pass++;
if (golden.ticks >= T) pass++; else fails.push(`HARNESS — the server ran ${golden.ticks}/${T} ticks`);
{ // vanilla's own shape, as the server answered — a run that lost it is a harness fault, not an engine one
  const g = (id) => golden.cases[id].reps.map((x) => ({ fireGone: clip(x.fireGone), fuelGone: x.fuelGone.map(clip) }));
  const ok = g('stone').every((x) => x.fireGone !== null) && g('netherrack').every((x) => x.fireGone === null) && g('wool1').every((x) => x.fuelGone[0] !== null);
  if (ok) pass++; else fails.push('HARNESS — the golden lost vanilla\'s shape (stone fire dies, netherrack fire lives, wool burns)');
}

// ⚠ the PILE verdict is a MEAN FRACTION, and one rep's fraction swings 0%..100% on its first few rolls (the fire under
// the pile either takes the plank below or dies): 6 seeded engine reps landed anywhere from ~40% to ~80% against a true
// engine mean of ~56% (300 unseeded reps). The server's 6 are all the golden has; the engine's side is averaged over
// PILE_REPS so the verdict measures the rule, not one seed's luck. The count verdicts stay rep-for-rep (REPS).
const PILE_REPS = REPS * 10;
const repsOf = (sc) => (kindOf(sc) === 'pile' ? PILE_REPS : REPS);
const runAll = (opts, pick) => SCENARIOS.map((sc, i) => (pick && !pick(sc) ? eng[i] : Array.from({ length: repsOf(sc) }, (_, r) => runEngine(sc, i, r, opts))));
const eng = runAll({});
const main = verdicts(eng);
if (VERBOSE) for (const l of main.rows) console.log(l);
if (main.f.length) fails.push(...main.f); else pass++;

// anti-vacuity (D-30/D-305): each break must add a failure the unbroken run does not have
let breaks = 0;
const base = new Set(main.f);
const breakCaught = (name, opts, pick) => {
  if (verdicts(runAll(opts, pick)).f.some((m) => !base.has(m))) { breaks++; pass++; } else fails.push(`anti-vacuity: "${name}" was NOT caught`);
};
breakCaught('a fire never reschedules itself', { noResched: true }, (sc) => sc.id === 'stone');
breakCaught('only T/20 ticks run', { ticks: Math.floor(T / 20) }, (sc) => sc.id === 'stone');
breakCaught('the floor under the stone fire is gone', { noFloor: true }, (sc) => sc.id === 'stone');

console.log(`firerefcheck: ${pass} passed, ${fails.length} failed (${breaks}/3 anti-vacuity breaks caught) [golden ${golden.generatedAt}]`);
for (const f of fails) console.log('  FAIL ' + f);
console.log(` assertions passed .... ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
