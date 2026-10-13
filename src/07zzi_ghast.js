// src/07zzi_ghast.js — loop/blazeghast: the GHAST and the big FIREBALL it fires (the projectile
// SHAPE — power-vector flight, drag, deflect-on-hit — is 07zzh_blaze.js's `Bl.Fireball`
// machinery, shared with the small fireball; this file owns only what the big one does
// DIFFERENTLY: `ExplosionPower` NBT, the real explosion, and being deflectable). Off .decomp,
// read whole: net/minecraft/entity/mob/GhastEntity.java (createGhastAttributes, damage()'s own
// x1000 "a player's own fireball kills a ghast outright", the three inner Goal classes:
// FlyRandomlyGoal/GhastMoveControl/LookAtTargetGoal/ShootFireballGoal — every one ported below),
// net/minecraft/entity/projectile/FireballEntity.java (onCollision -> world.createExplosion,
// power `(float)explosionPower` — 1 by default, the SAME `NS.Explosion.explode` creeper/TNT
// already call — 6 direct-hit damage, ExplosionPower NBT read/write), ExplosiveProjectileEntity.
// java's own `damage()` override (the DEFLECT: an attacker's own hit resets the fireball's
// `power` to that ATTACKER'S look vector * 0.1 and re-owns it — 07zzh_blaze.js's `Bl.Fireball`
// shape, this file's own `Gh.deflect` wires it to the melee-hit path).
//
// ⚠⚠ ATTRIBUTES/HITBOX/FIRE-IMMUNITY/SPAWN-EGG/LOOT (ghast_tear) ARE ALL ALREADY DATA — see
// 07zzh_blaze.js's own header, the identical standing for every one of those five; this file
// duplicates none of it. `EL.motionFor('ghast')` (this file's own small addition, below) is the
// one thing that had to exist before `EL.canSpawn('ghast')` could ever be true.
//
// MOVEMENT: `Gh.GhastMoveControl` is GhastEntity.GhastMoveControl verbatim (0.1 impulse per
// cooldown, willCollide sweep, WAIT on a blocked path); travel is Fl.flyingTravel (FlyingEntity.travel).
//
// Runs on: MAIN THREAD ONLY. No DOM, no GL.

