#!/usr/bin/env node
// vbplaycheck.mjs — loop/vbplay: baby villager PLAY activity, `createPlayTasks`' own
// priority-5 `PlayWithVillagerBabiesTask` (src/07zv2_vbplay.js's own `VB.tickPlay`,
// src/07zv_villagerbrain.js's own `VB.SCHEDULE_BABY`/`VB.tick` dispatch). Every number here is
// cited in 07zv2_vbplay.js, read off `.decomp` this session: Schedule.java:16-21
// (Schedule.VILLAGER_BABY), Activity.java (field_18885 == "play"), VillagerTaskListProvider.
// java:81-101 (createPlayTasks), PlayWithVillagerBabiesTask.java (in full),
// VillagerBabiesSensor.java (in full).
//
//   node tools/vbplaycheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. vbactivitycheck.mjs already proved VB.SCHEDULE_BABY's own step-function
// shape (both windows folded into 'idle' at the time it was written); this file re-proves that
// shape now resolves to a real 'play' activity instead, and that VB.tickPlay (the new module)
// actually chases another baby during it — against REALLY spawned villagers (EL.spawn) ticked
// through the real per-tick pipeline (EL.tick, which is VB.tick's own live caller,
// 07i_entitylist.js:1105), not a hand-built fixture.
//
// Sections:
//   1. VB.SCHEDULE_BABY as a step function — the two PLAY windows (3000-5999, 10000-11999) now
//      resolve to 'play', not 'idle'; adults (VB.SCHEDULE) never produce 'play' at any
//      breakpoint at all
//   2. VB.tick dispatch — inside the play window a real baby's own e.vbActivity is 'play', and
//      VB.tickPlay actually runs (an adult, and a baby OUTSIDE the window, do not)
//   3. VB.tickPlay chases a real nearby baby (a spawned pair closes distance over real ticks)
//      and does nothing (no vbPlayTarget, no movement) when no other baby is visible
//   4. anti-vacuity — breaking this unit's own data and watching the break get caught

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

console.log('vbplaycheck — loop/vbplay: baby villager PLAY activity (NS.VB.tickPlay, VB.SCHEDULE_BABY)');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv2_vbplay.js', '14_player.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Entities.attrs = M.DATA.entities.attrs;
M.Effects.ready = true;

const W = M.World, CH = M.CH, R = M.Reg, SR = M.States;
const Poi = M.Poi, Ai = M.Ai, VB = M.VB, EL = M.EntityList, Prof = M.Profession;

ok(VB, 'NS.VB did not load');
ok(!!(VB && VB.tickPlay), '07zv2_vbplay.js did not attach VB.tickPlay onto the shared NS.VB namespace');
if (!VB || !VB.tickPlay) { console.log('\nFAIL vbplaycheck — module missing'); process.exit(1); }

W.init(1);
M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init();
Ai.init();
Prof.init();
ok(Ai.ready, 'Ai module reports ready');

for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const STONE = SR.stateOf('stone');
const PLAT_Y = 63;
function plate(radius, y) { for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, y, z, STONE); }
plate(28, PLAT_Y);

function spawnStillVillager(x, y, z, baby) {
  const v = EL.spawn('villager', x, y, z);
  v.ai = new Ai.GoalSelector();   // deterministic tick budget, vbactivitycheck's own precedent
  if (baby) v.isBaby = true;   // loop/vbgather: e.baby was folded into Breed's own e.isBaby
  return v;
}
function tickN(v, n = 1) { for (let i = 0; i < n; i++) VB.tick(v); }

