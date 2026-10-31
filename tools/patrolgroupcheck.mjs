#!/usr/bin/env node
// patrolgroupcheck.mjs — #744: Ai.PatrolGoal findPatrolTargets. Breaks its own data.
// (scaffold copied from raidgoalresiduecheck.mjs)
// PatrolApproachGoal's
// isRaidCenterSet() is PatrolEntity's `patrolling` flag (not hasPatrolTarget); pillager's
// priority-8 goal is a real WanderAroundGoal; vindicator/pillager/ravager's ActiveTargetGoals
// refuse an unseen candidate (TargetPredicate.respectsVisibility) and, with mustSee, drop one
// unseen > 60 ticks (TrackTargetGoal.shouldContinue). Every section breaks its own data.
//
//   node tools/raidgoalresiduecheck.mjs [--verbose]

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
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('patrolgroupcheck — #744: PatrolGoal groupmates are PatrolEntity-only, AABB expand(16), followers get the waypoint');

const M = loadEngine({
  // loop/spells-s93 — `07k_goals.js`'s evoker/illusioner roster entries now construct
  // `NS.Spell.*Goal`s (07v_spell.js); AFTER 07q_effects.js (NS.Spell.init needs NS.Effects),
  // BEFORE 07k_goals.js (build.mjs's own order — see there).
  // D-602 (raidergoals) added `02g_items.js`/`02f_tags.js`/`14f_inventory.js`/`07y_equip.js`/
  // `07b_behaviour.js`/`07l_spawn.js` — merchant/iron-golem/johnny targeting, the vindicator's
  // own BreakDoorGoal (needs `M.Diff`, `07l_spawn.js`) and the CrossbowAttackGoal
  // isEntityHoldingCrossbow() gate (needs `NS.Equip`/`NS.Items` real, not the "always assumed"
  // fallback) all need real equipment/items/door-block/difficulty modules §4 never did —
  // `build.mjs`'s own order (villagegolemcheck.mjs's own EXTRA list already proves this exact
  // module set loads and inits cleanly together for villager/iron_golem, reused here).
  extra: ['02g_items.js', '02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js',
          '07y_equip.js', '07i_entitylist.js', '14b_physics.js', '14d_survival.js',
          '14f_inventory.js', '14i_hand.js', '07q_effects.js', '14j_combat.js', '07v_spell.js',
          '07k_goals.js', '07l_spawn.js', '07s_raid.js', '07x_patrol.js',
          // loop/raidvex-s96 -- `Ai.ROSTER.vex` (07k_goals.js) constructs `NS.Fly.
          // VexMoveControl`; `07t_fly.js` is loaded straight after, matching build.mjs's own
          // relative order (it does not matter which loads first — ROSTER factories are only
          // ever CALLED at spawn time, after every module has finished loading).
          '07t_fly.js']
});
const entitiesJson = JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'));
M.DATA = Object.assign({}, M.DATA, { entities: entitiesJson });
M.Entities.init();
{
  const imeta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });
}
M.EntityList.init();
M.Hand.init();
M.Combat.init();
M.Ai.init();
M.Equip.init();
ok(M.Entities.ready, 'the entity table loaded');
ok(M.Ai.ready, 'Ai module reports ready');
ok(M.Equip.ready, 'D-602: Equip module reports ready (real crossbow/bow-holding reads, not the "always assumed" fallback)');

const EL = M.EntityList, Ai = M.Ai, Cb = M.Combat, W = M.World, CH = M.CH, Diff = M.Diff, Eq = M.Equip, IT = M.Items;
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone');
const PLAT_Y = 8;
M.Behave.init(M.World);

function freshWorld() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  ok(W.loadedAt(0, 0), 'a chunk is loaded to place into');
}
function plate(radius) {
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
    W.setBlock(x, PLAT_Y, z, STONE);
  }
}
function mkPlayer(over) {
  return Object.assign({
    x: 0, y: PLAT_Y + 1, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0, inventory: null,
    sprinting: false, onGround: true, fallDistance: 0, onClimbable: false, inWater: false,
    walkDist: 0, walkDistO: 0, speed: 0.1, health: 20
  }, over || {});
}

const RAID_MOBS = ['vindicator', 'pillager', 'witch', 'ravager', 'evoker', 'illusioner'];

