#!/usr/bin/env node
// goat11658check.mjs — #11658: proves 07zj_goat.js's TemptationCooldownTask (Gt.tickCooldowns), LeapingChargeTask
// (LongJumpGoal.canUse landing), BlockPosLookTarget (LongJumpGoal.tick yaw) and GoatEntity (adjustFallDamage, activity switch)
// are REACHED (07k_goals.js look tick -> tickRamHead; goat goal list -> LongJumpGoal) and that cutting each breaks a scenario.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07zj_goat.js'], dom: false, patch: patch ? (f, s) => (f === '07zj_goat.js' ? patch(s) : s) : undefined });
  const G = M.Goat, o = {};
  // TemptationCooldownTask: counts down then forgets; activity flips with it
  const e = { type: 'goat', x: 0, y: 0, z: 0 };
  G.remember(e, 'ram_cooldown_ticks', 2); G.remember(e, 'long_jump_cooling_down', 1);
  G.tickCooldowns(e);
  const m1 = G.brainTrace(e);
  G.tickCooldowns(e); G.tickCooldowns(e);
  const m3 = G.brainTrace(e);
  o.cooldownDown = m1.ram === 1 && m1.jump === 0 && m1.activity === 'idle';
  o.cooldownForget = m3.ram === null && m3.jump === null && m3.activity === 'ram';
  G.remember(e, 'tempting_player', true);
  o.temptBlocks = G.updateActivities(e) === 'idle';
  // GoatEntity.computeFallDamage: minus 10, only goats
  o.fall = G.adjustFallDamage({ type: 'goat' }, 14) === 4 && G.adjustFallDamage({ type: 'goat' }, 8) === 0 && G.adjustFallDamage({ type: 'cow' }, 14) === 14;
  // LeapingChargeTask: airborne keeps running; landing forgets mid_jump, rolls cooldown, resets pose
  const g = { type: 'goat', x: 0.5, y: 5, z: 0.5, vx: 1, vy: 1, vz: 1, onGround: false, leapPending: true, leapAge: 0, noDrag: true, pose: 'long_jumping', silent: true };
  G.remember(g, 'long_jump_mid_jump', true);
  const goal = new G.LongJumpGoal(g, { random: () => 0.5 });
  g.longJumpCooldown = 0;
  const air = goal.canUse(), pend = g.leapPending;
  g.onGround = true; goal.canUse();
  o.leapAir = air === false && pend === true;
  o.leapLand = g.leapPending === false && G.brainTrace(g).midJump === false && g.noDrag === false && g.pose === 'standing' && Math.abs(g.vx - 0.1) < 1e-9 && g.longJumpCooldown >= 600 && g.longJumpCooldown <= 1200;
  // BlockPosLookTarget: picking the target turns the goat to look at it
  const h = { type: 'goat', x: 0.5, y: 5, z: 0.5, onGround: true, silent: true, yaw: 0 };
  const hg = new G.LongJumpGoal(h, { random: () => 0, walkable: false });
  hg.start(); hg.tick();
  o.noTargetsOk = true;
  return o;
}
function lookTrial(patch) {
  const M = loadEngine({ extra: ['07zj_goat.js'], dom: false, patch: patch ? (f, s) => (f === '07zj_goat.js' ? patch(s) : s) : undefined });
  const G = M.Goat;
  M.Physics = M.Physics || {}; const P = M.Physics; P.blockAt = () => 1;
  M.States.fullCubeCollision = () => true; M.States.atten = new Proxy({}, { get: () => 15 });
  G.bestJumpVelocity = (x, y, z, tx) => (tx > 3 ? { x: 0.1, y: 0.5, z: 0 } : null);
  const h = { type: 'goat', x: 0.5, y: 5, z: 0.5, onGround: true, silent: true, yaw: 0 };
  const hg = new G.LongJumpGoal(h, { random: () => 0, walkable: false });
  hg.start(); const n = hg.tick ? (hg.tick(), 1) : 0;
  return { look: n === 1 && Math.abs(h.yaw) > 0.1 };
}
const A0 = trial(null); delete A0.noTargetsOk; Object.assign(A0, lookTrial(null));
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
const gl = rd('07k_goals.js');
ok(/NS\.Goat\.tickRamHead\(e\)/.test(gl), 'reach: AI look tick -> Goat.tickRamHead -> tickCooldowns');
ok(/new Gt\.LongJumpGoal\(e, ctx\)/.test(gl), 'reach: goat goal list -> LongJumpGoal');
const BR = [
  ['cdecrement', "if (v > 0) b.mem[n] = v - 1; else delete b.mem[n];", "if (v > 0) b.mem[n] = v; else delete b.mem[n];", ['cooldownDown']],
  ['cdforget', "else delete b.mem[n];", "else b.mem[n] = 0;", ['cooldownForget']],
  ['tempt', "var free = none('tempting_player') && none('breed_target');", "var free = true;", ['temptBlocks']],
  ['fall', "Math.max(0, (dmg | 0) - Gt.FALL_DAMAGE_SUBTRACTOR)", "dmg", ['fall']],
  ['leapair', "++e.leapAge < 100) return false;", "++e.leapAge < 0) return false;", ['leapAir']],
  ['leapforget', "Gt.forget(e, 'long_jump_mid_jump'); e.leapPending = false;", "e.leapPending = false;", ['leapLand']],
  ['leapcd', "e.longJumpCooldown = Gt.rollLongJumpCooldown(rand); }   // LeapingChargeTask", "}   // LeapingChargeTask", ['leapLand']],
  ['lookyaw', "e.yaw = Math.atan2(last.x + 0.5 - e.x, -(last.z + 0.5 - e.z));", "", ['look']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  const pf = (s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; };
  try { X = Object.assign(trial(pf), lookTrial(pf)); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
for (const f of fails) console.log('FAIL', f);
console.log(`goat11658check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
