#!/usr/bin/env node
// vbaudit11573check.mjs — #11573: 07zv_villagerbrain.js's classes the audit listed unchecked, driven through VB.tick / VB.* / NS.Fertilizable.
// Plants: BeetrootsBlock/PotatoesBlock (cropGrowAge), FernBlock (growPlant), FungusBlock (fungusGrow), MushroomPlantBlock (mushroomGrow), NyliumBlock (nyliumGrow).
// Brain: ScheduleRule (activityForTime), ScheduleActivityTask (VB.tick sets vbActivity), Celebrate/EndRaid/StartRaid/SeekSky/SeekSkyAfterRaidWin/RunAroundAfterRaid/RandomTask,
// RingBellTask, WorkStationCompetitionTask, VillagerWalkTowardsTask/WalkTowardJobSiteTask, ForgetCompletedPointOfInterestTask, GoToIfNearbyTask, GoToNearbyPositionTask,
// GoToSecondaryPositionTask + SecondaryPointsOfInterestSensor, MeetVillagerTask, WanderAroundTask, MemoryModuleType (vbWalkTarget/vbHome/... slots).
// Anti-vacuity: each source break must fail its row.
import fs from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07o_profession.js', '07_world.js', '07s_raid.js', '07zv_villagerbrain.js'], dom: false, ...(patch ? { patch } : {}) });
  const VB = M.VB, F = M.Fertilizable, Rd = M.Raid, RM = M.RaidManager, o = {};
  const seq = (a) => { let i = 0; return () => a[i++ % a.length]; };
  // ── plants
  o.potato = F.cropGrowAge(0, 7, () => 0) === 2 && F.cropGrowAge(6, 7, () => 0.99) === 7;
  o.beet = F.cropGrowAge(0, 3, () => 0) === 0 && F.cropGrowAge(0, 3, () => 0.99) === 1;
  const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
  const env = { name: (x, y, z) => cells.get(key(x, y, z)) || 'air', set: (x, y, z, n) => cells.set(key(x, y, z), n), canPlace: () => true, full: () => false, opaque: () => false };
  cells.set(key(0, 5, 0), 'grass');
  F.growPlant(env, 0, 5, 0, 'grass'); o.fernGrass = env.name(0, 5, 0) === 'tall_grass' && env.name(0, 6, 0) === 'tall_grass';
  cells.set(key(1, 5, 0), 'fern'); F.growPlant(env, 1, 5, 0, 'fern'); o.fernLarge = env.name(1, 5, 0) === 'large_fern';
  cells.set(key(2, 5, 0), 'grass'); cells.set(key(2, 6, 0), 'stone'); F.growPlant(env, 2, 5, 0, 'grass'); o.fernBlocked = env.name(2, 5, 0) === 'grass';
  cells.set(key(5, 4, 5), 'stone'); cells.set(key(5, 5, 5), 'crimson_fungus');
  o.fungusWrongBase = F.fungusGrow(env, 5, 5, 5, () => 0, false) === 2;
  cells.set(key(5, 4, 5), 'crimson_nylium'); o.fungusRoll = F.fungusGrow(env, 5, 5, 5, () => 0.9, false) === 0;
  const w = { name: (x, y, z) => (y === 5 ? 'red_mushroom' : 'air'), opaque: () => false, set() {}, bottom: 0, top: 255 };
  o.mushroomRoll = F.mushroomGrow(w, 0, 5, 0, () => 0.5) === 0;
  const calls = []; const nv = F.netherVegetation; F.netherVegetation = (e2, r, x, y, z, prov) => { calls.push(prov[0][0]); };
  cells.set(key(9, 5, 9), 'crimson_nylium'); F.nyliumGrow(env, () => 0.9, 9, 5, 9); o.nylCrimson = calls.length === 1 && calls[0] === 'crimson_roots';
  calls.length = 0; cells.set(key(9, 5, 9), 'warped_nylium'); F.nyliumGrow(env, () => 0.9, 9, 5, 9); o.nylWarped = calls.length === 2 && calls[0] === 'warped_roots' && calls[1] === 'nether_sprouts';
  F.netherVegetation = nv;
  // ── schedule (ScheduleRule / ScheduleActivityTask)
  o.sched = VB.activityForTime(0, VB.SCHEDULE) === 'rest' && VB.activityForTime(2000, VB.SCHEDULE) === 'work' && VB.activityForTime(9500, VB.SCHEDULE) === 'meet' && VB.activityForTime(11500, VB.SCHEDULE) === 'idle' && VB.activityForTime(24000 + 13000, VB.SCHEDULE) === 'rest';
  o.schedBaby = VB.activityForTime(4000, VB.SCHEDULE_BABY) === 'play' && VB.activityForTime(7000, VB.SCHEDULE_BABY) === 'idle';
  // ── raid tasks through VB.tick
  const sounds = [];
  M.Sound = { play: (ev) => sounds.push(ev) };
  let sky = false;
  M.World.canSeeSky = (x, y, z) => (sky ? true : y >= 66);
  M.World.heightAt = () => 60;
  M.World.getBlock = () => 0;
  M.EntityList = { list: [], all: () => [], spawn() {} };
  const raid = { status: Rd.Status.ONGOING, center: { x: 0, y: 64, z: 0 }, wavesSpawned: 1, preRaidTicks: 0 };
  RM.world = { raids: { 1: raid }, nextId: 2 };
  RM.getRaidAt = () => raid;
  const mk = () => ({ id: 1, type: 'villager', x: 0.5, y: 64, z: 0.5, profession: 'farmer' });
  VB.init();
  // StartRaidTask: nextInt(20)==0 -> RAID (waves spawned, not pre-raid) ; pre-raid if preRaidTicks>0
  VB.rand = () => 0.99; let v = mk(); o.startMiss = VB.startRaidTask(v) === null;
  VB.rand = () => 0; v = mk(); o.startRaid = VB.startRaidTask(v) === 'raid';
  raid.preRaidTicks = 100; v = mk(); o.startPre = VB.startRaidTask(v) === 'pre_raid'; raid.preRaidTicks = 0;
  // EndRaidTask: in raid, 1/20, raid LOSS -> activity reset; ongoing -> kept; not in raid -> no-op
  v = mk(); v.vbRaidActivity = 'raid'; raid.status = Rd.Status.LOSS; VB.rand = () => 0; o.endLoss = VB.endRaidTask(v) === true && v.vbRaidActivity === null;
  v = mk(); v.vbRaidActivity = 'raid'; raid.status = Rd.Status.ONGOING; o.endKeep = VB.endRaidTask(v) === false && v.vbRaidActivity === 'raid';
  v = mk(); raid.status = Rd.Status.LOSS; o.endIdle = VB.endRaidTask(v) === false;
  v = mk(); v.vbRaidActivity = 'raid'; raid.status = Rd.Status.LOSS; VB.rand = () => 0.5; o.endRoll = VB.endRaidTask(v) === false && v.vbRaidActivity === 'raid';
  // RandomTask(SeekSkyAfterRaidWinTask 5 / RunAroundAfterRaidTask 2) + SeekSkyTask
  raid.status = Rd.Status.ONGOING; v = mk(); o.wonNo = VB.raidWonRandomTick(v) === null;
  raid.status = Rd.Status.VICTORY;
  VB.fuzzyFind = () => ({ x: 3, y: 64, z: 3 });
  const seen = new Set(); let sy = null;
  for (let i = 0; i < 60; i++) { VB.rand = Math.random; const e2 = mk(); const r = VB.raidWonRandomTick(e2); seen.add(r); if (r === 'seekSky' && e2.vbWalkTarget) sy = e2; if (r === 'runAround' && e2.vbWalkTarget && e2.vbWalkTarget.speedMul === 1.1) o.runSpeed = true; }
  o.randomBoth = seen.has('seekSky') && seen.has('runAround');
  o.seekWalk = !!sy && sy.vbWalkTarget.speedMul === 1 && sy.vbWalkTarget.range === 0 && M.World.canSeeSky(Math.floor(sy.vbWalkTarget.x), sy.vbWalkTarget.y, Math.floor(sy.vbWalkTarget.z));
  sky = true; v = mk(); VB.rand = () => 0; o.seekSkyOutside = VB.seekSkyStart(v) === false; sky = false;
  // CelebrateRaidWinTask: sound at nextInt(100)==0, sky visible, VICTORY
  sky = true; sounds.length = 0; VB.rand = () => 0; v = mk(); VB.celebrateRaidWin(v); o.celebrate = sounds[0] === 'entity.villager.celebrate';
  raid.status = Rd.Status.ONGOING; sounds.length = 0; VB.celebrateRaidWin(v); o.celebrateOngoing = sounds.length === 0;
  raid.status = Rd.Status.VICTORY; sky = false; sounds.length = 0; VB.celebrateRaidWin(v); o.celebrateNoSky = sounds.length === 0;
  // real entry: VB.tick on a villager in a won raid, no sky -> raid activity set, SeekSky/RunAround walk target written
  VB.rand = Math.random; let tickAct = null, tickWalk = false;
  for (let i = 0; i < 40 && !tickWalk; i++) { const e2 = mk(); e2.vbRaidActivity = 'raid'; VB.tick(e2); tickAct = e2.vbActivity; tickWalk = !!e2.vbWalkTarget; }
  o.tickRaid = tickAct === 'raid' && tickWalk;
  VB.rand = Math.random; const e3 = mk(); M.Sky = { dayTime: 3000 }; VB.tick(e3); o.tickWork = e3.vbActivity === 'work' || e3.vbActivity === 'raid';
  RM.getRaidAt = () => null; const e4 = mk(); VB.tick(e4); o.tickWork = e4.vbActivity === 'work';
  M.Sky = { dayTime: 13000 }; const e5 = mk(); VB.tick(e5); o.tickRest = e5.vbActivity === 'rest';
  // RingBellTask
  RM.getRaidAt = () => raid; M.Sky = { dayTime: 3000 };
  const bell = M.Reg.id['bell'], bellSt = M.Reg.realFirst[bell];
  M.World.getBlock = (x, y, z) => ((x === 2 || x === 5) && y === 64 && z === 0 ? bellSt : 0);
  VB.bellRings = 0; v = mk(); v.vbMeeting = { x: 2, y: 64, z: 0 }; VB.rand = () => 0.99; o.ringYes = VB.ringBellTask(v) === true && VB.bellRings === 1;
  VB.rand = () => 0.5; o.ringRoll = VB.ringBellTask(v) === false;
  VB.rand = () => 0.99; v.vbMeeting = { x: 5, y: 64, z: 0 }; o.ringFar = VB.ringBellTask(v) === false;
  // WorkStationCompetitionTask
  const mkw = (id, xp) => ({ id, type: 'villager', profession: 'farmer', tradeXp: xp, workstation: { x: 1, y: 2, z: 3 } });
  const a = mkw(1, 0), b = mkw(2, 10); VB.workStationCompetition(a, [b]); o.compete = !a.workstation && !!b.workstation;
  // GoToIfNearbyTask / GoToNearbyPositionTask / GoToSecondaryPositionTask via tickWorkRandom
  M.World.getBlock = () => 0;
  VB.fuzzyFind = () => ({ x: 7, y: 64, z: 7 });
  v = mk(); VB.goToIfNearbyRun(v, 500); o.goIfNearby = !!v.vbWalkTarget && v.vbWalkTarget.x === 7 && v.vbGoIfNearbyNext === 500 + VB.GO_IF_NEARBY_INTERVAL;
  const wt = v.vbWalkTarget; v.vbWalkTarget = null; VB.goToIfNearbyRun(v, 501); o.goIfNearbyCool = v.vbWalkTarget === null && wt !== null;
  v = mk(); v.workstation = { x: 3, y: 64, z: 3 }; VB.goToNearbyRun(v, 100, v.workstation); o.goNearby = !!v.vbWalkTarget && v.vbWalkTarget.x === 3 && v.vbWalkTarget.range === 1;
  // SecondaryPointsOfInterestSensor + GoToSecondaryPositionTask
  const compSt = M.States.stateOf('composter') | 0;
  M.World.getBlock = (x, y, z) => (x === 2 && y === 64 && z === 1 ? compSt : 0);
  v = mk(); VB.senseSecondary(v, 1); o.secSense = !!v.vbSecondaryJobSite && v.vbSecondaryJobSite[0].x === 2 && v.vbSecondaryJobSite[0].z === 1;
  v = mk(); v.profession = 'librarian'; VB.senseSecondary(v, 1); o.secOther = v.vbSecondaryJobSite === null;
  v = mk(); VB.senseSecondary(v, 1); v.vbSecondaryJobSite = null; VB.senseSecondary(v, 2); o.secInterval = v.vbSecondaryJobSite === null;
  // VillagerWalkTowardsTask / WalkTowardJobSiteTask
  M.World.getBlock = () => 0;
  v = mk(); v.vbHome = { x: 0, y: 64, z: 6 }; VB.walkTowardsTick(v, 'vbHome', 1, 150, 1200, 10); o.walkToward = !!v.vbWalkTarget && v.vbWalkTarget.range === 1;
  v = mk(); v.vbHome = { x: 0, y: 64, z: 6 }; v.vbCantReachSince = 0; VB.walkTowardsTick(v, 'vbHome', 1, 150, 1200, 1300); o.walkGiveUp = !v.vbHome && v.vbCantReachSince === 1300;
  v = mk(); v.vbHome = { x: 0, y: 64, z: 6 }; v.vbWalkTarget = { x: 1, y: 1, z: 1 }; VB.walkTowardsTick(v, 'vbHome', 1, 150, 1200, 10); o.walkNeedsAbsent = v.vbWalkTarget.x === 1;
  // WalkTowardJobSiteTask: VB.jobAcquireTick walks to the potential job site
  M.Poi = { ready: true, JOB_SITE: 'job', HOME: 'home', getType: () => 'job' }; M.Profession.ready = true; const fp = VB.findPoiTick; VB.findPoiTick = () => {};
  v = mk(); v.profession = 'none'; v.vbPotentialJob = { x: 0, y: 64, z: 5 }; VB.jobAcquireTick(v, 'work', 10); VB.findPoiTick = fp; o.jobWalk = !!v.vbWalkTarget && v.vbWalkTarget.z === 5;
  // MeetVillagerTask (via VB.meetRandomTick) and GoToIfNearby(MEETING_POINT)
  const other = { type: 'villager', x: 2.5, y: 64, z: 0.5 }; M.EntityList.list = [other];
  v = mk(); v.vbMeeting = { x: 1, y: 64, z: 0 }; VB.rand = () => 0; const names = new Set();
  for (let i = 0; i < 30; i++) { v.vbWalkTarget = null; v.vbGoIfNearbyNext = 0; VB.rand = Math.random; const n = VB.meetRandomTick(v, 1000 + i * 200); if (n) names.add(n); }
  o.meetBoth = names.has('meetVillager') || names.has('goToIfNearby');
  const meetRoll = () => seq([0.1, 0.9, 0, 0, 0, 0, 0, 0]);
  v = mk(); v.vbMeeting = { x: 1, y: 64, z: 0 }; VB.rand = meetRoll(); const mn = VB.meetRandomTick(v, 5);
  o.meetVillager = mn === 'meetVillager' && v.vbInteractionTarget === other && v.vbWalkTarget && v.vbWalkTarget.speed === 0.3;
  M.EntityList.list = []; v = mk(); v.vbMeeting = { x: 1, y: 64, z: 0 }; VB.rand = meetRoll(); o.meetNone = VB.meetRandomTick(v, 5) !== 'meetVillager' && !v.vbInteractionTarget;
  // ForgetCompletedPointOfInterestTask: home far away is kept; home no longer a POI is forgotten
  M.Poi.getType = () => 'none'; v = mk(); v.vbHome = { x: 0, y: 64, z: 40 }; VB.forgetCompletedHomeTick(v); o.forgetFar = !!v.vbHome;
  v = mk(); v.vbHome = { x: 0, y: 64, z: 3 }; VB.forgetCompletedHomeTick(v); o.forgetNear = v.vbHome === null;
  // WanderAroundTask: a walk target with a path starts running, steps toward it and clears the target on arrival
  const stepped = [];
  M.Ai = { findPath: (x, y, z, tx, ty, tz) => [{ x, y, z }, { x: tx, y: ty, z: tz }], stepToward: (e2, p) => stepped.push(p), closeTo: () => false };
  v = mk(); v.vbWalkTarget = { x: 0, y: 64, z: 9, range: 1 }; VB.rand = () => 0; VB.wanderTick(v, 1);
  o.wanderStart = !!(v.vbWander && v.vbWander.running) && stepped.length === 1;
  VB.wanderTick(v, 2); o.wanderStep = stepped.length === 2;
  VB.wanderTick(v, 1 + VB.WANDER_MAX_RUN + 5); o.wanderEnd = v.vbWalkTarget === null && !v.vbWander.running;
  v = mk(); v.vbCantReachSince = 5; v.vbWalkTarget = { x: 0.5, y: 64, z: 0.5, range: 1 }; VB.wanderTick(v, 1); o.wanderReached = v.vbWalkTarget === null && !v.vbWander.running && v.vbCantReachSince === undefined;
  return o;
}
const LBL = {
  potato: 'PotatoesBlock/CropBlock applyGrowth +2..5 capped', beet: 'BeetrootsBlock growth / 3', fernGrass: 'FernBlock grass -> tall_grass', fernLarge: 'FernBlock fern -> large_fern', fernBlocked: 'FernBlock blocked above',
  fungusWrongBase: 'FungusBlock needs nylium base', fungusRoll: 'FungusBlock 0.4 roll', mushroomRoll: 'MushroomPlantBlock 0.4 roll', nylCrimson: 'NyliumBlock crimson vegetation', nylWarped: 'NyliumBlock warped vegetation + sprouts',
  sched: 'ScheduleRule VILLAGER_DEFAULT', schedBaby: 'ScheduleRule VILLAGER_BABY',
  startMiss: 'StartRaidTask 1/20 roll', startRaid: 'StartRaidTask -> raid', startPre: 'StartRaidTask -> pre_raid',
  endLoss: 'EndRaidTask resets on LOSS', endKeep: 'EndRaidTask keeps ongoing', endIdle: 'EndRaidTask only in raid', endRoll: 'EndRaidTask 1/20 roll',
  wonNo: 'RandomTask needs a won raid', randomBoth: 'RandomTask picks SeekSky and RunAround', seekWalk: 'SeekSkyAfterRaidWinTask/SeekSkyTask walk to sky cell', runSpeed: 'RunAroundAfterRaidTask speed 1.1', seekSkyOutside: 'SeekSkyTask only with no sky',
  celebrate: 'CelebrateRaidWinTask sound', celebrateOngoing: 'CelebrateRaidWinTask needs VICTORY', celebrateNoSky: 'CelebrateRaidWinTask needs sky',
  tickRaid: 'VB.tick raid activity + won-raid walk', tickWork: 'ScheduleActivityTask: work at 3000', tickRest: 'ScheduleActivityTask: rest at 13000',
  ringYes: 'RingBellTask rings', ringRoll: 'RingBellTask > 0.95 roll', ringFar: 'RingBellTask within 3',
  compete: 'WorkStationCompetitionTask loser forgets', goIfNearby: 'GoToIfNearbyTask walks + interval', goIfNearbyCool: 'GoToIfNearbyTask cooldown', goNearby: 'GoToNearbyPositionTask aims at site',
  secSense: 'SecondaryPointsOfInterestSensor finds composter', secOther: 'SecondaryPointsOfInterestSensor farmer only', secInterval: 'SecondaryPointsOfInterestSensor 40-tick interval',
  walkToward: 'VillagerWalkTowardsTask walks', walkGiveUp: 'VillagerWalkTowardsTask gives up', walkNeedsAbsent: 'VillagerWalkTowardsTask needs WALK_TARGET absent', jobWalk: 'WalkTowardJobSiteTask walk to potential job',
  meetBoth: 'RandomTask(meet) picks', meetVillager: 'MeetVillagerTask targets visible villager', meetNone: 'MeetVillagerTask needs a villager', forgetNear: 'ForgetCompletedPointOfInterestTask forgets a gone POI', forgetFar: 'ForgetCompletedPointOfInterestTask keeps far home',
  wanderStart: 'WanderAroundTask starts', wanderStep: 'WanderAroundTask steps', wanderEnd: 'WanderAroundTask run-time cap', wanderReached: 'WanderAroundTask reached target' };
