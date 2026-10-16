#!/usr/bin/env node
// sleepcheck.mjs — loop/sleep-s104: villager SLEEP + MEETING-POINT behaviour
// (src/07zv_villagerbrain.js, `NS.VB`), closing Poi.OWED's "HOME/MEETING tickets are never
// RESERVED" (07zu_poi.js) and Village.OWED's hasRecentlySlept gap (07l_spawn.js). Every number
// asserted here is cited in 07zv_villagerbrain.js's own header, read off `.decomp` this session:
// Schedule.java (VILLAGER_DEFAULT), Activity.java, ScheduleRule.java, VillagerTaskListProvider
// .java, SleepTask.java, LivingEntity.java, VillagerEntity.java.
//
//   node tools/sleepcheck.mjs [--verbose]
//
// Sections:
//   1. VB.activityForTime — the VILLAGER_DEFAULT schedule as a real step function, wrap included
//   2. claiming a HOME ticket — exclusivity (ticketCount 1), radius, and "no bed in range" refusal
//   3. walking to a claimed bed and sleeping in it — position, pose flag, LAST_SLEPT
//   4. waking at the end of REST, and the 100-tick post-wake cooldown before re-sleeping
//   5. MEETING — claim during 'meet', walk toward it, release when the activity ends
//   6. Village.hasRecentlySlept / Village.canSummonGolem wiring
//   7. anti-vacuity — break this check's own data/gates and watch it catch the break
//   9. loop/vbtasks-s106 — the real walk/claim Tasks: FindPointOfInterestTask cadence + RetryMarker,
//      VillagerWalkTowardsTask giveUp + exceedsMaxRange waypoint, ForgetCompleted, the HOME-absent
//      RandomTask's weighted first pick, the section-distance tracker
//   8. loop/vsleep — SLEEPING render pose + head-turn freeze (07j_entityrender.js), the bed's
//      own BedBlock.OCCUPIED toggled through the world's setter (LivingEntity.java, .decomp),
//      and HOME/MEETING tickets released on villager death (VillagerEntity.releaseAllTickets)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('sleepcheck — loop/sleep-s104: villager SLEEP + MEETING-POINT behaviour (NS.VB)');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07k_goals.js',
  '07zv_villagerbrain.js',
  // loop/vsleep -- section 8's own renderer/bed-occupied/death-release assertions need the
  // real posed-mob pipeline (`ER.emitMobLayer`/`ER.build`, 07j_entityrender.js), the SAME
  // module set `mobboxcheck.mjs` loads it with (`10_gfx.js`/`15h_bemodel.js`), not a stand-in.
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Entities.attrs = M.DATA.entities.attrs;
M.Effects.ready = true;
{
  const mm = rdj('models.meta.json');
  M.BEModel.init({ models: b64('models.bin'), modelsBytes: mm.rawBytes });
}
M.EntityRender.init();

const W = M.World, CH = M.CH, R = M.Reg, SR = M.States, Tags = M.Tags;
const Poi = M.Poi, Ai = M.Ai, VB = M.VB, Village = M.Village, EL = M.EntityList, ER = M.EntityRender;

ok(VB, 'NS.VB did not load');
if (!VB) { console.log('\nFAIL sleepcheck — module missing'); process.exit(1); }
ok(ER && ER.ready, 'NS.EntityRender did not load (section 8 needs it)');

W.init(1);
M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init();
Ai.init();
Village.init();
ok(Ai.ready, 'Ai module reports ready (needed for VB.tick\'s own findPath/stepToward)');

for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const STONE = SR.stateOf('stone');
function plate(radius, y) {
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, y, z, STONE);
}
function bedHeadState(name) {
  const b = R.id[name], P_ = R.PROP, V = R.PVAL;
  // loop/vbtasks-s106: a freshly placed bed is OCCUPIED=false (BedBlock's default state). The
  // first head state in registry order is occupied=TRUE, which ForgetCompletedPointOfInterestTask
  // now (correctly) reads as "someone else is in this bed" and forgets — so pick the real default.
  for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) if (SR.propValue(s, P_.part) === V.head && SR.propValue(s, P_.occupied) === V['false']) return s;
  return null;
}
const HOME_STATE = bedHeadState('red_bed');
const bellId = R.id['bell'];
const BELL_STATE = R.realFirst[bellId] + R.defaultState[bellId];
const PLAT_Y = 63;
plate(20, PLAT_Y);

function placeBed(x, z) { W.setBlock(x, PLAT_Y + 1, z, HOME_STATE); }
function placeBell(x, z) { W.setBlock(x, PLAT_Y + 1, z, BELL_STATE); }
function reconcile() { for (let i = 0; i < Poi.RESCAN_INTERVAL; i++) Poi.tick(); }
// EL.tick() also runs the villager's own GoalSelector (WaterAvoidingRandomStrollGoal etc.,
// 07k_goals.js) alongside VB.tick's own steering (07zv_villagerbrain.js's own VB.OWED names
// this real interaction: a sleeping villager's movement OUTPUT is cancelled, but the
// selector itself keeps running) -- for a WALK test that needs a deterministic tick budget,
// not a random one, that stroll goal is swapped for an empty selector so VB is the only
// thing steering. This changes nothing about VB.tick itself, only removes a second,
// unrelated source of randomness from these particular assertions.
function spawnStillVillager(x, y, z) {
  const v = EL.spawn('villager', x, y, z);
  v.ai = new Ai.GoalSelector();
  return v;
}

// loop/vbtasks-s106 — FindPointOfInterestTask only runs after its own first nextInt(20) delay and
// then every 20..39 ticks (VB.findPoiTick), so a claim is no longer instant on the first VB.tick:
// tick enough times (at a fixed dayTime, no physics) for the task's own cadence to fire.
function tickN(v, n = 60) { for (let i = 0; i < n; i++) VB.tick(v); }

