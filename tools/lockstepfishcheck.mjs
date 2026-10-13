#!/usr/bin/env node
// lockstepfishcheck.mjs -- #6404 (G17-L74): lockstep scenario 'fishing': a scripted player casts at tick 5 over a 5x5 pond, the bobber waits for a bite,
// and reels in inside the hook window (3 ticks after the bite). 20 seeds (seed = JRandom seed, Lure 0..3, rain/covered variants). Per tick compared:
// wait / travel / hook countdowns, caught flag, fish angle (bobber state; the bite tick is the first tick caughtFish is set), then at the reel: loot
// category (junk/treasure/fish, weights 10/5/85 with luck 4/11/82 at Luck of the Sea 3 from the 1.18.2 gameplay/fishing pool order) and the orb range.
// The oracle is an independent transcription of FishingBobberEntity.tickFishingLogic (.decomp FishingBobberEntity.java:281-380), drawing from a JRandom
// of the same seed. The 'cast' is the engine's Fi.velocity at tick 5 (cast tick shifts every row) - the pond is open water, so every probe is water.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8')), b64 = (f) => readFileSync(join(A, f)).toString('base64');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07e_loot.js', '07zzq_fishing.js'], dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const Fi = M.Fishing, JR = M.JRandom, IT = M.Items;
const F = Math.fround, SEEDS = 20, CAST = 5, TICKS = 1500;
const mf = (r, a, b) => a >= b ? a : F(F(r.nextFloat() * F(b - a)) + a);
const mi = (r, a, b) => a >= b ? a : r.nextInt(b - a + 1) + a;
const scen = (seed) => ({ lure: seed % 4, rain: seed % 3 === 0, sky: seed % 5 !== 0, luck: seed % 2 ? 3 : 0, rs: seed * 7919 + 13 });
const FISH = new Set(['cod', 'salmon', 'tropical_fish', 'pufferfish']);
const TREAS = new Set(['name_tag', 'saddle', 'bow', 'enchanted_book', 'book', 'nautilus_shell']);
const row = (s) => [s.w, s.t, s.h, s.fish ? 1 : 0, s.ang].join(',');

