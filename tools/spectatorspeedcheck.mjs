#!/usr/bin/env node
// spectatorspeedcheck.mjs — #7928: the wheel changes SPECTATOR fly speed (0..0.2 in 0.005 steps), nothing else.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = readFileSync(join(ROOT, 'src/14b_physics.js'), 'utf8');

function load(src) {
  const NS = {};
  new Function('MCL', readFileSync(join(ROOT, 'src/00_ns.js'), 'utf8'))(NS);
  new Function('MCL', src)(NS);
  const Ph = NS.Physics;
  for (const k of ['updateFluids', 'updateSwimming', 'updateFallFlying', 'pose']) Ph[k] = () => {};
  Ph.move = (e, dx, dy, dz) => { e.x += dx; e.y += dy; e.z += dz; };   // open air: fly physics only
  return Ph;
}
const ent = mode => ({ mode, flying: true, x: 0, y: 100, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, noclip: true, yaw: 0 });
const cmd = { fwd: 1, strafe: 0, jump: false, sneak: false, sprint: false };
function dist(Ph, e) {
  e.x = e.z = 0; e.vx = e.vy = e.vz = 0;
  for (let i = 0; i < 20; i++) Ph.tick(e, cmd);
  return Math.hypot(e.x, e.z);
}
let n = 0;
function verify(Ph) {
  const f = [], no = (c, m) => { n++; if (!c) f.push(m); };
  const sp = ent(3);
  no(sp.flySpeed === undefined, 'default untouched');
  const base = dist(Ph, sp);
  for (let i = 0; i < 4; i++) Ph.adjustFlySpeed(sp, 1);
  no(Math.abs(sp.flySpeed - 0.07) < 1e-9, 'four notches up = 0.07, got ' + sp.flySpeed);
  Ph.adjustFlySpeed(sp, -1);
  no(Math.abs(sp.flySpeed - 0.065) < 1e-9, 'one down = 0.065, got ' + sp.flySpeed);
  for (let i = 0; i < 100; i++) Ph.adjustFlySpeed(sp, 1);
  no(sp.flySpeed === 0.2, 'upper clamp 0.2, got ' + sp.flySpeed);
  const fast = dist(Ph, sp);
  no(Math.abs(fast / base - 4) < 0.05, 'speed at 0.2 is 4x the 0.05 speed, ratio ' + fast / base);
  for (let i = 0; i < 100; i++) Ph.adjustFlySpeed(sp, -1);
  no(sp.flySpeed === 0, 'lower clamp 0, got ' + sp.flySpeed);
  no(dist(Ph, sp) < 1e-9, 'speed 0 does not move');
  for (const m of [0, 1, 2]) {
    const e = ent(m); Ph.adjustFlySpeed(e, 1);
    no(e.flySpeed === undefined, 'mode ' + m + ' untouched');
    no(Math.abs(dist(Ph, e) - base) < 1e-9, 'mode ' + m + ' speed unchanged');
  }
  return f;
}
const fails = verify(load(SRC));
if (fails.length) { console.log('FAIL: ' + fails.join('; ')); process.exit(1); }
let breaks = 0;
for (const [from, to] of [['Math.min(0.2, Math.max(0, ', 'Math.min(9, Math.max(-9, '], ['e.mode !== 3 || !up', '!up'], ['top *= e.flySpeed', 'top *= 1 * 0 + Ph.FLY_SPEED_DEFAULT']]) {
  if (!SRC.includes(from)) { console.log('FAIL: break anchor missing: ' + from); process.exit(1); }
  if (verify(load(SRC.replace(from, to))).length) { breaks++; console.log('✓ break caught: ' + from); }
}
if (breaks !== 3) { console.log('FAIL: only ' + breaks + ' of 3 breaks caught'); process.exit(1); }
console.log(`spectatorspeedcheck: ${n} assertions, ${breaks} breaks caught`);