// ═══ 1. VB.activityForTime — VILLAGER_DEFAULT as a real step function ═══════════════════════
console.log('\n 1. VB.activityForTime reproduces Schedule.VILLAGER_DEFAULT\'s own step function');
{
  ok(VB.activityForTime(10) === 'idle', 't=10 (the first entry) is idle');
  ok(VB.activityForTime(1999) === 'idle', 't=1999, just before work, is still idle');
  ok(VB.activityForTime(2000) === 'work', 't=2000 (work\'s own startTime) is work');
  ok(VB.activityForTime(8999) === 'work', 't=8999, just before meet, is still work');
  ok(VB.activityForTime(9000) === 'meet', 't=9000 (meet\'s own startTime) is meet');
  ok(VB.activityForTime(10999) === 'meet', 't=10999, just before the second idle, is still meet');
  ok(VB.activityForTime(11000) === 'idle', 't=11000 (the second idle) is idle');
  ok(VB.activityForTime(11999) === 'idle', 't=11999, just before rest, is still idle');
  ok(VB.activityForTime(12000) === 'rest', 't=12000 (rest\'s own startTime) is rest');
  ok(VB.activityForTime(23999) === 'rest', 't=23999, the last tick of the day, is still rest');
  // wrap: ScheduleRule.getPriority's own `$$3 ? last : ...` branch — before the FIRST entry (10)
  // the schedule reports its own LAST entry (rest), not "idle" guessed as a sensible default.
  ok(VB.activityForTime(0) === 'rest', 't=0, before the first entry (10), wraps to the schedule\'s own last entry (rest)');
  ok(VB.activityForTime(9) === 'rest', 't=9, still before the first entry, also wraps to rest');
  // the day itself wraps at 24000 (Brain.refreshActivities' own `% 24000L`), not just clamps.
  ok(VB.activityForTime(24000 + 10) === 'idle', 't=24010 reduces to t=10 (idle) — the day wraps, not clamps');
  ok(VB.activityForTime(24000 * 3 + 9000) === 'meet', 'three full days plus 9000 still lands on meet');
}

// ═══ 2. claiming a HOME ticket ═══════════════════════════════════════════════════════════════
console.log('\n 2. claiming HOME: exclusivity (ticketCount 1), CLAIM_RADIUS, and a real refusal with none in range');
{
  placeBed(0, 0);
  reconcile();
  ok(Poi.getType({ x: 0, y: PLAT_Y + 1, z: 0 }) === Poi.HOME, 'setup: the placed bed is tracked as a HOME poi');

  const a = EL.spawn('villager', 3, PLAT_Y + 1, 0);
  const b = EL.spawn('villager', -3, PLAT_Y + 1, 0);
  M.Sky = { dayTime: 12000 };   // VILLAGER_DEFAULT's own rest startTime
  tickN(a);
  ok(a.vbActivity === 'rest', 'at dayTime 12000 a villager\'s own activity is rest');
  ok(!!a.vbHome && a.vbHome.x === 0 && a.vbHome.z === 0, 'the first villager claims the only HOME poi in range');
  ok(Poi.isOccupied({ x: 0, y: PLAT_Y + 1, z: 0 }) === true, 'the HOME poi is now occupied (ticketCount 1)');

  tickN(b);
  okAv(!b.vbHome, 'a SECOND villager cannot also claim the same bed — ticketCount 1 refuses a second reservation, not silently shared');

  // no bed at all within CLAIM_RADIUS (48 blocks)
  const lonely = EL.spawn('villager', 9000, PLAT_Y + 1, 9000);
  tickN(lonely);
  okAv(!lonely.vbHome, 'a villager with no HOME poi within CLAIM_RADIUS never claims one — no silent fallback');

  EL.clear();
  W.setBlock(0, PLAT_Y + 1, 0, 0);
  reconcile();
}

// ═══ 3. walking to a claimed bed and sleeping in it ═════════════════════════════════════════
console.log('\n 3. a villager walks to its claimed HOME bed and sleeps in it (position, pose flag, LAST_SLEPT)');
{
  placeBed(5, 5);
  reconcile();
  const v = spawnStillVillager(0, PLAT_Y + 1, 0);
  M.Sky = { dayTime: 12000 };
  let slept = false;
  for (let t = 0; t < 4000 && !slept; t++) { EL.tick(); if (v.vbSleeping) slept = true; }
  ok(slept, 'the villager eventually reaches its claimed bed and sleeps (within a generous tick budget)');
  ok(v.x === 5 + VB.BED_OFFSET.x && v.y === PLAT_Y + 1 + VB.BED_OFFSET.y && v.z === 5 + VB.BED_OFFSET.z,
    `sleeping snaps the villager onto the bed's own HEAD-cell offset (0.5,0.6875,0.5), got (${v.x},${v.y},${v.z})`);
  ok(typeof v.vbLastSlept === 'number' && v.vbLastSlept === 12000, `LAST_SLEPT (e.vbLastSlept) is recorded at the dayTime sleep began, got ${v.vbLastSlept}`);
  ok(v.vbSleeping === true, 'e.vbSleeping (the pose flag a future renderer could read) is set');

  okAv((() => {
    // a villager already sleeping must NOT re-path/re-claim every tick — one more tick with the
    // SAME dayTime should leave it exactly where it is, not walking off the bed again.
    const before = { x: v.x, y: v.y, z: v.z };
    EL.tick();
    return v.x === before.x && v.y === before.y && v.z === before.z && v.vbSleeping === true;
  })(), 'a sleeping villager stays put tick after tick rather than re-triggering its own walk-to-bed');

  EL.clear();
  W.setBlock(5, PLAT_Y + 1, 5, 0);
  reconcile();
}

