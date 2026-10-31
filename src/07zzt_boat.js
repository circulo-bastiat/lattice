// 07zzt_boat.js -- #5227 (G17-B1): BoatEntity's core tick, MAIN THREAD ONLY. No DOM.
// Port of .decomp/net/minecraft/entity/vehicle/BoatEntity.java: tick() (location bookkeeping), checkLocation(),
// getUnderWaterLocation(), checkBoatInWater(), method_7548 (getNearbySlipperiness), method_7544 (getWaterLevelAbove),
// updateVelocity() and fall(). Paddling/riding (B2), damage/drops (B3) and the item (B4) are NOT here (Bt.OWED).
// A boat never takes the generic gravity/damp path: EL.tickOne hands it to Bt.tick (the minecart's slot).
(function (NS) {
  'use strict';

  var Bt = NS.Boat = { ready: true };

  // BoatEntity.Location, in the jar's declaration order
  Bt.IN_WATER = 'in_water'; Bt.UNDER_WATER = 'under_water'; Bt.UNDER_FLOWING_WATER = 'under_flowing_water';
  Bt.ON_LAND = 'on_land'; Bt.IN_AIR = 'in_air';
  Bt.TYPES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];   // BoatEntity.Type ordinals

  Bt.isBoat = function (t) { return t === 'boat'; };

  Bt.init = function (e, opts) {
    opts = opts || {};
    var t = opts.boatType !== undefined ? opts.boatType : (e.boatType !== undefined ? e.boatType : 0);
    e.boatType = typeof t === 'number' ? Bt.TYPES[t] || 'oak' : t;
    e.location = null; e.lastLocation = null;
    e.ticksUnderwater = 0; e.waterLevel = 0; e.nearbySlip = 0.75;   // field_7714 is unset (0) until ON_LAND; 0.75 never read first
    e.velocityDecay = 0.05; e.fallVelocity = 0; e.stepHeight = 0;
    e.fallDistance = 0;
    e.passengers = []; e.yawDeg = 0; e.yawVelocity = 0;   // vanilla yaw (degrees); e.yaw = (yawDeg + 180) deg in the engine's (sin, -cos) frame
    e.pressingLeft = e.pressingRight = e.pressingForward = e.pressingBack = false;
    e.paddlePhases = [0, 0]; e.paddleMoving = [false, false];
  };

  var F32 = Math.fround, DEG = Math.PI / 180;
  function syncYaw(e) { e.yaw = (e.yawDeg + 180) * DEG; }
  function wrapDeg(a) { a = a % 360; if (a >= 180) a -= 360; if (a < -180) a += 360; return a; }

  Bt.canAddPassenger = function (e) { return e.passengers.length < 2 && e.location !== Bt.UNDER_WATER; };

  /** BoatEntity.interact: sneaking passes; ticksUnderwater < 60 -> startRiding (refused when canAddPassenger is false). */
  Bt.interact = function (e, p) {
    if (p.crouching || !(e.ticksUnderwater < 60)) return false;
    if (e.passengers.indexOf(p) >= 0 || !Bt.canAddPassenger(e)) return false;
    e.passengers.push(p); p.vehicle = e;
    if (p.mountVehicle) p.mountVehicle(e);
    return true;
  };

  /** Controlling input (ClientPlayerEntity.tickMovement -> BoatEntity.setInputs). */
  Bt.setInputs = function (e, left, right, fwd, back) { e.pressingLeft = !!left; e.pressingRight = !!right; e.pressingForward = !!fwd; e.pressingBack = !!back; };

  Bt.setPaddleMovings = function (e, l, r) { e.paddleMoving[0] = !!l; e.paddleMoving[1] = !!r; };

  /** BoatEntity.updatePaddles (controlBoat): yaw velocity, then the forward / back / pure-turn velocity add. */
  Bt.updatePaddles = function (e) {
    if (!e.passengers.length) return;
    var a = 0, l = e.pressingLeft, r = e.pressingRight, f = e.pressingForward, b = e.pressingBack;
    if (l) e.yawVelocity = F32(e.yawVelocity - 1);
    if (r) e.yawVelocity = F32(e.yawVelocity + 1);
    if (r !== l && !f && !b) a = F32(a + F32(0.005));
    e.yawDeg = F32(e.yawDeg + e.yawVelocity);
    if (f) a = F32(a + F32(0.04));
    if (b) a = F32(a - F32(0.005));
    e.vx += F32(Math.sin(F32(F32(-e.yawDeg) * F32(DEG)))) * a;
    e.vz += F32(Math.cos(F32(F32(e.yawDeg) * F32(DEG)))) * a;
    Bt.setPaddleMovings(e, (r && !l) || f, (l && !r) || f);
    syncYaw(e);
  };

  /** The paddle-phase loop of BoatEntity.tick: a stroke crossing PI/4 plays paddle_water / paddle_land (getPaddleSoundEvent). */
  Bt.tickPaddlePhases = function (e) {
    var Q = F32(Math.PI / 4), S = F32(Math.PI / 8), T = F32(Math.PI * 2);
    for (var i = 0; i <= 1; i++) {
      if (!(e.paddleMoving[i] && e.passengers.length)) { e.paddlePhases[i] = 0; continue; }
      var ph = e.paddlePhases[i];
      if (!e.silent && (ph % T) <= Q && (F32(ph + S) % T) >= Q) {
        var loc = Bt.checkLocation(e), id = null;
        if (loc === Bt.IN_WATER || loc === Bt.UNDER_WATER || loc === Bt.UNDER_FLOWING_WATER) id = 'entity.boat.paddle_water';
        else if (loc === Bt.ON_LAND) id = 'entity.boat.paddle_land';
        if (id && NS.Sound && NS.Sound.play) {
          var yr = F32(F32(e.yawDeg) * F32(DEG)), rx = -Math.sin(yr), rz = Math.cos(yr);   // getRotationVec(1), pitch 0
          NS.Sound.play(id, { x: e.x + (i === 1 ? -rz : rz), y: e.y, z: e.z + (i === 1 ? rx : -rx), volume: 1.0,
                              pitch: 0.8 + 0.4 * (e.random ? e.random() : Math.random()), source: 'neutral' });
        }
      }
      e.paddlePhases[i] = F32(ph + S);
    }
  };

  /** BoatEntity.copyEntityData: body follows the boat, rider yaw clamped to +-105 deg of it. */
  Bt.copyEntityData = function (e, p) {
    var d = wrapDeg(F32((p.yawDeg || 0) - e.yawDeg)), c = Math.max(-105, Math.min(105, d));
    p.yawDeg = F32((p.yawDeg || 0) + c - d);
    p.bodyYawDeg = e.yawDeg; p.headYawDeg = p.yawDeg;
  };

  /** BoatEntity.updatePassengerPosition: seat offset 0.2 / -0.6 (animals +0.2), rotated by -yaw - 90 deg. */
  Bt.passengerOffset = function (e, p) {
    var o = 0, i = e.passengers.indexOf(p);
    if (e.passengers.length > 1) { o = i === 0 ? F32(0.2) : F32(-0.6); if (p.isAnimal) o = F32(o + F32(0.2)); }
    var ang = F32(F32(F32(-e.yawDeg) * F32(DEG)) - F32(Math.PI / 2));
    return [o * Math.cos(ang), -o * Math.sin(ang)];   // Vec3d(o,0,0).rotateY(ang)
  };
  Bt.updatePassengerPosition = function (e, p) {
    if (e.passengers.indexOf(p) < 0) return;
    var off = Bt.passengerOffset(e, p);
    p.x = e.x + off[0]; p.z = e.z + off[1];
    p.y = e.y + (e.removed ? 0.01 : (e.mountedOffset !== undefined ? e.mountedOffset : -0.1)) + (p.heightOffset || 0);
    p.yawDeg = F32((p.yawDeg || 0) + e.yawVelocity);
    Bt.copyEntityData(e, p);
  };

  // FlowableFluid.getHeight for the water in a cell: 0 when none, 1 under more water, else amount/9
  function waterH(x, y, z) {
    var Ph = NS.Physics, SR = NS.States, st = Ph.blockAt(x, y, z);
    if (SR.fluidKind[st] !== 1) return 0;
    if (SR.fluidKind[Ph.blockAt(x, y + 1, z)] === 1) return 1;
    return SR.fluidAmt[st] / 9;
  }
  // FluidState.isStill(): a level-0 water block (or any other water-holder, which is a source)
  function still(x, y, z) {
    var R = NS.Reg, SR = NS.States, st = NS.Physics.blockAt(x, y, z);
    if (SR.block[st] !== R.id.water) return true;
    var v = SR.propValue(st, R.PROP.level);
    return v < 0 || +R.valueNames[v] === 0;
  }
  function box(e) { var h = e.width / 2; return [e.x - h, e.y, e.z - h, e.x + h, e.y + e.height, e.z + h]; }

  /** `BoatEntity.updatePassengerForDismount` (.decomp): the rider's yaw (DEGREES) picks the offset; no water under the target
   *  column, then the cell at the hull top and the one below (full-block heights only: this engine's collision is boolean) are
   *  tried for STANDING, CROUCHING, SWIMMING boxes in that order; else Entity's fallback (x, maxY, z). */
  Bt.findDismountPos = function (e, riderWidth, yawDeg, Physics) {
    var f = Math.fround, rad = f(Math.PI / 180);
    var half = (f(e.width * 1.4142135) + riderWidth + f(1.0E-5)) / 2;
    var sx = -f(Math.sin(f(f(yawDeg) * rad))), cz = f(Math.cos(f(f(yawDeg) * rad))), sc = Math.max(Math.abs(sx), Math.abs(cz));
    var x = e.x + sx * half / sc, z = e.z + cz * half / sc, top = e.y + e.height;
    var fx = Math.floor(x), fz = Math.floor(z), y4 = Math.floor(top), y5 = y4 - 1;
    if (NS.Physics.blockAt && NS.States.fluidKind[NS.Physics.blockAt(fx, y5, fz)] !== 1) {
      var cand = [];
      // getDismountHeight: solid here -> its max (1) refused; empty here -> 0 over a full block below, else -Infinity
      if (!Physics.solidAt(fx, y4, fz) && Physics.solidAt(fx, y5, fz)) cand.push(y4);
      if (!Physics.solidAt(fx, y5, fz) && Physics.solidAt(fx, y5 - 1, fz)) cand.push(y5);
      var poses = ['standing', 'crouching', 'swimming'];
      for (var pi = 0; pi < poses.length; pi++) {
        var pb = Physics.POSE[poses[pi]], hw = pb.w / 2;
        for (var ci = 0; ci < cand.length; ci++) {
          var cy = cand[ci], free = true;
          for (var ix = Math.floor(x - hw); ix <= Math.floor(x + hw - 1e-7) && free; ix++)
            for (var iz = Math.floor(z - hw); iz <= Math.floor(z + hw - 1e-7) && free; iz++)
              for (var iy = cy; iy < cy + pb.h && free; iy++) if (Physics.solidAt(ix, iy, iz)) free = false;
          if (free) return { x: x, y: cy, z: z, pose: poses[pi] };
        }
      }
    }
    return { x: e.x, y: top, z: e.z };
  };

  /** getUnderWaterLocation(): UNDER_FLOWING_WATER / UNDER_WATER / null. */
  Bt.underWaterLocation = function (e) {
    var b = box(e), top = b[4] + 0.001, any = false;
    for (var x = Math.floor(b[0]); x < Math.ceil(b[3]); x++)
      for (var y = Math.floor(b[4]); y < Math.ceil(top); y++)
        for (var z = Math.floor(b[2]); z < Math.ceil(b[5]); z++) {
          var h = waterH(x, y, z);
          if (h > 0 && top < y + h) {
            if (!still(x, y, z)) return Bt.UNDER_FLOWING_WATER;
            any = true;
          }
        }
    return any ? Bt.UNDER_WATER : null;
  };

  /** checkBoatInWater(): sets e.waterLevel, true when the hull's floor is below the surface. */
  Bt.inWater = function (e) {
    var b = box(e), hit = false;
    e.waterLevel = -Number.MAX_VALUE;
    for (var x = Math.floor(b[0]); x < Math.ceil(b[3]); x++)
      for (var y = Math.floor(b[1]); y < Math.ceil(b[1] + 0.001); y++)
        for (var z = Math.floor(b[2]); z < Math.ceil(b[5]); z++) {
          var h = waterH(x, y, z);
          if (h > 0) { var l = y + h; e.waterLevel = Math.max(l, e.waterLevel); hit = hit || b[1] < l; }
        }
    return hit;
  };

  /** getNearbySlipperiness() (method_7548): mean slipperiness of the colliders touching a 0.001 slab under the hull. */
  Bt.nearbySlipperiness = function (e) {
    var Ph = NS.Physics, SR = NS.States, R = NS.Reg, b = box(e), minY = b[1] - 0.001;
    var x0 = Math.floor(b[0]) - 1, x1 = Math.ceil(b[3]) + 1, y0 = Math.floor(minY) - 1, y1 = Math.ceil(b[1]) + 1;
    var z0 = Math.floor(b[2]) - 1, z1 = Math.ceil(b[5]) + 1, sum = 0, n = 0;
    for (var x = x0; x < x1; x++)
      for (var z = z0; z < z1; z++) {
        var edge = (x !== x0 && x !== x1 - 1 ? 0 : 1) + (z !== z0 && z !== z1 - 1 ? 0 : 1);
        if (edge === 2) continue;
        for (var y = y0; y < y1; y++) {
          if (edge > 0 && (y === y0 || y === y1 - 1)) continue;
          var st = Ph.blockAt(x, y, z);
          if (st === 0 || SR.block[st] === R.id.lily_pad) continue;
          var sh = Ph.shapesFor(st);
          if (!sh) continue;
          for (var i = 0; i < sh.length; i++) {
            var s = sh[i];   // cell-local [x0,y0,z0,x1,y1,z1]; vanilla matchesAnywhere = positive-volume overlap
            if (x + s[3] > b[0] && x + s[0] < b[3] && y + s[4] > minY && y + s[1] < b[1] &&
                z + s[5] > b[2] && z + s[2] < b[5]) { sum += (R.friction[SR.block[st]] || 0.6); n++; break; }
          }
        }
      }
    return sum / n;   // 0/0 = NaN when nothing is touched, as in the jar; the caller tests > 0
  };

  /** getWaterLevelAbove() (method_7544). */
  Bt.waterLevelAbove = function (e) {
    var b = box(e), y0 = Math.floor(b[4]), y1 = Math.ceil(b[4] - e.fallVelocity);
    for (var y = y0; y < y1; y++) {
      var f = 0, full = false;
      for (var x = Math.floor(b[0]); x < Math.ceil(b[3]) && !full; x++)
        for (var z = Math.floor(b[2]); z < Math.ceil(b[5]); z++) {
          f = Math.max(f, waterH(x, y, z));
          if (f >= 1) { full = true; break; }
        }
      if (!full) return y + f;
    }
    return y1 + 1;
  };

  /** checkLocation(). */
  Bt.checkLocation = function (e) {
    var u = Bt.underWaterLocation(e);
    if (u) { e.waterLevel = e.y + e.height; return u; }
    if (Bt.inWater(e)) return Bt.IN_WATER;
    var s = Bt.nearbySlipperiness(e);
    if (s > 0) { e.nearbySlip = s; return Bt.ON_LAND; }
    return Bt.IN_AIR;
  };

  /** updateVelocity(): gravity, buoyancy and the per-location decay. */
  Bt.updateVelocity = function (e) {
    var grav = e.noGravity ? 0 : -0.04, buoy = 0;
    e.velocityDecay = 0.05;
    if (e.lastLocation === Bt.IN_AIR && e.location !== Bt.IN_AIR && e.location !== Bt.ON_LAND) {
      e.waterLevel = e.y + e.height;
      e.y = Bt.waterLevelAbove(e) - e.height + 0.101;
      e.vy = 0; e.fallVelocity = 0; e.location = Bt.IN_WATER;
      return;
    }
    var L = e.location;
    if (L === Bt.IN_WATER) { buoy = (e.waterLevel - e.y) / e.height; e.velocityDecay = 0.9; }
    else if (L === Bt.UNDER_FLOWING_WATER) { grav = -7.0E-4; e.velocityDecay = 0.9; }
    else if (L === Bt.UNDER_WATER) { buoy = Math.fround(0.01); e.velocityDecay = 0.45; }
    else if (L === Bt.IN_AIR) e.velocityDecay = 0.9;
    else if (L === Bt.ON_LAND) {
      e.velocityDecay = e.nearbySlip;
      if (e.hasPlayerPassenger) e.nearbySlip /= 2;   // B2 sets it; nothing rides yet
    }
    e.vx *= e.velocityDecay; e.vy += grav; e.vz *= e.velocityDecay;
    if (buoy > 0) e.vy = (e.vy + buoy * 0.06153846016296973) * 0.75;
  };

  /** fall(heightDifference, onGround): the fall-distance bookkeeping. ON_LAND past 3 blocks breaks the boat (drops: B3). */
  Bt.fall = function (e, dy, onGround) {
    e.fallVelocity = e.vy;
    if (e.vehicle) return;
    if (onGround) {
      if (e.fallDistance > 3) {
        if (e.location !== Bt.ON_LAND) { e.fallDistance = 0; return; }
        e.fallBroke = true;   // handleFallDamage + kill()
        // Entity.handleFallDamage: the fall is forwarded to every passenger (their own landing damage)
        for (var k = 0; k < e.passengers.length; k++) {
          e.passengers[k].fallDamageTaken = NS.Physics.fallDamage(e.fallDistance, 1, 0);   // #6332 boatride lockstep reads this record
          if (NS.Physics.landed) NS.Physics.landed(e.passengers[k], e.fallDistance, e.fallVelocity);
        }
        if (!e.removed) {
          Bt.removeBoat(e);
          e.dropped = Bt.dropped(e, true);
        }
      }
      e.fallDistance = 0;
    } else if (NS.States.fluidKind[NS.Physics.blockAt(e.x, e.y - 1, e.z)] !== 1 && dy < 0) {
      e.fallDistance -= dy;
    }
  };

  /** discard()/kill(): Entity.setRemoved stops every passenger riding, then the boat leaves the list. */
  Bt.removeBoat = function (e) {
    for (var i = 0; i < e.passengers.length; i++) e.passengers[i].vehicle = null;
    e.passengers.length = 0;
    if (NS.EntityList && NS.EntityList.remove) NS.EntityList.remove(e);
  };

  function ruleDrops() {
    var C = NS.Commands;
    return !(C && typeof C.ruleGet === 'function' && C.ruleGet('doEntityDrops') === 'false');
  }
  /** Boat.Type.getBaseBlock(): the planks of the wood. */
  Bt.planks = function (e) { return e.boatType + '_planks'; };
  /** The dropped stacks (names) for a break; spawns them through EntityList.dropStack. fall: 3 planks + 2 sticks, else the boat item. */
  Bt.dropped = function (e, fall) {
    var out = [];
    if (!ruleDrops()) return out;
    if (fall) { for (var i = 0; i < 3; i++) out.push(Bt.planks(e)); out.push('stick', 'stick'); }
    else out.push(e.boatType + '_boat');
    var EL = NS.EntityList;
    if (EL && EL.dropStack) for (var j = 0; j < out.length; j++) EL.dropStack(e.x, e.y, e.z, out[j], 1);
    return out;
  };
  /** BoatEntity.damage(source, amount); src = { instabuild, invulnerable, attacker }. Returns true when the hit counted. */
  Bt.damage = function (e, amount, src) {
    src = src || {};
    if (src.invulnerable) return false;
    if (e.removed) return true;
    e.wobbleSide = -(e.wobbleSide || 1); e.wobbleTicks = 10;
    e.wobbleStrength = (e.wobbleStrength || 0) + amount * 10;
    if (NS.GameEvents && NS.GameEvents.emit) NS.GameEvents.emit('entity_damaged', e.x, e.y, e.z, src.attacker || e);
    var insta = !!src.instabuild;
    if (insta || e.wobbleStrength > 40) {
      if (!insta) e.dropped = Bt.dropped(e, false);
      Bt.removeBoat(e);
    }
    return true;
  };

  /** BoatEntity.onBubbleColumnSurfaceCollision(drag): replaces Entity's vy push; arms the 60-tick wobble. */
  Bt.onBubbleColumnSurfaceCollision = function (e, drag) {
    e.onBubbleColumnSurface = true; e.bubbleColumnIsDrag = !!drag;
    if (!e.bubbleWobbleTicks) e.bubbleWobbleTicks = 60;
  };

  /** BoatEntity.handleBubbleColumn (both halves: single-player is server and client); gameTime stands in for world.getTime(). */
  Bt.handleBubbleColumn = function (e, time) {
    var t = e.bubbleWobbleTicks | 0;
    e.bubbleWobbleStrength = F32((e.bubbleWobbleStrength || 0) + (t > 0 ? F32(0.05) : F32(-0.1)));
    e.bubbleWobbleStrength = Math.max(0, Math.min(1, e.bubbleWobbleStrength));
    e.lastBubbleWobble = e.bubbleWobble || 0;
    e.bubbleWobble = F32(10 * F32(Math.sin(F32(F32(0.5) * F32(time)))) * e.bubbleWobbleStrength);
    if (!e.onBubbleColumnSurface) e.bubbleWobbleTicks = 0;
    t = e.bubbleWobbleTicks | 0;
    if (t > 0) {
      e.bubbleWobbleTicks = --t;
      if (60 - t - 1 > 0 && t === 0) {
        if (e.bubbleColumnIsDrag) {
          e.vy += -0.7;
          for (var i = 0; i < e.passengers.length; i++) e.passengers[i].vehicle = null;
          e.passengers.length = 0;
        } else {
          e.vy = e.passengers.some(function (p) { return p.isPlayer || p.type === 'player'; }) ? 2.7 : 0.6;
        }
      }
      e.onBubbleColumnSurface = false;
    }
  };

  /** BoatEntity.tick(), the part this unit owns. Called from EL.tickOne. */
  Bt.tick = function (e) {
    var Ph = NS.Physics;
    if (e.wobbleTicks > 0) e.wobbleTicks--;
    if (e.wobbleStrength > 0) e.wobbleStrength--;
    e.lastLocation = e.location;
    e.location = Bt.checkLocation(e);
    if (e.location !== Bt.UNDER_WATER && e.location !== Bt.UNDER_FLOWING_WATER) e.ticksUnderwater = 0; else e.ticksUnderwater++;
    // Entity.baseTick -> updateWaterState: touching water zeroes fallDistance (IN_WATER / UNDER_* are the hull in water)
    if (e.location === Bt.IN_WATER || e.location === Bt.UNDER_WATER || e.location === Bt.UNDER_FLOWING_WATER) e.fallDistance = 0;
    if (!(e.passengers[0] && (e.passengers[0].isPlayer || e.passengers[0].type === 'player'))) Bt.setPaddleMovings(e, false, false);
    Bt.updateVelocity(e);
    e.yawVelocity = F32(e.yawVelocity * F32(e.velocityDecay));
    Bt.updatePaddles(e);
    var y0 = e.y, fd = e.fallDistance || 0;
    Ph.move(e, e.vx, e.vy, e.vz);
    e.fallDistance = fd;   // Ph.move keeps Entity.move's own counter (zeroed on landing); BoatEntity.fall owns this one
    Bt.fall(e, e.y - y0, e.onGround);
    Bt.handleBubbleColumn(e, (NS.Behave && NS.Behave.gameTime) | 0);
    Bt.tickPaddlePhases(e);
    if (e.ticksUnderwater >= 60 && e.passengers.length) { e.passengers.forEach(function (p) { p.vehicle = null; }); e.passengers.length = 0; }
    for (var i = 0; i < e.passengers.length; i++) Bt.updatePassengerPosition(e, e.passengers[i]);
    e.age = (e.age | 0) + 1;
    // the tracker sends the server pose every 3 ticks (or at once for a new boat); the drawn copy trails it
    if (!e.boatC || e.age % 3 === 0) Bt.updateTracked(e, e.x, e.y, e.z, (e.yaw || 0) / DEG, (e.pitch || 0) / DEG);
    Bt.clientTick(e);
  };

  /** BoatEntity.updateTrackedPositionAndAngles: the tracker's target (yaw/pitch in degrees); the client copy lerps 10 ticks toward it. */
  Bt.INTERP_STEPS = 10;
  Bt.wrapDegrees = function (d) { d = d % 360; if (d >= 180) d -= 360; if (d < -180) d += 360; return d; };
  Bt.updateTracked = function (e, x, y, z, yawDeg, pitchDeg) {
    var c = e.boatC;
    if (!c) c = e.boatC = { x: x, y: y, z: z, px: x, py: y, pz: z, yaw: yawDeg, pyaw: yawDeg, pitch: pitchDeg, ppitch: pitchDeg, steps: 0 };
    c.tx = x; c.ty = y; c.tz = z; c.tyaw = yawDeg; c.tpitch = pitchDeg; c.steps = Bt.INTERP_STEPS;
  };
  /** BoatEntity.tick's client branch (`if (field_7708 > 0)`); previous values are kept for the partial-tick lerp. */
  Bt.clientTick = function (e) {
    var c = e.boatC; if (!c) return;
    c.px = c.x; c.py = c.y; c.pz = c.z; c.pyaw = c.yaw; c.ppitch = c.pitch;
    if (c.steps > 0) {
      var n = c.steps;
      c.x += (c.tx - c.x) / n; c.y += (c.ty - c.y) / n; c.z += (c.tz - c.z) / n;
      c.yaw = F32(c.yaw + F32(Bt.wrapDegrees(c.tyaw - c.yaw)) / n);
      c.pitch = F32(c.pitch + F32(c.tpitch - c.pitch) / n);
      c.steps--;
    }
  };

  Bt.OWED = [
    'the boat item (G17-B4);  lily-pad-free water mask'
  ];
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
