#!/usr/bin/env node
// dolphinboatcheck.mjs — #1875 (derived from dolphincheck head): ChaseBoatGoal keys on player input + per-tick push. #716: DolphinEntity.initGoals is built (src/07zj2_dolphin.js + Ai.ROSTER.dolphin). Headless trace of the
// real goals through Ai.GoalSelector + Dolphin.travelMob against .decomp DolphinEntity/BreatheAirGoal/DolphinJumpGoal.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const MODS = []; for (const m of readFileSync(join(MCLITE_ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Dolphin.init();
const EL = M.EntityList, W = M.World, S = M.States, Dol = M.Dolphin;
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const stone = S.stateOf('stone') | 0, water = S.stateOf('water') | 0;
// a pool: water y 1..10 inside stone walls, air above (y 11..14), open roof
for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) for (let y = 0; y <= 14; y++) {
  const wall = Math.abs(x) === 12 || Math.abs(z) === 12 || y === 0;
  W.setBlock(x, y, z, wall ? stone : (y <= 10 ? water : 0));
}
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
let seed = 777;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
EL.random = rng;
const fresh = (y) => { EL.list.length = 0; const e = EL.spawn('dolphin', 0.5, y, 0.5); e.inWater = true; return e; };

console.log('dolphinboatcheck — #1875: ChaseBoatGoal');
const mk = (input, vx) => {
  const e = fresh(5.5), boat = { type: 'boat', x: 2, y: 8, z: 2, removed: false, vx: vx, vz: 0, riderInput: input };
  const p = { x: 2, y: 8, z: 2, yaw: 0, vx: vx, vz: 0, vehicle: boat }; boat.rider = p; M.Player = p; EL.list.push(boat);
  return { e, p, goal: e.ai.entries.map((x) => x.goal).find((gl) => gl instanceof Dol.ChaseBoatGoal) };
};
{
  const a = mk({ forwardSpeed: 1, sidewaysSpeed: 0 }, 0);       // keys down against a wall: velocity 0
  ok(a.goal.canUse(), 'input with zero velocity starts the chase');
  const b = mk({ forwardSpeed: 0, sidewaysSpeed: 0 }, 0.3);     // drifting, no keys
  ok(!b.goal.canUse(), 'drifting boat without input does not start the chase');
  a.goal.start(); a.e.zza = 0; a.e.dolFwd = 1; a.e.yaw = 0; a.e.vx = 0; a.e.vz = 0; a.goal.tick();
  ok(Math.abs(a.e.vz) > 0.001 || a.e.z !== 0.5, 'tick pushes the dolphin from the travel input (dolFwd, zza stays 0)');
  // anti-vacuity: break the input, each case must flip
  okAv(!mk({ forwardSpeed: 0, sidewaysSpeed: 0 }, 0.3).goal.canUse(), 'velocity-only boat is ignored');
  okAv(mk({ sidewaysSpeed: -1 }, 0).goal.canUse(), 'sideways input alone counts');
  const c = mk({ forwardSpeed: 1 }, 0); c.goal.start(); c.p.vehicle.riderInput = { forwardSpeed: 0 };
  okAv(!c.goal.canContinueToUse(), 'releasing the keys ends the chase');
}
console.log('================ dolphinboatcheck ================');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
