#!/usr/bin/env node
// catbedcheck.mjs — #1316: CatEntity.SleepWithOwnerGoal / GoToBedAndSleepGoal / CatSitOnBlockGoal + morning gift,
// against .decomp CatEntity.java / CatSitOnBlockGoal.java / GoToBedAndSleepGoal.java. Breaks its own goals to prove it can fail.
import { loadEngine } from './loadsrc.mjs';

const M = loadEngine({ extra: ['07k_goals.js'], dom: false });
const Ai = M.Ai;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

// a stub world: one bed (state 100, part foot at x=5, facing +x so head at x=6) at y=64, owner in the head cell
const BED = 100, FOOT = 101, FURN = 102;
const blocks = new Map(); const key = (x, y, z) => x + ',' + y + ',' + z;
blocks.set(key(5, 64, 0), FOOT); blocks.set(key(6, 64, 0), BED);
M.World = { getBlock: (x, y, z) => blocks.get(key(x, y, z)) || 0 };
M.Tags = { ready: true, blockTag: () => 1, stateInCol: (c, s) => s === BED || s === FOOT };
M.Reg = { id: { chest: 900, furnace: FURN }, PROP: { part: 1, facing: 2, lit: 3 }, PVAL: { head: 'head', foot: 'foot', east: 'east', true: 'true' } };
M.States = { block: new Array(200).fill(0), propValue: (s, p) => p === 1 ? (s === BED ? 'head' : 'foot') : p === 2 ? 'east' : 'true' };
M.States.block[FURN] = FURN;
M.Player = { dirStep: () => [1, 0] };
M.EntityList = { list: [] };

Ai.findPath = () => null; Ai.stepToward = (e, n) => {}; Ai.closeTo = () => true;   // pathing is not under test: the cat is placed next to its target
const cat = (o) => Object.assign({ type: 'cat', tamed: true, owner: 'player', sitting: false, x: 5.5, y: 64, z: 0.5, bodyYaw: 0 }, o || {});
const owner = (o) => Object.assign({ x: 6.5, y: 64, z: 0.5, sleeping: true, sleepTimer: 100 }, o || {});

