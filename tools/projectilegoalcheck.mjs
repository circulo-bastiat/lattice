#!/usr/bin/env node
// projectilegoalcheck.mjs — #2909: ProjectileAttackGoal canSee gating on the shot, shouldContinue's !isIdle half,
// and the 30deg/tick look turn (drowned trident / witch / snow golem).
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07k_goals.js'], dom: false });
const Ai = MCL.Ai;
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fails++; console.log('FAIL ' + m); } };

const av = (c, m) => { breaks++; ok(c, m); if (c) console.log('   ✓ ' + m); };
function run(sees, ticks) {
  const f = Ai.findPath, s = Ai.stepToward, cs = Ai.canSee;
  Ai.findPath = () => [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }];
  Ai.stepToward = () => {}; Ai.closeTo = Ai.closeTo;
  Ai.canSee = () => sees;
  let shots = 0, e, g, midYaw = null, cont = null;
  try {
    e = { x: 0.5, y: 64, z: 0.5, height: 1.8, yaw: 0, target: { x: 5.5, y: 64, z: 0.5, height: 1.8, health: 20 } };
    g = new Ai.ProjectileAttackGoal(e, 1.0, 40, 40, 10, () => shots++);
    g.canUse(); g.start();
    for (let i = 0; i < ticks; i++) { g.tick(); if (i === 0) midYaw = e.yaw; }
    e.target = null; cont = g.canContinueToUse();
  } finally { Ai.findPath = f; Ai.stepToward = s; Ai.canSee = cs; }
  return { shots, midYaw, cont };
}
const seen = run(true, 90), blind = run(false, 90);
ok(seen.shots >= 1, 'seen target is shot (got ' + seen.shots + ')');
ok(blind.shots === 0, 'target behind a wall is never shot (got ' + blind.shots + ')');
// target due east (+x): atan2(5,-0) = pi/2 ~ 90deg; first tick may turn at most 30deg
ok(Math.abs(seen.midYaw) <= 30 * Math.PI / 180 + 1e-9 && seen.midYaw !== 0, 'first-tick turn capped at 30deg (got ' + seen.midYaw + ')');
ok(run(false, 3).cont === true, 'target gone but path unfinished: shouldContinue stays true');
// anti-vacuity: the gate must be what stops the shot — with sight the same run DOES shoot
av(!(run(true, 90).shots === 0), 'anti-vacuity: seen run shoots, so the wall check can fail');
av(!(run(true, 3).midYaw === Math.PI / 2), 'anti-vacuity: a yaw snap would be detected');
console.log(`${pass} checks passed, ${fails} failures`);
process.exit(fails ? 1 : 0);
