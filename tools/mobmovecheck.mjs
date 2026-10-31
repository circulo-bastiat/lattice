#!/usr/bin/env node
// mobmovecheck.mjs — D-417: A MOB MAY NOT MOVE ITSELF.
//
//   node tools/mobmovecheck.mjs [--verbose]
//
// ⚠ THE BUG THIS FILE EXISTS TO CATCH. Dan played the shipped build and reported that mobs walk
// through blocks. They did, and the collision sweep was innocent: `Ai.stepToward` wrote `e.x`,
// `e.y` and `e.z` outright — it TELEPORTED the mob a fraction of a block per tick — so no mob
// in this game had ever been through `Ph.move`. That is a CLASS of bug, not one mob: anything
// that writes a position instead of a velocity is invisible to every collision test ever
// written, because the test is never called. §2 is the class, stated as a rule: after a tick,
// no living entity's box may overlap a full cube.
//
// Sections:
//   1. `Ai.stepToward` aims and does not move — position identical, heading/speed/jump set
//   2. a mob sealed in a stone box is still in it 200 ticks later (the reported bug)
//   3. `rotlerp` turns at most 90° a tick and takes the short way round
//   4. the acceleration law, computed twice — `mobSpeed² × (0.216/f³)` (the `Mob.setSpeed` trap)
//   5. a mob jumps a 1-block step and steps a half-block one without jumping
//   6. `Entity.push` separates two overlapping mobs, horizontally only
//   7. `isInWall` damages a mob whose eye is inside a cube and leaves one in the open alone
//   8. anti-vacuity — the old teleport escapes the box; a zeroed push stops separating;
//      a zeroed speed stops the walk; a mob out of the wall stops taking damage

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('mobmovecheck — D-417, a mob may not move itself');

const M = loadEngine({
  extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '14j_combat.js', '07k_goals.js']
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Behave.init(M.World);
M.Ai.init();
ok(M.Ai.ready, 'Ai module reports ready');

const Ai = M.Ai, Ph = M.Physics, EL = M.EntityList, W = M.World, CH = M.CH;
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone'), AIR = 0, WATER = stateOf('water');
const PLAT_Y = 8;

function freshWorld() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  EL.init();
  EL.pushPlayer = () => null;                       // no player in the fixture
}
function plate(radius, y = PLAT_Y) {
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, y, z, STONE);
}
/** A live zombie with a goal hook that walks it at `node`, at vanilla speedModifier `sm`. */
function walker(x, y, z, node, sm = 1.0) {
  const e = EL.spawn('zombie', x, y, z);
  if (!e) return null;
  e.ai = { tick() { Ai.stepToward(e, node, sm); } };
  return e;
}
/** Does this entity's box overlap any full cube? The rule §2 is about. */
function insideABlock(e) {
  const hw = e.width * 0.5;
  for (let bx = Math.floor(e.x - hw); bx <= Math.floor(e.x + hw); bx++)
    for (let by = Math.floor(e.y + 1e-4); by <= Math.floor(e.y + e.height - 1e-4); by++)
      for (let bz = Math.floor(e.z - hw); bz <= Math.floor(e.z + hw); bz++)
        if (Ph.shapeAt(bx, by, bz) === Ph.FULL_CUBE) return `${bx},${by},${bz}`;
  return null;
}

// ── 1. stepToward aims; it does not move ────────────────────────────────────────────────────
say('\n1. Ai.stepToward aims and moves nothing');
freshWorld(); plate(8);
{
  const e = walker(0.5, PLAT_Y + 1, 0.5, { x: 5, y: PLAT_Y + 1, z: 0 });
  ok(!!e, 'a zombie spawns');
  const before = [e.x, e.y, e.z].join(',');
  Ai.stepToward(e, { x: 5, y: PLAT_Y + 1, z: 0 }, 1.0);
  ok([e.x, e.y, e.z].join(',') === before, `stepToward MOVED the entity: ${before} -> ${[e.x, e.y, e.z].join(',')}`);
  ok(e.mobSpeed > 0, 'stepToward set no speed');
  ok(e.zza === e.mobSpeed, `Mob.setSpeed must set zza to the same value (speed ${e.mobSpeed}, zza ${e.zza})`);
  const spd = M.Entities.attrsOf('zombie').speed;
  ok(Math.abs(e.mobSpeed - spd) < 1e-12, `speedModifier 1.0 must give the MOVEMENT_SPEED attribute exactly (${e.mobSpeed} vs ${spd})`);
  ok(Math.abs(e.yaw - Math.atan2(4.5, 0)) < 1e-9, `heading must point at the waypoint (yaw ${e.yaw})`);

  // ⚠ MoveControl drops to WAIT after every MOVE_TO, and WAIT is `mob.setZza(0)`. A mob no goal
  // steers this tick must have NO forward input — otherwise it coasts on the last order it was
  // ever given and walks through whatever it was told to stop short of.
  const idle = EL.spawn('zombie', 0.5, PLAT_Y + 1, 4.5);
  let steer = true;
  idle.ai = { tick() { if (steer) Ai.stepToward(idle, { x: 20, y: PLAT_Y + 1, z: 4 }, 1.0); } };
  for (let t = 0; t < 20; t++) EL.tickOne(idle);
  const movingX = idle.x;
  ok(movingX > 0.6, 'the idle-test mob never started walking, so the WAIT test would be vacuous');
  steer = false;
  for (let t = 0; t < 200; t++) EL.tickOne(idle);
  ok(idle.x - movingX < 1.0, `a mob nothing steers must coast to a stop, not keep accelerating (it went a further ${(idle.x - movingX).toFixed(2)} blocks)`);
  ok(Math.abs(idle.vx) < 1e-3, `and its velocity must decay to nothing (vx=${idle.vx})`);
}