const A = trial(null);
for (const [k, m] of Object.entries(LBL)) ok(A[k], m);
const V = 'src/07zv_villagerbrain.js';
const BR = [
  ['potato', /var g = 2 \+ Math\.floor\(rnd\(\) \* 4\);/, 'var g = 1;'],
  ['beet', /if \(maxAge === 3\) g = Math\.floor\(g \/ 3\);/, ''],
  ['fernGrass', /var to = nm === 'fern' \? 'large_fern' : 'tall_grass';/, "var to = 'large_fern';"],
  ['fernBlocked', /&& env\.name\(x, y \+ 1, z\) === 'air'\) \{\n        env\.set\(x, y, z, to/, ") {\n        env.set(x, y, z, to"],
  ['fungusWrongBase', /if \(env\.name\(x, y - 1, z\) !== base\) return 2;/, ''],
  ['fungusRoll', /if \(!\(rnd\(\) < 0\.4\)\) return 0;\n      return NS\.Fertilizable\.hugeFungus/, 'return NS.Fertilizable.hugeFungus'],
  ['mushroomRoll', /if \(!\(rnd\(\) < 0\.4\)\) return 0;\n      var self/, 'var self'],
  ['nylCrimson', /\['crimson_roots', 87\]/, "['warped_roots', 87]"],
  ['nylWarped', /\[\['nether_sprouts', 1\]\]/, "[['warped_roots', 1]]"],
  ['sched', /\[2000, 'work'\]/, "[2000, 'idle']"],
  ['schedBaby', /\[3000, 'play'\]/, "[3000, 'idle']"],
  ['startRaid', /\? 'raid' : 'pre_raid'/, "? 'pre_raid' : 'pre_raid'"],
  ['startMiss', /Math\.floor\(VB\.rand\(\) \* 20\) === 0 && RM && RM\.world/, 'RM && RM.world'],
  ['endLoss', /\{ e\.vbRaidActivity = null; return true; \}/, '{ return false; }'],
  ['endIdle', /if \(e\.vbRaidActivity !== 'pre_raid' && e\.vbRaidActivity !== 'raid'\) return false;/, ''],
  ['endKeep', /St && \(r\.status === St\.STOPPED \|\| r\.status === St\.LOSS\)/, 'true'],
  ['wonNo', /return !!r && r\.status === Rd\.Status\.VICTORY;/, 'return !!r;'],
  ['randomBoth', /\[\['seekSky', 5\], \['runAround', 2\]\]/, "[['seekSky', 5], ['runAround', 0.0001]]"],
  ['runSpeed', /e\.vbWalkTarget\.speedMul = 1\.1;/, 'e.vbWalkTarget.speedMul = 1;'],
  ['seekSkyOutside', /if \(!W \|\| !W\.canSeeSky \|\| W\.canSeeSky\(bp\.x, bp\.y, bp\.z\)\) return false;/, ''],
  ['celebrate', /Math\.floor\(VB\.rand\(\) \* 100\) === 0 && NS\.Sound/, 'false && NS.Sound'],
  ['celebrateNoSky', /\|\| !NS\.World\.canSeeSky\(bx, by, bz\)\) return false;/, ') return false;'],
  ['celebrateOngoing', /r\.status !== Rd\.Status\.VICTORY \|\| !NS/, 'false || !NS'],
  ['tickRaid', /if \(raidAct && activity !== 'panic'\) activity = raidAct;/, ''],
  ['tickRest', /e\.vbActivity = activity;/, ''],
  ['ringYes', /VB\.bellRings = \(VB\.bellRings \|\| 0\) \+ 1;/, ''],
  ['ringRoll', /!\(VB\.rand\(\) > 0\.95\)/, 'false'],
  ['ringFar', />= VB\.RING_BELL_DISTANCE \* VB\.RING_BELL_DISTANCE\) return false;/, '>= 1e9) return false;'],
  ['compete', /acc = VB\.keepJobSiteForMoreExperienced\(acc, v\);/, ''],
  ['goIfNearby', /e\.vbGoIfNearbyNext = tnow \+ VB\.GO_IF_NEARBY_INTERVAL;/, ''],
  ['goIfNearbyCool', /if \(tnow < \(e\.vbGoIfNearbyNext \|\| 0\)\) return;/, ''],
  ['goNearby', /function goToNearbyRun\(e, tnow, dest\) \{/, 'function goToNearbyRun(e, tnow, dest) { return;'],
  ['secSense', /names\.indexOf\(SR\.name\(st\)\) >= 0/, 'false'],
  ['secOther', /var names = VB\.SECONDARY_SITES\[e\.profession\]/, "var names = ['composter']"],
  ['secInterval', /e\.vbSecondarySenseNext = tnow \+ 40;/, ''],
  ['walkToward', /setWalkTarget\(e, dest, completionRange\);\n    \}\n  \};/, '}\n  };'],
  ['walkGiveUp', /now - e\.vbCantReachSince > maxRunTime\) \{ giveUp/, 'now - e.vbCantReachSince > 1e12) { giveUp'],
  ['walkNeedsAbsent', /if \(!dest \|\| e\.vbWalkTarget\) return;  \/\/ requires/, 'if (!dest) return;  // requires'],
  ['meetVillager', /e\.vbInteractionTarget = o;/, ''],
  ['meetNone', /if \(nextInt\(100\) !== 0\) return false;/, 'if (nextInt(100) !== 0) return false; return true;'],
  ['forgetFar', /if \(!\(dx \* dx \+ dy \* dy \+ dz \* dz < VB\.FORGET_RANGE \* VB\.FORGET_RANGE\)\) return;/, ''],
  ['wanderStart', /w\.running = true; w\.near = false;/, 'w.running = false; w.near = false;'],
  ['wanderEnd', /\|\| now >= w\.until\) \{/, '|| false) {'],
  ['wanderReached', /if \(reached\) e\.vbCantReachSince = undefined;/, ''],
  ['jobWalk', /VB\.walkTowardsTick\(e, 'vbPotentialJob', 1, 48, VB\.JOB_WALK_RUN_TIME, now\);/, ''],
];
const SRC = fs.readFileSync(new URL('../' + V, import.meta.url), 'utf8');
for (const [key, re, rep] of BR) {
  if (!(key in LBL)) { fails.push('unknown row ' + key); continue; }
  if (!re.test(SRC)) { fails.push('pattern not found: ' + key); continue; }
  breaks++; let hit = false, B;
  try { B = trial((f, src) => { const n = f === '07zv_villagerbrain.js' ? src.replace(re, rep) : src; if (n !== src) hit = true; return n; }); } catch (e) { B = {}; }
  ok(hit, 'break pattern matched: ' + key); ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
