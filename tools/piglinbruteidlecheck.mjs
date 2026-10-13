#!/usr/bin/env node
// piglinbruteidlecheck.mjs — #6446: piglin_brute idle is RandomTask (CompositeTask.run: WeightedList.shuffle with key
// -r^(1/weight), first child whose tryStarting passes), re-rolled every tick it is idle; no stroll-chance gate.
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['07zzp_mobvoice.js', '07zzf_piglin.js'], dom: false });
const Pg = M.Piglin || M.Pg;
const W = { stroll: 2, piglin: 2, piglin_brute: 2, home: 2, near: 2, wait: 1 };
const order = ['stroll', 'piglin', 'piglin_brute', 'home', 'near', 'wait'];
const lcg = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
// golden: javap'd cadence, written independently of Pg
function golden(rand, avail) {
  const k = order.map((n) => [n, -Math.pow(rand(), 1 / W[n])]);
  k.sort((a, b) => a[1] - b[1]);
  for (const [n] of k) if (avail[n]) return n;
  return null;
}
// the old behaviour: a stroll-chance roll gates one weighted pick
function oldPick(rand, avail) {
  if (rand() >= 0.0083) return null;
  const o = order.filter((n) => avail[n]); let t = 0; for (const n of o) t += W[n];
  let r = rand() * t; for (const n of o) { r -= W[n]; if (r < 0) return n; } return o[0];
}
const seqs = (fn, seed) => {
  const ra = lcg(seed), av = lcg(seed ^ 0x9e37); const out = [];
  for (let t = 0; t < 2000; t++) {
    const avail = { stroll: true, wait: true, home: av() < 0.7, near: av() < 0.3, piglin: av() < 0.5, piglin_brute: av() < 0.5 };
    out.push(fn(ra, avail));
  }
  return out.join(',');
};
for (const seed of [1, 2, 3, 4, 5]) {
  ok(seqs(Pg.bruteIdlePick, seed) === seqs(golden, seed), 'seed ' + seed + ' sequence matches golden');
  if (seqs(oldPick, seed) !== seqs(golden, seed)) breaks++; else fails.push('anti-vacuity: old cadence matched, seed ' + seed);
}
const s = seqs(Pg.bruteIdlePick, 1).split(',');
ok(s.filter((x) => x === 'null').length === 0, 'every idle tick picks a task (no stroll-chance gate)');
const cnt = {}; s.forEach((x) => cnt[x] = (cnt[x] || 0) + 1);
ok(cnt.wait < cnt.stroll, 'weight 1 wait picked less than weight 2 stroll');
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('piglinbruteidlecheck: ' + pass + ' passed, 0 failed (' + breaks + ' breaks caught)');