// ── 2. THE REPORTED BUG: sealed in, stays in ────────────────────────────────────────────────
say('\n2. a mob sealed in a stone box cannot leave it');
function sealedRun(ticks = 200) {
  freshWorld();
  // a 3x3 floor at PLAT_Y, walls all round at PLAT_Y+1..+3, and a lid
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++)
    for (let y = PLAT_Y; y <= PLAT_Y + 4; y++) {
      const edge = (x === -1 || x === 1 || z === -1 || z === 1);
      const shell = (y === PLAT_Y || y === PLAT_Y + 4 || edge);
      W.setBlock(x, y, z, shell ? STONE : AIR);
    }
  const e = walker(0.5, PLAT_Y + 1, 0.5, { x: 40, y: PLAT_Y + 1, z: 40 });
  let worstInside = null, escaped = null;
  for (let t = 0; t < ticks; t++) {
    EL.tickOne(e);
    const in_ = insideABlock(e);
    if (in_ && !worstInside) worstInside = `${in_} at tick ${t}`;
    if (Math.abs(e.x - 0.5) > 1.0 || Math.abs(e.z - 0.5) > 1.0) { escaped = `t=${t} at ${e.x.toFixed(3)},${e.z.toFixed(3)}`; break; }
  }
  return { e, worstInside, escaped };
}
{
  const r = sealedRun();
  ok(r.escaped === null, `the mob walked out of a sealed 1x1 cell: ${r.escaped}`);
  ok(r.worstInside === null, `the mob's box ended a tick inside a full cube: ${r.worstInside}`);
  ok(r.e.y >= PLAT_Y + 1 - 1e-6, `the mob sank through the floor to y=${r.e.y}`);
  ok(r.e.onGround === true, 'the mob is not standing on the floor it started on');
}

// ── 3. rotlerp ──────────────────────────────────────────────────────────────────────────────
say('\n3. rotlerp: at most 90° a tick, the short way');
{
  const q = Math.PI / 2;
  ok(Math.abs(Ai.rotlerp(0, Math.PI, q) - q) < 1e-12, 'a 180° turn must be clipped to +90°');
  ok(Math.abs(Ai.rotlerp(0, -3, q) + q) < 1e-12, 'a turn the other way must be clipped to −90°');
  ok(Math.abs(Ai.rotlerp(0, 0.3, q) - 0.3) < 1e-12, 'a small turn must be taken in full');
  // the short way round the seam: from +170° to −170° is a 20° step, not a 340° one
  const from = Math.PI - 0.17, to = -Math.PI + 0.17;
  const got = Ai.rotlerp(from, to, q);
  ok(Math.abs(Ai.wrapRad(got - from) - 0.34) < 1e-9, `across the ±π seam the turn must be the short way (got ${Ai.wrapRad(got - from)})`);
}