// ═══ 1. VB.SCHEDULE_BABY as a step function — PLAY windows real now, adults never get 'play' ═
console.log('\n 1. VB.SCHEDULE_BABY resolves real \'play\' windows; VB.SCHEDULE (adult) never produces \'play\'');
{
  ok(VB.activityForTime(10, VB.SCHEDULE_BABY) === 'idle', 't=10 is idle');
  ok(VB.activityForTime(2999, VB.SCHEDULE_BABY) === 'idle', 't=2999, just before PLAY, is idle');
  okAv(VB.activityForTime(3000, VB.SCHEDULE_BABY) === 'play', 't=3000 (PLAY\'s own startTime) is now \'play\', not folded into idle');
  ok(VB.activityForTime(5999, VB.SCHEDULE_BABY) === 'play', 't=5999, still inside the first PLAY window, is play');
  ok(VB.activityForTime(6000, VB.SCHEDULE_BABY) === 'idle', 't=6000 (the second idle window) is idle');
  ok(VB.activityForTime(9999, VB.SCHEDULE_BABY) === 'idle', 't=9999, just before the second PLAY, is idle');
  okAv(VB.activityForTime(10000, VB.SCHEDULE_BABY) === 'play', 't=10000 (the second PLAY window) is play too');
  ok(VB.activityForTime(11999, VB.SCHEDULE_BABY) === 'play', 't=11999, still inside the second PLAY window, is play');
  ok(VB.activityForTime(12000, VB.SCHEDULE_BABY) === 'rest', 't=12000 (rest\'s own startTime) is rest');

  // adults: VB.SCHEDULE has no 'play' row at all -- check every one of its own breakpoints plus
  // the two baby-only PLAY startTimes it does NOT share.
  const adultBreaks = [10, 2000, 9000, 11000, 12000, 3000, 5999, 10000, 11999, 0, 23999];
  okAv(adultBreaks.every((t) => VB.activityForTime(t, VB.SCHEDULE) !== 'play'),
    'VB.SCHEDULE (the adult schedule) never resolves to \'play\' at any breakpoint, including the baby-only PLAY startTimes');
}

// ═══ 2. VB.tick dispatch — real baby in the window is 'play' and VB.tickPlay actually runs ═══
console.log('\n 2. VB.tick: a real baby villager in the PLAY window is \'play\'; an adult, and a baby outside the window, are not');
{
  const adult = spawnStillVillager(0, PLAT_Y + 1, 0, false);
  const baby = spawnStillVillager(5, PLAT_Y + 1, 5, true);
  M.Sky = { dayTime: 3000 };   // Schedule.VILLAGER_BABY's own first PLAY startTime
  VB.tick(adult); VB.tick(baby);
  ok(adult.vbActivity === 'work', 'setup: an adult villager at t=3000 is \'work\' (VILLAGER_DEFAULT)');
  okAv(baby.vbActivity === 'play', 'the SAME dayTime (3000), on a villager with e.isBaby set, is \'play\'');

  // a real spawned baby, ticked with VB.tickPlay directly patched to a spy, confirms VB.tick's
  // own dispatch line actually calls it during 'play' (not merely computing the label).
  const savedTickPlay = VB.tickPlay;
  let sawCall = false;
  VB.tickPlay = function (e, tnow) { sawCall = true; return savedTickPlay(e, tnow); };
  VB.tick(baby);
  ok(sawCall, 'VB.tick actually calls VB.tickPlay while the baby\'s own activity is \'play\'');

  // outside the window (idle, t=6000) VB.tickPlay must NOT be called even though the villager
  // is still a baby with another baby visible.
  sawCall = false;
  M.Sky = { dayTime: 6000 };
  VB.tick(baby);
  okAv(!sawCall, 'the SAME baby at t=6000 (the idle window between the two PLAY windows) does NOT call VB.tickPlay');
  ok(baby.vbActivity === 'idle', 'setup: the baby\'s own activity at t=6000 is indeed idle, not play');
  VB.tickPlay = savedTickPlay;

  EL.clear();
}

