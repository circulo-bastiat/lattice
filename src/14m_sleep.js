// 14m_sleep.js — loop/beds (G19c, QUEUE 0.2 G18c "left: bed reset (G19c)"): BEDS — SLEEPING.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// `Use.OWED`'s own "beds: sleeping, the night skip and the spawn point — G19c" line (14l_use.js)
// is struck by this file. Everything here is read off `.decomp` this session, in full unless a
// comment says otherwise:
//
//   BedBlock.onUse (.decomp/net/minecraft/block/BedBlock.java:71-108) — normalise the click to
//   the HEAD cell (BedPart.field_12560, the FIRST declared BedPart constant per `.decomp/
//   names.tsv`'s own enum-field order, `07zu_poi.js`'s own header already rules on this the same
//   way), explode if `!isBedWorking` (nether/end), wake a sleeping villager or refuse if
//   OCCUPIED, else `PlayerEntity.trySleep`.
//   ServerPlayerEntity.trySleep (.decomp/net/minecraft/server/network/ServerPlayerEntity.java:
//   826-865) — already sleeping/dead (silent refusal, no message) -> too far
//   (`isBedTooFarAway`, :874-880) -> obstructed (`isBedObstructed`, :882-885) -> `setSpawnPoint`
//   (UNCONDITIONALLY, even if what follows refuses) -> daytime (`world.isDay()`) -> (unless
//   creative) a `HostileEntity` within an 8×5×8 box of the bed that `isAngryAt` the player.
//   LivingEntity.sleep/wakeUp (.decomp/net/minecraft/entity/LivingEntity.java:3125-3169) — the
//   pose, the position (`bed + (0.5, 0.6875, 0.5)`), `BedBlock.OCCUPIED`.
//   ServerWorld.tick's own sleep-skip block (.decomp/net/minecraft/server/world/ServerWorld.java
//   :266-284) and `SleepManager` (.decomp/net/minecraft/server/world/SleepManager.java) — night
//   skips once `sleeping >= requirement` AND `canResetTimeBySleeping (sleepTimer>=100) >=
//   requirement`, `requirement = max(1, ceil(players * playersSleepingPercentage / 100))`. This
//   engine has exactly one player, so `requirement` is 1 for every percentage 1..100 — the whole
//   `SleepManager` head-count machinery collapses to "is the one player asleep with a full
//   timer", which is what `Sleep.tick` below tests directly rather than porting a counter class
//   built for a player list this engine does not have.
//
// ── WHAT THIS FILE CANNOT DO, NAMED RATHER THAN GUESSED (`Sleep.OWED`, bottom) ─────────────
// This engine is OVERWORLD-ONLY (07zz1_phantom.js:288), so no click reaches `BedBlock.onUse`'s
// `!isBedWorking(world)` branch (the bed EXPLODES, power 5.0) in play; #35 writes it against
// `Sleep.dimension` so a nether/end can flip it, and bedcheck flips it. struck s117: `BedBlock.findWakeUpPosition`'s real
// candidate search (.decomp:225-283) is now built (`findWakeUpPosition`/`findWakeUpPosition3`,
// `Sleep.wake` below) — vanilla's OWN fallback position, `bed.up() + (0.5, 0.1, 0.5)`
// (.decomp/net/minecraft/entity/LivingEntity.java:3150-3155), is kept only for the one case
// the search itself has no facing to run from: the bed is gone by the time the sleeper wakes.