// ── 4. the acceleration law, computed twice ─────────────────────────────────────────────────
say('\n4. acceleration = mobSpeed × zza × (0.216/f³) — the Mob.setSpeed trap');
freshWorld(); plate(12);
{
  const e = walker(0.5, PLAT_Y + 1, 0.5, { x: 20, y: PLAT_Y + 1, z: 0 });
  // ⚠ SETTLE FIRST. `EL.spawn` leaves `onGround` false and `travel` applies gravity AFTER the
  // move, so it takes two ticks for a mob standing exactly on the floor to notice the floor —
  // and in the air the acceleration is `flyingSpeed`, not the friction-influenced one.
  for (let s = 0; s < 5; s++) EL.tickOne(e);
  const spd = e.mobSpeed, f3 = Ph.frictionOf(e);
  const a = spd * spd * (Ph.FRICTION_CUBE / (f3 * f3 * f3)) * Math.fround(0.98);   // #4023: tickMovement's zza *= 0.98F
  const vxBefore = e.vx, vzBefore = e.vz;
  const yaw = e.yaw;
  EL.tickOne(e);
  // one tick: v <- ((v + a·dir) · speedFactor) · f1 , with the heading from BEFORE the tick
  // (stepToward re-aims first, but the waypoint is straight ahead so the heading does not move)
  const f1 = f3 * Ph.AIR_FRICTION;
  const predX = (vxBefore + Math.sin(yaw) * a) * f1;
  const predZ = (vzBefore + -Math.cos(yaw) * a) * f1;
  ok(Math.abs(e.vx - predX) < 1e-9, `vx off the law: engine ${e.vx}, law ${predX}`);
  ok(Math.abs(e.vz - predZ) < 1e-9, `vz off the law: engine ${e.vz}, law ${predZ}`);
  // and it actually walks: 60 ticks must carry it several blocks toward the waypoint
  let t = 0; for (; t < 60; t++) EL.tickOne(e);
  ok(e.x > 3, `60 ticks of walking moved the mob to x=${e.x.toFixed(2)}, expected > 3`);
  ok(insideABlock(e) === null, 'the walking mob ended inside a block');
}

// ── 5. the jump ─────────────────────────────────────────────────────────────────────────────
say('\n5. a 1-block step is jumped; a half-block step is stepped');
freshWorld(); plate(12);
{
  for (let z = -3; z <= 3; z++) W.setBlock(3, PLAT_Y + 1, z, STONE);   // a 1-block wall at x=3
  // ⚠ A REAL WAYPOINT, NOT A DISTANT GOAL. MoveControl only jumps when the WANTED position is
  // within `max(1, width)` horizontally — because vanilla's navigation hands it the NEXT path
  // node, one block away, never the destination. A fixture that aims at the destination tests
  // a mob that vanilla would not have jumped either, so this one paths the way the goals do.
  const e = EL.spawn('zombie', 0.5, PLAT_Y + 1, 0.5);
  let path = null, idx = 1;
  e.ai = { tick() {
    if (!path || idx >= path.length) { path = Ai.findPath(e.x, e.y, e.z, 6, PLAT_Y + 2, 0, { maxDrop: 1 }); idx = 1; }
    if (path && idx < path.length) {
      Ai.stepToward(e, path[idx], 1.0);
      if (Ai.closeTo(e, path[idx])) idx++;
    }
  } };
  ok(!!Ai.findPath(e.x, e.y, e.z, 6, PLAT_Y + 2, 0, { maxDrop: 1 }), 'no path over the 1-block step exists for the fixture to follow');
  let jumped = false, cleared = false;
  for (let t = 0; t < 200; t++) {
    EL.tickOne(e);
    if (e.vy > 0.3) jumped = true;
    if (e.x > 3.6 && e.y >= PLAT_Y + 2 - 1e-6) { cleared = true; break; }
    if (insideABlock(e)) break;
  }
  ok(jumped, 'the mob never jumped at a 1-block step');
  ok(cleared, `the mob never got onto the 1-block step (x=${e.x.toFixed(2)}, y=${e.y.toFixed(2)})`);
  ok(insideABlock(e) === null, 'the jumping mob ended inside a block');
}

// ── 6. push ─────────────────────────────────────────────────────────────────────────────────
say('\n6. two overlapping mobs shove each other apart, horizontally');
freshWorld(); plate(12);
function pushRun() {
  const a = EL.spawn('zombie', 0.5, PLAT_Y + 1, 0.5);
  const b = EL.spawn('zombie', 0.55, PLAT_Y + 1, 0.5);
  a.ai = { tick() {} }; b.ai = { tick() {} };
  const d0 = Math.hypot(b.x - a.x, b.z - a.z);
  const y0 = [a.y, b.y];
  for (let t = 0; t < 40; t++) { EL.tickOne(a); EL.tickOne(b); }
  return { a, b, d0, d1: Math.hypot(b.x - a.x, b.z - a.z), y0 };
}
{
  const r = pushRun();
  ok(r.d1 > r.d0, `two overlapping mobs did not separate (${r.d0.toFixed(4)} -> ${r.d1.toFixed(4)})`);
  ok(Math.abs(r.a.y - r.y0[0]) < 1e-6 && Math.abs(r.b.y - r.y0[1]) < 1e-6, 'the push moved the mobs vertically; Entity.push is horizontal only');
  // one call of the primitive, against the arithmetic
  const p = { x: 0, z: 0, y: 0, vx: 0, vz: 0, width: 0.6, height: 1.8 };
  const q = { x: 0.5, z: 0, y: 0, vx: 0, vz: 0, width: 0.6, height: 1.8 };
  Ph.push(p, q);
  let d2 = Math.sqrt(0.5), d3 = Math.min(1, 1 / d2);
  const want = (0.5 / d2) * d3 * Ph.PUSH_SCALE;
  ok(Math.abs(q.vx - want) < 1e-12, `Entity.push's own arithmetic: got ${q.vx}, want ${want}`);
  ok(Math.abs(p.vx + want) < 1e-12, 'the push must be equal and opposite');
}

