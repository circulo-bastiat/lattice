#!/usr/bin/env node
// vbidle11660check.mjs — #11660: proves 07zv4_vbidle.js's LookTarget (goTowardsLookStart), NearestBedSensor
// (nearestBedSensorTick) and JumpInBedTask (jumpInBedStart/bedJumpTick) are REACHED from 07zv_villagerbrain.js
// (VB.tick -> sensor; idleFallbackTick/tickIdle -> IDLE_START/idleContinue) and that cutting each breaks a scenario.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const FILES = ['07m_breed.js', '07zv_villagerbrain.js', '07zv4_vbidle.js'];
function trial(patch) {
  const M = loadEngine({ extra: FILES, dom: false, patch: patch ? (f, s) => (f === '07zv4_vbidle.js' ? patch(s) : s) : undefined });
  const VB = M.VB || M.VillagerBrain; const o = {};
  const names = M.Reg.names; let bed = 0;
  for (let st = 1; st < 20344 && !bed; st++) if (names[M.States.block[st]] === 'red_bed') bed = st;
  const cells = {};
  M.World = { getBlock: (x, y, z) => cells[x + ',' + y + ',' + z] || 0 };
  cells['5,64,5'] = bed;
  VB.rand = () => 0;
  // LookTarget: GoTowardsLookTarget needs LOOK_TARGET present and WALK_TARGET absent
  const L = { vbLookTarget: { x: 9, y: 64, z: 9 } };
  o.lookStart = VB.IDLE_START.goTowardsLook(L) === true && L.vbWalkTarget.x === 9 && L.vbWalkTarget.range === 2;
  o.lookBlocked = VB.IDLE_START.goTowardsLook({ vbLookTarget: { x: 1, y: 1, z: 1 }, vbWalkTarget: { x: 0, y: 0, z: 0 } }) === false;
  o.lookNone = VB.IDLE_START.goTowardsLook({}) === false;
  // JumpInBedTask: baby standing on a bed jumps 3+ times then ends; adults refuse; bed gone ends it
  const B = { isBaby: true, x: 5.5, y: 64.1, z: 5.5 };
  o.bedStart = VB.IDLE_START.jumpInBed(B) === true && B.vbBedJump.bedPos.x === 5 && B.vbBedJump.jumpsRemaining === 3 && B.vbWalkTarget.range === 0;
  o.bedAdult = VB.IDLE_START.jumpInBed({ isBaby: false, x: 5.5, y: 64.1, z: 5.5 }) === false;
  let jumps = 0, n = 0;
  while (VB.idleContinue(B) && n++ < 100) { if (B.jumping) { jumps++; B.jumping = false; } }
  o.bedJumps = jumps >= 2 && !B.vbBedJump && n < 100;
  const C = { isBaby: true, x: 5.5, y: 64.1, z: 5.5 };
  VB.IDLE_START.jumpInBed(C); cells['5,64,5'] = 0;
  o.bedGone = VB.idleContinue(C) === false && !C.vbBedJump;
  cells['5,64,5'] = bed;
  const F = { isBaby: true, x: 20.5, y: 64, z: 20.5, vbBedJump: null };
  VB.IDLE_START.jumpInBed(F);
  o.bedOff = !F.vbBedJump;   // not above a bed and no nearest bed: refuses
  F.vbNearestBed = { x: 5, y: 64, z: 5 }; VB.IDLE_START.jumpInBed(F);
  let t = 0; while (VB.idleContinue(F) && t < 200) t++;
  o.bedTimeout = t === 99 || (t >= 99 && t <= 100);
  // NearestBedSensor: baby scans HOME POIs every 20 ticks, remembers the reached bed
  M.Poi = { ready: true, HOME: 'home', STATUS: { HAS_SPACE: 1 }, getInCircle: () => [{ x: 5, y: 64, z: 5 }, { x: 7, y: 64, z: 7 }] };
  M.Ai = { findPath: () => null }; VB.pathToAny = (e, c) => c[0];
  const S = { isBaby: true, x: 6, y: 64, z: 6 };
  VB.nearestBedSensorTick(S, 0);
  o.sensorCadence = !S.vbNearestBed && S.vbNBCd === 20 - 0 + 0 || (S.vbNBCd === 20 && !!S.vbNearestBed);
  o.sensorFound = !!S.vbNearestBed && S.vbNearestBed.x === 5;
  const keep = S.vbNearestBed; S.vbNearestBed = null;
  M.Poi.getInCircle = () => [{ x: 8, y: 64, z: 8 }];
  VB.nearestBedSensorTick(S, 1);
  o.sensorWaits = !S.vbNearestBed;
  const A = { isBaby: false, x: 6, y: 64, z: 6 };
  VB.nearestBedSensorTick(A, 0);
  o.sensorAdult = !A.vbNearestBed;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const vb = readFileSync(join(MCLITE_ROOT, 'src', '07zv_villagerbrain.js'), 'utf8');
ok(/VB\.nearestBedSensorTick\(e, tnow\)/.test(vb), 'reach: VB.tick -> nearestBedSensorTick');
ok(/VB\.idleContinue\(e, tnow\)/.test(vb), 'reach: tickIdle -> idleContinue (JumpInBedTask tick)');
const pl = readFileSync(join(MCLITE_ROOT, 'src', '07zv2_vbplay.js'), 'utf8');
ok(/VB\.IDLE_START\.jumpInBed\(e\)/.test(pl) && /VB\.IDLE_START\.goTowardsLook\(e\)/.test(pl), 'reach: play list -> IDLE_START jumpInBed/goTowardsLook');
ok(/IDLE_START/.test(vb), 'reach: idleFallbackTick -> IDLE_START');
const BR = [
  ['lookwalk', "if (e.vbWalkTarget) return false;\n    if (!e.vbLookTarget) return false;", "if (!e.vbLookTarget) return false;", ['lookBlocked']],
  ['lookrange', "z: e.vbLookTarget.z, range: 2 }", "z: e.vbLookTarget.z, range: 0 }", ['lookStart']],
  ['lookreq', "    if (!e.vbLookTarget) return false;\n    e.vbWalkTarget", "    e.vbWalkTarget", ['lookNone']],
  ['bedbaby', "if (!e.isBaby) return false;\n    if (e.vbBedJump)", "if (e.vbBedJump)", ['bedAdult']],
  ['bedrange', "z: bed.z, range: 0 }", "z: bed.z, range: 2 }", ['bedStart']],
  ['bedjumps', "bj.jumpsRemaining--;", "", ['bedJumps']],
  ['bedgone', "|| !isBedNameAt(bj.bedPos.x, bj.bedPos.y, bj.bedPos.z)) {", ") {", ['bedGone']],
  ['bedtimeout', "if (bj.ticksOutOfBed <= 0) { e.vbBedJump = null; return false; }", "", ['bedTimeout']],
  ['sensorbaby', "if (!e.isBaby) return;\n    if ((e.vbNBCd", "if ((e.vbNBCd", ['sensorAdult']],
  ['sensorfound', "if (hit) e.vbNearestBed = ", "if (false) e.vbNearestBed = ", ['sensorFound']],
  ['sensorcd', "e.vbNBCd = 20;", "e.vbNBCd = 0;", ['sensorWaits']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  const pf = (s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; };
  try { X = trial(pf); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
for (const f of fails) console.log('FAIL', f);
console.log(`vbidle11660check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