(function (NS) {
  'use strict';

  var Sleep = NS.Sleep = { ready: false };
  // `BedBlock.isBedWorking` (.decomp) is `world.getDimension().isBedWorking()`: true only in the
  // overworld. This engine has only the overworld, so the flag defaults to 'overworld'; a future
  // nether/end (or a test) sets it, and `Sleep.use` then takes vanilla's explosion branch.
  Sleep.dimension = 'overworld';
  Sleep.isBedWorking = function () { return Sleep.dimension === 'overworld'; };
  var R, S, B, W;

  Sleep.init = function (world) {
    R = NS.Reg; S = NS.States; B = NS.Behave; W = world || NS.World;
    Sleep.ready = !!(R && R.ready && S && S.ready && W);
    return Sleep;
  };

  function say(msg) { if (NS.Hud && NS.Hud.say) NS.Hud.say(msg); }

  function changed(x, y, z) {
    if (B && B.changed) B.changed(x, y, z);
    if (NS.Redstone && NS.Redstone.ready && NS.Redstone.update) NS.Redstone.update(x, y, z);
  }

  /**
   * The SAME "does a full, solid cube sit here" stand-in `Enderman.PlaceBlockGoal`'s carried-
   * block placement and `SnowGolem.tryConstruct` already use (07zg_enderman.js/
   * 07zq_snowgolem.js's own `fullCubeSupportAt`, both cited as reusing one another rather than
   * inventing a new name) — `LivingEntity.doesNotSuffocate`'s real collision-shape test is not
   * reified as its own predicate anywhere in this engine yet, so this is the SAME approximation
   * as those two, not a fresh one.
   */
  function solidFullCube(x, y, z) {
    var Ph = NS.Physics;
    if (!S || !Ph) return false;
    var st = W.getBlock(x, y, z);
    if (st === undefined || st === null) return false;
    return S.solid[st] === 1 && Ph.shapesForState(st) === Ph.FULL_CUBE;
  }

  /**
   * resolveBed(x,y,z,state) -> {hx,hy,hz,hState, fx,fy,fz,fState} or null.
   * `BedBlock.onUse`'s own normalise-to-HEAD step (.decomp:75-80), except it also resolves the
   * FOOT cell the other way, because both `isBedTooFarAway`/`isBedObstructed` (.decomp:874-885)
   * test HEAD **and** FOOT and this file has one call site for each rather than two.
   * ⚠ NULL MEANS THE BED IS BROKEN (the other half is gone, or is no longer the same coloured
   * bed) — `BedBlock.onUse` returns CONSUME-and-nothing for exactly this case (:78-79); the
   * caller does the same.
   */
  function resolveBed(x, y, z, state) {
    var PL = NS.Player, P_ = R.PROP, V = R.PVAL;
    if (!PL || !PL.dirStep || P_.part === undefined || P_.facing === undefined) return null;
    var part = S.propValue(state, P_.part);
    var facing = S.propValue(state, P_.facing);
    var step = PL.dirStep(V, facing);
    if (!step) return null;
    if (part === V.head) {
      var fx = x - step[0], fz = z - step[1];
      var fst = W.getBlock(fx, y, fz);
      if (S.block[fst] !== S.block[state]) return null;
      return { hx: x, hy: y, hz: z, hState: state, fx: fx, fy: y, fz: fz, fState: fst };
    }
    if (part === V.foot) {
      var hx = x + step[0], hz = z + step[1];
      var hst = W.getBlock(hx, y, hz);
      if (S.block[hst] !== S.block[state]) return null;
      return { hx: hx, hy: y, hz: hz, hState: hst, fx: x, fy: y, fz: z, fState: state };
    }
    return null;
  }

  /** `BedBlock.OCCUPIED`, written on BOTH cells in the same call — the door precedent
   *  (14l_use.js's own `DoorBlock.use`, "BOTH HALVES, IN THE SAME CALL"): this engine's bed
   *  placement already writes both halves in step, and `getStateForNeighborUpdate`'s own
   *  OCCUPIED-copy-across-halves (.decomp:153-159) is not reified as a live neighbor-update
   *  rule anywhere in this engine, so this call site is what keeps them agreeing instead. */
  function setOccupied(bed, val) {
    var P_ = R.PROP, V = R.PVAL;
    if (P_.occupied === undefined) return;
    var v = val ? V['true'] : V['false'];
    var hst = S.withProp(bed.hState, P_.occupied, v);
    var fst = S.withProp(bed.fState, P_.occupied, v);
    W.setBlock(bed.hx, bed.hy, bed.hz, hst);
    W.setBlock(bed.fx, bed.fy, bed.fz, fst);
    changed(bed.hx, bed.hy, bed.hz);
    changed(bed.fx, bed.fy, bed.fz);
    bed.hState = hst; bed.fState = fst;
  }

  /** `ServerPlayerEntity.isBedTooFarAway` (.decomp:874-880): `Vec3d.ofBottomCenter` (x+0.5, y,
   *  z+0.5) against the PLAYER's own feet position, within (3, 2, 3) — tested against HEAD **or**
   *  FOOT, either one close enough is a pass (the real code ORs the two cell tests). */
  function closeEnough(P, bx, by, bz) {
    return Math.abs(P.x - (bx + 0.5)) <= 3.0 &&
           Math.abs(P.y - by) <= 2.0 &&
           Math.abs(P.z - (bz + 0.5)) <= 3.0;
  }

  /** `ServerPlayerEntity.isBedObstructed` (.decomp:882-885): the cell directly above HEAD or
   *  FOOT must not suffocate — `solidFullCube`'s own header names the approximation. */
  function obstructed(bed) {
    return solidFullCube(bed.hx, bed.hy + 1, bed.hz) || solidFullCube(bed.fx, bed.fy + 1, bed.fz);
  }

  /**
   * `ServerPlayerEntity.trySleep`'s own monster gate (.decomp:840-852): a `HostileEntity`
   * (`isAngryAt` defaults `true`, HostileEntity.java:119) inside an 8×5×8 box centred on the
   * bed's bottom-centre. `SnowGolem.isMonster`/`monsterTypes` (07zq_snowgolem.js) is reused
   * whole rather than duplicated — it is that same file's own `Monster`-interface predicate,
   * built off `Spawn.PEACEFUL_DISALLOWED` plus `piglin`, which is the roster this engine
   * already treats as "every HostileEntity/Monster it can spawn". `ZombifiedPiglinEntity.isAngryAt`
   * (.decomp:240) is `shouldAngerAt`, i.e. `angerTime > 0`; every other HostileEntity is true.
   */
  function monstersNearby(bed) {
    var EL = NS.EntityList, SG = NS.SnowGolem;
    if (!EL || !EL.list || !SG || !SG.isMonster) return false;
    var cx = bed.hx + 0.5, cy = bed.hy, cz = bed.hz + 0.5;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (!SG.isMonster(o)) continue;
      if (o.type === 'zombified_piglin' && !((o.angerTime | 0) > 0)) continue;
      if (Math.abs(o.x - cx) < 8 && Math.abs(o.y - cy) < 5 && Math.abs(o.z - cz) < 8) return true;
    }
    return false;
  }

  /** `ServerPlayerEntity.setSpawnPoint` (.decomp:1465-1481): stores the point and, ONLY when it
   *  actually changed, sends "block.minecraft.set_spawn" ("Respawn point set"). This engine has
   *  one dimension, so the `RegistryKey<World>`/`spawnForced` fields vanilla also stores are not
   *  carried — there is nothing they could ever disagree with here. */
  Sleep.setSpawnPoint = function (P, x, y, z, yaw) {
    var sp = P.spawnPoint;
    var same = sp && sp.x === x && sp.y === y && sp.z === z;
    P.spawnPoint = { x: x, y: y, z: z, yaw: yaw || 0 };
    if (!same) say('Respawn point set');
  };

  /** `LivingEntity.sleep` (.decomp:3125-3137): pose + position + OCCUPIED, and (loop/beds,
   *  closing `07zz1_phantom.js`'s own `Ph.resetTimeSinceRest` hook) `ServerPlayerEntity.sleep`'s
   *  own `resetStat(TIME_SINCE_REST)` (.decomp:872-875), called at the START of sleeping. */
  function doSleep(P, bed) {
    P.sleeping = true;
    P.sleepPos = { x: bed.hx, y: bed.hy, z: bed.hz };
    P.x = bed.hx + 0.5; P.y = bed.hy + 0.6875; P.z = bed.hz + 0.5;
    P.px = P.x; P.py = P.y; P.pz = P.z;
    P.ex = P.x; P.ey = P.y; P.ez = P.z;
    P.vx = 0; P.vy = 0; P.vz = 0;
    P.sleepTimer = 0;
    // struck s117: EntityPose.SLEEPING (LivingEntity.java:158 SLEEPING_DIMENSIONS = 0.2x0.2,
    // :3184-3185 getEyeHeight -> 0.2F for that pose) -- `Sleep.wake` below restores the
    // standing pose; `Ph.pose` (14b_physics.js) never runs while `P.sleeping` (14_player.js's
    // own sleeping branch skips `Physics.tick` entirely), so this sticks until woken.
    P.height = 0.2; P.eyeHeight = 0.2;
    // struck s117: the sleeping camera yaw lock (Camera.update, .decomp Camera.java:54-58 --
    // `getSleepingDirection()`/`BedBlock.getDirection` is just the bed's own FACING) is the
    // OPPOSITE of the bed's FACING (`asRotation() - 180`); `P.sleepYaw` is read by
    // `G.syncCamera` (10_gfx.js) instead of `P.yaw` for as long as `P.sleeping` is true -- the
    // entity's own `P.yaw` is left untouched, same as vanilla's camera-only override.
    var facing = S.propValue(bed.hState, R.PROP.facing);
    var fstep = NS.Player && NS.Player.dirStep ? NS.Player.dirStep(R.PVAL, facing) : null;
    P.sleepYaw = fstep ? Math.atan2(-fstep[0], fstep[1]) : P.yaw;
    setOccupied(bed, true);
    if (NS.Stats && NS.Stats.onSleep) NS.Stats.onSleep();
    if (NS.Phantom && NS.Phantom.resetTimeSinceRest) NS.Phantom.resetTimeSinceRest();
  }

  /**
   * struck s117: `BedBlock.findWakeUpPosition`'s real candidate search (.decomp:225-283) --
   * `EntityType.isInvalidSpawn`/`LandPathNodeMaker.inflictsFireDamage` (.decomp EntityType.java:
   * 870-876, LandPathNodeMaker.java:575-580) folded onto the two hazard blocks this engine
   * actually places (lava, cactus -- fire/soul_fire/magma_block/lit campfire/wither_rose/
   * powder_snow/sweet_berry_bush are none of them a placeable block in this engine, named not
   * guessed past), and `Dismounting.findRespawnPos`'s VoxelShape height probe (.decomp
   * Dismounting.java:74-92, `BlockView.getDismountHeight`, .decomp BlockView.java:97-101)
   * folded onto this engine's own boolean full-cube collision exactly the way `07r_mount.js`'s
   * own `Mnt.locateSafeDismountingPos` folds the SAME jar method for the dismount-safety search
   * (that function's own header explains the fold; this is the same collapse, not a second one).
   */
  function isInvalidSpawnBlock(state) {
    var b = S.block[state];
    return (R.id.lava !== undefined && b === R.id.lava) ||
           (R.id.cactus !== undefined && b === R.id.cactus);
  }
  /** The `!hereSolid && !aboveSolid && floorSolid` fold `Mnt.locateSafeDismountingPos`'s own
   *  header names (07r_mount.js:674-692) -- a standing player is 2 cells tall in this engine
   *  (no crouch/swim bounding-box variant `EntityPose` iterates over here either). */
  function canStandAt(x, y, z) {
    return !solidFullCube(x, y, z) && !solidFullCube(x, y + 1, z) && solidFullCube(x, y - 1, z);
  }
  function respawnPosAt(x, y, z, strict) {
    if (strict && isInvalidSpawnBlock(W.getBlock(x, y, z))) return null;
    if (!canStandAt(x, y, z)) return null;
    if (strict && isInvalidSpawnBlock(W.getBlock(x, y - 1, z))) return null;
    return { x: x + 0.5, y: y, z: z + 0.5 };
  }
  function tryOffsets(base, offsets, strict) {
    for (var i = 0; i < offsets.length; i++) {
      var r = respawnPosAt(base.x + offsets[i][0], base.y, base.z + offsets[i][1], strict);
      if (r) return r;
    }
    return null;
  }
  /** `BedBlock.getOnBedOffsets` (.decomp:345-347). */
  function onBedOffsets(d0) { return [[0, 0], [-d0[0], -d0[1]]]; }
  /** `BedBlock.getAroundBedOffsets` (.decomp:330-343), verbatim arithmetic. */
  function aroundBedOffsets(d0, d1) {
    return [
      [d1[0], d1[1]],
      [d1[0] - d0[0], d1[1] - d0[1]],
      [d1[0] - 2 * d0[0], d1[1] - 2 * d0[1]],
      [-2 * d0[0], -2 * d0[1]],
      [-d1[0] - 2 * d0[0], -d1[1] - 2 * d0[1]],
      [-d1[0] - d0[0], -d1[1] - d0[1]],
      [-d1[0], -d1[1]],
      [-d1[0] + d0[0], -d1[1] + d0[1]],
      [d0[0], d0[1]],
      [d1[0] + d0[0], d1[1] + d0[1]]
    ];
  }
  /** the private 5-arg `BedBlock.findWakeUpPosition` (.decomp:239-262): around-bed, then
   *  around-bed one cell down, then on-bed, each STRICT first and then loose. */
  function findWakeUpPosition3(head, d0, d1) {
    var around = aroundBedOffsets(d0, d1);
    var below = { x: head.x, y: head.y - 1, z: head.z };
    var onBed = onBedOffsets(d0);
    return tryOffsets(head, around, true) ||
           tryOffsets(below, around, true) ||
           tryOffsets(head, onBed, true) ||
           tryOffsets(head, around, false) ||
           tryOffsets(below, around, false) ||
           tryOffsets(head, onBed, false);
  }
  /** the public `BedBlock.findWakeUpPosition` (.decomp:225-235): the "side" direction flips
   *  away from the sleeper's own pre-sleep facing (`Direction.pointsTo`, .decomp Direction.java:
   *  339-343 -- this engine's `yaw` is already radians, matching `Mnt.dismountOffset`'s own
   *  `-sin(yaw)/cos(yaw)` convention, so no `*PI/180` conversion is needed here either), and a
   *  bunk-bed (a second bed directly below the head) searches the STACKED 3-arg form instead of
   *  the flat 10+2 offset list. */
  function findWakeUpPosition(bed, yaw) {
    var PL = NS.Player;
    if (!PL || !PL.dirStep || !PL.turnCW) return null;
    var facing = S.propValue(bed.hState, R.PROP.facing);
    var d0 = PL.dirStep(R.PVAL, facing);
    if (!d0) return null;
    var sideFacing = PL.turnCW(R.PVAL, facing);
    var d1 = PL.dirStep(R.PVAL, sideFacing);
    // pointsTo: dir . (-sin(yaw), cos(yaw)) > 0
    if (d1[0] * -Math.sin(yaw) + d1[1] * Math.cos(yaw) > 0) d1 = [-d1[0], -d1[1]];
    var head = { x: bed.hx, y: bed.hy, z: bed.hz };
    var Tg = NS.Tags;
    var bedsCol = Tg && Tg.ready ? Tg.blockTag('beds') : -1;
    var belowSt = W.getBlock(bed.hx, bed.hy - 1, bed.hz);
    var bedBelow = bedsCol >= 0 && Tg.stateInCol(bedsCol, belowSt);
    if (bedBelow) return findWakeUpPosition3(head, d0, d1);
    var offs = aroundBedOffsets(d0, d1).concat(onBedOffsets(d0));
    return tryOffsets(head, offs, true) || tryOffsets(head, offs, false);
  }

  /** `LivingEntity.wakeUp`/`PlayerEntity.wakeUp(bool,bool)` (.decomp LivingEntity.java:
   *  3148-3167, PlayerEntity.java:1321-1330): clears OCCUPIED if the bed is still there, stands
   *  the player up at the real candidate search above (struck s117) -- or, only if the bed is
   *  gone (no facing to search from), vanilla's own fallback expression, `bed.up()+
   *  (0.5,0.1,0.5)` (.decomp:3150-3155, kept exactly for that case, this file's own header) --
   *  and sets `sleepTimer` — 0 when woken with the timer reset (a completed night, or a manual
   *  wake), 100 when woken by daytime catching up to a player still lying in bed (the
   *  client-side "grace" decay this file's own `Sleep.tick` below mirrors from `PlayerEntity.
   *  tick`, :228-230/237-240). */
  Sleep.wake = function (P, resetTimer) {
    if (!Sleep.ready || !P.sleeping) return;
    var pos = P.sleepPos;
    if (pos) {
      var hst = W.getBlock(pos.x, pos.y, pos.z);
      var bed = resolveBed(pos.x, pos.y, pos.z, hst);
      var wx = pos.x + 0.5, wy = pos.y + 1 + 0.1, wz = pos.z + 0.5;
      if (bed) {
        setOccupied(bed, false);
        var found = findWakeUpPosition(bed, P.yaw);
        if (found) { wx = found.x; wy = found.y; wz = found.z; }
      }
      P.x = wx; P.y = wy; P.z = wz;
      P.px = P.x; P.py = P.y; P.pz = P.z;
      P.ex = P.x; P.ey = P.y; P.ez = P.z;
    }
    // struck s117: the sleeping EntityPose.SLEEPING dims/eye set by `doSleep` above give way
    // to `EntityPose.STANDING` again (LivingEntity.wakeUp's own `this.setPose(STANDING)`,
    // .decomp:3162) -- `Ph.pose` (14b_physics.js) recomputes crouch/stand from the very next
    // real tick, so this is only what the FIRST frame after waking sees.
    P.height = NS.Physics ? NS.Physics.POSE.standing.h : (P.HEIGHT || 1.8);
    P.eyeHeight = NS.Physics ? NS.Physics.POSE.standing.eye : (P.EYE || 1.62);
    P.sleepYaw = undefined;
    P.sleeping = false;
    P.sleepPos = null;
    P.sleepTimer = resetTimer ? 0 : 100;
  };

  /** `ServerWorld.tick`'s own sleep-skip block (.decomp:266-284) — this file's own header
   *  explains why the `SleepManager` head-count collapses to a single-player test. Advances
   *  `Sky.dayTime` to the next day-0 tick, force-wakes the player, and (`doWeatherCycle` +
   *  `isRaining`) `ServerWorld.resetWeather` (.decomp:630-635) if a storm is running. */
  function performNightSkip(P) {
    var Sky = NS.Sky;
    if (Sky) {
      if (Sky.daylightCycle) {
        var t = Sky.dayTime + 24000;
        Sky.dayTime = t - (t % 24000);
      }
      if (Sky.weatherCycle && Sky.weather && Sky.isRaining(Sky.weather)) {
        Sky.weather.rainTime = 0; Sky.weather.raining = false;
        Sky.weather.thunderTime = 0; Sky.weather.thundering = false;
      }
    }
    Sleep.wake(P, true);
  }

  /**
   * One real tick, driven from `P.tick` (14_player.js). `PlayerEntity.tick` (.decomp:228-240):
   * sleeping -> increment the timer to a 100 cap, auto-wake at daytime; not sleeping and the
   * timer is still decaying (0..110, the same "just woke" window) -> increment it to a 110 wrap.
   * The night-skip test itself is `canResetTimeBySleeping` (.decomp PlayerEntity.java:1358-1360:
   * `isSleeping() && sleepTimer >= 100`) read every tick, matching `ServerWorld.tick`'s own
   * per-tick poll rather than an event the sleep call would have to fire.
   */
  Sleep.tick = function (P) {
    if (!Sleep.ready) return;
    if (P.sleeping) {
      P.sleepTimer = (P.sleepTimer || 0) + 1;
      if (P.sleepTimer > 100) P.sleepTimer = 100;
      var Sky = NS.Sky;
      if (Sky && Sky.isDay && Sky.isDay()) { Sleep.wake(P, false); return; }
      if (P.sleepTimer >= 100) performNightSkip(P);
    } else if (P.sleepTimer > 0) {
      P.sleepTimer++;
      if (P.sleepTimer >= 110) P.sleepTimer = 0;
    }
  };

  /**
   * `BedBlock.onUse` (.decomp:71-108), the whole dispatch. Called from `Use.blockUse`
   * (14l_use.js) for any state in the `beds` tag. ALWAYS returns `true` (CONSUME/SUCCESS in
   * every one of vanilla's own branches) — a bed click never falls through to placing the held
   * block, matching every other two-state toggle in `Use.blockUse`.
   */
  Sleep.use = function (P, x, y, z, state) {
    var bed = resolveBed(x, y, z, state);
    if (!bed) return true;                                    // the other half is gone
    if (!Sleep.isBedWorking()) {
      // BedBlock.onUse .decomp:81-93: both halves removed (no drops), then power 5.0 at head+0.5.
      // createFire=true and DamageSource.badRespawnPoint (damage tag, blast_protection applies).
      W.setBlock(bed.hx, bed.hy, bed.hz, 0); changed(bed.hx, bed.hy, bed.hz);
      W.setBlock(bed.fx, bed.fy, bed.fz, 0); changed(bed.fx, bed.fy, bed.fz);
      if (NS.Explosion && NS.Explosion.ready) NS.Explosion.explode(null, bed.hx + 0.5, bed.hy + 0.5, bed.hz + 0.5, 5.0, true, undefined, undefined, undefined, true, undefined, 'badRespawnPoint');
      return true;
    }
    var R_ = R.PROP, V = R.PVAL;
    if (R_.occupied !== undefined && S.propValue(bed.hState, R_.occupied) === V['true']) {
      var VB = NS.VB;
      var woke = !!(VB && VB.wakeVillagerAt && VB.wakeVillagerAt({ x: bed.hx, y: bed.hy, z: bed.hz }));
      if (!woke) say('This bed is occupied');
      return true;
    }
    if (P.sleeping || P.dead) return true;                     // SleepFailureReason.OTHER_PROBLEM/NOT_POSSIBLE_NOW: no message
    if (!(closeEnough(P, bed.hx, bed.hy, bed.hz) || closeEnough(P, bed.fx, bed.fy, bed.fz))) {
      say('You are too far away to sleep');
      return true;
    }
    if (obstructed(bed)) { say('This bed is obstructed'); return true; }
    // ⚠ UNCONDITIONAL, EVEN IF WHAT FOLLOWS REFUSES — `.decomp:838` runs `setSpawnPoint` before
    // the daytime/monster checks below it, not after; a player who tries to sleep in daylight
    // still gets their spawn point moved to the bed.
    Sleep.setSpawnPoint(P, bed.hx, bed.hy, bed.hz, P.yaw);
    var Sky = NS.Sky;
    if (Sky && Sky.isDay && Sky.isDay()) {
      say('You can only sleep at night and during thunderstorms');
      return true;
    }
    var Gm = NS.Gamemode;
    if (!(Gm && Gm.isCreative && Gm.isCreative(P)) && monstersNearby(bed)) {
      say('You may not rest now; there are monsters nearby');
      return true;
    }
    doSleep(P, bed);
    return true;
  };

  /**
   * `PlayerEntity.findRespawnPosition`'s BedBlock branch (.decomp:1338-1355): the bed at
   * `P.spawnPoint` must still exist and its wake spot must not be obstructed, else `null` — the
   * caller (17_main.js's own 'respawn' key) falls back to world spawn with vanilla's own
   * "block.minecraft.spawn.not_valid" text. `isBedWorking` is not tested (always true — this
   * file's own header, overworld-only).
   */
  Sleep.respawnPos = function (P) {
    if (!Sleep.ready) return null;
    var sp = P.spawnPoint;
    if (!sp) return null;
    var Tg = NS.Tags;
    if (!Tg || !Tg.ready) return null;
    var bedsCol = Tg.blockTag('beds');
    var st = W.getBlock(sp.x, sp.y, sp.z);
    if (bedsCol < 0 || !Tg.stateInCol(bedsCol, st)) return null;
    if (solidFullCube(sp.x, sp.y + 1, sp.z)) return null;
    return { x: sp.x + 0.5, y: sp.y + 1 + 0.1, z: sp.z + 0.5, yaw: sp.yaw || 0 };
  };

  Sleep.OWED = [
    // struck s117: `BedBlock.findWakeUpPosition`'s real candidate search (.decomp:225-283) is
    // now built (`findWakeUpPosition`/`findWakeUpPosition3` above) — vanilla's own
    // bed.up()+(0.5,0.1,0.5) fallback (.decomp:3150-3155) is kept only for the "bed itself is
    // gone" case the search has no facing to run from at all.
    'no bed BLOCK-ENTITY render exists (ER.BE_WORLD_OWED, 07j_entityrender.js; 15h_bemodel.js) ' +
      '-- a bed already renders as an ordinary two-cell block model (D-332\'s placement), so a ' +
      'sleeping player and an occupied bed look the same as an empty one from outside; not built ' +
      'here as out of this unit\'s own scope (rendering, not the sleep mechanic)',
    // struck s117: the sleeping-player POSE/camera (EntityPose.SLEEPING, .decomp
    // LivingEntity.java:158/3184-3185) is now set by `doSleep`/`Sleep.wake` above (`P.height`/
    // `P.eyeHeight`), the camera yaw lock by `P.sleepYaw` (`G.syncCamera`, 10_gfx.js) and the
    // hidden first-person hand by `drawHandPass`'s own `P.sleeping` gate (14k_hand3d.js).
    'sleepPercentage-driven multiplayer vote UI (the F3 sleeping-players HUD row) does not exist ' +
      '-- moot for a single-player engine (this file\'s own header), named for completeness'
  ];

})(MCL);