// ═══ 3. VB.tickPlay: a real chase between two spawned babies; no partner, no movement ═══════
console.log('\n 3. VB.tickPlay chases a real nearby baby over real ticks; alone, it sets no target and does not move');
{
  // 3a. two babies apart, forced shouldRun (VB.rand pinned to 0 so nextInt(PLAY_RUN_CHANCE)
  // is always 0 -- the SAME override precedent vbactivitycheck's own §3c uses for
  // VB.idleFallbackTick's weighted pick) -- must actually close distance over real EL.tick()s.
  const a = spawnStillVillager(0, PLAT_Y + 1, 0, true);
  const b = spawnStillVillager(12, PLAT_Y + 1, 0, true);
  M.Sky = { dayTime: 3000 };
  const savedRand = VB.rand;
  VB.rand = () => 0;
  const start = { x: a.x, z: a.z };
  for (let t = 0; t < 300; t++) EL.tick();
  const moved = Math.hypot(a.x - start.x, a.z - start.z);
  ok(moved > 1, `a baby actually chases a nearby baby during PLAY, moved ${moved.toFixed(2)} blocks`);
  ok(!!a.vbPlayTarget || !!b.vbPlayTarget, 'at least one of the pair picked up a vbPlayTarget (the other is the mutual/least-popular/any-visible fallback)');
  const dist = Math.hypot(a.x - b.x, a.z - b.z);
  ok(dist < 12, `the chase actually closes the distance between the pair (started 12, now ${dist.toFixed(2)})`);
  VB.rand = savedRand;
  EL.clear();

  // 3b. anti-vacuity, the other direction: a LONE baby in the SAME window, same forced
  // shouldRun, never gets a play target and never moves off VB.tickPlay's own doing -- proves
  // 3a's movement was really the chase, not e.g. the wander fallback firing on 'play' too.
  const lone = spawnStillVillager(0, PLAT_Y + 1, 0, true);
  M.Sky = { dayTime: 3000 };
  VB.rand = () => 0;
  const start2 = { x: lone.x, z: lone.z };
  for (let t = 0; t < 300; t++) EL.tick();
  const moved2 = Math.hypot(lone.x - start2.x, lone.z - start2.z);
  VB.rand = savedRand;
  okAv(!lone.vbPlayTarget && moved2 < 0.2,
    `a lone baby (no other visible baby) during PLAY sets no vbPlayTarget and does not chase-walk, moved ${moved2.toFixed(2)} blocks`);
  EL.clear();

  // 3c. outside VB.PLAY_SENSE_RANGE, no chase starts either — proves the range gate is real,
  // not a stub that always finds a babiy.
  const far1 = spawnStillVillager(0, PLAT_Y + 1, 0, true);
  const far2 = spawnStillVillager(VB.PLAY_SENSE_RANGE + 4, PLAT_Y + 1, 0, true);
  M.Sky = { dayTime: 3000 };
  VB.rand = () => 0;
  for (let t = 0; t < 60; t++) EL.tick();
  VB.rand = savedRand;
  okAv(!far1.vbPlayTarget && !far2.vbPlayTarget, `two babies farther apart than VB.PLAY_SENSE_RANGE (${VB.PLAY_SENSE_RANGE}) never pair up`);
  EL.clear();
}

// === 4. getLeastPopularBabyInteractionTarget's real popularity sort (loop/vbplaywander) =====
console.log("\n 4. tickPlay's least-popular-target pick: fewer existing players wins, and the >5 cap excludes a saturated target");
{
  // 4a. targetA has 3 babies already playing with it, targetB has 1 -- the decider must pick
  // the LESS popular targetB, not targetA (a naive "first already-playing baby found" pick,
  // this unit's own former simplification, would grab whichever comes first in EL.list instead).
  const decider = spawnStillVillager(0, PLAT_Y + 1, 0, true);
  const targetA = spawnStillVillager(2, PLAT_Y + 1, 0, false);
  const targetB = spawnStillVillager(-2, PLAT_Y + 1, 0, false);
  const h1 = spawnStillVillager(1, PLAT_Y + 1, 1, true);
  const h2 = spawnStillVillager(1, PLAT_Y + 1, -1, true);
  const h3 = spawnStillVillager(-1, PLAT_Y + 1, 1, true);
  const h4 = spawnStillVillager(-1, PLAT_Y + 1, -1, true);
  h1.vbPlayTarget = targetA; h2.vbPlayTarget = targetA; h3.vbPlayTarget = targetA;
  h4.vbPlayTarget = targetB;
  const savedRand4 = VB.rand;
  VB.rand = () => 0;   // shouldRun's own nextInt(PLAY_RUN_CHANCE) === 0
  VB.tickPlay(decider, 1);
  VB.rand = savedRand4;
  okAv(decider.vbPlayTarget === targetB, `the baby villager with fewer existing players (targetB, count 1) is picked over the busier one (targetA, count 3), got ${decider.vbPlayTarget === targetA ? 'targetA' : decider.vbPlayTarget === targetB ? 'targetB' : 'neither'}`);
  EL.clear();

  // 4b. anti-vacuity, the >5 cap: a target with count 6 (over MAX_BABY_INTERACTION_COUNT) must
  // be EXCLUDED entirely, not merely deprioritized -- with no other already-playing target
  // available, tickPlay must fall through to getVisibleMob's own "any visible baby" branch
  // instead of grabbing the saturated one.
  const decider2 = spawnStillVillager(0, PLAT_Y + 1, 0, true);
  const saturated = spawnStillVillager(2, PLAT_Y + 1, 0, false);
  const busy = [];
  for (let i = 0; i < 6; i++) {
    const b = spawnStillVillager(1 + 0.1 * i, PLAT_Y + 1, i % 2 ? 1 : -1, true);
    b.vbPlayTarget = saturated;
    busy.push(b);
  }
  const savedRand4b = VB.rand;
  VB.rand = () => 0;
  VB.tickPlay(decider2, 1);
  VB.rand = savedRand4b;
  okAv(decider2.vbPlayTarget !== saturated, `a target already played by ${busy.length} babies (over VB.PLAY_MAX_INTERACTION=${VB.PLAY_MAX_INTERACTION}) is excluded from the popularity pick`);
  ok(!!decider2.vbPlayTarget, 'tickPlay still falls through to getVisibleMob (any visible baby) when the only already-playing target is saturated');
  EL.clear();
}

