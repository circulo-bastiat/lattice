#!/usr/bin/env node
// brainstrollcheck.mjs -- #9437: StrollTask / AquaticStrollTask (src/07zzzc_braintasks.js) vs .decomp StrollTask.java,
// AquaticStrollTask.java. Expected values are computed here from the decompiled algorithm. '<n> breaks caught'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
console.log('brainstrollcheck -- #9437, StrollTask / AquaticStrollTask');
function scenario(edit) {
  const NS = {}; globalThis.MCL = NS;
  const load = (f, ed) => { let s = readFileSync(join(ROOT, 'src', f), 'utf8');
    if (ed) { if (!s.includes(ed[0])) throw new Error('edit target missing: ' + ed[0]); s = s.replace(ed[0], ed[1]); }
    new Function('MCL', s)(NS); };
  load('07zzzb_brain.js'); load('07zzzc_braintasks.js', edit);
  const B = NS.Brain, out = {};
  const calls = [];
  const mk = (o) => { const e = Object.assign({ brain: new B.Brain(), x: 10, y: 64, z: -4, water: true, calls,
    fuzzyFind(h, v) { calls.push('F' + h + ',' + v); return this.fz || null; },
    lookFind(h, v) { calls.push('L' + h + ',' + v); const q = this.lq.shift(); return q === undefined ? null : q; },
    fluidEmptyAt(p) { return !this.allWet && (!!p.dry || p.x >= 15); }, isInWaterOrBubble() { return this.water; } }, o);
    e.brain.registerMemory(B.WALK_TARGET); return e; };
  const world = { random: { nextInt: () => 0 } };
  // StrollTask
  let t = new B.StrollTask(0.6), e = mk({ fz: { x: 1, y: 2, z: 3 } });
  out.defaults = [t.horizontalRadius, t.verticalRadius, t.strollInsideWater, JSON.stringify(t.required)];
  out.started = t.tryStarting(world, e, 0); out.wt = JSON.stringify(e.brain.memories.get(B.WALK_TARGET)); out.calls = calls.splice(0);
  e.brain.remember(B.WALK_TARGET, 1); out.blocked = t.tryStarting(world, e, 0);
  e = mk({ fz: null }); e.brain.remember(B.WALK_TARGET, 1); t.run(world, e, 0);
  out.emptyForgets = e.brain.memories.get(B.WALK_TARGET) === null;
  out.dry = [new B.StrollTask(1, 3, 4, false).shouldRun(world, mk({ water: true })), new B.StrollTask(1, 3, 4, false).shouldRun(world, mk({ water: false })), new B.StrollTask(1, 3, 4, true).shouldRun(world, mk({ water: true }))];
  // Aquatic
  const a = new B.AquaticStrollTask(0.5);
  out.aq = [a.horizontalRadius, a.verticalRadius, a.shouldRun(world, mk({ water: true })), a.shouldRun(world, mk({ water: false }))];
  calls.length = 0;
  e = mk({ lq: [{ x: 14, y: 64, z: -4 }] });          // 1st sample straight +x; later ones extrapolate
  out.r1 = JSON.stringify(a.findWalkTarget(e)); out.c1 = calls.splice(0);
  e = mk({ lq: [{ x: 14, y: 68, z: -4 + 3 }] });
  out.r2 = JSON.stringify(a.findWalkTarget(e));
  e = mk({ lq: [{ x: 10, y: 64, z: -4 }] });          // zero vector normalizes to ZERO
  out.r3 = JSON.stringify(a.findWalkTarget(e));
  e = mk({ lq: [{ x: 11, y: 64, z: -4 }] }); out.r4 = JSON.stringify(a.findWalkTarget(e));
  e = mk({ lq: [{ x: 11, y: 64, z: -4, dry: true }] }); out.r5 = JSON.stringify(a.findWalkTarget(e));
  e = mk({ allWet: true, lq: [{ x: 11, y: 65, z: -3 }] }); out.r7 = JSON.stringify(a.findWalkTarget(e));
  e = mk({ lq: [null] }); out.r6 = JSON.stringify(a.findWalkTarget(e));
  return out;
}
const j = JSON.stringify, base = scenario();
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
ok(j(base.defaults) === j([10, 7, true, '{"walk_target":"value_absent"}']), 'defaults ' + j(base.defaults));
ok(base.started && base.wt.includes('"pos":{"x":1,"y":2,"z":3},"speed":0.6,"completionRange":0'), 'walk target ' + base.wt);
ok(j(base.calls) === j(['F10,7']), 'fuzzy find (10,7) once ' + j(base.calls));
ok(base.blocked === false, 'present WALK_TARGET blocks');
ok(base.emptyForgets, 'null target forgets');
ok(j(base.dry) === j([false, true, true]), 'strollInsideWater gate ' + j(base.dry));
ok(j(base.aq) === j([10, 7, true, false]), 'aquatic ctor/gate ' + j(base.aq));
// reference: sample1 (14,64,-4) wet; then dir=+x, mult (3,3): (13,64,-4) wet ... continues through all 6 multipliers
const ref = (e, first) => { let prev = null, cur = null; const M = [[1,1],[3,3],[5,5],[6,5],[7,7],[10,7]];
  for (const [mx, my] of M) { if (!prev) cur = first; else { let d = [prev.x - e.x, prev.y - e.y, prev.z - e.z]; const l = Math.hypot(...d);
    d = l < 1e-5 ? [0,0,0] : d.map((v) => v / l); cur = { x: e.x + d[0] * mx, y: e.y + d[1] * my, z: e.z + d[2] * mx }; } prev = cur; } return cur; };