function engine(seed) {
  const sc = scen(seed), r = new JR(sc.rs), rows = [];
  const e = { x: 0.5, y: 64, z: 0.5, random: r, waitCountdown: 0, fishTravelCountdown: 0, hookCountdown: 0, fishAngle: 0, caughtFish: false, lureLevel: sc.lure, width: 0.25 };
  const env = { hasRain: () => sc.rain, skyVisible: () => sc.sky, isWater: () => true };
  let reelAt = -1, loot = null;
  for (let t = 0; t < TICKS && !loot; t++) {
    if (t >= CAST) Fi.tickFishingLogic(e, env, 0, 63, 0);
    rows.push(row({ w: e.waitCountdown, t: e.fishTravelCountdown, h: e.hookCountdown, fish: e.caughtFish, ang: e.fishAngle }));
    if (e.caughtFish && reelAt < 0) reelAt = t + 3;
    if (t === reelAt) loot = reel(e, sc, r);
  }
  return { rows, loot };
}
function reel(e, sc, r) {
  const P = { x: 3, y: 65, z: 4, luck: 0 }, drops = [], orbs = [];
  M.EntityList = { ready: true, dropStack: (x, y, z, id, n) => { drops.push(IT.nameOf(id)); return {}; }, spawn: (t) => { const o = { t }; orbs.push(o); return o; }, remove() {} };
  e.luckOfTheSeaLevel = sc.luck; e.openWater = true;
  const dmg = Fi.reel(e, P, { i: IT.of('fishing_rod'), d: 0 });
  const n = drops[0], cat = FISH.has(n) ? 'fish' : TREAS.has(n) || n === 'fishing_rod' ? 'treasure/rod' : 'junk';
  return { dmg, cat: cat === 'treasure/rod' ? 'tr' : cat, orbOk: orbs.every((o) => o.value >= 1 && o.value <= 6) };
}
// ---- independent oracle (faults: opts.noLure, opts.swapRain, opts.junkW) ----
function oracle(seed, o = {}) {
  const sc = scen(seed), r = new JR(sc.rs), rows = [];
  const s = { w: 0, t: 0, h: 0, fish: false, ang: 0 }, lure = o.noLure ? 0 : sc.lure;
  let reelAt = -1, loot = null;
  for (let tick = 0; tick < TICKS && !loot; tick++) {
    if (tick >= CAST) {
      let n = 1;
      const a = () => r.nextFloat() < 0.25 && sc.rain, b = () => r.nextFloat() < 0.5 && !sc.sky;
      if (o.swapRain) { if (b()) n--; if (a()) n++; } else { if (a()) n++; if (b()) n--; }
      if (s.h > 0) { if (--s.h <= 0) { s.w = 0; s.t = 0; s.fish = false; } }
      else if (s.t > 0) {
        s.t -= n;
        if (s.t > 0) { s.ang = F(s.ang + F(r.nextGaussian() * 4.0)); r.nextFloat(); }
        else { r.nextFloat(); r.nextFloat(); s.h = mi(r, 20, 40); s.fish = true; }
      } else if (s.w > 0) {
        s.w -= n;
        let p = F(0.15);
        if (s.w < 20) p = F(p + F(F(20 - s.w) * F(0.05))); else if (s.w < 40) p = F(p + F(F(40 - s.w) * F(0.02))); else if (s.w < 60) p = F(p + F(F(60 - s.w) * F(0.01)));
        if (r.nextFloat() < p) { mf(r, 0, 360); mf(r, 25, 60); r.nextInt(2); }
        if (s.w <= 0) { s.ang = mf(r, 0, 360); s.t = mi(r, 20, 80); }
      } else s.w = mi(r, 100, 600) - lure * 20 * 5;
    }
    rows.push(row(s));
    if (s.fish && reelAt < 0) reelAt = tick + 3;
    if (tick === reelAt) {
      const w = sc.luck ? [10 - 2 * sc.luck, 5 + 2 * sc.luck, 85 - sc.luck] : [10, 5, 85];
      if (o.junkW) w[0] += 6;
      let k = r.nextInt(w[0] + w[1] + w[2]);
      loot = { dmg: 1, cat: k < w[0] ? 'junk' : k < w[0] + w[1] ? 'tr' : 'fish', orbOk: true };
    }
  }
  return { rows, loot };
}
function run(o) {
  let bad = 0, first = '';
  for (let seed = 1; seed <= SEEDS; seed++) {
    const a = engine(seed), b = oracle(seed, o);
    const note = (m) => { bad++; if (!first) first = `seed ${seed}: ${m}`; };
    const n = Math.max(a.rows.length, b.rows.length);
    for (let i = 0; i < n; i++) if (a.rows[i] !== b.rows[i]) { note(`tick ${i} engine [${a.rows[i]}] oracle [${b.rows[i]}] (wait,travel,hook,caught,angle)`); break; }
    if (!a.loot || !b.loot) note('no bite/reel');
    else if (a.loot.cat !== b.loot.cat || a.loot.dmg !== b.loot.dmg || !a.loot.orbOk) note(`reel engine ${JSON.stringify(a.loot)} oracle ${JSON.stringify(b.loot)}`);
  }
  return { bad, first };
}
let fails = 0, breaks = 0; const notes = [];
const base = run({});
if (base.bad) { fails++; console.log(`  FAIL ${base.bad} divergences; first: ${base.first}`); }
{ const bite = [1, 2, 3, 4].map((s) => engine(s).rows.length); if (bite.some((n) => n < 30 || n >= TICKS)) { fails++; console.log('  FAIL vacuous: no bite'); } }
for (const [name, o] of [['Lure ignored', { noLure: 1 }], ['wait roll order', { swapRain: 1 }], ['loot weight', { junkW: 1 }]]) {
  const d = run(o);
  if (d.bad) { breaks++; notes.push(`   ✓ ${name} caught: ${d.first}`); } else { fails++; console.log(`  FAIL ${name} not caught`); }
}
console.log(`${3 - fails + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${SEEDS} seeds, ${base.bad} divergences)`);
notes.forEach((n) => console.log(n));
process.exit(fails ? 1 : 0);