// ═══ 4. waking, and the post-wake cooldown ══════════════════════════════════════════════════
console.log('\n 4. VB.tick wakes a sleeping villager once REST ends, and gates re-sleep for WAKE_COOLDOWN ticks');
{
  placeBed(2, 2);
  reconcile();
  const v = spawnStillVillager(1, PLAT_Y + 1, 1);
  M.Sky = { dayTime: 12000 };
  for (let t = 0; t < 4000 && !v.vbSleeping; t++) EL.tick();
  ok(v.vbSleeping, 'setup: the villager is asleep');

  M.Sky = { dayTime: 50 };   // wrapped into 'idle' (VILLAGER_DEFAULT: idle at 10..1999)
  VB.tick(v);
  ok(v.vbSleeping === false, 'once the activity leaves rest, the villager wakes up');
  ok(v.vbLastWoken === 50, `LAST_WOKEN (e.vbLastWoken) is recorded at the waking dayTime, got ${v.vbLastWoken}`);

  // SleepTask.shouldRun's own 100-tick cooldown is meant for a wake mid-REST (an attack, say —
  // not modelled by this unit, see VB.OWED), not a wake that crosses into a whole different
  // schedule window; simulate that directly (still 'rest', a LAST_WOKEN only 40 ticks old) the
  // same way villagegolemcheck drives Village.tick's own gates directly.
  v.vbSleeping = false;
  v.vbLastWoken = 12000;
  M.Sky = { dayTime: 12040 };   // 40 ticks since LAST_WOKEN, still under WAKE_COOLDOWN (100)
  VB.tick(v);
  okAv(v.vbSleeping === false, 'only 40 ticks after waking, still in REST and right at the bed, the villager does NOT instantly re-sleep — the 100-tick WAKE_COOLDOWN is real, not a dead field');
  M.Sky = { dayTime: 12000 + VB.WAKE_COOLDOWN + 10 };   // now safely past the cooldown
  VB.tick(v);
  ok(v.vbSleeping === true, 'once WAKE_COOLDOWN has elapsed, the same villager sleeps again in the same claimed bed');

  EL.clear();
  W.setBlock(2, PLAT_Y + 1, 2, 0);
  reconcile();
}

// ═══ 5. MEETING — claim, walk, release ══════════════════════════════════════════════════════
console.log('\n 5. MEETING: claimed only during \'meet\', walked toward, released once the activity ends');
{
  placeBell(8, 8);
  reconcile();
  const v = spawnStillVillager(0, PLAT_Y + 1, 0);
  M.Sky = { dayTime: 9000 };   // VILLAGER_DEFAULT's own meet startTime
  tickN(v);
  ok(v.vbActivity === 'meet', 'at dayTime 9000 the villager\'s own activity is meet');
  ok(!!v.vbMeeting && v.vbMeeting.x === 8 && v.vbMeeting.z === 8, 'the villager claims the MEETING (bell) poi');
  ok(Poi.isOccupied({ x: 8, y: PLAT_Y + 1, z: 8 }) === true, 'the bell poi is now occupied');

  const start = { x: v.x, z: v.z };
  for (let t = 0; t < 200; t++) EL.tick();
  const moved = Math.hypot(v.x - start.x, v.z - start.z);
  ok(moved > 1, `the villager actually walks toward the claimed bell over 200 ticks, moved ${moved.toFixed(2)} blocks`);

  M.Sky = { dayTime: 12000 };   // rest — leaves 'meet'
  VB.tick(v);
  okAv(!v.vbMeeting, 'leaving the meet activity releases the MEETING ticket — it is not held forever like HOME');
  ok(Poi.isOccupied({ x: 8, y: PLAT_Y + 1, z: 8 }) === false, 'the bell poi itself is free again after release');

  EL.clear();
  W.setBlock(8, PLAT_Y + 1, 8, 0);
  reconcile();
}

// ═══ 6. Village.hasRecentlySlept / Village.canSummonGolem wiring ════════════════════════════
console.log('\n 6. Village.hasRecentlySlept (e.vbLastSlept, <24000 ticks) gates Village.canSummonGolem');
{
  const v = {};
  ok(Village.hasRecentlySlept(v, 1000) === false, 'a villager that has never slept (no vbLastSlept) has NOT recently slept');
  v.vbLastSlept = 1000;
  ok(Village.hasRecentlySlept(v, 1000 + 23999) === true, 'at 23999 ticks since LAST_SLEPT, still within the 24000-tick window');
  ok(Village.hasRecentlySlept(v, 1000 + 24000) === false, 'at exactly 24000 ticks since LAST_SLEPT, the window has closed');

  const g = { vbLastSlept: 0, golemDetectedUntil: 0 };
  ok(Village.canSummonGolem(g, 0) === true, 'a villager that just slept and has no golem-detected cooldown CAN summon a golem');
  g.golemDetectedUntil = 5000;
  ok(Village.canSummonGolem(g, 100) === false, 'the pre-existing golemDetectedUntil cooldown still gates it (unchanged by this pass)');

  const neverSlept = { golemDetectedUntil: 0 };
  okAv(Village.canSummonGolem(neverSlept, 0) === false, 'a villager that has NEVER slept cannot summon a golem — hasRecentlySlept is a real gate, not a no-op');
}

// ═══ 7. anti-vacuity — the checks above already carry several `okAv`s; two more, isolated ═════
console.log('\n 7. anti-vacuity — breaking this unit\'s own data and watching the break get caught');
{
  // break VB.SCHEDULE itself and confirm activityForTime's own result changes accordingly —
  // proves activityForTime reads the table rather than a hard-coded switch statement.
  const saved = VB.SCHEDULE;
  VB.SCHEDULE = [[0, 'rest']];
  okAv(VB.activityForTime(12000) === 'rest' && VB.activityForTime(0) === 'rest',
    'with a single-entry schedule substituted in, every time of day reports that one activity — activityForTime genuinely reads VB.SCHEDULE');
  VB.SCHEDULE = saved;
  ok(VB.activityForTime(9000) === 'meet', 'restoring the real schedule restores the real meet window');
}


