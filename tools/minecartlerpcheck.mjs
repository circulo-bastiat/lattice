#!/usr/bin/env node
// minecartlerpcheck.mjs — #8844: the cart's client copy lerps toward the tracker packet (every 3 ticks) over 5 steps
// (AbstractMinecartEntity.updateTrackedPositionAndAngles / client tick), yaw through wrapDegrees. Ends "<n> breaks caught".
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07f_redstone.js', '07zzq_rail.js', '07zzr_minecart.js'], dom: false });
const CL = M.Minecart.Client;
const wrap = (d) => { d %= 360; if (d >= 180) d -= 360; if (d < -180) d += 360; return d; };
function run() {
  let bad = 0, n = 0;
  // curved path: a quarter circle, yaw sweeping across the +-180 seam
  const e = { x: 0, y: 0, z: 0, age: 0, cartYaw: 170 };
  const c = CL.make(e), ref = { x: 0, y: 0, z: 0, yaw: 170, steps: 0, tx: 0, ty: 0, tz: 0, tyaw: 170 };
  for (let t = 0; t < 60; t++) {
    const a = t * 0.05;
    e.x = Math.sin(a) * 4; e.z = (1 - Math.cos(a)) * 4; e.cartYaw = 170 + t * 2.5 > 180 ? 170 + t * 2.5 - 360 : 170 + t * 2.5; e.cartPitch = (t % 7) - 3;
    if (t % 3 === 0) { CL.track(c, e.x, e.y, e.z, e.cartYaw, e.cartPitch);
      Object.assign(ref, { tx: e.x, tz: e.z, tyaw: e.cartYaw, tpitch: e.cartPitch, steps: 5 }); }
    const px = ref.x, pz = ref.z, pyaw = ref.yaw;
    CL.tick(c);
    if (ref.steps > 0) { ref.x += (ref.tx - ref.x) / ref.steps; ref.z += (ref.tz - ref.z) / ref.steps;
      ref.yaw = Math.fround(ref.yaw + Math.fround(wrap(ref.tyaw - ref.yaw)) / ref.steps); ref.steps--; }
    for (const p of [0, 0.25, 0.5, 1]) {
      n++;
      const rx = px + (ref.x - px) * p, rz = pz + (ref.z - pz) * p, ry = pyaw + (ref.yaw - pyaw) * p;
      const cx = c.xO + (c.x - c.xO) * p, cz = c.zO + (c.z - c.zO) * p, cy = c.yawO + (c.yaw - c.yawO) * p;
      if (Math.abs(rx - cx) > 1e-12 || Math.abs(rz - cz) > 1e-12 || Math.abs(ry - cy) > 1e-9) bad++;
    }
  }
  return bad;
}
let fails = 0;
if (run()) { fails++; console.log('  ✗ client lerp differs from the vanilla formula'); }
let caught = 0;
const w = CL.wrap, ex = CL.EXTRA;
CL.EXTRA = 1; if (run()) { caught++; console.log('  ✓ break caught: lerpSteps 4'); } else fails++; CL.EXTRA = ex;
CL.wrap = (d) => d; if (run()) { caught++; console.log('  ✓ break caught: yaw wrap dropped'); } else fails++; CL.wrap = w;
console.log(`minecartlerpcheck: ${fails} failed`);
console.log(` assertions passed .... ${caught + 1 - fails}`);
console.log(` failures ........... ${fails}`);
console.log(`${caught} breaks caught`);
process.exit(fails ? 1 : 0);
