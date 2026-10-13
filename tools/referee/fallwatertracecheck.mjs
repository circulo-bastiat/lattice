// #6262: lockstep compares fallDistance + fluid flags [touching, submerged, lava] each tick. A cow dropped into a 2-deep pool:
// the reference (vanilla Entity.fall: += -dy airborne, 0 in water) must match Ph each tick; clearing Ph's water reset must diverge on fallDistance.
import { loadEngine } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
let bad = 0, n = 0, caught = 0; const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '14b_physics.js'] });
M.World.init(1);
const W = M.World, S = M.States, Ph = M.Physics;
const c = W.makeChunk(0, 0); c.state = M.CH.GENERATED; W.chunks.set(W.key(0, 0), c);
const stone = S.stateOf('stone') | 0, water = S.stateOf('water') | 0;
function run(breakIt) {
  for (let y = 0; y < 30; y++) for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) W.setBlock(x, y, z, 0);
  for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) { W.setBlock(x, 3, z, stone); W.setBlock(x, 4, z, water); W.setBlock(x, 5, z, water); }
  const e = { x: 3, y: 14, z: 3, vx: 0, vy: 0, vz: 0, w: 0.9, h: 1.4, width: 0.9, height: 1.4, onGround: false, fallDistance: 0, type: 'cow', maxHealth: 10, health: 10 };
  const real = Ph.updateFluids, rows = [], ref = [];
  if (breakIt) Ph.updateFluids = (en) => { en.inWater = false; en.eyeInWater = false; en.inLava = false; return en; };
  let fd = 0;
  for (let t = 0; t < 40; t++) {
    const y0 = e.y;
    Ph.updateFluids(e); e.vy = (e.vy - 0.08) * 0.98; Ph.move(e, 0, e.vy, 0);
    rows.push(engineRow(t, e));
  }
  Ph.updateFluids = real;
  return rows;
}
const good = run(false); if (process.env.DBG) good.forEach((r) => console.log(r.tick, r.pos[1].toFixed(3), r.fallDistance, r.fluid, r.onGround));
// reference (vanilla Entity.fall): fd += -dy while airborne and dry; reset on ground or in water
let fdRef = 0, yPrev = 14;
const refRows = good.map((r) => {
  const y = r.pos[1], wetNow = r.fluid[0] || r.fluid[1];
  if (r.onGround || wetNow) fdRef = 0; else if (y < yPrev) fdRef += yPrev - y;
  yPrev = y; return { fd: fdRef, fluid: r.fluid };
});
ok(good.some((r) => r.fluid && r.fluid[0]), 'cow reaches the water (touching flag set)');
ok(good.some((r) => r.fallDistance > 5), 'fall accumulates airborne');
const wet = good.find((r) => r.fluid && r.fluid[0]);
ok(wet && good.slice(good.indexOf(wet)).every((r) => r.fallDistance === 0), 'fallDistance is cleared by water');
const SV = good.map((r, t) => serverRow(r.tick, { FallDistance: refRows[t].fd + 'f' }, { fluid: refRows[t].fluid }));
ok(compareTraces(SV, good, { fields: ['fallDistance', 'fluid'] }) === null, 'matching traces equal');
const bad1 = run(true);
const d = compareTraces(SV, bad1, { fields: ['fallDistance', 'fluid'] });
if (d && (d.field === 'fallDistance' || d.field === 'fluid')) caught++; else ok(false, 'cleared water reset not caught');
console.log(`${n} assertions, ${bad} failures, ${caught} breaks caught`);
if (bad) process.exit(1);
