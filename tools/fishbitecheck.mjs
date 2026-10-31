#!/usr/bin/env node
// fishbitecheck.mjs — G17-F3: FishingBobberEntity.tickFishingLogic (07zzq_fishing.js). 50 seeded bobbers
// (open / covered / rain x Lure 0-3) are stepped to the bite and compared tick by tick with a straight
// transcription of FishingBobberEntity.java:281-380 driven by a JRandom of the same seed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
console.log('fishbitecheck — G17-F3: fishing bite timer');
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07zzq_fishing.js'], dom: false });
const Fi = MCL.Fishing, JR = MCL.JRandom;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const F = Math.fround;
const mfn = (r, a, b) => a >= b ? a : F(F(r.nextFloat() * F(b - a)) + a);
const min_ = (r, a, b) => a >= b ? a : r.nextInt(b - a + 1) + a;

// the Java, verbatim in order. s = {w,t,h,ang,lure,fish}; returns draws are on r.
function ref(s, r, rain, sky) {
  let n = 1;
  if (r.nextFloat() < 0.25 && rain) n++;
  if (r.nextFloat() < 0.5 && !sky) n--;
  if (s.h > 0) { s.h--; if (s.h <= 0) { s.w = 0; s.t = 0; s.fish = false; } }
  else if (s.t > 0) {
    s.t -= n;
    if (s.t > 0) {
      s.ang = F(s.ang + F(r.nextGaussian() * 4.0));
      r.nextFloat(); // water at the particle spot: always water here -> the 0.15 particle draw
    } else {
      r.nextFloat(); r.nextFloat();
      s.h = min_(r, 20, 40); s.fish = true;
    }
  } else if (s.w > 0) {
    s.w -= n;
    let p = F(0.15);
    if (s.w < 20) p = F(p + F(F(20 - s.w) * F(0.05)));
    else if (s.w < 40) p = F(p + F(F(40 - s.w) * F(0.02)));
    else if (s.w < 60) p = F(p + F(F(60 - s.w) * F(0.01)));
    if (r.nextFloat() < p) { mfn(r, 0, 360); mfn(r, 25, 60); r.nextInt(2); }
    if (s.w <= 0) { s.ang = mfn(r, 0, 360); s.t = min_(r, 20, 80); }
  } else s.w = min_(r, 100, 600) - s.lure * 20 * 5;
}
const SCEN = [['open', false, true], ['covered', false, false], ['rain', true, true]];
function run() {
  const bad = []; let bites = 0;
  for (let i = 0; i < 50; i++) {
    const [nm, rain, sky] = SCEN[i % 3], lure = i % 4, seed = 1000 + i * 77;
    const e = { x: 0.5, y: 63.5, z: 0.5, random: new JR(seed), lureLevel: lure, hookCountdown: 0, waitCountdown: 0, fishTravelCountdown: 0, fishAngle: 0, caughtFish: false };
    const rr = new JR(seed), s = { w: 0, t: 0, h: 0, ang: 0, lure, fish: false };
    const env = { hasRain: () => rain, skyVisible: () => sky, isWater: () => true, particle() {}, sound() {} };
    let bite = -1, rbite = -1;
    for (let t = 0; t < 4000 && (bite < 0 || rbite < 0); t++) {
      Fi.tickFishingLogic(e, env, 0, 63, 0); ref(s, rr, rain, sky);
      if (bite < 0 && e.caughtFish) bite = t;
      if (rbite < 0 && s.fish) rbite = t;
      if (e.waitCountdown !== s.w || e.fishTravelCountdown !== s.t || e.hookCountdown !== s.h) { bad.push(nm + i + '@' + t); break; }
    }
    if (bite !== rbite || bite < 0) bad.push('bite ' + nm + i + ' ' + bite + '/' + rbite); else bites++;
  }
  return bad;
}
const bad0 = run(); ok(bad0.length === 0, 'baseline: ' + bad0.slice(0, 4).join(','));
let caught = 0;
const faults = {
  'Lure sign': () => { const o = Fi.tickFishingLogic; Fi.tickFishingLogic = (e, ...a) => { e.lureLevel = -e.lureLevel; o(e, ...a); e.lureLevel = -e.lureLevel; }; return () => { Fi.tickFishingLogic = o; }; },
  'rain factor': () => { const o = Fi.tickFishingLogic; Fi.tickFishingLogic = (e, env, ...a) => o(e, Object.assign({}, env, { hasRain: () => false }), ...a); return () => { Fi.tickFishingLogic = o; }; },
  'draw order': () => { const o = Fi.tickFishingLogic; Fi.tickFishingLogic = (e, env, ...a) => { const q = e.random; e.random = { nextFloat: () => q.nextFloat(), nextInt: (b) => q.nextInt(b), nextGaussian: () => q.nextGaussian() }; const f = e.random.nextFloat; let k = 0; e.random.nextFloat = () => (k++ < 1 ? (q.nextFloat(), q.nextFloat()) : q.nextFloat()); o(e, env, ...a); e.random = q; }; return () => { Fi.tickFishingLogic = o; }; },
};
for (const [nm, inject] of Object.entries(faults)) {
  const undo = inject(); const b = run(); undo();
  if (b.length) { caught++; console.log('  ✓ fault caught: ' + nm); } else fails.push('fault not caught: ' + nm);
}
ok(caught === 3, 'faults');
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `OK  ${pass} checks passed, 0 failures; 50 bobbers bite on the Java tick; ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