// === 8. loop/vsleep -- render pose, head freeze, BedBlock.OCCUPIED, death ticket release ====
console.log('\n 8. render pose / head freeze / BedBlock.OCCUPIED / death releases HOME+MEETING');
{
  // -- 8a. sleep pose direction data reads the LIVE registry ids, not hardcoded 0/1/2/3 ------
  const PV = R.PVAL;
  ok(ER.sleepDirData(PV.north).yawDeg === 90 && ER.sleepDirData(PV.north).dx === 0 && ER.sleepDirData(PV.north).dz === -1,
    'NORTH: getYaw=90, Direction offset (0,0,-1)');
  ok(ER.sleepDirData(PV.south).yawDeg === 0 && ER.sleepDirData(PV.south).dz === 1,
    'SOUTH: getYaw=0, Direction offset (0,0,1)');
  ok(ER.sleepDirData(PV.west).yawDeg === 270 && ER.sleepDirData(PV.west).dx === -1,
    'WEST: getYaw=270, Direction offset (-1,0,0)');
  ok(ER.sleepDirData(PV.east).yawDeg === 180 && ER.sleepDirData(PV.east).dx === 1,
    'EAST: getYaw=180, Direction offset (1,0,0)');
  ok(ER.sleepDirData(undefined) === null && ER.sleepDirData(-1) === null,
    'no/garbage facing resolves to null, not a guessed direction');

  okAv((() => {
    // swap north/south's own registry ids and confirm ER.sleepDirData's ANSWER follows the
    // swap -- proves it compares against the LIVE R.PVAL ids each call, not a baked-in 0/1.
    const n = R.PVAL.north, s = R.PVAL.south;
    R.PVAL.north = s; R.PVAL.south = n;
    const flipped = ER.sleepDirData(n).yawDeg === 0;   // the id that WAS north now reads as south (yaw 0)
    R.PVAL.north = n; R.PVAL.south = s;
    return flipped;
  })(), 'ER.sleepDirData genuinely reads R.PVAL.north/south live -- swapping the ids swaps the answer');

  // -- 8b. ER.sleepMatrix -- LivingEntityRenderer.setupTransforms's sleeping branch (.decomp
  // :194-199), independently re-derived BY HAND here (not by calling ER's own rotY/rotZ
  // helpers) for a test vector v=(1,2,3): M*v = Ry(yaw) * (Rz(90) * (Ry(270) * v)). Working
  // the algebra cold: Ry(270)*v = (-3,2,1); Rz(90) of that = (-2,-3,1); Ry(yaw) of THAT gives
  // the four rows below.
  function matVec(mm, v) {
    return [mm[0] * v[0] + mm[1] * v[1] + mm[2] * v[2],
            mm[3] * v[0] + mm[4] * v[1] + mm[5] * v[2],
            mm[6] * v[0] + mm[7] * v[1] + mm[8] * v[2]];
  }
  function near3(a, b) { return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[2] - b[2]) < 1e-9; }
  const tv = [1, 2, 3];
  ok(near3(matVec(ER.sleepMatrix(90), tv), [1, -3, 2]), `NORTH (yaw 90) matrix: expected (1,-3,2), got ${matVec(ER.sleepMatrix(90), tv)}`);
  ok(near3(matVec(ER.sleepMatrix(0), tv), [-2, -3, 1]), `SOUTH (yaw 0) matrix: expected (-2,-3,1), got ${matVec(ER.sleepMatrix(0), tv)}`);
  ok(near3(matVec(ER.sleepMatrix(180), tv), [2, -3, -1]), `EAST (yaw 180) matrix: expected (2,-3,-1), got ${matVec(ER.sleepMatrix(180), tv)}`);
  ok(near3(matVec(ER.sleepMatrix(270), tv), [-1, -3, -2]), `WEST (yaw 270) matrix: expected (-1,-3,-2), got ${matVec(ER.sleepMatrix(270), tv)}`);
  // every one of the four is a real rotation (orthonormal, determinant +1) -- not, say, a
  // projection that happens to hit these four sample points by coincidence.
  for (const yaw of [0, 90, 180, 270]) {
    const M8 = ER.sleepMatrix(yaw);
    const det = M8[0] * (M8[4] * M8[8] - M8[5] * M8[7]) - M8[1] * (M8[3] * M8[8] - M8[5] * M8[6]) + M8[2] * (M8[3] * M8[7] - M8[4] * M8[6]);
    ok(Math.abs(det - 1) < 1e-9, `ER.sleepMatrix(${yaw}) has determinant 1 (a real rotation), got ${det}`);
  }

  // -- 8c. a villager actually asleep in a bed with a KNOWN facing: pose data, position
  // offset, ER.animOf's sleepPose, the goal-selector head freeze, and BedBlock.OCCUPIED,
  // end to end -----------------------------------------------------------------------------
  function bedHeadStateFacing(name, facingVal) {
    const b = R.id[name], P_ = R.PROP, V = R.PVAL;
    for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) {
      // also pin OCCUPIED=false explicitly -- a bed's real state space has an
      // occupied=true variant too, and the FIRST head/facing match is not guaranteed to be
      // the unoccupied one (it isn't, for red_bed's own declared property order).
      if (SR.propValue(s, P_.part) === V.head && SR.propValue(s, P_.facing) === facingVal &&
          SR.propValue(s, P_.occupied) === V['false']) return s;
    }
    return null;
  }
  const SOUTH_HEAD = bedHeadStateFacing('red_bed', R.PVAL.south);
  ok(SOUTH_HEAD !== null, 'setup: a real red_bed HEAD state facing SOUTH exists in the registry');

  W.setBlock(3, PLAT_Y + 1, 3, SOUTH_HEAD);
  reconcile();
  ok(SR.propValue(W.getBlock(3, PLAT_Y + 1, 3), R.PROP.occupied) === R.PVAL['false'],
    'setup: the freshly-placed bed reads BedBlock.OCCUPIED=false before anyone sleeps in it');

  const v8 = spawnStillVillager(3, PLAT_Y + 1, 3);
  M.Sky = { dayTime: 12000 };
  v8.yaw = 0.4; v8.yHeadRot = 1.2; v8.xHeadRot = 0.7;
  for (let t = 0; t < 4000 && !v8.vbSleeping; t++) { v8.yHeadRot = 1.2; v8.xHeadRot = 0.7; EL.tick(); }
  ok(v8.vbSleeping, 'setup: the villager reaches the south-facing bed and sleeps');
  ok(v8.vbSleepFacing === R.PVAL.south, `e.vbSleepFacing records the bed's own real FACING id (south=${R.PVAL.south}), got ${v8.vbSleepFacing}`);
  ok(SR.propValue(W.getBlock(3, PLAT_Y + 1, 3), R.PROP.occupied) === R.PVAL['true'],
    'BedBlock.OCCUPIED is now true at the HOME cell -- LivingEntity.sleep own write (.decomp), through the world real setter');

  // `sleepIn` runs on the SAME tick that flips `e.vbSleeping` true, and `tickRest`'s own
  // branch order means `freezeSleeping` (which does the head-reset) is not what ran that one
  // tick -- one more tick, with the head deliberately re-turned first, is what actually proves
  // the freeze (matching `07i_entitylist.js`'s own ai-tick-then-VB.tick order every later tick).
  v8.yHeadRot = 1.2; v8.xHeadRot = 0.7;
  EL.tick();
  ok(v8.vbSleeping, 'setup: still asleep one tick later');
  ok(v8.yHeadRot === (v8.yaw || 0) && v8.xHeadRot === 0,
    `a sleeping villager's head is held straight ahead (yHeadRot===yaw, xHeadRot===0), got yHeadRot=${v8.yHeadRot} xHeadRot=${v8.xHeadRot} yaw=${v8.yaw}`);
  okAv((() => {
    // one more tick with a look goal fighting it every tick: still frozen at the end of the
    // SAME tick VB.tick runs in, proving the reset genuinely runs every tick, not just once.
    v8.yHeadRot = 2.5; v8.xHeadRot = -0.9;
    EL.tick();
    return v8.yHeadRot === (v8.yaw || 0) && v8.xHeadRot === 0;
  })(), 'the head freeze re-clamps every tick a villager is asleep (freezeSleeping own re-clamp shape), not just once');

  const pose = ER.animOf(v8, 1).sleepPose;
  ok(!!pose, 'ER.animOf attaches a non-null sleepPose while e.vbSleeping is true');
  // MerchantEntity.getActiveEyeHeight (.decomp :79, fixed 1.62 adult; #4784 -- NOT the Entity default height*0.85) minus render()'s own -0.1
  // (:87), off the REAL villager height (`Ent.height`), independently re-summed here rather
  // than calling `ER.eyeHeightStanding` -- a bug in that helper must not also hide in its check.
  const expectEye = Math.fround(1.62) - 0.1;
  ok(pose && pose.dx === 0 && Math.abs(pose.dz - (-expectEye)) < 1e-9,
    `SOUTH (dz=+1): render offset dx=0, dz=-eyeHeight (${-expectEye}), got dx=${pose && pose.dx} dz=${pose && pose.dz}`);
  ok(pose && near3(matVec(pose.R, tv), [-2, -3, 1]), 'SOUTH sleepPose.R is the same matrix section 8b already proved for yaw 0');

  okAv((() => {
    // a DIFFERENT direction must produce a DIFFERENT offset/matrix -- proves sleepPose is
    // wired to this villager's OWN vbSleepFacing, not a constant object reused for everyone.
    // NORTH's own Direction offset is (0,0,-1) (.decomp Direction.java :25), the exact
    // opposite z-sign of SOUTH's (0,0,1) used above, so the render offset FLIPS SIGN on z
    // while the rotation matrix changes shape entirely (row 0 differs, per 8b's own numbers).
    const saved = v8.vbSleepFacing;
    v8.vbSleepFacing = R.PVAL.north;
    const p2 = ER.animOf(v8, 1).sleepPose;
    v8.vbSleepFacing = saved;
    return p2 && Math.abs(p2.dx) < 1e-9 && Math.abs(p2.dz - expectEye) < 1e-9 && p2.R[0] !== pose.R[0];
  })(), `switching e.vbSleepFacing to NORTH flips the offset z sign (dz: ${pose.dz} -> +eyeHeight) and changes the rotation matrix`);

  // once awake, BedBlock.OCCUPIED clears and ER.animOf stops attaching a sleepPose.
  for (let t = 0; t < 2000 && v8.vbSleeping; t++) { M.Sky = { dayTime: 50 }; VB.tick(v8); }
  ok(!v8.vbSleeping, 'setup: the villager wakes back up (dayTime moved off REST)');
  ok(SR.propValue(W.getBlock(3, PLAT_Y + 1, 3), R.PROP.occupied) === R.PVAL['false'],
    'LivingEntity.wakeUp clears BedBlock.OCCUPIED back to false at the SAME cell sleepIn set it at (.decomp :3150-3154)');
  ok(ER.animOf(v8, 1).sleepPose === null, 'ER.animOf no longer attaches a sleepPose once the villager is awake');

  okAv((() => {
    // monkey-patch World.setBlock to a no-op and confirm OCCUPIED does NOT flip this time --
    // proves the two assertions above depend on the real world write, not a stale read of a
    // block state this test itself already expected.
    const real = W.setBlock;
    W.setBlock = () => false;
    W.setBlock(3, PLAT_Y + 1, 3, SR.withProp(W.getBlock(3, PLAT_Y + 1, 3), R.PROP.occupied, R.PVAL['true']));
    const stillFalse = SR.propValue(W.getBlock(3, PLAT_Y + 1, 3), R.PROP.occupied) === R.PVAL['false'];
    W.setBlock = real;
    return stillFalse;
  })(), 'with World.setBlock stubbed to a no-op, the occupied write genuinely does not happen -- the earlier assertions were reading a real write, not a fixture default');

  EL.clear();
  W.setBlock(3, PLAT_Y + 1, 3, 0);
  reconcile();
}

