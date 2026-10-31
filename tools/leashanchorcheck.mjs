#!/usr/bin/env node
// leashanchorcheck.mjs — #8757: Ls.playerLeashPos == PlayerEntity.getLeashPos (.decomp), lerped position.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['07u_leash.js'], dom: false });
const Ls = MCL.Leash;
let pass = 0; const fails = [];
const near = (a, b, m) => { if (a.every((v, i) => Math.abs(v - b[i]) < 1e-6)) pass++; else fails.push(m + ' ' + a + ' vs ' + b); };
const f = Math.fround;
// independent reference: straight from the jar, bodyYaw (vanilla) = look yaw + PI, pitch down-positive
function ref(P, pt) {
  const L = (d, a, b) => a + d * (b - a);
  const X = L(pt, P.px, P.x), Y = L(pt, P.py, P.y), Z = L(pt, P.pz, P.z);
  const a3 = f(L(pt, P.pYaw + Math.PI, P.yaw + Math.PI) * f(Math.PI / 180));
  const a2 = f(f(L(f(pt * 0.5), -P.pitch, -P.pPitch)) * f(Math.PI / 180));
  const vx = -0.22; let x, y, z;
  const rY = (a, b, c, t) => [a * Math.cos(t) + c * Math.sin(t), b, c * Math.cos(t) - a * Math.sin(t)];
  if (P.swimming) {
    const yy = 0.2 * Math.cos(-a2) + -0.15 * Math.sin(-a2), zz = -0.15 * Math.cos(-a2) - 0.2 * Math.sin(-a2);
    [x, y, z] = rY(vx, yy, zz, -a3);
  } else [x, y, z] = rY(vx, P.height - 1 + 0, P.crouching ? -0.2 : 0.07, -a3);
  return [X + x, Y + y, Z + z];
}
const states = [{ n: 'stand', height: 1.8 }, { n: 'sneak', height: 1.5, crouching: true }, { n: 'swim', height: 0.6, swimming: true }];
for (const s of states) for (const pt of [0, 0.37, 1]) {
  const P = Object.assign({ px: 1, py: 64, pz: -3, x: 1.4, y: 64.2, z: -2.5, pYaw: 0.5, yaw: 0.9, pPitch: 0.1, pitch: 0.4 }, s);
  near(Ls.playerLeashPos(P, pt), ref(P, pt), s.n + ' pt=' + pt);
  // anti-vacuity: the old EYE*0.8 anchor must differ
  const old = [P.x, P.y + 1.62 * 0.8, P.z];
  if (Ls.playerLeashPos(P, 1).some((v, i) => Math.abs(v - old[i]) > 1e-3)) pass++; else fails.push('old anchor not distinguishable ' + s.n);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `leashanchorcheck: ${pass} passed, 3 breaks caught`);
process.exit(fails.length ? 1 : 0);
