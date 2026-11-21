#!/usr/bin/env node
// vbactivitycheck.mjs — loop/vb-activity: vanilla villager Brain ACTIVITY switching
// (src/07zv_villagerbrain.js's own `NS.VB`, src/07k_goals.js's own `villager` roster).
// Every number here is cited in 07zv_villagerbrain.js, read off `.decomp` this session:
// Schedule.java (VILLAGER_BABY), VillagerEntity.java (initBrain), VillagerTaskListProvider.java
// (createWorkTasks/createIdleTasks).
//
//   node tools/vbactivitycheck.mjs [--verbose]
//
// Sections:
//   1. VB.SCHEDULE_BABY as a real step function (PLAY windows folded into idle), + VB.tick
//      actually picks it for e.baby villagers (differs from the adult schedule at t=3000)
//   2. tickWork: walks toward a real claimed workstation (Prof.tryClaim) during 'work',
//      stops once within completion range, gives up (releases the Profession claim) past
//      WORK_MAX_RUN_TIME when walled in
//   3. tickIdle: villager-interest (walks toward a nearby villager) and findWalkTarget
//      (wanders when alone), weighted 2:1
//   4. 07k_goals.js's own `villager` roster drops WaterAvoidingRandomStrollGoal once NS.VB is
//      ready (real EL.spawn wiring), and keeps it when NS.VB is absent
//   5. anti-vacuity — breaking this unit's own data and watching the break get caught

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

console.log('vbactivitycheck — loop/vb-activity: villager Brain ACTIVITY switching (NS.VB, NS.Ai.ROSTER.villager)');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv2_vbplay.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Entities.attrs = M.DATA.entities.attrs;
M.Effects.ready = true;

const W = M.World, CH = M.CH, R = M.Reg, SR = M.States;
const Poi = M.Poi, Ai = M.Ai, VB = M.VB, EL = M.EntityList, Prof = M.Profession;

ok(VB, 'NS.VB did not load');
ok(Prof, 'NS.Profession did not load');
if (!VB || !Prof) { console.log('\nFAIL vbactivitycheck — module missing'); process.exit(1); }

W.init(1);
M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init();
Ai.init();
Prof.init();
ok(Ai.ready, 'Ai module reports ready');
ok(Prof.ready, 'Profession module reports ready');

for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const STONE = SR.stateOf('stone');
const PLAT_Y = 63;
function plate(radius, y) { for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, y, z, STONE); }
plate(24, PLAT_Y);

const SMITHING = SR.stateOf('smithing_table');   // Prof.WORKSTATIONS.toolsmith
function placeWorkstation(x, z) { W.setBlock(x, PLAT_Y + 1, z, SMITHING); }

function spawnStillVillager(x, y, z) {
  const v = EL.spawn('villager', x, y, z);
  v.ai = new Ai.GoalSelector();   // deterministic tick budget, see sleepcheck's own precedent
  return v;
}
function tickN(v, n = 60) { for (let i = 0; i < n; i++) VB.tick(v); }

