#!/usr/bin/env node
// avoidboxcheck.mjs -- cloud unit (D-772 feed (a), KW-45 follow-up): three `Ai.AvoidEntityGoal`
// behaviours kw4445check.mjs's own pen scenes don't exercise directly (they're all about the
// escape-point search) -- the THREAT-ACQUISITION half of `.decomp/net/minecraft/entity/ai/goal/
// FleeEntityGoal.java#canStart`, read whole:
//
//   1. a 3D BOX, not a flat circle that ignores height -- `mob.getBoundingBox().expand(range,
//      3.0, range)`: the vertical half-height is a FIXED 3 blocks, unrelated to `range`, so a
//      threat 10 blocks straight up (well within a `range=16` circle, but past the box's own
//      vertical limit) must NOT be found.
//   2. LINE OF SIGHT -- `TargetPredicate.createAttackable()`'s default `respectsVisibility`: a
//      threat behind a solid wall, otherwise in range, must NOT be found.
//   3. NEAREST, not first-found -- `world.getClosestEntity`: with two threats in range, the
//      goal must flee the closer one, not whichever the threat list happens to enumerate first.
//
// Each proves the break is caught (D-30, okAv style): the real gate refuses, and an ANTI-VACUITY
// twin (remove the one thing under test) proves the refusal was that gate, not an accident of
// the pen (unreachable target, wrong range, ...).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); if (VERBOSE) console.log((c ? '   ✓ ' : '   ✗ ') + m); return c; };
const okAv = (c, m) => ok(c, 'anti-vacuity: ' + m);

console.log('avoidboxcheck — Ai.AvoidEntityGoal: 3D box (not a flat circle), line of sight, nearest threat');

const M = loadEngine({
  extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init();
M.EntityList.init();
M.Behave.init(M.World);
M.Ai.init();
ok(M.Ai.ready, 'Ai module reports ready');

const Ai = M.Ai, W = M.World, CH = M.CH, EL = M.EntityList, PH = M.Physics;
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone');
const PLAT_Y = 20;   // high enough that "10 blocks straight up" from it still fits in the test world

function freshWorld() {
  W.init(1);
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
}
function plate(radius) {
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, PLAT_Y, z, STONE);
}
const tryCanUse = (g, tries) => { for (let i = 0; i < (tries || 40); i++) if (g.canUse()) return true; return false; };

// ═════════════════ 1. a 3D box: height past the fixed 3-block half-height is refused ═════════
console.log('\n 1. a threat well within a flat 2D circle but past the box\'s own 3-block vertical half-height is not found');
freshWorld();
plate(30);
{
  const e = EL.spawn('rabbit', 0, PLAT_Y + 1, 0);
  const wolf = EL.spawn('wolf', 0, PLAT_Y + 1 + 10, 0);   // 10 blocks straight up: inside range=16's circle, outside the box's fixed 3
  const g = new Ai.AvoidEntityGoal(e, 16, 1.6, () => [wolf], () => true);
  ok(tryCanUse(g) === false, 'a threat 10 blocks straight up (range=16, box height=3) is never acquired, however many attempts');

  // ANTI-VACUITY: the SAME wolf, brought down to 2 blocks above (inside the box's own 3-block
  // half-height) -- the exact same threat list and range, only the height changed.
  wolf.y = PLAT_Y + 1 + 2;
  okAv(tryCanUse(g) === true, 'and the identical wolf, only 2 blocks up now (inside the box), IS acquired -- the refusal above was the box\'s own height limit, not the wolf being unreachable');
  EL.clear();
}

// ═════════════════ 2. line of sight: a threat behind a wall is refused ═══════════════════════
console.log('\n 2. a threat otherwise in range, but behind a solid wall, is not found (TargetPredicate.createAttackable: respectsVisibility)');
freshWorld();
plate(30);
{
  const e = EL.spawn('rabbit', 0, PLAT_Y + 1, 0);
  const wolf = EL.spawn('wolf', 6, PLAT_Y + 1, 0);
  for (let y = PLAT_Y + 1; y <= PLAT_Y + 4; y++) W.setBlock(3, y, 0, STONE);   // a wall straight between them
  const g = new Ai.AvoidEntityGoal(e, 16, 1.6, () => [wolf], () => true);
  ok(tryCanUse(g) === false, 'a threat behind a solid wall, well within range, is never acquired');

  // ANTI-VACUITY: knock the wall down -- same positions, same range, only visibility changed.
  for (let y = PLAT_Y + 1; y <= PLAT_Y + 4; y++) W.setBlock(3, y, 0, 0);
  okAv(tryCanUse(g) === true, 'and with the wall removed, the identical wolf at the identical distance IS acquired -- the refusal above was line of sight, not range or reachability');
  EL.clear();
}

// ═════════════════ 3. nearest threat, not first-found ════════════════════════════════════════
console.log('\n 3. with two threats in range, the goal flees the NEAREST one, not whichever the threat list enumerates first');
freshWorld();
plate(30);
{
  const e = EL.spawn('rabbit', 0, PLAT_Y + 1, 0);
  const far = EL.spawn('wolf', 10, PLAT_Y + 1, 0);
  const near = EL.spawn('wolf', -3, PLAT_Y + 1, 0);
  // the far one listed FIRST -- a "first match wins" bug would pick it over the nearer one.
  const g = new Ai.AvoidEntityGoal(e, 16, 1.6, () => [far, near], () => true);
  let fledFar = false, fledNear = false;
  for (let i = 0; i < 60 && !(fledFar || fledNear); i++) {
    if (!g.canUse()) continue;
    // both threats sit dead-away from the mob on the same axis, so which one this run picked is
    // read off the RESULTING escape direction rather than any private state: fleeing the nearer
    // (west, x=-3) one drives the mob further NEGATIVE in x than fleeing the farther (east,
    // x=10) one ever would from this start point (0), inside a single first tick.
    g.start();
    const before = e.x;
    for (let t = 0; t < 5 && g.canContinueToUse(); t++) { e.zza = 0; g.tick(); PH.travelMob(e); }
    fledNear = e.x > before + 0.01;   // ran further east, away from the WEST (near, x=-3) threat -- correct pick
    fledFar = e.x < before - 0.01;    // ran further west, away from the EAST (far, x=10) threat -- wrong pick
    g.stop();
    e.x = 0; e.z = 0;
  }
  ok(fledFar === false, 'never flees the FARTHER (10b) threat while a nearer one (3b) is also in range');
  okAv(fledNear === true, 'and does flee the NEARER (3b) threat -- proving a real pick was made, not both refused');
  EL.clear();
}

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
