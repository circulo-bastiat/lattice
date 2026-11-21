#!/usr/bin/env node
// boatsimcheck.mjs -- #5227 (G17-B1): BoatEntity's core tick (src/07zzt_boat.js), headless.
//   node tools/boatsimcheck.mjs
// A boat floats at the water surface after settling, sinks under flowing water, slides further on blue_ice than
// on stone, and takes fall()'s fall-distance branch. Every assertion has an edited-source break that must fail (D-30).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

console.log('boatsimcheck -- #5227 (G17-B1): BoatEntity location / float / slipperiness / fall');
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));

function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); return c; };
  const EXTRA = ['02f_tags.js', '07b_behaviour.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '07zzt_boat.js'];
  const M = loadEngine({ extra: EXTRA, dom: false, patch });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  const S = M.States, B = M.Behave, EL = M.EntityList, Bt = M.Boat, R = M.Reg;
  const N = 48, MID = 24;
  const cells = new Uint16Array(N * N * N);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
  M.World = {
    getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
    setBlock(x, y, z, id) { if (!inside(x, y, z)) return false; cells[idx(x, y, z)] = id; return true; },
    blockLightAt: () => 15,
  };
  const PHYS = rdj('block-physics.json');
  R.buildPhysics({ defaults: PHYS.defaults, exceptions: PHYS.exceptions });
  const Ph = M.Physics;
  Ph.shapeAt = (x, y, z) => { const id = M.World.getBlock(x, y, z); return id === 0 || S.solid[id] !== 1 ? null : Ph.shapesFor(id); };
  B.init(M.World); M.Entities.init(); EL.init();
  const st = (nm) => S.stateOf(nm) | 0;
  const level = (l) => B.setProp(st('water'), 'level', l);
  // a 9x9 floor of `floor` at y=-1 (stone under a basin of `depth` water when depth > 0)
  const world = (floor, depth) => {
    cells.fill(0); EL.list.length = 0;   // boats are solid to each other (#5346): drop the last scenario's
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) {
      cells[idx(x, -1 - depth, z)] = st(floor);
      for (let d = 0; d < depth; d++) cells[idx(x, -1 - d, z)] = level(0);
    }
  };
  const run = (e, t) => { for (let i = 0; i < t; i++) EL.tickOne(e); };

  ok(EL.canSpawn('boat'), 'EL.canSpawn(boat) is true');
  ok(Bt.TYPES.length === 6, 'six woods');

  // 1. settles at the surface of a 3-deep pool and reports IN_WATER
  world('stone', 3);
  let e = EL.spawn('boat', 0.5, 2, 0.5, { boatType: 'birch' });
  ok(e && e.type === 'boat' && e.boatType === 'birch', 'EL.spawn(boat) keeps boatType');
  run(e, 200);
  ok(e.location === Bt.IN_WATER, 'floats: location IN_WATER (' + e.location + ')');
  ok(Math.abs(e.y - (0 - e.height * 0.5)) < 0.2 || (e.y > -0.5 && e.y < 0.05), 'floats: hull sits at the surface, y=' + e.y.toFixed(3));
  ok(Math.abs(e.vy) < 0.02, 'floats: vertical speed settled');
  ok(Math.abs(e.velocityDecay - 0.9) < 1e-6, 'IN_WATER decay is 0.9');

  // 2. under flowing water the boat sinks (UNDER_FLOWING_WATER, gravity -7e-4 only) while still water holds it
  world('stone', 4);
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) cells[idx(x, -2, z)] = level(1);   // flowing layer round the hull top
  e = EL.spawn('boat', 0.5, -2.5, 0.5, { boatType: 'oak' });
  run(e, 1);
  ok(e.location === Bt.UNDER_FLOWING_WATER, 'flowing water above: UNDER_FLOWING_WATER (' + e.location + ')');
  ok(e.vy < 0 && e.vy > -0.01, 'flowing: sinks at -7e-4 per tick, vy=' + e.vy);
  world('stone', 4);
    e = EL.spawn('boat', 0.5, -2.5, 0.5, { boatType: 'oak' });
  run(e, 1);
  ok(e.location === Bt.UNDER_WATER && Math.abs(e.velocityDecay - 0.45) < 1e-6, 'still water above: UNDER_WATER, decay 0.45');
  ok(e.vy > -0.035 && e.vy < 0, 'still: buoyancy offsets part of gravity, vy=' + e.vy);

  // 3. slipperiness: the same push slides further on blue_ice than on stone
  const slide = (floor) => {
    world(floor, 0);
    const b = EL.spawn('boat', 0.5, 0, 0.5, { boatType: 'oak' });
    run(b, 3); b.vx = 0.5;
    run(b, 40);
    return { x: b.x - 0.5, loc: b.location, slip: b.nearbySlip };
  };
  const stone = slide('stone'), ice = slide('blue_ice');
  ok(stone.loc === Bt.ON_LAND && Math.abs(stone.slip - 0.6) < 1e-6, 'stone: ON_LAND, slipperiness 0.6 (' + stone.slip + ')');
  ok(Math.abs(ice.slip - 0.989) < 1e-3, 'blue_ice slipperiness 0.989 (' + ice.slip + ')');
  ok(ice.x > stone.x + 1, 'slides further on blue_ice (' + ice.x.toFixed(2) + ') than stone (' + stone.x.toFixed(2) + ')');

  // 4. fall(): airborne descent accumulates fallDistance; landing in water resets; landing on land past 3 breaks
  world('stone', 0);
  e = EL.spawn('boat', 0.5, 10, 0.5, { boatType: 'oak' });
  run(e, 5);
  ok(e.location === Bt.IN_AIR && e.fallDistance > 0, 'airborne: fallDistance accumulates (' + e.fallDistance + ')');
  run(e, 120);
  ok(!e.removed && e.fallDistance === 0 && e.onGround, 'landing from IN_AIR (location is last tick\'s) resets fallDistance, no break (onLanding branch)');
  e.fallDistance = 5; run(e, 1);
  ok(e.location === Bt.ON_LAND && e.fallBroke === true && e.removed, 'resting ON_LAND with fallDistance > 3 breaks the boat');
  world('stone', 3);
  e = EL.spawn('boat', 0.5, 10, 0.5, { boatType: 'oak' });
  run(e, 200);
  ok(!e.removed && e.fallDistance === 0 && e.location === Bt.IN_WATER, 'falling into water: survives, fallDistance reset');
  world('stone', 0);
  e = EL.spawn('boat', 0.5, 1.5, 0.5, { boatType: 'oak' });
  run(e, 60);
  ok(!e.removed && e.fallDistance === 0, 'short drop (<= 3) lands and resets');
  // 4. riding (G17-B2)
  world('stone', 3);
  e = EL.spawn('boat', 0.5, 1, 0.5, { boatType: 'oak' });
  run(e, 120);
  const pl = { isPlayer: true, type: 'player', x: 0, y: 0, z: 0, yawDeg: 0 };
  const an = { isAnimal: true, x: 0, y: 0, z: 0, yawDeg: 0 };
  ok(Bt.interact(e, pl) && e.passengers.length === 1, 'player boards');
  ok(Bt.interact(e, an) && e.passengers.length === 2, 'second passenger boards');
  ok(!Bt.interact(e, { x: 0, y: 0, z: 0 }) && e.passengers.length === 2, 'third passenger refused');
  e.yawDeg = 0; e.vx = e.vz = 0; e.yawVelocity = 0;
  Bt.setInputs(e, false, false, true, false);
  Bt.updatePaddles(e);
  ok(Math.abs(e.vz - Math.fround(0.04)) < 1e-9 && Math.abs(e.vx) < 1e-9, 'forward adds 0.04 along +z at yaw 0, vz=' + e.vz);
  ok(e.paddleMoving[0] && e.paddleMoving[1], 'forward paddles both');
  e.vx = e.vz = 0; Bt.setInputs(e, false, false, false, true); Bt.updatePaddles(e);
  ok(Math.abs(e.vz + Math.fround(0.005)) < 1e-9, 'back adds -0.005');
  e.vx = e.vz = 0; e.yawVelocity = 0; Bt.setInputs(e, false, true, false, false); Bt.updatePaddles(e);
  ok(e.yawVelocity === 1 && e.yawDeg === 1 && Math.abs(Math.hypot(e.vx, e.vz) - Math.fround(0.005)) < 1e-6, 'right alone: yawVelocity +1, 0.005 push');
  e.yawDeg = 0; e.yawVelocity = 0;
  const o0 = Bt.passengerOffset(e, pl), o1 = Bt.passengerOffset(e, an);
  ok(Math.abs(Math.hypot(o0[0], o0[1]) - 0.2) < 1e-6 && Math.abs(Math.hypot(o1[0], o1[1]) - 0.4) < 1e-6, 'seat offsets 0.2 front, -0.6+0.2 animal rear');
  ok(o0[0] * o1[0] + o0[1] * o1[1] < 0, 'rear seat opposite the front seat');
  pl.yawDeg = 200; Bt.copyEntityData(e, pl);
  ok(Math.abs(pl.yawDeg - 255) < 1e-4, 'rider yaw 200 clamps to -105 of boat (255), got ' + pl.yawDeg);
  // 5. damage / drops (#5229)
  const drops = [];
  M.EntityList.dropStack = (x, y, z, item, c) => { drops.push(item); return {}; };
  for (const w of Bt.TYPES) {
    world('stone', 0); drops.length = 0;
    e = EL.spawn('boat', 0.5, 0, 0.5, { boatType: w });
    ok(Bt.damage(e, 2, {}) && !e.removed && e.wobbleTicks === 10 && drops.length === 0, w + ': a light hit wobbles, no break');
    Bt.damage(e, 3, {});
    ok(e.removed && drops.length === 1 && drops[0] === w + '_boat', w + ': breaks into its own boat (' + drops + ')');
  }
  world('stone', 0); drops.length = 0;
  e = EL.spawn('boat', 0.5, 0, 0.5, { boatType: 'oak' });
  Bt.damage(e, 1, { instabuild: true });
  ok(e.removed && drops.length === 0, 'creative attacker breaks it without a drop');
  const fallDrop = (fd) => {
    world('stone', 0); drops.length = 0;
    const b = EL.spawn('boat', 0.5, 0, 0.5, { boatType: 'jungle' });
    run(b, 5); b.fallDistance = fd; run(b, 1);
    return { b, d: drops.slice() };
  };
  let f = fallDrop(4);
  ok(f.b.removed && f.d.join() === 'jungle_planks,jungle_planks,jungle_planks,stick,stick', 'fall 4 drops 3 planks + 2 sticks (' + f.d + ')');
  f = fallDrop(2.9);
  ok(!f.b.removed && f.d.length === 0, 'fall 2.9 does not break');
  M.Commands = { ruleGet: (k) => (k === 'doEntityDrops' ? 'false' : 'true') };
  f = fallDrop(4);
  ok(f.b.removed && f.d.length === 0, 'doEntityDrops=false: fall break drops nothing');
  world('stone', 0); drops.length = 0;
  e = EL.spawn('boat', 0.5, 0, 0.5, { boatType: 'oak' });
  Bt.damage(e, 5, {});
  ok(e.removed && drops.length === 0, 'doEntityDrops=false: damage break drops nothing');
  delete M.Commands;
  // bubble column: surface hit arms 60 ticks, then +0.6 (up) / -0.7 and rider ejected (drag); plain water gets none
  world('stone', 3); drops.length = 0;
  e = EL.spawn('boat', 0.5, -2, 0.5, { boatType: 'oak' });
  Bt.onBubbleColumnSurfaceCollision(e, false);
  ok(e.bubbleWobbleTicks === 60, 'surface hit arms 60 wobble ticks');
  let vmax = -9;
  for (let i = 0; i < 61; i++) { Bt.onBubbleColumnSurfaceCollision(e, false); EL.tickOne(e); vmax = Math.max(vmax, e.vy); }
  ok(vmax >= 0.5, 'up column boosts vy at expiry (' + vmax + ')');
  ok(Math.abs(e.bubbleWobble) > 0 || e.bubbleWobbleStrength > 0, 'wobble strength grows');
  const d = EL.spawn('boat', 0.5, -2, 0.5, { boatType: 'oak' }), rider = { type: 'zombie' };
  d.passengers.push(rider); rider.vehicle = d;
  for (let i = 0; i < 61; i++) { Bt.onBubbleColumnSurfaceCollision(d, true); Bt.handleBubbleColumn(d, i); }
  ok(d.vy <= -0.7 + 1e-9 && !d.passengers.length && !rider.vehicle, 'drag column: -0.7 and passengers removed');
  const pw = EL.spawn('boat', 0.5, -2, 0.5, { boatType: 'oak' });
  e = pw; e.vy = 0; run(e, 5);
  ok(e.bubbleWobbleTicks === 0 && !e.bubbleWobble && e.vy < 0.5, 'plain water: no wobble, no boost');
  return { fails, n };
}