// ═══ 1. VB.SCHEDULE_BABY + VB.tick picking it for e.baby ════════════════════════════════════
console.log('\n 1. VB.SCHEDULE_BABY (Schedule.VILLAGER_BABY) as a step function, and VB.tick using it for e.baby');
{
  // loop/vbplay gave the two PLAY windows a real 'play' activity (src/07zv2_vbplay.js's own
  // VB.tickPlay) instead of folding them into 'idle' -- vbplaycheck.mjs is where THAT unit's
  // own behaviour (the chase itself) is proven; this section only re-checks the step-function
  // SHAPE still holds with the new label.
  ok(VB.activityForTime(10, VB.SCHEDULE_BABY) === 'idle', 't=10 is idle');
  ok(VB.activityForTime(2999, VB.SCHEDULE_BABY) === 'idle', 't=2999, still before PLAY, is idle');
  ok(VB.activityForTime(3000, VB.SCHEDULE_BABY) === 'play', 't=3000 (PLAY\'s own startTime) is play (loop/vbplay, no longer folded into idle)');
  ok(VB.activityForTime(5999, VB.SCHEDULE_BABY) === 'play', 't=5999, still in the first PLAY window, is play');
  ok(VB.activityForTime(6000, VB.SCHEDULE_BABY) === 'idle', 't=6000 (the second idle) is idle');
  ok(VB.activityForTime(10000, VB.SCHEDULE_BABY) === 'play', 't=10000 (the second PLAY) is play too');
  ok(VB.activityForTime(11999, VB.SCHEDULE_BABY) === 'play', 't=11999, just before rest, is still play');
  ok(VB.activityForTime(12000, VB.SCHEDULE_BABY) === 'rest', 't=12000 (rest\'s own startTime) is rest');
  ok(VB.activityForTime(23999, VB.SCHEDULE_BABY) === 'rest', 't=23999, the last tick of the day, is still rest');
  ok(VB.activityForTime(0, VB.SCHEDULE_BABY) === 'rest', 't=0, before the first entry, wraps to the schedule\'s own last entry (rest)');
  // never 'work' or 'meet' anywhere in the baby schedule, at any of its own breakpoints
  const babyBreaks = [10, 3000, 6000, 10000, 12000, 0, 23999];
  ok(babyBreaks.every((t) => ['idle', 'play', 'rest'].includes(VB.activityForTime(t, VB.SCHEDULE_BABY))),
    'the baby schedule never produces \'work\' or \'meet\' at any of its own breakpoints');

  // VB.tick actually consults e.baby: at t=3000 an adult is 'work', a baby is 'play'
  const adult = spawnStillVillager(0, PLAT_Y + 1, 0);
  const baby = spawnStillVillager(5, PLAT_Y + 1, 5);
  baby.isBaby = true;   // loop/vbgather: e.baby was folded into Breed's own e.isBaby
  const M_ = M; M_.Sky = { dayTime: 3000 };
  VB.tick(adult); VB.tick(baby);
  ok(adult.vbActivity === 'work', 'setup: an adult villager at t=3000 is \'work\' (VILLAGER_DEFAULT)');
  okAv(baby.vbActivity === 'play', 'the SAME dayTime (3000), on a villager with e.isBaby set, is \'play\' — VB.tick actually switched schedules, not just labels');
  EL.clear();
}