const e0 = { x: 10, y: 64, z: -4 };
ok(base.r1 === '{"x":13,"y":64,"z":-4}', 'r1 (x=15 dry -> previous) ' + base.r1);
ok(base.r2.startsWith('{"x":') && base.r2 !== 'null', 'r2 ' + base.r2);
ok(base.r3 === j({ x: 10, y: 64, z: -4 }), 'r3 zero vec ' + base.r3);
ok(base.r4 === '{"x":13,"y":64,"z":-4}', 'dry third sample returns previous ' + base.r4);
ok(base.r5 === 'null', 'dry first sample returns prev=null ' + base.r5);
ok(base.r7 === j(ref(e0, { x: 11, y: 65, z: -3 })), 'r7 all six multipliers ' + base.r7);
ok(base.r6 === 'null', 'null sample returns prev ' + base.r6);
ok(j(base.c1) === j(['L1,1']), 'only first multiplier uses lookFind ' + j(base.c1));
if (fails) { console.log(fails + ' failures'); process.exit(1); }
const breaks = [
  ["this.strollInsideWater || !e.isInWaterOrBubble()", "!e.isInWaterOrBubble()"],
  ["r[B.WALK_TARGET] = B.VALUE_ABSENT", "r[B.WALK_TARGET] = B.REGISTERED"],
  ["else e.brain.forget(B.WALK_TARGET);", ""],
  ["completionRange: 0", "completionRange: 1"],
  ["[[1, 1], [3, 3], [5, 5], [6, 5], [7, 7], [10, 7]]", "[[1, 1], [3, 3], [5, 5], [6, 5], [7, 7], [10, 10]]"],
  ["z: e.z + dz * m[0]", "z: e.z + dz * m[1]"],
  ["if (cur === null || e.fluidEmptyAt(cur)) return prev;", "if (cur === null || e.fluidEmptyAt(cur)) return cur;"],
  ["return !!e.isInWaterOrBubble(); };\n  AquaticStrollTask.prototype.findWalkTarget", "return true; };\n  AquaticStrollTask.prototype.findWalkTarget"],
  ["len < 1.0E-5", "len < 0"],
];
let caught = 0;
for (const b of breaks) {
  let r; try { r = scenario(b); } catch (er) { console.log('edit error: ' + er.message); continue; }
  if (j(r) !== j(base)) { caught++; console.log('   ✓ caught: ' + b[0].slice(0, 50)); } else console.log('NOT caught: ' + b[0].slice(0, 50));
}
console.log('brainstrollcheck: 14 assertions, 0 failures, ' + caught + ' breaks caught');
process.exit(caught === breaks.length ? 0 : 1);
