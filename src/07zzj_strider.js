// src/07zzj_strider.js — s135: the STRIDER EXISTS in this engine, full vanilla 1.18.2 shape.
//
// Off .decomp, read whole: net/minecraft/entity/passive/StriderEntity.java (cold state, the
// SaddledComponent-driven saddle/boost, the mount+steer dispatch, GoBackToLavaGoal, the
// LandPathNodeMaker Navigation subclass, the natural-spawn rider/baby rolls), client/render/
// entity/StriderEntityRenderer.java (cold texture swap, baby scale 0.5, shadowRadius 0.5),
// client/render/entity/model/StriderEntityModel.java (the 0.9375F offset this engine's
// renderer wiring reads live off 07j_entityrender.js's own strider scale hook, not copied here).
//
// -- REUSE, NOT A REWRITE (grep pigridecheck, 07w_passive.js) -------------------------------
// `StriderEntity implements ItemSteerable, Saddleable` off the SAME `SaddledComponent` class
// `PigEntity` reads its own boost math from (`Passive.pigBoost`'s own header names the class,
// not the mob, as the source of `PIG_BOOST_MIN`/`PIG_BOOST_ROLL` -- 140 / nextInt(841)) -- the
// roll itself does not check `e.type`, so this file calls `NS.Passive.pigBoost` DIRECTLY rather
// than re-deriving the same two numbers under a new name (`Passive.pigTravelSpeed` is NOT
// reused the same way -- it bakes PIG's own 0.225 saddled multiplier into its first argument,
// so `Strider.travel`'s own header explains why the boost-hump ARITHMETIC is repeated here
// instead). What IS strider-specific and lives here: `isCold`/`setCold` (lava proximity, not
// carrot food), `canBeControlledByRider` (warped fungus on a stick, not carrot on a stick),
// `getSpeed`/`getSaddledSpeed`'s own cold multipliers, and the natural-spawn zombie-rider /
// baby-strider-rider rolls `PigEntity.initialize` has no equivalent of at all.
//
// -- WHAT IS DELIBERATELY NOT HERE -----------------------------------------------------------
//   - GoBackToLavaGoal / the LandPathNodeMaker Navigation subclass: full pathfinding-goal AI
//     (G18b's own remaining scope, same standing gap every "brain as goals" mob file states) --
//     `Strider.OWED` names it below. `Ai.MALUS_OWN.strider` (07k_goals.js) already carries the
//     WATER=-1/LAVA=0 penalties this goal would read.
//   - The floaty ride bob's OWN per-frame render write (`ER`, 07j_entityrender.js) -- the formula
//     lives here (`Strider.mountedHeightOffset`) as the vanilla-exact number, matching how
//     `Mnt.mountedHeightOffset` (07r_mount.js) is read live by the renderer rather than copied.
(function (NS) {
  'use strict';
  var St = NS.Strider = { ready: false };

  // -- constants, all off StriderEntity.java's own literals ------------------------------------
  St.COLD_SADDLED_SPEED = 0.23;   // getSaddledSpeed(): attr * (cold ? 0.23 : 0.55)
  St.WARM_SADDLED_SPEED = 0.55;
  St.COLD_SPEED_MUL = 0.66;       // getSpeed(): attr * (cold ? 0.66 : 1.0)
  St.WARM_SPEED_MUL = 1.0;
  St.RIDER_ROLL = 30;             // initialize(): random.nextInt(30) == 0 -> zombie rider
  St.BABY_RIDER_ROLL = 10;        // random.nextInt(10) == 0 -> baby strider rider
  St.ZOMBIE_BABY_CHANCE = 0.05;   // ZombieEntity.shouldBeBaby: nextFloat() < 0.05 (07zk_undead.js)

  St.OWED = [
    'GoBackToLavaGoal / the LandPathNodeMaker Navigation subclass -- full pathfinding-goal AI ' +
      'waits on G18b\'s own remaining scope (Ai.MALUS_OWN.strider already carries the two ' +
      'penalties that goal would read, 07k_goals.js)',
    'EscapeDangerGoal/TemptGoal/AnimalMateGoal/WanderAroundGoal/FollowParentGoal/LookAroundGoal ' +
      'priority wiring into a real goal selector -- this session wires the DATA (breeding via ' +
      'Br.interact off Ent.breeding.strider, tempt items via the same table) but not a rostered ' +
      'per-tick goal list the way Hoglin/Piglin\'s "brain as goals" files do',
    'the renderer scale hook (ER.renderScaleOf, 07j_entityrender.js, baby 0.5F) is real; the ' +
      'cold skin (strider_cold) and cold shaking (ER.isShaking) are wired (#932)'
  ];

  function rnd() { var EL = NS.EntityList; return (EL && EL.random) || Math.random; }
  function alive(e) { return !!e && !e.removed && !(e.health !== undefined && e.health <= 0); }

  // -- cold state (StriderEntity.tick / isCold / setCold) ---------------------------------------
  //
  // `tick()` (.decomp): `warm = block-at-feet or landing-block is in STRIDER_WARM_BLOCKS tag, OR
  // getFluidHeight(LAVA) > 0`; `setCold(!warm)`. `isCold()` reads the VEHICLE's own cold state
  // when mounted on another strider (a baby riding a warm adult is never cold), else its own
  // tracked flag. `STRIDER_WARM_BLOCKS` (BlockTags) is ONLY lava (jar strider_warm_blocks.json) --
  // a feet-block/landing-block id compare stands in for the tag read a full block-shape API
  // would need.
  St.isWarmBid = function (bid) {
    var R = NS.Reg;
    return !!R && !!R.id && (bid === R.id.lava);
  };
  /** A block STATE's own block id, the same `NS.States.block[stateId]` read
   *  `Ph.updateFluids`'s own `e.inLava` line already makes (14b_physics.js). */
  St.blockIdAt = function (x, y, z) {
    var Ph = NS.Physics, S = NS.States;
    if (!Ph || !S || !S.block) return -1;
    return S.block[Ph.blockAt(x, y, z)];
  };
  St.updateCold = function (e) {
    if (!e) return;
    // `BlockState $$0 = getBlockState(getBlockPos())` -- the block AT the feet.
    var warm = St.isWarmBid(St.blockIdAt(e.x, e.y, e.z));
    // `getLandingBlockState()` = getBlockState(Entity.getLandingPos()): floor(y - 0.2). (Its
    // air-cell fence/wall/gate fallback never yields lava, the only warm block, so it is moot.)
    if (!warm) warm = St.isWarmBid(St.blockIdAt(e.x, e.y - 0.2, e.z));
    // `getFluidHeight(LAVA) > 0.0` -- this engine's own per-tick lava flag (`Ph.updateFluids`,
    // ticked every mob BEFORE this dispatch runs, 07i_entitylist.js's own "baseTick" ordering).
    if (!warm && e.inLava) warm = true;
    e.striderCold = !warm;
  };
  St.isCold = function (e) {
    if (!e) return false;
    if (e.vehicle && e.vehicle.type === 'strider') return St.isCold(e.vehicle);
    return !!e.striderCold;
  };
  St.setCold = function (e, val) { if (e) e.striderCold = !!val; };

  // -- speed (getSpeed / getSaddledSpeed, both read the SAME movementSpeed attribute) ----------
  St.getSpeed = function (e, attr) {
    return attr * (St.isCold(e) ? St.COLD_SPEED_MUL : St.WARM_SPEED_MUL);
  };
  St.getSaddledSpeed = function (e, attr) {
    return attr * (St.isCold(e) ? St.COLD_SADDLED_SPEED : St.WARM_SADDLED_SPEED);
  };

  // -- saddle (Saddleable -- same shape Passive.pigCanBeSaddled/pigSaddle already draw) --------
  St.canBeSaddled = function (e) {
    return !!e && alive(e) && (e.growAge | 0) >= 0;    // isAlive() && !isBaby()
  };
  St.isSaddled = function (e) { return !!(e && e.saddled); };
  St.saddle = function (e, silent) {   // silent: initialize()'s saddle(null)
    if (!St.canBeSaddled(e) || St.isSaddled(e)) return false;
    e.saddled = true;
    if (!silent) St.playSaddle(e);
    return true;
  };
  /** `StriderEntity.dropInventory` (.decomp): a saddled strider drops one saddle on death,
   *  same split `Passive.dropInventory`'s own pig row already draws (07w_passive.js). */
  St.dropInventory = function (e) {
    if (!e || e.type !== 'strider' || !e.saddled) return [];
    e.saddled = false;
    return [{ item: 'saddle', count: 1 }];
  };

  // -- mounting + carrot-on-a-stick-shaped steering (StriderEntity.interactMob / travel) -------
  St.mount = function (e) {
    if (!e || e.type !== 'strider' || e.rider || e.passenger) return false;
    if (!St.isSaddled(e)) return false;
    // `canAddPassenger`: `!isSubmergedIn(FluidTags.LAVA)` -- eye-height lava, the SAME
    // `e.eyeInWater` shape `Ph.updateFluids` already tracks for water (14b_physics.js), read
    // live here rather than adding a second per-tick field for one refusal check.
    // Entity.updateSubmergedInWaterState (:1077-1091): probe eyeY - 1/9 (the STRIDER's own eye, 1.7*0.85),
    // submerged only if blockY + fluidHeight > probe (Wx.fluidHeight: 1 under same fluid, else amount/9).
    var Wx = NS.Weather, py = Math.fround(e.y + Math.fround(1.7 * 0.85) - 0.11111111);
    if (Wx && Wx.fluidHeight) {
      var bx = Math.floor(e.x), by = Math.floor(py), bz = Math.floor(e.z);
      if (Wx.fluidOf(NS.World.getBlock(bx, by, bz))[0] === 2 && by + Wx.fluidHeight(bx, by, bz) > py) return false;
    }
    e.rider = 'player';
    return true;
  };
  /** `BlockView.getDismountHeight(pos)`: the cell's own collision top, else the block below's top - 1
   *  when that reaches the cell floor, else -Infinity. */
  St.dismountHeight = function (x, y, z, Ph) {
    var top = function (sh) { var m = -Infinity; for (var i = 0; sh && i < sh.length; i++) m = Math.max(m, sh[i][4]); return m; };
    var here = top(Ph.shapeAt(x, y, z));
    if (here > -Infinity) return here;
    var b = top(Ph.shapeAt(x, y - 1, z));
    return b >= 1 ? b - 1 : -Infinity;
  };
  /** `Dismounting.canPlaceEntityAt` (block collisions only; no world border in this engine). */
  St.boxFree = function (Ph, x0, y0, z0, x1, y1, z1) {
    for (var x = Math.floor(x0); x < x1; x++) for (var y = Math.floor(y0); y < y1; y++) for (var z = Math.floor(z0); z < z1; z++) {
      var sh = Ph.shapeAt(x, y, z);
      for (var i = 0; sh && i < sh.length; i++) {
        var q = sh[i];
        if (x + q[0] < x1 && x + q[3] > x0 && y + q[1] < y1 && y + q[4] > y0 && z + q[2] < z1 && z + q[5] > z0) return false;
      }
    }
    return true;
  };
  /** `StriderEntity.updatePassengerForDismount` (.decomp :205-247): five yaw offsets off the RIDER's
   *  yaw (0, -22.5, +22.5, -45, +45 deg), each walked down from the strider's box top to 0.5 below
   *  its feet, first cell that is not lava and has solid below / free two-high column wins;
   *  nothing found -> the strider's own x/maxY/z. `riderYaw` is radians (engine convention). */
  St.findDismountPos = function (e, riderWidth, riderYaw, Physics) {
    var Mnt = NS.Mount, Ent = NS.Entities, R = NS.Reg;
    if (!e || !Mnt || !Physics || !Physics.solidAt) return null;
    var w = (Ent && Ent.width('strider')) || 0.9, h = (Ent && Ent.height('strider')) || 1.7;
    var d = Math.PI / 180, yaws = [0, -22.5 * d, 22.5 * d, -45 * d, 45 * d];
    var maxY = e.y + h, minY = e.y - 0.5, seen = {}, cells = [];
    for (var i = 0; i < yaws.length; i++) {
      var o = Mnt.dismountOffset(w, riderWidth, (riderYaw || 0) + yaws[i]);
      var cx = Math.floor(e.x + o.x), cz = Math.floor(e.z + o.z), cy = Math.floor(maxY);
      for (var y = maxY; y > minY; y--, cy--) {
        var k = cx + ',' + cy + ',' + cz;
        if (!seen[k]) { seen[k] = 1; cells.push([cx, cy, cz, e.x + o.x, e.z + o.z]); }
      }
    }
    for (var j = 0; j < cells.length; j++) {
      var c = cells[j];
      if (R && R.id && St.blockIdAt(c[0], c[1], c[2]) === R.id.lava) continue;
      var dh = St.dismountHeight(c[0], c[1], c[2], Physics);       // getDismountHeight + canDismountInBlock
      if (!(dh < 1) || dh === -Infinity) continue;
      var px = c[0] + 0.5, py = c[1] + dh, pz = c[2] + 0.5, poses = ['standing', 'crouching', 'swimming'];
      for (var k = 0; k < poses.length; k++) {                    // PlayerEntity.getPoses()
        var pb = Physics.POSE[poses[k]];
        if (St.boxFree(Physics, px - riderWidth / 2, py, pz - riderWidth / 2, px + riderWidth / 2, py + pb.h, pz + riderWidth / 2))
          return { x: px, y: py, z: pz, pose: poses[k] };
      }
    }
    return { x: e.x, y: e.y + h, z: e.z };
  };

  /** `StriderEntity.getLeashOffset` (.decomp :436): `(0, 0.6 * standingEyeHeight, width * 0.4)`,
   *  all float-rounded. Unrotated (07u_leash.js has no body-yaw signal; see its header). */
  St.leashOffset = function () {
    var Ent = NS.Entities, w = (Ent && Ent.width('strider')) || 0.9, h = (Ent && Ent.height('strider')) || 1.7;
    return { x: 0, y: Math.fround(0.6 * Math.fround(h * 0.85)), z: Math.fround(w * 0.4) };
  };

  /** `canBeControlledByRider` (.decomp): the primary passenger must be a PLAYER holding
   *  `warped_fungus_on_a_stick` in EITHER hand -- the exact shape `Passive.
   *  pigCanBeControlledByRider` already draws, ported off warped_fungus_on_a_stick instead
   *  of carrot_on_a_stick (07w_passive.js's own header explains why the off-hand slot 40 read
   *  is free once one interaction already pays for it). */
  St.canBeControlledByRider = function (e) {
    if (!e || e.type !== 'strider' || e.rider !== 'player') return false;
    var P = NS.Player, IT = NS.Items;
    if (!P || !IT || !IT.ready) return false;
    if (P.heldItemName && P.heldItemName() === 'warped_fungus_on_a_stick') return true;
    var Iv = NS.Inventory;
    if (Iv && P.inventory) {
      var off = Iv.getItem(P.inventory, 40);
      if (off && !Iv.isEmpty(off) && IT.nameOf(off.i | 0) === 'warped_fungus_on_a_stick') return true;
    }
    return false;
  };
  /** `ItemSteerable.travel` (.decomp, read in full) -- the strider-specific whole of it, the
   *  SAME split `Passive.pigTravel` draws (07w_passive.js): uncontrolled leaves `e.mobSpeed`/
   *  `e.zza` untouched (whatever the goal selector already set stands); controlled syncs yaw,
   *  halves pitch, advances the SHARED SaddledComponent boost clock (`Passive.pigBoost`'s own
   *  fields, `e.boosted`/`e.boostedTime`/`e.currentBoostTime` -- genuinely the same component
   *  class, not a coincidence of naming) and pins `e.zza = 1` (always full forward, never
   *  rider-steered strafe/back the way a horse is).
   */
  St.travel = function (e, rnd2) {
    var Ph = NS.Physics;
    if (!Ph) return;
    if (!St.canBeControlledByRider(e)) {
      // StriderEntity.travel: `setMovementSpeed(getSpeed())` EVERY tick, unridden too -- it
      // overwrites whatever the MoveControl set (#936), so a cold strider walks at 0.66x.
      var Ent0 = NS.Entities;
      var base0 = e.movementSpeedAttr !== undefined ? e.movementSpeedAttr
        : ((Ent0 && Ent0.attrsOf('strider').speed) || 0.175);
      e.mobSpeed = St.getSpeed(e, base0);
      Ph.travelMob(e); return;
    }
    var ri = e.riderInput || {};
    if (ri.yaw !== undefined) e.yaw = ri.yaw;
    e.pitch = (ri.pitch || 0) * 0.5;
    var Ps = NS.Passive;
    if (Ps && e.boosted) {
      var bt = e.boostedTime || 0;
      var expired = bt > (e.currentBoostTime || 0);
      e.boostedTime = bt + 1;
      if (expired) e.boosted = false;
    }
    var Ent = NS.Entities;
    var base = e.movementSpeedAttr !== undefined ? e.movementSpeedAttr
      : ((Ent && Ent.attrsOf('strider').speed) || 0.175);   // createStriderAttributes(), .decomp
    var saddledSpeed = St.getSaddledSpeed(e, base);
    // `ItemSteerable.travel`'s own boost hump (.decomp, read in full, `Passive.pigTravelSpeed`'s
    // own header): `speed + speed*1.15*sin(boostedTime/currentBoostTime*PI)` while boosted.
    // NOT `Passive.pigTravelSpeed` itself -- that function bakes PIG's OWN 0.225 saddled
    // multiplier into its first argument (`Passive.PIG_SADDLED_SPEED_MUL`), so calling it here
    // with an ALREADY-saddled-speed value would scale twice. Only the boost CLOCK fields
    // (`e.boosted`/`e.boostedTime`/`e.currentBoostTime`) and the roll (`Passive.pigBoost`) are
    // shared; the hump arithmetic is one line, reproduced here rather than wrapped.
    e.mobSpeed = saddledSpeed;
    if (e.boosted && (e.currentBoostTime || 0) > 0) {
      e.mobSpeed += saddledSpeed * 1.15 * Math.sin((e.boostedTime || 0) / e.currentBoostTime * Math.PI);
    }
    e.zza = 1;
    e.stepHeight = 1.0; e.maxUpStep = 1.0;   // ItemSteerable.travel controlled branch (as Passive.pigTravel, #4111)
    e.bodyYaw = e.headYaw = e.yaw; e.prevYaw = e.yaw;
    e.airStrafingSpeed = e.mobSpeed * 0.1;
    Ph.travelMob(e, 0);
  };
  /** `consumeOnAStickItem()` -> `saddledComponent.boost(random)` -- the SAME shared-component
   *  roll `Passive.pigBoost` already implements (140 + nextInt(841)); called generically off
   *  `Use.striderBoostOnAStick` (14l_use.js, this pass's own wiring), not duplicated here. */

  // -- getMountedHeightOffset (StriderEntity.java:180-184) -- the floaty ride bob ---------------
  St.mountedHeightOffset = function (e, height) {
    var limbDistance = Math.min(0.25, e.animSpeed || 0);     // this.limbDistance
    var limbAngle = e.animPos || 0;                            // this.limbAngle
    return (height || 0) - 0.19 + 0.12 * Math.cos(limbAngle * 1.5) * 2.0 * limbDistance;
  };

  // -- natural-spawn rider rolls (StriderEntity.initialize, .decomp:435-455) --------------------
  //
  // Only for a FRESH adult (a baby returns early, matching `if (this.isBaby()) return
  // super.initialize(...)`): 1/30 spawns a zombie (`Undead.rollBaby`'s own 5% roll decides if
  // IT is a baby) holding a warped fungus on a stick, saddles THIS strider and mounts the
  // zombie; else 1/10 spawns a SECOND, baby, strider and mounts it here instead. Neither branch
  // re-enters this function for the passenger (the passenger's own `initStrider`/zombie init is
  // never re-triggered by this call -- it is built directly, matching `initializeRider`'s own
  // `startRiding` without a second `EntityType.create(...).initialize(...)` round trip through
  // THIS file for the strider case, and the zombie's own init table entry, already wired,
  // covers its equipment/attributes the normal way).
  /** `initializeRider` (StriderEntity.java:464): refreshPositionAndAngles(x,y,z, this.yaw, 0) then
   *  startRiding -- the rider takes the vehicle's yaw and a zero pitch. */
  function placeRider(e, z) {
    z.yaw = e.yaw || 0; z.pitch = 0;
    z.x = e.x; z.z = e.z; z.y = e.y + St.mountedHeightOffset(e, e.height);
  }
  St.rollRider = function (e, r) {
    if (!e || e.type !== 'strider' || (e.growAge | 0) < 0) return null;   // isBaby() guard
    var EL = NS.EntityList, Rd = NS.Raid;
    if (!EL || !EL.spawn || !Rd || !Rd.startRiding) return null;
    var roll1 = Math.floor(r() * St.RIDER_ROLL);
    if (roll1 === 0) {
      var z = EL.spawn('zombie', e.x, e.y, e.z);
      if (!z) return null;
      if (NS.Undead && NS.Undead.rollBaby && NS.Undead.rollBaby(r)) z.growAge = -24000;
      var Eq = NS.Equip, IT = NS.Items;
      if (Eq && IT && IT.ready && IT.MAINHAND !== undefined) {
        var idx = IT.of ? IT.of('warped_fungus_on_a_stick') : -1;
        if (idx >= 0) Eq.setEquipped(z, IT.MAINHAND, { i: idx, n: 1 });
      }
      St.saddle(e, true);
      Rd.startRiding(z, e);
      placeRider(e, z);
      return z;
    }
    var roll2 = Math.floor(r() * St.BABY_RIDER_ROLL);
    if (roll2 === 0) {
      var baby = EL.spawn('strider', e.x, e.y, e.z, { noRider: true });
      if (!baby) return null;
      baby.growAge = -24000;
      Rd.startRiding(baby, e);
      placeRider(e, baby);
      return baby;
    }
    return null;
  };
  /** Entity-list init-table entry (07i_entitylist.js's own `strider:` row): rolls the rider,
   *  then updates the cold flag once so a freshly spawned strider is never drawn warm-textured
   *  standing on stone. `opts.conversion`/`opts.noRider` both skip the roll -- mirrors
   *  `Hoglin.initHoglin`'s own `opts.conversion` guard (07zzg_hoglin.js) for the same reason:
   *  a passenger THIS function itself just spawned must not re-roll a passenger of its own. */
  St.initStrider = function (e, opts) {
    St.updateCold(e);
    // Skip the roll on a passenger THIS function itself just spawned (`opts.noRider`, the
    // recursion guard `EL.spawn('strider', ..., {noRider:true})` above passes) AND on a
    // world-reload restore -- `opts.mobNbtRestore`, the explicit marker `Mb.restoreAll`
    // (07zw_mobnbt.js) now sets on every opts object it builds. NOT `opts.growAge !==
    // undefined` (EL.ZOMBIE_BABY_ROLL's own guard, 07i_entitylist.js:464) -- that one works
    // for the zombie family (growAge is always a real number there) but a fresh ADULT
    // strider never sets growAge at all, so a restored adult's own opts would carry no
    // growAge key either and this guard would silently re-roll a second passenger on every
    // load.
    if (opts && (opts.conversion || opts.noRider || opts.mobNbtRestore)) return;
    // StriderEntity.initialize builds a fresh PassiveData(0.5F) (spawnedCount 0) each call: never a baby from it.
    St.rollRider(e, rnd());
  };

  /** Per-tick dispatch (07i_entitylist.js's own generic-entity slot, same standing
   *  hoglin/piglin/squid/fish rows occupy): refresh the cold flag every tick, matching
   *  `tick()`'s own unconditional `setCold(!warm)` call ahead of `super.tick()`. */
  St.tickEntity = function (e) {
    St.updateCold(e); St.tickSounds(e);
    // StriderEntity.hurtByWater() == true -> LivingEntity.baseTick's generic DROWN 1.0F (same rule as snow golem)
    if (NS.SnowGolem && NS.SnowGolem.applyWaterDamage) NS.SnowGolem.applyWaterDamage(e);
  };

  // -- sounds (StriderEntity getAmbientSound/getHurtSound/getDeathSound/playStepSound/eat/saddle/tick) --
  St.SOUND = {
    ambient: 'entity.strider.ambient', hurt: 'entity.strider.hurt', death: 'entity.strider.death',
    step: 'entity.strider.step', stepLava: 'entity.strider.step_lava', eat: 'entity.strider.eat',
    saddle: 'entity.strider.saddle', happy: 'entity.strider.happy', retreat: 'entity.strider.retreat'
  };
  St.SADDLE_VOLUME = 0.5;
  St.STEP_DISTANCE = 0.6;         // calculateNextStepSoundDistance: distanceTraveled + 0.6
  // Entity.nextStepSoundDistance starts 1.0F; the 0.6 override applies only after the first step
  St.MIN_AMBIENT_DELAY = 120;     // AnimalEntity.getMinAmbientSoundDelay (strider does not override)
  St.HAPPY_ROLL = 140;            // tick(): isBeingTempted && nextInt(140) == 0
  St.RETREAT_ROLL = 60;           // tick(): isEscapingDanger && nextInt(60) == 0
  /** `isBeingTempted` / `isEscapingDanger` read TemptGoal/EscapeDangerGoal, which are not rostered
   *  yet (St.OWED); the goals set these two flags when they land. */
  /** #1180 -- the rostered TemptGoal / EscapeDangerGoal (Ai.ROSTER.strider stores the handles on the mob):
   *  `running` in the goal selector is what vanilla's isBeingTempted/isEscapingDanger read. */
  function goalActive(e, g) {
    if (!g || !e.ai || !e.ai.entries) return false;
    for (var i = 0; i < e.ai.entries.length; i++) if (e.ai.entries[i].goal === g) return !!e.ai.entries[i].running;
    return false;
  }
  St.isBeingTempted = function (e) { return !!e.striderTempted || goalActive(e, e.striderTemptGoal); };
  St.isEscapingDanger = function (e) { return !!e.striderEscaping || goalActive(e, e.striderEscapeGoal); };
  St.isEscaping = St.isEscapingDanger;   // names 07zzp_mobvoice's ambient gate reads
  St.isTempted = St.isBeingTempted;
  /** LivingEntity.getSoundPitch: baby 1.5, adult 1.0, plus (r - r) * 0.2. */
  St.soundPitch = function (e, r) {
    r = r || rnd();
    return (r() - r()) * 0.2 + ((e.growAge | 0) < 0 ? 1.5 : 1.0);
  };
  /** Plays a strider event at the mob; volume/pitch overrides for eat/saddle/step. */
  St.playSound = function (e, ev, volume, pitch, r) {
    if (!ev || e.silent) return null;
    var S = NS.Sound;
    if (S && S.entitySound) {
      S.entitySound(ev, e.x, e.y, e.z, volume === undefined ? 1 : volume,
        pitch === undefined ? St.soundPitch(e, r) : pitch, 'neutral', NS.Player);
    }
    return ev;
  };
  /** getAmbientSound: null while tempted or escaping. */
  St.ambientSound = function (e) {
    return (St.isBeingTempted(e) || St.isEscapingDanger(e)) ? null : St.SOUND.ambient;
  };
  /** LivingEntity.damage: death on a killing blow, hurt on a surviving one. */
  St.onDamaged = function (e) {
    if (!e || e.type !== 'strider') return null;
    return St.playSound(e, e.health <= 0 ? St.SOUND.death : St.SOUND.hurt);
  };
  /** interactMob with breeding food: `playSound(EAT, 1.0F, 1.0F + (r - r) * 0.2F)`. */
  St.playEat = function (e, r) {
    r = r || rnd();
    return St.playSound(e, St.SOUND.eat, 1, 1 + (r() - r()) * 0.2, r);
  };
  /** saddle(): `SoundEvents.ENTITY_STRIDER_SADDLE, 0.5F, 1.0F`. */
  St.playSaddle = function (e) { return St.playSound(e, St.SOUND.saddle, St.SADDLE_VOLUME, 1); };
  /** Once per mob tick (ambient roll is MobVoice.tickAmbient's): StriderEntity.tick happy/retreat rolls,
   *  and Entity.move's step-distance counter (step_lava while in lava). */
  St.tickSounds = function (e, r) {
    if (!e || e.type !== 'strider' || e.dead) return;
    r = r || rnd();
    if (St.isBeingTempted(e) && Math.floor(r() * St.HAPPY_ROLL) === 0) St.playSound(e, St.SOUND.happy, 1, undefined, r);
    else if (St.isEscapingDanger(e) && Math.floor(r() * St.RETREAT_ROLL) === 0) St.playSound(e, St.SOUND.retreat, 1, undefined, r);
    // Entity.move: no step counter while mounted; touching water plays the swim sound (MobVoice), never step
    if (e.vehicle) { e.stepX = e.x; e.stepZ = e.z; return; }
    if (e.stepDist === undefined) { e.stepDist = 0; e.nextStepDist = 1.0; e.stepX = e.x; e.stepZ = e.z; }
    var dx = e.x - e.stepX, dz = e.z - e.stepZ;
    e.stepX = e.x; e.stepZ = e.z;
    e.stepDist += Math.sqrt(dx * dx + dz * dz) * 0.6;
    if (e.stepDist > e.nextStepDist && e.onGround && !e.inWater) {
      e.nextStepDist = e.stepDist + St.STEP_DISTANCE;
      St.playSound(e, e.inLava ? St.SOUND.stepLava : St.SOUND.step, 1, 1, r);
    }
  };

  St.init = function () { St.ready = true; return St; };
  St.init();   // s135 merge: tickcheck caught it — nothing ever called St.init, so St.ready stayed false in the game
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
