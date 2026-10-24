// 07t_fly.js — QUEUE 0.2 "G18e remainder": the FLYING-AI SUBSTRATE, and parrot taming.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// ⚠⚠ WHY THIS EXISTS. Parrot has spawned since session 65 (`07h_entities.js`'s own 113-row
// table, `07i_entitylist.js`'s generic motion path) with NO entry in `Ai.ROSTER`
// (`07k_goals.js`) at all — no goal selector, so it never steers itself; it simply falls, the
// way any un-rostered mob does. `07n_tame.js`'s own header named the reason and refused to
// guess around it: vanilla's parrot moves through `FlightMoveControl` (not the ground
// `bcw.a()` MOVE_TO this engine's `Ai.stepToward` already ports) and `BirdNavigation` (a
// separate 3D air path graph, `BirdPathNodeMaker`, this engine has never built) — "approximating
// a parrot with ground goals would be exactly the 'silently plausible' wrong default
// `07i_entitylist.js`'s own header refuses to ship." This file is that substrate, read off the
// decompiled 1.18.2 source at `.decomp/net/minecraft/entity/{ai,passive}/…` (Yarn names
// throughout this jar's own mapping — no obf<->name lookup needed for this unit).
//
// ⚠⚠ WHAT IS A REAL PORT, AND WHAT IS A NAMED SIMPLIFICATION.
//   * `Fly.MoveControl` — `FlightMoveControl.tick()` VERBATIM (yaw/pitch rotlerp, the
//     onGround/airborne speed branch, `setUpwardSpeed`), the same "goals aim, a control moves"
//     split `Ai.stepToward`'s own header already established for the ground case (D-417).
//   * `Fly.travelMob` — the GENERAL branch of `LivingEntity.travel` (not the swim/lava/elytra
//     branches parrot never reaches from this unit's own goal list), extended with the ONE
//     axis ground travel never needed: `yya` (vertical input) and `noGravity`. Everything else
//     (friction, the `0.98` vertical drag, the airborne-vs-onGround accel split) is the SAME
//     formula `Ph.travelMob` (14b_physics.js) already has for a grounded mob's airborne tick —
//     read again here rather than duplicated by reference, because a flying mob's "airborne"
//     is its NORMAL state, not `Ph.travelMob`'s corner case.
//   * `Fly.FlyOntoTreeGoal` — `FlyOntoTreeGoal.locateTree()` is a REAL port (the exact
//     7×13×7 `BlockPos.iterate` box, the leaves-tag-below/air-at/air-above test). Its FALLBACK
//     (`WanderAroundFarGoal`'s own `AboveGroundTargeting`/`NoPenaltySolidTargeting`/
//     `FuzzyTargeting` chain, each built on `FuzzyPositions`' cone-biased, pathfinding-favour-
//     scored candidate search) is ported in `NS.Wither` (`flyWanderTarget`), and `Fly.randomAirTarget` delegates to it. The 0.1%-of-1‰ water-preserving branch inside `FlyOntoTreeGoal.getWanderTarget`
//     itself (a `FuzzyTargeting.find` result kept only when BOTH touching water AND a
//     `nextFloat() < 0.001` roll survives the reassignment right after it) is dropped outright
//     for the same reason `Fly.OWED` names below — completely different order of magnitude
//     than the tree search this unit exists for.
//   * `Fly.FollowOwnerGoal` — `FollowOwnerGoal.java`'s REAL numbers (the `144.0`/12-block
//     teleport threshold, the 10-try `[-3,3]×[-1,1]×[-3,3]` box excluding `|dx|<2 && |dz|<2`,
//     the `getTickCount(10)` steer interval) — this engine's OWN `Ai.FollowOwnerGoal`
//     (07k_goals.js, D-474) already ported the identical class for wolf/cat, so the constants
//     and the teleport-landing check (`Ai.pathTypeAt(...) === Ai.NodeType.WALKABLE`, the same
//     stand-in for `LandPathNodeMaker.getLandNodeType` that goal already uses) are REUSED, not
//     re-derived. What is NOT reused is the ground A* (`Ai.findPath`/`Ai.stepToward`): a
//     parrot steers straight at its owner through `Fl.MoveControl`, `BirdNavigation`'s own
//     graph-search left unported as `Fly.OWED` names below.
//   * `Fly.SitOnOwnerShoulderGoal` — the REAL gate (`isReadyToSitOnPlayer`: `e.age > 100`,
//     `TameableShoulderEntity.java`'s own literal; not spectator/flying/wet/in-powder-snow) is
//     wired and testable. The MOUNT itself (`TameableShoulderEntity.mountOnto` — adding an NBT
//     blob to the player's `ShoulderEntityLeft/Right` and discarding the parrot) is a RULING,
//     not a stub-and-forget: this engine's player has no shoulder-passenger slot and
//     `07j_entityrender.js` renders no such attachment (grepped this session — confirmed
//     absent), so there is nothing to mount ONTO. Named on `Fly.OWED`.
//
// ⚠ PARROT TAMING (`ParrotEntity.interactMob`, javap'd — Yarn source, not obfuscated, for this
// jar). `TAMING_INGREDIENTS` is the four seed items (`Items.field_8317/field_8188/field_8706/
// field_8309` = `wheat_seeds`/`melon_seeds`/`pumpkin_seeds`/`beetroot_seeds`, `Items.java`
// lines 852/1061/1062/1412) — a DIFFERENT roll and a DIFFERENT food list than `Tame.FOOD`'s own
// wolf bone / cat fish, so it is its own table here rather than a silently-widened `Tm.FOOD`.
// The roll is `random.nextInt(10) == 0` (the literal `10`, not remembered), matching this
// file's `Fly.TAME_CHANCE_DENOM`. `COOKIE` (`Items.field_8423`, line 1056) does two things in
// ONE branch, in this order: `addStatusEffect(new StatusEffectInstance(POISON, 900))` (id 19,
// `StatusEffects.java:62`, matching `NS.Effects.IDS.poison`) and THEN, UNCONDITIONALLY,
// `damage(DamageSource.player(...), Float.MAX_VALUE)` — the poison is flavour; the cookie kills
// a parrot outright regardless of resistance, every time, which is why `Fly.feedCookie` applies
// the effect and then calls `Combat.hurt` with `Fly.COOKIE_DAMAGE` rather than gating the kill
// on the effect landing. The empty-hand toggle (`!isInAir() && isTamed() && isOwner`) only
// works ON THE GROUND (`isInAir()` is `!onGround`, `ParrotEntity.java`'s own override) — a
// flying tamed parrot ignores an empty-hand click, same as vanilla.
(function (NS) {
  'use strict';

  var Fl = NS.Fly = { ready: true };   // self-contained, same shape `NS.Effects` already uses
  var Ai = NS.Ai;   // 07k_goals.js — loaded before this file (build.mjs order), never lazily

  // ═══════════════════════ 1. THE MOVE CONTROL — `FlightMoveControl.tick()` ══════════════════
  //
  // ⚠ ONE MOVE CONTROL OBJECT PER MOB, attached lazily at spawn (`Ai.ROSTER.parrot`, below) —
  // the SAME pattern `Ai.tickHead`'s own `e.look`/`e.body` already use for `Ai.LookControl`/
  // `Ai.BodyRotationControl`, not a per-tick closure a goal would have to recreate. `EL.tickMob`
  // (07i_entitylist.js) calls `.tick()` once per mob per game tick, right where it already
  // calls `Ai.tickHead(e)` — a goal calling `.setWantedPosition` any number of times before
  // that point only ever affects the LAST call this tick, matching vanilla's own
  // "MoveControl.tick() runs once, after every goal has had its say" ordering.
  Fl.ARRIVED_SQ = 2.5000003e-7;         // FlightMoveControl's own literal, one ULP off
                                        // Ai.MOVE_ARRIVED_SQ's (both are the jar's `2.5E-7F`
                                        // widened to double by two different call sites)
  Fl.PITCH_EPS = 1e-5;                  // the jar's own `1.0E-5F` guard on both axes

  /**
   * Per-species FLYING_SPEED attribute (`EntityAttributes.field_23720`), read off each mob's
   * own `createXAttributes()` — NOT extracted by `extract-entities.mjs` (`07h_entities.js`'s
   * own table only carries MOVEMENT_SPEED, `Ent.attrsOf(...).speed`), so this is its own small
   * table rather than a silent widening of that one. `parrot: 0.4` — `ParrotEntity.
   * createParrotAttributes()`, `.add(EntityAttributes.field_23720, 0.4F)`.
   */
  // QUEUE 0.2 (G18 mobs) -- `BeeEntity.createBeeAttributes` (.decomp line 535, field_23720),
  // the one attribute `entities.json`'s jar-extracted generic table has no column for (the
  // same gap this row already exists to cover for parrot).
  // (ghast has NO flying_speed attribute: createGhastAttributes is max_health + follow_range only, #2034)
  // QUEUE 0.00 part 2 -- WitherEntity.createWitherAttributes: FLYING_SPEED 0.6F (.decomp,
  // confirmed against field_23720, 07zzm_wither.js's own header).
  // FlightMoveControl(mob, maxPitchChange, noGravity): ParrotEntity 10, BeeEntity 20, WitherEntity 10.
  Fl.MAX_PITCH_CHANGE = { parrot: 10, bee: 20, wither: 10 };
  Fl.FLYING_SPEED = { parrot: 0.4, bee: 0.6, wither: 0.6 };

  /** `FlightMoveControl.tick()`, MOVE_TO branch, verbatim (the WAIT branch is `Fl.travelMob`'s
   *  own per-tick reset, mirroring how `EL.tickMob` already zeroes `e.zza` before the goals run
   *  — see that function's own header for why the reset has to happen before goals, not after). */
  Fl.MoveControl = function (e) {
    var wx = 0, wy = 0, wz = 0, wSpeed = 0, wanted = false;
    var path = null, pi = 0, pkey = '', repath = 0;   // BirdNavigation stand-in (#4659)
    /** A goal calls this every tick it wants the mob steered somewhere — never writes `e.x`
     *  et al. itself (D-417's own rule, restated for the air). */
    this.setWantedPosition = function (x, y, z, speedModifier) {
      wx = x; wy = y; wz = z; wSpeed = speedModifier; wanted = true;
      e.navigating = true;   // BirdNavigation has a current path: `!navigation.isDone()` (read by Ai.tickHead before this tick's move control)
    };
    /** Called once per mob per tick by `EL.tickMob`, after the goal selector. */
    this.tick = function () {
      if (!wanted) { e.noGravity = false; return; }
      wanted = false;
      e.noGravity = true;
      // BirdNavigation.startMovingTo: 6-connected air A* (Ai.findSwimPath opts.air), re-planned when the
      // goal cell changes or every 10 ticks; steer at the next node centre, straight if no route.
      // node types/penalties: Ai.birdNodePenalty (BirdPathNodeMaker).
      var k = Math.floor(wx) + ',' + Math.floor(wy) + ',' + Math.floor(wz);
      if (k !== pkey || --repath <= 0 || !path) {
        var pp = Ai.findSwimPath(e.x, e.y, e.z, wx, wy, wz, { air: true, mob: e, partial: true, maxNodes: 300 });
        path = pp && pp.length > 1 ? pp : null; pi = 1; pkey = k; repath = 10;
      }
      var tx = wx, ty = wy, tz = wz;
      if (path) {
        while (pi < path.length - 1 && Math.pow(path[pi].x + 0.5 - e.x, 2) + Math.pow(path[pi].y - e.y, 2) + Math.pow(path[pi].z + 0.5 - e.z, 2) < 0.25) pi++;
        if (pi < path.length - 1) { tx = path[pi].x + 0.5; ty = path[pi].y; tz = path[pi].z + 0.5; }
      }
      var d0 = tx - e.x, d1 = ty - e.y, d2 = tz - e.z;
      var distSq = d0 * d0 + d1 * d1 + d2 * d2;
      if (distSq < Fl.ARRIVED_SQ) { Ai.setMobSpeed(e, 0); e.yya = 0; return; }
      // `atan2($$2,$$0)*RAD-90` is vanilla's own yaw in ITS convention; this engine's yaw is
      // Minecraft's minus 180 (D-415, same turn `Ai.stepToward`'s own header already applies),
      // so `atan2(d0,-d2)` is that identical bearing already turned into this engine's frame.
      e.yaw = Ai.rotlerp(e.yaw, Math.atan2(d0, -d2), Ai.YAW_MAX_DELTA);
      var flySpeed = Fl.FLYING_SPEED[e.type] || 0;
      var f5 = wSpeed * (e.onGround ? Ai.movementSpeedOf(e) : flySpeed);
      Ai.setMobSpeed(e, f5);   // `setMovementSpeed(f5)` — `Mob.setSpeed`, sets `e.zza` too
      var horiz = Math.sqrt(d0 * d0 + d2 * d2);
      if (Math.abs(d1) > Fl.PITCH_EPS || horiz > Fl.PITCH_EPS) {
        // `setPitch(wrapDegrees(pitch, -atan2(dy, horiz), maxPitchChange))`; radians, vanilla's sign
        // (positive = down), float-rounded like the jar's `(float)` casts. Reads back via e.pitch.
        var want = Math.fround(-Math.atan2(d1, horiz));
        e.pitch = Math.fround(Ai.rotlerp(e.pitch || 0, want, (Fl.MAX_PITCH_CHANGE[e.type] || 10) * Math.PI / 180));
        e.yya = d1 > 0 ? f5 : -f5;   // `setUpwardSpeed`
      } else {
        e.yya = 0;
      }
    };
  };

  // ═══════════════════════ 2. THE TRAVEL LAW — `LivingEntity.travel`'s general branch ════════
  //
  // ⚠ THE SAME FORMULA `Ph.travelMob`'s OWN AIRBORNE BRANCH ALREADY USES (14b_physics.js,
  // D-417's own citation of `LivingEntity.java`'s `getMovementSpeed(f)`/`applyMovementInput`/
  // `Entity.movementInputToVelocity`), plus the two axes a grounded mob's travel never needs:
  // `e.yya` (vertical input, added UNROTATED — `movementInputToVelocity`'s own `y` component
  // passes through `MathHelper.sin/cos(yaw)` untouched, only x/z are rotated) and `e.noGravity`
  // (skips `$$29 -= $$1` — `LivingEntity.java`'s own gate, `!this.hasNoGravity()`).
  // `FlyingEntity.travel` (.decomp, ghast): water updateVelocity(0.02)+move+*0.8, lava *0.5, else
  // friction 0.91 (slip*0.91 on ground) on ALL THREE axes -- no gravity, no separate Y drag.
  // Fall damage is already off for ghast (Ph.NO_FALL_DAMAGE, #766).
  Fl.flyingTravel = function (e) {
    var Ph = NS.Physics, R = NS.Reg;
    // `isTouchingWater()`/`isInLava()`: any fluid cell overlapping the box shrunk by 0.001 (Entity
    // fluid tracking), not one block at y+0.4. Water wins when both touch (`travel` tests it first).
    var kind = NS.States.fluidKind, hw = (e.width !== undefined ? e.width : Ph.W) * 0.5 - 0.001, h = (e.height || Ph.H) - 0.001;
    var water = false, lava = false;
    for (var bx = Math.floor(e.x - hw), bx1 = Math.floor(e.x + hw); bx <= bx1; bx++)
      for (var by = Math.floor(e.y + 0.001), by1 = Math.floor(e.y + h); by <= by1; by++)
        for (var bz = Math.floor(e.z - hw), bz1 = Math.floor(e.z + hw); bz <= bz1; bz++) {
          var k = kind[Ph.blockAt(bx, by, bz)];
          if (k === 1) water = true; else if (k === 2) lava = true;
        }
    if (water) lava = false;
    var f = water ? 0.8 : lava ? 0.5 : e.onGround ? Ph.frictionOf(e) * 0.91 : 0.91;
    var zza = e.zza || 0, yya = e.yya || 0;
    var speed = (water || lava) ? 0.02 : e.onGround ? (e.mobSpeed || 0) * (0.16277136 / (f * f * f)) : Ph.MOB_FLYING_SPEED;
    e.vx += (zza * Math.sin(e.yaw)) * speed;
    e.vz += (zza * -Math.cos(e.yaw)) * speed;
    e.vy += yya * speed;
    Ph.move(e, e.vx, e.vy, e.vz);
    e.vx *= f; e.vy *= f; e.vz *= f;
  };

  Fl.travelMob = function (e) {
    var Ph = NS.Physics;
    if (e.type === 'ghast' || e.type === 'phantom') return Fl.flyingTravel(e);   // every FlyingEntity subclass
    var zza = e.zza || 0, yya = e.yya || 0;
    // `Entity.movementInputToVelocity`'s own normalize: the COMBINED (side=0, up, forward)
    // vector is clamped to length <=1 BEFORE the speed multiply, not each axis separately —
    // omitting this would let a parrot climbing and accelerating at once out-run its own speed.
    var lenSq = zza * zza + yya * yya;
    if (lenSq > 1) { var n = Math.sqrt(lenSq); zza /= n; yya /= n; }
    var sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
    var f3 = Ph.frictionOf(e);
    var speed = e.onGround ? (e.mobSpeed || 0) * (Ph.FRICTION_CUBE / (f3 * f3 * f3))
                            : Ph.MOB_FLYING_SPEED;   // `airStrafingSpeed`'s own default, shared
    e.vx += (zza * sy) * speed;
    e.vz += (zza * -cy) * speed;
    e.vy += yya * speed;
    // QUEUE 0.2 (raid loop remainder, this unit) -- `VexEntity.tick()`'s own `this.noClip = true`
    // .. `super.tick()` .. `this.noClip = false` bracket (.decomp `VexEntity.java:68-72`): the
    // ONE call here that would otherwise collide with blocks. `e.noclip` is the SAME generic
    // flag `Ph.move` already special-cases for spectator (14b_physics.js) -- a vex sets it for
    // exactly this call and restores whatever it was before, never forcing it false afterward
    // (nothing else in this engine ever sets a mob's own `e.noclip`, only a vex, only here).
    var vexWasNoclip = e.noclip;
    if (e.type === 'vex') e.noclip = true;
    Ph.move(e, e.vx, e.vy, e.vz);
    if (e.type === 'vex') e.noclip = vexWasNoclip;
    if (!e.noGravity) e.vy -= Ph.GRAVITY;
    e.vy *= Ph.DRAG_Y;
    var f1 = e.onGround ? f3 * Ph.AIR_FRICTION : Ph.AIR_FRICTION;
    e.vx *= f1;
    e.vz *= f1;
  };

  // ═══════════════════════ 3. FlyOntoTreeGoal — real tree search, named fallback ═════════════
  Fl.WANDER_CHANCE = 120;        // `WanderAroundGoal.DEFAULT_CHANCE` — 1-in-120 per tick
  Fl.TREE_SCAN_XZ = 3;           // `locateTree`'s own `getX()-3 .. getX()+3`
  Fl.TREE_SCAN_Y = 6;            // `locateTree`'s own `getY()-6 .. getY()+6`

  function isAirAt(x, y, z) { return NS.Physics.blockAt(x, y, z) === 0; }
  function leavesBelow(x, y, z) {
    var T = NS.Tags;
    if (!T || !T.ready || !T.blockTag) return false;
    var id = NS.Physics && NS.States ? NS.States.block[NS.Physics.blockAt(x, y, z)] : -1;
    // vanilla: `instanceof LeavesBlock || isIn(BlockTags.LOGS)`; the leaves tag is the LeavesBlock set
    var lv = T.blockTag('leaves'), lg = T.blockTag('logs');
    return (lv >= 0 && T.blockInCol(lv, id)) || (lg >= 0 && T.blockInCol(lg, id));
  }

  /** `FlyOntoTreeGoal.locateTree()` — verbatim box, verbatim test (leaves at `y-1`, air at
   *  `y` and `y+1`), skipping the mob's own cell the same way `!$$0.equals($$4)` does. Returns
   *  a block-centred point (`Vec3d.ofBottomCenter`) or null. */
  Fl.locateTree = function (e) {
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    // BlockPos.iterate order: X fastest, then Y, Z slowest (first match wins)
    for (var z = bz - Fl.TREE_SCAN_XZ; z <= bz + Fl.TREE_SCAN_XZ; z++) {
      for (var y = by - Fl.TREE_SCAN_Y; y <= by + Fl.TREE_SCAN_Y; y++) {
        for (var x = bx - Fl.TREE_SCAN_XZ; x <= bx + Fl.TREE_SCAN_XZ; x++) {
          if (x === bx && y === by && z === bz) continue;
          if (leavesBelow(x, y - 1, z) && isAirAt(x, y, z) && isAirAt(x, y + 1, z)) {
            return { x: x + 0.5, y: y, z: z + 0.5 };
          }
        }
      }
    }
    return null;
  };

  /**
   * `FlyGoal.getWanderTarget` (AboveGroundTargeting, then NoPenaltySolidTargeting, forward cone
   * of `FuzzyPositions.localFuzz`): the real chain lives in `NS.Wither` (07zzm_wither.js) and is
   * shared; this is the name bee/parrot callers use.
   */
  Fl.randomAirTarget = function (e, rand) {
    return NS.Wither.flyWanderTarget(e, rand || NS.fbRand);
  };

  /** `FuzzyTargeting.find(mob, 15, 15)`: 10 uniform `localFuzz` candidates, first valid wins (parrot's favour is 0):
   *  `upWhile` solid, then refuse water / path penalty.
   *  Before `upWhile`, `towardTarget` refuses `isInvalidPosition` = !BirdNavigation.isValidPosition = !hasSolidTopSurface(candidate). */
  Fl.fuzzyFind = function (e, rand, h, v) {
    var Ai = NS.Ai, S = NS.States;
    for (var t = 0; t < 10; t++) {
      var x = Math.floor(e.x + Math.floor(rand() * (2 * h + 1)) - h), y = Math.floor(e.y + Math.floor(rand() * (2 * v + 1)) - v),
          z = Math.floor(e.z + Math.floor(rand() * (2 * h + 1)) - h);
      if (y < NS.CFG.WORLD_MIN_Y || y > NS.CFG.WORLD_MAX_Y) continue;
      if (!(S.solid[NS.World.getBlock(x, y, z)] === 1)) continue;
      while (y < NS.CFG.WORLD_MAX_Y && NS.Physics.solidAt(x, y, z)) y++;
      if (S.waterIn[NS.World.getBlock(x, y, z)]) continue;
      if (Ai.pathPenalty(e, Ai.pathTypeAt(x, y, z)) !== 0) continue;
      return { x: x + 0.5, y: y, z: z + 0.5 };
    }
    return null;
  };
  /** `FlyOntoTreeGoal.getWanderTarget`: water -> fuzzy 15/15, then (nextFloat >= 0.001) locateTree REPLACES it even when
   *  null; null falls to `FlyGoal.getWanderTarget` (AboveGround / NoPenaltySolid, forward cone: `NS.Wither.flyWanderTarget`). */
  Fl.wanderTarget = function (e, rand) {
    var t = e.inWater ? Fl.fuzzyFind(e, rand, 15, 15) : null;
    if (rand() >= 0.001) t = Fl.locateTree(e);
    return t || NS.Wither.flyWanderTarget(e, rand);
  };

  /** `ParrotEntity.FlyOntoTreeGoal` (extends `WanderAroundFarGoal` extends `WanderAroundGoal`).
   *  `speed` is the constructor's own `1.0` (`new FlyOntoTreeGoal(this, 1.0)`); this engine's
   *  `e.flyMove` (attached by `Ai.ROSTER.parrot`) does the actual steering. */
  Fl.FlyOntoTreeGoal = function (e, speed, rand) {
    rand = rand || NS.fbRand;
    var tx = 0, ty = 0, tz = 0, have = false;
    function distSq() {
      var dx = tx - e.x, dy = ty - e.y, dz = tz - e.z;
      return dx * dx + dy * dy + dz * dz;
    }
    this.canUse = function () {
      // `WanderAroundGoal.canStart`'s own chance gate — `random.nextInt(120) != 0` refuses.
      if (Math.floor(rand() * Fl.WANDER_CHANCE) !== 0) return false;
      var t = Fl.wanderTarget(e, rand);
      if (!t) return false;
      tx = t.x; ty = t.y; tz = t.z; have = true;
      return true;
    };
    // `WanderAroundGoal.shouldContinue` — `!navigation.isIdle()`; this engine has no navigator
    // object (same stand-in `Ai.FollowParentGoal`'s own header already uses), so "not yet
    // arrived" is the same question asked directly.
    this.canContinueToUse = function () { return have && distSq() > Fl.ARRIVED_SQ; };
    this.start = function () {};
    this.stop = function () { have = false; };
    this.tick = function () {
      if (!have || !e.flyMove) return;
      e.flyMove.setWantedPosition(tx, ty, tz, speed);
    };
  };

  // ═══════════════════════ 4. FollowOwnerGoal — the flying variant ═══════════════════════════
  //
  // ⚠ SAME CLASS, SAME NUMBERS AS `Ai.FollowOwnerGoal` (07k_goals.js, D-474's own disassembly
  // of `FollowOwnerGoal.java` for wolf/cat) — the constants below are read from THAT header,
  // not re-derived, because it is the identical vanilla class. Only the MOVEMENT half differs:
  // wolf/cat steer through `Ai.findPath`/`Ai.stepToward` (ground A*); a parrot steers straight
  // at its owner through `Fl.MoveControl` (`BirdNavigation`'s own graph search is `Fly.OWED`).
  Fl.FollowOwnerGoal = function (e, speed, startDist, stopDist, getPlayers, rand) {
    rand = rand || NS.fbRand;
    var owner = null, timer = 0;
    var teleDistSq = Ai.FOLLOW_OWNER_TELEPORT_DIST * Ai.FOLLOW_OWNER_TELEPORT_DIST;
    function findOwner() {
      if (!e.tamed || e.owner !== 'player' || e.sitting) return null;
      var ps = getPlayers ? getPlayers() : [];
      return (ps && ps[0]) || null;
    }
    function distSq(o) {
      var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z;
      return dx * dx + dy * dy + dz * dz;
    }
    this.canUse = function () {
      var o = findOwner();
      if (!o) return false;
      if (distSq(o) < startDist * startDist) return false;
      owner = o;
      return true;
    };
    this.canContinueToUse = function () {
      if (!owner || e.sitting) return false;
      return distSq(owner) > stopDist * stopDist;
    };
    var oldWater = 0;
    this.start = function () {
      timer = 0;
      oldWater = Ai.pathPenalty(e, Ai.NodeType.WATER);
      (e.pathMalus || (e.pathMalus = {}))[Ai.NodeType.WATER] = 0;
    };
    this.stop = function () { owner = null; (e.pathMalus || (e.pathMalus = {}))[Ai.NodeType.WATER] = oldWater; };
    function tryTeleport() {
      for (var t = 0; t < Ai.FOLLOW_OWNER_TELEPORT_TRIES; t++) {
        var dx = -3 + Math.floor(rand() * 7);
        var dy = -1 + Math.floor(rand() * 3);
        var dz = -3 + Math.floor(rand() * 7);
        var tx = Math.floor(owner.x) + dx, ty = Math.floor(owner.y) + dy, tz = Math.floor(owner.z) + dz;
        if (Math.abs(tx - owner.x) < 2 && Math.abs(tz - owner.z) < 2) continue;   // against the owner's DOUBLE position
        if (Ai.pathTypeAt(tx, ty, tz) !== Ai.NodeType.WALKABLE) continue;
        e.x = tx + 0.5; e.y = ty; e.z = tz + 0.5;
        return true;
      }
      return false;
    }
    this.tick = function () {
      if (owner && e.look) e.look.setLookAt(owner.x, owner.y + (owner.eyeHeight || 0), owner.z);
      if (--timer > 0) return;
      timer = 10;   // `getTickCount(10)` — vanilla's own steer interval
      if (!owner || e.leashed || e.vehicle) return;
      if (distSq(owner) >= teleDistSq) { tryTeleport(); return; }
      if (e.flyMove) e.flyMove.setWantedPosition(owner.x, owner.y, owner.z, speed);
    };
  };

  // ═══════════════════════ 4b. EscapeDangerGoal + FollowMobGoal — the parrot's pri 0 / pri 3 ════
  //
  // s114 (QUEUE 0.2, Fl.OWED §4 closed): `ParrotEntity.initGoals` (.decomp ParrotEntity.java:149,
  // :156) adds `EscapeDangerGoal(this, 1.25)` at 0 and `FollowMobGoal(this, 1.0, 3.0F, 7.0F)` at 3.
  // Both are the generic vanilla classes, read in full: .decomp/net/minecraft/entity/ai/goal/
  // EscapeDangerGoal.java, FollowMobGoal.java. Steering is `Fl.MoveControl` straight at the point
  // (BirdNavigation's graph search stays §2), and "navigation idle" is "arrived", the same stand-in
  // `Fl.FlyOntoTreeGoal` already uses.
  Fl.ESCAPE_ATTACKER_FORGET = 100;   // LivingEntity.baseTick :429 `age - lastAttackedTime > 100` → setAttacker(null)
  Fl.ESCAPE_WATER_RANGE = 5;         // EscapeDangerGoal.canStart `locateClosestWater(world, mob, 5)`
  Fl.ESCAPE_WATER_VRANGE = 1;        // locateClosestWater's `BlockPos.findClosest(pos, 5, 1, …)`
  Fl.ESCAPE_H = 5;                   // `NoPenaltyTargeting.find(this.mob, 5, 4)`
  Fl.ESCAPE_V = 4;
  Fl.FOLLOW_MOB_INTERVAL = 10;       // FollowMobGoal.tick `getTickCount(10)`

  /** `LivingEntity.getAttacker()` as this engine can answer it: `Cb.notifyHurt` sets
   *  `e.lastHurtByEntity` and bumps `e.hurtSeq` on every landed hit; the attacker is forgotten 100
   *  ticks after the LAST hit (the `lastAttackedTime` window) or once it is dead. `e.age` is the
   *  mob's own tick counter (EL.tickMob); `e.hurtAge` is stamped by `Cb.notifyHurt` on the hit itself. */
  Fl.attackerOf = function (e) {
    var a = e.lastHurtByEntity;
    if (!a) return null;
    if ((e.age | 0) - (e.hurtAge | 0) > Fl.ESCAPE_ATTACKER_FORGET) return null;   // hurtAge: stamped by Cb.notifyHurt
    if (a.removed || (a.health !== undefined && a.health <= 0)) return null;
    return a;
  };
  function waterAt(x, y, z) {
    var st = NS.World.getBlock(x, y, z);
    return st > 0 && NS.States.block[st] === NS.Reg.id.water;
  }
  /** `EscapeDangerGoal.locateClosestWater`: refuse if the mob's own block has a collision shape;
   *  else `BlockPos.findClosest(pos, 5, 1, isIn(WATER))`, whose `iterateOutwards` order is by
   *  Manhattan distance (ties: y, then x, then z sweep order here). Waterlogged blocks are water
   *  too in vanilla (`getFluidState`) — this engine reads the water BLOCK only (named). */
  Fl.locateClosestWater = function (e, range) {
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    if (NS.Physics.solidAt(bx, by, bz)) return null;
    var best = null, bestD = 1e9, R = range || Fl.ESCAPE_WATER_RANGE, V = Fl.ESCAPE_WATER_VRANGE;
    for (var dy = -V; dy <= V; dy++) for (var dx = -R; dx <= R; dx++) for (var dz = -R; dz <= R; dz++) {
      var d = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
      if (d >= bestD) continue;
      if (waterAt(bx + dx, by + dy, bz + dz)) { best = { x: bx + dx, y: by + dy, z: bz + dz }; bestD = d; }
    }
    return best;
  };
  /** `EscapeDangerGoal` (priority 0, MOVE). isInDanger = attacker, or on fire (powder snow does
   *  not exist in this engine, so `shouldEscapePowderSnow` can never be true — named). */
  Fl.EscapeDangerGoal = function (e, speed, rand) {
    rand = rand || NS.fbRand;
    var tx = 0, ty = 0, tz = 0;
    this.active = false;
    function inDanger() { return !!Fl.attackerOf(e) || !!e.isOnFire; }
    function findTarget() {
      for (var t = 0; t < 10; t++) {   // NoPenaltyTargeting's FuzzyTargeting: 10 candidates
        var dx = Math.floor(rand() * (2 * Fl.ESCAPE_H + 1)) - Fl.ESCAPE_H;
        var dy = Math.floor(rand() * (2 * Fl.ESCAPE_V + 1)) - Fl.ESCAPE_V;
        var dz = Math.floor(rand() * (2 * Fl.ESCAPE_H + 1)) - Fl.ESCAPE_H;
        var x = Math.floor(e.x) + dx, y = Math.floor(e.y) + dy, z = Math.floor(e.z) + dz;
        if (y < -63 || y > 319 || NS.Physics.solidAt(x, y, z)) continue;
        tx = x + 0.5; ty = y; tz = z + 0.5;
        return true;
      }
      return false;
    }
    this.canUse = function () {
      if (!inDanger()) return false;
      if (e.isOnFire) {
        var w = Fl.locateClosestWater(e);
        if (w) { tx = w.x; ty = w.y; tz = w.z; return true; }
      }
      return findTarget();
    };
    this.canContinueToUse = function () {
      var dx = tx - e.x, dy = ty - e.y, dz = tz - e.z;
      return dx * dx + dy * dy + dz * dz > Fl.ARRIVED_SQ;
    };
    this.start = function () { this.active = true; this.target = { x: tx, y: ty, z: tz }; };
    this.stop = function () { this.active = false; };
    this.tick = function () { if (e.flyMove) e.flyMove.setWantedPosition(tx, ty, tz, speed); };
  };
  /** `FollowMobGoal(mob, speed, minDistance, maxDistance)` (priority 3, MOVE+LOOK). Target: the
   *  first visible MobEntity of ANOTHER class within the box expanded by maxDistance. The
   *  `$$3 <= minDistance` test in tick() compares a SQUARED distance to an unsquared one — the
   *  jar's own quirk, kept verbatim. */
  Fl.FollowMobGoal = function (e, speed, minDist, maxDist) {
    var target = null, countdown = 0, have = false, wx = 0, wy = 0, wz = 0;
    function candidates() {
      var EL = NS.EntityList, out = [];
      if (!EL || !EL.list) return out;
      for (var i = 0; i < EL.list.length; i++) {
        var o = EL.list[i];
        if (!o || o === e || o.removed || o.type === e.type || o.type === 'item' || o.type === 'arrow' ||
            o.type === 'experience_orb' || o.type === 'potion' || o.type === 'leash_knot' || o.type === 'tnt') continue;
        if (Math.abs(o.x - e.x) > maxDist + 1 || Math.abs(o.y - e.y) > maxDist + 2 || Math.abs(o.z - e.z) > maxDist + 1) continue;
        out.push(o);
      }
      return out;
    }
    function invisible(o) { var ES = NS.Effects; return !!(ES && ES.hasStatusEffect && ES.hasStatusEffect(o, 'invisibility')); }
    this.canUse = function () {
      var c = candidates();
      for (var i = 0; i < c.length; i++) if (!invisible(c[i])) { target = c[i]; return true; }
      return false;
    };
    this.canContinueToUse = function () {
      if (!target || !have) return false;
      var dx = wx - e.x, dy = wy - e.y, dz = wz - e.z;
      if (dx * dx + dy * dy + dz * dz <= Fl.ARRIVED_SQ) return false;   // navigation idle
      var tx = e.x - target.x, ty = e.y - target.y, tz = e.z - target.z;
      return tx * tx + ty * ty + tz * tz > minDist * minDist;
    };
    this.start = function () { countdown = 0; have = false; };
    this.stop = function () { target = null; have = false; };
    this.tick = function () {
      if (!target || e.leashHolder) return;
      if (e.look) e.look.setLookAt(target.x, target.y + (target.eyeHeight || 0), target.z);
      if (--countdown > 0) return;
      countdown = Fl.FOLLOW_MOB_INTERVAL;
      var dx = e.x - target.x, dy = e.y - target.y, dz = e.z - target.z;
      var d2 = dx * dx + dy * dy + dz * dz;
      if (!(d2 <= minDist * minDist)) { wx = target.x; wy = target.y; wz = target.z; have = true; }
      else {
        have = false;
        var tl = target.look && target.look.wanted;   // target.getLookControl().getLookX/Y/Z == mob.getX/Y/Z
        if (d2 <= minDist || (tl && tl.x === e.x && tl.y === e.y && tl.z === e.z)) {   // vanilla's own squared-vs-plain compare
          wx = e.x - (target.x - e.x); wy = e.y; wz = e.z - (target.z - e.z); have = true;
        }
      }
      if (have && e.flyMove) e.flyMove.setWantedPosition(wx, wy, wz, speed);
    };
  };

  // ═══════════════════════ 5. SitOnOwnerShoulderGoal — gate real, mount ruled OWED ═══════════
  //
  // ⚠ `isReadyToSitOnPlayer()` — `TameableShoulderEntity.java`'s own `READY_TO_SIT_COOLDOWN =
  // 100`, `this.ticks > 100` — `e.age` (incremented once per tick by `EL.tickMob`, same field
  // `Breed.tickAge` already reads) is that same "ticks alive" counter. The owner-state checks
  // (`!isSpectator`, `!getAbilities().flying`, `!isTouchingWater`, `!inPowderSnow`) are read
  // against what this engine's own player object exposes; spectator and powder snow do not
  // exist yet (named, not guessed — the checks simply cannot refuse on them, same standing
  // simplification `Tame.OWED`'s multiplayer line already states the shape of).
  Fl.SIT_ON_SHOULDER_COOLDOWN = 100;
  Fl.SitOnOwnerShoulderGoal = function (e, getPlayers) {
    var owner = null;
    function findOwner() {
      if (!e.tamed || e.owner !== 'player') return null;
      var ps = getPlayers ? getPlayers() : [];
      return (ps && ps[0]) || null;
    }
    this.canUse = function () {
      if (e.sitting) return false;
      if (!(e.age > Fl.SIT_ON_SHOULDER_COOLDOWN)) return false;
      var o = findOwner();
      if (!o) return false;
      var Gm = NS.Gamemode || NS.GameMode;
      if (Gm && Gm.isSpectator && Gm.isSpectator(o)) return false;   // `!isSpectator`
      if (Fl.inPowderSnow(o)) return false;       // `!inPowderSnow`
      if (o.flying) return false;                 // `!getAbilities().flying`
      if (o.inWater) return false;                // `!isTouchingWater`
      owner = o;
      return true;
    };
    this.canContinueToUse = function () { return false; };   // one-shot, like the jar's own
    this.stop = function () { owner = null; };
    // `SitOnOwnerShoulderGoal.tick`: boxes intersect, not sitting/leashed -> mountOnto (once).
    var mounted = false;
    this.canStop = function () { return !mounted; };
    this.start = function () { mounted = false; };
    this.tick = function () {
      if (mounted || e.sitting || e.leashed || !owner) return;
      var hw = ((e.width || 0.5) + (owner.width || 0.6)) / 2;
      if (Math.abs(e.x - owner.x) < hw && Math.abs(e.z - owner.z) < hw &&
          e.y < owner.y + (owner.height || 1.8) && owner.y < e.y + (e.height || 0.9)) mounted = Fl.mountOnto(e, owner);
    };
  };

  // ── shoulder slots: `PlayerEntity.addShoulderEntity` / `dropShoulderEntities` (.decomp) ──────
  // A slot holds a plain MobNbt-style record (`player.shoulderLeft/Right`, null = empty).
  Fl.mountOnto = function (e, p) {
    if (p.vehicle || !p.onGround || p.inWater) return false;
    var Mb = NS.MobNbt, rec = { type: e.type, dimension: e.dimension || 'overworld' };
    var f = Mb.fieldsFor(e.type);
    for (var i = 0; i < f.length; i++) if (e[f[i]] !== undefined) rec[f[i]] = e[f[i]];
    if (!p.shoulderLeft) p.shoulderLeft = rec;
    else if (!p.shoulderRight) p.shoulderRight = rec;
    else return false;
    p.shoulderAge = 0;
    NS.EntityList.remove(e);
    return true;
  };
  Fl.dropShoulderEntities = function (p) {
    if (!(p.shoulderAge > 20)) return;   // `shoulderEntityAddedTime + 20 < time`
    ['shoulderLeft', 'shoulderRight'].forEach(function (k) {
      var r = p[k]; p[k] = null;
      if (!r) return;
      var opts = { mobNbtRestore: true, dimension: r.dimension }, f = NS.MobNbt.fieldsFor(r.type);
      for (var i = 0; i < f.length; i++) if (r[f[i]] !== undefined) opts[f[i]] = r[f[i]];
      NS.EntityList.spawn(r.type, p.x, p.y + 0.7, p.z, opts);   // owner is the single player already
    });
  };
  /** Per-player-tick: age the slot, and the `PlayerEntity.tickMovement` drop conditions
   *  (fall distance, water, flying, sleeping, powder snow). */
  Fl.tickShoulders = function (p) {
    if (!p.shoulderLeft && !p.shoulderRight) return;
    p.shoulderAge = (p.shoulderAge || 0) + 1;
    if (NS.MobVoice) { NS.MobVoice.tickShoulder(p, p.shoulderLeft); NS.MobVoice.tickShoulder(p, p.shoulderRight); }
    // PlayerEntity.tickMovement: fallDistance > 0.5 || touchingWater || flying || sleeping || inPowderSnow
    if (p.fallDistance > 0.5 || p.inWater || p.flying || p.sleeping || Fl.inPowderSnow(p)) Fl.dropShoulderEntities(p);
  };
  Fl.inPowderSnow = function (o) { var U = NS.Undead; return !!(U && U.isInPowderSnow && NS.World && U.isInPowderSnow(o)); };

  // ═══════════════════════ 6. PARROT TAMING — `ParrotEntity.interactMob`, javap'd ════════════
  Fl.TAMING_FOOD = { wheat_seeds: true, melon_seeds: true, pumpkin_seeds: true, beetroot_seeds: true };
  Fl.TAME_CHANCE_DENOM = 10;         // `random.nextInt(10) == 0`, the literal
  Fl.COOKIE_ITEM = 'cookie';
  Fl.COOKIE_POISON_DURATION = 900;   // `StatusEffectInstance(POISON, 900)` — the literal
  Fl.COOKIE_DAMAGE = 3.4028235e38;   // `Float.MAX_VALUE` — always lethal, resistance or not

  /** Feed a parrot one of the four taming seeds. Same `{consumed, tamed}` shape `Tm.feed`
   *  (07n_tame.js) already returns, for the same reason: the item is spent on every attempt,
   *  success or not, and a caller needs to tell "wrong food" (`null`) from "food, no roll yet". */
  Fl.feed = function (e, itemName, ctx) {
    if (!e || e.removed || e.type !== 'parrot' || e.tamed) return null;
    if (!Fl.TAMING_FOOD[itemName]) return null;
    var rand = (ctx && ctx.random) || NS.fbRand;
    // ParrotEntity.interactMob: unless isSilent(), entity.parrot.eat at 1.0 / 1.0 + (r - r) * 0.2
    var S = NS.Sound;
    if (!e.silent && S && S.play) {
      S.play('entity.parrot.eat', { x: e.x, y: e.y, z: e.z, volume: 1,
                                    pitch: 1 + (rand() - rand()) * 0.2, source: 'neutral', listener: NS.Player });
    }
    var roll = Math.floor(rand() * Fl.TAME_CHANCE_DENOM);
    if (roll === 0) {
      e.tamed = true;
      e.owner = 'player';
      e.sitting = false;
    }
    // sendEntityStatus(7) hearts on success, (6) smoke on failure (TameableEntity.showEmoteParticle)
    var Br = NS.Breed, Px = NS.Particle;
    if (Br && Px && Br.particlePoint) {
      var pt = Br.particlePoint(e, rand);
      Px.spawnBurst(e.tamed ? 'heart' : 'smoke', pt[0], pt[1], pt[2], rand);
    }
    return { consumed: true, tamed: !!e.tamed };
  };

  /** A cookie on ANY parrot (tamed or not — `interactMob`'s cookie branch never checks
   *  `isTamed()`): poison, then an unconditional lethal hit. Returns `{consumed, killed}`, or
   *  `null` when `e`/`itemName` do not match at all. */
  Fl.feedCookie = function (e, itemName, ctx) {
    if (!e || e.removed || e.type !== 'parrot' || itemName !== Fl.COOKIE_ITEM) return null;
    if (NS.Effects && NS.Effects.ready) {
      NS.Effects.addStatusEffect(e, 'poison', Fl.COOKIE_POISON_DURATION, 0, false, true);
    }
    // ParrotEntity.interactMob:281-283: damage only if the player is creative or the parrot is not invulnerable
    if (NS.Combat && NS.Combat.hurt && (!e.invulnerable || (ctx && ctx.player && NS.Gamemode && NS.Gamemode.isCreative(ctx.player)))) NS.Combat.hurt(e, Fl.COOKIE_DAMAGE, (ctx && ctx.now) || 0, true);
    return { consumed: true, killed: !!e.dead };
  };

  /** #1228 -- `ParrotEntity.setNearbySongPlaying(pos, playing)` (the jukebox's caller side). */
  Fl.setNearbySongPlaying = function (e, x, y, z, playing) {
    if (!e || e.type !== 'parrot') return;
    e.songSource = { x: x | 0, y: y | 0, z: z | 0 };
    e.songPlaying = !!playing;
  };
  /** `ParrotEntity.isSongPlaying`. */
  Fl.isSongPlaying = function (e) { return !!(e && e.songPlaying); };
  /** Start of `ParrotEntity.tickMovement`: the party ends once the parrot is beyond 3.46 of
   *  the jukebox centre or the block there is no longer a jukebox. */
  Fl.tickSong = function (e) {
    var s = e.songSource;
    if (s) {
      var dx = s.x + 0.5 - e.x, dy = s.y + 0.5 - e.y, dz = s.z + 0.5 - e.z;
      var W = NS.World, R = NS.States;
      var isJuke = !!(W && R && R.block && R.block[W.getBlock(s.x, s.y, s.z)] === R.block[R.stateOf('jukebox')]);
      if (dx * dx + dy * dy + dz * dz <= 3.46 * 3.46 && isJuke) return;
    }
    e.songPlaying = false; e.songSource = null;
  };

  /** Empty-hand right-click on a tamed, GROUNDED parrot: toggle sitting. `!isInAir()` —
   *  `ParrotEntity.isInAir()` is `!onGround`, so a flying tamed parrot refuses this, unlike
   *  wolf/cat's own `Tm.toggleSit` which has no such gate. */
  Fl.toggleSit = function (e) {
    if (!e || e.type !== 'parrot' || !e.tamed) return false;
    if (!e.onGround) return false;
    e.sitting = !e.sitting;
    return true;
  };

  // ═══════════════════════ 7. THE ROSTER ENTRY — `ParrotEntity.initGoals()` ══════════════════
  //
  // ⚠ PRIORITIES ARE THE JAR'S OWN (0/0/1/2/2/2/3/3, `ParrotEntity.java:148-156`, javap'd —
  // read straight, not this session's placement the way cow/zombie/skeleton's own D-383
  // caveat still applies). Priority-0 `EscapeDangerGoal`/`SwimGoal` and priority-3
  // `FollowMobGoal` are wired since s114 (§4b above). `e.flyMove` is attached here, once, at
  // spawn — the same lazy-once-at-spawn shape `e.ai` itself is built with (`EL.spawn`,
  // 07i_entitylist.js), not recreated by any goal.
  Ai.ROSTER.parrot = function (e, ctx) {
    if (!e.flyMove) e.flyMove = new Fl.MoveControl(e);
    var players = ctx.players || function () { return []; };
    var gs = new Ai.GoalSelector();
    gs.add(0, Ai.MOVE, new Fl.EscapeDangerGoal(e, 1.25, ctx.random));   // EscapeDangerGoal(this,1.25) — s114
    gs.add(0, Ai.JUMP, new Ai.SwimGoal(e, ctx.random));                  // SwimGoal(this) — s114
    gs.add(1, Ai.LOOK, new Ai.LookAtPlayerGoal(e, players, 8.0));   // LookAtEntityGoal(this,Player,8F)
    gs.add(2, Ai.MOVE | Ai.JUMP, new Ai.SitGoal(e));
    gs.add(2, Ai.MOVE, new Fl.FollowOwnerGoal(e, 1.0, 5, 1, players, ctx.random));   // (this,1.0,5F,1F,true)
    gs.add(2, Ai.MOVE, new Fl.FlyOntoTreeGoal(e, 1.0, ctx.random));
    gs.add(3, 0, new Fl.SitOnOwnerShoulderGoal(e, players));   // no ground-truth control flag to claim (Fl.OWED §1)
    gs.add(3, Ai.MOVE | Ai.LOOK, new Fl.FollowMobGoal(e, 1.0, 3.0, 7.0));   // FollowMobGoal(this,1.0,3F,7F) — s114
    return gs;
  };

  // #1224 -- `ParrotEntity.getVariant` clamps 0..4; `extract-mob-textures.mjs` bakes the five
  // sheets (red_blue, blue, green, yellow_blue, grey) as `parrot`, `parrot#1`..`parrot#4`.
  Fl.PARROT_SKIN = ['parrot', 'parrot#1', 'parrot#2', 'parrot#3', 'parrot#4'];
  Fl.skinKey = function (e) {
    if (!e || e.type !== 'parrot') return null;
    return Fl.PARROT_SKIN[Math.max(0, Math.min(4, e.parrotVariant | 0))];
  };

  // ═══════════════════════ 8. VEX — `VexEntity.VexMoveControl`, verbatim ═══════════════════════
  //
  // ⚠⚠ WHY THIS IS A SEPARATE CONTROL, NOT `Fl.MoveControl` REUSED. `VexEntity` overrides
  // `moveControl` with its OWN class (`.decomp/net/minecraft/entity/mob/VexEntity.java`,
  // `VexMoveControl`, read in full this pass) — it never sets `forwardSpeed`/`upwardSpeed`
  // (the `zza`/`yya` movement-input axes `Fl.MoveControl`/`Fl.travelMob` steer through for a
  // parrot) at all; it ADDS VELOCITY DIRECTLY every tick it is moving, then halves it and stops
  // once within the mob's own average AABB side length of the target. Because a vex's own
  // `e.zza`/`e.yya` are therefore always exactly zero (no goal here ever writes them either),
  // `Fl.travelMob` (§2 above) is STILL the right per-tick travel law to run for it unchanged —
  // with zero movement input it reduces to exactly `Ph.move` on the control's own velocity plus
  // friction/no-gravity, which is `LivingEntity.travel`'s general branch with nothing else
  // added, the same branch a vex actually takes (it has no swim/elytra/passenger goal). Wiring
  // `e.flyMove = new Fl.VexMoveControl(e)` is therefore enough to make `07i_entitylist.js`'s own
  // `if (e.flyMove) e.flyMove.tick(); ... else if (e.flyMove...) Fl.travelMob(e);` dispatch run
  // BOTH real vanilla pieces for a vex with no new travel-law code at all.
  //
  // ── CLOSED THIS PASS (QUEUE 0.2, raid loop remainder) — `this.noClip = true` around
  // `super.tick()` (`Entity.move`'s own block-collision skip) is now real: `Fl.travelMob`'s own
  // `Ph.move` call sets `e.noclip` for a vex and restores it after, the same generic bypass
  // `Ph.move` (14b_physics.js) already gave spectator. Formerly `Fl.OWED` §7. ──
  Fl.VexMoveControl = function (e) {
    var targetX = 0, targetY = 0, targetZ = 0, speed = 0, moving = false;
    /** `MoveControl.moveTo(x,y,z,speedModifier)` — sets state to MOVE_TO. */
    this.moveTo = function (x, y, z, speedModifier) {
      targetX = x; targetY = y; targetZ = z; speed = speedModifier; moving = true;
    };
    /** `MoveControl.isMoving()` — `ChargeTargetGoal.canStart`/`LookAtTargetGoal.canStart` both
     *  gate on `!getMoveControl().isMoving()` (07k_goals.js's own `Ai.ChargeTargetGoal`/
     *  `Ai.VexLookAtTargetGoal`). */
    this.isMoving = function () { return moving; };
    /** `VexMoveControl.tick()`, verbatim. Called once per vex per tick by `07i_entitylist.js`'s
     *  own `if (e.flyMove) e.flyMove.tick()` (the same slot `Fl.MoveControl`'s own tick already
     *  occupies for parrot) — `VexEntity.tick()`'s own unconditional `setNoGravity(true)` is
     *  folded in HERE rather than a second per-type hook, since this control already runs every
     *  tick regardless of `moving`. */
    this.tick = function () {
      e.noGravity = true;
      if (!moving) return;
      var d0 = targetX - e.x, d1 = targetY - e.y, d2 = targetZ - e.z;
      var len = Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
      // `Box.getAverageSideLength()` — `(maxX-minX + maxY-minY + maxZ-minZ) / 3`; a vex's own
      // AABB is `width, height, width` (D-336's dimensions table), so this is `(2*width+height)/3`.
      var avgSide = (2 * (e.width || 0.4) + (e.height || 0.8)) / 3;
      if (len < avgSide) {
        moving = false;
        e.vx *= 0.5; e.vy *= 0.5; e.vz *= 0.5;
        return;
      }
      var f = speed * 0.05 / len;
      e.vx += d0 * f; e.vy += d1 * f; e.vz += d2 * f;
      if (!e.target) {
        e.yaw = Math.atan2(e.vx, -e.vz);      // engine yaw convention (D-415), off the POST-add velocity, same as vanilla's own `getVelocity()` read here
      } else {
        e.yaw = Math.atan2(e.target.x - e.x, -(e.target.z - e.z));
      }
      e.yBodyRot = e.yaw;                     // `setYaw(..); this.vex.bodyYaw = this.vex.getYaw()`
    };
  };

  // ═══════════════════════ 9. VEX — life ticks, `VexEntity.tick()`'s starve half ══════════════
  //
  // `e.vexAlive`/`e.vexLifeTicks` are only ever set by `SP.SummonVexGoal`'s own `castSpell`
  // (07v_spell.js) — the ONE call site `VexEntity.setLifeTicks` has in vanilla too
  // (`EvokerEntity$SummonVexGoal.castSpell`, javap'd) — so a vex placed any other way (this
  // engine has no other way yet) never starves, matching vanilla exactly.
  Fl.tickVexLife = function (e, ctx) {
    if (!e.vexAlive) return;
    e.vexLifeTicks = (e.vexLifeTicks || 0) - 1;
    if (e.vexLifeTicks <= 0) {
      e.vexLifeTicks = 20;
      // DamageSource.STARVE: setBypassesArmor + setUnblockable (DamageSource.java:25), 1.0F (VexEntity.java:68-77).
      if (ctx && ctx.hurt) ctx.hurt(e, 1.0, { bypassArmor: true, unblockable: true, source: 'starve' });
    }
  };

  Fl.OWED = [
    // §1 STRUCK #5125: the fall-distance drop is read in Fl.tickShoulders.
    // §2 STRUCK #4659: Fl.MoveControl plans a 6-connected air A* (Ai.findSwimPath opts.air) and steers node to node.
    // §2 STRUCK #5125: Ai.birdNodeType/birdNodePenalty (BirdPathNodeMaker) gate the air A*.
    // §3 STRUCK #3529: FlyOntoTreeGoal.getWanderTarget is Fl.wanderTarget (water fuzzy 15/15, locateTree, FlyGoal cone).
    // §4 STRUCK s114: EscapeDangerGoal(1.25)/SwimGoal at 0 and FollowMobGoal(1.0,3,7) at 3 are
    // rostered (Fl.EscapeDangerGoal/Fl.FollowMobGoal, §4b). Residue, named: FollowMobGoal's
    // residue closed #4660: the target's LookControl test is read (target.look.wanted), the attacker
    // window is `hurtAge` (stamped by Cb.notifyHurt), and NoPenaltyTargeting's guessBest scoring is
    // exact as-is: ParrotEntity has no getPathfindingFavor override (PathAwareEntity returns 0), so
    // strict `>` keeps the first valid candidate of the 10 — what findTarget already does.
    '§5 dance ANIMATION (`imitateNearbyMob` STRUCK #8756: MobVoice.parrotImitate, parrotimitatecheck) (`flapWings` state + slow fall: ported, #1225, Passive.tickChickenFlap) — no ' +
      'render or sound hook for either was cheap enough to add alongside the AI substrate this ' +
      'pass; the goal/physics/taming substrate this unit exists for does not depend on either.',
    // §6 STRUCK (#5907): Fl.MoveControl writes e.pitch (FlightMoveControl maxPitchChange per mob).
    // ── §7 STRUCK (QUEUE 0.2, this unit): vex `noClip` is real now — `Fl.travelMob` sets/
    // restores `e.noclip` around its `Ph.move` call for a vex, mirroring `VexEntity.tick()`'s
    // own bracket exactly (see `Fl.travelMob`'s own header, above). ──
    '§8 the STARVE damage source a vex\'s own life-ticks half deals itself (`Fl.tickVexLife`) ' +
      'is not a modelled `DamageSource` distinct from any other 1-damage hit — this engine has ' +
      'no damage-source-typed hit path at all (Eq.OWED, 07y_equip.js, names the identical gap ' +
      'for why `fire_protection` et al. can never trigger); harmless since nothing here reads ' +
      'the source off a vex\'s own death.'
  ];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
