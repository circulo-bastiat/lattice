#!/usr/bin/env node
// phantomposecheck.mjs — #4785: PhantomEntityRenderer.setupTransforms multiplies Rx(getPitch) after the yaw.
import { loadEngine } from './loadsrc.mjs';

const ER = loadEngine({ extra: ['07j_entityrender.js'], dom: false }).EntityRender;
const P = Math.PI;
let pass = 0; const fails = []; let breaks = 0;
const near = (a, b) => Math.abs(a - b) < 1e-5;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const apply = (pose, v) => [0, 1, 2].map((i) => pose.R[i * 3] * v[0] + pose.R[i * 3 + 1] * v[1] + pose.R[i * 3 + 2] * v[2]);
// vanilla Vec3f.POSITIVE_X.getDegreesQuaternion(deg) on a point
const rx = (deg, [x, y, z]) => { const t = deg * P / 180; return [x, y * Math.cos(t) - z * Math.sin(t), y * Math.sin(t) + z * Math.cos(t)]; };

for (const deg of [-60, -15, 30, 90]) {
  const pz = ER.phantomPoseOf({ type: 'phantom', pitch: deg * P / 180 }).pose;
  for (const v of [[0, 0, 0], [0.3, -1, 0.7], [1, 2, -1]]) {
    const a = apply(pz, v), b = rx(deg, v);
    ok(near(a[0], b[0]) && near(a[1], b[1]) && near(a[2], b[2]), `pitch ${deg} point ${v}`);
  }
}
ok(ER.phantomPoseOf({ type: 'phantom', pitch: 0 }) === null, 'level phantom has no pose');
ok(ER.phantomPoseOf({ type: 'bat', pitch: 1 }) === null, 'non-phantom has no pose');

okAv(!!ER.phantomPoseOf({ type: 'phantom', pitch: 0.5 }), 'a diving phantom gets a pose');
{
  const c = apply(ER.phantomPoseOf({ type: 'phantom', pitch: 0.5 }).pose, [0, 1, 1]), b = rx(-28.6479, [0, 1, 1]);
  okAv(!(near(c[1], b[1]) && near(c[2], b[2])), 'the opposite-sign pitch does not match');
}
okAv(ER.phantomPoseOf({ type: 'phantom', pitch: 0 }) === null, 'pitch 0 is level');

console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} breaks caught)`);
if (fails.length) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
console.log('phantomposecheck: ALL GREEN');