// ── 7. suffocation ──────────────────────────────────────────────────────────────────────────
say('\n7. a mob whose eye is inside a cube suffocates; one in the open does not');
freshWorld(); plate(12);
{
  const open = EL.spawn('zombie', 0.5, PLAT_Y + 1, 0.5);
  open.ai = { tick() {} };
  const hp0 = open.health;
  for (let t = 0; t < 40; t++) EL.tickOne(open);
  ok(open.health === hp0, `a mob standing in the open lost ${hp0 - open.health} health to suffocation`);

  const buried = EL.spawn('zombie', 4.5, PLAT_Y + 1, 4.5);
  buried.ai = { tick() {} };
  const eyeY = Math.floor(buried.y + buried.height * Ph.EYE_FRACTION);
  W.setBlock(4, eyeY, 4, STONE); W.setBlock(5, eyeY, 4, STONE);
  W.setBlock(4, eyeY, 5, STONE); W.setBlock(5, eyeY, 5, STONE);
  ok(Ph.isInWall(buried) === true, 'isInWall did not see the cube at eye level');
  const bh0 = buried.health;
  for (let t = 0; t < 60; t++) EL.tickOne(buried);
  ok(buried.health < bh0, 'a mob with its head in a block took no suffocation damage');
}

// ── 8. anti-vacuity ─────────────────────────────────────────────────────────────────────────
console.log('\n8. anti-vacuity — every rule above must be breakable');
{
  // (a) the ORIGINAL bug: restore the teleporting stepToward and the sealed mob must escape.
  const real = Ai.stepToward;
  Ai.stepToward = function (e, node, speed) {
    const dx = (node.x + 0.5) - e.x, dz = (node.z + 0.5) - e.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-6) { const s = Math.min(0.05, d); e.x += (dx / d) * s; e.z += (dz / d) * s; }
  };
  const broken = sealedRun();
  Ai.stepToward = real;
  okAv(broken.escaped !== null || broken.worstInside !== null,
       'the pre-D-417 teleporting stepToward must escape the sealed box (it did not — §2 cannot fail)');

  // (b) a zeroed push must stop separating.
  const scale = Ph.PUSH_SCALE; Ph.PUSH_SCALE = 0;
  freshWorld(); plate(12);
  const noPush = pushRun();
  Ph.PUSH_SCALE = scale;
  okAv(!(noPush.d1 > noPush.d0 + 1e-9), 'with PUSH_SCALE 0 the mobs must NOT separate (§6 cannot fail)');

  // (c) a mob whose setMobSpeed writes nothing must not walk.
  const realSet = Ai.setMobSpeed; Ai.setMobSpeed = function () {};
  freshWorld(); plate(12);
  const still = walker(0.5, PLAT_Y + 1, 0.5, { x: 20, y: PLAT_Y + 1, z: 0 });
  for (let t = 0; t < 60; t++) EL.tickOne(still);
  Ai.setMobSpeed = realSet;
  okAv(Math.abs(still.x - 0.5) < 0.05, `with no speed set the mob must stand still (it reached x=${still.x.toFixed(3)}; §4's walk cannot fail)`);

  // (d) isInWall must say no when the block is taken away again.
  freshWorld(); plate(12);
  const free = EL.spawn('zombie', 0.5, PLAT_Y + 1, 0.5);
  okAv(Ph.isInWall(free) === false, 'isInWall must be false in the open (§7 cannot fail)');
}

// ── result ──────────────────────────────────────────────────────────────────────────────────
if (fails.length) {
  console.log('\n=============== mobmovecheck ===============');
  console.log(` assertions passed .. ${pass}`);
  console.log(` failures ........... ${fails.length}`);
  console.log(` breaks caught ...... ${breaks}`);
  console.log('==============================================');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('\n=============== mobmovecheck ===============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... 0`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
