#!/usr/bin/env node
// swimdistcheck.mjs -- #503 G5: swimming / submerged exhaustion is 3D, surface-touching is horizontal.
//
//   node tools/swimdistcheck.mjs
//
// Drives the real P.tick with a stub Physics that moves the player and a recording Survival.movement.
// Vanilla PlayerEntity.increaseTravelMotionStats: isSwimming / submerged use sqrt(dx2+dy2+dz2);
// merely touching water uses sqrt(dx2+dz2). Anti-vacuity: the 3D term is broken in the source.
import { loadEngine } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function run(patch) {
  const M = loadEngine({ extra: ['14b_physics.js', '14_player.js'], dom: false, patch });
  const P = M.Player;
  let moved = 0, dy = 0;
  M.Input = { uiOpen: true, locked: false, down: () => false };
  M.Physics = { tick: (p) => { p.y += dy; } };
  M.Survival = { movement: (p, d) => { moved += d; }, jumped() {}, tick() {} };
  const go = (o, dyv) => {
    moved = 0; dy = dyv;
    Object.assign(P, { mode: 0, dead: false, invulnerableGamemode: false, onGround: false, sprinting: false,
      inWater: true, eyeInWater: false, x: 0.5, y: 50, z: 0.5, vy: 0 }, o);
    P.tick();
    return moved;
  };
  return {
    dive: go({ eyeInWater: true }, -1),
    surface: go({ eyeInWater: false }, -1),
    sprintSwim: go({ sprinting: true }, -1),
  };
}
const check = (o) => {
  ok(Math.abs(o.dive - 1) < 1e-9, 'submerged vertical move counts 1 block, got ' + o.dive);
  ok(o.surface === 0, 'surface vertical move counts 0, got ' + o.surface);
  ok(Math.abs(o.sprintSwim - 1) < 1e-9, 'swimming vertical move counts 1 block, got ' + o.sprintSwim);
  return fails.length;
};
console.log('swimdistcheck -- #503, 3D swim distance');
const good = run();
if (process.argv.includes('--verbose')) console.log(good);
check(good);
const breaksList = [
  ['horizontal only', (f, s) => f === '14_player.js' ? s.replace('dist = Math.sqrt(dist * dist + dyv * dyv);', '') : s],
  ['surface also 3D', (f, s) => f === '14_player.js' ? s.replace('(P.eyeInWater || P.sprinting)', 'true') : s],
];
for (const [name, patch] of breaksList) {
  let o; try { o = run(patch); } catch (e) { o = {}; }
  const saved = fails.length, p0 = pass;
  check(o);
  const caught = fails.length > saved;
  fails.length = saved; pass = p0;
  breaks++;
  if (caught) { pass++; console.log('  ✓ break caught: ' + name); } else fails.push('anti-vacuity: not caught: ' + name);
}
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`${pass} checks passed, 0 failures (${breaks} breaks caught)`);
