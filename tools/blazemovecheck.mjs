#!/usr/bin/env node
// blazemovecheck.mjs — #2796: BlazeEntity.ShootFireballGoal.tick calls getMoveControl().moveTo(target) and
// never touches navigation, so the port must call Ai.stepToward straight at the target and never Ai.findPath.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07k_goals.js', '07zzh_blaze.js'], dom: false });
const Ai = MCL.Ai, Bl = MCL.Blaze;
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fails++; console.log('FAIL ' + m); } };

function run(pathing) {
  let paths = 0; const steps = [];
  const f = Ai.findPath, s = Ai.stepToward, cs = Ai.canSee;
  Ai.findPath = () => { paths++; return [{ x: 0, y: 0, z: 0 }, { x: 9, y: 9, z: 9 }]; };
  Ai.stepToward = (e, n, sp) => steps.push([n.x + 0.5, n.y, n.z + 0.5, sp]);
  Ai.canSee = () => true;
  try {
    const e = { x: 0.5, y: 64, z: 0.5, height: 1.8, target: { x: 1.5, y: 64, z: 1.5, height: 1.8, health: 20 } };
    const g = new Bl.ShootFireballGoal(e);
    g.start(); g.tick(); g.tick();   // distSq 2 < 4: close branch
    if (pathing) Ai.findPath(0, 0, 0, 0, 0, 0);
  } finally { Ai.findPath = f; Ai.stepToward = s; Ai.canSee = cs; }
  return { paths, steps };
}
const r = run(false);
ok(r.paths === 0, 'goal must not call Ai.findPath (got ' + r.paths + ')');
ok(r.steps.length === 2 && r.steps[0][0] === 1.5 && r.steps[0][1] === 64 && r.steps[0][2] === 1.5 && r.steps[0][3] === 1.0,
  'straight steer at the target, speed 1.0 (got ' + JSON.stringify(r.steps) + ')');
breaks++; ok(run(true).paths === 1, 'anti-vacuity: findPath spy detects a call');
console.log(`${pass} checks passed, ${fails} failures`);
console.log('✓ anti-vacuity: findPath spy detects a call');
process.exit(fails ? 1 : 0);
