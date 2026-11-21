#!/usr/bin/env node
// squidposecheck.mjs — #1569: SquidEntityRenderer.setupTransforms (tilt/roll about the body) and
// SquidEntityModel.setAngles (every tentacle pitch = tentacleAngle), against .decomp.
import { loadEngine } from './loadsrc.mjs';

const MCL = loadEngine({ extra: ['07j_entityrender.js'], dom: false });
const ER = MCL.EntityRender;
const P = Math.PI;
let pass = 0; const fails = []; let breaks = 0;
const near = (a, b) => Math.abs(a - b) < 1e-5;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

// independent vanilla chain: translate(0,.5,0) Rx(tilt) Ry(roll) translate(0,-1.2,0) applied to a point (yaw omitted)
const vanilla = (tiltDeg, rollDeg, v) => {
  let [x, y, z] = [v[0], v[1] - 1.2, v[2]];
  const r = rollDeg * P / 180; [x, z] = [x * Math.cos(r) + z * Math.sin(r), -x * Math.sin(r) + z * Math.cos(r)];
  const t = tiltDeg * P / 180; [y, z] = [y * Math.cos(t) - z * Math.sin(t), y * Math.sin(t) + z * Math.cos(t)];
  return [x, y + 0.5, z];
};
const apply = (pose, v) => [0, 1, 2].map((i) => pose.R[i * 3] * v[0] + pose.R[i * 3 + 1] * v[1] + pose.R[i * 3 + 2] * v[2] + pose.t[i]);
const sq = (tilt, roll, extra) => Object.assign({ type: 'squid', tiltAngle: tilt, prevTiltAngle: tilt, rollAngle: roll, prevRollAngle: roll, tentacleAngle: 0, prevTentacleAngle: 0 }, extra);

// 1. the pose equals the vanilla matrix chain on sample points, for both squids
for (const [tilt, roll] of [[0, 0], [-45, 0], [-90, 30], [20, 200]]) {
  for (const type of ['squid', 'glow_squid']) {
    const pz = ER.squidPoseOf(sq(tilt, roll, { type }), 1).pose;
    for (const v of [[0, 0, 0], [0.3, -1, 0.7], [1, 2, -1]]) {
      const a = apply(pz, v), b = vanilla(tilt, roll, v);
      ok(near(a[0], b[0]) && near(a[1], b[1]) && near(a[2], b[2]), `${type} tilt ${tilt} roll ${roll} point ${v}`);
    }
  }
}
ok(ER.squidPoseOf({ type: 'cow' }, 1) === null, 'non-squid has no squid pose');

// 2. lerp prev -> cur
const a = ER.squidAngles({ prevTiltAngle: -90, tiltAngle: -50, prevRollAngle: 10, rollAngle: 20, prevTentacleAngle: 0, tentacleAngle: P / 2 }, 0.5);
ok(near(a.tilt, -70) && near(a.roll, 15) && near(a.tentacle, P / 4), 'tilt/roll/tentacle lerp by partial');

// 3. tentacles: pitch = tentacleAngle, body untouched
const d = (n, ang, rest) => ER.setupAnimDeltaCore(n, 0, 0, 0, 0, false, 'squid', { squid: { tentacle: ang }, rest: rest || { rx: 0 } });
for (let i = 0; i < 8; i++) ok(near(d('tentacle' + i, P / 4).rx, P / 4), 'tentacle' + i + ' pitch = pi/4');
ok(d('body', P / 4) === null, 'body has no delta');

// 4. anti-vacuity
{
  const sv = ER.squidPoseOf; ER.squidPoseOf = () => null;
  okAv(ER.squidPoseOf(sq(-45, 0), 1) === null, 'stubbing squidPoseOf removes the tilt');
  ER.squidPoseOf = sv;
  const p0 = ER.squidPoseOf(sq(0, 0), 1).pose, b = vanilla(-45, 0, [0, 1, 1]);
  const c = apply(p0, [0, 1, 1]);
  okAv(!(near(c[1], b[1]) && near(c[2], b[2])), 'an untilted pose does not match the -45 degree chain');
  okAv(!near(d('tentacle0', 0).rx, P / 4), 'tentacleAngle 0 leaves the tentacles at rest');
  okAv(!near(ER.squidAngles(sq(-45, 0, { prevTiltAngle: 0 }), 0).tilt, -45), 'partial 0 uses the previous tilt');
  okAv(ER.setupAnimDeltaCore('tentacle0', 0, 0, 0, 0, false, null, { squid: { tentacle: P / 4 }, rest: { rx: 0 } }) === null, 'a non-squid model kind ignores the squid ctx');
}

console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity probes included, ${breaks} breaks caught)`);
if (fails.length) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
console.log('squidposecheck: ALL GREEN');
