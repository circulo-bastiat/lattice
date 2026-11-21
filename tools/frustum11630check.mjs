#!/usr/bin/env node
// frustum11630check.mjs — #11630: proves the Frustum (10_camera.js Cam.extractPlanes/aabbVisible, reached by
// 10_gfx.js G.sectionVisible and the draw-list cull) with SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: ['10_camera.js'], dom: false, patch: patch ? (f, s) => (f === '10_camera.js' ? patch(s) : s) : undefined });
  const C = MCL.Cam, o = {};
  const cam = C.create(); cam.x = 1000; cam.y = 80; cam.z = -500; cam.yaw = 0; cam.pitch = 0; cam.aspect = 1.6;
  C.update(cam);
  const box = (x, y, z) => C.aabbVisible(cam, x, y, z, x + 16, y + 16, z + 16);
  o.front = box(992, 72, -540) === true;                 // yaw 0 looks -Z
  o.behind = box(992, 72, -470) === false;
  o.left = box(1000 - 200, 72, -540) === false;
  o.right = box(1000 + 200, 72, -540) === false;
  o.above = box(992, 80 + 200, -540) === false;
  o.below = box(992, 80 - 200, -540) === false;
  o.far = box(992, 72, -500 - 600) === false;
  o.nearIn = box(992, 72, -500 - 400) === true;
  o.nearCut = C.aabbVisible(cam, 900, -20, -499.99, 1100, 180, -499.96) === false;
  o.straddle = box(1000 - 8, 72, -500 - 1) === true;     // around the eye: never culled
  // plane normalisation
  let n = true; for (let i = 0; i < 24; i += 4) n = n && Math.abs(Math.hypot(cam.planes[i], cam.planes[i + 1], cam.planes[i + 2]) - 1) < 1e-6;
  o.norm = n;
  // eye-relative precision (D-179): far from the origin it must still agree
  const c2 = C.create(); c2.x = 29000000.5; c2.y = 80; c2.z = 29000000.5; c2.aspect = 1.6; C.update(c2);
  o.bigIn = C.aabbVisible(c2, 29000000 - 8, 72, 29000000 - 40, 29000000 + 8, 88, 29000000 - 24) === true;
  o.bigOut = C.aabbVisible(c2, 29000000 - 8, 72, 29000000 + 40, 29000000 + 8, 88, 29000000 + 56) === false;
  // webgpu zero-to-one near plane
  const c3 = C.create(); c3.zeroToOne = true; c3.aspect = 1; C.update(c3);
  o.zto = C.aabbVisible(c3, -1, 79, -10, 1, 81, -8) === true && C.aabbVisible(c3, -1, 79, 5, 1, 81, 7) === false;
  o.ztoNear = C.aabbVisible(c3, -100, -20, 0.01, 100, 180, 0.04) === false && C.aabbVisible(c3, -100, -20, -0.04, 100, 180, -0.01) === false;
  // frozen frustum: planes stay at the frozen eye
  const c4 = C.create(); c4.aspect = 1; C.update(c4); c4.x = 5000;
  o.frozen = C.aabbVisible(c4, -1, 79, -10, 1, 81, -8) === true;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
ok(/NS\.Cam\.aabbVisible\(G\.cam/.test(rd('10_gfx.js')) && /C\.aabbVisible\(cam/.test(rd('10_gfx.js')), 'reach: 10_gfx cull calls aabbVisible');
ok(/NS\.Cam\.update\(cam\)/.test(rd('10_gfx.js')), 'reach: 10_gfx frame calls Cam.update');
const BR = [
  ['left', 'set(0, r3x+r0x, r3y+r0y, r3z+r0z, r3w+r0w)', 'set(0, r3x-r0x, r3y-r0y, r3z-r0z, r3w-r0w)', ['left', 'right']],
  ['right', 'set(1, r3x-r0x, r3y-r0y, r3z-r0z, r3w-r0w)', 'set(1, r3x+r0x, r3y+r0y, r3z+r0z, r3w+r0w)', ['left', 'right']],
  ['bottom', 'set(2, r3x+r1x, r3y+r1y, r3z+r1z, r3w+r1w)', 'set(2, r3x-r1x, r3y-r1y, r3z-r1z, r3w-r1w)', ['below', 'above']],
  ['top', 'set(3, r3x-r1x, r3y-r1y, r3z-r1z, r3w-r1w)', 'set(3, r3x+r1x, r3y+r1y, r3z+r1z, r3w+r1w)', ['below', 'above']],
  ['far', 'set(5, r3x-r2x, r3y-r2y, r3z-r2z, r3w-r2w)', 'set(5, r3x+r2x, r3y+r2y, r3z+r2z, r3w+r2w)', ['far', 'nearIn']],
  ['nearGL', 'else               set(4, r3x+r2x, r3y+r2y, r3z+r2z, r3w+r2w)', 'else               set(4, r3x-r2x, r3y-r2y, r3z-r2z, r3w-r2w)', ['nearCut']],
  ['zto', 'if (cam.zeroToOne) set(4, r2x', 'if (false) set(4, r2x', ['zto', 'ztoNear']],
  ['normalise', 'l = 1 / l;', 'l = 1;', ['norm']],
  ['eye', 'cam.px = cam.x;', 'cam.px = 0;', ['bigIn', 'bigOut', 'front']],
  ['rad', 'if (dist + rad < 0)', 'if (dist < 0)', ['straddle']],
  ['radAbs', '(nx < 0 ? -nx : nx)*ex', 'nx*ex', ['front', 'straddle', 'behind']],
  ['frozenEye', 'cam.px = cam.x; cam.py = cam.y; cam.pz = cam.z;', '', ['frozen', 'front']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`frustum11630check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