(function (NS) {
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6439)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = NS.JRandom ? new NS.JRandom(0x6439) : { s: 0x6439, nextDouble: function () { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return this.s / 4294967296; } }; return fbR.nextDouble(); }
  'use strict';

  var Gh = NS.Ghast = { ready: false };

  Gh.EYE_HEIGHT = 2.6;                  // GhastEntity.getActiveEyeHeight
  Gh.EXPERIENCE = 5;                    // ctor: experiencePoints = 5
  Gh.EXPLOSION_POWER_DEFAULT = 1;       // fireballStrength field's own initial value
  Gh.WANDER_RANGE = 16.0;               // FlyRandomlyGoal.start: (nextFloat*2-1) * 16.0F, all three axes
  Gh.WANDER_ARRIVE_MIN_SQ = 1.0;        // FlyRandomlyGoal.canStart: distSq < 1.0 -> repick
  Gh.WANDER_ARRIVE_MAX_SQ = 3600.0;     // ...or distSq > 3600.0 (60² -- drifted absurdly far) -> repick
  Gh.LOOK_RANGE_SQ = 4096.0;            // both LookAtTargetGoal and ShootFireballGoal: 64² = 4096
  Gh.SHOOT_CHARGE_TICKS = 10;           // cooldown == 10 -> the charge-up world-event (1015)
  Gh.SHOOT_FIRE_TICKS = 20;             // cooldown == 20 -> actually fire, then cooldown = -40
  Gh.SHOOT_RECOVER = -40;
  Gh.MUZZLE_DIST = 4.0;                 // the fireball's own spawn offset along the look vector
  Gh.DIRECT_HIT_DAMAGE = 6.0;           // FireballEntity.onEntityHit
  Gh.COLLIDABLE_NONLIVING = /^(boat|end_crystal|(\w+_)?minecart)$/;   // Entity.collides() true without maxHealth
  Gh.PLAYER_FIREBALL_INSTAKILL = 1000.0;   // GhastEntity.damage: a deflected hit that lands is x1000

  // GhastEntity: getAmbientSound / getHurtSound / getDeathSound, getSoundVolume() = 5.0F, HOSTILE
  Gh.SOUND_AMBIENT = 'entity.ghast.ambient';
  Gh.SOUND_HURT = 'entity.ghast.hurt';
  Gh.SOUND_DEATH = 'entity.ghast.death';
  Gh.SOUND_VOLUME = 5.0;
  Gh.AMBIENT_MIN_DELAY = 80;            // MobEntity.getMinAmbientSoundDelay default

  Gh.playSound = function (e, id) {
    if (e.silent) return;   // Entity.playSound: isSilent()
    var pitch = (RNDFB() - RNDFB()) * 0.2 + 1.0;   // LivingEntity.getSoundPitch
    if (NS.Sound && NS.Sound.play) NS.Sound.play(id, { x: e.x, y: e.y, z: e.z, volume: Gh.SOUND_VOLUME, pitch: pitch, source: 'hostile' });
  };
  Gh.playDamageSound = function (e, dying) { Gh.playSound(e, dying ? Gh.SOUND_DEATH : Gh.SOUND_HURT); };
  // MobEntity.baseTick: random.nextInt(1000) < ambientSoundChance++ -> reset to -minDelay, play
  Gh.AmbientGoal = function (e) {
    this.canUse = function () { return true; };
    this.canContinueToUse = this.canUse;
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {
      var r = (NS.EntityList && NS.EntityList.random) || RNDFB;
      if (e.dead) return;
      var chance = e.ambientSoundChance || 0;
      e.ambientSoundChance = chance + 1;
      if (Math.floor(r() * 1000) < chance) {
        e.ambientSoundChance = -Gh.AMBIENT_MIN_DELAY;
        Gh.playSound(e, Gh.SOUND_AMBIENT);
      }
    };
  };

  // ── spawn ────────────────────────────────────────────────────────────────────────────────
  Gh.initGhast = function (e) {
    e.experiencePoints = Gh.EXPERIENCE;
    if (e.fireballStrength === undefined) e.fireballStrength = Gh.EXPLOSION_POWER_DEFAULT;
    e.shooting = false;             // SHOOTING tracked byte -- drives the angry texture (07j)
    if (!e.flyMove) e.flyMove = new Gh.GhastMoveControl(e);
  };

  // ── GhastMoveControl: GhastEntity.GhastMoveControl, verbatim ─────────────────────────────
  // state MOVE_TO -> every collisionCheckCooldown (nextInt(5)+2) ticks, willCollide() sweeps the
  // bounding box along the path (isSpaceEmpty per step); clear -> velocity += dir*0.1, blocked ->
  // state WAIT (target abandoned). The generic travel (Fl.travelMob, zza=yya=0) then moves it.
  Gh.COLLISION_IMPULSE = 0.1;
  // CollisionView.isSpaceEmpty: block shapes + collidable entities (Shulker.spaceEmpty) + world border.
  Gh.boxEmptyAt = function (e, cx, cy, cz) {
    var hw = (e.width || 4) * 0.5, h = e.height || 4, B = NS.Shulker.BORDER + 1;
    if (cx - hw < -B || cx + hw > B || cz - hw < -B || cz + hw > B) return false;   // getWorldBorderCollisions
    return NS.Shulker.spaceEmpty(e, cx - hw, cy, cz - hw, cx + hw, cy + h, cz + hw);
  };
  Gh.GhastMoveControl = function (e) {
    var tx = 0, ty = 0, tz = 0, moving = false, cooldown = 0;
    this.setWantedPosition = this.moveTo = function (x, y, z) { tx = x; ty = y; tz = z; moving = true; };
    this.isMoving = function () { return moving; };
    this.getTargetX = function () { return tx; };
    this.getTargetY = function () { return ty; };
    this.getTargetZ = function () { return tz; };
    function pathClear(dx, dy, dz, n) {         // vanilla's `willCollide`: true = the path is CLEAR
      var cx = e.x, cy = e.y, cz = e.z;
      for (var i = 1; i < n; i++) {
        cx += dx; cy += dy; cz += dz;
        if (!Gh.boxEmptyAt(e, cx, cy, cz)) return false;
      }
      return true;
    }
    this.tick = function () {
      e.noGravity = true;                       // FlyingEntity.travel never subtracts gravity
      if (!moving) return;
      if (cooldown-- <= 0) {
        var r = (NS.EntityList && NS.EntityList.random) || RNDFB;
        cooldown += Math.floor(r() * 5) + 2;
        var dx = tx - e.x, dy = ty - e.y, dz = tz - e.z;
        var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var nx = len > 0 ? dx / len : 0, ny = len > 0 ? dy / len : 0, nz = len > 0 ? dz / len : 0;
        if (pathClear(nx, ny, nz, Math.ceil(len))) {
          e.vx += nx * Gh.COLLISION_IMPULSE; e.vy += ny * Gh.COLLISION_IMPULSE; e.vz += nz * Gh.COLLISION_IMPULSE;
        } else {
          moving = false;                       // State.WAIT
        }
      }
    };
  };

  // ── FlyRandomlyGoal: repick a random point in a 32-block cube around the ghast ────────────
  // canStart: !isMoving() or the current target is < 1 / > 60 blocks away; shouldContinue false.
  Gh.FlyRandomlyGoal = function (e) {
    this.canUse = function () {
      var m = e.flyMove;
      if (!m || !m.isMoving()) return true;
      var dx = m.getTargetX() - e.x, dy = m.getTargetY() - e.y, dz = m.getTargetZ() - e.z;
      var distSq = dx * dx + dy * dy + dz * dz;
      return distSq < Gh.WANDER_ARRIVE_MIN_SQ || distSq > Gh.WANDER_ARRIVE_MAX_SQ;
    };
    this.canContinueToUse = function () { return false; };
    this.start = function () {
      var r = (NS.EntityList && NS.EntityList.random) || RNDFB;
      var tx = e.x + (r() * 2 - 1) * Gh.WANDER_RANGE;
      var ty = e.y + (r() * 2 - 1) * Gh.WANDER_RANGE;
      var tz = e.z + (r() * 2 - 1) * Gh.WANDER_RANGE;
      if (e.flyMove) e.flyMove.moveTo(tx, ty, tz, 1.0);
    };
    this.stop = function () {};
    this.tick = function () {};
  };

  // ── LookAtTargetGoal: face the velocity when idle, face the target when it has one ────────
  Gh.LookAtTargetGoal = function (e) {
    this.canUse = function () { return true; };
    this.canContinueToUse = function () { return true; };
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {
      var t = e.target;
      if (!t) {
        var vx = e.vx || 0, vz = e.vz || 0;
        e.yaw = Math.atan2(vx, -vz);   // this engine's yaw frame (D-415); vanilla -atan2(0,0) = 0 at rest
        e.bodyYaw = e.yaw;
        return;
      }
      var dx = t.x - e.x, dz = t.z - e.z, distSq = dx * dx + (t.y - e.y) * (t.y - e.y) + dz * dz;
      if (distSq < Gh.LOOK_RANGE_SQ) {
        e.yaw = Math.atan2(dx, -dz);
        e.bodyYaw = e.yaw;
      }
    };
  };

  // WorldRenderer.processWorldEvent 1015/1016: pitch (nextFloat - nextFloat) * 0.2F + 1.0F
  function ghastWorldEventPitch() {
    var r = (NS.EntityList && NS.EntityList.random) || RNDFB;
    return (r() - r()) * 0.2 + 1.0;
  }

  // ── ShootFireballGoal: charge 10/20 ticks, spawn the real (big) fireball ────────────────────
  Gh.ShootFireballGoal = function (e) {
    var cooldown = 0;
    this.canUse = function () { return !!e.target; };
    this.canContinueToUse = this.canUse;
    this.start = function () { cooldown = 0; };
    this.stop = function () { e.shooting = false; };
    this.tick = function () {
      var t = e.target;
      if (!t) return;
      var dx = t.x - e.x, dy = (t.y || 0) - e.y, dz = t.z - e.z;   // Entity.squaredDistanceTo: feet to feet
      var distSq = dx * dx + dy * dy + dz * dz;
      var visible = NS.Ai && NS.Ai.canSee ? NS.Ai.canSee(e, t) : true;
      if (distSq < Gh.LOOK_RANGE_SQ && visible) {
        cooldown++;
        if (cooldown === Gh.SHOOT_CHARGE_TICKS && !e.silent && NS.Sound && NS.Sound.play) {
          NS.Sound.mobSound(e, 'entity.ghast.warn', 10, ghastWorldEventPitch());   // syncWorldEvent 1015
        }
        if (cooldown === Gh.SHOOT_FIRE_TICKS) {
          var yaw = e.yaw || 0;
          // `getRotationVec(1.0F)` in THIS engine's yaw frame (D-415): (sin yaw, 0, -cos yaw).
          var lx = Math.sin(yaw), lz = -Math.cos(yaw);
          var mx = e.x + lx * Gh.MUZZLE_DIST, mz = e.z + lz * Gh.MUZZLE_DIST;
          var my = e.y + (e.height || 0) * 0.5 + 0.5;
          var fdx = t.x - mx, fdy = ((t.y || 0) + (t.height || 0) * 0.5) - my, fdz = t.z - mz;
          if (!e.silent && NS.Sound && NS.Sound.play) {
            NS.Sound.mobSound(e, 'entity.ghast.shoot', 10, ghastWorldEventPitch());   // syncWorldEvent 1016
          }
          var EL = NS.EntityList;
          if (EL && EL.canSpawn('fireball')) {
            EL.spawn('fireball', mx, my, mz, { shooter: e, power: [fdx, fdy, fdz], explosionPower: e.fireballStrength | 0 });
          }
          cooldown = Gh.SHOOT_RECOVER;
        }
      } else if (cooldown > 0) {
        cooldown--;
      }
      e.shooting = cooldown > 10;
    };
  };

  // ── targetSelector 1: ActiveTargetGoal<Player>(10, true, false, |dy|<=4) ───────────────────
  Gh.TargetGoal = function (e, getPlayers) {
    this.canUse = function () {
      var r = (NS.EntityList && NS.EntityList.random) || RNDFB;
      if (Math.floor(r() * 10) !== 0) return false;    // reciprocalChance 10 -- ActiveTargetGoal.canStart
      var fr = NS.Ai ? NS.Ai.followRangeOf(e) : 0;
      var best = null, bestD = Infinity;
      var ey = e.y + Gh.EYE_HEIGHT;                    // ActiveTargetGoal.findClosestTarget: getClosestPlayer(.., getX, getEyeY, getZ)
      var ps = getPlayers();
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (Math.abs(p.y - e.y) > 4.0) continue;         // the custom predicate
        if (NS.Ai.canTargetLiving && !NS.Ai.canTargetLiving(p, e)) continue;   // TargetPredicate.test: creative/spectator/peaceful refused at acquisition
        var d = Math.hypot(p.x - e.x, p.y - ey, p.z - e.z);
        if (d <= Math.max(fr * NS.Ai.attackScale(p, e), 2) && d < bestD && (!NS.Ai.canSee || NS.Ai.canSee(e, p))) { best = p; bestD = d; }
      }
      if (best) { e.target = best; return true; }
      return false;
    };
    var unseen = 0;                                    // TrackTargetGoal.timeWithoutVisibility
    this.canContinueToUse = function () {
      var t = e.target;
      if (!t || (NS.Ai && NS.Ai.canTargetLiving && !NS.Ai.canTargetLiving(t, e))) return false;
      var fr = NS.Ai ? NS.Ai.followRangeOf(e) : 0;     // TrackTargetGoal.shouldContinue: dist^2 > followRange^2 drops it (no 1.5x)
      if (Math.hypot(t.x - e.x, t.y - e.y, t.z - e.z) > fr) return false;
      if (NS.Ai && NS.Ai.canSee) {                     // checkVisibility=true, maxTimeWithoutVisibility 60
        if (NS.Ai.canSee(e, t)) unseen = 0;
        else if (++unseen > 60) return false;
      }
      return true;
    };
    this.start = function () { unseen = 0; };
    this.stop = function () { e.target = null; };
    this.tick = function () {};
  };

  Gh.roster = function (e, ctx) {
    var Ai = NS.Ai, gs = new Ai.GoalSelector();
    gs.add(1, Ai.TARGET, new Gh.TargetGoal(e, ctx.players));
    gs.add(5, Ai.MOVE, new Gh.FlyRandomlyGoal(e));
    gs.add(7, Ai.LOOK, new Gh.LookAtTargetGoal(e));
    gs.add(8, 0, new Gh.AmbientGoal(e));
    gs.add(7, 0, new Gh.ShootFireballGoal(e));   // KW-39: vanilla ShootFireballGoal sets NO controls (GhastEntity.java:257-263, .decomp/) -- MOVE|LOOK at prio 7 tied with the always-on LookAtTargetGoal's LOOK, so the goal selector's <= priority conflict rule blocked it forever
    return gs;
  };

  // ── damage(): a fireball a PLAYER deflected back into the ghast is x1000 (an outright kill) ──
  Gh.damageMultiplier = function (e, damageSource) {
    if (damageSource && damageSource.source === 'fireball' && damageSource.byPlayer) return Gh.PLAYER_FIREBALL_INSTAKILL;
    return 1;
  };

  // ════════════════════════════════ THE BIG FIREBALL ═════════════════════════════════
  // NS.Blaze.Fireball (07zzh_blaze.js) is read live below, not cached at load time -- this
  // file's IIFE runs before that module's own `Bl.init()` line finishes (load order 'h' < 'i'
  // only orders the TWO IIFEs, not a guaranteed-populated NS.Blaze at THIS file's own load
  // time), the same "read the other module's object live, never copy a snapshot of it" rule
  // `Hg.knockback` (07zzg_hoglin.js) already follows for `NS.Entities.attrsOf`.

  /** `FireballEntity.onEntityHit`/`onCollision` (.decomp, read whole): 6 direct damage, THEN
   *  the real explosion at `explosionPower` (`NS.Explosion.explode`, reused verbatim -- this
   *  file's own header). A player-vs-ghast fireball deflect chain (`Gh.damageMultiplier`) is
   *  the OWNER's own combat-side concern, not this projectile's. */
  Gh.tickFireball = function (e) {
    if (e.removed) return;
    var C = NS.Commands;
    var griefing = C && C.ruleGet ? C.ruleGet('mobGriefing') !== 'false' : true;
    function explodeAndDiscard() {
      if (NS.Explosion && NS.Explosion.ready) {
        NS.Explosion.explode(null, e.x, e.y, e.z, e.explosionPower, griefing, undefined, undefined, undefined, griefing);
      }
      e.removed = true;
    }
    if (e.onGround) { explodeAndDiscard(); return; }   // an external "hit something solid" signal (blazeghastcheck)
    // ExplosiveProjectileEntity.tick (.decomp): discarded once its owner is removed (or its chunk is unloaded).
    if (e.shooter && e.shooter !== NS.Player && e.shooter.removed) { e.removed = true; return; }
    var Cb = NS.Combat;
    if (Cb && Cb.igniteForSeconds) Cb.igniteForSeconds(e, 1);   // isBurning() -> setOnFireFor(1)
    var ox = e.x, oy = e.y, oz = e.z, vx = e.vx, vy = e.vy, vz = e.vz;
    // ProjectileUtil.getCollision: block raycast along the velocity, replaced by a nearer entity hit
    // (boxes inflated 0.3, swept along the segment so a fast fireball cannot tunnel a thin mob).
    var bh = Cb && Cb.arrowRaycast ? Cb.arrowRaycast(ox, oy, oz, vx, vy, vz) : null;
    var f = bh ? bh.f : 1, hitEnt = null;
    // ProjectileEntity.tick/canHit: the owner is hittable only once the projectile has LEFT it
    // (shouldLeaveOwner: no owner box inside this tick's swept box inflated 1); a re-owned (deflected) fireball keeps the flag.
    var ow = e.shooter;
    if (!e.leftOwner) {
      e.leftOwner = true;
      if (ow) {
        var ow2 = ow.width !== undefined ? ow.width / 2 : 0.3, oh = ow.height !== undefined ? ow.height : 1.8;
        var fw = (e.width !== undefined ? e.width : 1) / 2 + 1, fh = e.height !== undefined ? e.height : 1;
        if (ow.x + ow2 > Math.min(ox, ox + vx) - fw && ow.x - ow2 < Math.max(ox, ox + vx) + fw &&
            ow.y + oh > Math.min(oy, oy + vy) - 1 && ow.y < Math.max(oy, oy + vy) + fh + 1 &&
            ow.z + ow2 > Math.min(oz, oz + vz) - fw && ow.z - ow2 < Math.max(oz, oz + vz) + fw) e.leftOwner = false;
      }
    }
    var targets = [];   // canHit = collides(): boat, minecarts, end crystal have no maxHealth but are hittable
    if (NS.Player && (e.shooter !== NS.Player || e.leftOwner)) targets.push(NS.Player);
    var list = NS.EntityList && NS.EntityList.list;
    if (list) for (var i = 0; i < list.length; i++) {
      var t0 = list[i];
      if (t0 === e || t0.removed || (t0 === e.shooter && !e.leftOwner) || (t0.maxHealth === undefined && t0.type !== 'fireball' && !Gh.COLLIDABLE_NONLIVING.test(t0.type || '')) || t0.noClip) continue;
      targets.push(t0);
    }
    if (Cb && Cb.rayBox) for (var j = 0; j < targets.length; j++) {
      var t = targets[j], IN = Cb.ARROW_ENTITY_INFLATE;
      var tw = t.width !== undefined ? t.width : 0.6, th = t.height !== undefined ? t.height : 1.8;
      var ct = Cb.rayBox(ox, oy, oz, vx * f, vy * f, vz * f, t.x - tw / 2 - IN, t.y - IN, t.z - tw / 2 - IN,
                         t.x + tw / 2 + IN, t.y + th + IN, t.z + tw / 2 + IN);
      if (ct === null || ct > 1) continue;
      f *= ct; hitEnt = t;
    }
    if (hitEnt || bh) {
      if (hitEnt) {
        // #647 -- `DamageSource.fireball(this, owner)`: a fireball projectile source owned by the
        // shooter (a player's deflect => byPlayer, the x1000 rule's tag); the explosion has a NULL
        // source entity (createExplosion(null, ...)), so the ghast is not credited for it.
        var byPlayer = e.shooter === NS.Player;
        if (hitEnt === NS.Player) {
          if (NS.Survival && NS.Survival.hurt && NS.Survival.hurt(hitEnt, 'fireball', Gh.DIRECT_HIT_DAMAGE, e.shooter || undefined)) {
            var T = NS.Text;
            if (e.shooter && e.shooter.type) hitEnt.killedBy = T && T.plain ? T.plain(T.translatable('entity.minecraft.' + e.shooter.type, [])) : e.shooter.type;
            if (e.shooter && NS.Effects && NS.Effects.thornsOnUserDamaged) NS.Effects.thornsOnUserDamaged(hitEnt, e.shooter);   // FireballEntity.onEntityHit: applyDamageEffects(owner, victim)
          }
        } else if (Cb && Cb.hurt) {
          var amt = Gh.DIRECT_HIT_DAMAGE * (hitEnt.type === 'ghast' ? Gh.damageMultiplier(hitEnt, { source: 'fireball', byPlayer: byPlayer }) : 1);
          if (Cb.hurt(hitEnt, amt, undefined, byPlayer, { attacker: e.shooter || null, source: 'fireball' }) && e.shooter && NS.Effects && NS.Effects.thornsOnUserDamaged) NS.Effects.thornsOnUserDamaged(hitEnt, e.shooter);
        }
      }
      explodeAndDiscard();
      return;
    }
    // setPosition(pos + v) THEN v = (v + power) * drag; touching water -> 0.8 (Blaze.Fireball.DRAG_WATER)
    var wet = Cb && Cb.arrowTouchingWater ? Cb.arrowTouchingWater(e) : !!e.inWater;
    var Fb = NS.Blaze && NS.Blaze.Fireball;
    var drag = wet ? (Fb ? Fb.DRAG_WATER : 0.8) : (Fb ? Fb.DRAG : 0.95);
    e.x = ox + vx; e.y = oy + vy; e.z = oz + vz;
    e.vx = (vx + e.powerX) * drag;
    e.vy = (vy + e.powerY) * drag;
    e.vz = (vz + e.powerZ) * drag;
  };

  /** `ExplosiveProjectileEntity.damage()` (.decomp, read whole, this file's own header): a hit
   *  from any attacker RE-OWNS the fireball -- `power` becomes the ATTACKER's own look vector
   *  * 0.1, `owner` becomes the attacker, so its next `onEntityHit` credits (and its next
   *  `onCollision`'s explosion is caused by) whoever just deflected it. Wired from
   *  `Cb.mobAttack` own "target is a live fireball" branch (14j_combat.js) rather than
   *  duplicating a second attack-resolution path here -- `Gh.OWED` names the player's OWN
   *  melee-click-on-entity path as the one caller this session did not confirm reaches it. */
  Gh.deflect = function (e, attacker) {
    if (!e || e.type !== 'fireball' && e.type !== 'small_fireball') return false;
    if (!attacker) return false;
    var lx, ly, lz;
    if (attacker === NS.Player && NS.Player.lookVec) {
      var v = NS.Player.lookVec(); lx = v[0]; ly = v[1]; lz = v[2];
    } else {
      var yaw = attacker.yaw || 0, pitch = attacker.pitch || 0;
      lx = Math.sin(yaw) * Math.cos(pitch); ly = Math.sin(pitch); lz = -Math.cos(yaw) * Math.cos(pitch);
    }
    e.vx = lx; e.vy = ly; e.vz = lz;
    e.powerX = lx * 0.1; e.powerY = ly * 0.1; e.powerZ = lz * 0.1;
    e.shooter = attacker;
    return true;
  };

  Gh.init = function () {
    var Ai = NS.Ai;
    if (Ai && Ai.ROSTER) Ai.ROSTER.ghast = Gh.roster;
    Gh.ready = true;
  };
  Gh.init();

  // #641 -- GhastEntityRenderer.getTexture (.decomp): isShooting() ? ghast_shooting : ghast.
  Gh.skinKey = function (e) {
    if (!e || e.type !== 'ghast') return null;
    return e.shooting ? 'ghast_shooting' : null;
  };

  Gh.OWED = [];   // deflect wiring, tentacles and the x1000 multiplier are all implemented now (14j_combat.js)
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