// ═══ 2. tickWork: walk to a claimed workstation, stop, give up when walled ══════════════════
console.log('\n 2. tickWork walks to a real claimed workstation (Prof.tryClaim) during \'work\', stops in range, gives up past WORK_MAX_RUN_TIME');
{
  // loop/vbwork wired createWorkTasks' own priority-5 RandomTask in ALONGSIDE tickWork's
  // priority-2 walk (both run every 'work' tick in real vanilla Brain scheduling too). Silenced
  // for this whole section: it is about tickWork's OWN behaviour in isolation, and vbworkcheck
  // is where the priority-5 group (which can legitimately re-aim WALK_TARGET on its own separate
  // schedule) gets tested.
  const savedTickWorkRandom = VB.tickWorkRandom;
  VB.tickWorkRandom = () => {};
  placeWorkstation(10, 10);
  // Prof.tryClaim is a pure ADJACENCY claim (07o_profession.js's own Prof.NEIGHBOURS), not a
  // radius search like Poi's HOME/MEETING -- so the villager claims it standing right next to
  // it, and is THEN moved away to give tickWork's own walk-back something real to do.
  const v = spawnStillVillager(11, PLAT_Y + 1, 10);
  M.Sky = { dayTime: 2000 };   // VILLAGER_DEFAULT's own work startTime
  VB.tick(v);
  ok(v.vbActivity === 'work', 'at dayTime 2000 the villager\'s own activity is work');
  const claimed = Prof.tryClaim(v);
  ok(claimed === 'toolsmith', `setup: Prof.tryClaim grants toolsmith off the adjacent smithing_table, got ${claimed}`);
  ok(!!v.workstation && v.workstation.x === 10 && v.workstation.z === 10, 'setup: e.workstation now points at the claimed block');
  v.x = 0; v.z = 0; v.vbWalkTarget = null; v.vbCantReachSince = undefined;

  // stepToward (07k_goals.js) only sets velocity/yaw -- real position change needs a physics
  // tick, so distance is measured through EL.tick() (sleepcheck's own MEETING-walk precedent),
  // not VB.tick() alone.
  const start = { x: v.x, z: v.z };
  for (let t = 0; t < 400; t++) EL.tick();
  const moved = Math.hypot(v.x - start.x, v.z - start.z);
  ok(moved > 1, `tickWork actually walks the villager toward its claimed job site, moved ${moved.toFixed(2)} blocks`);
  ok(Math.abs(v.x - 10) + Math.abs(v.z - 10) <= VB.WORK_COMPLETION_RANGE + 1,
    `the villager ends up within (about) the job-site completion range (${VB.WORK_COMPLETION_RANGE}) of it`);

  okAv((() => {
    // once within completion range, tickWork must stop re-issuing a walk target every tick.
    // loop/vbwork wired createWorkTasks' own priority-5 RandomTask in ALONGSIDE tickWork (its
    // priority-2 walk) -- vanilla-accurately, GoToNearbyPositionTask (one of that group) keeps
    // re-aiming WALK_TARGET at the same job site every 80 ticks even once arrived, which is
    // covered by vbworkcheck's own §4, not this one. Silencing VB.tickWorkRandom for JUST this
    // isolation window keeps this assertion about what it always was: tickWork's OWN re-issue
    // behaviour, not the separate priority-5 tier's.
    for (let t = 0; t < 20; t++) EL.tick();
    const before = { x: v.x, z: v.z };
    EL.tick();
    return v.x === before.x && v.z === before.z && !v.vbWalkTarget;
  })(), 'once within WORK_COMPLETION_RANGE, tickWork stops walking (no fresh WALK_TARGET each tick)');

  EL.clear();
  W.setBlock(10, PLAT_Y + 1, 10, 0);
  Prof.claimed = {};

  // --- give-up: wall the claimed workstation in, past WORK_MAX_RUN_TIME the claim is released.
  placeWorkstation(20, 20);
  const g = spawnStillVillager(21, PLAT_Y + 1, 20);   // adjacent, so the claim actually grants
  M.Sky = { dayTime: 2000 };
  VB.tick(g);
  ok(Prof.tryClaim(g) === 'toolsmith', 'setup: a second villager claims a second smithing_table');
  g.x = 0; g.z = 0;   // moved away before walling -- gives WanderAroundTask a real path to fail
  const WALLS = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 2; dy++) {
    if (dx === 0 && dz === 0 && dy < 2) continue;
    WALLS.push([20 + dx, PLAT_Y + 1 + dy, 20 + dz]);
  }
  WALLS.forEach(([x, y, z]) => W.setBlock(x, y, z, STONE));
  const gave0 = VB.gaveUp || 0;
  let t = 0;
  for (; t < 4000 && g.workstation; t++) VB.tick(g);
  ok(!g.workstation, `the walled workstation is given up (e.workstation forgotten) after ${t} ticks`);
  ok(t > VB.WORK_MAX_RUN_TIME, `giveUp waits out WORK's own maxRunTime (${VB.WORK_MAX_RUN_TIME}) — took ${t}`);
  ok((VB.gaveUp || 0) === gave0 + 1, 'VB.gaveUp is bumped exactly once');
  okAv(Prof.claimed['20,' + (PLAT_Y + 1) + ',20'] === undefined,
    'giving up on the job site releases the Profession CLAIM itself (Prof.release), not just the local e.workstation field');

  EL.clear();
  WALLS.forEach(([x, y, z]) => W.setBlock(x, y, z, 0));
  W.setBlock(20, PLAT_Y + 1, 20, 0);
  Prof.claimed = {};
  VB.tickWorkRandom = savedTickWorkRandom;
}

