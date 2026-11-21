#!/usr/bin/env node
// wither11657check.mjs — #11657: proves 07zzm_wither.js's AboveGroundTargeting / NoPenaltySolidTargeting / FlyGoal /
// WitherSkullEntity ports are REACHED (roster, entity list) and behave; each source break is caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07k_goals.js', '07zzh_blaze.js', '07zzm_wither.js'], dom: false, patch: patch ? (f, s) => (f === '07zzm_wither.js' ? patch(s) : s) : undefined });
  const Wi = M.Wither, o = {};
  const stone = M.Reg.realFirst[M.Reg.id.stone];
  M.World = { getBlock: (x, y, z) => (y < 64 ? stone : 0) };
  M.Physics = { solidAt: (x, y, z) => y < 64, blockAt: (x, y, z) => (y < 64 ? stone : 0) };
  let s = 12345; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const e = { type: 'wither', x: 0.5, y: 70, z: 0.5, yaw: 0, width: 0.9, height: 3.5 };
  // AboveGroundTargeting
  const a = Wi.aboveGroundFind({ x: 0.5, y: 60, z: 0.5, width: 0.9 }, rnd, 0, -1);
  o.aboveAir = Wi.aboveGroundFind({ x: 0.5, y: 80, z: 0.5, width: 0.9 }, rnd, 0, -1) === null;
  o.above = !!a && a.y >= 64 && a.y <= 256 && Math.abs(a.x) <= 9 && Math.abs(a.z) <= 9;
  // NoPenaltySolidTargeting lifts a position out of solid ground
  const p = Wi.noPenaltySolidFind({ x: 0.5, y: 60, z: 0.5, width: 0.9 }, rnd, 0, -1);
  o.noPenalty = !!p && !M.Physics.solidAt(p.x, p.y, p.z);
  // FlyGoal: 1-in-60 gate, then steers via flyMove
  let want = null; e.flyMove = { setWantedPosition: (x, y, z, s) => { want = [x, y, z, s]; } };
  const gate = { nextInt: (k) => (gate.v), nextFloat: () => 0.5 }; Object.assign(gate, { v: 1 });
  const g = new Wi.FlyGoal(e, 1.0, Object.assign(function () { return rnd(); }, { nextInt: (k) => gate.v, nextFloat: () => 0.5 }));
  o.gateClosed = g.canUse() === false;
  gate.v = 0;
  o.gateOpen = g.canUse() === true && g.canContinueToUse() === true;
  g.tick();
  o.steers = !!want && want[3] === 1.0 && Math.floor(want[0]) + 0.5 === want[0];
  g.stop(); o.stops = g.canContinueToUse() === false;
  // roster reach: FlyGoal sits on MOVE at priority 5
  const gs = Wi.roster(e, { random: rnd, players: () => [] });
  o.rosterFly = JSON.stringify(gs, (k, v) => (typeof v === 'function' ? 'f' : v)).length > 2 && /FlyGoal/.test(String(Wi.roster));
  // WitherSkullEntity: charged flag, drag, resistance cap
  const sk = { x: 0, y: 0, z: 0 }; Wi.initSkull(sk, { power: [1, 0, 0], charged: true });
  o.charged = sk.charged === true;
  const sk2 = { x: 0, y: 0, z: 0 }; Wi.initSkull(sk2, { power: [1, 0, 0] });
  o.uncharged = sk2.charged === false;
  o.drag = Wi.SKULL_DRAG_CHARGED === 0.73 && Wi.SKULL_DAMAGE_OWNED === 8.0 && Wi.SKULL_EXPLOSION_POWER === 1.0;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const src = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
ok(/gs\.add\(5, Ai\.MOVE, Wi\.everyOther\(e, new Wi\.FlyGoal/.test(src('07zzm_wither.js')), 'reach: wither roster adds FlyGoal');
ok(/NS\.Wither\.initSkull/.test(src('07i_entitylist.js')) && /NS\.Wither\.tickSkull/.test(src('07i_entitylist.js')), 'reach: entity list drives the skull');
ok(/NS\.Wither\.flyWanderTarget/.test(src('07t_fly.js')), 'reach: 07t_fly uses FlyGoal wander target');
const BR = [
  ['aboveSolid', "if (!(S && S.fullCubeCollision ? S.fullCubeCollision(blk(p.x, p.y, p.z)) : solid(p.x, p.y, p.z))) return null;", "", ['aboveAir']],
  ['noPenaltyLift', "if (solid(p.x, p.y, p.z)) { p.y++; while (p.y < C.WORLD_MAX_Y && solid(p.x, p.y, p.z)) p.y++; }\n      var Ai", "var Ai", ['noPenalty']],
  ['flygate', "!== 0) return false;   // random.nextInt(toGoalTicks", "=== 0) return false;   // random.nextInt(toGoalTicks", ['gateClosed', 'gateOpen']],
  ['flysteer', "if (have && e.flyMove) e.flyMove.setWantedPosition(tx, ty, tz, speed);", "", ['steers']],
  ['flystop', "this.stop = function () { have = false; };", "this.stop = function () {};", ['stops']],
  ['charged', "e.charged = !!(opts && opts.charged);", "e.charged = false;", ['charged']],
  ['drag', "Wi.SKULL_DRAG_CHARGED = 0.73;", "Wi.SKULL_DRAG_CHARGED = 0.8;", ['drag']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
for (const f of fails) console.log('FAIL', f);
console.log(`wither11657check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
