#!/usr/bin/env node
// jockeypositioncheck -- #1828: post-tick jockey rider offsets vs ChickenEntity.updatePassengerPosition / Spider / Skeleton.
import { loadEngine } from './loadsrc.mjs';
const NS = loadEngine({ extra: ['07s_raid.js', '07zk_undead.js'], dom: false });
const Rd = NS.Raid, U = NS.Undead;
let pass = 0; const fails = [];
function run() {
  const ch = { type: 'chicken', x: 5, y: 10, z: 7, height: 0.7, yBodyRot: 1.0 };
  const zb = { type: 'zombie', growAge: -24000, x: 0, y: 0, z: 0 };
  const sp = { type: 'spider', x: 1, y: 20, z: 1, height: 0.9 };
  const sk = { type: 'skeleton', x: 0, y: 0, z: 0 };
  U.mountJockey(zb, ch); U.mountJockey(sk, sp);
  Rd.tickPassenger(zb); Rd.tickPassenger(sk);
  const v = ch.yBodyRot - Math.PI;   // vanilla yaw
  const want = [[zb.x, 5 + 0.1 * Math.sin(v)], [zb.z, 7 - 0.1 * Math.cos(v)], [zb.y, 10.35], [zb.yBodyRot, ch.yBodyRot], [sk.y, 20 + 0.45 - 0.6]];
  return want.filter(([a, b]) => Math.abs(a - b) > 1e-9).length;
}
if (run() === 0) pass++; else fails.push('rider placement differs from vanilla');
let breaks = 0;
const saved = Rd.updatePassengerPosition;
Rd.updatePassengerPosition = (v, r) => { saved(v, r); r.y += 0.1; };
if (run() > 0) breaks++;
Rd.updatePassengerPosition = saved;
if (breaks === 1) pass++; else fails.push('corruption not caught');
console.log(fails.length ? 'FAIL ' + fails.join('; ') : `jockeypositioncheck: ${pass} passed, 0 failed, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