const wallAt = (x) => { for (let y = PLAT_Y + 1; y <= PLAT_Y + 4; y++) W.setBlock(x, y, 0, STONE); };
const tgt = (x) => ({ x, y: PLAT_Y + 1, z: 0, vx: 0, vy: 0, vz: 0, height: 1.8, dead: false, removed: false });


{
  freshWorld(); plate(30);
  // the group logic is under test, not the pathfinder: any goal that gets a path 'succeeded' in startMovingTo
  Ai.findPath = (x, y, z, tx, ty, tz) => [{ x, y, z }, { x: tx, y: ty, z: tz }];
  const run = (leader, ticks) => { const g = new Ai.PatrolGoal(leader, EL.aiCtx(leader)); g.start(); for (let i = 0; i < ticks; i++) g.tick(); };
  const setup = () => {
    const l = EL.spawn('pillager', 0, PLAT_Y + 1, 0);
    l.patrolLeader = true; l.patrolling = true; l.patrolTarget = { x: 400, y: PLAT_Y + 1, z: 0 };
    return l;
  };
  let l = setup();
  const cow = EL.spawn('cow', 5, PLAT_Y + 1, 0);
  const mate = EL.spawn('pillager', 6, PLAT_Y + 1, 0);
  run(l, 3);
  ok(!cow.patrolling && !cow.patrolTarget, 'a cow within 16 blocks is not a patrol groupmate');
  okAv(mate.patrolling === true, 'a pillager within 16 blocks is a groupmate (patrolling set)');
  ok(mate.patrolTarget && mate.patrolTarget.x !== Math.floor(l.x) && Math.abs(mate.patrolTarget.x - l.x) > 1, 'follower gets the walk waypoint, not the leader position; got ' + JSON.stringify(mate.patrolTarget));
  EL.clear();
  // AABB, not sphere: a mate in the box corner (dx=dz=15, sphere dist > 16) counts
  freshWorld(); plate(30);
  l = setup();
  const corner = EL.spawn('pillager', 15, PLAT_Y + 1, 15);
  run(l, 3);
  okAv(corner.patrolling === true, 'a mate in the AABB corner (outside the 16 sphere) is still a groupmate');
  EL.clear();
}

{
  // #5561: patrol placement is the pillager-box SpawnHelper predicate (floor, clearance, collision)
  const Ps = M.Patrol;
  const put = (fy, mk) => { freshWorld(); plate(6); if (mk) mk(); return !!Ps.spawnPillager(M, 0, PLAT_Y + 1, 0, false, () => 0.5); };
  const Y = PLAT_Y + 1;
  ok(put(0), 'plain stone floor accepts a patrol member');
  EL.clear();
  okAv(!put(0, () => W.setBlock(0, PLAT_Y, 0, stateOf('oak_leaves'))), 'a leaves floor refuses');
  EL.clear();
  okAv(!put(0, () => W.setBlock(0, PLAT_Y, 0, stateOf('stone_slab'))), 'a bottom-slab floor (not sturdy on top) refuses');
  EL.clear();
  okAv(!put(0, () => W.setBlock(0, Y + 1, 0, stateOf('stone_slab'))), 'a 1.9-high gap (bottom slab at head height) refuses');
  EL.clear();
  const snowL = (n) => { for (let st = 0; st < M.States.count; st++) if (M.States.block[st] === M.States.snowBlock && +M.Reg.valueNames[M.States.propValue(st, M.Reg.PROP.layers)] === n) return st; return 0; };
  ok(put(0, () => W.setBlock(0, Y, 0, snowL(1))), 'a 1-layer snow cell (no collision) accepts');
  EL.clear();
  okAv(!put(0, () => W.setBlock(0, Y, 0, snowL(3))), 'a 3-layer snow cell (collides with the box) refuses');
  EL.clear();
}

console.log(`\n${fails.length === 0 ? 'PASS' : 'FAIL'} patrolgroupcheck: ${pass} assertions, ${breaks} breaks caught, ${fails.length} failure(s)`);
console.log(`${breaks} breaks caught`);
if (fails.length) { for (const f of fails.slice(0, 40)) console.log('   x ' + f); process.exit(1); }
