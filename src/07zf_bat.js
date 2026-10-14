// 07zf_bat.js -- QUEUE 0.2 (G18c, D-533): the BAT. Runs on: MAIN THREAD ONLY. No DOM.
//
// .decomp/net/minecraft/entity/passive/BatEntity.java, read in full (247 lines). A bat has NO
// goal selector at all (it registers no goals); everything it does is in three overrides:
//   tick()     (:88-96)   AFTER super.tick(): roosting -> velocity = 0 and y snapped to
//                         floor(y) + 1 - height (hangs from the ceiling cell); else vy *= 0.6.
//   mobTick()  (:98-146)  roosting: ceiling above (up().isSolidBlock) -> 1/200 new headYaw
//                         (nextInt(360)), and a player within 4 (TargetPredicate.createNon-
//                         Attackable().setBaseMaxDistance(4.0)) wakes it; no ceiling -> wakes.
//                         flying: re-pick hangingPosition when null / not air / 1-in-30 / within
//                         2 blocks, as pos + (nextInt(7)-nextInt(7), nextInt(6)-2, nextInt(7)-
//                         nextInt(7)); steer velocity += (signum(d)*0.5 - v)*0.1 (y: 0.7F),
//                         yaw += wrapDegrees(atan2(vz,vx)deg - 90 - yaw), forwardSpeed = 0.5F;
//                         1/100 and a solid block above -> roost.
//   damage()   (:171-180) any non-invulnerable damage wakes a roosting bat first.
// isPushable() false, pushAway() and tickCramming() empty (:66-77): a bat neither shoves nor is
// shoved. handleFallDamage false / fall() empty: no fall damage (this engine gives no mob fall
// damage at all today, so that half is already true). Attributes: MobEntity + max_health 6.
// canSpawn (:193-207): y >= seaLevel -> false; light = getLightLevel(pos); bound 4, or 7 on
// Oct 20..Nov 3 (isTodayAroundHalloween, :209-214, the REAL calendar date); outside halloween
// a coin flip refuses half first; light > nextInt(bound) -> false; else canMobSpawn.
// Motion: BatEntity overrides neither getGravity nor drag, so the plain MobEntity [0.08, 0.98]
// row (EL.motionFor's own comment names the same shared-ancestry rule donkey/mule use).
(function (NS) {
  'use strict';
  var Bat = NS.Bat = {
    ready: false,
    ROOST_WAKE_DIST: 4.0,        // setBaseMaxDistance(4.0)
    WAKE_MIN_DIST: 2.0,          // TargetPredicate.test: Math.max(base * scale, 2.0)
    SNEAK_SCALE: 0.8,            // LivingEntity.getAttackDistanceScalingFactor, sneaking
    VY_DAMP: 0.6,                // tick(): multiply(1.0, 0.6, 1.0)
    STEER: 0.1,                  // mobTick(): (target - v) * 0.1F
    STEER_XZ: 0.5,               // Math.signum(dx) * 0.5
    STEER_Y: 0.7,                // Math.signum(dy) * 0.7F
    FORWARD: 0.5,                // this.forwardSpeed = 0.5F
    BOTTOM_Y: -64,               // world.getBottomY(), overworld 1.18.2
    random: null,                // injection point (same contract as EL.random)
    OWED: [
      'ambient/hurt/death sounds: ambient handled by MobVoice.pick (roosting gate)'
    ]
  };

  function rint(n) {
    var r = Bat.random || (NS.EntityList && NS.EntityList.random) || Math.random;
    return Math.floor(r() * n);
  }
  /** `syncWorldEvent(null, 1025, pos, 0)` (unless silent): WorldRenderer case 1025, neutral, 0.05 volume. */
  function takeoff(e) {
    var S = NS.Sound, r = Bat.random || (NS.EntityList && NS.EntityList.random) || Math.random;
    if (e.silent || !S || !S.play) return;
    S.play('entity.bat.takeoff', { x: Math.floor(e.x) + 0.5, y: Math.floor(e.y) + 0.5, z: Math.floor(e.z) + 0.5,
      volume: 0.05, pitch: (r() - r()) * 0.2 + 1.0, source: 'neutral' });
  }
  function solidBlockAt(x, y, z) {
    var W = NS.World, S = NS.States, Ph = NS.Physics;
    var st = W.getBlock(x, y, z);
    if (!st) return false;
    // `AbstractBlockState.isSolidBlock` -- a movement-blocking full cube (the same predicate
    // `Spawn`'s own isClearForSpawn already reads, 07l_spawn.js).
    return S.solid[st] === 1 && Ph.shapesForState(st) === Ph.FULL_CUBE;
  }
  function isAir(x, y, z) { return NS.World.getBlock(x, y, z) === 0; }

  Bat.isHalloween = function (date) {
    var d = date || new Date();
    var day = d.getDate(), mon = d.getMonth() + 1;
    return (mon === 10 && day >= 20) || (mon === 11 && day <= 3);
  };

  /** `BatEntity.canSpawn`'s own half (before `canMobSpawn`). `light` is getLightLevel(pos). */
  Bat.lightRule = function (y, light, seaLevel, rnd, halloween) {
    if (y >= seaLevel) return false;
    var bound = 4;
    if (halloween) bound = 7;
    else if (rnd(2) === 1) return false;          // `$$4.nextBoolean()` -> refuse
    return !(light > rnd(bound));
  };

  /** `LivingEntity.getAttackDistanceScalingFactor(bat)`: sneaking 0.8; invisible 0.7 * max(0.1, armour
   *  pieces worn / 4); a skeleton/zombie/creeper head x0.5 -- a bat is none of those, so no head clause. */
  Bat.attackScale = function (P, obs) {
    var scale = P.crouching ? Bat.SNEAK_SCALE : 1;
    var ES = NS.Effects, Iv = NS.Inventory;
    if (ES && ES.hasStatusEffect && ES.hasStatusEffect(P, 'invisibility')) {
      var worn = 0;
      if (Iv && P.inventory && P.inventory.slots)
        for (var i = 0; i < 4; i++) { var s = P.inventory.slots[Iv.ARMOR_START + i]; if (s && !Iv.isEmpty(s)) worn++; }
      scale *= 0.7 * Math.max(0.1, worn / 4);
    }
    if (obs && P.inventory && P.inventory.slots && Iv) {   // mob-head clause: skeleton+skeleton_skull, zombie+zombie_head, creeper+creeper_head
      var h = P.inventory.slots[Iv.ARMOR_START + 3], hn = h && !Iv.isEmpty(h) && NS.Items ? NS.Items.nameOf(h.i) : null;
      if ((obs.type === 'skeleton' && hn === 'skeleton_skull') || (obs.type === 'zombie' && hn === 'zombie_head') ||
          (obs.type === 'creeper' && hn === 'creeper_head')) scale *= 0.5;
    }
    return scale;
  };

  function playerWithin(e) {
    var P = NS.Player;
    if (!P || P.x === undefined) return null;
    var Gm = NS.Gamemode;
    if (Gm && Gm.isSpectator && Gm.isSpectator(P)) return null;   // isPartOfGame
    if (P.dead) return null;
    var scale = Bat.attackScale(P);
    var d = Math.max(Bat.ROOST_WAKE_DIST * scale, Bat.WAKE_MIN_DIST);
    var dx = P.x - e.x, dy = P.y - e.y, dz = P.z - e.z;
    if (dx * dx + dy * dy + dz * dz > d * d) return null;
    // respectsVisibility: MobEntity.getVisibilityCache().canSee -> eye-to-eye ray.
    var R = NS.Ray;
    if (R && R.colliderHit && R.colliderHit(e.x, e.y + e.height / 2, e.z, P.x, P.y + (P.eyeHeight || P.EYE || 1.62), P.z)) return null;
    return P;
  }

  /** `mobTick()` -- runs where a mob's goal selector would (after `Ai` would, before travel). */
  Bat.mobTick = function (e) {
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    if (e.roosting) {
      // ⚠ vanilla asks `getBlockState(up).isSolidBlock(world, $$0)` -- the SECOND argument is
      // the bat's own pos, not up(); isSolidBlock's pos only feeds the shape query, same cell.
      if (solidBlockAt(bx, by + 1, bz)) {
        if (rint(200) === 0) e.headYaw = rint(360) * Math.PI / 180;
        if (playerWithin(e)) { e.roosting = false; takeoff(e); }
      } else {
        e.roosting = false; takeoff(e);
      }
      return;
    }
    var hp = e.hangingPos;
    if (hp && (!isAir(hp[0], hp[1], hp[2]) || hp[1] <= Bat.BOTTOM_Y)) hp = e.hangingPos = null;
    if (!hp || rint(30) === 0 || withinDist(hp, e, 2.0)) {
      // `new BlockPos(double, double, double)` floors each component.
      hp = e.hangingPos = [
        Math.floor(e.x + rint(7) - rint(7)),
        Math.floor(e.y + rint(6) - 2.0),
        Math.floor(e.z + rint(7) - rint(7))
      ];
    }
    var dx = hp[0] + 0.5 - e.x, dy = hp[1] + 0.1 - e.y, dz = hp[2] + 0.5 - e.z;
    e.vx += (Math.sign(dx) * Bat.STEER_XZ - e.vx) * Bat.STEER;
    e.vy += (Math.sign(dy) * Bat.STEER_Y - e.vy) * Bat.STEER;
    e.vz += (Math.sign(dz) * Bat.STEER_XZ - e.vz) * Bat.STEER;
    // yaw: vanilla degrees, atan2(z, x) - 90. This engine's yaw is radians with forward =
    // (-sin, +cos)... see Ph.travelMob: vx += zza*sin(yaw) ... so heading angle h satisfies
    // (sin h, -cos h) = (vx, vz)/|v| -> h = atan2(vx, -vz). Same direction vanilla's -90 lands on.
    if (e.vx !== 0 || e.vz !== 0) e.yaw = Math.atan2(e.vx, -e.vz);
    e.zza = Bat.FORWARD;
    if (rint(100) === 0 && solidBlockAt(bx, by + 1, bz)) e.roosting = true;
  };
  function withinDist(hp, e, d) {
    // `Vec3i.isWithinDistance(Position, d)` -> getSquaredDistanceFromCenter (.decomp Vec3i.java
    // :196-212): the block's CENTRE (+0.5 on every axis) to the bat's position, < d*d.
    var dx = hp[0] + 0.5 - e.x, dy = hp[1] + 0.5 - e.y, dz = hp[2] + 0.5 - e.z;
    return dx * dx + dy * dy + dz * dz < d * d;
  }

  /** `tick()`'s own half, AFTER super.tick() (after the travel). */
  Bat.postTick = function (e) {
    if (e.roosting) {
      e.vx = 0; e.vy = 0; e.vz = 0;
      e.y = Math.floor(e.y) + 1.0 - e.height;
    } else {
      e.vy *= Bat.VY_DAMP;
    }
  };

  /** `damage()` -- wakes a roosting bat before the hit is even judged. */
  Bat.onDamage = function (e) { if (e && e.type === 'bat') e.roosting = false; };

  Bat.init = function () { Bat.ready = true; };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
