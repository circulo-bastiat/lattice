#!/usr/bin/env node
// raid11640check.mjs — #11640: proves 07s_raid.js's ChunkSectionPos use (Rd.moveRaidCenter 5x5x5 section cube), reachability
// (17_main -> Raid.tickLive -> buildLiveCtx -> moveRaidCenter) and the Pillager/Ravager renderer TEXTURE paths; SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const rd = (f) => readFileSync(join(MCLITE_ROOT, f), 'utf8');
function trial(patch) {
  const MCL = loadEngine({ extra: ['07s_raid.js'], dom: false, patch: patch ? (f, s) => (f === '07s_raid.js' ? patch(s) : s) : undefined });
  const R = MCL.Raid, o = {};
  const mk = (c) => ({ center: { ...c } });
  let r = mk({ x: 8, y: 72, z: 8 });
  R.moveRaidCenter(r, { '8,72,8': 1 }); o.same = r.center.x === 8 && r.center.y === 72 && r.center.z === 8;
  // POI two sections east (x=40 -> section 2): within the cube, within POI radius of its own section centre
  r = mk({ x: 8, y: 72, z: 8 }); R.moveRaidCenter(r, { '40,72,8': 1 });
  o.east = r.center.x === 24 || r.center.x === 40 ? true : false; o.eastExact = r.center.x === 24 && r.center.z === 8;
  // POI 3 sections away (x=56 -> section 3): centre 40 is dist 2 from centre sec 0 and near POI -> picks 40
  r = mk({ x: 8, y: 72, z: 8 }); R.moveRaidCenter(r, { '56,72,8': 1 });
  o.cube = r.center.x === 40;
  // POI 5 sections away: nothing in cube is near -> unchanged
  r = mk({ x: 0, y: 70, z: 0 }); R.moveRaidCenter(r, { '88,72,8': 1 });
  o.none = r.center.x === 0 && r.center.y === 70;
  // negative coords floor to section: x=-1 is section -1
  r = mk({ x: -1, y: 72, z: 8 }); R.moveRaidCenter(r, { '-56,72,8': 1 });
  o.neg = r.center.x === -40;
  // vertical axis participates
  r = mk({ x: 8, y: 8, z: 8 }); R.moveRaidCenter(r, { '8,40,8': 1 });
  o.vert = r.center.y === 24 || r.center.y === 40;
  r = mk({ x: 8, y: 8, z: 8 }); R.moveRaidCenter(r, { '8,72,8': 1 }); o.vertFar = r.center.y === 8;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const main = rd('src/17_main.js'), raid = rd('src/07s_raid.js');
ok(/NS\.Raid\.tickLive\(NS\)/.test(main), 'reach: 17_main calls Raid.tickLive');
ok(/moveRaidCenter: function \(raid2\) \{ Rd\.moveRaidCenter\(raid2, claimed\)/.test(raid), 'reach: buildLiveCtx wires moveRaidCenter');
ok(/if \(ctx\.moveRaidCenter\) ctx\.moveRaidCenter\(raid\)/.test(raid), 'reach: Rd.tick calls ctx.moveRaidCenter');
const ex = rd('tools/extract-mob-textures.mjs');
ok(ex.includes("pillager: P('illager/pillager.png')"), 'texture: PillagerEntityRenderer path');
ok(ex.includes("ravager: P('illager/ravager.png')"), 'texture: RavagerEntityRenderer path');
const er = rd('src/07j_entityrender.js');
ok(/ER\.ILLAGERS = \{[^}]*pillager: 1/.test(er), 'reach: renderer ILLAGERS has pillager');
ok(/ravager: e\.type === 'ravager'/.test(er), 'reach: renderer ravager anim ctx');
const BR = [
  ['sectionfloor', 'Math.floor(v / 16)', 'Math.trunc(v / 16)', ['neg']],
  ['centre', '* 16 + 8, y:', '* 16 + 0, y:', ['same']],
  ['cube', 'dx <= 2; dx++', 'dx <= 1; dx++', ['cube']],
  ['cubey', 'dy <= 2; dy++', 'dy <= 0; dy++', ['vert']],
  ['nearest', 'if (d < bestD)', 'if (d > bestD || !best)', ['east', 'eastExact', 'cube']],
  ['filter', 'if (!Rd.isNearOccupiedPOI(cand, claimed)) continue;', '', ['none']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`raid11640check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
