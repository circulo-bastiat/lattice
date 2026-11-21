#!/usr/bin/env node
// #4024: BreatheAirGoal.tick = moveToAir + updateVelocity(0.02F, last input) + an extra move(velocity).
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function run(patch) {
  const M = loadEngine({ extra: ['07zj2_dolphin.js'], dom: false, initReg: false, patch });
  const moves = []; let tgt = null;
  M.World = { getBlock: () => 0 }; M.Ai = Object.assign(M.Ai || {}, { findPath: (...a) => (tgt = a.slice(3, 6), null) });
  M.Physics = Object.assign(M.Physics || {}, { move: (e, x, y, z) => moves.push([x, y, z]) });
  const e = { x: 0.5, y: 5, z: 0.5, air: 100, yaw: 0, vx: 0, vy: 0, vz: 0, dolFwd: 1, dolUp: 0 };
  const g = new M.Dolphin.BreatheAirGoal(e);
  g.tick();
  return tgt.join() === '-1,6,-1' && moves.length === 1 && Math.abs(moves[0][2] + 0.02) < 1e-9;
}
ok(run(null), 'goal tick moves once with +0.02 velocity along yaw');
let caught = 0;
for (const [a, b] of [['Ph.move(e, e.vx || 0, e.vy || 0, e.vz || 0);\n    };', ';\n    };'], ['var k = 0.02 /', 'var k = 0.5 /'], ['moveTo(e, t.x, t.y + 1, t.z, 1.0)', 'moveTo(e, t.x + 0.5, t.y + 1, t.z, 1.0)']]) {
  if (!run((f, s) => f === '07zj2_dolphin.js' ? s.replace(a, b) : s)) { caught++; console.log('  ✓ break caught'); } else fails.push('break not caught: ' + a);
}
ok(caught === 3, "all breaks caught");
console.log(`  ${caught} breaks caught`);
console.log(`dolphinbreathecheck: ${pass} checks passed, ${fails.length} failures (${caught} anti-vacuity)`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
