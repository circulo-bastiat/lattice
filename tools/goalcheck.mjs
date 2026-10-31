#!/usr/bin/env node
// goalcheck.mjs — PLAN G18b (PASS 16 JOB 1, first slice): GoalSelector and pathfinding.
//
//   node tools/goalcheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES, AND WHAT IT DOES NOT. `07k_goals.js`'s own header says it plainly:
// `EL.spawn` refuses `cow`/`zombie` today (their gravity is owed under D-309's rule), so this
// check drives the GoalSelector/PathNavigation logic directly against SYNTHETIC entities and a
// real `World`/`Physics` fixture — the same choice `mobboxcheck.mjs`/`animcheck.mjs` made before
// a live mob could be spawned at all. It proves the AI and the pathfinding are real and vanilla-
// SHAPED (the flag-conflict rule, the cliff refusal, the follow-range boundary); it does not
// prove a live mob walks around on Dan's screen — that needs the gravity gap closed first (see
// the file header) and is named as the next step, not claimed here.

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

console.log('goalcheck — PLAN G18b (PASS 16 JOB 1), the goal selector and pathfinding');

// Deterministic Math.random (mulberry32): PanicGoal's random 5x4 target pick failed ~1 run in 80 unseeded.
{ let t = 0x9e3779b9; Math.random = () => { t = (t + 0x6D2B79F5) | 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }

const M = loadEngine({
  extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js', '07s_raid.js']
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Behave.init(M.World);
M.Ai.init();
ok(M.Ai.ready, 'Ai module reports ready');
ok(M.Ai.hazardsReady(), 'D-398: the hazard/door tag table resolved from real jar tag data');

const Ai = M.Ai, W = M.World, CH = M.CH, PH = M.Physics;
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone'), WATER = stateOf('water');

/** A flat square platform of stone at y=PLAT_Y, centred on 0,0, radius r — nothing beyond it. */
const PLAT_Y = 8;
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
/** A synthetic mob — enough of `EntityList.spawn`'s own shape for the goals to read. */
function mob(type, x, y, z) {
  return { id: 1, type, x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, width: 0.9, height: 1.4, inWater: false };
}
// ⚠⚠ **A GOAL AIMS; `Ph.travelMob` MOVES — D-417.** Every fixture below used to tick a goal and
// then read the mob's POSITION, which only worked because `Ai.stepToward` teleported it. It does
// not any more: a goal writes a heading, a speed and a jump flag, and the travel step turns them
// into motion through the collision sweep. So a fixture that ticks a goal must travel too, or it
// is testing a mob that vanilla would have left standing still. `drive` is that pair.
// ⚠ AND THE SPEEDS ARE MODIFIERS NOW: `1.0` is "this mob's own MOVEMENT_SPEED", not 0.1 blocks
// per tick.
function drive(g, e, n, each) {
  for (let t = 0; t < n; t++) {
    e.zza = 0;                 // MoveControl's WAIT branch — see EL.tickMob
    g.tick();
    PH.travelMob(e);
    if (each && each(t) === false) return t;
  }
  return n;
}
function fixedRandom(seq) {
  let i = 0;
  return () => seq[i++ % seq.length];
}

// ═══ 1. GoalSelector — the flag-conflict rule ═══════════════════════════════════════════════
console.log('\n 1. GoalSelector: priority + flag conflict');
{
  function makeGoal(log, name) {
    let running = false;
    return {
      canUse: () => true, canContinueToUse: () => true,
      start: () => { running = true; log.push('start:' + name); },
      stop: () => { running = false; log.push('stop:' + name); },
      tick: () => { log.push('tick:' + name); },
      isRunning: () => running
    };
  }
  const log = [];
  const gs = new Ai.GoalSelector();
  const high = makeGoal(log, 'high');   // priority 1, MOVE
  const low = makeGoal(log, 'low');     // priority 5, MOVE — must be stopped once high claims MOVE
  gs.add(5, Ai.MOVE, low);
  gs.add(1, Ai.MOVE, high);
  gs.tick();
  ok(high.isRunning(), 'the priority-1 goal is running after one tick');
  ok(!low.isRunning(), 'the priority-5 goal is stopped: they share MOVE and 1 beats 5');
  gs.tick();
  ok(log.filter((l) => l === 'start:low').length === 0, 'the low goal never got to start at all');

  // a non-conflicting goal (different flag) runs alongside the high-priority one
  const lookLog = [];
  const gs2 = new Ai.GoalSelector();
  const mover = makeGoal(lookLog, 'mover');   // MOVE
  const looker = makeGoal(lookLog, 'looker'); // LOOK
  gs2.add(1, Ai.MOVE, mover);
  gs2.add(2, Ai.LOOK, looker);
  gs2.tick();
  ok(mover.isRunning() && looker.isRunning(), 'two goals with DIFFERENT flags run together');

  // ANTI-VACUITY: the rule disabled, and the same fixture behaves differently
  const gs3 = new Ai.GoalSelector();
  gs3.__testNoConflict = true;
  const h3 = makeGoal([], 'h3'), l3 = makeGoal([], 'l3');
  gs3.add(5, Ai.MOVE, l3); gs3.add(1, Ai.MOVE, h3);
  gs3.tick();
  okAv(h3.isRunning() && l3.isRunning(), 'with the conflict rule off, BOTH claim MOVE at once — proving the real rule (which refused this above) is load-bearing, not decorative');
}

// ═══ 2. node classification and the cliff refusal ═══════════════════════════════════════════
console.log('\n 2. node classification, groundLevel, and A*');
{
  freshWorld();
  plate(15);
  const T = Ai.NodeType;
  ok(Ai.pathTypeAt(0, PLAT_Y + 1, 0) === T.WALKABLE, 'a cell above the plate is WALKABLE');
  ok(Ai.pathTypeAt(0, PLAT_Y, 0) === T.BLOCKED, 'the stone cell itself is BLOCKED (occupied)');
  ok(Ai.pathTypeAt(30, PLAT_Y + 1, 30) === T.OPEN, 'a cell off the plate, with no floor within reach, is OPEN');

  W.setBlock(2, PLAT_Y + 1, 2, WATER);
  ok(Ai.pathTypeAt(2, PLAT_Y + 1, 2) === T.WATER, 'a water cell reads WATER');

  ok(Ai.groundLevel(0, PLAT_Y + 1, 0, 1) === PLAT_Y + 1, 'groundLevel finds the plate directly under the mob');
  ok(Ai.groundLevel(30, PLAT_Y + 1, 30, 1) === null, 'and refuses a column with no floor within the drop budget');

  // straight path on an open plate
  let p = Ai.findPath(-5, PLAT_Y + 1, 0, 5, PLAT_Y + 1, 0, { maxDrop: 1 });
  ok(!!p && p.length > 1, 'a path exists straight across an open plate');

  // a real cliff: stone stops at radius 8, then 20 blocks of nothing
  freshWorld();
  plate(8);
  p = Ai.findPath(0, PLAT_Y + 1, 0, 30, PLAT_Y + 1, 0, { maxDrop: 1, maxNodes: 300 });
  ok(p === null || Math.max(...p.map((n) => Math.abs(n.x))) <= 9,
     'the pathfinder never crosses the cliff edge reaching for an unreachable target beyond it');

  // a wall: solid from y=PLAT_Y+1..PLAT_Y+3 across z=0, x=-2..2, with an open flank
  freshWorld();
  plate(15);
  for (let x = -2; x <= 2; x++) for (let dy = 1; dy <= 3; dy++) W.setBlock(x, PLAT_Y + dy, 0, STONE);
  p = Ai.findPath(0, PLAT_Y + 1, -5, 0, PLAT_Y + 1, 5, { maxDrop: 1, maxNodes: 300 });
  ok(!!p, 'a path exists AROUND the wall');
  const offLine = p && p.some((n) => n.x !== 0);
  ok(offLine, 'the path has a node off the straight x=0 line — it routed around, not through');

  // a sealed room: no path exists, and findPath says so rather than returning something plausible
  freshWorld();
  plate(15);
  for (let x = -3; x <= 3; x++) { W.setBlock(x, PLAT_Y + 1, -3, STONE); W.setBlock(x, PLAT_Y + 1, 3, STONE); W.setBlock(x, PLAT_Y + 2, -3, STONE); W.setBlock(x, PLAT_Y + 2, 3, STONE); }
  for (let z = -3; z <= 3; z++) { W.setBlock(-3, PLAT_Y + 1, z, STONE); W.setBlock(3, PLAT_Y + 1, z, STONE); W.setBlock(-3, PLAT_Y + 2, z, STONE); W.setBlock(3, PLAT_Y + 2, z, STONE); }
  p = Ai.findPath(0, PLAT_Y + 1, 0, 12, PLAT_Y + 1, 12, { maxDrop: 1, maxNodes: 250 });
  ok(p === null, 'a sealed room refuses a path out rather than returning one anyway');

  // ANTI-VACUITY: force every node WALKABLE, and the cliff refusal disappears
  freshWorld();
  plate(8);
  Ai.__testAllWalkable = true;
  const badPath = Ai.findPath(0, PLAT_Y + 1, 0, 30, PLAT_Y + 1, 0, { maxDrop: 1, maxNodes: 300 });
  Ai.__testAllWalkable = false;
  okAv(!!badPath && badPath.some((n) => Math.abs(n.x) > 15),
       'with every node forced WALKABLE, the "pathfinder" now crosses the cliff — proving groundLevel’s real refusal (asserted above) is what stopped it, not luck');
}

// ═══ 3. FloatGoal ════════════════════════════════════════════════════════════════════════════
console.log('\n 3. FloatGoal: a mob afloat trends up, not down');
{
  freshWorld();
  plate(6);
  const e = mob('cow', 0.5, PLAT_Y + 4, 0.5);
  e.inWater = true; e.vy = -0.1;
  // ⚠ D-417: FloatGoal REQUESTS a jump (`random.nextFloat() < 0.8`); the 0.04 is
  // `LivingEntity.jumpInLiquid`, in the travel step. A rand that always fires keeps the
  // fixture deterministic.
  const g = new Ai.FloatGoal(e, () => 0);
  ok(g.canUse(), 'FloatGoal.canUse is true while inWater');
  g.start(); drive(g, e, 1);
  ok(e.vy > -0.1, `a tick of FloatGoal moves vy up from -0.1 (got ${e.vy.toFixed(3)}), not further down`);
  drive(g, e, 5);
  ok(e.vy > 0, `after several ticks the mob is rising (vy=${e.vy.toFixed(3)}), not sinking`);
  e.inWater = false;
  ok(!g.canUse(), 'and it releases MOVE|JUMP the instant the mob leaves the water');
}

// ═══ 4. PanicGoal ════════════════════════════════════════════════════════════════════════════
// `Ai.PanicGoal` is vanilla's `EscapeDangerGoal` (cloud unit referee-mob-avoid-panic): NO away-from-source
// term -- a RANDOM `NoPenaltyTargeting.find(mob, 5, 4)` point, re-picked for as long as the danger lasts
// (the old "moves toward -X, away from a +X hit" assertion described the hand-made stand-in it replaced).
console.log('\n 4. PanicGoal (EscapeDangerGoal): a hurt animal runs to random 5x4-box targets while in danger, and only then');
{
  freshWorld();
  plate(15);
  const e = mob('cow', 0, PLAT_Y + 1, 0);
  const gs = new Ai.GoalSelector();
  const panic = new Ai.PanicGoal(e, 2.0);
  gs.add(1, Ai.MOVE, panic);
  ok(!panic.canUse(), 'no attacker, not on fire: EscapeDangerGoal.isInDanger is false, the goal never starts');
  e.justHurt = true; e.hurtFromX = 3; e.hurtFromZ = 0;
  const x0 = e.x, z0 = e.z;
  let moved = 0, far = 0;
  drive(gs, e, 60, () => { if (Math.hypot(e.x - x0, e.z - z0) > 0.5) moved++; far = Math.max(far, Math.hypot(e.x - x0, e.z - z0)); });
  ok(moved > 0, `a hit starts the panic and the cow runs (${moved} of 60 ticks away from its start)`);
  e.justHurt = false; e.isOnFire = true;
  // findTarget's 10 fuzzed spots miss a flat plate's floor level (8/9 of the vertical draws) ~31% of the
  // time, so vanilla simply retries next tick -- ask up to 40 times (a flake at (0.31)^40 is none).
  let fireUse = false;
  for (let i = 0; i < 40 && !fireUse; i++) fireUse = panic.canUse();
  ok(fireUse, 'on fire with no attacker: isInDanger is true (EscapeDangerGoal.java:47 isOnFire())');
  e.isOnFire = false;
  const wolfGoal = new Ai.PanicGoal(e, 1.5, { inDanger: () => !!e.isOnFire });
  e.justHurt = true;
  ok(!wolfGoal.canUse(), 'an isInDanger override (WolfEscapeDangerGoal: fire/powder snow only) ignores a plain hit');
  e.justHurt = false;
}

// ═══ 5. WaterAvoidingRandomStrollGoal: wanders, stays on the plate ══════════════════════════
console.log('\n 5. WaterAvoidingRandomStrollGoal: wanders and stays on the plate');
{
  freshWorld();
  plate(20);
  const e = mob('cow', 0, PLAT_Y + 1, 0);
  const startX = e.x, startZ = e.z;
  const rand = fixedRandom([0.0, 0.3, 0.5, 0.01, 0.7, 0.2, 0.0, 0.6, 0.9, 0.01, 0.4, 0.5]);
  const gs = new Ai.GoalSelector();
  gs.add(7, Ai.MOVE, new Ai.WaterAvoidingRandomStrollGoal(e, 1.0, rand));
  let moved = false;
  drive(gs, e, 400, () => { if (Math.hypot(e.x - startX, e.z - startZ) > 0.5) moved = true; });
  ok(moved, 'the cow’s position changed over 400 ticks of stroll goal');
  ok(Math.abs(e.x) <= 20.5 && Math.abs(e.z) <= 20.5, `and it stayed on the plate (x=${e.x.toFixed(2)}, z=${e.z.toFixed(2)}, plate radius 20)`);
  ok(Ai.groundLevel(Math.round(e.x), Math.round(e.y) + 1, Math.round(e.z), 1) !== null, 'and it ends up standing somewhere with real ground under it');
}

// ═══ 6. NearestAttackableTargetGoal: the follow-range boundary ═════════════════════════════
console.log('\n 6. NearestAttackableTargetGoal: zombie follow range (D-336: 35)');
{
  const follow = Ai.followRangeOf({ type: 'zombie' });
  ok(follow === 35, `zombie's followRange reads 35 from entity-attributes-1.18.2.tsv (got ${follow})`);

  const near = mob('zombie', 0, 70, 0);
  const players40 = [{ x: 40, y: 70, z: 0 }];
  const goal40 = new Ai.NearestAttackableTargetGoal(near, () => players40);
  ok(!goal40.canUse(), 'a player at distance 40 (beyond followRange 35) is NOT targeted');

  const players20 = [{ x: 20, y: 70, z: 0 }];
  const goal20 = new Ai.NearestAttackableTargetGoal(near, () => players20);
  ok(goal20.canUse() && near.target === players20[0], 'a player at distance 20 (inside followRange 35) IS targeted');

  // ANTI-VACUITY: an infinite follow range, and the distance-40 refusal disappears.
  // Entities.init() snapshots NS.DATA.entities.attrs into its OWN closure (Ent.attrs), so
  // reassigning M.DATA.entities.attrs would not touch what attrsOf actually reads — the live
  // object is M.Entities.attrs, mutated in place and restored right after.
  const oldFollow = M.Entities.attrs.zombie.follow;
  M.Entities.attrs.zombie.follow = Infinity;
  const goalInf = new Ai.NearestAttackableTargetGoal(mob('zombie', 0, 70, 0), () => players40);
  const targetedAtInfinity = goalInf.canUse();
  M.Entities.attrs.zombie.follow = oldFollow;
  okAv(targetedAtInfinity, 'with followRange forced to Infinity, distance 40 now DOES target — proving the real 35 boundary (asserted above) is what refused it, not the distance test being trivially always-false');
}

// ═══ 7. MeleeAttackGoal: a zombie paths around a wall to reach the player ═══════════════════
console.log('\n 7. MeleeAttackGoal: pathing to a targeted player, around an obstacle');
{
  freshWorld();
  plate(15);
  for (let x = -3; x <= 3; x++) for (let dy = 1; dy <= 3; dy++) W.setBlock(x, PLAT_Y + dy, 0, STONE);
  const e = mob('zombie', 0, PLAT_Y + 1, -6);
  e.target = { x: 0, y: PLAT_Y + 1, z: 6 };
  const gs = new Ai.GoalSelector();
  const melee = new Ai.MeleeAttackGoal(e, 1.0);
  gs.add(2, Ai.MOVE | Ai.LOOK, melee);
  const startZ = e.z;
  let sawOffLine = false;
  drive(gs, e, 400, () => { if (Math.abs(e.x) > 0.05) sawOffLine = true; });
  ok(e.z > startZ, `the zombie moved toward the player's side of the wall (z ${startZ} -> ${e.z.toFixed(2)})`);
  ok(sawOffLine, 'and it stepped off the straight x=0 line while doing it — routed around the wall');
}


// ═══ 8. HurtByTargetGoal: retaliate against the attacker ═══════════════════════════════════
console.log('\n 8. HurtByTargetGoal: targets whoever last hurt this mob');
{
  const e = mob('zombie', 0, PLAT_Y + 1, 0);
  const g = new Ai.HurtByTargetGoal(e);
  ok(!g.canUse(), 'no attacker recorded yet: canUse is false');
  const attacker = { x: 5, y: PLAT_Y + 1, z: 0 };
  e.lastHurtByEntity = attacker;
  ok(g.canUse(), 'canUse is true once lastHurtByEntity is set');
  g.start();
  ok(e.target === attacker, 'start() sets e.target to the attacker, not a guess at one');
  ok(g.canContinueToUse(), 'continues while a target is held');
}

// ═══ 9. AvoidEntityGoal: flees a threat, and stays fled until well clear ═══════════════════
console.log('\n 9. AvoidEntityGoal: flees a nearby threat and holds the leash-back slack');
{
  freshWorld();
  plate(20);
  const e = mob('chicken', 0, PLAT_Y + 1, 0);
  const threat = { x: 4, y: PLAT_Y + 1, z: 0, type: 'zombie' };
  const isZombie = (t) => t.type === 'zombie';
  const g = new Ai.AvoidEntityGoal(e, 6, 1.2, () => [threat], isZombie);
  // KW-45 follow-up: canUse() now re-derives vanilla's own fuzzed 10-candidate escape search
  // (real RNG), exactly as probabilistic per attempt as a real goal selector's per-tick retries
  // -- so retry it the same way test 1 above retries a reciprocalChance roll.
  let acquired = false;
  for (let i = 0; i < 30 && !acquired; i++) acquired = g.canUse();
  ok(acquired, 'a zombie within range 6 is fled from');
  g.start();
  const startX = e.x, startZ = e.z;
  ok(g.canContinueToUse(), 'still fleeing right after start');
  // FleeEntityGoal.shouldContinue is `!navigation.isIdle()` ONLY -- no distance check of any
  // kind -- so moving the threat away right after start(), before the (randomly-lengthed)
  // escape path has had any chance to finish on its own, must change nothing.
  threat.x = 100; threat.z = 100;
  ok(g.canContinueToUse(), 'moving the threat far away does not stop the goal early -- only the chosen path running out does');
  drive(g, e, 4);
  const moved = Math.hypot(e.x - startX, e.z - startZ);
  ok(moved > 0, `fleeing actually moved the mob along its own escape path (${moved.toFixed(2)} blocks)`);
  drive(g, e, 300);
  ok(!g.canContinueToUse(), 'and stops once its own escape path is fully walked');

  // a threat the predicate does not recognise is never fled from
  const cow = { x: 1, y: PLAT_Y + 1, z: 0, type: 'cow' };
  const g2 = new Ai.AvoidEntityGoal(mob('chicken', 0, PLAT_Y + 1, 0), 6, 1.2, () => [cow], isZombie);
  ok(!g2.canUse(), 'a nearby cow is not a zombie: canUse stays false');
}

// ═══ 10. FollowParentGoal: a baby follows the nearest adult of its own type ═════════════════
console.log('\n 10. FollowParentGoal: baby stays near the nearest same-type adult');
{
  freshWorld();
  plate(20);
  const baby = mob('cow', 0, PLAT_Y + 1, 0);
  baby.isBaby = true;
  const adult = mob('cow', 6, PLAT_Y + 1, 0);
  const otherSpeciesAdult = mob('pig', 1, PLAT_Y + 1, 0);
  const siblings = () => [adult, otherSpeciesAdult];
  const gs = new Ai.GoalSelector();
  const follow = new Ai.FollowParentGoal(baby, 1.25, siblings);
  gs.add(4, Ai.MOVE, follow);
  const startDist = Math.hypot(adult.x - baby.x, adult.z - baby.z);
  drive(gs, baby, 300);
  const endDist = Math.hypot(adult.x - baby.x, adult.z - baby.z);
  ok(endDist < startDist, `the baby closed distance on the cow adult, not the pig (${startDist.toFixed(2)} -> ${endDist.toFixed(2)})`);
  ok(endDist > Ai.FOLLOW_PARENT_CLOSE - 0.5, 'and it does not walk INTO the parent — it stops at the close distance');

  // an adult never runs FollowParentGoal at all
  const notBaby = mob('cow', 0, PLAT_Y + 1, 0);
  const gAdult = new Ai.FollowParentGoal(notBaby, 1.25, siblings);
  ok(!gAdult.canUse(), 'an adult (isBaby unset) never uses FollowParentGoal');
}

// ═══ 11. BreedGoal: two lovers meet, and onBreed fires once, on contact ════════════════════
console.log('\n 11. BreedGoal: partners in love mode meet and breed exactly once');
{
  freshWorld();
  plate(20);
  const a = mob('cow', -3, PLAT_Y + 1, 0); a.inLove = true;
  const b = mob('cow', 3, PLAT_Y + 1, 0); b.inLove = true;
  let breedCalls = 0;
  const onBreed = () => { breedCalls++; };
  const gsA = new Ai.GoalSelector(), gsB = new Ai.GoalSelector();
  gsA.add(2, Ai.MOVE, new Ai.BreedGoal(a, 1.0, () => [a, b], onBreed));
  gsB.add(2, Ai.MOVE, new Ai.BreedGoal(b, 1.0, () => [a, b], onBreed));
  for (let t = 0; t < 400 && breedCalls === 0; t++) {
    a.zza = 0; gsA.tick(); PH.travelMob(a);
    b.zza = 0; gsB.tick(); PH.travelMob(b);
  }
  ok(breedCalls >= 1, `the two partners met and onBreed fired (calls=${breedCalls})`);
  ok(breedCalls <= 2, `onBreed did not fire repeatedly once contact was made (calls=${breedCalls})`);

  // not in love: never even starts
  const c = mob('cow', -3, PLAT_Y + 1, 0);
  const d = mob('cow', 3, PLAT_Y + 1, 0); d.inLove = true;
  const gNoLove = new Ai.BreedGoal(c, 0.1, () => [c, d], () => {});
  ok(!gNoLove.canUse(), 'a cow not in love mode never seeks a partner');
}

// ═══ 12. TemptGoal: walks toward the player holding a tempting item, and holds a standoff ══
console.log('\n 12. TemptGoal: tempted toward a food-holding player, not any player');
{
  freshWorld();
  plate(20);
  const e = mob('cow', 0, PLAT_Y + 1, 0);
  const isWheat = (item) => item === 'wheat';
  const holder = { x: 6, y: PLAT_Y + 1, z: 0, heldItem: 'wheat' };
  const bare = { x: -6, y: PLAT_Y + 1, z: 0, heldItem: null };
  const g = new Ai.TemptGoal(e, 1.25, () => [bare, holder], isWheat);
  ok(g.canUse(), 'a player holding wheat within range is tempting');
  g.start();
  const startDist = Math.hypot(holder.x - e.x, holder.z - e.z);
  drive(g, e, 200);
  const endDist = Math.hypot(holder.x - e.x, holder.z - e.z);
  ok(endDist < startDist, `the cow closed distance on the wheat-holder (${startDist.toFixed(2)} -> ${endDist.toFixed(2)})`);
  ok(endDist >= Ai.TEMPT_STANDOFF - 0.5, 'and it holds a standoff rather than walking into the player');

  // a player holding nothing tempting is ignored even if closer
  const eNoTempt = mob('cow', 0, PLAT_Y + 1, 0);
  const gNone = new Ai.TemptGoal(eNoTempt, 1.25, () => [bare], isWheat);
  ok(!gNone.canUse(), 'a player holding no food is never tempting');

  // TemptGoal has no inLove clause (#1995): a cow in love mode still chases food
  const eLove = mob('cow', 0, PLAT_Y + 1, 0);
  eLove.inLove = true;
  ok(new Ai.TemptGoal(eLove, 1.25, () => [holder], isWheat).canUse(), 'inLove does not stop TemptGoal (vanilla has no such clause)');
}

// ═══ 13. RangedBowAttackGoal (D-396): approach, back off, face, fire on cooldown ═══════════
console.log('\n 13. RangedBowAttackGoal: approach past radius, back off too close, fire on cooldown');
{
  freshWorld();
  plate(30);
  // too far: closes distance, never fires
  const e = mob('skeleton', -20, PLAT_Y + 1, 0);
  let shots = 0;
  const onShoot = () => { shots++; };
  e.target = { x: 0, y: PLAT_Y + 1, z: 0 };
  const g = new Ai.RangedBowAttackGoal(e, 1.0, onShoot);
  g.start();
  const startDist = Math.hypot(e.target.x - e.x, e.target.z - e.z);
  drive(g, e, 30, () => (Math.hypot(e.target.x - e.x, e.target.z - e.z) > Ai.RANGED_ATTACK_RADIUS ? true : false));
  const midDist = Math.hypot(e.target.x - e.x, e.target.z - e.z);
  ok(midDist < startDist, `far outside radius: the skeleton closed distance (${startDist.toFixed(1)} -> ${midDist.toFixed(1)})`);
  ok(shots === 0, `no shot fired while still outside the attack radius (shots=${shots})`);

  // inside radius: stops closing, fires on the cooldown, does not walk into the target
  drive(g, e, 400, () => (shots === 0 ? true : false));
  ok(shots >= 1, `a shot fired once inside the attack radius (shots=${shots})`);
  const closeDist = Math.hypot(e.target.x - e.x, e.target.z - e.z);
  ok(closeDist > 1, `the skeleton did not walk into melee range of its own ranged target (dist=${closeDist.toFixed(2)})`);

  // too close: backs AWAY rather than continuing to approach
  const eClose = mob('skeleton', 0, PLAT_Y + 1, 0);
  eClose.target = { x: 1, y: PLAT_Y + 1, z: 0 };   // well inside the 0.75x back-off band
  const gClose = new Ai.RangedBowAttackGoal(eClose, 1.0, () => {});
  gClose.start();
  const closeStart = Math.hypot(eClose.target.x - eClose.x, eClose.target.z - eClose.z);
  drive(gClose, eClose, 5);
  const closeAfter = Math.hypot(eClose.target.x - eClose.x, eClose.target.z - eClose.z);
  ok(closeAfter > closeStart, `point-blank: the skeleton backed AWAY instead of closing in (${closeStart.toFixed(2)} -> ${closeAfter.toFixed(2)})`);

  // ANTI-VACUITY: with no target at all, the goal never engages (forcing canUse would hide this)
  const eIdle = mob('skeleton', 0, PLAT_Y + 1, 0);
  const gIdle = new Ai.RangedBowAttackGoal(eIdle, 1.0, () => {});
  okAv(!gIdle.canUse(), 'a skeleton with no target never starts the ranged-attack goal');
}

// ═══ 14. D-398: a mob refuses fire/cactus as a path cell, and identifies a door ═════════════
console.log('\n 14. D-398: fire/cactus refused like lava; a closed wood/iron door is told apart');
{
  freshWorld();
  plate(6);
  const CACTUS = stateOf('cactus');
  const FIRE = stateOf('fire');
  const SAND = stateOf('sand');
  // cactus's own canSurvive (sand below, no solid neighbour) is a REAL rule W.setBlock enforces
  // (D-155) — placing it on the plate's stone would silently refuse and this test would measure
  // nothing, so the one cell under it is sand instead.
  W.setBlock(2, PLAT_Y, 0, SAND);
  W.setBlock(2, PLAT_Y + 1, 0, CACTUS);
  W.setBlock(-2, PLAT_Y + 1, 0, FIRE);

  ok(Ai.pathTypeAt(2, PLAT_Y + 1, 0) === Ai.NodeType.DAMAGE_CACTUS, 'a cactus cell is DAMAGE_CACTUS (s117: vanilla getCommonNodeType, was DAMAGE_OTHER) even though this engine already treats it as solid');
  ok(Ai.pathTypeAt(-2, PLAT_Y + 1, 0) === Ai.NodeType.DAMAGE_FIRE, 'a fire cell is DAMAGE_FIRE, not plain OPEN');
  // maxDrop=0, fromY = the hazard's OWN cell — isolates the hazard-identity refusal from the
  // pre-existing (and, for cactus, ALSO true) headroom/solid refusal one cell away.
  ok(Ai.groundLevel(2, PLAT_Y + 1, 0, 0) === null, 'the cactus cell itself is refused as a floor, exactly the way lava already was');
  ok(Ai.groundLevel(-2, PLAT_Y + 1, 0, 0) === null, 'the fire cell itself is refused as a floor, exactly the way lava already was');
  ok(Ai.groundLevel(0, PLAT_Y + 1, 0, 0) === PLAT_Y + 1, 'a plain plate cell two away is still a legal floor (the rule is not over-firing)');

  // ANTI-VACUITY: disabling the new refusal must make the fire test above actually fail. Fire
  // is the clean anti-vacuity case (genuinely non-solid in this engine, unlike cactus, whose
  // OWN collision independently refuses it too — see the file header's D-398 note) — flipping
  // the flag off here isolates the NEW rule rather than tripping over a different, older one.
  Ai.__testHazardsOff = true;
  okAv(Ai.groundLevel(-2, PLAT_Y + 1, 0, 0) === PLAT_Y + 1,
       'anti-vacuity: with the hazard refusal disabled, the SAME fire cell IS accepted as a floor — so the refusal test above can actually fail (D-30/D-305)');
  Ai.__testHazardsOff = false;

  // doors — both halves, both materials
  const woodLower = stateOf('oak_door');
  const woodUpper = M.Behave.setProp(woodLower, 'half', 'upper');
  W.setBlock(4, PLAT_Y + 1, 0, woodLower);
  W.setBlock(4, PLAT_Y + 2, 0, woodUpper);
  let d = Ai.doorAt(4, PLAT_Y + 1, 0);
  ok(!!d && d.closed && d.wood && !d.iron, 'a freshly placed oak door reads as CLOSED, WOOD, not IRON');
  const opened = M.Behave.setProp(woodLower, 'open', 'true');
  W.setBlock(4, PLAT_Y + 1, 0, opened);
  d = Ai.doorAt(4, PLAT_Y + 1, 0);
  ok(!!d && !d.closed, 'the same door, opened, reads as NOT closed');

  const ironLower = stateOf('iron_door');
  W.setBlock(-4, PLAT_Y + 1, 0, ironLower);
  d = Ai.doorAt(-4, PLAT_Y + 1, 0);
  ok(!!d && d.closed && d.iron && !d.wood, 'a closed iron door reads as CLOSED, IRON, not WOOD');

  ok(Ai.doorAt(0, PLAT_Y + 1, 0) === null, 'a plain stone cell is not a door at all');
}

// #5069: DoorInteractGoal reads the live path record; a door one node ahead at node.y+1
const withPath = (m) => { m.navPath = [{ x: 0, y: PLAT_Y, z: 0 }, { x: 1, y: PLAT_Y, z: 0 }, { x: 2, y: PLAT_Y, z: 0 }]; m.navIdx = 0; return m; };
// ═══ 15. D-399: BreakDoorGoal — a chasing zombie breaks a closed wooden door, gated on mobGriefing ═══
console.log('\n 15. D-399: BreakDoorGoal breaks a closed wooden door ahead of a chasing zombie');
{
  freshWorld();
  plate(6);
  function placeDoor(x, z, iron) {
    const lower = stateOf(iron ? 'iron_door' : 'oak_door');
    const upper = M.Behave.setProp(lower, 'half', 'upper');
    W.setBlock(x, PLAT_Y + 1, z, lower);
    W.setBlock(x, PLAT_Y + 2, z, upper);
  }
  function run(griefing, iron) {
    placeDoor(1, 0, iron);
    const e = withPath(mob('zombie', 0, PLAT_Y + 1, 0));
    e.target = { x: 3, y: PLAT_Y + 1, z: 0, removed: false, dead: false };
    const g = new Ai.BreakDoorGoal(e, { mobGriefing: () => griefing });
    ok(g.canUse() === !!griefing, `canUse() reflects the mobGriefing gate (griefing=${griefing})`);
    if (!g.canUse()) { W.setBlock(1, PLAT_Y + 1, 0, 0); W.setBlock(1, PLAT_Y + 2, 0, 0); return null; }
    g.start();
    for (let t = 0; t < Ai.DOOR_BREAK_TICKS + 5 && g.canContinueToUse(); t++) g.tick();
    const still = Ai.doorAt(1, PLAT_Y + 1, 0);
    return still;
  }

  const afterOn = run(true, false);
  ok(afterOn === null, 'mobGriefing ON, wooden door: broken after the progress gauge (Ai.doorAt now sees nothing there)');

  W.setBlock(1, PLAT_Y + 1, 0, 0); W.setBlock(1, PLAT_Y + 2, 0, 0);
  const eOff = withPath(mob('zombie', 0, PLAT_Y + 1, 0));
  eOff.target = { x: 3, y: PLAT_Y + 1, z: 0, removed: false, dead: false };
  placeDoor(1, 0, false);
  const gOff = new Ai.BreakDoorGoal(eOff, { mobGriefing: () => false });
  okAv(!gOff.canUse(), 'anti-vacuity: mobGriefing OFF refuses canUse() outright — the gate can actually fire');

  W.setBlock(1, PLAT_Y + 1, 0, 0); W.setBlock(1, PLAT_Y + 2, 0, 0);
  const eIron = withPath(mob('zombie', 0, PLAT_Y + 1, 0));
  eIron.target = { x: 3, y: PLAT_Y + 1, z: 0, removed: false, dead: false };
  placeDoor(1, 0, true);
  const gIron = new Ai.BreakDoorGoal(eIron, { mobGriefing: () => true });
  ok(!gIron.canUse(), 'an IRON door is never a target — canUse() refuses it even with mobGriefing on');
}

// ═══ 15b. #4118: BreakDoorGoal needs NO target; shouldContinue stops beyond 2.0 of the door ═══
console.log('\n 15b. #4118: BreakDoorGoal with target=null; within-2.0 continue test');
{
  freshWorld();
  plate(6);
  const lower = stateOf('oak_door'), upper = M.Behave.setProp(lower, 'half', 'upper');
  W.setBlock(1, PLAT_Y + 1, 0, lower); W.setBlock(1, PLAT_Y + 2, 0, upper);
  const e = withPath(mob('zombie', 0, PLAT_Y + 1, 0));
  e.target = null;
  const g = new Ai.BreakDoorGoal(e, { mobGriefing: () => true });
  ok(g.canUse(), 'no target: canUse() still true (vanilla consults none)');
  g.start();
  for (let t = 0; t < Ai.DOOR_BREAK_TICKS + 5 && g.canContinueToUse(); t++) g.tick();
  ok(Ai.doorAt(1, PLAT_Y + 1, 0) === null, 'no target: door broken after the progress gauge');
  W.setBlock(1, PLAT_Y + 1, 0, lower); W.setBlock(1, PLAT_Y + 2, 0, upper);
  g.start(); g.canUse();
  ok(g.canContinueToUse(), 'adjacent: shouldContinue true');
  e.x -= 3;
  okAv(!g.canContinueToUse(), 'anti-vacuity: mob >2 blocks from the door stops the goal');
  const e2 = withPath(mob('zombie', 0, PLAT_Y + 1, 0)); e2.horizontalCollision = false;
  okAv(!new Ai.BreakDoorGoal(e2, { mobGriefing: () => true }).canUse(), 'anti-vacuity: no horizontalCollision refuses');
  W.setBlock(1, PLAT_Y + 1, 0, 0); W.setBlock(1, PLAT_Y + 2, 0, 0);
}

// ═══ 16. D-400: BreakDoorGoal's own HARD-difficulty half, gated on ctx.isHard() ═══
console.log('\n 16. D-400: BreakDoorGoal refuses to open on ctx.isHard() === false, same as mobGriefing');
{
  freshWorld();
  plate(6);
  function placeDoor(x, z) {
    const lower = stateOf('oak_door');
    const upper = M.Behave.setProp(lower, 'half', 'upper');
    W.setBlock(x, PLAT_Y + 1, z, lower);
    W.setBlock(x, PLAT_Y + 2, z, upper);
  }

  // default (no isHard passed at all) preserves this goal's pre-D-400 behaviour — a caller
  // that does not know about difficulty still sees mobGriefing alone decide it.
  placeDoor(1, 0);
  const eDefault = withPath(mob('zombie', 0, PLAT_Y + 1, 0));
  eDefault.target = { x: 3, y: PLAT_Y + 1, z: 0, removed: false, dead: false };
  const gDefault = new Ai.BreakDoorGoal(eDefault, { mobGriefing: () => true });
  ok(gDefault.canUse(), 'no isHard passed at all: canUse() still opens (default true, unchanged pre-D-400 shape)');

  // ctx.isHard() === true: unaffected, same as before.
  W.setBlock(1, PLAT_Y + 1, 0, 0); W.setBlock(1, PLAT_Y + 2, 0, 0);
  placeDoor(1, 0);
  const eHard = withPath(mob('zombie', 0, PLAT_Y + 1, 0));
  eHard.target = { x: 3, y: PLAT_Y + 1, z: 0, removed: false, dead: false };
  const gHard = new Ai.BreakDoorGoal(eHard, { mobGriefing: () => true, isHard: () => true });
  ok(gHard.canUse(), 'mobGriefing on, isHard() true: canUse() opens');

  // ctx.isHard() === false (this engine's real default, since NS.Diff defaults to 'normal'):
  // mobGriefing alone is not enough any more — this is the actual bug D-400 fixes.
  W.setBlock(1, PLAT_Y + 1, 0, 0); W.setBlock(1, PLAT_Y + 2, 0, 0);
  placeDoor(1, 0);
  const eNotHard = withPath(mob('zombie', 0, PLAT_Y + 1, 0));
  eNotHard.target = { x: 3, y: PLAT_Y + 1, z: 0, removed: false, dead: false };
  const gNotHard = new Ai.BreakDoorGoal(eNotHard, { mobGriefing: () => true, isHard: () => false });
  okAv(!gNotHard.canUse(), 'anti-vacuity: mobGriefing on but isHard() false (NS.Diff default \'normal\'): canUse() now refuses — vanilla\'s own HARD-only gate, previously not enforced at all');

  // canContinueToUse must drop the same way mid-break, not just at the canUse() gate.
  W.setBlock(1, PLAT_Y + 1, 0, 0); W.setBlock(1, PLAT_Y + 2, 0, 0);
  placeDoor(1, 0);
  const eMid = withPath(mob('zombie', 0, PLAT_Y + 1, 0));
  eMid.target = { x: 3, y: PLAT_Y + 1, z: 0, removed: false, dead: false };
  let hard = true;
  const gMid = new Ai.BreakDoorGoal(eMid, { mobGriefing: () => true, isHard: () => hard });
  ok(gMid.canUse(), 'starts hard: canUse() opens');
  gMid.start();
  gMid.tick();
  hard = false;
  okAv(!gMid.canContinueToUse(), 'anti-vacuity: difficulty dropping below hard mid-break stops canContinueToUse(), same shape mobGriefing OFF already has');
  W.setBlock(1, PLAT_Y + 1, 0, 0); W.setBlock(1, PLAT_Y + 2, 0, 0);

  // NS.Diff itself, the live store both this goal (via EL.aiCtx) and 07l_spawn.js's own
  // Diff.isPeaceful() read (D-400's own §17 in spawncheck.mjs proves the spawn side).
  ok(!!M.Diff, 'NS.Diff exists — the shared difficulty store D-400 introduced');
  ok(M.Diff.get() === 'normal', 'NS.Diff defaults to normal, unchanged from every session before D-400');
  ok(!M.Diff.isHard() && !M.Diff.isPeaceful(), 'normal is neither hard nor peaceful');
  M.Diff.set('hard');
  ok(M.Diff.isHard() === true, 'Diff.set(\'hard\') is readable back as hard');
  ok(M.EntityList.aiCtx({ x: 0, y: 0, z: 0 }).isHard() === true, 'EL.aiCtx wires isHard() to the live NS.Diff state, not a snapshot');
  M.Diff.set('bogus');
  ok(M.Diff.get() === 'hard', 'Diff.set() refuses an unknown level rather than silently accepting it');
  M.Diff.set('normal');   // leave the shared store as later sections in this file expect it
}

// ═══ 17. D-401: spider — LeapAtTargetGoal, SpiderAttackGoal, SpiderTargetGoal, climbing ═══
console.log('\n 17. D-401: spider — leap, the strike\'s own wider reach, the daylight escape, climbing');
{
  freshWorld();
  plate(15);

  ok(typeof Ai.ROSTER.spider === 'function', 'spider is in Ai.ROSTER now (D-401)');
  const rosterMob = mob('spider', 0, PLAT_Y + 1, 0);
  const gsLive = Ai.selectorFor(rosterMob, { players: () => [], random: Math.random });
  ok(gsLive && typeof gsLive.tick === 'function', 'Ai.selectorFor(spider) builds a real GoalSelector, not null');

  // ── LeapAtTargetGoal ────────────────────────────────────────────────────────────────────
  const eLeap = mob('spider', 0, PLAT_Y + 1, 0);
  eLeap.onGround = true; eLeap.vx = 0; eLeap.vz = 0;
  const leap = new Ai.PounceAtTargetGoal(eLeap, { random: fixedRandom([0]) }, 0.4);
  ok(!leap.canUse(), 'no target at all: canUse() refuses');
  eLeap.target = { x: 1, y: PLAT_Y + 1, z: 0 };   // distanceSq = 1, below LEAP_MIN_DSQ (4)
  ok(!leap.canUse(), 'target too close (distSq 1 < 4): canUse() refuses — the 4..16 band is real');
  eLeap.target = { x: 20, y: PLAT_Y + 1, z: 0 };  // distanceSq = 400, above LEAP_MAX_DSQ (16)
  ok(!leap.canUse(), 'target too far (distSq 400 > 16): canUse() refuses');
  eLeap.target = { x: 3, y: PLAT_Y + 1, z: 0 };   // distanceSq = 9, inside the band
  eLeap.onGround = false;
  ok(!leap.canUse(), 'in band but airborne: canUse() refuses — vanilla only leaps from the ground');
  eLeap.onGround = true;
  ok(leap.canUse(), 'in band, on the ground, and the fixed-0 roll lands: canUse() opens');
  const missGoal = new Ai.PounceAtTargetGoal(eLeap, { random: fixedRandom([1, 1, 1, 1, 1]) }, 0.4);
  okAv(!missGoal.canUse(), 'anti-vacuity: a roll that never lands 0-of-5 refuses canUse() — the 1-in-5 gate can actually fail');
  eLeap.passengers = [{}];
  okAv(!leap.canUse() && !new Ai.SpiderAttackGoal(eLeap, {}).canUse(), '#1231: a spider carrying a passenger — Leap/SpiderAttack canUse() refuse (hasPassengers)');
  eLeap.passengers = [];
  ok(leap.canUse() && new Ai.SpiderAttackGoal(eLeap, {}).canUse(), '#1231: rider gone — both open again');
  { const Rd = M.Raid;
    if (!Rd) throw new Error('M.Raid missing'); else {
      const rider = { type: 'skeleton', x: 0, y: 0, z: 0 };
      Rd.startRiding(rider, eLeap);
      okAv(!new Ai.SpiderAttackGoal(eLeap, {}).canUse(), '#1343: Rd.startRiding sets e.passenger — SpiderAttackGoal.canUse() refuses');
      Rd.stopRiding(rider);
      ok(new Ai.SpiderAttackGoal(eLeap, {}).canUse(), '#1343: after Rd.stopRiding it opens again');
    } }
  { // #5462: vanilla nextInt(toGoalTicks(5))=nextInt(3) every OTHER tick -> 100000/6 leaps; plain nextInt(5) each tick would be 20000
    for (const kind of ['spider', 'wolf']) {
      let st = kind === 'spider' ? 12345 : 67890;
      const lcg = () => (st = (st * 1664525 + 1013904223) >>> 0) / 4294967296;
      const eK = mob(kind, 0, PLAT_Y + 1, 0); eK.onGround = true; eK.target = { x: 3, y: PLAT_Y + 1, z: 0 };
      const g = new Ai.PounceAtTargetGoal(eK, { random: lcg }, 0.4);
      let n = 0; for (let i = 0; i < 100000; i++) if (g.canUse()) n++;
      const want = 100000 / 6;
      ok(Math.abs(n - want) < want * 0.04, `${kind}: 100000-tick leap count ${n} within 4% of vanilla ${want.toFixed(0)}`);
      okAv(Math.abs(20000 - want) > want * 0.04, `anti-vacuity: nextInt(5) per tick (20000) is outside the tolerance for ${kind}`);
    } }
  leap.start();
  ok(Math.abs(eLeap.vy - 0.4) < 1e-9, `start() forces vy to the momentum multiplier exactly (0.4, got ${eLeap.vy})`);
  const horizLen = Math.hypot(eLeap.vx, eLeap.vz);
  ok(Math.abs(horizLen - 0.4) < 1e-6, `start() with zero prior velocity gives a pure 0.4-length horizontal kick toward the target (got ${horizLen.toFixed(4)})`);
  ok(eLeap.vx > 0, 'the kick points toward the target (+x), not away or sideways');
  eLeap.onGround = false;
  ok(leap.canContinueToUse(), 'still airborne: canContinueToUse() holds');
  eLeap.onGround = true;
  okAv(!leap.canContinueToUse(), 'anti-vacuity: landing (onGround true again) ends canContinueToUse()');

  // ── SpiderAttackGoal: the WIDER reach, bytecode-read as 4.0F + target.getBbWidth() ─────────
  const eAtk = mob('spider', 0, PLAT_Y + 1, 0);
  W.setLight(0, PLAT_Y + 1, 0, 0);   // dark — the daylight escape must not fire here
  eAtk.target = { x: 2, y: PLAT_Y + 1, z: 0, width: 0.6 };   // distSq = 4, reach = 4 + 0.6 = 4.6
  const atk = new Ai.SpiderAttackGoal(eAtk, { random: () => 1 });
  ok(atk.canUse(), 'has a target: canUse() opens (isVehicle() cannot be true in this engine)');
  ok(Math.abs(Ai.spiderAttackReachSqr(eAtk.target) - 4.6) < 1e-9, `spiderAttackReachSqr is 4.0 + target width, not MeleeAttackGoal's 4*mobWidth²+targetWidth (got ${Ai.spiderAttackReachSqr(eAtk.target)})`);
  atk.start();
  atk.tick();
  ok(Math.hypot(eAtk.target.x - eAtk.x, eAtk.z - eAtk.target.z) <= 2.001, 'sanity: tick() ran without throwing');

  // a distance MeleeAttackGoal's own formula (4*0.9²+0.6=3.84) would refuse but Spider's own
  // WIDER one (4.6) still accepts, proving the two reach formulas are genuinely different —
  // not just a duplicate of Ai.attackReachSqr under a new name.
  const eWide = mob('spider', 0, PLAT_Y + 1, 0);
  eWide.target = { x: 2, y: PLAT_Y + 1, z: 0, width: 0.6 };   // distSq = 4
  ok(4 > Ai.attackReachSqr(eWide, eWide.target), 'sanity: distSq 4 is OUTSIDE MeleeAttackGoal\'s own reach for a 0.9-wide mob (3.84)');
  ok(4 <= Ai.spiderAttackReachSqr(eWide.target), 'but INSIDE SpiderAttackGoal\'s own wider reach (4.6) — the override is real, not cosmetic');

  // ── SpiderNavigation: no path -> still walks straight at the target (D-1233) ───────────────
  {
    const eNav = mob('spider', 0, PLAT_Y + 1, 0);
    eNav.target = { x: 0.5, y: PLAT_Y + 40, z: 10.5, width: 0.6 };   // sealed in the air: no path exists
    const nav = new Ai.SpiderAttackGoal(eNav, { random: () => 1 });
    nav.start(); nav.tick();
    ok(!!eNav.navigating && eNav.navNode && eNav.navNode.z === 10,
      'unpathable target: the spider still steers at it (SpiderNavigation keeps moveTo(targetPos))');
    const eFar = mob('spider', 0, PLAT_Y + 1, 0);
    eFar.navigating = false;
    eFar.target = { x: 0.5, y: PLAT_Y + 1, z: 0.5, width: 0.6 };   // already on top of it
    const arrived = new Ai.SpiderAttackGoal(eFar, { random: () => 1 });
    arrived.start(); arrived.tick();
    okAv(!eFar.navigating, 'anti-vacuity: standing at the target the spider does not keep steering');
  }

  // ── SpiderAttackGoal: the daylight escape (light >= 0.5, 1-in-100 roll) ────────────────────
  const eEscape = mob('spider', 5, PLAT_Y + 1, 5);
  eEscape.target = { x: 6, y: PLAT_Y + 1, z: 5, width: 0.6 };
  W.setLight(5, PLAT_Y + 1, 5, (15 << 4) | 0);   // full sky light, no Sky/Redstone loaded here
  // so Ai.lightLevelDependentMagicValue's own skyDarken term defaults to 0 — raw=15, ramp[15]=1.0
  ok(Ai.lightLevelDependentMagicValue(5, PLAT_Y + 1, 5) >= 0.5, `sanity: full sky light reads as bright (>= 0.5), got ${Ai.lightLevelDependentMagicValue(5, PLAT_Y + 1, 5).toFixed(3)}`);
  const bright1in100 = new Ai.SpiderAttackGoal(eEscape, { random: () => 0 });   // 0 < 0.01 -> the roll lands
  okAv(!bright1in100.canContinueToUse(), 'anti-vacuity: bright + a landed 1-in-100 roll drops the target and refuses canContinueToUse()');
  ok(eEscape.target === null, 'and the drop is real — e.target is nulled, not just the goal stopping');

  eEscape.target = { x: 6, y: PLAT_Y + 1, z: 5, width: 0.6 };
  const brightMiss = new Ai.SpiderAttackGoal(eEscape, { random: () => 0.5 });   // 0.5 >= 0.01 -> misses
  ok(brightMiss.canContinueToUse(), 'bright but the 1-in-100 roll misses: target is kept, canContinueToUse() true');
  ok(!!eEscape.target, 'e.target is unchanged when the roll misses');

  W.setLight(5, PLAT_Y + 1, 5, 0);   // dark again
  eEscape.target = { x: 6, y: PLAT_Y + 1, z: 5, width: 0.6 };
  const darkGoal = new Ai.SpiderAttackGoal(eEscape, { random: () => 0 });   // roll would land, but it's dark
  ok(darkGoal.canContinueToUse(), 'dark: the escape never rolls at all, regardless of the random() value — light gates the roll, not the other way round');

  // ── SpiderTargetGoal: refuses to ACQUIRE a target in bright light, same threshold ──────────
  const eSel = mob('spider', 8, PLAT_Y + 1, 8);
  const player = { x: 9, y: PLAT_Y + 1, z: 8 };
  W.setLight(8, PLAT_Y + 1, 8, 0);
  const selDark = new Ai.SpiderTargetGoal(eSel, { random: () => 0 }, () => [player]);   // #4288: 1-in-10 roll lands
  ok(selDark.canUse(), 'dark: SpiderTargetGoal can acquire the nearby player (follow range 16, D-336/entity-attributes)');
  selDark.stop();
  W.setLight(8, PLAT_Y + 1, 8, (15 << 4) | 0);
  const selBright = new Ai.SpiderTargetGoal(eSel, {}, () => [player]);
  okAv(!selBright.canUse(), 'anti-vacuity: full daylight refuses to ACQUIRE a target at all — the same 0.5 threshold, a different consequence than the attack goal\'s own escape');

  // ── climbing: Ph.onClimbable's spider branch, and EL.tickOne actually calling climbClamp ──
  const Ph = M.Physics;
  const eClimb = { type: 'spider', x: 0.5, y: PLAT_Y + 1, z: 0.5, width: 1.4, height: 0.9,
    vx: 0, vy: -1, vz: 0, onGround: false, living: true, gravity: 0.08, drag: 0.98,
    horizontalCollision: false, age: 0 };
  ok(!Ph.onClimbable(eClimb), 'a spider with no recorded horizontalCollision is not "climbing" yet');
  eClimb.climbingWall = true;
  ok(Ph.onClimbable(eClimb), 'once horizontalCollision is true, Ph.onClimbable says yes for a spider — the whole D-401 mechanism');
  ok(Ph.onClimbable({ type: 'cave_spider', x: 0.5, y: PLAT_Y + 1, z: 0.5, climbingWall: true }),
    'CaveSpiderEntity extends SpiderEntity: a cave_spider climbs on horizontalCollision too (#1229)');
  ok(!Ph.onClimbable({ type: 'zombie', x: 0.5, y: PLAT_Y + 1, z: 0.5, horizontalCollision: true }),
    'the SAME horizontalCollision does nothing for a zombie — this is a spider-only override, not a generic one');
  Ph.climbClamp(eClimb, null);
  ok(eClimb.vy >= -Ph.CLIMB_CLAMP - 1e-9, `climbClamp caught the -1 fall speed and clamped it to -${Ph.CLIMB_CLAMP} (got ${eClimb.vy})`);
  ok(eClimb.fallDistance === 0, 'climbClamp also resets fall distance, same as it already does for a player on a ladder');

  // build a real wall and prove EL.tickOne's own wiring (not just the helper functions in
  // isolation) actually stops a spider's fall against it. Starts clear of the wall and walks
  // IN, so the very first collision is unambiguous rather than an already-overlapping spawn.
  M.EntityList.clear();
  for (let x = 2; x <= 3; x++) for (let y = PLAT_Y + 1; y <= PLAT_Y + 6; y++) W.setBlock(x, y, 0, STONE);
  const wallSpider = M.EntityList.spawn('spider', 5, PLAT_Y + 3, 0.5);
  ok(!!wallSpider, 'EL.spawn(\'spider\', ...) succeeds now that D-401 gave it a measured gravity/drag row');
  wallSpider.ai = null;   // isolate the physics wiring from the goal selector's own choices
  wallSpider.vy = -0.2; wallSpider.vz = 0;
  let sawCollision = false, sawSlow = false;
  for (let t = 0; t < 12; t++) {
    wallSpider.vx = -0.3;   // a live AI re-asserts "walk into the wall" every tick; one push is not climbing
    M.EntityList.tickOne(wallSpider);
    if (wallSpider.horizontalCollision) {
      sawCollision = true;
      if (wallSpider.vy >= -Ph.CLIMB_CLAMP - 1e-9) sawSlow = true;
    }
  }
  ok(sawCollision, `sanity: the spider actually reached and collided with the wall (x ended at ${wallSpider.x.toFixed(2)})`);
  okAv(sawSlow, 'anti-vacuity: once collided, EL.tickOne\'s own wiring clamps the spider\'s OWN live fall speed — not just climbClamp called by hand in isolation above');
}

// ═══ 13b. D-597 — BowAttackGoal (.decomp BowAttackGoal.java), skeleton's real bow goal ═════
console.log('\n 13b. BowAttackGoal: seen-gate, 20-tick draw, interval by difficulty, strafe, loses an unseen target');
{
  freshWorld();
  plate(40);
  const run = (diff, seeFn, n, pos) => {
    M.Diff.set(diff);
    const e = mob('skeleton', pos || 0, PLAT_Y + 1, 0);
    e.target = { x: 10, y: PLAT_Y + 1, z: 0, height: 1.8 };
    const shotAt = [];
    let t = 0;
    const g = new Ai.BowAttackGoal(e, 1.0, (me, tg, pull) => { shotAt.push({ t, pull }); }, fixedRandom([0.5]), seeFn);
    g.start();
    const seenXxa = [];
    for (t = 1; t <= n; t++) {
      e.zza = 0; e.xxa = 0;
      g.tick();
      seenXxa.push({ zza: e.zza, xxa: e.xxa });
      PH.travelMob(e, e.xxa);
      e.target.x = e.x + 10; e.target.z = e.z;   // keep it at 10 blocks: inside 15, outside 0.75*15
    }
    M.Diff.set('normal');
    return { e, shotAt, seenXxa, g };
  };
  const always = () => true, never = () => false;
  const N = run('normal', always, 200);
  ok(N.shotAt.length >= 2, `normal: the skeleton fired (${N.shotAt.length} shots in 200 ticks)`);
  ok(N.shotAt[0] && N.shotAt[0].t === 21, `the first shot leaves after a full 20-tick draw started on tick 1 (tick ${N.shotAt[0] && N.shotAt[0].t})`);
  ok(N.shotAt[0] && N.shotAt[0].pull === 1, `a 20-tick draw is BowItem.getPullProgress(20) = 1 (${N.shotAt[0] && N.shotAt[0].pull})`);
  const gapN = N.shotAt[1].t - N.shotAt[0].t;
  ok(gapN === Ai.BOW_INTERVAL + Ai.BOW_DRAW_TICKS, `normal: shot-to-shot is interval 40 + a 20-tick redraw (${gapN})`);
  const H = run('hard', always, 200);
  const gapH = H.shotAt[1].t - H.shotAt[0].t;
  ok(gapH === Ai.BOW_INTERVAL_HARD + Ai.BOW_DRAW_TICKS, `hard: interval 20 (updateAttackType) + redraw (${gapH})`);
  okAv(gapH < gapN, 'anti-vacuity: difficulty really changes the cadence (hard faster than normal)');
  // strafe: combat starts once seen >= 20 ticks in range; 10 blocks is between 1/4 and 3/4 of 15² so direction holds
  const strafing = N.seenXxa.slice(25).filter((m) => m.xxa !== 0).length;
  ok(strafing > 100, `in range and seen, the skeleton strafes sideways every tick (${strafing} of ${N.seenXxa.length - 25})`);
  ok(N.seenXxa.slice(0, 19).every((m) => m.xxa === 0), 'not before the 20-tick seen gate');
  // unseen: never fires, and a started draw is dropped past -60
  const U = run('normal', never, 200);
  ok(U.shotAt.length === 0, `a target it cannot SEE is never shot (${U.shotAt.length})`);
  ok(!U.e.usingItem, 'and after >60 unseen ticks the draw is cleared (clearActiveItem)');
  // anti-vacuity: the OLD one-clock stand-in shoots the unseen target anyway
  {
    const e2 = mob('skeleton', 0, PLAT_Y + 1, 0); e2.target = { x: 10, y: PLAT_Y + 1, z: 0 };
    let old = 0; const g2 = new Ai.RangedBowAttackGoal(e2, 1.0, () => { old++; }, 15, () => false); g2.start();
    for (let t = 0; t < 100; t++) { e2.zza = 0; g2.tick(); }
    ok(old === 0, `RangedBowAttackGoal (#216) also never shoots an unseen target (${old})`);
  }
  // Ai.canSee against a real wall
  {
    freshWorld(); plate(20);
    const a = mob('skeleton', 0, PLAT_Y + 1, 0), b = { x: 6, y: PLAT_Y + 1, z: 0, height: 1.8, type: 'zombie' };
    ok(Ai.canSee(a, b) === true, 'canSee: an open line between two eyes is seen');
    for (let y = 0; y < 3; y++) W.setBlock(3, PLAT_Y + 1 + y, 0, STONE);
    okAv(Ai.canSee(a, b) === false, 'anti-vacuity: a stone wall between them blocks the ray');
  }
  // s135 (Dan: "i am being pursued in creative") — vanilla TargetPredicate(attackable) +
  // LivingEntity.canTarget: a player whose abilities are invulnerable (creative/spectator), or any
  // player on peaceful, is never a mob's target; a survival player still is (both directions).
  {
    const surv = { type: 'player', x: 0, y: 0, z: 0 };
    const crea = { type: 'player', x: 0, y: 0, z: 0, invulnerableGamemode: true };
    const z = mob('zombie', 0, PLAT_Y + 1, 0);
    ok(Ai.canTargetLiving(surv) === true, 'a survival player is a valid target');
    z.target = surv; Ai.dropUntargetable(z);
    ok(z.target === surv, 'a mob keeps its survival-player target');
    ok(Ai.canTargetLiving(crea) === false, 'a creative (invulnerable) player is not a valid target');
    z.target = crea; Ai.dropUntargetable(z);
    ok(z.target === null, 'a mob drops a creative-player target (TrackTargetGoal.shouldContinue)');
    const was = M.Diff.value; M.Diff.value = 'peaceful';
    ok(Ai.canTargetLiving(surv) === false, 'on peaceful even a survival player is not a target');
    M.Diff.value = was;
    const zombieTarget = { type: 'zombie', x: 0, y: 0, z: 0, invulnerableGamemode: true };
    ok(Ai.canTargetLiving(zombieTarget) === true, 'the player-only gates never refuse a non-player target');
    const src = readFileSync(join(ROOT, 'src', '07i_entitylist.js'), 'utf8');
    const a0 = src.indexOf('EL.tickMob = function'), a1 = src.indexOf('\n  EL.', a0 + 10);
    const body = src.slice(a0, a1 > 0 ? a1 : undefined);
    ok((body.match(/dropUntargetable\(e\)/g) || []).length === 2, 'EL.tickMob gates the target before AND after the goal tick');
    const saved = Ai.canTargetLiving; Ai.canTargetLiving = () => true;
    z.target = crea; Ai.dropUntargetable(z);
    Ai.canTargetLiving = saved;
    okAv(z.target === crea, 'anti-vacuity: with the gate answering yes (the pre-s135 engine) the creative player stays hunted');
  }
  // s135 (Dan's console, 25 Sept): a block with NO collision shape (a flower, a torch) on the line
  // made `Physics.shapesForState` return null and canSee threw — every mob that looked for a
  // player through grass/flowers stopped thinking (Pg.preferredTarget -> nearestPlayer -> canSee).
  {
    freshWorld(); plate(20);
    const POPPY = stateOf('poppy');
    const a = mob('skeleton', 0, PLAT_Y + 1, 0), b = { x: 6, y: PLAT_Y + 1, z: 0, height: 1.8, type: 'zombie' };
    for (let y = 0; y < 3; y++) W.setBlock(3, PLAT_Y + 1 + y, 0, POPPY);
    ok(PH.shapesForState(POPPY) === null, 'a poppy has no collision shape (null) — the case under test');
    let r, threw = null;
    try { r = Ai.canSee(a, b); } catch (err) { threw = err.message; }
    ok(threw === null && r === true, `canSee: a poppy on the line neither throws nor blocks the view (${threw || r})`);
    let oldThrew = false;
    try { (PH.shapesForState(POPPY)).length; } catch (err) { oldThrew = true; }
    okAv(oldThrew, 'anti-vacuity: the pre-s135 predicate `shapesForState(st).length` throws on that same poppy');
  }
}

// ═══ #1239. zombie RevengeGoal.setGroupRevenge(ZombifiedPiglinEntity.class) ═════════════════
console.log('\n #1239. zombie group revenge alerts nearby zombies, never zombified piglins');
{
  const mk = (type, x) => Object.assign(mob(type, x, 64, 0), { target: null });
  const attacker = { x: 0, y: 64, z: 5, type: 'player' };
  const run = (hitType, others) => {
    const hit = mk(hitType, 0), all = [hit, ...others];
    const gs = Ai.ROSTER[hitType](hit, { entities: () => all, players: () => [], random: Math.random });
    const g = gs.entries.find((en) => en.flags === Ai.TARGET && en.priority === 1).goal;
    hit.lastHurtByEntity = attacker; g.start();
    return others.map((o) => o.target === attacker);
  };
  const z2 = mk('zombie', 4), zp = mk('zombified_piglin', 6), sk = mk('skeleton', 3), far = mk('zombie', 60);
  const r = run('zombie', [z2, zp, sk, far]);
  ok(r[0], 'a nearby zombie is alerted to the attacker');
  ok(!r[1], 'a zombified piglin is NOT alerted (setGroupRevenge(ZombifiedPiglinEntity.class) EXCLUDES it, RevengeGoal.java:72-110)');
  ok(!r[2], 'a skeleton is not alerted');
  ok(!r[3], 'a zombie beyond follow range is not alerted');
  const r2 = run('husk', [mk('zombie', 2), mk('husk', 3), mk('zombified_piglin', 4)]);
  ok(!r2[0] && r2[1] && !r2[2], 'a husk alerts husks but not plain zombies or piglins (getClass() is Husk)');
  // anti-vacuity: the pre-#1239 goal (no pack getter) alerts nobody
  { const hit = mk('zombie', 0), o = mk('zombie', 4);
    const g = new Ai.HurtByTargetGoal(hit); hit.lastHurtByEntity = attacker; g.start();
    okAv(o.target === null, 'anti-vacuity: HurtByTargetGoal built with no pack (the old zombie roster) alerts nobody'); }
}

console.log('');
console.log('================ goalcheck ==================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
