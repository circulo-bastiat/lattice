#!/usr/bin/env node
// itemrenderer11646check.mjs — #11646: proves 14k_hand3d.js's ItemRenderer port: ItemTransform.apply
// (H3.applyDisplay: translate/16, rotX,rotY,rotZ, scale; left hand negates x/y/z-rot) and the -0.5 pivot
// (H3.MODEL_PIVOT, used by emitPart), reachable from H3.buildMain / buildOffhand; source breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-5;
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
function trial(patch) {
  const MCL = loadEngine({ extra: ['14k_hand3d.js'], dom: false, patch: patch ? (f, s) => (f === '14k_hand3d.js' ? patch(s) : s) : undefined });
  const H3 = MCL.Hand3D, o = {};
  // stub items: item 0 = trident-like [0,-90,25,-3,17,1,1,1,1]; item 1 = [0,0,0, 16,32,48, 2,3,4]
  const T = [[0, -90, 25, 1.13, 3.2, 1.13, 0.68, 0.68, 0.68], [0, 0, 0, 16, 32, 48, 2, 3, 4], [0, 90, 0, 0, 0, 0, 1, 1, 1], [0, 0, 90, 0, 0, 0, 1, 1, 1]];
  MCL.Items = { ready: true, nameOf: () => 'stub', handTransform: (i) => T[i] };
  const M = H3._m, ap = (i, left) => H3.applyDisplay(M.ident(new Float32Array(16)), i, left);
  const a = ap(1, false);
  o.trans = near(a[12], 1) && near(a[13], 2) && near(a[14], 3);
  o.scale = near(a[0], 2) && near(a[5], 3) && near(a[10], 4);
  o.leftx = near(ap(1, true)[12], -1) && near(ap(1, true)[13], 2);
  // rotY 90: x axis -> -z ; left hand negates the angle
  const ry = ap(2, false), ryl = ap(2, true);
  o.roty = near(ry[2], -1) && near(ryl[2], 1);
  const rz = ap(3, false), rzl = ap(3, true);
  o.rotz = near(rz[1], 1) && near(rzl[1], -1);
  // order: translate then rotate (point at origin lands at the translation)
  const s = ap(0, false);
  o.order = near(s[12], 1.13 / 16) && near(s[13], 3.2 / 16);
  o.none = (() => { MCL.Items.handTransform = () => null; const m = ap(0, false); return near(m[0], 1) && near(m[12], 0); })();
  o.pivot = H3.MODEL_PIVOT === 0.5;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const j = rd('14k_hand3d.js');
ok(/H3\.applyDisplay\(m, itemIdx\)/.test(j) && /H3\.applyDisplay\(m, idx, true\)/.test(j), 'reach: buildMain/buildOffhand call applyDisplay');
ok(/var piv = H3\.MODEL_PIVOT/.test(j), 'reach: emitPart uses MODEL_PIVOT');
const BR = [
  ['tdiv', "mTranslate(m, sg * t[3] / 16, t[4] / 16, t[5] / 16)", "mTranslate(m, sg * t[3], t[4], t[5])", ['trans', 'order', 'leftx']],
  ['leftx', "sg * t[3] / 16", "t[3] / 16", ['leftx']],
  ['roty', "mRotY(m, sg * t[1])", "mRotY(m, t[1])", ['roty']],
  ['rotz', "mRotZ(m, sg * t[2])", "mRotZ(m, t[2])", ['rotz']],
  ['scale', "mScale(m, t[6], t[7], t[8])", "mScale(m, t[6], t[6], t[6])", ['scale']],
  ['pivot', "H3.MODEL_PIVOT = 0.5", "H3.MODEL_PIVOT = 0", ['pivot']],
  ['null', "if (!t) return m;", "if (!t) t = [0,0,0,5,0,0,1,1,1];", ['none']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`itemrenderer11646check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
