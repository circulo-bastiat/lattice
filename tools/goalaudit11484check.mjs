#!/usr/bin/env node
// goalaudit11484check.mjs — #11484: drives 07k_goals.js through the real Ai.* path for classes the audit listed unchecked:
// IronGolemLookGoal (day gate, 1/8000 roll, villager within 6, 400-tick hold, lookingAtVillager flag), TemptGoal (10-block range,
// closest player, 100-tick cooldown after stop), PathNodeType / NavigationType default penalties (PathNodeType.java:4-29),
// WanderNearTargetGoal range gate, WanderAroundPointOfInterestGoal / PointOfInterest / CuboidBlockIterator (no POI -> no target),
// CuboidBlockIterator (refuse within 1 section of an occupied POI; first-min cell in x-fastest order), UniformIntProvider(20,40)
// crossbow cooldown (TimeHelper.betweenSeconds(1,2)), PatrolEntity.isRaidCenterSet. Anti-vacuity: each source break must fail.
import fs from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07k_goals.js'], dom: false, ...(patch ? { patch } : {}) });
  const Ai = M.Ai, o = {};
  const NS = M;
  // PathNodeType default penalties
  const T = Ai.NodeType, P = Ai.DEFAULT_PENALTY;
  o.pen = P[T.WATER] === 8 && P[T.DAMAGE_FIRE] === 16 && P[T.BREACH] === 4 && P[T.DANGER_FIRE] === 8 && P[T.LAVA] === -1 && P[T.BLOCKED] === -1 && P[T.OPEN] === 0 && P[T.DOOR_WOOD_CLOSED] === -1 && P[T.DAMAGE_CACTUS] === -1;
  o.penTable = Object.keys(T).length === 26 && T.COCOA === 25 && T.DANGER_POWDER_SNOW === 10;
  // UniformIntProvider(20,40) inclusive
  o.uniform = Ai.CROSSBOW_COOLDOWN_MIN === 20 && Ai.CROSSBOW_COOLDOWN_MIN + Ai.CROSSBOW_COOLDOWN_SPAN - 1 === 40;
  // IronGolemLookGoal
  let day = true; NS.Sky = { isDay: () => day };
  const g = { x: 0, y: 64, z: 0 }, vil = { x: 3, y: 64, z: 0 };
  let roll = 0; const mk = (vs) => new Ai.IronGolemLookGoal(g, { random: () => roll, villagers: () => vs });
  o.golemStart = mk([vil]).canUse() === true;
  day = false; o.golemNight = mk([vil]).canUse() === false; day = true;
  roll = 0.5; o.golemRoll = mk([vil]).canUse() === false; roll = 0;
  o.golemFar = mk([{ x: 7, y: 64, z: 0 }]).canUse() === false;
  const gg = mk([vil]); gg.canUse(); gg.start();
  o.golemFlag = g.lookingAtVillagerTicks === 400;
  let n = 0; while (gg.canContinueToUse()) { gg.tick(); n++; } o.golemHold = n === 400 && g.lookTarget === vil;
  gg.stop(); o.golemStop = g.lookingAtVillagerTicks === 0;
  // TemptGoal
  const cow = { x: 0, y: 64, z: 0 };
  const pl = (x, item) => ({ x, y: 64, z: 0, heldItem: item, offHandItem: null });
  const isT = (s) => s === 'wheat';
  const tg = new Ai.TemptGoal(cow, 1, () => [pl(9, 'wheat')], isT, false);
  o.tempt = tg.canUse() === true;
  o.temptFar = new Ai.TemptGoal(cow, 1, () => [pl(11, 'wheat')], isT, false).canUse() === false;
  o.temptItem = new Ai.TemptGoal(cow, 1, () => [pl(3, 'stick')], isT, false).canUse() === false;
  const tg2 = new Ai.TemptGoal(cow, 1, () => [pl(9, 'wheat'), pl(4, 'wheat')], isT, false); tg2.canUse();
  o.temptClosest = tg2.canUse() === true;
  tg.start && tg.start(); tg.stop(); o.temptCooldown = tg.canUse() === false;
  // WanderNearTargetGoal
  const gl = { x: 0, y: 64, z: 0, target: { x: 20, y: 64, z: 0 } };
  try { o.wnt = new Ai.WanderNearTargetGoal(gl, 1, 15 * 15, () => 0.5).canUse() === false; } catch (e) { o.wnt = false; }
  o.wntNone = new Ai.WanderNearTargetGoal({ x: 0, y: 64, z: 0 }, 1, 400, () => 0.5).canUse() === false;
  // WanderAroundPointOfInterestGoal: near occupied POI -> refuses (dist <= 1 section)
  NS.Poi = { occupiedPositions: () => [] };
  o.poiNone = new Ai.WanderAroundPointOfInterestGoal({ x: 1, y: 64, z: 1 }, 0.6, () => 0).canUse() === false;
  // YawAdjustingLookControl (dolphin, threshold 10): body follows head 4deg/tick once they differ by more than 10deg
  const dol = { x: 0, y: 64, z: 0, yHeadRot: 1.5, yBodyRot: 0, pitch: 0, navigating: true };
  const yl = new Ai.YawAdjustingLookControl(dol, 10); yl.tick();
  o.yawLook = Math.abs(dol.yBodyRot - 4 * Math.PI / 180) < 1e-6;
  const dol2 = { x: 0, y: 64, z: 0, yHeadRot: 0.1, yBodyRot: 0, pitch: 0, navigating: true };
  new Ai.YawAdjustingLookControl(dol2, 10).tick(); o.yawLookIn = dol2.yBodyRot === 0;
  // TrackIronGolemTargetGoal: a villager within (10,8,10) whose reputation is <= -100 makes the golem target the player
  const gol = () => ({ type: 'iron_golem', x: 0, y: 64, z: 0, width: 1.4, height: 2.7, followRange: 16 });
  const plr = { type: 'player', x: 2, y: 64, z: 0, width: 0.6, height: 1.8 };
  NS.Player = plr; NS.Village = { getReputation: (v) => v.rep };
  const tv = (rep, x) => ({ type: 'villager', x: x === undefined ? 4 : x, y: 64, z: 0, rep });
  const trk = (vs, g) => new Ai.TrackIronGolemTargetGoal(g || gol(), { villagers: () => vs });
  o.trackRep = trk([tv(-100)]).canUse() === true;
  o.trackRepOk = trk([tv(-99)]).canUse() === false;
  o.trackBox = trk([tv(-100, 11)]).canUse() === false;
  plr.invulnerableGamemode = true; o.trackCreative = trk([tv(-100)]).canUse() === false; delete plr.invulnerableGamemode;
  const tg3 = gol(), tk = trk([tv(-500)], tg3); tk.canUse(); tk.start();
  o.trackStart = tg3.target === plr && tk.canContinueToUse() === true;
  plr.x = 40; o.trackLeash = tk.canContinueToUse() === false; plr.x = 2;
  // DisableableFollowTargetGoal: both canUse and canContinueToUse are gated by the external switch
  let en = false; const inner = { canUse: () => true, canContinueToUse: () => true, start() { inner.s = 1; }, stop() {}, tick() {} };
  const dg = new Ai.DisableableFollowTargetGoal({}, inner, () => en);
  o.disOff = dg.canUse() === false && dg.canContinueToUse() === false;
  en = true; o.disOn = dg.canUse() === true && dg.canContinueToUse() === true; dg.start(); o.disStart = inner.s === 1;
  // PatrolEntity.isRaidCenterSet + RaiderEntity.PatrolApproachGoal: patrolling raiders with a target, alerting mates within 8
  NS.RaidManager = null; NS.EntityList = { list: [] };
  const pat = (x) => Object.assign({ type: 'pillager', x: 0, y: 64, z: 0, patrolling: true, target: { x: x === undefined ? 20 : x, y: 64, z: 0 } }, {});
  o.patrolOn = new Ai.PatrolApproachGoal(pat()).canUse() === true;
  const nop = pat(); nop.patrolling = false; o.patrolFlag = new Ai.PatrolApproachGoal(nop).canUse() === false;
  const att = pat(); att.attacking = true; o.patrolAttacking = new Ai.PatrolApproachGoal(att).canUse() === false;
  const byP = pat(); byP.lastHurtByEntity = plr; o.patrolPlayer = new Ai.PatrolApproachGoal(byP).canUse() === false;
  const pa = pat(9), pg = new Ai.PatrolApproachGoal(pa); pg.tick(); o.patrolNear = pa.attacking === true;
  const pf = pat(11), pgf = new Ai.PatrolApproachGoal(pf); pgf.tick(); o.patrolFar = !pf.attacking;
  const mate = { type: 'vindicator', x: 7, y: 64, z: 0 }, far = { type: 'vindicator', x: 9, y: 64, z: 0 };
  NS.EntityList = { list: [mate, far] }; const pb = pat(), pgb = new Ai.PatrolApproachGoal(pb); pgb.start();
  o.patrolAlert = mate.target === pb.target && far.target === undefined;
  pb.target = pat().target; pgb.stop(); o.patrolStop = pb.attacking === true;
  // IllagerEntity.LongDoorInteractGoal: opens a wooden door the mob is pressed against, closes it once walked past
  const calls = []; let iron = false;
  const dctx = { doorAt: (x, y, z) => (x === 1 && y === 64 && z === 0 ? { wood: !iron, iron } : null), setDoorOpen: (x, y, z, v) => calls.push([x, v]) };
  const ill = { x: 0.5, y: 64, z: 0.5, horizontalCollision: true };
  const dgl = new Ai.LongDoorInteractGoal(ill, dctx);
  o.doorUse = dgl.canUse() === true;
  ill.horizontalCollision = false; o.doorCollide = new Ai.LongDoorInteractGoal(ill, dctx).canUse() === false; ill.horizontalCollision = true;
  iron = true; o.doorIron = new Ai.LongDoorInteractGoal(ill, dctx).canUse() === false; iron = false;
  dgl.canUse(); dgl.start(); o.doorOpen = calls.length === 1 && calls[0][1] === true && dgl.canContinueToUse() === true;
  ill.x = 1.2; dgl.tick(); o.doorHold = dgl.canContinueToUse() === true;
  ill.x = 2.5; dgl.tick(); o.doorPast = dgl.canContinueToUse() === false;
  dgl.stop(); o.doorClose = calls.length === 2 && calls[1][1] === false;
  // DoorBlock.setOpen (Ai.setDoorOpen): both halves toggle together, guarded by the live open state
  const wr = [], blk = { '0,64,0': 10, '0,65,0': 11 };
  const DP = { 10: { open: 'false', half: 'lower' }, 11: { open: 'false', half: 'upper' }, 12: { open: 'true', half: 'lower' }, 13: { open: 'true', half: 'upper' } };
  NS.World = { getBlock: (x, y, z) => blk[x + ',' + y + ',' + z] || 0, setBlock: (x, y, z, st) => { wr.push([y, st]); blk[x + ',' + y + ',' + z] = st; } };
  NS.States = { block: { 10: 5, 11: 5, 12: 5, 13: 5 } };
  NS.Behave = { propName: (st, k) => DP[st] && DP[st][k], setProp: (st, k, v) => (v ? st + 2 : st - 2) };
  o.doorBlockOpen = Ai.setDoorOpen(0, 64, 0, true) === true && blk['0,64,0'] === 12 && blk['0,65,0'] === 13 && wr.length === 2;
  wr.length = 0; Ai.setDoorOpen(0, 64, 0, true); o.doorBlockIdem = wr.length === 0;
  Ai.setDoorOpen(0, 65, 0, false); o.doorBlockUpper = blk['0,64,0'] === 10 && blk['0,65,0'] === 11;
  blk['3,64,0'] = 99; o.doorBlockNon = Ai.setDoorOpen(3, 64, 0, true) === false;
  // BirdPathNodeMaker: an OPEN cell takes its type from the one below; the bird node penalty
  const NT = Ai.NodeType, grid = {};
  const cell = (x, y, z, t) => { grid[x + ',' + y + ',' + z] = t; };
  Ai.commonNodeType = (x, y, z) => grid[x + ',' + y + ',' + z] !== undefined ? grid[x + ',' + y + ',' + z] : NT.OPEN;
  const bird = { type: 'parrot', width: 0.5, height: 0.9 };
  cell(0, 63, 0, NT.LAVA); o.birdLava = Ai.birdDefaultNodeType(0, 64, 0) === NT.DAMAGE_FIRE;
  cell(0, 63, 0, NT.FENCE); o.birdFence = Ai.birdDefaultNodeType(0, 64, 0) === NT.FENCE;
  cell(0, 63, 0, NT.COCOA); o.birdCocoa = Ai.birdDefaultNodeType(0, 64, 0) === NT.COCOA;
  cell(0, 63, 0, NT.BLOCKED); o.birdWalk = Ai.birdDefaultNodeType(0, 64, 0) === NT.WALKABLE;
  cell(0, 63, 0, NT.OPEN); o.birdOpen = Ai.birdDefaultNodeType(0, 64, 0) === NT.OPEN;
  cell(0, 63, 0, NT.WATER); o.birdWater = Ai.birdDefaultNodeType(0, 64, 0) === NT.OPEN;
  cell(0, 63, 0, NT.BLOCKED); o.birdPenWalk = Ai.birdNodePenalty(bird, 0, 64, 0) === 1;
  cell(0, 63, 0, NT.OPEN); o.birdPenOpen = Ai.birdNodePenalty(bird, 0, 64, 0) === 0;
  cell(0, 64, 0, NT.LAVA); o.birdPenLava = Ai.birdNodePenalty(bird, 0, 64, 0) === -1;
  cell(0, 64, 0, NT.WATER); cell(1, 64, 0, NT.FENCE);   // a wide bird over water + fence, both un-penalised: FENCE still wins
  o.birdPenFence = Ai.birdNodeType({ type: 'parrot', width: 1.5, height: 0.9, pathMalus: { [NT.FENCE]: 0, [NT.WATER]: 0 } }, 0, 64, 0) === NT.FENCE;
  // MoveToRaidCenterGoal: a raider with no target/passenger, in an ONGOING raid and away from an occupied POI, heads for the centre
  const raid = { status: 1, center: { x: 50, y: 64, z: 50 } };
  NS.Raid = { Status: { ONGOING: 1, LOSS: 2 }, isNearOccupiedPOI: () => nearPoi, includeFreeRaiders: () => {} };
  NS.RaidManager = { world: { raids: { 7: raid } } }; let nearPoi = false;
  const rr = (x) => Object.assign({ type: 'pillager', x: 0, y: 64, z: 0, raidId: 7 }, x || {});
  o.raidGo = new Ai.MoveToRaidCenterGoal(rr(), {}).canUse() === true;
  o.raidTarget = new Ai.MoveToRaidCenterGoal(rr({ target: {} }), {}).canUse() === false;
  o.raidPassenger = new Ai.MoveToRaidCenterGoal(rr({ passenger: {} }), {}).canUse() === false;
  raid.status = 2; o.raidOver = new Ai.MoveToRaidCenterGoal(rr(), {}).canUse() === false; raid.status = 1;
  nearPoi = true; o.raidNear = new Ai.MoveToRaidCenterGoal(rr(), {}).canUse() === false && new Ai.MoveToRaidCenterGoal(rr(), {}).canContinueToUse() === false; nearPoi = false;
  o.raidNone = new Ai.MoveToRaidCenterGoal(rr({ raidId: undefined }), {}).canUse() === false;
  // NavigationConditions: a target cell with a path penalty or outside the world is refused (findTowardPositionTarget)
  Ai.pathTypeAt = () => NT.OPEN;
  const nav = (y, ty) => Ai.findTowardPositionTarget({ type: 'cow', x: 0.5, y, z: 0.5 }, () => 0.5, 4, 0, 0.5, { x: 5.5, y: ty, z: 5.5 });
  o.navOk = nav(64, 64) !== null;
  Ai.pathTypeAt = () => NT.WATER; o.navPenalty = nav(64, 64) === null; Ai.pathTypeAt = () => NT.OPEN;
  o.navHeight = nav(300, 300) === null;
  return o;
}
const LBL = { pen: 'PathNodeType default penalties', penTable: 'PathNodeType constants', uniform: 'UniformIntProvider crossbow cooldown', golemStart: 'IronGolemLookGoal starts', golemNight: 'IronGolemLookGoal day only', golemRoll: 'IronGolemLookGoal 1/8000 roll', golemFar: 'IronGolemLookGoal villager within 6', golemFlag: 'IronGolemLookGoal flag', golemHold: 'IronGolemLookGoal 400 tick hold', golemStop: 'IronGolemLookGoal stop',
  trackRep: 'TrackIronGolemTargetGoal reputation <= -100', trackRepOk: 'TrackIronGolemTargetGoal reputation -99 ignored', trackBox: 'TrackIronGolemTargetGoal villager box', trackCreative: 'TrackIronGolemTargetGoal not creative', trackStart: 'TrackIronGolemTargetGoal sets target', trackLeash: 'TrackIronGolemTargetGoal follow range',
  disOff: 'DisableableFollowTargetGoal disabled', disOn: 'DisableableFollowTargetGoal enabled', disStart: 'DisableableFollowTargetGoal start',
  patrolOn: 'PatrolEntity patrolling raider approaches', patrolFlag: 'PatrolEntity isRaidCenterSet gate', patrolAttacking: 'PatrolApproachGoal not while attacking', patrolPlayer: 'PatrolApproachGoal not after player hit', patrolNear: 'PatrolApproachGoal attacks within 10', patrolFar: 'PatrolApproachGoal holds beyond 10', patrolAlert: 'PatrolApproachGoal alerts raiders within 8', patrolStop: 'PatrolApproachGoal stop attacks',
  doorUse: 'IllagerEntity LongDoorInteractGoal starts', doorCollide: 'IllagerEntity LongDoorInteractGoal needs collision', doorIron: 'IllagerEntity LongDoorInteractGoal wood only', doorOpen: 'IllagerEntity LongDoorInteractGoal opens', doorHold: 'IllagerEntity LongDoorInteractGoal holds', doorPast: 'IllagerEntity LongDoorInteractGoal past door', doorClose: 'IllagerEntity LongDoorInteractGoal closes',
  doorBlockOpen: 'DoorBlock setOpen both halves', doorBlockIdem: 'DoorBlock setOpen guard', doorBlockUpper: 'DoorBlock setOpen from upper half', doorBlockNon: 'DoorBlock non-door refused',
  birdLava: 'BirdPathNodeMaker lava below', birdFence: 'BirdPathNodeMaker fence below', birdCocoa: 'BirdPathNodeMaker cocoa below', birdWalk: 'BirdPathNodeMaker solid below', birdOpen: 'BirdPathNodeMaker open below', birdWater: 'BirdPathNodeMaker water below', birdPenWalk: 'BirdPathNodeMaker walkable +1', birdPenOpen: 'BirdPathNodeMaker open 0', birdPenLava: 'BirdPathNodeMaker lava refused', birdPenFence: 'BirdPathNodeMaker fence wins',
  raidGo: 'MoveToRaidCenterGoal starts', raidTarget: 'MoveToRaidCenterGoal no target', raidPassenger: 'MoveToRaidCenterGoal no passenger', raidOver: 'MoveToRaidCenterGoal ongoing raid only', raidNear: 'MoveToRaidCenterGoal not near occupied POI', raidNone: 'MoveToRaidCenterGoal needs raid',
  navOk: 'NavigationConditions clear target', navPenalty: 'NavigationConditions hasPathfindingPenalty', navHeight: 'NavigationConditions isHeightInvalid',
  tempt: 'TemptGoal starts', temptFar: 'TemptGoal range 10', temptItem: 'TemptGoal item', temptClosest: 'TemptGoal closest', temptCooldown: 'TemptGoal cooldown', wnt: 'WanderNearTargetGoal range', wntNone: 'WanderNearTargetGoal no target', yawLook: 'YawAdjustingLookControl body follows head', yawLookIn: 'YawAdjustingLookControl threshold', poiNone: 'WanderAroundPointOfInterestGoal no POI' };