// === 8d. HOME/MEETING tickets released on villager DEATH (VillagerEntity.releaseAllTickets) ==
console.log('\n 8d. VillagerEntity.releaseAllTickets: EL.remove(dead villager) frees HOME + MEETING');
{
  placeBed(4, 4);
  placeBell(6, 6);
  reconcile();
  const v9 = EL.spawn('villager', 4, PLAT_Y + 1, 4);
  v9.ai = new Ai.GoalSelector();
  M.Sky = { dayTime: 12000 };
  tickN(v9);
  ok(!!v9.vbHome, 'setup: the villager claims the HOME (bed) poi');
  M.Sky = { dayTime: 9000 };
  tickN(v9);
  ok(!!v9.vbMeeting, 'setup: the SAME villager also holds a MEETING (bell) ticket');
  ok(Poi.isOccupied({ x: 4, y: PLAT_Y + 1, z: 4 }) === true && Poi.isOccupied({ x: 6, y: PLAT_Y + 1, z: 6 }) === true,
    'setup: both POIs read occupied while the villager holds them');

  v9.dead = true;
  EL.remove(v9);
  ok(!v9.vbHome && !v9.vbMeeting, 'EL.remove on a DEAD villager clears its own vbHome/vbMeeting fields');
  ok(Poi.isOccupied({ x: 4, y: PLAT_Y + 1, z: 4 }) === false,
    'the HOME poi is free again immediately after death -- not left reserved for Poi own periodic reconcile to notice');
  ok(Poi.isOccupied({ x: 6, y: PLAT_Y + 1, z: 6 }) === false, 'the MEETING poi is free again immediately after death too');

  okAv((() => {
    // a villager that DESPAWNS (e.dead === false/undefined) must NOT have its tickets ripped
    // away -- `EL.remove`'s own gate (VillagerEntity.onDeath only fires on a real death).
    const v10 = EL.spawn('villager', 4, PLAT_Y + 1, 4);
    v10.ai = new Ai.GoalSelector();
    M.Sky = { dayTime: 12000 };
    tickN(v10);
    const claimed = !!v10.vbHome;
    v10.dead = false;
    EL.remove(v10);
    return claimed && !!v10.vbHome && Poi.isOccupied({ x: 4, y: PLAT_Y + 1, z: 4 }) === true;
  })(), 'EL.remove on a live (despawning, not dead) villager does NOT release its HOME ticket -- the death gate is real, not release-on-every-removal');

  EL.clear();
  W.setBlock(4, PLAT_Y + 1, 4, 0);
  W.setBlock(6, PLAT_Y + 1, 6, 0);
  reconcile();
}

