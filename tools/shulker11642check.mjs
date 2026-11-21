#!/usr/bin/env node
// shulker11642check.mjs — #11642: proves 07zzl_shulkerdraw.js's Quaternion/Matrix3f ports (quat, hamilton, mat via
// SD.rotationQuaternion / SD.faceMatrix) and ShulkerHeadFeatureRenderer (SD.delta 'head' pass), reachable from 07j animOf/delta; source breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-9;
function trial(patch) {
  const MCL = loadEngine({ extra: ['07zzl_shulkerdraw.js'], dom: false, patch: patch ? (f, s) => (f === '07zzl_shulkerdraw.js' ? patch(s) : s) : undefined });
  const SD = MCL.ShulkerDraw, o = {};
  const h = Math.SQRT1_2;
  const q = (d) => SD.rotationQuaternion(d);
  o.qdown = q(0).every((v, i) => near(v, [1, 0, 0, 0][i]));
  o.qup = q(1).every((v, i) => near(v, [0, 0, 0, 1][i]));
  o.qsouth = q(3).every((v, i) => near(v, [h, 0, 0, h][i]));
  o.qnorth = q(2).every((v, i) => near(v, [0, -h, h, 0][i]));
  o.qwest = q(4).every((v, i) => near(v, [0.5, -0.5, 0.5, 0.5][i]));
  o.qeast = q(5).every((v, i) => near(v, [0.5, 0.5, -0.5, 0.5][i]));
  // floor-attached (face 0 DOWN) => opposite UP => identity
  const I = SD.faceMatrix(0);
  o.ident = I.every((v, i) => near(v, [1, 0, 0, 0, 1, 0, 0, 0, 1][i]));
  // ceiling-attached: 180 about X: y->-y, z->-z
  o.ceil = SD.faceMatrix(1).every((v, i) => near(v, [1, 0, 0, 0, -1, 0, 0, 0, -1][i]));
  // attached to north (2): opposite south (3): 90 about X: y -> +z
  o.south = SD.faceMatrix(2).every((v, i) => near(v, [1, 0, 0, 0, 0, -1, 0, 1, 0][i]));
  // face 4 (W) attached => opposite E: 90 about X then -90 about Z
  o.east = SD.faceMatrix(4).every((v, i) => near(v, [0, 1, 0, 0, 0, -1, -1, 0, 0][i]));
  o.undef = SD.faceMatrix(undefined)[4] === 1;
  // head feature pass: pitch/yaw straight onto the head, lid not pitched
  const hd = SD.delta('head', { headYaw: 0.7, open: 0, age: 0 }, 90);
  o.head = near(hd.rx, Math.PI / 2) && near(hd.ry, 0.7) && hd.rz === 0;
  o.base = SD.delta('base', { open: 0, age: 0 }, 0) === null;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
const j = rd('07j_entityrender.js');
ok(/NS\.ShulkerDraw\.animOf\(e, partial/.test(j) && /NS\.ShulkerDraw\.delta\(partName/.test(j) && /NS\.ShulkerDraw\.faceMatrix\(/.test(j), 'reach: 07j calls animOf/delta/faceMatrix');
const BR = [
  ['axis', "case 3: return base;", "case 3: return quat(0, 1, 0, 90);", ['qsouth', 'south']],
  ['hamW', 'w * rw - x * rx', '0 - x * rx', ['qnorth', 'qwest', 'qeast']],
  ['hamX', 'w * rx + x * rw + y * rz', 'w * rx - x * rw + y * rz', ['qwest', 'qnorth', 'qeast']],
  ['matXY', '2 * (xy - zw), 2 * (zx + yw)', '2 * (xy + zw), 2 * (zx + yw)', ['east']],
  ['matYZ', '2 * (yz - xw),', '2 * (yz + xw),', ['south']],
  ['opposite', 'FACE_MAT[(f ^ 1)]', 'FACE_MAT[f]', ['ident', 'ceil']],
  ['qhalf', 'Math.sin(a / 2)', 'Math.sin(a)', ['qup', 'qdown', 'qsouth']],
  ['headpitch', 'rx: headPitchDeg * (Math.PI / 180)', 'rx: 0', ['head']],
  ['headyaw', 'ry: sh.headYaw, rz: 0', 'ry: 0, rz: 0', ['head']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`shulker11642check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
