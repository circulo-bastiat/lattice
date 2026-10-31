#!/usr/bin/env node
// wandertargetcheck.mjs — #3679: Ai.WanderNearTargetGoal = WanderNearTargetGoal.java (findTo(16,7,target,PI/2) point, null refuses;
// shouldContinue needs a live path, a live target and distSq < max^2). Breaks its own goal and must notice each.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07_world.js', '07k_goals.js'] }), Ai = M.Ai;
const real = Ai.findTowardPositionTarget, realPath = Ai.findPath;
let fails = 0, breaks = 0;
function run(label, goalCls, expectBreak) {
  const bad = [];
  const ck = (n, c) => { if (!c) bad.push(n); };
  const e = { x: 0, y: 64, z: 0, target: { x: 10, y: 64, z: 0 } };
  Ai.findPath = () => [{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }];
  Ai.findTowardPositionTarget = () => null;
  let g = new goalCls(e, 0.9, 1024);
  ck('refuses when no findTo point', !g.canUse());
  Ai.findTowardPositionTarget = () => ({ x: 5.5, y: 64, z: 0.5 });
  g = new goalCls(e, 0.9, 1024);
  ck('accepts with a point', g.canUse());
  g.start();
  ck('continues', g.canContinueToUse());
  e.target.dead = true; ck('stops on dead target', !g.canContinueToUse()); e.target.dead = false;
  e.target.x = 100; ck('stops out of range', !g.canContinueToUse()); e.target.x = 10;
  g.stop(); ck('idle after stop', !g.canContinueToUse());
  Ai.findTowardPositionTarget = real; Ai.findPath = realPath;
  if (expectBreak) { if (bad.length) { breaks++; console.log(' ✓ ' + label + ': caught'); } else { fails++; console.log('FAIL ' + label + ': break not caught'); } }
  else if (bad.length) { fails++; console.log('FAIL ' + label + ': ' + bad.join(', ')); }
}
run('real', Ai.WanderNearTargetGoal, false);
const old = function (e, s, m) {   // the pre-#3679 straight-step goal
  this.canUse = () => !!e.target; this.canContinueToUse = () => !!e.target; this.start = () => {}; this.stop = () => {};
};
run('old straight-step goal', old, true);
const old2 = function (e, s, m) {   // never refuses, never stops
  this.canUse = () => true; this.canContinueToUse = () => true; this.start = () => {}; this.stop = () => {};
};
run('always-on goal', old2, true);
console.log('wandertargetcheck: 6 assertions, ' + fails + ' failures, ' + breaks + ' breaks caught');
process.exit(fails ? 1 : 0);
