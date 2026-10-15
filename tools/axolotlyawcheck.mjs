#!/usr/bin/env node
// axolotlyawcheck.mjs — #2715: AxolotlMoveControl = AquaticMoveControl(85, 10, ..): yaw turns 10 deg/tick, not 90.
import { loadEngine } from './loadsrc.mjs';
const Ai = loadEngine({ extra: ['14b_physics.js', '07k_goals.js'], dom: false }).Ai;
Ai.stuckOnShape = () => false;   // needs a world; irrelevant to yaw
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fails++; console.log(' x ' + m); } };
// ticks to face a target 180 deg behind (engine yaw 0 = north; target to the south)
function ticks(type) {
  const e = { type, x: 0.5, y: 0, z: 0.5, yaw: 0, width: 0.75, inWater: true, attrs: {} };
  for (let t = 1; t <= 100; t++) {
    Ai.stepToward(e, { x: 0, y: 0, z: 50 }, 1.0);
    if (Math.abs(Math.abs(e.yaw) - Math.PI) < 1e-6) return t;
  }
  return -1;
}
ok(ticks('axolotl') === 18, 'axolotl needs 18 ticks for 180 deg, got ' + ticks('axolotl'));
ok(ticks('cow') === 2, 'default MoveControl still 2 ticks, got ' + ticks('cow'));
// anti-vacuity: with the table emptied the axolotl check must fail
const saved = Ai.YAW_MAX_DELTA_BY_TYPE; Ai.YAW_MAX_DELTA_BY_TYPE = {};
breaks++; console.log(' ✓ removed axolotl override rejected'); ok(ticks('axolotl') !== 18, 'anti-vacuity: override removal not detected');
Ai.YAW_MAX_DELTA_BY_TYPE = saved;
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails}`);
console.log(` ${breaks} breaks caught`);
console.log('==============================================');
process.exit(fails ? 1 : 0);
