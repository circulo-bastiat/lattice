// 07zj2_dolphin.js — #716: DolphinEntity's goals, air/moistness bookkeeping and AquaticMoveControl travel.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// .decomp/net/minecraft/entity/passive/DolphinEntity.java (read whole) and, for the goals it names,
// ai/goal/{BreatheAirGoal,MoveIntoWaterGoal,DolphinJumpGoal,ChaseBoatGoal}.java + ai/control/AquaticMoveControl.java.
// `Ai.ROSTER.dolphin` (07k_goals.js) builds the selector from these classes plus the generic Ai goals
// (SwimAround = Ai.WanderAroundGoal, LookAround, LookAt(Player,6), Melee(1.2), Flee(Guardian,8,1,1), Revenge).
//
// OWED (named, not guessed): LeadToNearbyTreasureGoal never finds a structure (`locateStructure` of the
// ocean-ruin/shipwreck tag has no runtime entry point, so noPathToStructure=true and GotFish is spent, exactly
// vanilla's "no structure within 50" branch); the water A* is Ai.findSwimPath (cell-centre water test, no WaterPathNodeMaker node types);
// sounds, particles, NBT and the rendered pitch are not modelled.
(function (NS) {
  'use strict';
  var Dol = NS.Dolphin = NS.Dolphin || { ready: false };
  Dol.MAX_AIR = 4800; Dol.MAX_MOISTNESS = 2400;
  Dol.init = function () { Dol.ready = !!(NS.EntityList && NS.EntityList.ready && NS.Ai); return Dol; };
  var D2R = Math.PI / 180;

  function rnd() { return (NS.EntityList && NS.EntityList.random) || Math.random; }
  function rint(n) { return Math.floor(rnd()() * n); }
  function stateAt(x, y, z) { return NS.World.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)); }
  function waterAt(x, y, z) { var st = stateAt(x, y, z); return st > 0 && (NS.States.block[st] === NS.Reg.id.water || !!NS.States.waterIn[st]); }   // getFluidState().isIn(WATER) (D-168)
  /** BreatheAirGoal.isAirPos: fluid-empty (or bubble_column) and passable */
  function airAt(x, y, z) {
    var st = stateAt(x, y, z);
    if (st === 0) return true;
    var b = NS.States.block[st];
    if (b === NS.Reg.id.bubble_column) return true;
    return !NS.States.waterIn[st] && b !== NS.Reg.id.lava && !(NS.Physics && NS.Physics.solidAt && NS.Physics.solidAt(x, y, z));
  }
  function isAir(x, y, z) { return !!NS.States.isAir[stateAt(x, y, z)]; }
  /** `Entity.getMovementDirection()` -> horizontal unit offsets (engine yaw: forward = (sin y, -cos y)). */
  function facing(e) {
    var fx = Math.sin(e.yaw || 0), fz = -Math.cos(e.yaw || 0);
    return Math.abs(fx) > Math.abs(fz) ? { x: fx > 0 ? 1 : -1, z: 0 } : { x: 0, z: fz > 0 ? 1 : -1 };
  }
  function init(e) {
    if (e.air === undefined) e.air = Dol.MAX_AIR;
    if (e.moistness === undefined) e.moistness = Dol.MAX_MOISTNESS;
    if (e.pitch === undefined) e.pitch = 0;
    if (e.hasFish === undefined) e.hasFish = false;
  }
  Dol.init1 = init;
  function moveTo(e, x, y, z, speed) {   // `EntityNavigation.startMovingTo(x,y,z,speed)` -> the engine's own A*
    // SwimNavigation: 6-connected water A* (Ai.findSwimPath) while swimming; the walking A* only out of water / no swim route
    var p = e.inWater ? NS.Ai.findSwimPath(e.x, e.y, e.z, x, y, z, { partial: true, breach: true, box: { w: 0.9, h: 0.6 } }) : null;
    if (!p || p.length < 2) p = NS.Ai.findPath(e.x, e.y, e.z, x, y, z, { mob: e, partial: true });
    e.dolPath = p && p.length > 1 ? { p: p, i: 1, speed: speed } : null;
  }
  function stopNav(e) { e.dolPath = null; }
  /** the goal-driven walk of `e.dolPath` (what the navigation's own tick does each tick) */
  function followPath(e) {
    var n = e.dolPath;
    if (!n) return;
    if (n.i >= n.p.length) { e.dolPath = null; return; }
    NS.Ai.stepToward(e, n.p[n.i], n.speed);
    n.i = NS.Ai.advancePathNode(e, n.p, n.i);
  }
  function nearItems(e) {   // CAN_TAKE within expand(8)
    var out = [], L = NS.EntityList.list;
    for (var i = 0; i < L.length; i++) {
      var o = L[i];
      if (o.type !== 'item' || o.removed || o.dead) continue;
      if (!o.inWater || (o.pickupDelay | 0) > 0) continue;   // CAN_TAKE: !cannotPickup && alive && touching water
      var hw = (e.width || 0.9) * 0.5 + 8, h = e.height || 0.6;   // getBoundingBox().expand(8): y in [e.y-8, e.y+h+8]
      if (Math.abs(o.x - e.x) <= hw + 0.125 && o.y + 0.25 >= e.y - 8 && o.y <= e.y + h + 8 && Math.abs(o.z - e.z) <= hw + 0.125) out.push(o);
    }
    return out;
  }

  /** `DolphinEntity.loot`: main hand only, and only while empty; drop chance 2.0 (guaranteed). */
  Dol.loot = function (e, itemEntity) {
    var Eq = NS.Equip, IT = NS.Items;
    if (!Eq || !IT || Eq.getEquipped(e, IT.MAINHAND)) return false;
    var name = IT.nameOf(itemEntity.item), stack = name && Eq.stackOf(name);
    if (!stack) return false;
    if (Eq.preferredSlot(stack) !== IT.MAINHAND) return false;   // canEquip: preferred slot must be MAINHAND
    stack.n = itemEntity.count || 1;
    if (itemEntity.tag) stack.t = itemEntity.tag;
    if (itemEntity.d) stack.d = itemEntity.d;
    Eq.setEquipped(e, IT.MAINHAND, stack);
    Eq.setDropChance(e, IT.MAINHAND, 2.0);
    Eq.triggerPickedUp(e, itemEntity);
    NS.EntityList.remove(itemEntity);
    return true;
  };

  // ── priority 0 — BreatheAirGoal (MOVE|LOOK): air < 140, swim up to the first air cell within 8 above.
  Dol.BreatheAirGoal = function (e) {
    this.canStop = function () { return false; };   // vanilla canStop() == false
    function go() {
      var x0 = Math.floor(e.x - 1), x1 = Math.floor(e.x + 1), z0 = Math.floor(e.z - 1), z1 = Math.floor(e.z + 1);
      var y0 = Math.floor(e.y), y1 = Math.floor(e.y + 8), t = null;
      for (var z = z0; z <= z1 && !t; z++) for (var y = y0; y <= y1 && !t; y++) for (var x = x0; x <= x1; x++) {
        if (airAt(x, y, z)) { t = { x: x, y: y, z: z }; break; }
      }
      if (!t) t = { x: Math.floor(e.x), y: Math.floor(e.y + 8), z: Math.floor(e.z) };
      moveTo(e, t.x, t.y + 1, t.z, 1.0);
    }
    this.canUse = function () { init(e); return e.air < 140; };
    this.canContinueToUse = this.canUse;
    this.start = go;
    this.stop = function () {};
    this.tick = function () {   // moveToAir + updateVelocity(0.02F, last tick's mob input) + an EXTRA move(velocity), on top of travel()
      go();
      var Ph = NS.Physics, fwd = e.dolFwd || 0, up = e.dolUp || 0, len = fwd * fwd + up * up;
      if (len >= 1e-7) {
        var k = 0.02 / (len > 1 ? Math.sqrt(len) : 1);
        e.vx = (e.vx || 0) + fwd * k * Math.sin(e.yaw || 0);
        e.vz = (e.vz || 0) - fwd * k * Math.cos(e.yaw || 0);
        e.vy = (e.vy || 0) + up * k;
      }
      if (Ph && Ph.move) Ph.move(e, e.vx || 0, e.vy || 0, e.vz || 0);
    };
  };

  // ── priority 0 — MoveIntoWaterGoal (no flags): on the ground outside water, aim the MoveControl at the nearest
  // water cell within (±2, y-2..y, ±2). AquaticMoveControl only acts on it while a navigation runs, as in the jar.
  Dol.MoveIntoWaterGoal = function (e) {
    this.canUse = function () { return !!e.onGround && !waterAt(e.x, e.y, e.z); };
    this.canContinueToUse = this.canUse;
    this.start = function () {
      var y1 = Math.floor(e.y), t = null;
      for (var z = Math.floor(e.z - 2); z <= Math.floor(e.z + 2) && !t; z++) for (var y = Math.floor(e.y - 2); y <= y1 && !t; y++)
        for (var x = Math.floor(e.x - 2); x <= Math.floor(e.x + 2); x++) if (waterAt(x, y, z)) { t = { x: x, y: y, z: z }; break; }
      if (t) { e.dolMoveTo = { x: t.x, y: t.y, z: t.z, speed: 1.0 }; }
    };
    this.stop = function () {};
    this.tick = function () {};
  };

  // ── priority 1 — LeadToNearbyTreasureGoal (MOVE|LOOK, canStop false): needs GotFish and air >= 100.
  Dol.LeadToNearbyTreasureGoal = function (e) {
    this.canStop = function () { return false; };   // vanilla canStop() == false
    var noPath = false;
    // BlockPos(tx, dolphin.getY(), tz).isWithinDistance(getPos(), 4.0): squared distance from the block CENTRE, Y included (floor(y)+0.5-y)
    function within4(t) { var dx = t.x + 0.5 - e.x, dy = Math.floor(e.y) + 0.5 - e.y, dz = t.z + 0.5 - e.z; return dx * dx + dy * dy + dz * dz < 16; }
    this.canUse = function () { init(e); return !!e.hasFish && e.air >= 100; };
    this.canContinueToUse = function () {
      var t = e.dolTreasure; if (!t) return false;
      return !within4(t) && !noPath && e.air >= 100;
    };
    this.start = function () {
      noPath = false; stopNav(e);
      var loc = NS.Dolphin.locateTreasure ? NS.Dolphin.locateTreasure(e) : null;   // OWED: no runtime structure locate
      if (loc) e.dolTreasure = loc; else noPath = true;
    };
    this.stop = function () {
      var t = e.dolTreasure, near = false;
      if (t) near = within4(t);
      if (near || noPath) e.hasFish = false;
    };
    this.tick = function () {
      var t = e.dolTreasure; if (!t) { noPath = true; return; }
      var np = e.dolPath && e.dolPath.p, tp = np && np[np.length - 1];
      var near = !!tp && (tp.x + 0.5 - e.x) * (tp.x + 0.5 - e.x) + (tp.y + 0.5 - e.y) * (tp.y + 0.5 - e.y) + (tp.z + 0.5 - e.z) * (tp.z + 0.5 - e.z) < 144;   // isNearTarget: nav target within 12
      if (!(near || !e.dolPath)) return;
      var c = { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 }, A = NS.Ai, r = rnd();
      var p = A.findTowardPositionTarget(e, r, 16, 1, Math.PI / 8, c) || A.findTowardPositionTarget(e, r, 8, 4, Math.PI / 2, c);
      if (p && !(waterAt(p.x, p.y, p.z) && !(NS.Physics && NS.Physics.solidAt && NS.Physics.solidAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))))) p = A.findTowardPositionTarget(e, r, 8, 5, Math.PI / 2, c);
      if (!p) { noPath = true; return; }
      if (e.look) e.look.setLookAt(p.x, p.y, p.z, 21 * D2R, 1 * D2R);   // getMaxHeadRotation()+20, getMaxLookPitchChange()
      moveTo(e, p.x, p.y, p.z, 1.3);
      if (rint(80) === 0) e.dolHappy = (e.dolHappy | 0) + 1;   // sendEntityStatus(38): happy_villager particles (no status channel here; counted)
    };
  };

  // ── priority 2 — SwimWithPlayerGoal(4.0): a swimming player within 10 gets Dolphin's Grace.
  /** `SwimAroundGoal(1.0, 10)` = `WanderAroundGoal(chance 10)` + `getWanderTarget() = LookTargetUtil.find(mob, 10, 7)`. */
  Dol.SwimAroundGoal = function (e, speed, chance) {
    var tgt = null;
    this.chance = chance; this.finder = 'LookTargetUtil.find(10,7)';
    this.canUse = function () {
      if (e.passenger) return false;
      if ((e.despawnCounter | 0) >= 100) return false;
      if (rint(chance) !== 0) return false;
      tgt = NS.Fish.fuzzFind(e, 10, 7, true);
      return !!tgt;
    };
    this.canContinueToUse = function () { return !!e.dolPath; };
    this.start = function () { moveTo(e, tgt.x, tgt.y, tgt.z, speed); };
    this.stop = function () { stopNav(e); };
    this.tick = function () {};
  };
  Dol.SwimWithPlayerGoal = function (e, speed) {
    var pl = null;
    function closest() {
      var P = NS.Player; if (!P) return null;
      var dx = P.x - e.x, dy = P.y - e.y, dz = P.z - e.z;
      return dx * dx + dy * dy + dz * dz <= 100 ? P : null;   // CLOSE_PLAYER_PREDICATE: createNonAttackable, 10, ignoreVisibility
    }
    function grace(P) { if (NS.Effects && NS.Effects.addStatusEffect) NS.Effects.addStatusEffect(P, 'dolphins_grace', 100, 0, false, true); }
    this.canUse = function () { pl = closest(); return !!pl && !!pl.swimming && e.target !== pl; };
    this.canContinueToUse = function () {
      if (!pl || !pl.swimming) return false;
      var dx = pl.x - e.x, dy = pl.y - e.y, dz = pl.z - e.z;
      return dx * dx + dy * dy + dz * dz < 256;
    };
    this.start = function () { grace(pl); };
    this.stop = function () { pl = null; stopNav(e); };
    this.tick = function () {
      if (e.look) e.look.setLookAt(pl.x, pl.y + (pl.eyeHeight || 1.62), pl.z, 21 * D2R, 1 * D2R);   // lookAt(player, headRot+20, pitchChange): eye position
      var dx = pl.x - e.x, dy = pl.y - e.y, dz = pl.z - e.z;
      if (dx * dx + dy * dy + dz * dz < 6.25) stopNav(e); else moveTo(e, pl.x, pl.y, pl.z, speed);
      if (pl.swimming && rint(6) === 0) grace(pl);
    };
  };

  // ── priority 5 — DolphinJumpGoal(10) (JUMP|MOVE): a 1-in-10 roll, needs water at 0,1,4,5,6,7 ahead with two air cells above.
  var OFFS = [0, 1, 4, 5, 6, 7];
  function say(e, ev) { if (NS.MobVoice && NS.MobVoice.emit) NS.MobVoice.emit(e, ev, 1.0, 1.0); }
  Dol.DolphinJumpGoal = function (e, chance) {
    this.canStop = function () { return false; };   // vanilla canStop() == false
    var inWaterNow = false;
    function fluidOk(x, y, z) { return waterAt(x, y, z) && !(NS.Physics && NS.Physics.solidAt && NS.Physics.solidAt(x, y, z)); }
    this.canUse = function () {
      if (rint(chance) !== 0) return false;
      var f = facing(e), bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      for (var i = 0; i < OFFS.length; i++) {
        var m = OFFS[i], x = bx + f.x * m, z = bz + f.z * m;
        if (!fluidOk(x, by, z) || !isAir(x, by + 1, z) || !isAir(x, by + 2, z)) return false;   // DolphinJumpGoal.isAirAbove: BlockState.isAir(), not isAirPos
      }
      return true;
    };
    this.canContinueToUse = function () {
      var vy = e.vy || 0;
      return (!(vy * vy < 0.03) || (e.pitch || 0) === 0 || !(Math.abs(e.pitch) < 10 * D2R) || !e.inWater) && !e.onGround;
    };
    this.start = function () {
      var f = facing(e);
      e.vx = (e.vx || 0) + f.x * 0.6; e.vy = (e.vy || 0) + 0.7; e.vz = (e.vz || 0) + f.z * 0.6;
      stopNav(e);
    };
    this.stop = function () { e.pitch = 0; };
    this.tick = function () {
      if (!inWaterNow) { inWaterNow = waterAt(e.x, e.y, e.z); if (inWaterNow) say(e, 'entity.dolphin.jump'); }   // tick: re-enters water
      var vy = e.vy || 0;
      if (vy * vy < 0.03 && e.pitch !== 0) e.pitch += (0 - e.pitch) * 0.2;   // lerpAngle(pitch, 0, 0.2)
      else if (Math.hypot(e.vx || 0, vy, e.vz || 0) > 1e-5) e.pitch = Math.atan2(-vy, Math.hypot(e.vx || 0, e.vz || 0));
    };
  };

  // ── priority 8 — PlayWithItemsGoal (no flags): swim to floating items, carry one, spit it back out.
  Dol.PlayWithItemsGoal = function (e) {
    var next = 0;
    function held() { var st = e.equip && e.equip[0]; return st ? { item: st.i, count: st.n, tag: st.t, d: st.d } : null; }   // main hand = slot 0
    function clear() { e.equip[0] = null; }
    function spit(st) {
      var y = e.y + 0.3 - 0.3, a = rnd()() * Math.PI * 2, s = 0.02 * rnd()(), p = e.pitch || 0;
      var sy = Math.sin(e.yaw || 0), cy = Math.cos(e.yaw || 0);
      var it = NS.EntityList.dropStack(e.x, y, e.z, st.item, st.count, { tag: st.tag, d: st.d,
        vx: 0.3 * sy * Math.cos(p) + Math.cos(a) * s, vy: 0.3 * Math.sin(p) * 1.5, vz: 0.3 * -cy * Math.cos(p) + Math.sin(a) * s, pickupDelay: 40 });
      if (it && e.uuid) it.thrower = e.uuid;
      return it;
    }
    this.canUse = function () {
      if (next > (e.age | 0)) return false;
      return nearItems(e).length > 0 || !!held();
    };
    this.canContinueToUse = this.canUse;
    this.start = function () {
      var l = nearItems(e);
      if (l.length) { say(e, 'entity.dolphin.play'); moveTo(e, l[0].x, l[0].y, l[0].z, 1.2); }
      next = 0;
    };
    this.stop = function () {
      var h = held();
      if (h) { spit(h); clear(); next = (e.age | 0) + rint(100); }
    };
    this.tick = function () {
      var h = held(), l = nearItems(e);
      if (h) { spit(h); clear(); }
      else if (l.length) moveTo(e, l[0].x, l[0].y, l[0].z, 1.2);
    };
  };

  // ── priority 8 — ChaseBoatGoal (no flags): follow a moving boat with a player aboard (ChaseBoatState GO_TO_BOAT/CIRCLE).
  Dol.ChaseBoatGoal = function (e) {
    var pass = null, state = 0, cd = 0;
    function moving(p) { var i = p && p.vehicle && p.vehicle.riderInput; return !!i && (Math.abs(i.sidewaysSpeed || 0) > 0 || Math.abs(i.forwardSpeed || 0) > 0); }   // key input, not velocity
    function boatPlayer() {
      var L = NS.EntityList.list;
      for (var i = 0; i < L.length; i++) {
        var b = L[i];
        if (b.type !== 'boat' || b.removed || !b.rider) continue;
        if (Math.abs(b.x - e.x) <= 5.3 && Math.abs(b.y - e.y) <= 5.3 && Math.abs(b.z - e.z) <= 5.3 && b.rider === NS.Player) return b.rider;
      }
      return null;
    }
    this.canUse = function () { var p = boatPlayer(); return (!!pass && moving(pass)) || moving(p); };
    this.canContinueToUse = function () { return !!pass && !!NS.Player && !!NS.Player.vehicle && moving(pass); };
    this.start = function () { pass = boatPlayer(); cd = 0; state = 0; };
    this.stop = function () { pass = null; };
    this.tick = function () {
      if (!pass) return;
      // updateVelocity(state==GO_TO_BOAT ? 0.015 : (moving ? 0.01 : 0), mob input) + move, every tick
      var sp = state === 0 ? 0.015 : (moving(pass) ? 0.01 : 0), fwd = e.dolFwd || e.zza || 0, up = e.dolUp || 0, len = fwd * fwd + up * up;
      if (len >= 1e-7) {   // Entity.updateVelocity: normalise if |input|>1, scale by speed
        var k = sp / (len > 1 ? Math.sqrt(len) : 1);
        e.vx = (e.vx || 0) + fwd * k * Math.sin(e.yaw || 0);
        e.vz = (e.vz || 0) - fwd * k * Math.cos(e.yaw || 0);
        e.vy = (e.vy || 0) + up * k;
      }
      if (NS.Physics && NS.Physics.move) NS.Physics.move(e, e.vx, e.vy || 0, e.vz);
      if (--cd <= 0) {
        cd = 10;
        var f = Math.sin(pass.yaw || 0), g = -Math.cos(pass.yaw || 0);
        var dxz = Math.abs(f) > Math.abs(g) ? { x: f > 0 ? 1 : -1, z: 0 } : { x: 0, z: g > 0 ? 1 : -1 };
        var d = Math.hypot(pass.x - e.x, pass.y - e.y, pass.z - e.z);
        if (state === 0) {
          moveTo(e, Math.floor(pass.x) - dxz.x + 0.5, Math.floor(pass.y) - 1, Math.floor(pass.z) - dxz.z + 0.5, 1.0);
          if (d < 4) { cd = 0; state = 1; }
        } else {
          moveTo(e, Math.floor(pass.x) + dxz.x * 10 + 0.5, Math.floor(pass.y) - 1, Math.floor(pass.z) + dxz.z * 10 + 0.5, 1.0);
          if (d > 12) { cd = 0; state = 0; }
        }
      }
    };
  };

  // air/moistness/dry-out: DolphinEntity.tick lives in 07zz2_dolphin.js (#718); the goals read e.air.

  /** `AquaticMoveControl(85,10,0.02F,0.1F,true)` + `DolphinEntity.travel`, one tick after the goals ran. */
  // #717's dolphinNav-driven MoveControl (07zjd_dolphin.js) stays for a dolphin that has one; the goals here use navNode.
  var travel717 = Dol.travelMob, tick717 = Dol.tickMove;
  Dol.tickMove = function (e) { if (e.dolphinNav && tick717) tick717(e); };
  Dol.travelMob = function (e) {
    if (e.dolphinNav && travel717) return travel717(e);
    init(e);
    var Ph = NS.Physics, wet = !!e.inWater;
    if (wet) e.vy = (e.vy || 0) + 0.005;   // buoyant
    var speed = 0, node, airSpeed = 0;
    followPath(e);
    node = e.navNode; e.navNode = null;
    var nav = !!e.navigating; e.navigating = false;
    var fwd = 0, up = 0;
    e.dolFwd = e.dolUp = 0;
    if (node && nav) {
      var dx = node.x + 0.5 - e.x, dy = node.y - e.y, dz = node.z + 0.5 - e.z;
      var S = e.mobSpeed || 0;
      if (dx * dx + dy * dy + dz * dz >= 2.5000003e-7) {
        e.yaw = NS.Ai.rotlerp(e.yaw || 0, Math.atan2(dx, -dz), 10 * D2R);   // wrapDegrees(yaw, target, yawChange=10)
        e.bodyYaw = e.yaw; e.headYaw = e.yaw;
        if (wet) {
          var h = Math.sqrt(dx * dx + dz * dz);
          if (Math.abs(dy) > 1e-5 || Math.abs(h) > 1e-5) {
            var want = -(Math.atan2(dy, h) * 180 / Math.PI);
            want = Math.max(-85, Math.min(85, want));
            var d = want - (e.pitch || 0) / D2R; if (d > 5) d = 5; if (d < -5) d = -5;   // wrapDegrees(pitch, want, 5)
            e.pitch = (e.pitch || 0) + d * D2R;
          }
          fwd = Math.cos(e.pitch || 0) * S * 0.98;   // LivingEntity.tickMovement forwardSpeed *= 0.98 (upward is not scaled)
          up = -Math.sin(e.pitch || 0) * S;
          speed = S * 0.02; e.dolFwd = fwd; e.dolUp = up; e.zza = Math.cos(e.pitch || 0) * S;   // forwardSpeed, kept stale for the air tick
        } else { airSpeed = S * 0.1; speed = 0; }   // vanilla: only movementSpeed is set; forwardSpeed keeps its last in-water value
      } else e.zza = 0;
    } else {
      e.zza = 0; e.mobSpeed = 0;
      // idle pitch easing (by 5 deg) lives in Ai.YawAdjustingLookControl
    }
    if (wet) {
      var len = fwd * fwd + up * up;
      if (len >= 1e-7 && speed) {
        var k = speed / (len > 1 ? Math.sqrt(len) : 1);
        e.vx = (e.vx || 0) + fwd * k * Math.sin(e.yaw || 0);
        e.vz = (e.vz || 0) + -fwd * k * Math.cos(e.yaw || 0);
        e.vy = (e.vy || 0) + up * k;
      }
      if (Ph && Ph.move) Ph.move(e, e.vx || 0, e.vy || 0, e.vz || 0);
      e.vx *= 0.9; e.vy *= 0.9; e.vz *= 0.9;
      if (!e.target) e.vy -= 0.005;
    } else if (Ph && Ph.travelMob) {
      var ms = e.mobSpeed; if (airSpeed) e.mobSpeed = airSpeed;
      Ph.travelMob(e); e.mobSpeed = ms;
    }
  };

  Dol.buildGoals = function (e, ctx) {
    var Ai = NS.Ai, gs = new Ai.GoalSelector();
    var players = ctx.players || function () { return NS.Player ? [NS.Player] : []; };
    var guardians = function () {
      var out = [], L = NS.EntityList.list;
      for (var i = 0; i < L.length; i++) { var o = L[i]; if ((o.type === 'guardian' || o.type === 'elder_guardian') && !o.removed && !o.dead) out.push(o); }
      return out;
    };
    var dolphins = ctx.animals || function () { return []; };
    gs.add(0, Ai.MOVE | Ai.LOOK, new Dol.BreatheAirGoal(e));
    gs.add(0, 0, new Dol.MoveIntoWaterGoal(e));
    gs.add(1, Ai.MOVE | Ai.LOOK, new Dol.LeadToNearbyTreasureGoal(e));
    gs.add(2, Ai.MOVE | Ai.LOOK, new Dol.SwimWithPlayerGoal(e, 4.0));
    gs.add(4, Ai.MOVE, new Dol.SwimAroundGoal(e, 1.0, 10));
    gs.add(4, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
    gs.add(5, Ai.LOOK, new Ai.LookAtPlayerGoal(e, players, 6.0));
    gs.add(5, Ai.MOVE | Ai.JUMP, new Dol.DolphinJumpGoal(e, 10));
    gs.add(6, Ai.MOVE | Ai.LOOK, new Ai.MeleeAttackGoal(e, 1.2, undefined, function (t, hit) { if (hit) say(e, 'entity.dolphin.attack'); }, undefined, true));   // DolphinEntity.tryAttack: sound only inside `if (target.damage(..))`
    gs.add(8, 0, new Dol.PlayWithItemsGoal(e));
    gs.add(8, 0, new Dol.ChaseBoatGoal(e));
    gs.add(9, Ai.MOVE, new Ai.AvoidEntityGoal(e, 8, 1.0, guardians, function () { return true; }, { fastSpeed: 1.0 }));
    gs.add(1, Ai.TARGET, new Ai.RevengeGoal(e, { animals: function () { return dolphins().filter(function (o) { return o.type === 'dolphin'; }); } },
      { group: true, noRevengeTypes: { guardian: 1, elder_guardian: 1 } }));
    return gs;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