const run = (broken) => {
  const t = (c, m) => ok(broken ? !c : c, m);   // anti-vacuity: with the goal sabotaged every assertion must flip
  const mk = (e, o, sky, gifts, rnd) => new Ai.SleepWithOwnerGoal(e, () => [o], rnd || (() => 0), () => sky, (x, y, z, it) => gifts.push(it));
  { const e = cat(), o = owner(), g = mk(e, o, 0.78, []); t(g.canUse() === true, 'sleep: tamed cat + sleeping owner in bed starts'); }
  { const o = owner(); t(mk(cat({ tamed: false }), o, 0.78, []).canUse() === false, 'sleep: untamed never'); t(mk(cat({ sitting: true }), o, 0.78, []).canUse() === false, 'sleep: sitting never'); }
  t(mk(cat(), owner({ sleeping: false }), 0.78, []).canUse() === false, 'sleep: awake owner never');
  t(mk(cat({ x: 30 }), owner(), 0.78, []).canUse() === false, 'sleep: owner > 10 blocks never');
  { const o = owner({ x: 40.5 }); t(mk(cat(), o, 0.78, []).canUse() === false, 'sleep: owner not in a bed never'); }
  { const e = cat(), o = owner(), g = mk(e, o, 0.78, []); M.EntityList.list = [e, cat({ inSleepingPose: true })]; t(g.canUse() === false, 'sleep: another cat already asleep blocks'); M.EntityList.list = []; }
  // #3141: AABB(0.6x0.7) vs Box(bedPos 5,64,0).expand(2) = x[3,8] y[62,67] z[-2,3]
  { const other = (o) => { const e = cat(), g = mk(e, owner(), 0.78, []); M.EntityList.list = [e, cat(Object.assign({ inSleepingPose: true }, o))]; const r = g.canUse(); M.EntityList.list = []; return r; };
    t(other({ x: 8.1 }) === false, 'sleep box: centre 2.6 out in x but body overlaps -> blocks');
    t(other({ x: 8.4 }) === true, 'sleep box: body clear of the box in x -> ignored');
    t(other({ y: 61.2 }) === true, 'sleep box: feet by-2.8 (top 61.9) -> ignored');
    t(other({ y: 61.4 }) === false, 'sleep box: feet by-2.6 (top 62.1) -> blocks'); }
  { const e = cat(), o = owner(), g = mk(e, o, 0.78, []); g.canUse(); g.start();
    for (let i = 0; i < 16; i++) g.tick(); t(!e.inSleepingPose && e.headDown === true, 'sleep: first 16 ticks head down, not asleep');
    g.tick(); t(e.inSleepingPose === true && !e.headDown, 'sleep: tick 17 curls up'); g.stop(); t(!e.inSleepingPose && !e.headDown, 'sleep: stop clears poses'); }
  const gift = (sky, timer, rnd0) => { const rnd = rnd0 && (() => (rnd0.n = (rnd0.n || 0) + 1, rnd0.n === 1 ? 0 : rnd0()));  const gs = [], e = cat(), o = owner({ sleepTimer: timer }), g = mk(e, o, sky, gs, rnd); g.canUse(); g.start(); g.stop(); return gs; };
  t(gift(0.78, 100).length === 1, 'gift: sky 0.78, timer 100, roll 0 -> one gift');
  t(gift(0.7, 100).length === 0, 'gift: sky <= 0.77 -> none');
  t(gift(0.81, 100).length === 0, 'gift: sky >= 0.8 -> none');
  t(gift(0.78, 99).length === 0, 'gift: owner sleepTimer < 100 -> none');
  { const gs = [], g = mk(cat(), owner(), 0.78, gs, () => 0.9); g.canUse(); g.start(); g.stop(); t(gs.length === 0, 'gift: 70% roll failed -> none'); }
  { const seen = new Set(); let i = 0; for (let k = 0; k < 102; k++) { const r = k / 102; const gs = gift(0.78, 100, () => r); gs.forEach((x) => seen.add(x)); } t(seen.size === 7 && seen.has('phantom_membrane'), 'gift: all 7 loot-table items reachable'); }
  // gift teleport (LivingEntity.teleport): rnd 0 -> offset (-5,-2,-5) from the cat's block; lands on solid ground at integer coords, refused over a void / in water
  { M.States.solid = M.States.solid || []; M.States.solid[1] = 1; M.States.waterIn = M.States.waterIn || []; M.States.waterIn[2] = 1; M.States.solid[2] = 0;
    const tryGift = () => { const e = cat(), o = owner(), g = mk(e, o, 0.78, []); g.canUse(); g.start(); g.stop(); return e; };
    blocks.set(key(0, 50, -5), 1);                       // ground far below the target (0,62,-5): the walk-down must reach it
    let e = tryGift(); t(e.x === 0 && e.y === 51 && e.z === -5, 'gift tp: walks down to solid ground, integer coords (got ' + e.x + ',' + e.y + ',' + e.z + ')');
    blocks.set(key(0, 51, -5), 2); e = tryGift(); t(e.x === 5.5 && e.z === 0.5, 'gift tp: landing in water refused, cat stays');
    blocks.delete(key(0, 51, -5)); blocks.delete(key(0, 50, -5)); e = tryGift(); t(e.x === 5.5 && e.y === 64, 'gift tp: no ground -> cat stays');
  }
  // GoToBedAndSleep / CatSitOnBlock
  { const e = cat({ x: 5.5, y: 67, z: 0.5 }); const g = new Ai.GoToBedAndSleepGoal(e, 1.1, 8); t(g.canUse() === true, 'gotobed: finds the bed (lowestY -2 scan order skips dy 0..2 like the jar)'); g.start(); e.y = 65;
    for (let i = 0; i < 3; i++) g.tick(); t(e.inSleepingPose === true, 'gotobed: asleep once at the bed'); g.stop(); t(!e.inSleepingPose, 'gotobed: stop wakes'); }
  t(new Ai.GoToBedAndSleepGoal(cat({ tamed: false }), 1.1, 8).canUse() === false, 'gotobed: untamed never');
  t(new Ai.GoToBedAndSleepGoal(cat({ inSleepingPose: true }), 1.1, 8).canUse() === false, 'gotobed: already asleep never');
  { const e = cat({ x: 5.5, y: 65, z: 0.5 }); blocks.delete(key(6, 64, 0)); blocks.delete(key(5, 64, 0)); blocks.set(key(5, 64, 0), FOOT); blocks.set(key(6, 64, 0), BED);
    const g = new Ai.CatSitOnBlockGoal(e, 0.8); t(g.canUse() === true, 'sitonblock: foot/head bed found'); g.start(); for (let i = 0; i < 3; i++) g.tick(); t(e.sitPose === true, 'sitonblock: sits at the block'); g.stop(); t(e.sitPose === false, 'sitonblock: stop stands'); }
  { const e = cat({ x: 20.5, y: 65, z: 0.5 }); blocks.set(key(20, 64, 0), FURN); const g = new Ai.CatSitOnBlockGoal(e, 0.8); t(g.canUse() === true, 'sitonblock: lit furnace found'); blocks.delete(key(20, 64, 0)); }
  { const e = cat({ x: 5.5, y: 65, z: 0.5 }); blocks.delete(key(5, 64, 0)); const g = new Ai.CatSitOnBlockGoal(e, 0.8); t(g.canUse() === false, 'sitonblock: head-only bed refused'); blocks.set(key(5, 64, 0), FOOT); }
  // #3028 MoveToTargetPosGoal timing: sit maxY 1, sit interval 200+rand(200), bed interval 40 selections = 80 ticks
  { const calls = (mkGoal, place) => { const e = cat({ x: 40.5, y: 67, z: 0.5 }); const g = mkGoal(e); if (g.canUse()) return -1; place(); let n = 1; while (!g.canUse() && n < 1000) n++; return n; };
    const furn = () => blocks.set(key(40, 66, 0), FURN), unfurn = () => { blocks.delete(key(40, 66, 0)); blocks.delete(key(40, 64, 0)); };
    const orig = Math.random;
    for (const [r, lo, hi] of [[0, 201, 201], [0.999, 400, 400]]) { Math.random = () => r; const origRnd = Ai.rndOf; Ai.rndOf = () => () => r; let n; try { n = calls((e) => new Ai.CatSitOnBlockGoal(e, 0.8), furn); } finally { Ai.rndOf = origRnd; } unfurn(); t(n >= lo && n <= hi, 'sitonblock: re-scan cooldown ' + (200 + Math.floor(r * 200)) + ' (got ' + (n - 1) + ')'); }
    for (const r of [0, 0.999]) { Math.random = () => r; const n = calls((e) => new Ai.GoToBedAndSleepGoal(e, 1.1, 8), () => { blocks.set(key(40, 64, 0), BED); }); unfurn(); t(n === 81, 'gotobed: cooldown 80 (vanilla 40 selections, every other tick) (got ' + (n - 1) + ')'); }
    Math.random = orig;
    { const e = cat({ x: 20.5, y: 66, z: 0.5 }); blocks.set(key(20, 67, 0), FURN); t(new Ai.CatSitOnBlockGoal(e, 0.8).canUse() === false, 'sitonblock: block 1 above feet is out of maxY 1'); blocks.delete(key(20, 67, 0)); }
    { const e = cat({ x: 20.5, y: 65, z: 0.5 }); blocks.set(key(20, 64, 0), FURN); const g = new Ai.CatSitOnBlockGoal(e, 0.8); g.canUse(); Math.random = () => 0; g.start(); Math.random = orig; e.y = 64.2; g.tick(); t(!e.sitPose, 'sitonblock: reach measured to block centre ty+1.5 (1.3 away, not reached)');
      e.y = 65; g.tick(); t(e.sitPose === true, 'sitonblock: reached at ty+1'); blocks.delete(key(20, 64, 0)); }
    { const e = cat({ x: 20.5, y: 65, z: 0.5 }); blocks.set(key(20, 64, 0), FURN); const g = new Ai.CatSitOnBlockGoal(e, 0.8); g.canUse(); Math.random = () => 0; g.start(); Math.random = orig; blocks.delete(key(20, 64, 0)); }
  }
  // roster
  { const names = M.Ai.ROSTER && M.Ai.ROSTER.cat ? M.Ai.ROSTER.cat(cat(), {}).entries.map((x) => x.priority + ':' + x.goal.constructor.name) : [];
    t(names.length > 0, 'roster: cat built'); }
};
run(false);
// anti-vacuity: break the bed tag and the gift window; every mutated assertion group must notice
{
  const origTags = M.Tags, origGifts = Ai.CAT_GIFTS.slice();
  M.Tags = { ready: true, blockTag: () => 1, stateInCol: () => false };
  const before = fails.length; run(false);
  if (fails.length > before) { breaks++; console.log(' ✓ anti-vacuity: no bed tag noticed'); } else fails.push('anti-vacuity: no bed tag went unnoticed');
  fails.length = before; M.Tags = origTags;
  Ai.CAT_GIFTS.length = 1; const b2 = fails.length; run(false);
  if (fails.length > b2) { breaks++; console.log(' ✓ anti-vacuity: one-item gift table noticed'); } else fails.push('anti-vacuity: empty gift table went unnoticed');
  fails.length = b2; origGifts.forEach((x) => Ai.CAT_GIFTS.push(x));
}
{ const g = new Ai.SleepWithOwnerGoal(cat(), () => [owner()], () => 0, () => 0.78, () => {}); const real = Ai.SleepWithOwnerGoal; Ai.SleepWithOwnerGoal = function () { this.canUse = () => false; this.start = this.stop = this.tick = () => {}; }; const b3 = fails.length; run(false); if (fails.length > b3) { breaks++; console.log(' ✓ anti-vacuity: dead goal noticed'); } else fails.push('anti-vacuity: dead goal went unnoticed'); fails.length = b3; Ai.SleepWithOwnerGoal = real; }
{ const rs = Ai.CatSitOnBlockGoal, rb = Ai.GoToBedAndSleepGoal; const old = (g, iv) => function (e, sp, rg) { let cd = 0; const m = new g(e, sp, rg); this.canUse = function () { if (cd > 0) { cd--; return false; } cd = iv + Math.floor(Math.random() * iv); return m.canUse(); }; this.start = m.start; this.stop = m.stop; this.tick = m.tick; this.canContinueToUse = m.canContinueToUse; };
  Ai.CatSitOnBlockGoal = old(rs, 40); Ai.GoToBedAndSleepGoal = old(rb, 40); const b4 = fails.length; run(false); if (fails.length > b4) { breaks++; console.log(' ✓ anti-vacuity: old 40-80 cooldowns noticed'); } else fails.push('anti-vacuity: old cooldowns went unnoticed'); fails.length = b4; Ai.CatSitOnBlockGoal = rs; Ai.GoToBedAndSleepGoal = rb; }
if (fails.length) { console.log('\nFAIL (' + fails.length + '):'); fails.slice(0, 40).forEach((f) => console.log(' x ' + f)); }
console.log('\ncatbedcheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
