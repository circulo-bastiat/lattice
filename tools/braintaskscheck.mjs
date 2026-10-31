#!/usr/bin/env node
// braintaskscheck.mjs -- #9436: RandomTask / CompositeTask / ConditionalTask (src/07zzzc_braintasks.js) vs .decomp
// CompositeTask.java, RandomTask.java, ConditionalTask.java, WeightedList.java. Expected values are computed here from the
// decompiled algorithm with an independent BigInt java.util.Random. Anti-vacuity: '<n> breaks caught'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
console.log('braintaskscheck -- #9436, RandomTask / ConditionalTask');

function javaRandom(seed) {
  let s = (BigInt(seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n);
  const next = (bits) => { s = (s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(BigInt.asIntN(32, s >> BigInt(48 - bits))); };
  return { log: [], next,
    nextFloat() { const v = next(24) / 16777216; this.log.push('f'); return v; },
    nextInt(b) { this.log.push('i' + b);
      if ((b & -b) === b) return Number((BigInt(b) * BigInt(next(31))) >> 31n);
      let bits, val; do { bits = next(31); val = bits % b; } while (bits - val + (b - 1) < 0); return val; } };
}

const SEED = 1;
function scenario(edit) {
  const NS = {}; globalThis.MCL = NS;
  const load = (f, ed) => { let s = readFileSync(join(ROOT, 'src', f), 'utf8');
    if (ed) { if (!s.includes(ed[0])) throw new Error('edit target missing: ' + ed[0]); s = s.replace(ed[0], ed[1]); }
    new Function('MCL', s)(NS); };
  load('07zzzb_brain.js'); load('07zzzc_braintasks.js', edit);
  const B = NS.Brain, log = [];
  const world = { time: 100, random: javaRandom(42) }, shuf = javaRandom(SEED);
  const e = { brain: new B.Brain(), flag: true };
  e.brain.registerMemory('m');                       // registered, value absent
  class T extends B.Task { constructor(n, min, max, req) { super(req, min, max); this.n = n; }
    run() { log.push('run ' + this.n); } shouldKeepRunning() { return true; } finishRunning() { log.push('end ' + this.n); } }
  const A = new T('A', 5, 5), Bt = new T('B', 1, 1, { m: B.VALUE_PRESENT }), C = new T('C', 2, 8), D = new T('D', 4, 4);
  const R = new B.RandomTask([[A, 1], [Bt, 3], [C, 2], [D, 5]], shuf);
  R.tryStarting(world, e, 100);
  const afterStart = { log: log.slice(), rw: world.random.log.slice(), rs: shuf.log.slice(), st: [A, Bt, C, D].map((t) => t.status), rst: R.status };
  world.time = 500; R.tick(world, e, 500);           // Composite never times out; children keep running -> still RUNNING
  const afterTick = { rst: R.status, st: [A, Bt, C, D].map((t) => t.status) };
  // ConditionalTask
  const inner = new T('X', 3, 3, { m: B.VALUE_PRESENT });
  const K = new B.ConditionalTask({ q: B.REGISTERED }, (en) => en.flag, inner, false);
  const req = JSON.stringify(K.required);
  const noMem = K.tryStarting(world, e, 600);         // m absent -> merged requirement blocks, no draw
  e.brain.registerMemory('q'); e.brain.remember('m', 1);
  e.flag = false; const flagOff = K.tryStarting(world, e, 600);
  e.flag = true; const drawsBefore = world.random.log.length; const on = K.tryStarting(world, e, 600);
  const drawsOn = world.random.log.length - drawsBefore;
  K.tick(world, e, 601);                             // allowsContinuation false -> stop, even though time limit is disabled
  const cont = new B.ConditionalTask({}, null, inner, true);
  cont.tryStarting(world, e, 700); const keep = cont.shouldKeepRunning(world, e, 9999); cont.tick(world, e, 9999); const cst = cont.status;
  return { afterStart, afterTick, req, noMem, flagOff, on, drawsOn, kst: K.status, keep, cst, log: log.slice() };
}

const base = scenario();
// Reference from the algorithm: outer Task.tryStarting nextInt(1); run(): shuffle = one nextFloat per entry (4), key
// -pow(float r, float 1/w), stable ascending sort; RUN_ONE tries children in that order until one starts; B is blocked.
const ref = javaRandom(SEED); const w = [['A', 1], ['B', 3], ['C', 2], ['D', 5]];
const keys = w.map(([n, wt]) => [n, -Math.pow(Math.fround(ref.nextFloat()), Math.fround(1 / wt))]);
const order = keys.map((k, i) => [k, i]).sort((a, b) => a[0][1] - b[0][1] || a[1] - b[1]).map((x) => x[0][0]);
const winner = order.find((n) => n !== 'B');
const mm = { A: [5, 5], C: [2, 8], D: [4, 4] }[winner];
const j = (x) => JSON.stringify(x);
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
ok(j(base.afterStart.rs) === j(['f', 'f', 'f', 'f']), 'four nextFloat on the shuffle stream ' + j(base.afterStart.rs));
ok(j(base.afterStart.rw) === j(['i1', 'i' + (mm[1] + 1 - mm[0])]), 'world draws: outer nextInt(1), winner nextInt ' + j(base.afterStart.rw));
ok(j(base.afterStart.log) === j(['run ' + winner]), 'only the first startable child runs: ' + j(base.afterStart.log) + ' want ' + winner + ' (order ' + order + ')');
ok(base.afterStart.rst === 1 && base.afterTick.rst === 1, 'composite RUNNING and has no time limit');
ok(j(base.afterStart.st) === j(['A', 'B', 'C', 'D'].map((n) => (n === winner ? 1 : 0))), 'child statuses');
ok(base.req === j({ q: 'registered', m: 'value_present' }), 'merged requirements ' + base.req);
ok(base.noMem === false && base.flagOff === false, 'blocked by merged memory / by condition');
ok(base.on === true && base.drawsOn === 1, 'conditional start draws once (its own run time) ' + base.drawsOn);
ok(base.kst === 0, 'allowsContinuation=false stops on first tick');
ok(base.cst === 1, 'no time limit: still RUNNING far past endTime');
ok(base.keep === true, 'allowsContinuation=true delegates shouldKeepRunning, and has no time limit');
if (fails) { console.log(fails + ' failures'); process.exit(1); }

const breaks = [
  ["if (this.order === B.ORDER_SHUFFLED) this.tasks.shuffle();", ""],
  ["Math.fround(1 / en.weight)", "1"],
  ["if (ok && this.runMode === B.RUN_ONE) break;", ""],
  ["return a.order < b.order ? -1 : a.order > b.order ? 1 : 0;", "return a.order > b.order ? -1 : a.order < b.order ? 1 : 0;"],
  ["Task.call(this, merge(req, delegate.required));", "Task.call(this, req);"],
  ["return this.allowsContinuation && !!this.condition(e) &&", "return !!this.condition(e) &&"],
  ["ConditionalTask.prototype.isTimeLimitExceeded = function () { return false; };", ""],
];
let caught = 0;
for (const b of breaks) {
  let r; try { r = scenario(b); } catch (e) { console.log('edit error: ' + e.message); continue; }
  if (j(r) !== j(base)) { caught++; console.log('   ✓ caught: ' + b[0].slice(0, 50)); } else console.log('NOT caught: ' + b[0].slice(0, 50));
}
console.log('braintaskscheck: 10 assertions, 0 failures, ' + caught + ' breaks caught');
process.exit(caught === breaks.length ? 0 : 1);