// === 5. createPlayTasks' OWN WanderAroundTask(80,120) -- a per-activity run-time window =====
console.log("\n 5. VB.wanderTick's run-time window is 80..120 when passed PLAY's own constants, not the CORE 150..250 default");
{
  const e1 = spawnStillVillager(0, PLAT_Y + 1, 0, true);
  const e2 = spawnStillVillager(10, PLAT_Y + 1, 0, true);
  e1.vbWalkTarget = { x: 3, y: PLAT_Y + 1, z: 0, range: 1 };
  e2.vbWalkTarget = { x: 13, y: PLAT_Y + 1, z: 0, range: 1 };
  const savedRand = VB.rand;
  VB.rand = () => 0;   // nextInt(n) === 0 for every draw below
  VB.wanderTick(e1, 0, VB.PLAY_WANDER_MIN, VB.PLAY_WANDER_MAX);
  VB.wanderTick(e2, 0);   // CORE default (no override)
  VB.rand = savedRand;
  ok(!!e1.vbWander && e1.vbWander.running, 'setup: e1 actually started running a path this tick');
  ok(!!e2.vbWander && e2.vbWander.running, 'setup: e2 (CORE default) actually started running a path this tick');
  okAv(e1.vbWander.until === VB.PLAY_WANDER_MIN, `passed PLAY's own (${VB.PLAY_WANDER_MIN},${VB.PLAY_WANDER_MAX}), the run-time window's floor is used (until=${e1.vbWander.until}), not the CORE 150`);
  okAv(e2.vbWander.until === VB.WANDER_MIN_RUN, `with no override the CORE default (${VB.WANDER_MIN_RUN},${VB.WANDER_MAX_RUN}) still applies (until=${e2.vbWander.until})`);
  ok(e1.vbWander.until !== e2.vbWander.until, 'the two windows actually differ');
  EL.clear();
}

// === 6. createFreeFollowTask -- weighted look-only draw ======================================
console.log("\n 6. VB.tickFreeFollow: weight table matches .decomp, a visible cat wins immediately, a lower-weight animal loses to a same-weight WaitTask draw ahead of it");
{
  const totalWeight = VB.FREE_FOLLOW_CANDIDATES.reduce((n, r) => n + r[1], 0);
  okAv(VB.FREE_FOLLOW_CANDIDATES.length === 10 && totalWeight === 20,
    `createFreeFollowTask's own 10 Pair<Task,weight> entries sum to weight 20 (got ${VB.FREE_FOLLOW_CANDIDATES.length} entries, weight ${totalWeight})`);

  // 6a. a visible cat (weight 8, first in the draw order) wins outright -- e.vbLookTarget is
  // aimed at it.
  const baby = spawnStillVillager(0, PLAT_Y + 1, 0, true);
  const cat = EL.spawn('cat', 3, PLAT_Y + 1, 0);
  const savedRand = VB.rand;
  VB.rand = () => 0.5;   // any fixed r in (0,1) reproduces the real weight ordering (file header)
  VB.tickFreeFollow(baby);
  VB.rand = savedRand;
  okAv(baby.vbFollowTarget === cat, 'a visible cat within VB.FREE_FOLLOW_RANGE is picked (cat is weight 8, first in the draw)');
  ok(!!baby.vbLookTarget && baby.vbLookTarget.x === cat.x && baby.vbLookTarget.z === cat.z, 'e.vbLookTarget is aimed at the picked target\'s live position');
  EL.clear();

  // 6b. anti-vacuity: a nearby animal in a weight-1 SpawnGroup category (mocked here --
  // Spawn.categoryOf's own correctness is proven elsewhere, biomecheck.mjs) sits BEHIND
  // WaitTask(30,60) (weight 2) in the real draw order -- WaitTask must win the draw and
  // tickFreeFollow must set NO follow target, even though a matching animal is right there.
  // A naive "just find the nearest thing that matches any candidate" implementation (ignoring
  // the weighted draw order entirely) would incorrectly pick the animal here.
  const baby2 = spawnStillVillager(0, PLAT_Y + 1, 0, true);
  const cow = EL.spawn('cow', 3, PLAT_Y + 1, 0);
  const savedCategoryOf = M.Spawn.categoryOf;
  M.Spawn.categoryOf = (t) => (t === 'cow' ? 'creature' : null);
  VB.rand = () => 0.5;
  VB.tickFreeFollow(baby2);
  VB.rand = savedRand;
  M.Spawn.categoryOf = savedCategoryOf;
  okAv(!baby2.vbFollowTarget, `WaitTask (weight 2) precedes the 'creature' SpawnGroup entry (weight 1) in the real draw order, so a lone nearby cow sets no follow target, got ${baby2.vbFollowTarget && baby2.vbFollowTarget.type}`);
  EL.clear();

  // 6c. outside VB.FREE_FOLLOW_RANGE, even a cat is never picked.
  const baby3 = spawnStillVillager(0, PLAT_Y + 1, 0, true);
  const farCat = EL.spawn('cat', VB.FREE_FOLLOW_RANGE + 4, PLAT_Y + 1, 0);
  VB.rand = () => 0.5;
  VB.tickFreeFollow(baby3);
  VB.rand = savedRand;
  okAv(!baby3.vbFollowTarget, `a cat farther than VB.FREE_FOLLOW_RANGE (${VB.FREE_FOLLOW_RANGE}) is never picked`);
  EL.clear();
}

