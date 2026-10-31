#!/usr/bin/env node
// lockstepgoldenapplecheck -- #9265: engine side of the 'goldenapple' lane, 20 salts: weakness + golden apple on a NoAI zombie villager.
// Asserts the vanilla rule (.decomp interactMob/tick): Weakness consumed, Strength amp 0 for the timer, timer = 3600 + nextInt(2401), -1/tick;
// the 'entities' ENTX rows go through compareTraces. Anti-vacuity: each broken engine rule must diverge. Server comparison = the pilot (owed, see the issue).
import { engineGoldenAppleTrace, GOLDEN_FIELDS } from './referee/lockstep/goldenapplelane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { harnessM } from './referee/lockstep/zombielane.mjs';
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const FEED = 10, SALTS = Array.from({ length: 20 }, (_, i) => i);
const run = (s) => engineGoldenAppleTrace(s, FEED);
const base = SALTS.map(run);
base.forEach((R, i) => {
  const ent = (t) => R[t].entities[0], conv0 = ent(FEED - 1)[2];
  ok(ent(0)[3].length === 1 && ent(0)[3][0][0] === 18, `salt ${i}: starts with Weakness`);
  ok(ent(FEED - 2)[2] === -1, `salt ${i}: not converting before the apple`);
  ok(conv0 >= 3600 && conv0 <= 6000, `salt ${i}: timer ${conv0} outside 3600..6000`);
  ok(JSON.stringify(ent(FEED - 1)[3]) === JSON.stringify([[5, 0, conv0]]), `salt ${i}: Strength 0 for the timer, Weakness gone`);
  ok(ent(159)[2] === conv0 - (159 - (FEED - 1)), `salt ${i}: timer counts down 1/tick`);
});
ok(new Set(base.map((R) => R[FEED - 1].entities[0][2])).size > 5, 'timers vary per salt');
ok(compareTraces(base[0], run(0), { fields: GOLDEN_FIELDS }) === null, 'same salt, same trace');
const Zv = harnessM().ZVillager, keep = { min: Zv.CURE_TIMER_MIN, wk: Zv.WEAKNESS_EFFECT, tc: Zv.tickConversion };
const broken = (patch) => { patch(); try { return run(0); } finally { Zv.CURE_TIMER_MIN = keep.min; Zv.WEAKNESS_EFFECT = keep.wk; Zv.tickConversion = keep.tc; } };
caught(compareTraces(base[0], broken(() => { Zv.CURE_TIMER_MIN = 3000; }), { fields: GOLDEN_FIELDS })?.field === 'entities', 'cure timer base');
caught(compareTraces(base[0], broken(() => { Zv.WEAKNESS_EFFECT = 'slowness'; }), { fields: GOLDEN_FIELDS })?.field === 'entities', 'weakness not required');
caught(compareTraces(base[0], broken(() => { Zv.tickConversion = (e) => { e.conversionTimer -= 2; return false; }; }), { fields: GOLDEN_FIELDS })?.field === 'entities', 'countdown rate 2');
caught(compareTraces(base[0], engineGoldenAppleTrace(0, FEED + 1), { fields: GOLDEN_FIELDS })?.field === 'entities', 'apple one tick late');
console.log(`${SALTS.length * 5 + 2} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad || breaks !== 4 ? 1 : 0);
