#!/usr/bin/env node
// foxgoalscheck.mjs — #1286: FoxEntity's StopWandering / AvoidDaylight / DelayedCalmDown /
// SitDownAndLookAround goal states against .decomp FoxEntity.java canStart/shouldContinue.
import { loadEngine } from './loadsrc.mjs';

const MCL = loadEngine({ extra: ['07k_goals.js', '07zj_fox.js', '07zk_undead.js'], dom: false });
const Fx = MCL.Fox;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

function env(over) {
  return Object.assign({ random: () => 0.5, isDay: () => true, isThundering: () => false,
    canSeeSky: () => false, favor: () => 0.1, worriers: () => [], isNearVillage: () => false }, over || {});
}
const fox = (o) => Object.assign({ x: 0.5, y: 64, z: 0.5, height: 0.7 }, o || {});
const run = (broken) => {
  const r = [];
  const t = (c, m) => r.push([c, m]);
  // FoxMoveControl gate: no steering while sleeping/sitting/walking
  for (const st of ['sleeping', 'sitting', 'walking', null]) {
    let n = 0; const keep = MCL.Ai.stepToward; MCL.Ai.stepToward = () => { n++; };
    Fx.stepToward(fox(st ? { [st]: true } : {}), { x: 3, y: 64, z: 3 }, 1);
    MCL.Ai.stepToward = keep;
    t(n === (st ? 0 : 1), 'movecontrol: stepToward ' + (st ? 'blocked while ' + st : 'allowed when awake'));
  }
  // DelayedCalmDown: sleeps only when day + roofed + favoured + no worrier + not in powder snow, timer expired
  const calm = (e, o) => new Fx.DelayedCalmDownGoal(e, env(Object.assign({ random: () => 0 }, o)));
  t(calm(fox()).canUse() === true, 'calm: day+roofed+calm+no worrier must start');
  t(calm(fox(), { isDay: () => false }).canUse() === false, 'calm: night must not start');
  t(calm(fox(), { canSeeSky: () => true }).canUse() === false, 'calm: sky-visible must not start');
  t(calm(fox(), { favor: () => -0.2 }).canUse() === false, 'calm: negative pathfinding favour must not start');
  // favour is sampled at the head cell (x, maxY, z): grass only counts below the FEET cell, so it must not rescue a dark head cell
  t(calm(fox({ y: 64.5 }), { favor: (x, y) => (y === 64 ? 10 : -0.2) }).canUse() === false, 'calm: favour must be sampled at head height, not the feet cell');
  t(calm(fox(), { worriers: () => [{}] }).canUse() === false, 'calm: nearby worrier must not start');
  t(calm(fox({ inPowderSnow: true })).canUse() === false, 'calm: powder snow must not start');
  t(calm(fox({ forwardSpeed: 0.2 })).canUse() === false, 'calm: moving must not start');
  { const g = new Fx.DelayedCalmDownGoal(fox(), env({ random: () => 0.99 })); t(g.canUse() === false, 'calm: initial timer delays start'); }
  { const e = fox(); const g = calm(e); g.canUse(); g.start(); t(e.sleeping === true, 'calm: start sets sleeping'); g.stop(); t(e.sleeping === false, 'calm: stop wakes'); }
  // AvoidDaylight
  const av = (e, o) => new Fx.AvoidDaylightGoal(e, env(o));
  t(av(fox({ sleeping: true }), { isThundering: () => true }).canUse() === false, 'avoid: sleeping never starts');
  t(av(fox({ target: {} })).canUse() === false, 'avoid: with target never starts');
  t(av(fox({ sleeping: false })).canUse() === false, 'avoid: first call waits out the 100 timer');
  // StopWandering
  { const e = fox({ walking: true }); const g = new Fx.StopWanderingGoal(e); t(g.canUse() === true, 'stopwander: walking starts');
    g.start(); for (let i = 0; i < 40; i++) g.tick(); t(g.canContinueToUse() === false, 'stopwander: ends after 40 ticks'); g.stop(); t(e.walking === false, 'stopwander: stop clears walking');
    t(new Fx.StopWanderingGoal(fox()).canUse() === false, 'stopwander: not walking -> no'); }
  // SitDownAndLookAround
  const sit = (e, o) => new Fx.SitDownAndLookAroundGoal(e, env(Object.assign({ random: () => 0.01 }, o)));
  t(sit(fox()).canUse() === true, 'sit: idle fox rolls <0.02 starts');
  t(sit(fox(), { random: () => 0.5 }).canUse() === false, 'sit: roll >=0.02 refuses');
  t(sit(fox({ sleeping: true })).canUse() === false, 'sit: sleeping refuses');
  t(sit(fox({ target: {} })).canUse() === false, 'sit: target refuses');
  t(sit(fox({ crouching: true })).canUse() === false, 'sit: crouching refuses');
  t(sit(fox(), { worriers: () => [{}] }).canUse() === false, 'sit: worrier refuses');
  { const e = fox(); const g = sit(e); g.canUse(); g.start(); t(e.sitting === true, 'sit: start sits'); g.stop(); t(e.sitting === false, 'sit: stop stands'); }
  // FoxSwimGoal: water only past 0.25 fluid height, lava always, start() stopActions
  { const sw = (e, h) => new Fx.FoxSwimGoal(e, { waterHeight: () => h });
    t(sw(fox({ inWater: true }), 0.2).canUse() === false, 'swim: 0.2 fluid height must not start');
    t(sw(fox({ inWater: true }), 0.6).canUse() === true, 'swim: 0.6 fluid height starts');
    t(sw(fox({ inLava: true }), 0).canUse() === true, 'swim: lava starts');
    t(sw(fox(), 1).canUse() === false, 'swim: dry never starts');
    const e = fox({ inWater: true, sleeping: true, sitting: true }); sw(e, 1).start(); t(!e.sleeping && !e.sitting, 'swim: start clears sleeping/sitting'); }
  // stopActions clears aggressive (not jumping/chasing); MateGoal.start stops both foxes
  { const e = fox({ aggressive: true, sleeping: true, jumping: true, chasing: true }); Fx.stopActions(e);
    t(e.aggressive === false && e.sleeping === false, 'stopActions: clears aggressive + sleeping');
    t(e.jumping === true && e.chasing === true, 'stopActions: leaves jumping/chasing alone');
    const m = fox({ inLove: true, type: 'fox', aggressive: true, sleeping: true }), o = fox({ inLove: true, type: 'fox', x: 1.5, aggressive: true });
    const g = new Fx.MateGoal(m, 1, () => [m, o], null); t(g.canUse() === true, 'mate: partner found'); const fp = MCL.Ai.findPath; MCL.Ai.findPath = () => null; g.start(); MCL.Ai.findPath = fp;
    t(!m.aggressive && !m.sleeping && !o.aggressive, 'mate: start stopActions on animal and mate'); }
  // JumpChasing / GoToVillage
  t(Fx.canJumpChase({ x: 0, y: 64, z: 0 }, { x: 4, y: 64, z: 0 }, () => true) === true, 'jumpchase: clear line ok');
  t(Fx.canJumpChase({ x: 0, y: 64, z: 0 }, { x: 4, y: 64, z: 0 }, (x, y) => y !== 65) === false, 'jumpchase: blocked line refused');
  { const jc = (e, o) => new Fx.JumpChasingGoal(e, Object.assign({ isReplaceable: () => true }, o));
    t(jc(fox({ target: { x: 3, y: 64, z: 0 } })).canUse() === false, 'jumpchase: uncrouched refuses');
    t(jc(fox({ crouching: true, crouchTicks: 15 })).canUse() === false, 'jumpchase: no target refuses');
    const e = fox({ crouching: true, crouchTicks: 15, target: { x: 3, y: 64, z: 0 } }); const g = jc(e);
    t(g.canUse() === true, 'jumpchase: crouched with clear line starts'); g.start(); t(e.vy === 0.9 && e.chasing === true, 'jumpchase: start leaps (vy 0.9)');
    { const q = fox({ crouching: true, crouchTicks: 15, target: { x: 3, y: 64, z: 4 } }); const gq = jc(q); gq.start();
      t(Math.abs(q.vx - 2.5 / Math.hypot(2.5, 3.5) * 0.8) < 1e-9 && Math.abs(q.vz - 3.5 / Math.hypot(2.5, 3.5) * 0.8) < 1e-9 && q.vy === 0.9 && q.jumping === true, 'jumpchase: leap vector = normalized(target-fox)*0.8 horizontally (3D unit vector), +0.9 up');
      t(gq.canContinueToUse() === true, 'jumpchase: airborne keeps going');
      gq.tick(); const want = -Math.acos(Math.hypot(q.vx, q.vz) / Math.hypot(q.vx, 0.9, q.vz)) * 180 / Math.PI;
      t(Math.abs(q.pitch - want) < 1e-9 && q.pitch < 0, 'jumpchase: in-flight pitch follows the velocity arc');
      q.vy = 0.1; q.pitch = 5; q.onGround = true; t(gq.canContinueToUse() === false, 'jumpchase: landed (vy^2<0.05, |pitch|<15, onGround) stops');
      q.walking = true; q.onGround = false; t(gq.canContinueToUse() === false, 'jumpchase: walking stops');
      t(gq.isInterruptable === false, 'jumpchase: canStop false'); }
    { const r = fox({ crouching: true, target: { x: 3, y: 64, z: 0 } }); let early = false;
      for (let i = 1; i <= 15; i++) { Fx.mobTick(r); if (i < 15 && jc(r).canUse()) early = true; }
      t(!early && jc(r).canUse() === true, 'jumpchase: refused until 15 ticks crouched, then fires'); }
    const b = fox({ crouching: true, crouchTicks: 15, target: { x: 3, y: 64, z: 0 } }); t(jc(b, { isReplaceable: () => false }).canUse() === false && b.crouching === false, 'jumpchase: blocked uncrouches'); }
  { // powder-snow dive: the default ctx reads the real world block at the fox's feet (#4144)
    const W = MCL.World || (MCL.World = {}), S = MCL.States; let id = 1; while (S.block[id] !== MCL.Reg.id.powder_snow) id++;
    const dive = (blk) => { W.getBlock = (x, y, z) => (y === 64 ? blk : 0);
      const e = fox({ pitch: 30, onGround: true, vy: -0.1 }); new Fx.JumpChasingGoal(e, {}).tick(); return e; };
    t(dive(id).walking === true && dive(id).pitch === 60, 'jumpchase: landing in powder_snow dives (walking, pitch 60)');
    t(!dive(0).walking, 'jumpchase: landing in air does not dive'); }
  { const h = (o, c) => { const e = fox(Object.assign({ target: { type: 'chicken', x: 5, y: 64, z: 0 } }, o)); return [e, new Fx.MoveToHuntGoal(e, c)]; };
    let [e, g] = h({}, { isReplaceable: () => false }); g.stop(); t(e.crouching !== true && e.rollingHead !== true, 'hunt: stop with blocked jump line does not crouch');
    [e, g] = h({}, { isReplaceable: () => true }); g.stop(); t(e.crouching === true && e.rollingHead === true, 'hunt: stop with clear line crouches');
    t(h({ rollingHead: true })[1].canUse() === false && h({ jumping: true })[1].canUse() === false, 'hunt: canUse refuses while rollingHead/jumping'); }
  { const pois = [{ x: 0, y: 64, z: 0 }]; const gv = (e, o) => new Fx.GoToVillageGoal(e, env(Object.assign({ random: () => 0, isDay: () => false, occupiedPositions: () => pois }, o)));
    t(gv(fox({ target: {} })).canUse() === false, 'village: with target refuses');
    t(gv(fox({ sleeping: true })).canUse() === false, 'village: sleeping refuses');
    t(gv(fox(), { isDay: () => true }).canUse() === false, 'village: day refuses');
    t(gv(fox(), { occupiedPositions: () => [] }).canUse() === false, 'village: no POI refuses');
    t(gv(fox(), { random: () => 0.9 }).canUse() === false, 'village: roll refuses'); }
  { const played = []; MCL.Sound = Object.assign(MCL.Sound || {}, { play: (n) => played.push(n) });
    t(Fx.sniffRoll(fox(), () => 0.04) === true && played[0] === 'entity.fox.sniff', 'sniff: roll <0.05 plays entity.fox.sniff');
    t(Fx.sniffRoll(fox(), () => 0.05) === false && played.length === 1, 'sniff: roll >=0.05 silent'); }

  // AttackGoal: one entity.fox.bite (vol 1, pitch 1) per melee strike, via the real roster goal
  { const log = []; MCL.Sound = { play: (n, o) => log.push([n, o]) };
    const target = { x: 0.5, y: 64, z: 0.5 };
    const e = fox({ type: 'fox', target });
    const gs = MCL.Ai.ROSTER.fox(e, { random: () => 0.5, players: () => [], animals: () => [] });
    const mg = gs.entries.find(x => x.priority === 7 && x.goal instanceof MCL.Fox.AttackGoal).goal;
    mg.start(); mg.tick();
    t(log.length === 1 && log[0][0] === 'entity.fox.bite' && log[0][1].volume === 1 && log[0][1].pitch === 1, 'bite: one entity.fox.bite vol1 pitch1 per strike'); }
  // AttackGoal / LookAtEntityGoal pose gates (FoxEntity.java:729-736, :1184-1198)
  { MCL.Sound = { play: () => {} };
    const P = { x: 1.5, y: 64, z: 0.5 };
    const mk = (o) => { const e = fox(Object.assign({ type: 'fox', target: { x: 0.5, y: 64, z: 0.5 } }, o));
      const gs = MCL.Ai.ROSTER.fox(e, { random: () => 0.5, players: () => [P], animals: () => [] });
      return [e, gs.entries.find(x => x.priority === 7 && x.goal instanceof MCL.Fox.AttackGoal).goal, gs.entries.find(x => x.priority === 12).goal]; };
    t(mk({})[1].canUse() === true, 'attack: calm fox may attack');
    for (const k of ['sitting', 'sleeping', 'crouching', 'walking']) t(mk({ [k]: true })[1].canUse() === false, 'attack: false while ' + k);
    { const [e, a] = mk({ rollingHead: true }); a.start(); t(e.rollingHead === false, 'attack: start clears rollingHead'); }
    const R = Math.random; Math.random = () => 0;   // LookAtPlayerGoal rolls Math.random() < 0.02 (#4339)
    t(mk({})[2].canUse() === true, 'look: calm fox looks at player');
    for (const k of ['walking', 'rollingHead']) { const [, , l] = mk({}); const [, , l2] = mk({ [k]: true }); t(l2.canUse() === false && l.canUse() === true, 'look: false while ' + k); }
    Math.random = R; }
  // EscapeWhenNotAggressiveGoal / FollowParentGoal: an aggressive fox neither panics nor follows its parent
  { MCL.Physics = Object.assign(MCL.Physics || {}, { solidAt: () => true, shapeAt: () => null }); MCL.Ai.pathTypeAt = () => 0; MCL.Ai.pathPenalty = () => 0;
    const mk = (o) => { const e = fox(Object.assign({ type: 'fox' }, o)); const gs = MCL.Ai.ROSTER.fox(e, { random: () => 0.5, players: () => [], animals: () => [{ type: 'fox', x: 6.5, y: 64, z: 0.5, isBaby: false }] }); return gs.entries; };
    const pan = (o) => mk(o).find(x => x.priority === 2).goal;
    const fol = (o) => mk(o).find(x => x.priority === 8).goal;
    t(pan({ justHurt: true }).canUse() === true, 'panic: calm hurt fox flees');
    t(pan({ justHurt: true, aggressive: true }).canUse() === false, 'panic: aggressive hurt fox keeps fighting');
    t(fol({ isBaby: true }).canUse() === true, 'follow: calm baby follows parent');
    t(fol({ isBaby: true, aggressive: true }).canUse() === false, 'follow: aggressive baby does not follow'); }
  // FleeEntityGoal(wolf/polar_bear): filter includes !isAggressive()
  { MCL.Ai.canSee = () => true; MCL.Ai.findPath = () => [{ x: 0, y: 64, z: 0 }, { x: -4, y: 64, z: 0 }]; MCL.Ai.animalPathfindingFavor = () => 0;
    MCL.EntityList = { list: [{ type: 'wolf', x: 5.5, y: 64, z: 0.5 }, { type: 'polar_bear', x: 0.5, y: 64, z: 5.5 }] };
    const flee = (o, pr) => { const e = fox(Object.assign({ type: 'fox', followRange: 16 }, o)); const gs = MCL.Ai.ROSTER.fox(e, { random: () => 0.5, players: () => [], animals: () => [] });
      return gs.entries.filter(x => x.priority === 4 && x.goal instanceof MCL.Ai.AvoidEntityGoal)[pr].goal.canUse(); };
    t(flee({}, 1) === true, 'flee: calm fox flees untamed wolf');
    t(flee({}, 2) === true, 'flee: calm fox flees polar bear');
    t(flee({ aggressive: true }, 1) === false, 'flee: aggressive fox ignores wolf');
    t(flee({ aggressive: true }, 2) === false, 'flee: aggressive fox ignores polar bear');
    MCL.EntityList = { list: [] }; }
  // PickupItemGoal: PICKABLE_DROP_FILTER excludes every item with pickupDelay > 0
  { const pk = (d) => { MCL.EntityList = { list: [{ type: 'item', x: 2.5, y: 64, z: 0.5, pickupDelay: d }] };
      return new Fx.PickupItemGoal(fox(), env({ random: () => 0 })).canUse(); };
    t(pk(0) === true, 'pickup: item with pickupDelay 0 starts the goal');
    t(pk(20) === false, 'pickup: item with pickupDelay 20 must not start the goal');
    MCL.EntityList = { list: [] }; }
  return r;
};
const rows = run();
for (const [c, m] of rows) ok(c, m);
// anti-vacuity: break the goals and confirm the same rows go red
let breaks = 0;
const orig = { c: Fx.DelayedCalmDownGoal, s: Fx.StopWanderingGoal, d: Fx.SitDownAndLookAroundGoal };
const alwaysYes = function () { this.canUse = () => true; this.canContinueToUse = () => true; this.start = () => {}; this.stop = () => {}; this.tick = () => {}; };
for (const k of ['DelayedCalmDownGoal', 'StopWanderingGoal', 'SitDownAndLookAroundGoal', 'JumpChasingGoal', 'GoToVillageGoal', 'FoxSwimGoal']) {
  const keep = Fx[k]; Fx[k] = alwaysYes;
  if (run().some(([c]) => !c)) breaks++; else fails.push('anti-vacuity: breaking ' + k + ' went unnoticed');
  Fx[k] = keep;
}
{ const keep = Fx.sniffRoll; Fx.sniffRoll = () => false;
  if (run().some(([c]) => !c)) breaks++; else fails.push('anti-vacuity: breaking sniffRoll went unnoticed');
  Fx.sniffRoll = keep; }
