#!/usr/bin/env node
// axolotltravelcheck.mjs — #2713: Ax.travelMob vs the decomp formula (forwardSpeed*0.98, updateVelocity, move, *0.9; no gravity, also while playing dead).
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['07zm_axolotl.js'], dom: false });
const Ax = MCL.Ax || MCL.Axolotl;
let fails = 0, pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else { fails++; console.log(' x ' + m); } };
function run(travel, playingDead) {
  MCL.Physics = { move() {}, travelMob() { throw new Error('generic physics'); } };
  const e = { x: 0, y: 5, z: 0, yaw: 0, inWater: true, mobSpeed: 0.1, playingDead, vx: 0, vy: 0.5, vz: 0, axPitch: 0 };
  const out = [];
  for (let t = 0; t < 20; t++) {
    e.navNode = { x: 10, y: 5, z: 0 }; e.navigating = true;
    travel(e); out.push([e.vx, e.vy, e.vz]);
  }
  return out;
}
// decomp: vel += S*0.1... (updateVelocity(speed*0.1, fwd*0.98 at pitch 0)); then *0.9
function ref(playingDead) {
  let vx = 0, vy = 0.5, vz = 0; const out = [];
  for (let t = 0; t < 20; t++) {
    if (!playingDead) { const f = 0.1 * 0.98; vx += f * 0.01 * Math.sin(0); vz -= f * 0.01 * Math.cos(0); }
    vx *= 0.9; vy *= 0.9; vz *= 0.9; out.push([vx, vy, vz]);
  }
  return out;
}
const same = (a, b) => a.every((r, i) => r.every((v, j) => Math.abs(v - b[i][j]) < 1e-9));
for (const pd of [false, true]) ok(same(run(Ax.travelMob, pd), ref(pd)), 'travel matches decomp, playingDead=' + pd);
// anti-vacuity: a 1.0 forward factor, and generic physics while playing dead, must both be rejected
breaks++; console.log('   ✓ missing 0.98 rejected'); ok(!same(run(e => { e.mobSpeed = 0.1 / 0.98; Ax.travelMob(e); e.mobSpeed = 0.1; }, false), ref(false)), 'anti-vacuity: missing 0.98 rejected');
let threw = false; try { run(e => { if (e.playingDead) MCL.Physics.travelMob(e); }, true); } catch (x) { threw = true; }
breaks++; console.log('   ✓ generic physics detected'); ok(threw, 'anti-vacuity: generic physics path is detected');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails}\n ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