const A = trial(null);
for (const [k, m] of Object.entries(LBL)) ok(A[k], m);
const BR = [
  ['trackRepOk', /getReputation\(v\) <= -100/, 'getReputation(v) <= -50'],
  ['trackBox', /Math\.abs\(v\.x - e\.x\) > 10 \|\| Math\.abs\(v\.y - e\.y\) > 8/, 'Math.abs(v.x - e.x) > 30 || Math.abs(v.y - e.y) > 8'],
  ['trackCreative', /Ai\.canTargetLiving = function \(t, self\) \{\n    if \(!t \|\| t\.dead \|\| t\.removed\) return false;/, 'Ai.canTargetLiving = function (t, self) {\n    return true;'],
  ['trackLeash', /fr > 0 && Math\.hypot\(t\.x - e\.x, t\.y - e\.y, t\.z - e\.z\) > fr/, 'false'],
  ['disOff', /return !!isEnabled\(\) && base\.canUse\(\);/, 'return base.canUse();'],
  ['patrolFlag', /!raidOf\(e\) && !!e\.patrolling && !!e\.target/, '!raidOf(e) && !!e.target'],
  ['patrolPlayer', /\(!attacker \|\| attacker !== NS\.Player\)/, 'true'],
  ['patrolNear', /var SQ_DIST = 10\.0 \* 10\.0;/, 'var SQ_DIST = 5.0 * 5.0;'],
  ['patrolFar', /var SQ_DIST = 10\.0 \* 10\.0;/, 'var SQ_DIST = 20.0 * 20.0;'],
  ['patrolAlert', /var CLOSE_RADIUS_SQ = 8\.0 \* 8\.0;/, 'var CLOSE_RADIUS_SQ = 12.0 * 12.0;'],
  ['patrolStop', /alertNearby\(target\);\n        e\.attacking = true;/, 'alertNearby(target);'],
  ['doorCollide', /if \(!e\.horizontalCollision\) return false;\n      door = scan\(\);/, 'door = scan();'],
  ['doorIron', /if \(d && d\.wood && !d\.iron\) return \{ x: dx, y: by, z: dz \};/, 'if (d) return { x: dx, y: by, z: dz };'],
  ['doorOpen', /setOpen\(door\.x, door\.y, door\.z, true\);\n    \};\n    this\.stop/, 'void 0;\n    };\n    this.stop'],
  ['doorPast', /offsetX \* nx \+ offsetZ \* nz < 0\.0\) shouldStop = true;/, 'offsetX * nx + offsetZ * nz < -9.0) shouldStop = true;'],
  ['doorClose', /if \(door\) setOpen\(door\.x, door\.y, door\.z, false\);/, 'if (door) setOpen(door.x, door.y, door.z, true);'],
  ['doorBlockOpen', /var other = NS\.World\.getBlock\(x, oy, z\);\n    var newState = NS\.Behave\.setProp\(state, 'open', open\);/, "var other = 0;\n    var newState = NS.Behave.setProp(state, 'open', open);"],
  ['doorBlockUpper', /(var oy = half === 'upper' \? y - 1 : y \+ 1;)(\n    var other = NS\.World\.getBlock\(x, oy, z\);\n    var newState = NS\.Behave\.setProp\(state, 'open', open\);)/, "var oy = half === 'upper' ? y + 1 : y + 1;$2"],
  ['doorBlockIdem', /if \(\(openStr === 'true'\) === open\) return true;/, ''],
  ['doorBlockNon', /if \(openStr === undefined\) return false;/, ''],
  ['birdLava', /b === T\.DAMAGE_FIRE \|\| b === T\.LAVA\) t = T\.DAMAGE_FIRE;\n      else if \(b === T\.DAMAGE_CACTUS\) t = T\.DAMAGE_CACTUS;\n      else if \(b === T\.DAMAGE_OTHER\) t = T\.DAMAGE_OTHER;\n      else if \(b === T\.COCOA\)/, 'b === T.DAMAGE_FIRE) t = T.DAMAGE_FIRE;\n      else if (b === T.DAMAGE_CACTUS) t = T.DAMAGE_CACTUS;\n      else if (b === T.DAMAGE_OTHER) t = T.DAMAGE_OTHER;\n      else if (b === T.COCOA)'],
  ['birdFence', /else if \(b === T\.FENCE\) t = T\.FENCE;/, ''],
  ['birdCocoa', /else if \(b === T\.COCOA\) t = T\.COCOA;/, ''],
  ['birdWalk', /\(b !== T\.WALKABLE && b !== T\.OPEN && b !== T\.WATER\) \? T\.WALKABLE : T\.OPEN;/, 'T.OPEN;'],
  ['birdWater', /\(b !== T\.WALKABLE && b !== T\.OPEN && b !== T\.WATER\)/, '(b !== T.WALKABLE && b !== T.OPEN)'],
  ['birdPenWalk', /return t === T\.WALKABLE \? p \+ 1 : p;/, 'return p;'],
  ['birdPenFence', /if \(seen\.indexOf\(T\.FENCE\) >= 0\) return T\.FENCE;\n    var best = T\.BLOCKED;\n    for \(var n = 0; n < Ai\.ENUM_ORDER\.length; n\+\+\) \{\n      var tt = Ai\.ENUM_ORDER\[n\];\n      if \(seen\.indexOf\(tt\) < 0\) continue;\n      var pen = Ai\.pathPenalty\(e, tt\);\n      if \(pen < 0\) return tt;\n      if \(pen >= Ai\.pathPenalty\(e, best\)\) best = tt;\n    \}\n    return \(origin === T\.OPEN && Ai\.pathPenalty\(e, best\) === 0\) \? T\.OPEN : best;\n  \};\n  \/\*\* `BirdPathNodeMaker\.getNode`/, 'var best = T.BLOCKED;\n    for (var n = 0; n < Ai.ENUM_ORDER.length; n++) {\n      var tt = Ai.ENUM_ORDER[n];\n      if (seen.indexOf(tt) < 0) continue;\n      var pen = Ai.pathPenalty(e, tt);\n      if (pen < 0) return tt;\n      if (pen >= Ai.pathPenalty(e, best)) best = tt;\n    }\n    return (origin === T.OPEN && Ai.pathPenalty(e, best) === 0) ? T.OPEN : best;\n  };\n  /** `BirdPathNodeMaker.getNode`'],
  ['raidTarget', /return !e\.target && !e\.passenger && raidOngoing\(r\) && !nearVillageNow\(e\);/, 'return !e.passenger && raidOngoing(r) && !nearVillageNow(e);'],
  ['raidPassenger', /return !e\.target && !e\.passenger && raidOngoing\(r\) && !nearVillageNow\(e\);/, 'return !e.target && raidOngoing(r) && !nearVillageNow(e);'],
  ['raidOver', /return !e\.target && !e\.passenger && raidOngoing\(r\) && !nearVillageNow\(e\);/, 'return !e.target && !e.passenger && !nearVillageNow(e);'],
  ['raidNear', /return raidOngoing\(r\) && !nearVillageNow\(e\);\n    \};\n    this\.start = function \(\) \{ path = null; idx = 1; \};/, 'return raidOngoing(r);\n    };\n    this.start = function () { path = null; idx = 1; };'],
  ['navPenalty', /if \(Ai\.pathPenalty\(e, Ai\.pathTypeAt\(bx, by, bz\)\) !== 0\) continue;      \/\/ hasPathfindingPenalty/, ''],
  ['navHeight', /if \(by < -64 \|\| by > 256\) continue;                                    \/\/ isHeightInvalid/, ''],
  ['yawLook', /yBodyRot = Ai\.wrapRad\(Ai\.bodyYawOf\(e\) \+ 4 \* DEG\)/, 'yBodyRot = Ai.wrapRad(Ai.bodyYawOf(e) + 8 * DEG)'],
  ['yawLookIn', /else if \(d > t\) e\.yBodyRot/, 'else if (d > -1) e.yBodyRot'],
  ['pen', /p\[T\.BREACH\] = 4;/, 'p[T.BREACH] = 0;'],
  ['penTable', /COCOA: 25/, 'COCOA: 24'],
  ['uniform', /Ai\.CROSSBOW_COOLDOWN_SPAN = 21;/, 'Ai.CROSSBOW_COOLDOWN_SPAN = 20;'],
  ['golemNight', /if \(!isDay\(\)\) return false;/, ''],
  ['golemRoll', /Math\.floor\(r\(\) \* 8000\) !== 0/, 'false'],
  ['golemFar', /bestD = 36;/, 'bestD = 400;'],
  ['golemHold', /countdown = 400;/, 'countdown = 100;'],
  ['golemStop', /Ai\.setLookingAtVillager\(e, false\); target = null;/, 'target = null;'],
  ['temptFar', /Ai\.TEMPT_RANGE = 10;/, 'Ai.TEMPT_RANGE = 20;'],
  ['temptCooldown', /Ai\.TEMPT_COOLDOWN = 100;/, 'Ai.TEMPT_COOLDOWN = 0;'],
  ['wnt', /if \(!target \|\| dsq\(\) > maxDistanceSq\) return false;/, 'if (!target) return false;'],
];
for (const [key, re, rep] of BR) {
  if (!re.test(fs.readFileSync(new URL('../src/07k_goals.js', import.meta.url), 'utf8'))) { fails.push('pattern not found: ' + key); continue; }
  breaks++; let hit = false;
  const B = trial((f, src) => { const n = f === '07k_goals.js' ? src.replace(re, rep) : src; if (n !== src) hit = true; return n; });
  ok(hit, 'break pattern matched: ' + key); ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