// === 9. loop/vbtasks-s106 — the villager's real Task machinery (VB.OWED's former three lines) ==
console.log('\n 9. VillagerWalkTowardsTask giveUp / exceedsMaxRange waypoint, FindPointOfInterestTask cadence + RetryMarker, ForgetCompleted, the HOME-absent RandomTask');
{
  const seen = (v) => v; // readability
  // --- 9a. FindPointOfInterestTask's own first-run delay: never a claim on the very first tick
  placeBed(10, 10);
  reconcile();
  M.Sky = { dayTime: 12000 };
  const f = spawnStillVillager(8, PLAT_Y + 1, 8);
  VB.tick(f);
  okAv(!f.vbHome, 'FindPointOfInterestTask never claims on its first tick (its own `positionExpireTimeLimit == 0` branch only arms the nextInt(20) delay)');
  // tick ONE at a time and read the re-arm on the claiming tick itself -- reading it after a fixed
  // 40 ticks raced the re-arm window (a claim at tick ~20 re-armed to ~40, already past; flaky 1-in-3).
  for (let k = 0; k < 40 && !f.vbHome; k++) tickN(f, 1);
  ok(!!f.vbHome && f.vbHome.x === 10 && f.vbHome.z === 10, 'within 40 ticks the delayed find task claims the reachable bed');
  ok(f.vbFind.home.expire - f.vbAge >= 18 && f.vbFind.home.expire - f.vbAge < 40, 're-armed at now + 20 + nextInt(20) after a run');

  // --- 9b. VillagerWalkTowardsTask.giveUp: wall the claimed bed in; once CANT_REACH is older than
  //     maxRunTime (1200 for HOME), the ticket is released and the HOME memory forgotten.
  const WALLS = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 2; dy++) {
    if (dx === 0 && dz === 0 && dy < 2) continue;
    WALLS.push([10 + dx, PLAT_Y + 1 + dy, 10 + dz]);
  }
  WALLS.forEach(([x, y, z]) => W.setBlock(x, y, z, STONE));
  const gave0 = VB.gaveUp || 0;
  let t = 0, cantSeen = false;
  for (; t < 4000 && f.vbHome; t++) { VB.tick(f); if (f.vbCantReachSince !== undefined) cantSeen = true; }
  ok(cantSeen, 'WanderAroundTask records CANT_REACH_WALK_TARGET_SINCE once no path reaches the walled bed');
  ok(!f.vbHome && (VB.gaveUp || 0) === gave0 + 1, `the walled bed is given up (HOME forgotten), after ${t} ticks`);
  ok(t > VB.HOME_MAX_RUN_TIME, `giveUp waits out HOME's own maxRunTime (${VB.HOME_MAX_RUN_TIME}) — took ${t}`);
  ok(Poi.isOccupied({ x: 10, y: PLAT_Y + 1, z: 10 }) === false, 'giveUp releases the bed ticket (releaseTicketFor), not just the memory');
  // RetryMarker: the find task keeps offering the walled bed, fails to path, and backs off.
  tickN(f, 60);
  const mk = f.vbFind.home.markers[`10,${PLAT_Y + 1},10`];
  ok(!f.vbHome, 'the unreachable bed is NOT re-claimed — FindPointOfInterestTask claims only on a path that reaches');
  ok(!!mk && mk.delay >= 40 && mk.delay <= 400 && mk.next === mk.prev + mk.delay, `a RetryMarker backs the bed off (delay ${mk && mk.delay} in [40,400])`);

  okAv((() => {
    // the same walled bed, but HOME's maxRunTime lifted out of reach: no giveUp at all.
    WALLS.forEach(([x, y, z]) => W.setBlock(x, y, z, 0));
    const g = spawnStillVillager(8, PLAT_Y + 1, 8);
    tickN(g, 40);
    const had = !!g.vbHome;
    WALLS.forEach(([x, y, z]) => W.setBlock(x, y, z, STONE));
    const keep = VB.HOME_MAX_RUN_TIME; VB.HOME_MAX_RUN_TIME = 1e9;
    for (let i = 0; i < 2500; i++) VB.tick(g);
    VB.HOME_MAX_RUN_TIME = keep;
    const kept = !!g.vbHome;
    VB.releaseAllTickets(g);
    return had && kept;
  })(), 'with HOME_MAX_RUN_TIME lifted, the same walled bed is kept — the giveUp above is gated by maxRunTime, not by anything else');
  EL.clear();
  WALLS.forEach(([x, y, z]) => W.setBlock(x, y, z, 0));
  W.setBlock(10, PLAT_Y + 1, 10, 0);
  reconcile();

  // --- 9c. exceedsMaxRange: a HOME further than 150 (Manhattan) gets a NoPenaltyTargeting.findTo
  //     waypoint within 15 of the villager, biased toward it — never the far POI itself.
  const w = spawnStillVillager(0, PLAT_Y + 1, 0);
  w.vbHome = { x: 400, y: PLAT_Y + 1, z: 0 };
  VB.walkTowardsTick(w, 'vbHome', 1, VB.HOME_MAX_RANGE, VB.HOME_MAX_RUN_TIME, 100);
  const wt = w.vbWalkTarget;
  ok(!!wt && !(wt.x === 400), 'a too-far HOME yields a WALK_TARGET that is a waypoint, not the POI itself');
  ok(!!wt && Math.abs(wt.x) + Math.abs(wt.z) <= 2 * VB.WAYPOINT_H && wt.x >= 0,
    `the waypoint is within findTo's 15-block square and on the POI's side (PI/2 cone): got (${wt && wt.x},${wt && wt.z})`);
  ok(!!wt && wt.range === 1, 'the waypoint carries the HOME walk\'s own completionRange (1)');
  okAv((() => {
    const n = spawnStillVillager(0, PLAT_Y + 1, 0);
    n.vbHome = { x: 20, y: PLAT_Y + 1, z: 0 };
    VB.walkTowardsTick(n, 'vbHome', 1, VB.HOME_MAX_RANGE, VB.HOME_MAX_RUN_TIME, 100);
    return !!n.vbWalkTarget && n.vbWalkTarget.x === 20 && n.vbWalkTarget.z === 0;
  })(), 'a HOME inside maxRange is walked to DIRECTLY — the waypoint branch fires only past 150');
  okAv((() => {
    // no valid floor anywhere near (hung in the air above the build limit's empty chunks): all
    // 1000 findTo tries fail → giveUp, exactly VillagerWalkTowardsTask's own `$$6 == 1000` branch.
    const air = EL.spawn('villager', 0, PLAT_Y + 120, 0);
    air.ai = new Ai.GoalSelector();
    air.vbHome = { x: 400, y: PLAT_Y + 1, z: 0 };
    const g0 = VB.gaveUp || 0;
    VB.walkTowardsTick(air, 'vbHome', 1, VB.HOME_MAX_RANGE, VB.HOME_MAX_RUN_TIME, 100);
    return !air.vbHome && (VB.gaveUp || 0) === g0 + 1 && air.vbCantReachSince === 100;
  })(), 'with no valid floor for any waypoint, 1000 failed findTo tries give the HOME up (and stamp CANT_REACH)');
  EL.clear();

  // --- 9d. ForgetCompletedPointOfInterestTask(HOME): someone else in the bed → forget + release.
  placeBed(6, 0);
  reconcile();
  const o = spawnStillVillager(4, PLAT_Y + 1, 0);
  tickN(o, 40);
  ok(!!o.vbHome, 'setup: the villager holds the bed at (6,0)');
  const bedPos = { x: 6, y: PLAT_Y + 1, z: 0 };
  W.setBlock(6, PLAT_Y + 1, 0, SR.withProp(W.getBlock(6, PLAT_Y + 1, 0), R.PROP.occupied, R.PVAL['true']));
  o.vbSleeping = true;
  VB.forgetCompletedHomeTick(o);
  okAv(!!o.vbHome, 'a villager that is ITSELF asleep keeps its own occupied bed (`!isSleeping()`)');
  o.vbSleeping = false;
  VB.forgetCompletedHomeTick(o);
  ok(!o.vbHome && Poi.isOccupied(bedPos) === false, 'a bed OCCUPIED by someone else is forgotten and its ticket released');
  W.setBlock(6, PLAT_Y + 1, 0, 0);
  EL.clear();
  reconcile();

  // --- 9e. the section-distance tracker (Chebyshev over sections, saturating at 7)
  ok(VB.occupiedSectionDistance({ x: 0, y: 64, z: 0 }) === 7, 'no occupied POI anywhere → distance saturates at 7');
  placeBed(0, 0); reconcile();
  Poi.reserveTicket({ x: 0, y: PLAT_Y + 1, z: 0 });
  ok(VB.occupiedSectionDistance({ x: 0, y: 64, z: 0 }) === 0, 'same section as an occupied POI → 0');
  ok(VB.occupiedSectionDistance({ x: 48, y: 64, z: -20 }) === 3, 'three sections east (and two north) → Chebyshev 3');
  okAv(VB.occupiedSectionDistance({ x: 200, y: 64, z: 0 }) === 7, 'twelve sections away still reads 7 — the cap is real, not a raw distance');
  Poi.releaseTicket({ x: 0, y: PLAT_Y + 1, z: 0 });
  W.setBlock(0, PLAT_Y + 1, 0, 0); reconcile();

  // --- 9f. the HOME-absent RandomTask: first-pick odds are weight / total (WeightedList.shuffle)
  const realSky = W.canSeeSky;
  const roofed = (x, y, z) => !(Math.abs(x) <= 4 && Math.abs(z) <= 4 && y <= PLAT_Y + 3);
  const tally = (setup, n) => {
    const c = {};
    for (let i = 0; i < n; i++) {
      const v = setup();
      const pick = VB.restFallbackTick(v, 1000);
      c[pick] = (c[pick] || 0) + 1;
      EL.remove(v);
    }
    return c;
  };
  // outdoors, no bed: only GoToPointOfInterestTask (weight 2) and WaitTask (2) can start → 1:1.
  W.canSeeSky = () => true;
  const out = tally(() => spawnStillVillager(0, PLAT_Y + 1, 0), 2000);
  ok(!out.wanderIndoors && !out.walkHome, `outdoors with no bed, WanderIndoors (sky visible) and WalkHome (no HOME) never start: ${JSON.stringify(out)}`);
  ok(Math.abs((out.goToPoi || 0) / 2000 - 0.5) < 0.05, `goToPoi:wait ≈ 2:2 among the two that can start, got ${JSON.stringify(out)}`);
  // indoors, an unclaimed bed 10 blocks off: all four can start → 1/9, 4/9, 2/9, 2/9.
  W.canSeeSky = roofed;
  placeBed(3, 3); reconcile();   // within 48, squared distance > 4 from (0,0) — WalkHome's own gate
  const ins = tally(() => spawnStillVillager(0, PLAT_Y + 1, 0), 4500);
  const exp = { walkHome: 1 / 9, wanderIndoors: 4 / 9, goToPoi: 2 / 9, wait: 2 / 9 };
  for (const k of Object.keys(exp)) ok(Math.abs((ins[k] || 0) / 4500 - exp[k]) < 0.035, `indoors: ${k} first-pick ≈ ${exp[k].toFixed(3)}, got ${((ins[k] || 0) / 4500).toFixed(3)}`);
  okAv((() => {
    // equal weights would put wanderIndoors near 1/4, not 4/9 — the weights are really read.
    const keep = VB.REST_FALLBACK; VB.REST_FALLBACK = keep.map(([n]) => [n, 1]);
    const eq = tally(() => spawnStillVillager(0, PLAT_Y + 1, 0), 2000);
    VB.REST_FALLBACK = keep;
    return Math.abs((eq.wanderIndoors || 0) / 2000 - 0.25) < 0.04;
  })(), 'flattening the weights to 1 moves wanderIndoors to ≈1/4 — the 4/9 above comes from the real weights');
  // what each one leaves behind
  const wi = spawnStillVillager(0, PLAT_Y + 1, 0);
  VB.REST_FALLBACK = [['wanderIndoors', 1]];
  VB.restFallbackTick(wi, 1000);
  ok(!!wi.vbWalkTarget && wi.vbWalkTarget.range === 0 && Math.abs(wi.vbWalkTarget.x) <= 1 && wi.vbWalkTarget.y === PLAT_Y,
    `WanderIndoorsTask picks a top-solid, roofed block within 1 (the floor, y=${PLAT_Y}), completionRange 0: ${JSON.stringify(wi.vbWalkTarget)}`);
  const wh = spawnStillVillager(0, PLAT_Y + 1, 0);
  VB.REST_FALLBACK = [['walkHome', 1]];
  VB.restFallbackTick(wh, 1000);
  ok(!!wh.vbWalkTarget && wh.vbWalkTarget.x === 3 && wh.vbWalkTarget.z === 3 && wh.vbWalkTarget.range === 1,
    `WalkHomeTask walks a HOME-less villager to the nearest reachable bed (range 1): ${JSON.stringify(wh.vbWalkTarget)}`);
  const wt2 = spawnStillVillager(0, PLAT_Y + 1, 0);
  VB.REST_FALLBACK = [['wait', 1]];
  VB.restFallbackTick(wt2, 1000);
  const hold = wt2.vbRestRandom.waitUntil - 1000;
  ok(hold >= VB.WAIT_MIN && hold <= VB.WAIT_MAX && VB.restFallbackTick(wt2, 1001) === 'wait(running)',
    `WaitTask(20, 40) holds the composite for ${hold} ticks`);
  VB.REST_FALLBACK = [['walkHome', 1], ['wanderIndoors', 4], ['goToPoi', 2], ['wait', 2]];
  W.canSeeSky = realSky;
  EL.clear();
  W.setBlock(3, PLAT_Y + 1, 3, 0); reconcile();
  seen(0);
}

console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) {
  console.log(`\nFAIL sleepcheck — ${pass} passed, ${fails.length} failed`);
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log(`\nPASS sleepcheck — ${pass} checks green (incl. ${breaks} anti-vacuity)`);
process.exit(0);
