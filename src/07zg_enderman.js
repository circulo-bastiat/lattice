// 07zg_enderman.js — loop/enderman-s98: the ENDERMAN, whole. Runs on: MAIN THREAD ONLY. No DOM.
//
// .decomp/net/minecraft/entity/mob/EndermanEntity.java, read IN FULL this session (609 lines,
// class + its three inner Goal classes ChasePlayerGoal/PickUpBlockGoal/PlaceBlockGoal/
// TeleportTowardsPlayerGoal) — every citation below is that file unless named otherwise.
// EndermanEntity extends HostileEntity implements Angerable — the SAME Angerable interface
// wolf/iron_golem already share (`Ai.rollAngerTime`/`Ai.UniversalAngerGoal`/`Ai.HurtByTargetGoal`,
// 07k_goals.js, D-475/D-486): `ANGER_TIME_RANGE = TimeHelper.betweenSeconds(20, 39)` (:80) is
// bit-for-bit the same `ajx.a(20, 39)` wolf's own field already reads, so this module reuses
// `Ai.ANGER_TIME_MIN`/`MAX`/`rollAngerTime` rather than retyping the same pair a third time.
//
// ── WHAT IS A REAL PORT, AND WHAT IS A NAMED SIMPLIFICATION ────────────────────────────────
//   * `Enderman.isPlayerStaring` — `isPlayerStaring` (:211-224) verbatim: the carved_pumpkin
//     head exemption, the `dot > 1.0 - 0.025/dist` cone (`getRotationVec(1.0F)` from the
//     PLAYER toward the enderman), then the player's own `canSee` ray.
//   * `Enderman.teleportRandomly`/`teleportTo` — `teleportRandomly()` (:273-283) and the two
//     overloads of `teleportTo` (:284-317) verbatim: the +-32-block XZ / +-32-block Y random
//     offset, the "walk the column down to the first block that blocksMovement, refuse lava"
//     scan, and the direction-biased 16-block offset the TARGET overload computes.
//   * `Enderman.mobTick`'s daytime-teleport-away half — `mobTick()` (:261-271) verbatim: the
//     `ageWhenTargetSet + 600` gate, the `brightness > 0.5 && skyVisible && nextFloat()*30 <
//     (brightness-0.4)*2` roll.
//   * `Ai.EndermanTeleportTowardsPlayerGoal`/`ChasePlayerGoal`/`PickUpBlockGoal`/
//     `PlaceBlockGoal` (07k_goals.js's own ROSTER.enderman references these four factories,
//     defined here so the goal bodies sit beside the vanilla numbers they were read against):
//     transcribed from the four inner classes (:405-609) — see each factory's own header below
//     for what is verbatim and what this engine's ONE-PLAYER / no-pathfinding-navigation-object
//     substrate collapses.
//
// ⚠⚠ WHAT THIS MODULE DOES **NOT** DO, AND WHY (Enderman.OWED, below, names each one again):
//   * `damage()`'s own override (:351-379) — the ProjectileDamageSource 64-teleport-attempt
//     loop, the splash-potion-of-harming pass-through, and the "any non-LivingEntity attacker:
//     90% chance to teleport away" branch. Every one of those needs to run AT THE MOMENT
//     `Cb.hurt` (14j_combat.js) applies damage, and this unit's file list does not include
//     14j_combat.js — wiring a per-type override there is a one-line hook (same shape as
//     `NS.Bat.onDamage`'s own `if (e.type==='bat') NS.Bat.onDamage(e)` line, D-533) that THIS
//     unit correctly leaves to whoever next has that file open, rather than touching a shared
//     file this worker was not handed.
//   * `Enderman.applyWaterDamage`, below, is the ONE piece of `damage()`'s own escape logic this
//     module DOES reproduce without touching combat.js: `hurtByWater()` returning true means
//     `LivingEntity.baseTick`'s own `if (isTouchingWaterOrRain() && hurtByWater())
//     damage(DROWN, 1.0F)` fires every tick the enderman is wet, and DROWN's attacker is always
//     null (not a LivingEntity) — the ONE damage() branch reachable with no attacker object,
//     so it is coded directly here (call `Cb.hurt` for the real 1 damage, then roll the SAME
//     `random.nextInt(10) != 0` escape :375 already gates the generic case on) instead of
//     waiting for the generic hook.
//   (writeCustomDataToNbt/readCustomDataFromNbt :183-208 round-trip through MobNbt, 07zw_mobnbt.js
//   `enderman` field list; the endermite targetSelector 3 is wired at Ai.ROSTER.enderman, 07k_goals.js.)
(function (NS) {
  'use strict';

  var Enderman = NS.Enderman = { ready: false };

  Enderman.OWED = [
    // #1750 -- damage() is wired in Cb.hurt (14j_combat.js): the ProjectileDamageSource 64-attempt
    // teleport and the non-LivingEntity-attacker 90% teleport. damageFromPotion (.decomp:380-386)
    // passes only Potions.field_8991 (WATER, no effects) -- not harming; Po.applyWater (07z_potion.js)
    // does the super.damage hit via ES.magicDamage and then the 64-attempt teleport itself (#4746).
    'ChasePlayerGoal/TeleportTowardsPlayerGoal read line-of-sight through ' +
      'EndermanEntity.isPlayerStaring, not a raycast of their own -- Enderman.isPlayerStaring ' +
      'below reproduces that with NS.Ray.cast the same way Bat.playerWithin (07zf_bat.js) ' +
      'already does; PickUpBlockGoal\'s own raycast (.decomp:462-467) is likewise now ' +
      'reproduced (KW-43) -- PlaceBlockGoal genuinely has none in vanilla (.decomp:478-527)',
    'the eye-glow layer (#1748) and the carried block (ER.endermanCarried, #1749) are both drawn; teleport burst (status 46) and nav stop are done (#4216)'
  ];

  // ── constants, every one cited to the exact .decomp line it came from ──────────────────────
  Enderman.EYE_HEIGHT = 2.55;          // getActiveEyeHeight override (:227-229), literal 2.55F
  Enderman.STARE_K = 0.025;            // isPlayerStaring's own dot threshold constant (:220)
  Enderman.CHASE_RANGE_SQ = 256.0;     // ChasePlayerGoal.canStart (:419) and TeleportTowardsPlayerGoal
                                 // tick's own far-away gate (:596) -- both literally 256.0 (16^2)
  Enderman.CLOSE_RANGE_SQ = 16.0;      // TeleportTowardsPlayerGoal.tick's own close-up gate (:592), 4^2
  Enderman.DAY_TELEPORT_AGE = 600;     // mobTick's own ageWhenTargetSet + 600 gate (:262)
  Enderman.RANDOM_TP_XZ = 64.0;        // teleportRandomly's own (nextDouble()-0.5)*64.0 (:275,277)
  Enderman.RANDOM_TP_Y = 64;           // teleportRandomly's own nextInt(64)-32 (:276)
  Enderman.TOWARD_TP_XZ = 8.0;         // teleportTo(Entity)'s own (nextDouble()-0.5)*8.0 (:288,290)
  Enderman.TOWARD_TP_Y = 16;           // teleportTo(Entity)'s own nextInt(16)-8 (:289)
  Enderman.TOWARD_TP_DIST = 16.0;      // teleportTo(Entity)'s own $$2=16.0 direction-bias distance
  Enderman.LOOK_WARMUP = 5;            // TeleportTowardsPlayerGoal.start's own getTickCount(5) (:553)
                                 // -- this engine has no difficulty tick-scale, so 5 is used
                                 // literally rather than through a getTickCount this engine
                                 // does not have (same "no such scale exists" standing as every
                                 // other rostered mob's own literal-tick constants).
  Enderman.UNSEEN_TP_TICKS = 30;       // ...ticksSinceUnseenTeleport's own getTickCount(30) (:594)
  Enderman.PICKUP_CHANCE = 20;         // PickUpBlockGoal.canStart's own nextInt(toGoalTicks(20)) (:449)
  Enderman.PLACE_CHANCE = 2000;        // PlaceBlockGoal.canStart's own nextInt(toGoalTicks(2000)) (:490)

  function rnd() {
    return (NS.EntityList && NS.EntityList.random) ? NS.EntityList.random() : Math.random();
  }
  function rint(n) { return Math.floor(rnd() * n); }

  function solidFullCubeAt(x, y, z) {
    var W = NS.World, S = NS.States, Ph = NS.Physics;
    var st = W.getBlock(x, y, z);
    if (st === undefined || st === null) return false;
    return S.solid[st] === 1 && Ph.shapesForState(st) === Ph.FULL_CUBE;
  }
  function fluidBlockAt(x, y, z) {
    // `FluidState.isEmpty()` negated — the same "this cell is a liquid" test lava test
    // narrows to LAVA specifically; `Material.WATER`/`Material.LAVA` BOTH answer
    // `blocksMovement()` true (a falling entity does not pass through the SURFACE of a fluid
    // uninterrupted, it swims/sinks in it), which is why vanilla's own `teleportTo` scan can
    // land ON a water or lava block at all before its SEPARATE `isIn(FluidTags.LAVA)` check
    // (:303) refuses only the lava half of that landing.
    var W = NS.World, S = NS.States, R = NS.Reg;
    var st = W.getBlock(x, y, z);
    if (!st || !R || !R.id) return false;
    var b = S.block[st];
    return b === R.id.lava || b === R.id.water || S.waterIn[st] === 1;
  }
  function blocksMovementAt(x, y, z) {
    // `BlockState.getMaterial().blocksMovement()` — a full solid cube OR a fluid (see
    // `fluidBlockAt`'s own header for why fluids belong here too, not just solids).
    // Material.WATER/LAVA are allowsMovement() (Material.java:39,55): they do NOT block movement (#2855),
    // so the scan walks down THROUGH them; any collision box (slab, stairs, fence) does block.
    // #3602: Material.blocksMovement = Material.solid minus COBWEB / BAMBOO_SAPLING (Material.java:78,90);
    // carpet, plants, snow layers, lily pads are notSolid, so the scan walks down through them.
    var st = NS.World.getBlock(x, y, z);
    if (!st) return false;
    var S = NS.States, b = S.block[st], id = NS.Reg.id;
    // a waterlogged slab/stairs/fence is Material STONE/WOOD: still blocks (#3601)
    return S.solidMat[b] === 1 && b !== id.cobweb && b !== id.bamboo_sapling && b !== id.water && b !== id.lava;
  }

  // ── isPlayerStaring (.decomp:211-224) ───────────────────────────────────────────────────────
  Enderman.isPlayerStaring = function (e, p) {
    if (!p) return false;
    var Iv = NS.Inventory, IT = NS.Items;
    if (Iv && IT && IT.ready && p.inventory && p.inventory.slots) {
      var head = p.inventory.slots[Iv.ARMOR_START + 3];   // slot 3 = head, armor.get(3) (:212)
      if (head && !Iv.isEmpty(head) && IT.nameOf(head.i) === 'carved_pumpkin') return false;
    }
    var f = (p.lookVec ? p.lookVec() : null) || { x: 0, y: 0, z: -1 };
    var flen = Math.hypot(f.x, f.y, f.z) || 1;
    var lx = f.x / flen, ly = f.y / flen, lz = f.z / flen;
    var pey = p.y + (p.eyeHeight || p.EYE || 1.62);
    var eey = e.y + Enderman.EYE_HEIGHT;
    var dx = e.x - p.x, dy = eey - pey, dz = e.z - p.z;
    var dist = Math.hypot(dx, dy, dz);
    if (dist === 0) return false;
    var nx = dx / dist, ny = dy / dist, nz = dz / dist;
    var dot = lx * nx + ly * ny + lz * nz;
    if (!(dot > 1.0 - Enderman.STARE_K / dist)) return false;
    // `PlayerEntity.canSee(this)` — the same eye-to-eye ray Bat.playerWithin (07zf_bat.js)
    // already casts for its own wake check, here from the PLAYER'S eye toward the enderman's.
    var R = NS.Ray, Ph = NS.Physics;
    if (R && R.cast) {
      var hit = R.cast(p.x, pey, p.z, nx, ny, nz, dist, function (st) {
        return st !== 0 && !!(Ph.shapesForState(st) || []).length;
      });
      if (hit) return false;
    }
    return true;
  };

  // ── teleport (.decomp:273-317) ──────────────────────────────────────────────────────────────
  Enderman.teleportTo = function (e, x, y, z) {
    var W = NS.World;
    if (!e || e.dead) return false;
    var bx = Math.floor(x), by = Math.floor(y), by0 = by, bz = Math.floor(z);
    var bottom = (W.BOTTOM_Y !== undefined) ? W.BOTTOM_Y : -64;
    // LivingEntity.teleport(x,y,z,bool): walk down until the block BELOW blocksMovement, stand on it
    while (by > bottom && !blocksMovementAt(bx, by - 1, bz)) { by--; }
    if (!blocksMovementAt(bx, by - 1, bz)) return false;
    var ey = y - (by0 - by);   // vanilla $7-- per block descended: the fractional y survives
    // ... then `isSpaceEmpty(this) && !containsFluid(box)`, else revert (we never moved)
    var hw = (e.width || 0.6) / 2, h = e.height || 2.9;
    for (var ix = Math.floor(x - hw); ix <= Math.floor(x + hw - 1e-7); ix++)
      for (var iy = by; iy <= Math.floor(by + h - 1e-7); iy++)
        for (var iz = Math.floor(z - hw); iz <= Math.floor(z + hw - 1e-7); iz++)
          if (fluidBlockAt(ix, iy, iz)) return false;
    if (NS.Spawn && NS.Spawn.spaceEmptyAt && !NS.Spawn.spaceEmptyAt('enderman', x, ey, z)) return false;
    var ox = e.x, oy = e.y, oz = e.z;
    e.x = x; e.y = ey; e.z = z;
    e.fallDistance = 0;
    // EndermanEntity.teleportTo (:297-317): entity.enderman.teleport at origin AND destination
    var S = NS.Sound;
    if (!e.silent && S && S.play) {
      var src = NS.MobVoice ? NS.MobVoice.source(e) : undefined;
      S.play('entity.enderman.teleport', { x: ox, y: oy, z: oz, volume: 1, pitch: 1, source: src });
      S.play('entity.enderman.teleport', { x: x, y: ey, z: z, volume: 1, pitch: 1, source: src });
    }
    // LivingEntity.teleport success: sendEntityStatus 46 -> handleStatus 46 (128 PORTAL particles lerped old->new,
    // .decomp LivingEntity:1748-1759), then PathAwareEntity getNavigation().stop() (:3066)
    var Px = NS.Particle;
    if (Px && Px.spawn) {
      var w = e.width || 0.6, hh = e.height || 2.9;
      for (var i = 0; i < 128; i++) {
        var d = i / 127;
        Px.spawn('portal', ox + (x - ox) * d + (rnd() - 0.5) * w * 2, oy + (by - oy) * d + rnd() * hh, oz + (z - oz) * d + (rnd() - 0.5) * w * 2,
          (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.2);
      }
    }
    if (e.nav && e.nav.stop) e.nav.stop();
    return true;
  };
  /** `LivingEntity.teleport(x,y,z,true)` with the entity's OWN box (width/height), no enderman sound/particles:
   *  walk down to a movement-blocking floor, refuse fluid or a colliding box, else move. */
  Enderman.teleportBox = function (e, x, y, z) {
    var W = NS.World, bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z), by0 = by;
    var bottom = (W.BOTTOM_Y !== undefined) ? W.BOTTOM_Y : -64;
    while (by > bottom && !blocksMovementAt(bx, by - 1, bz)) by--;
    if (!blocksMovementAt(bx, by - 1, bz)) return false;
    var ey = y - (by0 - by), hw = (e.width || 0.6) / 2, h = e.height || 1.8;
    for (var ix = Math.floor(x - hw); ix <= Math.floor(x + hw - 1e-7); ix++)
      for (var iy = Math.floor(ey); iy <= Math.floor(ey + h - 1e-7); iy++)
        for (var iz = Math.floor(z - hw); iz <= Math.floor(z + hw - 1e-7); iz++)
          if (fluidBlockAt(ix, iy, iz)) return false;
    var Ph = NS.Physics, x0 = x - hw, x1 = x + hw, z0 = z - hw, z1 = z + hw, y1 = ey + h;
    for (ix = Math.floor(x0); ix <= Math.floor(x1 - 1e-7); ix++)
      for (iy = Math.floor(ey); iy <= Math.floor(y1 - 1e-7); iy++)
        for (iz = Math.floor(z0); iz <= Math.floor(z1 - 1e-7); iz++) {
          var sh = Ph.shapeAt(ix, iy, iz);
          if (!sh) continue;
          for (var k = 0; k < sh.length; k++) {
            var b = sh[k];
            if (ix + b[0] < x1 && ix + b[3] > x0 && iy + b[1] < y1 && iy + b[4] > ey && iz + b[2] < z1 && iz + b[5] > z0) return false;
          }
        }
    e.x = x; e.y = ey; e.z = z; e.fallDistance = 0;
    if (e.nav && e.nav.stop) e.nav.stop();
    return true;
  };
  /** `ChorusFruitItem.finishUsing`'s loop (.decomp): 16 tries, +-8 xz, y -8..7 clamped to the world, the entity's own
   *  box; on success the teleport sound at the origin AND the destination. Shared by Fx.finishEating (fox) and the
   *  player. opts.sound overrides the event; returns whether it moved. */
  Enderman.chorusTeleport = function (e, rnd, opts) {
    var r = rnd || Math.random, W = NS.World, S = NS.Sound, o = opts || {};
    var bot = W.BOTTOM_Y !== undefined ? W.BOTTOM_Y : -64, ox = e.x, oy = e.y, oz = e.z;
    var snd = o.sound || 'item.chorus_fruit.teleport';
    for (var t = 0; t < 16; t++) {
      var tx = e.x + (r() - 0.5) * 16, ty = Math.min(Math.max(e.y + Math.floor(r() * 16) - 8, bot), bot + 320 - 1), tz = e.z + (r() - 0.5) * 16;
      if (Enderman.teleportBox(e, tx, ty, tz)) {
        if (S && S.play && !e.silent) {
          var src = o.source || (NS.MobVoice ? NS.MobVoice.source(e) : undefined);
          S.play(snd, { x: ox, y: oy, z: oz, volume: 1, pitch: 1, source: src });
          S.play(snd, { x: e.x, y: e.y, z: e.z, volume: 1, pitch: 1, source: src });
        }
        return true;
      }
    }
    return false;
  };
  Enderman.rint = function (n) { return rint(n); };
  Enderman.teleportRandomly = function (e) {
    if (!e || e.dead) return false;
    var x = e.x + (rnd() - 0.5) * Enderman.RANDOM_TP_XZ;
    var y = e.y + (rint(Enderman.RANDOM_TP_Y) - 32);
    var z = e.z + (rnd() - 0.5) * Enderman.RANDOM_TP_XZ;
    return Enderman.teleportTo(e, x, y, z);
  };
  Enderman.teleportToward = function (e, target) {
    if (!target) return false;
    var tey = target.y + (target.eyeHeight || (NS.Player && target === NS.Player ? NS.Player.EYE : 0) || 1.62);
    var dx = e.x - target.x, dy = (e.y + (e.height || 2.9) * 0.5) - tey, dz = e.z - target.z;
    var len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    var x = e.x + (rnd() - 0.5) * Enderman.TOWARD_TP_XZ - dx * Enderman.TOWARD_TP_DIST;
    var y = e.y + (rint(Enderman.TOWARD_TP_Y) - 8) - dy * Enderman.TOWARD_TP_DIST;
    var z = e.z + (rnd() - 0.5) * Enderman.TOWARD_TP_XZ - dz * Enderman.TOWARD_TP_DIST;
    return Enderman.teleportTo(e, x, y, z);
  };

  // ── mobTick (.decomp:261-271): the daytime teleport-away ────────────────────────────────────
  // playAngrySound (:167-173): once per 400 ticks, 'entity.enderman.stare' at 2.5 from the eye
  Enderman.playAngrySound = function (e) {
    var age = e.age || 0;
    if (age < (e.lastAngrySoundAge || 0) + 400 && e.lastAngrySoundAge !== undefined) return false;
    e.lastAngrySoundAge = age;
    var S = NS.Sound;
    if (e.silent || !S || !S.play) return false;
    return S.play('entity.enderman.stare', { x: e.x, y: e.y + Enderman.EYE_HEIGHT, z: e.z, volume: 2.5, pitch: 1.0,
      source: NS.MobVoice ? NS.MobVoice.source(e) : undefined });
  };
  // tickMovement (:231-243): two PORTAL particles per tick around the body
  Enderman.portalParticles = function (e) {
    var Px = NS.Particle;
    if (!Px || !Px.spawn) return 0;
    var w = e.width || 0.6, h = e.height || 2.9, n = 0;
    for (var i = 0; i < 2; i++) {
      var ox = (rnd() * 2 - 1) * 0.5 * w, oz = (rnd() * 2 - 1) * 0.5 * w, oy = rnd() * h;
      var vx = (rnd() - 0.5) * 2, vy = -rnd(), vz = (rnd() - 0.5) * 2;
      if (Px.spawn('portal', e.x + ox, e.y + oy - 0.25, e.z + oz, vx, vy, vz)) n++;
    }
    return n;
  };
  Enderman.mobTick = function (e) {
    Enderman.portalParticles(e);
    // setTarget (:121-137): acquiring a target stamps ageWhenTargetSet = age (any setter, so tracked here).
    if (e.target && !e._tgtSeen) e.ageWhenTargetSet = e.age || 0;
    e._tgtSeen = !!e.target;
    var Sky = NS.Sky;
    if (Sky && Sky.isDay && Sky.isDay() && (e.age || 0) >= (e.ageWhenTargetSet || 0) + Enderman.DAY_TELEPORT_AGE) {
      // getBrightnessAtEyes (Ai.lightLevelDependentMagicValue at the eye: light - skyDarken, so rain/thunder/dusk
      // dim it) and isSkyVisible(getBlockPos()) = canSeeSky at the feet block.
      var b = Math.fround(NS.Ai.lightLevelDependentMagicValue(e.x, e.y + Enderman.EYE_HEIGHT, e.z));
      var W = NS.World;
      if (b > 0.5 && W.canSeeSky(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) &&
          Math.fround(rnd() * 30.0) < Math.fround((b - 0.4) * 2.0)) {
        e.target = null; e.provoked = false;   // setTarget(null) (:121-137)
        e.ageWhenTargetSet = 0;
        Enderman.teleportRandomly(e);
      }
    }
    Enderman.applyWaterDamage(e);
  };

  // ── the ONE damage()-override branch reproduced without touching 14j_combat.js — see this
  // file's own header for why the rest of damage() is Enderman.OWED instead ─────────────────
  Enderman.applyWaterDamage = function (e) {
    if (!e || e.dead) return;
    var Sky = NS.Sky, Cb = NS.Combat;
    var wet = !!e.inWater;
    // D-649: this used to pass `0` as the weather object (so `wx.raining` was always undefined
    // and an enderman was NEVER hurt by rain); `Sky.isEntityRainedOn` reads the live weather.
    if (!wet && NS.SnowGolem && NS.SnowGolem.isWet) wet = NS.SnowGolem.isWet(e);
    else if (!wet && Sky && Sky.isEntityRainedOn) wet = Sky.isEntityRainedOn(e);
    if (!wet || !Cb || !Cb.hurt) return;
    Cb.hurt(e, 1.0, undefined, false, { bypassArmor: true, source: 'drown' });            // DamageSource.DROWN, 1.0F (hurtByWater's own call)
    if (e.dead) return;
    // damage()'s own 9-in-10 non-LivingEntity escape now runs inside Cb.hurt (#1750)
  };

  // ═══════════════════════════ GOALS (07k_goals.js's ROSTER.enderman references these four
  // factories by name; kept here, beside the vanilla line numbers each one was read against,
  // rather than duplicated into 07k_goals.js) ══════════════════════════════════════════════

  /** `ChasePlayerGoal` (.decomp:405-433) — MOVE|LOOK, priority 1. It never paths (`start()` is
   *  only `getNavigation().stop()`) — its whole job is a LOOK request while `e.target` (already
   *  a player, already staring, already within 256) is being closed on by `MeleeAttackGoal`
   *  (priority 2) instead. `shouldContinue` has no override in the decompiled class, so it
   *  falls through to `Goal`'s own default (`canStart()` again) — `canContinueToUse` below is
   *  the same function object as `canUse`, not a separate re-implementation of it. */
  Enderman.ChasePlayerGoal = function (e) {
    var target = null;
    this.canUse = function () {
      target = e.target;
      if (target !== NS.Player) return false;
      var dx = target.x - e.x, dy = target.y - e.y, dz = target.z - e.z;
      if (dx * dx + dy * dy + dz * dz > Enderman.CHASE_RANGE_SQ) return false;
      return Enderman.isPlayerStaring(e, target);
    };
    this.canContinueToUse = this.canUse;
    this.start = function () { if (e.nav && e.nav.stop) e.nav.stop(); };
    this.stop = function () { target = null; };
    this.tick = function () {
      if (!target || !e.look) return;
      e.look.setLookAt(target.x, target.y + (target.eyeHeight || target.EYE || 1.62), target.z);
    };
  };

  /** `PickUpBlockGoal` (.decomp:437-475) — NO controls (flags 0, runs concurrently with any
   *  MOVE/LOOK goal, same standing `Ai.UniversalAngerGoal`'s own header already established for
   *  a jar class with no `setControls` call). `enderman_holdable` (`BlockTags.field_15460`,
   *  :472) is read through `NS.Tags.stateIn` exactly the way every other block-tag question in
   *  this engine goes through one door (D-351, `W.tagBelow`'s own header, 07_world.js) — this
   *  one asks the STATE directly rather than "the block below", since here the tag question is
   *  about the picked block itself. The line-of-sight raycast (:462-467, ShapeType.OUTLINE) is
   *  now reproduced below with `NS.Ray.cast`, the same `shapesForState`-length predicate
   *  `isPlayerStaring` above already uses (KW-43: this raycast's ABSENCE, not the goal-selector
   *  tick-rate split, was the real cause of the engine's ~2x-too-fast pick-up/place rate --
   *  see this file's own PICKUP_CHANCE/PLACE_CHANCE headers for why the missing every-other-
   *  real-tick split does NOT, on its own, change the average activation rate). */
  Enderman.PickUpBlockGoal = function (e) {
    this.canUse = function () {
      if (e.carriedBlock !== undefined && e.carriedBlock !== null) return false;
      var C = NS.Commands;
      if (C && C.ruleGet && C.ruleGet('mobGriefing') === 'false') return false;
      return rint(Enderman.PICKUP_CHANCE) === 0;
    };
    this.canContinueToUse = function () { return false; };   // one-shot per activation, like the jar's own instant-return goal
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {
      var W = NS.World, T = NS.Tags, R = NS.Ray, Ph = NS.Physics;
      if (!T || !T.ready) return;
      var bx = Math.floor(e.x - 2.0 + rnd() * 4.0);
      var by = Math.floor(e.y + rnd() * 3.0);
      var bz = Math.floor(e.z - 2.0 + rnd() * 4.0);
      var st = W.getBlock(bx, by, bz);
      if (!st) return;
      if (!T.stateIn('enderman_holdable', st)) return;
      // PickUpBlockGoal's own raycast (.decomp:462-467) -- from the enderman's own (floored)
      // x/z at the SAMPLED y (:454-456, matching vanilla's `$$7`) to the candidate block's
      // center (`$$8`) -- must resolve to exactly this block (`$$10`, :465); an intervening
      // block with any collision/outline shape (glass, a fence, a leaf) refuses the pickup
      // here exactly the way it refuses vanilla's, even when the tag matches. KW-43: this was
      // the missing gate that made the engine pick up blocks roughly 2x as often as the real
      // server (13.3%/4% server vs ~28%/14% engine by tick 40/600, endermanrefcheck sec7) --
      // the goal-selector's missing every-other-real-tick split is NOT the cause (PICKUP_CHANCE
      // is deliberately the RAW un-halved vanilla constant for exactly this reason, this file's
      // own header on that constant).
      if (R && R.cast) {
        var ox = Math.floor(e.x) + 0.5, oz = Math.floor(e.z) + 0.5, oy = by + 0.5;
        var dx = (bx + 0.5) - ox, dz = (bz + 0.5) - oz;
        var dist = Math.hypot(dx, dz);
        if (dist > 1e-9) {
          var hit = R.cast(ox, oy, oz, dx, 0, dz, dist, R.targetable);   // ShapeType.OUTLINE: flowers/torches block the ray and can be hit (#4215)
          if (!hit || hit.x !== bx || hit.y !== by || hit.z !== bz) return;
        }
      }
      W.setBlock(bx, by, bz, 0);
      // vanilla `getBlock().getDefaultState()` (.decomp PickUpBlockGoal.tick): facing/axis never leak
      e.carriedBlock = NS.Reg.realFirst[NS.States.block[st]] + NS.Reg.defaultState[NS.States.block[st]];
    };
  };

  /** `PlaceBlockGoal` (.decomp:478-527) — also NO controls. `canPlaceOn` (:518-526) here is
   *  air, full cube below, not TNT, then postProcessState (Behave.updateShape), canPlaceAt
   *  (World.canSurvive) and no entity overlapping the cell. */
  Enderman.PlaceBlockGoal = function (e) {
    this.canUse = function () {
      if (e.carriedBlock === undefined || e.carriedBlock === null) return false;
      var C = NS.Commands;
      if (C && C.ruleGet && C.ruleGet('mobGriefing') === 'false') return false;
      return rint(Enderman.PLACE_CHANCE) === 0;
    };
    this.canContinueToUse = function () { return false; };
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {
      var W = NS.World, S = NS.States, R = NS.Reg;
      var bx = Math.floor(e.x - 1.0 + rnd() * 2.0);
      var by = Math.floor(e.y + rnd() * 2.0);
      var bz = Math.floor(e.z - 1.0 + rnd() * 2.0);
      var target = W.getBlock(bx, by, bz);
      if (target !== 0) return;                       // must be air (:519 $$3.isAir())
      var below = W.getBlock(bx, by - 1, bz);
      if (below === 0) return;                          // :520 !$$4.isAir()
      if (R && R.id && S.block[below] === R.id.tnt) return;   // :521 !isOf(Blocks.TNT)
      if (!solidFullCubeAt(bx, by - 1, bz)) return;      // :522 isFullCube
      // :496-527 — Block.postProcessState (updateShape vs. all six neighbours), then
      // canPlaceAt (World.canSurvive), then no entity in Box.from(pos).
      var Bh = NS.Behave, st = e.carriedBlock;
      if (Bh && Bh.updateShape) st = Bh.updateShape(st, bx, by, bz);   // folds all six neighbours
      if (W.canSurvive && !W.canSurvive(bx, by, bz, st)) return;
      var EL = NS.EntityList, list = (EL && EL.list ? EL.list.slice() : []);
      if (NS.Player) list.push(NS.Player);
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (!o || o.removed || o === e) continue;
        var hw = (o.width !== undefined ? o.width : 0.6) * 0.5, h = o.height || 1.8;
        if (o.x - hw < bx + 1 && o.x + hw > bx && o.y < by + 1 && o.y + h > by && o.z - hw < bz + 1 && o.z + hw > bz) return;
      }
      W.setBlock(bx, by, bz, st);
      e.carriedBlock = null;
    };
  };

  /** `TeleportTowardsPlayerGoal` (.decomp:528-609) — targetSelector priority 1. Vanilla's own
   *  `ActiveTargetGoal<PlayerEntity>` superclass constructor is what does the periodic re-check
   *  and the actual pathfinding hookup once `targetEntity` is set; this engine's TARGET goals
   *  never path themselves (`Ai.NearestAttackableTargetGoal`'s own header: `tick` is a no-op,
   *  MeleeAttackGoal at MOVE priority 2 does the approach once `e.target` exists) — so this
   *  goal's own job collapses to exactly the THREE things `.decomp`'s own subclass adds on top
   *  of the vanilla base: the staring-player warmup, the close-range "teleport right up to
   *  them" nudge, and the far-away "haven't seen them in 30 ticks, teleport toward them" nudge.
   */
  Enderman.TeleportTowardsPlayerGoal = function (e) {
    var warmup = 0, unseenTicks = 0, acquiring = false, pendingPlayer = null;
    this.canUse = function () {
      var p = NS.Player;
      if (!p || p.dead) return false;
      // TargetPredicate.createAttackable(): creative/spectator players are never a target
      if (NS.Ai && NS.Ai.canTargetLiving && !NS.Ai.canTargetLiving(p, e)) return false;
      var fr = (NS.Ai && NS.Ai.followRangeOf) ? NS.Ai.followRangeOf(e) : 64;
      var dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
      // TargetPredicate.test: max(base * getAttackDistanceScalingFactor, 2) (sneak x0.8, invisible, mob head)
      var rng = Math.max(fr * (NS.Bat && NS.Bat.attackScale ? NS.Bat.attackScale(p, e) : 1), 2);
      if (dx * dx + dy * dy + dz * dz > rng * rng) return false;
      return Enderman.isPlayerStaring(e, p);
    };
    this.canContinueToUse = function () {
      if (acquiring) {   // shouldContinue's targetPlayer != null branch (:566-572): re-check the stare, face them
        var pp = pendingPlayer;
        if (!pp || !Enderman.isPlayerStaring(e, pp)) return false;
        // Mob.lookAtEntity(target, 10, 10) (:741-766): yaw/pitch set directly, each clamped to 10deg/tick,
        // aimed at the player's real (sneak-aware) eye Y - not the head LookControl
        var A = NS.Ai, lim = 10 * Math.PI / 180;
        var wy = A.wantedHeadYaw(e, pp.x, pp.z), wp = A.wantedHeadPitch(e, pp.x, pp.y + A.eyeOf(pp), pp.z);
        if (wy !== null) e.yaw = A.rotateTowards(e.yaw || 0, wy, lim);
        if (wp !== null) e.pitch = A.rotateTowards(e.pitch || 0, wp, lim);
        return true;
      }
      if (!e.target) return false;
      // targetPlayer == null: no stare requirement (createAttackable().ignoreVisibility(), :574)
      if (NS.Ai && NS.Ai.canTargetLiving && !NS.Ai.canTargetLiving(e.target, e)) return false;
      var fr = (NS.Ai && NS.Ai.followRangeOf) ? NS.Ai.followRangeOf(e) : 64;
      var dx = e.target.x - e.x, dy = e.target.y - e.y, dz = e.target.z - e.z;
      return (dx * dx + dy * dy + dz * dz) <= fr * fr;
    };
    this.start = function () {
      warmup = Enderman.LOOK_WARMUP; unseenTicks = 0; acquiring = true; pendingPlayer = NS.Player;
      e.provoked = true;   // setProvoked() (:557)
    };
    this.stop = function () { e.target = null; e.provoked = false; pendingPlayer = null; acquiring = false; };
    this.tick = function () {
      if (!e.target && !acquiring) { e.provoked = false; return; }   // target lost elsewhere: setTarget(null) clears PROVOKED
      if (acquiring) {
        if (--warmup <= 0) {
          e.target = pendingPlayer; pendingPlayer = null; acquiring = false;
          Enderman.playAngrySound(e);   // onTrackedDataSet(ANGRY) (:179): ANGRY flips with the target
        }
        return;
      }
      if (e.target && !e.hasVehicle) {
        if (Enderman.isPlayerStaring(e, e.target)) {
          var dx = e.target.x - e.x, dy = e.target.y - e.y, dz = e.target.z - e.z;
          if (dx * dx + dy * dy + dz * dz < Enderman.CLOSE_RANGE_SQ) Enderman.teleportRandomly(e);
          unseenTicks = 0;
        } else {
          var dx2 = e.target.x - e.x, dy2 = e.target.y - e.y, dz2 = e.target.z - e.z;
          if (dx2 * dx2 + dy2 * dy2 + dz2 * dz2 > Enderman.CHASE_RANGE_SQ &&
              unseenTicks++ >= Enderman.UNSEEN_TP_TICKS && Enderman.teleportToward(e, e.target)) {
            unseenTicks = 0;
          }
        }
      }
    };
  };

  Enderman.init = function () { Enderman.ready = true; };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
