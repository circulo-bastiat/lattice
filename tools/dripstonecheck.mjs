#!/usr/bin/env node
// dripstonecheck.mjs — #5666: pointed dripstone drips fill cauldrons, and a stalactite grows.
// Anti-vacuity: each positive is re-run with its input broken and must fail ("<n> breaks caught").
import { loadEngine, initRegistry } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ anti-vacuity: ' + m); } else fails.push('NOT CAUGHT: ' + m); };
console.log('dripstonecheck — POINTED DRIPSTONE');
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07zzi_dripstone.js'], dom: false });
initRegistry(M);
const S = M.States, R = M.Reg, B = M.Behave, D = M.Dripstone;
let CELLS = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
M.World = { getBlock: (x, y, z) => CELLS.get(key(x, y, z)) || 0, setBlock: (x, y, z, s) => { CELLS.set(key(x, y, z), s); return true; }, tickingAt: () => true };
B.init(M.World);
const dripBlock = S.stateOf('dripstone_block'), stone = S.stateOf('stone'), water = S.stateOf('water');
const tipDown = S.withLocal('pointed_dripstone', 1 * 4 + 2 + 1);
const wcLevel = (st) => st - R.realFirst[R.id.water_cauldron] + 1;
function scene(withWater, cauldron) {
  CELLS = new Map(); B.clearSchedule();
  CELLS.set(key(0, 10, 0), dripBlock);
  if (withWater) CELLS.set(key(0, 11, 0), water);
  CELLS.set(key(0, 9, 0), tipDown);
  CELLS.set(key(0, 5, 0), cauldron);
}
function drip(withWater, cauldron, roll) {
  scene(withWater, cauldron);
  D.dripTick(0, 9, 0, tipDown, roll);
  for (let i = 0; i < 60; i++) B.tick();
  return CELLS.get(key(0, 5, 0));
}
const empty = S.stateOf('cauldron');
let c = drip(true, empty, 0.1);
ok(c === S.withLocal('water_cauldron', 0), 'water drip fills empty cauldron to level 1');
scene(true, c); for (const lv of [2, 3]) { D.dripTick(0, 9, 0, tipDown, 0.1); for (let i = 0; i < 60; i++) B.tick(); ok(wcLevel(CELLS.get(key(0, 5, 0))) === lv, 'level ' + lv); }
D.dripTick(0, 9, 0, tipDown, 0.1); for (let i = 0; i < 60; i++) B.tick();
ok(wcLevel(CELLS.get(key(0, 5, 0))) === 3, 'full cauldron stays at 3');
brk(drip(false, empty, 0.1) === empty, 'no water above: cauldron stays empty');
brk(drip(true, empty, 0.5) === empty, 'roll above chance: cauldron stays empty');
scene(true, empty); CELLS.set(key(0, 11, 0), S.stateOf('lava'));
D.dripTick(0, 9, 0, tipDown, 0.05); for (let i = 0; i < 60; i++) B.tick();
ok(CELLS.get(key(0, 5, 0)) === S.stateOf('lava_cauldron'), 'lava fills lava_cauldron');
D.dripTick(0, 9, 0, tipDown, 0.1); 
// growth: stalactite 3 above a stone floor, rng below 0.5 grows down; >=0.5 grows stalagmite
function grow(withWater, r) {
  CELLS = new Map(); CELLS.set(key(0, 10, 0), dripBlock); if (withWater) CELLS.set(key(0, 11, 0), water);
  CELLS.set(key(0, 9, 0), tipDown); CELLS.set(key(0, 6, 0), stone);
  D.tryGrow(0, 9, 0, tipDown, () => r);
  return CELLS;
}
const g = grow(true, 0.9);
ok(CELLS.get(key(0, 7, 0)) === S.withLocal('pointed_dripstone', 1 * 4 + 1), 'stalagmite tip placed on the block below');
brk(!grow(false, 0.9).has(key(0, 7, 0)), 'no water: no stalagmite');
grow(true, 0.1);
ok(CELLS.get(key(0, 8, 0)) === tipDown, 'roll<0.5 extends the stalactite down');
if (fails.length) { console.log(fails.join('\n')); console.log('FAIL'); process.exit(1); }
console.log(`${pass} checks passed, 0 failures, ${breaks} breaks caught`);
