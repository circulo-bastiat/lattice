#!/usr/bin/env node
// boatphys.mjs -- #308 (#308): boat velocity traces re-derived from BoatEntity's constants, headless.
//   node tools/boatphys.mjs
// Still water, land, ice, W held, two passengers' seats, fall break drop. Each assertion has an edited-source break (D-30).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

console.log('boatphys -- #308 (#308): boat velocity traces vs BoatEntity constants');
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const F = Math.fround;

function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); return c; };
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '07zzt_boat.js'], dom: false, patch });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  const S = M.States, B = M.Behave, EL = M.EntityList, Bt = M.Boat, R = M.Reg;
  const N = 48, MID = 24, cells = new Uint16Array(N * N * N);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
  M.World = { getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0), setBlock(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; return true; }, blockLightAt: () => 15 };
  const PHYS = rdj('block-physics.json');
  R.buildPhysics({ defaults: PHYS.defaults, exceptions: PHYS.exceptions });
  const Ph = M.Physics;
  Ph.shapeAt = (x, y, z) => { const id = M.World.getBlock(x, y, z); return id === 0 || S.solid[id] !== 1 ? null : Ph.shapesFor(id); };
  B.init(M.World); M.Entities.init(); EL.init();
  const st = (nm) => S.stateOf(nm) | 0;
  const world = (floor, depth) => {
    cells.fill(0); EL.list.length = 0;
    for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) {
      cells[idx(x, -1 - depth, z)] = st(floor);
      for (let d = 0; d < depth; d++) cells[idx(x, -1 - d, z)] = B.setProp(st('water'), 'level', 0);
    }
  };
  const run = (e, t) => { for (let i = 0; i < t; i++) EL.tickOne(e); };
  const pl = () => ({ isPlayer: true, type: 'player', x: 0, y: 0, z: 0, yawDeg: 0 });

  // still water: decay 0.9 per tick on the horizontal velocity (updateVelocity IN_WATER), no input
  world('stone', 3);
  let e = EL.spawn('boat', 0.5, 0, 0.5, { boatType: 'oak' });
  run(e, 100);
  e.vx = 0.2; e.vz = 0; const x0 = e.x; run(e, 1);
  ok(Math.abs(e.vx - 0.2 * 0.9) < 1e-6 && Math.abs(e.x - x0 - 0.18) < 1e-3, 'still water: vx = 0.2*0.9 after a tick, got ' + e.vx);

  // land: decay = floor slipperiness 0.6; ice: 0.98 (ice) / 0.989 (blue_ice) -- 0.6 and 0.989 are the block constants
  for (const [fl, slip] of [['stone', 0.6], ['blue_ice', 0.989]]) {
    world(fl, 0);
    e = EL.spawn('boat', 0.5, 0, 0.5, { boatType: 'oak' });
    run(e, 3); e.vx = 0.3; e.vz = 0;
    run(e, 1);
    ok(Math.abs(e.vx - F(slip) * 0.3) < 2e-3, fl + ': ON_LAND decay ' + slip + ' => vx ' + (slip * 0.3).toFixed(4) + ', got ' + e.vx);
  }

  // W held, one rider, at yaw 0 on still water: updateVelocity decays then updatePaddles adds: v = v*0.9 + 0.04, limit 0.4 (limit of the recurrence)
  world('stone', 3);
  e = EL.spawn('boat', 0.5, 0, 0.5, { boatType: 'oak' });
  run(e, 100);
  const rider = pl(); Bt.interact(e, rider);
  e.yawDeg = 0; e.vx = e.vz = 0; e.yawVelocity = 0;
  Bt.setInputs(e, false, false, true, false);
  let v = 0, okTrace = true;
  for (let i = 0; i < 40; i++) {
    run(e, 1); v = v * 0.9 + F(0.04);
    if (Math.abs(Math.hypot(e.vx, e.vz) - v) > 5e-3) okTrace = false;
  }
  ok(okTrace, 'W held: speed follows v=v*0.9+0.04 for 40 ticks (got ' + Math.hypot(e.vx, e.vz).toFixed(4) + ' want ' + v.toFixed(4) + ')');
  ok(Math.hypot(e.vx, e.vz) > 0.35 && Math.hypot(e.vx, e.vz) < 0.41, 'W held: nears the 0.4 limit');

  // seats: two passengers 0.2 and -0.6 from the centre (animal +0.2)
  world('stone', 3);
  e = EL.spawn('boat', 0.5, 0, 0.5, { boatType: 'oak' });
  const a = pl(), b = { isAnimal: true, x: 0, y: 0, z: 0, yawDeg: 0 };
  Bt.interact(e, a); Bt.interact(e, b);
  const oa = Bt.passengerOffset(e, a), ob = Bt.passengerOffset(e, b);
  ok(Math.abs(Math.hypot(oa[0], oa[1]) - 0.2) < 1e-6 && Math.abs(Math.hypot(ob[0], ob[1]) - 0.4) < 1e-6, 'two seats: 0.2 and |-0.6+0.2|');

  // fall break: 3 planks + 2 sticks
  world('stone', 0);
  const drops = []; EL.dropStack = (x, y, z, item) => { drops.push(item); return {}; };
  e = EL.spawn('boat', 0.5, 0, 0.5, { boatType: 'birch' });
  run(e, 3); e.fallDistance = 5; run(e, 1);
  ok(e.removed && drops.join() === 'birch_planks,birch_planks,birch_planks,stick,stick', 'fall break drops 3 planks + 2 sticks (' + drops + ')');
  return { fails, n };
}

const base = scenarios(null);
const fails = [...base.fails];
const BREAKS = [
  ['ice slipperiness swapped', "(R.friction[SR.block[st]] || 0.6)", '0.6'],
  ['paddle force dropped', 'if (f) a = F32(a + F32(0.04));', ''],
  ['water decay wrong', "{ buoy = (e.waterLevel - e.y) / e.height; e.velocityDecay = 0.9; }", "{ buoy = (e.waterLevel - e.y) / e.height; e.velocityDecay = 0.8; }"],
  ['seat offset wrong', 'o = i === 0 ? F32(0.2) : F32(-0.6)', 'o = i === 0 ? F32(0.3) : F32(-0.6)'],
  ['sticks dropped', "out.push('stick', 'stick')", "out.push('stick')"],
];
let breaks = 0;
for (const [label, a, b] of BREAKS) {
  let matched = true;
  const patch = (f, src) => { if (f !== '07zzt_boat.js') return src; if (!src.includes(a)) matched = false; return src.split(a).join(b); };
  let r; try { r = scenarios(patch); } catch (err) { r = { fails: ['threw: ' + err.message] }; }
  if (!matched) { fails.push('anti-vacuity: edit for "' + label + '" matched nothing'); continue; }
  if (r.fails.length) { breaks++; console.log('   ✓ break caught: ' + label); } else fails.push('anti-vacuity: "' + label + '" went unnoticed');
}
if (fails.length) { console.log('FAIL'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log('boatphys: ' + base.n + ' assertions, 0 failures, ' + breaks + ' breaks caught');
