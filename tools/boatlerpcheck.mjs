#!/usr/bin/env node
// boatlerpcheck.mjs -- #8845: BoatEntity.updateTrackedPositionAndAngles + client tick lerp (10 steps, wrapped yaw, pitch).
import { loadEngine } from './loadsrc.mjs';
console.log('boatlerpcheck -- #8845, boat client interpolation');
function run(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '07zzt_boat.js'], dom: false, patch: patch || undefined });
  const Bt = M.Boat;
  const f = Math.fround, fails = [];
  const e = {};
  // reference: vanilla formula, independent
  let x = 0, y = 64, z = 0, yaw = 170, pitch = 0, steps = 0, tx, ty, tz, tyaw, tp;
  const wrap = d => { d %= 360; if (d >= 180) d -= 360; if (d < -180) d += 360; return d; };
  for (let t = 0; t < 40; t++) {
    if (t % 3 === 0) {
      const nx = t * 0.4, ny = 64 + t * 0.01, nz = -t * 0.2, nyaw = 170 + t * 5, np = (t % 6) * 2; // yaw passes 180
      Bt.updateTracked(e, nx, ny, nz, nyaw > 180 ? nyaw - 360 : nyaw, np);
      if (t === 0) { x = nx; y = ny; z = nz; yaw = nyaw; pitch = np; }
      tx = nx; ty = ny; tz = nz; tyaw = nyaw > 180 ? nyaw - 360 : nyaw; tp = np; steps = 10;
    }
    const px = x, pyaw = yaw;
    Bt.clientTick(e);
    if (steps > 0) {
      x += (tx - x) / steps; y += (ty - y) / steps; z += (tz - z) / steps;
      yaw = f(yaw + f(wrap(tyaw - yaw)) / steps); pitch = f(pitch + f(tp - pitch) / steps); steps--;
    }
    const c = e.boatC;
    for (const [k, a, b] of [['x', c.x, x], ['y', c.y, y], ['z', c.z, z], ['yaw', c.yaw, yaw], ['pitch', c.pitch, pitch], ['px', c.px, px], ['pyaw', c.pyaw, pyaw]])
      if (a !== b) fails.push(`t${t} ${k} ${a} != ${b}`);
  }
  return fails;
}
const base = run(null);
console.log(base.length ? 'FAIL ' + base.slice(0, 3).join('; ') : 'ok: 40 ticks match the vanilla formula');
let caught = 0;
for (const [a, b] of [['INTERP_STEPS = 10', 'INTERP_STEPS = 5'], ['Bt.wrapDegrees(c.tyaw - c.yaw)', '(c.tyaw - c.yaw)']]) {
  const r = run((f, s) => f === '07zzt_boat.js' ? (s.includes(a) ? s.replace(a, b) : (() => { throw new Error('missing ' + a); })()) : s);
  if (r.length) { caught++; console.log('   ✓ break caught: ' + a); } else console.log('NOT caught: ' + a);
}
console.log(`boatlerpcheck: 280 assertions, ${base.length} failures, ${caught} breaks caught`);
process.exit(base.length || caught < 2 ? 1 : 0);
