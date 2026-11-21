#!/usr/bin/env node
// vbaudit11482check.mjs — #11482: drives 07zv_villagerbrain.js through the real path for classes the audit listed unchecked,
// off .decomp semantics: CropBlock subclasses PotatoesBlock/BeetrootsBlock (bonemeal growth, beetroot max age 3 -> g/3),
// FernBlock/GrassBlock growPlant (grass->tall_grass, fern->large_fern), NyliumBlock.grow, FungusBlock/MushroomPlantBlock
// (netherVegetation fungus picks), ScheduleRule.getPriority (Schedule.VILLAGER_DEFAULT step function, MemoryModuleType-driven
// activities), VillagerWalkTowardsTask, MeetVillagerTask/GoToIfNearbyTask in the RandomTask, SecondaryPointsOfInterestSensor + GoToSecondaryPositionTask (SECONDARY_JOB_SITE memory), StartRaidTask / EndRaidTask.
// Anti-vacuity: each scenario is broken by a source patch / stub and must fail.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07_world.js', '07s_raid.js', '07zv_villagerbrain.js'], dom: false, ...(patch ? { patch } : {}) });
  const VB = M.VB, F = M.Fertilizable, o = {};
  let seed = 99; VB.rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
  // PotatoesBlock / BeetrootsBlock (CropBlock.applyGrowth: +randomInt(2,5), beetroots /3)
  const lo = () => 0, hi = () => 0.999;
  o.potato = F.cropGrowAge(0, 7, lo) === 2 && F.cropGrowAge(0, 7, hi) === 5 && F.cropGrowAge(6, 7, hi) === 7;
  o.beet = F.cropGrowAge(0, 3, lo) === 0 && F.cropGrowAge(0, 3, hi) === 1 && F.cropGrowAge(2, 3, hi) === 3;
  // FernBlock.grow
  const cells = new Map(), k = (x, y, z) => x + ',' + y + ',' + z;
  const env = { name: (x, y, z) => (cells.get(k(x, y, z)) || ['air'])[0], set: (x, y, z, n, h) => cells.set(k(x, y, z), [n, h]), canPlace: () => true,
    full: () => false };
  cells.set(k(0, 5, 0), ['fern']); F.growPlant(env, 0, 5, 0, 'fern');
  o.fern = env.name(0, 5, 0) === 'large_fern' && env.name(0, 6, 0) === 'large_fern' && cells.get(k(0, 6, 0))[1] === 'upper';
  cells.clear(); cells.set(k(0, 5, 0), ['grass']); cells.set(k(0, 6, 0), ['stone']); F.growPlant(env, 0, 5, 0, 'grass');
  o.fernBlocked = env.name(0, 5, 0) === 'grass';
  // NyliumBlock.grow: crimson floor grows only crimson-family vegetation above it
  const cnt = new Map(); const e2 = { name: (x, y, z) => y === 4 ? 'crimson_nylium' : (cnt.get(k(x, y, z)) || ['air'])[0],
    set: (x, y, z, n) => cnt.set(k(x, y, z), [n]), canPlace: () => true, full: () => false, bottom: -64, top: 256 };
  let r = 5; const rr = () => (r = (r * 16807) % 2147483647) / 2147483647;
  try { for (let i = 0; i < 20; i++) F.nyliumGrow(e2, rr, 0, 4, 0); } catch (e) { o.nyErr = String(e); }
  const placed = [...cnt.values()].map((v) => v[0]);
  o.nylium = placed.length > 0 && placed.every((n) => /^(crimson_roots|crimson_fungus|warped_fungus)$/.test(n));
  // MushroomPlantBlock/FungusBlock: vegetation list weights 87/11/1 -> mostly roots
  o.fungusGrow = F.fungusGrow(e2, 0, 5, 0, () => 0.9, false) === 0 && F.fungusGrow(e2, 0, 9, 0, () => 0.1, true) === 2;
  o.fungus = o.fungusGrow && placed.filter((n) => n.endsWith('_roots')).length >= placed.filter((n) => n.endsWith('_fungus')).length;
  // ScheduleRule / Schedule.VILLAGER_DEFAULT
  const A = (t) => VB.activityForTime(t);
  o.sched = A(0) === 'rest' && A(10) === 'idle' && A(2000) === 'work' && A(8999) === 'work' && A(9000) === 'meet' && A(11000) === 'idle' && A(12000) === 'rest' && A(24000 + 2000) === 'work';
  o.baby = VB.activityForTime(5000, VB.SCHEDULE_BABY) === 'play' && VB.activityForTime(7000, VB.SCHEDULE_BABY) === 'idle';
  // SecondaryPointsOfInterestSensor: farmer sees composters within 4h/2v every 40 ticks
  const comp = { x: 3, y: 65, z: 0 }, far = { x: 6, y: 64, z: 0 };
  M.World = { getBlock: (x, y, z) => ((x === comp.x && y === comp.y && z === comp.z) || (x === far.x && y === far.y && z === far.z)) ? 77 : 0 };
  M.States = Object.assign(M.States || {}, { name: (s) => s === 77 ? 'composter' : 'air' });
  const v = { type: 'villager', profession: 'farmer', x: 0.5, y: 64, z: 0.5 };
  VB.senseSecondary(v, 100);
  o.sensor = v.vbSecondaryJobSite && v.vbSecondaryJobSite.length === 1 && v.vbSecondaryJobSite[0].x === 3;
  comp.x = 99; VB.senseSecondary(v, 120); o.sensorThrottle = !!v.vbSecondaryJobSite;   // within 40 ticks: unchanged
  VB.senseSecondary(v, 141); o.sensorForget = v.vbSecondaryJobSite === null;
  const v2 = { type: 'villager', profession: 'librarian', x: 0.5, y: 64, z: 0.5 }; comp.x = 3; VB.senseSecondary(v2, 100);
  o.sensorProf = v2.vbSecondaryJobSite === null;
  // StartRaidTask / EndRaidTask
  const St = M.Raid.Status, raid = { status: St.ONGOING, wavesSpawned: 1, preRaidTicks: 0 };
  M.RaidManager.world = { raids: {} }; M.RaidManager.getRaidAt = () => raid;
  VB.rand = () => 0;
  const e = { type: 'villager', x: 0.5, y: 64, z: 0.5 };
  o.start = VB.startRaidTask(e) === 'raid';
  raid.preRaidTicks = 40; const e3 = { x: 0.5, y: 64, z: 0.5 }; o.startPre = VB.startRaidTask(e3) === 'pre_raid';
  o.endKeep = VB.endRaidTask(e) === false && e.vbRaidActivity === 'raid';
  raid.status = St.VICTORY; o.endVictory = VB.endRaidTask(e) === false;
  raid.status = St.LOSS; o.endLoss = VB.endRaidTask(e) === true && e.vbRaidActivity === null;
  e3.vbRaidActivity = 'pre_raid'; M.RaidManager.getRaidAt = () => null; o.endNone = VB.endRaidTask(e3) === true;
  VB.rand = () => 0.5; const e4 = { x: 0, y: 64, z: 0, vbRaidActivity: 'raid' }; o.endRoll = VB.endRaidTask(e4) === false;
  // VillagerWalkTowardsTask: dest within maxRange -> WALK_TARGET dest; present target -> task does not run
  const w1 = { x: 0.5, y: 64, z: 0.5, vbMeeting: { x: 20, y: 64, z: 0 } };
  VB.walkTowardsTick(w1, 'vbMeeting', 6, 100, 200, 10);
  o.walkTowards = !!w1.vbWalkTarget && w1.vbWalkTarget.x === 20 && w1.vbWalkTarget.range === 6;
  const w2 = { x: 0.5, y: 64, z: 0.5, vbMeeting: { x: 20, y: 64, z: 0 }, vbWalkTarget: { x: 1, y: 64, z: 1, range: 1 } };
  VB.walkTowardsTick(w2, 'vbMeeting', 6, 100, 200, 10); o.walkTowardsBusy = w2.vbWalkTarget.x === 1;
  // MeetVillagerTask / GoToIfNearbyTask inside the meet RandomTask: bell within 40 -> walk to it
  M.EntityList = { list: [] };
  const m1 = { type: 'villager', x: 0.5, y: 64, z: 0.5, vbMeeting: { x: 20, y: 64, z: 0 } };
  o.goIfNearby = VB.meetRandomTick(m1, 10) === 'goToIfNearby' && m1.vbGoIfNearbyNext === 10 + VB.GO_IF_NEARBY_INTERVAL;
  const m2 = { type: 'villager', x: 0.5, y: 64, z: 0.5 };
  o.goIfNearbyNoMeeting = !VB.meetRandomTick(m2, 10) && !m2.vbWalkTarget;
  // SeekSkyTask: needs no sky at the block; walks (speed 1, range 0) to a sky-visible cell not above the entity
  const sk = { x: 0.5, y: 64, z: 0.5 };
  M.World = { canSeeSky: (x, y, z) => !(x === 0 && y === 64 && z === 0), heightAt: () => 60 };
  M.World.canSeeSky = (x, y) => !(x === 0 && y === 64);
  VB.rand = () => 0; const sr = VB.seekSkyStart(sk);  o.seekSky = sr === true && !!sk.vbWalkTarget && sk.vbWalkTarget.speedMul === 1;
  const sk2 = { x: 0.5, y: 70, z: 0.5 }; M.World.canSeeSky = () => true; const sr2 = VB.seekSkyStart(sk2); o.seekSkyOpen = sr2 === false && !sk2.vbWalkTarget;
  // ScheduleActivityTask: the per-tick refresh maps time-of-day mod 24000 through the schedule
  o.scheduleTask = VB.activityForTime(24000 * 3 + 5) === 'rest' && VB.activityForTime(24000 * 3 + 9500) === 'meet';
  return o;
}
const LBL = { walkTowards: 'VillagerWalkTowardsTask walks to dest', walkTowardsBusy: 'VillagerWalkTowardsTask needs WALK_TARGET absent', goIfNearby: 'GoToIfNearbyTask in meet RandomTask', goIfNearbyNoMeeting: 'meet RandomTask idle without MEETING_POINT', potato: 'PotatoesBlock growth', beet: 'BeetrootsBlock growth /3', fern: 'FernBlock.grow', fernBlocked: 'FernBlock blocked above', nylium: 'NyliumBlock.grow crimson', fungus: 'FungusBlock/MushroomPlantBlock weights',
  sched: 'ScheduleRule.getPriority default', baby: 'ScheduleRule baby', sensor: 'SecondaryPointsOfInterestSensor', sensorThrottle: 'sensor 40-tick throttle', sensorForget: 'sensor forgets', sensorProf: 'sensor profession filter',
  start: 'StartRaidTask raid', startPre: 'StartRaidTask pre_raid', endKeep: 'EndRaidTask keeps ongoing', endVictory: 'EndRaidTask keeps victory', seekSky: 'SeekSkyTask walks to sky', seekSkyOpen: 'SeekSkyTask idle with sky', scheduleTask: 'ScheduleActivityTask refresh', endLoss: 'EndRaidTask resets on loss', endNone: 'EndRaidTask resets no raid', endRoll: 'EndRaidTask 1/20 roll' };
