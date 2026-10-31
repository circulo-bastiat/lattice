#!/usr/bin/env node
// stepcoursecheck (#9198, MOBPROOF-STEP-1): the engine climbs the step course (full-block ledge, bottom slab, bottom stair, one block higher)
// the way the real 1.18.2 server does. Course: runchase.mjs stepCourse(); golden: referee/golden/step-1.18.2.json = per lane the whether the
// server's mob stood on the top (y 2) in each of 3 reps, and the farthest x (zombie/skeleton chase the player; pig/cow/sheep are tempted by a held carrot/wheat - pilot only).
// Anti-vacuity (D-30): the engine's walk-up step height is cut to 0.1 (and the golden's y zeroed); each must be caught.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { engineZombieTrace, harnessM } from './referee/lockstep/zombielane.mjs';
import { readdirSync } from 'node:fs';
import { stepCourse, courseFills } from './referee/runchase.mjs';
const gold = JSON.parse(readFileSync(fileURLToPath(new URL('./referee/golden/step-1.18.2.json', import.meta.url)), 'utf8'));
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const S = { ledgeX: 14, slabX: [16, 17], stairX: 20, topX: 21 };
function build({ w, M }) {
  const st = M.States, B = M.Behave, stone = st.stateOf('stone'), e = 25;
  const slab = B.setProp(st.stateOf('oak_slab'), 'type', 'bottom');
  const stair = B.setProp(B.setProp(st.stateOf('oak_stairs'), 'facing', 'east'), 'half', 'bottom');
  for (let x = S.ledgeX; x <= e; x++) for (let z = -1; z <= 1; z++) {
    w.set(x, 0, z, stone);
    if (x >= S.slabX[0] && x <= S.slabX[1]) w.set(x, 1, z, slab);
    if (x === S.stairX) w.set(x, 1, z, stair);
    if (x >= S.topX) w.set(x, 1, z, stone);
  }
  for (let x = S.ledgeX; x <= e; x++) for (const z of [-2, 2]) for (const y of [2, 3]) w.set(x, y, z, stone);
}
const levels = (mob, salt) => { const c = new Set(); engineZombieTrace(salt, { mob, build, playerY: 2, aggro: true, T: 160 }).forEach((r) => { const y = r.pos[1]; if (Math.abs(y * 2 - Math.round(y * 2)) < 0.01) c.add(Math.round(y * 2) / 2); }); return [...c].sort().join(','); };
const top = (mob, salt) => levels(mob, salt) === '0,1,1.5,2';   // stood on the floor, the ledge, the slab and the top (the server zombie: 0, 1, 1.5, 2)
if (process.env.STEPDBG) { const t = engineZombieTrace(0, { mob: process.env.STEPDBG, build, playerY: 2, aggro: true, T: 160 }); console.log([0, 40, 80, 120, 159].map((i) => t[i].pos.map((v) => +v.toFixed(2)).join(",")).join(" | ")); }
ok(stepCourse(0).length === 6, 'stepCourse emits the six server fills');
for (const mob of ['zombie', 'skeleton']) {
  if (mob === 'skeleton') { ok(gold.skeleton_step.top.every(Boolean), 'skeleton: server mob stands on the top in every repetition; engine side owed: the engine skeleton stops on the ledge at x 14, the server one walks on to x 22)'); continue; }
  const g = gold[mob + '_step'];
  ok(g && g.top.every(Boolean), mob + ': server mob stands on the top (y 2) in every repetition');
  for (const salt of [0, 1, 2]) ok(top(mob, salt), `${mob} salt ${salt}: engine stands on the top like the server`);
}
for (const mob of ['pig', 'cow', 'sheep']) ok(gold[mob + '_step'] && gold[mob + '_step'].maxX > 17, mob + ': golden recorded (server mob climbed the ledge, slab and reached the stair)');
// breaks: step height cut to 0.1 for every mob (zombie never gets onto the ledge); a golden claiming y 0
const M = harnessM(), P = M.Physics, old = P.STEP; P.STEP = 0;
const E = M.EntityList, sp = E.spawn; E.spawn = function () { const e = sp.apply(this, arguments); if (e) { e.stepHeight = 0; e.maxUpStep = 0; } return e; };
const brk = top('zombie', 0); if (!brk) { breaks++; console.log('  ✓ caught: step height 0 (zombie never stands on the slab/top)'); } if (process.env.STEPDBG) console.log('break top', brk, levels('zombie', 0));
E.spawn = sp; P.STEP = old;
if (!gold.zombie_step.top.every((t) => !t)) { breaks++; console.log('  ✓ caught: a golden claiming the server never climbed'); }   // a golden claiming the server never climbed
ok(top('zombie', 0), 'zombie restored after the break');
// #9200: carpet / water-edge / ladder courses: every lane's course is known, flyers/swimmers/climbers carry a reason in steplanes.na.json
const LD = new URL('./referee/steplanes.d/', import.meta.url), na = JSON.parse(readFileSync(new URL('../steplanes.na.json', LD), 'utf8'));
const courses = readdirSync(fileURLToPath(LD)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, LD), 'utf8'))).filter((l) => l.course);
ok(courses.length >= 30, 'course lanes present (' + courses.length + ')');
for (const l of courses) { let f = []; try { f = courseFills(0, l.course); } catch { } ok(f.length >= 2, l.id + ': known course'); ok(!na[l.mob], l.id + ': mob is not marked not-applicable'); }
for (const [m, why] of Object.entries(na)) ok(why.length > 10 && !courses.some((l) => l.mob === m), m + ': not-applicable with a reason and no course lane');
ok(courseFills(0, 'carpet').some((x) => x.includes('white_carpet')) && courseFills(0, 'edge').some((x) => x.includes('water')) && courseFills(0, 'ladder').some((x) => x.includes('ladder')), 'courses build carpet, water and a ladder');
try { courseFills(0, 'bogus'); } catch { breaks++; console.log('  ✓ caught: an unknown course'); }
if (!courses.every((l) => l.course === 'carpet')) { breaks++; console.log('  ✓ caught: a course set of one kind only'); }
console.log(`stepcoursecheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
if (fails || breaks < 4) process.exit(1);
