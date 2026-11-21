#!/usr/bin/env node
// waterdragcheck.mjs -- #3610: LivingEntity.travel's water drag is getBaseMovementSpeedMultiplier()
// (default 0.8F, PolarBearEntity 0.98F, SkeletonHorseEntity 0.96F), not a hard-coded 0.8 for every mob.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['14b_physics.js'], dom: false });
const Ph = MCL.Physics;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
Ph.move = () => {};   // velocity only: the drag is what is under test
const vx = (type) => { const e = { type, inWater: true, vx: 1, vy: 0, vz: 0, x: 0, y: 0, z: 0, yaw: 0, effects: [] }; Ph.travelMob(e, 0); return e.vx; };
const near = (a, b) => Math.abs(a - b) < 1e-6;
ok(near(vx('polar_bear'), 0.98), 'polar_bear keeps 0.98 of its water speed, got ' + vx('polar_bear'));
ok(near(vx('skeleton_horse'), 0.96), 'skeleton_horse keeps 0.96, got ' + vx('skeleton_horse'));
ok(near(vx('cow'), 0.8), 'a cow keeps the default 0.8, got ' + vx('cow'));
const w = Ph.WATER_SLOWDOWN; Ph.WATER_SLOWDOWN = 0.5;
okAv(near(vx('cow'), 0.5) && near(vx('polar_bear'), 0.98), 'the default really comes from WATER_SLOWDOWN and the bear ignores it');
Ph.WATER_SLOWDOWN = w;
console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity probes included, ${breaks} breaks caught)`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