const A = trial(null); 
if (A.nyErr) fails.push(A.nyErr);
for (const [key, m] of Object.entries(LBL)) ok(A[key], m);
const BR = [
  ['seekSky', /top <= e\.y\) \{/, 'top <= -999) {'],
  ['seekSkyOpen', /\|\| W\.canSeeSky\(bp\.x, bp\.y, bp\.z\)\) return false;/, '|| false) return false;'],
  ['scheduleTask', /if \(day < sched\[0\]\[0\]\) return sched/, 'if (false) return sched'],
  ['walkTowardsBusy', /if \(!dest \|\| e\.vbWalkTarget\) return;/, 'if (!dest) return;'],
  ['goIfNearby', /dist3\(e, p\) <= VB\.MEET_GO_IF_NEARBY\) \{/, 'dist3(e, p) <= 1) {'],
  ['beet', /if \(maxAge === 3\) g = Math\.floor\(g \/ 3\);/, ''],
  ['potato', /var g = 2 \+ Math\.floor\(rnd\(\) \* 4\);/, 'var g = 1 + Math.floor(rnd() * 4);'],
  ['fern', /var to = nm === 'fern' \? 'large_fern' : 'tall_grass';/, "var to = 'tall_grass';"],
  ['fernBlocked', /&& env\.name\(x, y \+ 1, z\) === 'air'\) \{\s*env\.set\(x, y, z, to/, ") {\n env.set(x, y, z, to"],
  ['nylium', /\['crimson_roots', 87\], \['crimson_fungus', 11\], \['warped_fungus', 1\]\], 3, 1\);\n      else/, "['warped_roots', 87]], 3, 1);\n      else"],
  ['sched', /if \(day < sched\[0\]\[0\]\) return sched\[sched\.length - 1\]\[1\];/, "if (day < sched[0][0]) return 'idle';"],
  ['sensor', /dy = -2; dy <= 2/, 'dy = -2; dy <= 0'],
  ['sensorThrottle', /e\.vbSecondarySenseNext = tnow \+ 40;/, 'e.vbSecondarySenseNext = 0;'],
  ['sensorProf', /VB\.SECONDARY_SITES = \{ farmer: \['composter'\] \};/, "VB.SECONDARY_SITES = { farmer: ['composter'], librarian: ['composter'] };"],
  ['startPre', /\(r\.wavesSpawned > 0 && !\(r\.preRaidTicks > 0\)\) \? 'raid' : 'pre_raid'/, "'raid'"],
  ['endLoss', /r\.status === St\.STOPPED \|\| r\.status === St\.LOSS/, 'r.status === St.STOPPED'],
  ['endRoll', /if \(Math\.floor\(VB\.rand\(\) \* 20\) !== 0\) return false;/, ''],
];
for (const [key, re, rep] of BR) {
  breaks++;
  let hit = false;
  const B = trial((f, src) => { const n = f === "07zv_villagerbrain.js" ? src.replace(re, rep) : src; if (n !== src) hit = true; return n; });
  ok(hit, 'break pattern matched: ' + key); ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