const fails = []; let breaks = 0;
const base = scenarios(null);
fails.push(...base.fails.map((m) => 'baseline: ' + m));
console.log('  ' + base.n + ' assertions');

const BREAKS = [
  ['bubble up boost', 'e.vy = e.passengers.some', 'e.vy = 0; void e.passengers.some'],
  ['bubble drag boost', 'e.vy += -0.7;', 'e.vy += -0.1;'],
  ['bubble wobble ticks', 'e.bubbleWobbleTicks = 60;', 'e.bubbleWobbleTicks = 30;'],
  ['forward add wrong', 'a = F32(a + F32(0.04))', 'a = F32(a + F32(0.05))'],
  ['third passenger allowed', 'e.passengers.length < 2 &&', 'e.passengers.length < 3 &&'],
  ['rear seat offset wrong', 'F32(-0.6)', 'F32(-0.5)'],
  ['no yaw clamp', 'Math.max(-105, Math.min(105, d))', 'd'],
  ['back add wrong', 'a = F32(a - F32(0.005))', 'a = F32(a - F32(0.01))'],
  ['wobble threshold', 'e.wobbleStrength > 40', 'e.wobbleStrength > 400'],
  ['creative drops', 'if (!insta) e.dropped', 'if (true) e.dropped'],
  ['wrong planks', "e.boatType + '_planks'", "'oak_planks'"],
  ['one stick', "out.push('stick', 'stick')", "out.push('stick')"],
  ['rule ignored', 'if (!ruleDrops()) return out;', ''],
  ['boat item wrong', "e.boatType + '_boat'", "'oak_boat'"],
  ['no gravity', 'var grav = e.noGravity ? 0 : -0.04', 'var grav = 0'],
  ['no buoyancy', "if (buoy > 0) e.vy = (e.vy + buoy * 0.06153846016296973) * 0.75;", ''],
  ['flowing treated as still', 'if (!still(x, y, z)) return', 'if (false) return'],
  ['slipperiness constant', "(R.friction[SR.block[st]] || 0.6)", '0.6'],
  ['water never resets fall', '= Bt.UNDER_FLOWING_WATER) e.fallDistance = 0;', '= Bt.UNDER_FLOWING_WATER) {}'],
  ['no fall bookkeeping', 'e.fallDistance -= dy;', ''],
  ['land fall never breaks', "if (e.location !== Bt.ON_LAND) {", 'if (true) {'],
  ['IN_WATER decay wrong', "{ buoy = (e.waterLevel - e.y) / e.height; e.velocityDecay = 0.9; }", "{ buoy = (e.waterLevel - e.y) / e.height; e.velocityDecay = 0.5; }"],
];
for (const [label, a, b] of BREAKS) {
  let matched = true;
  const patch = (f, src) => { if (f !== '07zzt_boat.js') return src; if (!src.includes(a)) matched = false; return src.split(a).join(b); };
  let r;
  try { r = scenarios(patch); } catch (err) { r = { fails: ['threw: ' + err.message] }; }
  if (!matched) { fails.push('anti-vacuity: the edit for "' + label + '" matched nothing'); continue; }
  if (r.fails.length) { breaks++; console.log('   ✓ break caught: ' + label + ' (' + r.fails.length + ')'); }
  else fails.push('anti-vacuity: breaking "' + label + '" went unnoticed');
}
if (fails.length) { console.log('FAIL'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log('boatsimcheck: ' + base.n + ' assertions, 0 failures, ' + breaks + ' breaks caught');