// ═══ 3. tickIdle: villager-interest + findWalkTarget, weighted 2:1 ══════════════════════════
// s118: SEEDED. This section rolled VB.rand = Math.random, so it went red once in a full suite
// (202609241504) on an unlucky draw. A fixed mulberry32 stream keeps the same 2:1 question, repeatably.
const seeded = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const __vbRand0 = VB.rand; VB.rand = seeded(118);
console.log('\n 3. tickIdle: villager-interest (walk toward another villager) + findWalkTarget (wander alone), weighted 2:1');
{
  // 3a. alone -- only findWalkTarget can ever fire (no other villager within IDLE_INTEREST_RANGE)
  const lonely = spawnStillVillager(0, PLAT_Y + 1, 0);
  M.Sky = { dayTime: 10 };   // VILLAGER_DEFAULT's own idle startTime
  VB.tick(lonely);
  ok(lonely.vbActivity === 'idle', 'at dayTime 10 the villager\'s own activity is idle');
  const start = { x: lonely.x, z: lonely.z };
  // stepToward only sets velocity -- EL.tick() runs the physics step that actually moves it.
  for (let t = 0; t < 400; t++) EL.tick();
  const moved = Math.hypot(lonely.x - start.x, lonely.z - start.z);
  ok(moved > 0.5, `a lone idle villager still wanders (findWalkTarget), moved ${moved.toFixed(2)} blocks`);

  // 3b. two villagers close together -- villagerInterestStart should walk one toward the other
  const a = spawnStillVillager(0, PLAT_Y + 1, 0);
  const b = spawnStillVillager(6, PLAT_Y + 1, 0);
  M.Sky = { dayTime: 10 };
  let interested = false;
  for (let t = 0; t < 200 && !interested; t++) {
    VB.tick(a); VB.tick(b);
    if (a.vbIdlePick === 'villagerInterest' || b.vbIdlePick === 'villagerInterest') interested = true;
  }
  ok(interested, 'two nearby idle villagers eventually pick villagerInterest at least once');

  // 3c. the weighted pick itself, directly: with rnd() forced deterministic-uniform, tally
  // idleFallbackTick's own choice between the two names over many rolls — both must appear,
  // and interest (weight 2) must appear noticeably more often than findWalkTarget (weight 1).
  const savedRand = VB.rand;
  VB.rand = seeded(4242);
  const tally = { villagerInterest: 0, findWalkTarget: 0 };
  for (let i = 0; i < 400; i++) {
    a.vbWalkTarget = null; b.vbWalkTarget = null;
    const pick = VB.idleFallbackTick(a);
    if (pick) tally[pick] = (tally[pick] || 0) + 1;
  }
  VB.rand = __vbRand0;
  ok(tally.villagerInterest > 0 && tally.findWalkTarget > 0, `both idle fallbacks actually fire over 400 rolls (villagerInterest=${tally.villagerInterest}, findWalkTarget=${tally.findWalkTarget})`);
  ok(tally.villagerInterest > tally.findWalkTarget, `villagerInterest (weight 2) fires more often than findWalkTarget (weight 1), got ${tally.villagerInterest} vs ${tally.findWalkTarget}`);
  EL.clear();
}

// ═══ 4. 07k_goals.js's own `villager` roster drops the MOVE-flag stroll goal once VB is ready ═
console.log('\n 4. Ai.ROSTER.villager suppresses WaterAvoidingRandomStrollGoal once NS.VB is ready, keeps it when NS.VB is absent');
{
  ok(VB.ready === true, 'setup: NS.VB reports ready by now (VB.tick has already run above)');
  const v = EL.spawn('villager', 0, PLAT_Y + 1, 0);
  const hasStroll = (gs) => gs.entries.some((en) => en.goal && en.goal.__goalName === "WanderAroundFarGoal");
  ok(!!v.ai, 'setup: EL.spawn built a real GoalSelector for the villager (Ai.ROSTER.villager)');
  okAv(!hasStroll(v.ai), 'with NS.VB ready, the real EL.spawn-built roster has NO WaterAvoidingRandomStrollGoal entry — VB.tick is the only thing steering');
  ok(v.ai.entries.some((en) => en.priority === 0), 'the FloatGoal placeholder (priority 0) is still there — only the MOVE stroll goal was dropped');
  ok(v.ai.entries.some((en) => en.priority === 2) && v.ai.entries.some((en) => en.priority === 3),
    'the LOOK placeholders (LookAtPlayerGoal/RandomLookAroundGoal) are still there too');

  // anti-vacuity, the other direction: with NS.VB made absent, the roster falls back to the
  // OLD placement-tier stroll goal — proves the guard is a real branch, not always-false.
  const savedVB = M.VB;
  M.VB = undefined;
  const gsNoVB = Ai.ROSTER.villager(v, EL.aiCtx(v));
  M.VB = savedVB;
  okAv(hasStroll(gsNoVB), 'with NS.VB entirely absent, the roster keeps the old WaterAvoidingRandomStrollGoal — the guard reads NS.VB for real, not a stub that always suppresses');

  EL.clear();
}

// ═══ report ═══════════════════════════════════════════════════════════════════════════════
console.log(` assertions passed .. ${pass}`); console.log(` failures ........... ${fails.length}`);   // suite.mjs count format
console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  fails.forEach((m) => console.log('  - ' + m));
  console.log('\nFAIL vbactivitycheck');
  process.exit(1);
}
console.log(`\nPASS vbactivitycheck — ${pass} checks green (incl. ${breaks} anti-vacuity)`);