const keepA = Fx.AvoidDaylightGoal; Fx.AvoidDaylightGoal = alwaysYes;
if (run().some(([c]) => !c)) breaks++; else fails.push('anti-vacuity: breaking AvoidDaylightGoal went unnoticed');
Fx.AvoidDaylightGoal = keepA;
{ const P = MCL.Ai.PanicGoal, F = MCL.Ai.FollowParentGoal;
  MCL.Ai.PanicGoal = function (e, sp) { return new P(e, sp); };
  if (run().some(([c]) => !c)) breaks++; else fails.push('anti-vacuity: ungated PanicGoal went unnoticed');
  MCL.Ai.PanicGoal = P;
  MCL.Ai.FollowParentGoal = function (e, sp, g) { const f = new F(e, sp, g), u = f.canUse; return { get canUse() { return u; }, set canUse(_) {} }; };   // swallows the roster's aggressive gate
  if (run().some(([c]) => !c)) breaks++; else fails.push('anti-vacuity: ungated FollowParent went unnoticed');
  MCL.Ai.FollowParentGoal = F; }
{ const keep = Fx.wantsToPickupItem; Fx.wantsToPickupItem = () => true;
  if (run().some(([c]) => !c)) breaks++; else fails.push('anti-vacuity: breaking wantsToPickupItem went unnoticed');
  Fx.wantsToPickupItem = keep; }
{ const keep = Fx.canJumpChase; Fx.canJumpChase = () => true;
  if (run().some(([c]) => !c)) breaks++; else fails.push('anti-vacuity: breaking canJumpChase went unnoticed');
  Fx.canJumpChase = keep; }
{ const A = Fx.AttackGoal, L = Fx.LookAtEntityGoal;
  Fx.AttackGoal = function (e) { A.call(this, e); this.canUse = () => true; };
  if (run().some(([c]) => !c)) breaks++; else fails.push('anti-vacuity: ungated AttackGoal went unnoticed');
  Fx.AttackGoal = A;
  Fx.LookAtEntityGoal = function (e, p, r) { L.call(this, e, p, r); this.canUse = () => true; };
  if (run().some(([c]) => !c)) breaks++; else fails.push('anti-vacuity: ungated LookAt went unnoticed');
  Fx.LookAtEntityGoal = L; }
const keepF = Fx.isAtFavoredLocation;
Fx.isAtFavoredLocation = (e, en) => !en.sky(Math.floor(e.x), Math.floor(e.y + e.height), Math.floor(e.z)) && en.favor(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) >= 0;
if (run().some(([c]) => !c)) breaks++; else fails.push('anti-vacuity: feet-cell favour went unnoticed');
Fx.isAtFavoredLocation = keepF;
const keepB = Fx.bite; Fx.bite = () => {};
if (run().some(([c]) => !c)) breaks++; else fails.push('anti-vacuity: silencing Fx.bite went unnoticed');
Fx.bite = keepB;
void orig;
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
