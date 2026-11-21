#!/usr/bin/env node
// bobcheck.mjs -- #397 G10d: view-bob amplitude is fed the post-friction velocity, zeroed while riding.
//
//   node tools/bobcheck.mjs
//
// Vanilla PlayerEntity.tickMovement: min(0.1, getVelocity().horizontalLength()) after friction;
// tickRiding zeroes it and a passenger never accumulates walkDist/moveDist.
import { loadEngine } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function run(patch) {
  const M = loadEngine({ extra: ['14b_physics.js', '14_player.js'], dom: false, patch });
  const P = M.Player;
  M.Input = { uiOpen: true, locked: false, down: () => false };
  let step = 0, vel = 0;       // displacement per tick, post-friction velocity
  M.Physics = { tick: (p) => { p.x += step; p.vx = vel; p.vz = 0; } };
  M.Survival = { movement() {}, jumped() {}, tick() {} };
  const veh = { dead: false, x: 0, y: 50, z: 0, onGround: true };
  M.Mount = { isRidden: () => true, mountedHeightOffset: () => 0, riderOffset: () => ({ x: 0, y: 0, z: 0 }), travelRidden() {} };
  const base = { mode: 0, dead: false, invulnerableGamemode: false, onGround: true, sprinting: false,
    swimming: false, x: 0.5, y: 50, z: 0.5, vehicle: null, bob: 0, oBob: 0, walkDist: 0, moveDist: 0 };
  const go = (s, v, n, o) => {
    step = s; vel = v;
    Object.assign(P, base, o || {});
    for (let i = 0; i < n; i++) { if (o && o.vehicle) { veh.x += s; } P.tick(); }
    return { bob: P.bob, walkDist: P.walkDist, moveDist: P.moveDist };
  };
  return {
    sneak: go(0.0648, 0.0648 * 0.546, 60),
    walk: go(0.2158, 0.1178, 60),
    ride: go(0.2, 0.1, 20, { vehicle: veh }),
  };
}
const check = (o) => {
  ok(Math.abs(o.sneak.bob - 0.0354) < 1e-3, 'sneak bob ~0.0354, got ' + o.sneak.bob);
  ok(Math.abs(o.walk.bob - 0.1) < 1e-6, 'walk bob 0.1, got ' + o.walk.bob);
  ok(o.ride.bob === 0, 'mounted bob 0, got ' + o.ride.bob);
  ok(o.ride.walkDist === 0 && o.ride.moveDist === 0, 'mounted walkDist/moveDist unchanged, got ' + o.ride.walkDist + '/' + o.ride.moveDist);
  ok(o.walk.walkDist > 1, 'unmounted walkDist advances, got ' + o.walk.walkDist);
  return fails.length;
};
console.log('bobcheck -- #397, bob amplitude');
const good = run();
if (process.argv.includes('--verbose')) console.log(good);
check(good);
const breaksList = [
  ['displacement fed back', (f, s) => f === '14_player.js' ? s.replace('Math.sqrt(P.vx * P.vx + P.vz * P.vz)', 'hdist') : s],
  ['bob while riding', (f, s) => f === '14_player.js' ? s.replace('(!riding && P.onGround && !P.dead && !P.swimming) ? Math.min(0.1, Math.sqrt(P.vx * P.vx + P.vz * P.vz))', '(P.onGround && !P.dead && !P.swimming) ? Math.min(0.1, hdist)') : s],
  ['walkDist while riding', (f, s) => f === '14_player.js' ? s.replace('if (!riding) P.walkDist', 'if (true) P.walkDist') : s],
];
for (const [name, patch] of breaksList) {
  let o; try { o = run(patch); } catch (e) { o = { sneak: {}, walk: {}, ride: {} }; }
  const saved = fails.length, p0 = pass;
  check(o);
  const caught = fails.length > saved;
  fails.length = saved; pass = p0;
  breaks++;
  if (caught) { pass++; console.log('  ✓ break caught: ' + name); } else fails.push('anti-vacuity: not caught: ' + name);
}
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`${pass} checks passed, 0 failures (${breaks} breaks caught)`);