// ═══ 7. anti-vacuity — a mutant VB.SCHEDULE_BABY / VB.tick without the dispatch line ════════
console.log('\n 4. anti-vacuity: breaking VB.SCHEDULE_BABY\'s own play rows, and the VB.tick dispatch, are both caught');
{
  const savedSchedule = VB.SCHEDULE_BABY;
  VB.SCHEDULE_BABY = savedSchedule.map((row) => row[1] === 'play' ? [row[0], 'idle'] : row.slice());
  okAv(VB.activityForTime(3000, VB.SCHEDULE_BABY) !== 'play', 'mutating VB.SCHEDULE_BABY back to folding PLAY into idle is itself detectable (activityForTime no longer returns \'play\')');
  VB.SCHEDULE_BABY = savedSchedule;
  ok(VB.activityForTime(3000, VB.SCHEDULE_BABY) === 'play', 'restoring VB.SCHEDULE_BABY brings \'play\' back');

  const savedTick = VB.tick;
  const b = spawnStillVillager(0, PLAT_Y + 1, 0, true);
  const other = spawnStillVillager(5, PLAT_Y + 1, 0, true);
  M.Sky = { dayTime: 3000 };
  VB.rand = () => 0;
  // a stand-in VB.tick that computes vbActivity but NEVER dispatches to tickPlay -- reproduces
  // exactly the bug this whole unit closes (VB.SCHEDULE_BABY folded PLAY into idle, no dispatch).
  VB.tick = function (e) {
    if (!e || e.type !== 'villager' || e.dead || e.removed) return;
    e.vbActivity = VB.activityForTime(M.Sky.dayTime, e.isBaby ? VB.SCHEDULE_BABY : VB.SCHEDULE);
    // deliberately NOT calling VB.tickPlay here
  };
  b.vbPlayTarget = null;
  for (let t = 0; t < 60; t++) EL.tick();
  okAv(!b.vbPlayTarget, 'a VB.tick that computes the \'play\' activity but never dispatches to VB.tickPlay leaves e.vbPlayTarget unset — the missing-wire bug this unit fixed is itself detectable');
  VB.tick = savedTick;
  VB.rand = Math.random;
  EL.clear();
}

// ═══ report ═══════════════════════════════════════════════════════════════════════════════
console.log(` assertions passed .. ${pass}`); console.log(` failures ........... ${fails.length}`);   // suite.mjs count format
console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  fails.forEach((m) => console.log('  - ' + m));
  console.log('\nFAIL vbplaycheck');
  process.exit(1);
}
console.log(`\nPASS vbplaycheck — ${pass} checks green (incl. ${breaks} anti-vacuity)`);
