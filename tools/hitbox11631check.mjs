#!/usr/bin/env node
// hitbox11631check.mjs — #11631: proves 07zzu_hitbox.js (renderHitbox + drawBox(VertexConsumer) line lists), reachability from 17_main.js, SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: ['07zzu_hitbox.js'], dom: false, patch: patch ? (f, s) => (f === '07zzu_hitbox.js' ? patch(s) : s) : undefined });
  const H = MCL.Hitbox, o = {}; const said = []; MCL.Chat = { say: (s) => said.push(s) };
  const e = { x: 10, y: 20, z: 30, box: [9.7, 20, 29.7, 10.3, 21.8, 30.3], eye: 1.62, living: true, look: [0, 0, 1] };
  const v = H.lines(e);
  o.count = v.length === 24 * 2 + 2;
  o.white = v.slice(0, 24).every((q) => q.c.join() === '1,1,1,1');
  o.v0 = Math.abs(v[0].p[0] + 0.3) < 1e-6 && v[0].p[1] === 0 && Math.abs(v[0].p[2] + 0.3) < 1e-6;
  o.v1 = Math.abs(v[1].p[0] - 0.3) < 1e-6 && v[1].p[1] === 0;
  o.v3 = Math.abs(v[3].p[1] - 1.8) < 1e-5;
  o.v23 = Math.abs(v[23].p[0] - 0.3) < 1e-6 && Math.abs(v[23].p[1] - 1.8) < 1e-5 && Math.abs(v[23].p[2] - 0.3) < 1e-6;
  o.red = v[24].c.join() === '1,0,0,1' && Math.abs(v[24].p[1] - Math.fround(1.62 - Math.fround(0.01))) < 1e-9 && Math.abs(v[27].p[1] - Math.fround(1.62 + Math.fround(0.01))) < 1e-9;
  o.blue = v[48].c.join() === '0,0,255,255' && v[48].p[1] === Math.fround(1.62) && v[49].p[2] === 2 && Math.abs(v[49].p[1] - 1.62) < 1e-6;
  const d = H.lines({ x: 0, y: 0, z: 0, box: [-1, 0, -1, 1, 1, 1], eye: 0.5, living: false, look: [0, 0, 1], parts: [{ x: 5, y: 0, z: 0, box: [4, 0, -1, 6, 2, 1] }] });
  o.parts = d.length === 24 * 2 + 2 && d[24].c.join() === '0.25,1,0,1' && Math.abs(d[24].p[0] - 4) < 1e-6;
  o.noLiving = d.length === 50;
  o.toggle = H.toggle() === 'Hitboxes: shown' && H.on === true && H.toggle() === 'Hitboxes: hidden' && said.length === 2 && said[0] === 'Hitboxes: shown';
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
ok(/case 'hitboxes':\s+if \(NS\.Hitbox\) NS\.Hitbox\.toggle\(\)/.test(rd('17_main.js')), 'reach: 17_main F3+B calls Hitbox.toggle');
const BR = [
  ['order', '[0,1,2],[3,1,2],[0,1,2],[0,4,2]', '[3,1,2],[0,1,2],[0,1,2],[0,4,2]', ['v0', 'v1']],
  ['last', '[3,4,2],[3,4,5]];', '[3,4,2],[3,4,2]];', ['v23']],
  ['white', 'Hb.drawBox(out, b, 1, 1, 1, 1);', 'Hb.drawBox(out, b, 0, 1, 1, 1);', ['white']],
  ['eyeband', 'F(e.eye - F(0.01))', 'F(e.eye - F(0.1))', ['red']],
  ['redcol', '1, 0, 0, 1);', '1, 1, 0, 1);', ['red']],
  ['living', 'if (e.living) {', 'if (!e.living) {', ['count', 'noLiving']],
  ['look', 'L[2] * 2', 'L[2] * 3', ['blue']],
  ['blue', 'c: [0, 0, 255, 255] });\n    out.push', 'c: [0, 0, 254, 255] });\n    out.push', ['blue']],
  ['partcol', '0.25, 1, 0, 1', '0.5, 1, 0, 1', ['parts']],
  ['partoff', 'p.x - e.x,', '0,', ['parts']],
  ['toggle', "'Hitboxes: shown' : 'Hitboxes: hidden'", "'Hitboxes: hidden' : 'Hitboxes: shown'", ['toggle']],
  ['rel', 'e.box[0] - e.x,', 'e.box[0],', ['v0']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`hitbox11631check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
