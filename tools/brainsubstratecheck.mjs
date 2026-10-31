#!/usr/bin/env node
// brainsubstratecheck.mjs -- #9267: Brain/Task/WaitTask run order and RNG consumption equal Brain.java/Task.java.
// Expected values are hand-derived from the decompiled algorithm (Java LCG nextInt). Anti-vacuity: '<n> breaks caught'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
console.log('brainsubstratecheck -- #9267, Brain task substrate');

function javaRandom(seed) {
  let s = (BigInt(seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n);
  const next = (bits) => { s = (s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(BigInt.asIntN(32, s >> BigInt(48 - bits))); };
  return { draws: 0, nextInt(b) {
    this.draws++;
    if ((b & -b) === b) return Number((BigInt(b) * BigInt(next(31))) >> 31n);
    let bits, val; do { bits = next(31); val = bits % b; } while (bits - val + (b - 1) < 0);
    return val;
  } };
}

function scenario(edit) {
  const NS = {}; globalThis.MCL = NS;
  let s = readFileSync(join(ROOT, 'src/07zzzb_brain.js'), 'utf8');
  if (edit) { if (!s.includes(edit[0])) throw new Error('edit target missing: ' + edit[0]); s = s.replace(edit[0], edit[1]); }
  new Function('MCL', s)(NS);
  const B = NS.Brain, log = [];
  const world = { time: 100, random: javaRandom(42) };
  const e = { brain: new B.Brain() };
  class T extends B.Task { constructor(n, min, max, req) { super(req, min, max); this.n = n; }
    run() { log.push('run ' + this.n); } shouldKeepRunning() { return true; } finishRunning() { log.push('end ' + this.n); } }
  const w = new B.WaitTask(10, 20), a = new T('a', 5, 5), c = new T('c', 3, 9, { mem: B.VALUE_PRESENT });
  e.brain.registerMemory('mem');
  e.brain.setCoreActivities(['core']);
  e.brain.setTaskList('core', 1, [a, w]);          // priorities 1, 2
  e.brain.setTaskList('work', 0, [c]);             // priority 0, needs mem
  e.brain.resetPossibleActivities('work');
  e.brain.tick(world, e);                           // c blocked (mem absent); a, w start
  e.brain.remember('mem', 1, 2);
  world.time = 101; e.brain.tick(world, e);         // c starts (priority 0 first)
  world.time = 150; e.brain.tick(world, e);         // everything past its end time -> stop
  return { log, draws: world.random.draws, status: [a.status, w.status, c.status], ends: [a.endTime, w.endTime, c.endTime],
    mem: e.brain.hasMemory('mem'), act: e.brain.getPossibleActivities().slice() };
}

// Draw order from the algorithm: bound 1 (a, priority 1), 11 (w, priority 2) at t=100, then 7 (c, priority 0) at t=101.
// Stop order at t=150 is priority order: c, a (w never logs).
const base = scenario();
const ref = javaRandom(42); const d1 = ref.nextInt(1), d2 = ref.nextInt(11), d3 = ref.nextInt(7);
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
const j = (x) => JSON.stringify(x);
ok(base.draws === 3, 'three draws, got ' + base.draws);
ok(j(base.ends) === j([105 + d1, 110 + d2, 101 + 3 + d3]), 'end times ' + j(base.ends) + ' vs ' + j([105 + d1, 110 + d2, 104 + d3]));
ok(j(base.log) === j(['run a', 'run c', 'end c', 'end a']), 'log ' + j(base.log));
ok(j(base.status) === j([0, 0, 0]), 'all stopped at t=150');
ok(base.mem === false, 'memory expired after ttl 2? (tick at 101 -> 1, tick at 150 -> 0 -> forgotten)');
ok(j(base.act) === j(['core', 'work']), 'activities');
if (fails) console.log(fails + ' failures');
if (fails) process.exit(1);

const breaks = [
  ['this.endTime = t + this.minRunTime + world.random.nextInt(this.maxRunTime + 1 - this.minRunTime)', 'this.endTime = t + this.minRunTime'],
  ['world.random.nextInt(this.maxRunTime + 1 - this.minRunTime)', 'world.random.nextInt(this.maxRunTime - this.minRunTime || 1)'],
  ['pr = Array.from(this.tasks.keys()).sort(function (a, b) { return a - b; });\n    for (var i = 0; i < pr.length; i++) {\n      var self', 'pr = Array.from(this.tasks.keys()).sort(function (a, b) { return b - a; });\n    for (var i = 0; i < pr.length; i++) {\n      var self'],
];
breaks.push(['WaitTask.prototype.shouldKeepRunning = function () { return true; }', 'WaitTask.prototype.shouldKeepRunning = function () { return false; }']);
let caught = 0;
for (const b of breaks) {
  let r; try { r = scenario(b); } catch (e) { console.log('edit error: ' + e.message); continue; }
  if (j(r) !== j(base)) { caught++; console.log('   ✓ caught: ' + b[0].slice(0, 40)); } else console.log('NOT caught: ' + b[0].slice(0, 50));
}
console.log('brainsubstratecheck: 6 assertions, 0 failures, ' + caught + ' breaks caught');
process.exit(caught === breaks.length ? 0 : 1);
