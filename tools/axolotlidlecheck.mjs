#!/usr/bin/env node
// axolotlidlecheck.mjs -- #9268: src/07zzze_axolotlidle.js (AxolotlBrain IDLE priority 4 on the Brain substrate) vs
// .decomp AxolotlBrain.addIdleActivities / GoTowardsLookTarget / CompositeTask. Expected nextInt bounds and WALK_TARGET
// results are derived by hand from the decompiled classes. '<n> breaks caught'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
console.log('axolotlidlecheck -- #9268, AxolotlBrain idle wander composite');
function scenario(edit) {
  const NS = {}; globalThis.MCL = NS;
  const load = (f, ed) => { let s = readFileSync(join(ROOT, 'src', f), 'utf8');
    if (ed) { if (!s.includes(ed[0])) throw new Error('edit target missing: ' + ed[0]); s = s.replace(ed[0], ed[1]); }
    new Function('MCL', s)(NS); };
  load('07zzzb_brain.js'); load('07zzzc_braintasks.js'); load('07zzze_axolotlidle.js', edit);
  const B = NS.Brain, out = [];
  const run = (o) => {
    const draws = [], world = { time: 100, random: { nextInt: (n) => { draws.push(n); return 0; } } };
    const e = Object.assign({ x: 0, y: 64, z: 0, water: false, ground: true, fz: null, lq: [], look: null, lookWater: false,
      isInWaterOrBubble() { return this.water; }, isOnGround() { return this.ground; },
      fuzzyFind() { return this.fz; }, lookFind() { const q = this.lq.shift(); return q === undefined ? null : q; },
      fluidEmptyAt(p) { return !!p.dry; }, lookTargetIsWater() { return this.lookWater; } }, o);
    e.brain = NS.AxolotlIdle.makeBrain({ nextFloat: () => 0.5 });
    if (e.look) e.brain.remember(B.LOOK_TARGET, e.look);
    e.brain.tick(world, e);
    const wt = e.brain.memories.get(B.WALK_TARGET);
    return JSON.stringify({ draws, wt: wt ? [wt.value.speed, wt.value.completionRange] : null });
  };
  out.push(run({ water: true, ground: false, lq: [{ x: 3, y: 64, z: 0, dry: true }, ] }));   // aquatic ladder returns null
  out.push(run({ water: true, ground: false, lq: [{ x: 3, y: 64, z: 0 }, { x: 4, y: 64, z: 0, dry: true }] }));
  out.push(run({ fz: { x: 5, y: 64, z: 5 } }));
  out.push(run({}));
  out.push(run({ look: { x: 1, y: 64, z: 1 } }));
  out.push(run({ look: { x: 1, y: 64, z: 1 }, lookWater: true }));
  out.push(run({ water: true, ground: false, look: { x: 1, y: 64, z: 1 }, lookWater: true }));
  return out;
}
const j = JSON.stringify, base = scenario();
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
// ConditionalTask extends Task with the DEFAULT 60-tick run time (its delegate's WaitTask(30,60) only supplies shouldRun/run),
// so every wait start draws nextInt(1), not nextInt(31)/nextInt(201).
// Hand-derived: composite tryStarting nextInt(60+1-60)=1; each started child draws its own bound; RUN_ALL tries every
// STOPPED child in list order; later children re-check WALK_TARGET absent after earlier children wrote it.
const exp = [
  // water, aquatic ladder first sample dry -> prev null -> forget walk target; aquatic ran (draw 1); stroll gated off by
  // strollInsideWater=false; goTowards needs LOOK_TARGET (absent); wait30-60 in water draws 31
  { draws: [1, 1, 1], wt: null },
  // water, 1st wet then 2nd (multiplier 3,3 extrapolated) is "dry"? fluidEmptyAt reads .dry only on literal points: lq[1] unused -> ladder continues all wet
  { draws: [1, 1, 1], wt: [0.5, 0] },
  // land onGround: aquatic off; stroll(0.15,false) runs (1), writes walk target; goTowards blocked; ground wait 201
  { draws: [1, 1, 1], wt: [0.15, 0] },
  // land, fuzzy null: stroll forgets target; no look target; ground wait
  { draws: [1, 1, 1], wt: null },
  // land, look target on land: stroll(null) forgets; goTowards runs speed 0.15 range 3 (draw 1); ground wait 201
  { draws: [1, 1, 1, 1], wt: [0.15, 3] },
  // land, look target in water: predicate false -> no goTowards
  { draws: [1, 1, 1], wt: null },
  // water, look target water: aquatic forgets (no lq); stroll off; goTowards runs at tempted speed 0.5; wait 31
  { draws: [1, 1, 1, 1], wt: [0.5, 3] },
];
exp.forEach((x, i) => ok(base[i] === j(x), 'scenario ' + i + ' got ' + base[i] + ' want ' + j(x)));
const breaks = [
  [['function (e) { return e.isInWaterOrBubble(); }, new B.WaitTask', 'function (e) { return !e.isInWaterOrBubble(); }, new B.WaitTask'], 'water wait gate'],
  [['B.ORDER_ORDERED, B.RUN_ALL', 'B.ORDER_ORDERED, B.RUN_ONE'], 'run mode'],
  [['new B.StrollTask(0.15, 10, 7, false)', 'new B.StrollTask(0.15, 10, 7, true)'], 'stroll water gate'],
  [['AI.temptedSpeed, 3)', 'AI.temptedSpeed, 2)'], 'completion range'],
  [['function (e) { return e.isOnGround(); }', 'function (e) { return !e.isOnGround(); }'], 'ground wait gate'],
  [['e.isInWaterOrBubble() ? 0.5 : 0.15', 'e.isInWaterOrBubble() ? 0.6 : 0.15'], 'tempted speed'],
];
let caught = 0;
for (const [ed, name] of breaks) { const r = scenario(ed); if (j(r) !== j(base)) { caught++; console.log('   ✓ caught: ' + name); } else { fails++; console.log('FAIL break not caught: ' + name); } }
console.log('axolotlidlecheck: ' + exp.length + ' assertions, ' + fails + ' failures, ' + caught + ' breaks caught');
process.exit(fails ? 1 : 0);
