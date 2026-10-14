// 07zz1_phantom.js — loop/phantom: PHANTOM (PhantomEntity + PhantomSpawner), .decomp/net/
// minecraft/entity/mob/PhantomEntity.java (533 lines, read in full) and .decomp/net/minecraft/
// world/spawner/PhantomSpawner.java (79 lines, read in full).
// Runs on: MAIN THREAD ONLY. No DOM.
//
// WHAT IS A REAL PORT:
//   * `Ph.PhantomMoveControl` — `PhantomEntity.PhantomMoveControl.tick()` (.decomp:526-551),
//     the same "one control object per mob, attached at spawn, ticked through `e.flyMove`"
//     shape vex/parrot/bee already use (07t_fly.js's own header) — dispatched by
//     07i_entitylist.js's PRE-EXISTING `if (e.flyMove) e.flyMove.tick(); ... else if (e.flyMove
//     && NS.Fly.ready) NS.Fly.travelMob(e);` (no edit needed there). The yaw step is expressed
//     in THIS engine's own yaw frame the same way `Fl.MoveControl` already does (07t_fly.js:
//     "atan2(d0,-d2) is that identical bearing already turned into this engine's frame",
//     D-415) rather than reproducing Mojang's own `yaw+90 .. -90` round trip literally — the
//     converged result is the same bearing, reached by this engine's own established idiom.
//     The velocity target is ported literally (#759): current lagging yaw + pitch, |d/dist3| magnitudes.
//   * `Ph.FindTargetGoal`/`Ph.StartAttackGoal`/`Ph.SwoopMovementGoal`/`Ph.CircleMovementGoal` —
//     `PhantomEntity`'s own four inner goal classes (.decomp:157-231, 420-460, 461-513,
//     232-292), at the jar's own priority numbers (`initGoals`, .decomp:65-69): targetSelector
//     1 = FindTargetGoal; goalSelector 1 = StartAttackGoal, 2 = SwoopMovementGoal,
//     3 = CircleMovementGoal.
//   * `Ph.tickSpawner` — `PhantomSpawner.spawn` (.decomp:24-79), verbatim shape: the
//     (60+random(60))*20-tick cooldown, the `doInsomnia` gate, the `ambientDarkness<5 &&
//     hasSkyLight()` skip (`NS.Sky.darknessNow()`, D-something's own real formula —
//     07l_spawn.js's own header cites it), per-player sea-level + sky-visible gate
//     (`NS.World.canSeeSky`, the SAME helper `husk`'s own `Spawn.RULES.husk` already uses),
//     the `1 + random(difficultyId+1)` group size (`NS.Diff.LEVELS.indexOf`, this engine's own
//     `getGlobalDifficulty().getId()` stand-in, D-... see 07l_spawn.js), and the
//     `random(statBound) >= 72000` TIME_SINCE_REST roll (`P.timeSinceRest`, this file's own new
//     per-tick counter, 14_player.js).
//
// WHAT IS A NAMED SIMPLIFICATION, NOT A GUESS (`Ph.OWED`):
//   * `LocalDifficulty.isHarderThan(random.nextFloat()*3.0)` — this engine has NO regional
//     LocalDifficulty model at all (`Eq.OWED`'s own standing header, 07y_equip.js); this file
//     reuses the SAME `Eq.clampedLocalDifficulty()` stand-in every other difficulty-scaled roll
//     in this engine already reuses (husk/witch/zombie-reinforcement rolls, 07zk_undead.js),
//     compared directly against the same `[0,3)` roll the real formula uses. The ORDERING by
//     difficulty (peaceful never, hard most) is preserved; the exact probability is not.
//   * a phantom's own SIZE scales its hitbox via `Ph.applySize` (`getDimensions`, .decomp:229-234).
//   * no swoop/flap/hurt SOUND plays (`SoundEvents.field_15238` the dive-cue, `field_14869` the
//     wingbeat, `field_15149`/`field_14974` hurt/death) and no cat-hiss call — this engine has
//     no mob sound substrate at all (the SAME standing gap `07zb_creeper.js`/`07zd_slime.js`'s
//     own headers already name for creeper/slime). The FUNCTIONAL half of both (the swoop
//     abort near a cat, `SwoopMovementGoal.shouldContinue`'s own `catsNearby` gate) IS wired.
//   * the reset-on-sleep half of TIME_SINCE_REST (`PlayerEntity.sleep`'s own stat reset) has NO
//     hook to attach to: `14l_use.js`'s own `Use.OWED` already lists "beds: sleeping ... — G19c"
//     as unbuilt in this engine. `P.timeSinceRest` (14_player.js) therefore only ever COUNTS UP
//     from world start/player join — correct for a player who has never slept (vanilla's own
//     value for that case), wrong for ever afterward once sleeping lands. `NS.Phantom.
//     resetTimeSinceRest` is exposed now so G19c's own bed code has one call to make; nothing
//     calls it yet.

(function (NS) {
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6439)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = NS.JRandom ? new NS.JRandom(0x6439) : { s: 0x6439, nextDouble: function () { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return this.s / 4294967296; } }; return fbR.nextDouble(); }
  'use strict';

  var Ph = NS.Phantom = { ready: true };

  Ph.INIT_SPEED = 0.1;       // PhantomMoveControl.targetSpeed initial / after a wall bounce (the 0.1F)
  Ph.RADIUS_BASE = 5; Ph.RADIUS_SPAN = 10;   // CircleMovementGoal.start: 5 + nextFloat()*10
  Ph.SWOOP_EXPAND = Math.fround(0.2);   // Box.expand(0.2F): the float widened to double

  Ph.OWED = [
    'LocalDifficulty.isHarderThan(random.nextFloat()*3.0) -- collapsed to Eq.clampedLocalDifficulty(), same standing simplification as husk/witch/zombie-reinforcement rolls (see this file\'s own header)',
    // loop/beds-s116 -- STRUCK: TIME_SINCE_REST now resets on sleep -- `Sleep.use`'s own
    // `doSleep` (src/14m_sleep.js) calls `Ph.resetTimeSinceRest` below at the start of every
    // successful sleep, the same call site this line used to name as unwired.
    // #757 -- STRUCK: FindTargetGoal now uses the 16,64,16 box + createAttackable (creative/invulnerable/peaceful excluded)
    'TargetPredicate.createAttackable() has no team terms here (setBaseMaxDistance(64) x attackScale + creative/spectator/invulnerable/peaceful + Ai.canSee line of sight); no mob-head x0.5 clause'
  ];

  // PhantomEntity.getDimensions (.decomp:229-234): the type box scaled by (width+0.2*size)/width.
  // Eye height is Cb.eyeHeightOf (height*0.35) so it follows e.height.
  Ph.applySize = function (e) {
    var d = NS.Entities && NS.Entities.ready ? NS.Entities.dimensions('phantom') : null;
    if (!d) return;
    var sz = Math.max(0, Math.min(64, e.phantomSize | 0));
    var f = Math.fround((d.width + Math.fround(0.2 * sz)) / d.width);
    e.width = d.width * f;
    e.height = d.height * f;
  };

  // PhantomEntity getAmbientSound/getHurtSound/getDeathSound, flap (client tick), HOSTILE category
  Ph.SOUND = { ambient: 'entity.phantom.ambient', hurt: 'entity.phantom.hurt', death: 'entity.phantom.death',
               flap: 'entity.phantom.flap', swoop: 'entity.phantom.swoop', bite: 'entity.phantom.bite' };
  Ph.AMBIENT_MIN_DELAY = 80;   // MobEntity.getMinAmbientSoundDelay default
  Ph.playSound = function (e, id, volume, pitch, ignoreSilent) {
    if (e.silent && !ignoreSilent) return;   // flap is World.playSound directly in vanilla: no isSilent check
    if (NS.Sound && NS.Sound.play) NS.Sound.play(id, { x: e.x, y: e.y, z: e.z, volume: volume, pitch: pitch, source: 'hostile' });
  };
  // MobEntity.baseTick ambient roll + PhantomEntity.tick wingbeat (cos phase crosses + -> -)
  Ph.SoundGoal = function (e) {
    this.canUse = function () { return true; };
    this.canContinueToUse = this.canUse;
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {
      if (e.dead) return;
      var r = (NS.EntityList && NS.EntityList.random) || RNDFB;
      // ambient roll lives in MobVoice's ambient tick (one counter, getSoundPitch)
      var base = ((e.id | 0) * 3 + (e.age || 0)) * 7.448451 * Math.PI / 180 + Math.PI;
      var c0 = Math.fround(Math.cos(base)), c1 = Math.fround(Math.cos(base + 7.448451 * Math.PI / 180));
      if (c0 > 0 && c1 <= 0) Ph.playSound(e, Ph.SOUND.flap, 0.95 + r() * 0.05, 0.95 + r() * 0.05, true);
      // PhantomEntity.tick (.decomp:131-138): two MYCELIUM spores per tick at the wingtips
      if (NS.Particle) {
        var sz = e.phantomSize | 0, yr = e.yaw || 0;   // engine yaw yr = vanilla yaw + PI (D-415, forward = sin yr,-cos yr): cos(yv)=-cos(yr), sin(yv)=-sin(yr)
        var dx = -Math.cos(yr) * (1.3 + 0.21 * sz), dz = -Math.sin(yr) * (1.3 + 0.21 * sz);
        var dy = (0.3 + c0 * 0.45) * (sz * 0.2 + 1);
        NS.Particle.spawn('mycelium', e.x + dx, e.y + dy, e.z + dz, 0, 0, 0);
        NS.Particle.spawn('mycelium', e.x - dx, e.y + dy, e.z - dz, 0, 0, 0);
      }
    };
  };

  function validTarget(p, e) {
    if (!p) return false;
    if (p.dead) return false;
    if (NS.Gamemode && NS.Gamemode.isSpectator && NS.Gamemode.isSpectator(p)) return false;
    // TargetPredicate.test: respectsVisibility -> getVisibilityCache().canSee(target) (Ai.canSee, D-597)
    if (e && NS.Ai && NS.Ai.canSee && !NS.Ai.canSee(e, p)) return false;
    return !attackableExcluded(p);   // isTarget(DEFAULT) everywhere it is tested (D: #3499)
  }

  // TargetPredicate.createAttackable(): !creative, !spectator, !invulnerable, and not peaceful
  function attackableExcluded(p) {
    var Gm = NS.Gamemode, Diff = NS.Diff;
    if (Gm && Gm.isCreative && Gm.isCreative(p)) return true;
    if (p.invulnerable === true) return true;   // the entity flag; a player's `invulnerable` is the hurt-immunity countdown (Sv.hurt), not this
    if (Diff && Diff.get && Diff.get() === 'peaceful') return true;
    return false;
  }

  function stepTowards(cur, target, step) {
    if (cur < target) return Math.min(cur + step, target);
    return Math.max(cur - step, target);
  }

  // ═══════════════════════ 1. PhantomMoveControl ("e.flyMove") ══════════════════════════════
  Ph.PhantomMoveControl = function (e) {
    var targetSpeed = Ph.INIT_SPEED;
    this.tick = function () {
      var Ai = NS.Ai;
      if (e.horizontalCollision) {
        e.yaw = Ai.wrapRad(e.yaw + Math.PI);
        targetSpeed = Ph.INIT_SPEED;
      }
      e.noGravity = true;
      if (e.targetPosX === undefined) return;
      var dx = e.targetPosX - e.x, dy = e.targetPosY - e.y, dz = e.targetPosZ - e.z;
      var horiz = Math.sqrt(dx * dx + dz * dz);
      if (Math.abs(horiz) <= 1e-5) return;
      var f4 = 1 - Math.abs(dy * 0.7) / horiz;
      dx *= f4; dz *= f4;
      horiz = Math.sqrt(dx * dx + dz * dz);
      var dist3 = Math.sqrt(dx * dx + dz * dz + dy * dy);
      var prevYaw = e.yaw;
      var targetYaw = Math.atan2(dx, -dz);   // D-415 frame, same conversion Fl.MoveControl uses
      e.yaw = Ai.rotlerp(e.yaw, targetYaw, 4 * Math.PI / 180);
      e.bodyYaw = e.yaw;
      if (Math.abs(Ai.wrapRad(e.yaw - prevYaw)) < 3 * Math.PI / 180) {
        targetSpeed = stepTowards(targetSpeed, 1.8, 0.005 * (1.8 / targetSpeed));
      } else {
        targetSpeed = stepTowards(targetSpeed, 0.2, 0.025);
      }
      // vanilla: setPitch(-atan2(-dy,horiz)) = atan2(dy,horiz); velocity target uses the CURRENT
      // (still lagging) yaw + that pitch, and |d/dist3| for the magnitudes (signs come from yaw/pitch).
      // D-415 frame: vanilla cos/sin(yaw+90) = sin(yaw)/-cos(yaw) here.
      var pitch = Math.atan2(dy, horiz);
      e.pitch = pitch;
      if (dist3 > 1e-5) {
        var tx = targetSpeed * Math.sin(e.yaw) * Math.abs(dx / dist3);
        var tz = -targetSpeed * Math.cos(e.yaw) * Math.abs(dz / dist3);
        var ty = targetSpeed * Math.sin(pitch) * Math.abs(dy / dist3);
        var vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0;
        e.vx = vx + (tx - vx) * 0.2;
        e.vy = vy + (ty - vy) * 0.2;
        e.vz = vz + (tz - vz) * 0.2;
      }
    };
  };

  // ═══════════════════════ 2. FindTargetGoal (targetSelector priority 1) ════════════════════
  Ph.FindTargetGoal = function (e, ctx) {
    var delay = 20;
    this.canUse = function () {
      if (delay > 0) { delay--; return false; }
      delay = 60;
      var cs = (ctx.players ? ctx.players() : []).slice();
      cs.sort(function (a, b) { return b.y - a.y; });
      for (var i = 0; i < cs.length; i++) {
        var p = cs[i];
        if (!validTarget(p, e)) continue;
        // world.getPlayers(..., boundingBox.expand(16,64,16)): box overlap, then squared distance <= 64^2
        var ew = (e.width || 0.9) / 2, eh = e.height || 0.5;
        var pw = ((p.width !== undefined ? p.width : 0.6)) / 2, ph = (p.height !== undefined ? p.height : 1.8);
        if (Math.abs(p.x - e.x) > 16 + ew + pw || Math.abs(p.z - e.z) > 16 + ew + pw) continue;
        if (p.y + ph < e.y - 64 || p.y > e.y + eh + 64) continue;
        var d = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z);
        // TargetPredicate.test: max(64 * target.getAttackDistanceScalingFactor(phantom), 2)
        var rng = Math.max(64 * (NS.Bat ? NS.Bat.attackScale(p) : 1), 2);
        if (d > rng) continue;
        e.target = p;
        return true;
      }
      return false;
    };
    this.canContinueToUse = function () { return !!e.target && validTarget(e.target, e); };
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {};
  };

  // ═══════════════════════ 3. StartAttackGoal (goalSelector priority 1) ═════════════════════
  Ph.StartAttackGoal = function (e, ctx) {
    var cooldown = 0;
    function rnd() { return ctx.random ? ctx.random() : RNDFB(); }
    function startSwoop() {
      var t = e.target; if (!t) return;
      var cx = Math.floor(t.x), cz = Math.floor(t.z);
      var cy = Math.floor(t.y) + 20 + Math.floor(rnd() * 20);
      var sea = (NS.Player && NS.Player.SEA_LEVEL !== undefined) ? NS.Player.SEA_LEVEL : 63;
      if (cy < sea) cy = sea + 1;
      e.circlingX = cx; e.circlingY = cy; e.circlingZ = cz;
    }
    this.canUse = function () { return !!e.target && validTarget(e.target, e); };
    this.canContinueToUse = this.canUse;
    this.start = function () { cooldown = 10; e.phantomMovementType = 'circle'; startSwoop(); };
    this.stop = function () {
      var W = NS.World;
      var Wx = NS.Weather;   // getTopPosition(MOTION_BLOCKING, circlingCenter): highest motion-blocking block + 1
      var top = (Wx && Wx.motionTop) ? Wx.motionTop(Math.floor(e.circlingX), Math.floor(e.circlingZ))
        : (W && W.heightAt) ? W.heightAt(Math.floor(e.circlingX), Math.floor(e.circlingZ)) + 1 : e.circlingY;
      e.circlingY = top + 10 + Math.floor(rnd() * 20);
    };
    this.tick = function () {
      if (e.phantomMovementType === 'circle') {
        cooldown--;
        if (cooldown <= 0) {
          e.phantomMovementType = 'swoop';
          startSwoop();
          cooldown = (8 + Math.floor(rnd() * 4)) * 20;
          Ph.playSound(e, Ph.SOUND.swoop, 10.0, 0.95 + rnd() * 0.1);   // PhantomEntity.playSound(field_15238, 10, 0.95+rnd*0.1)
        }
      }
    };
  };

  // ═══════════════════════ 4. SwoopMovementGoal (goalSelector priority 2) ═══════════════════
  Ph.SwoopMovementGoal = function (e, ctx) {
    var nextCatCheckAge = 0, catsNearby = false;
    this.canUse = function () { return !!e.target && e.phantomMovementType === 'swoop'; };
    this.canContinueToUse = function () {
      var t = e.target;
      if (!t || t.dead) return false;
      var Gm = NS.Gamemode;
      if (Gm && ((Gm.isSpectator && Gm.isSpectator(t)) || (Gm.isCreative && Gm.isCreative(t)))) return false;
      if (!this.canUse()) return false;
      var age = e.age || 0;
      if (age > nextCatCheckAge) {
        nextCatCheckAge = age + 20;
        var EL = NS.EntityList, found = false, MV = NS.MobVoice;
        var list = (EL && EL.list) ? EL.list : [];
        // getBoundingBox().expand(16): the phantom's box grown 16 each way, cat box intersects it
        var ew = (e.width || 0.9) / 2 + 16, eh = (e.height || 0.5) + 16;
        for (var i = 0; i < list.length; i++) {
          var c = list[i];
          if (!c || c.dead || c.removed || c.type !== 'cat') continue;
          var cw = (c.width || 0.6) / 2, ch = c.height || 0.7;
          if (Math.abs(c.x - e.x) >= ew + cw || Math.abs(c.z - e.z) >= ew + cw ||
              c.y >= e.y + eh || c.y + ch <= e.y - 16) continue;
          found = true;
          // vanilla hisses EVERY cat in the box (CatEntity.hiss), so no early break
          if (MV) MV.emit(c, 'entity.cat.hiss');
        }
        catsNearby = found;
      }
      return !catsNearby;
    };
    this.start = function () {};
    this.stop = function () { e.target = null; e.phantomMovementType = 'circle'; };
    this.tick = function () {
      var t = e.target; if (!t) return;
      var th = (t.height !== undefined) ? t.height : ((t.HEIGHT !== undefined) ? t.HEIGHT : 1.8);
      e.targetPosX = t.x; e.targetPosY = t.y + th * 0.5; e.targetPosZ = t.z;
      var eh = e.height || 0.5, ew = e.width || 0.9;
      var tw = (t.width !== undefined) ? t.width : ((t.WIDTH !== undefined) ? t.WIDTH : 0.6);
      // getBoundingBox().expand(0.2F).intersects(target.getBoundingBox()) -- feet-based boxes, strict overlap
      var X = Ph.SWOOP_EXPAND, ex = ew * 0.5 + X, tx2 = tw * 0.5;
      var hit = e.x - ex < t.x + tx2 && e.x + ex > t.x - tx2 &&
                e.z - ex < t.z + tx2 && e.z + ex > t.z - tx2 &&
                e.y - X < t.y + th && e.y + eh + X > t.y;
      if (hit) {
        if (NS.Combat && NS.Combat.mobAttack) NS.Combat.mobAttack(e, t);
        e.phantomMovementType = 'circle';
        Ph.playSound(e, Ph.SOUND.bite, 0.3, 0.9 + RNDFB() * 0.1);   // syncWorldEvent(1039) PHANTOM_BITES
      } else if (e.horizontalCollision || (e.hurtTime || 0) > 0) {
        e.phantomMovementType = 'circle';
      }
    };
  };

  // ═══════════════════════ 5. CircleMovementGoal (goalSelector priority 3) ══════════════════
  Ph.CircleMovementGoal = function (e, ctx) {
    var angle = 0, radius = 5, yOffset = 0, dir = 1;
    function rnd() { return ctx.random ? ctx.random() : RNDFB(); }
    function isNearTarget() {
      if (e.targetPosX === undefined) return false;
      var dx = e.targetPosX - e.x, dy = e.targetPosY - e.y, dz = e.targetPosZ - e.z;
      return (dx * dx + dy * dy + dz * dz) < 4;
    }
    function adjustDirection() {
      if (e.circlingX === undefined) { e.circlingX = Math.floor(e.x); e.circlingY = Math.floor(e.y); e.circlingZ = Math.floor(e.z); }
      angle += dir * (15 * Math.PI / 180);
      e.targetPosX = e.circlingX + radius * Math.cos(angle);
      e.targetPosY = e.circlingY + (-4 + yOffset);
      e.targetPosZ = e.circlingZ + radius * Math.sin(angle);
    }
    this.canUse = function () { return !e.target || e.phantomMovementType === 'circle'; };
    this.canContinueToUse = this.canUse;
    this.start = function () {
      radius = Ph.RADIUS_BASE + rnd() * Ph.RADIUS_SPAN;
      yOffset = -4 + rnd() * 9;
      dir = rnd() < 0.5 ? 1 : -1;
      adjustDirection();
    };
    this.stop = function () {};
    this.tick = function () {
      if (rnd() * 350 < 1) yOffset = -4 + rnd() * 9;
      if (rnd() * 250 < 1) { radius++; if (radius > 15) { radius = 5; dir = -dir; } }
      if (rnd() * 450 < 1) { angle = rnd() * 2 * Math.PI; adjustDirection(); }
      if (isNearTarget()) adjustDirection();
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      // vanilla: `!world.isAir(pos.down(1))` / `!world.isAir(pos.up(1))` -- ANY non-air block, not just solid ones
      var W = NS.World, SR = NS.States;
      var belowSolid = !!(W && W.getBlock && SR && SR.isAir && !SR.isAir[W.getBlock(bx, by - 1, bz)]);
      var aboveSolid = !!(W && W.getBlock && SR && SR.isAir && !SR.isAir[W.getBlock(bx, by + 1, bz)]);
      if (e.targetPosY < e.y && belowSolid) { yOffset = Math.max(1, yOffset); adjustDirection(); }
      if (e.targetPosY > e.y && aboveSolid) { yOffset = Math.min(-1, yOffset); adjustDirection(); }
    };
  };

  // ═══════════════════════ 6. PhantomSpawner (world-level, not the biome cycle) ═════════════
  Ph.spawnCooldown = 0;

  /** `P.timeSinceRest`'s own reset hook -- see this file's header. Nothing calls it yet. */
  Ph.resetTimeSinceRest = function () { if (NS.Player) NS.Player.timeSinceRest = 0; };

  /** `PhantomSpawner.spawn` (.decomp:24-79), verbatim shape -- see this file's own header for
   *  exactly which three real numbers/gates are collapsed and why. Called once per real tick
   *  from 17_main.js, the same slot `NS.Spawn.tick()`/`NS.WT.tickManager` already sit in. */
  Ph.tickSpawner = function () {
    var W = NS.World, P = NS.Player, EL = NS.EntityList, Sky = NS.Sky, C = NS.Commands, Gm = NS.Gamemode;
    if (!W || !P || !EL || !EL.ready || !Sky || !Sky.darknessNow) return 0;
    if (C && C.ruleGet && C.ruleGet('doInsomnia') === 'false') return 0;
    if (NS.Spawn && NS.Spawn.ready === false) return 0;   // doMobSpawning (ServerChunkManager.tickChunks)
    if (NS.Diff && NS.Diff.get && NS.Diff.get() === 'peaceful') return 0;   // spawnMonsters=false: before the cooldown
    Ph.spawnCooldown--;
    if (Ph.spawnCooldown > 0) return 0;
    Ph.spawnCooldown += (60 + Math.floor(RNDFB() * 60)) * 20;
    if (Sky.darknessNow() < 5) return 0;   // this engine is overworld-only: hasSkyLight() is always true
    if (Gm && Gm.isSpectator && Gm.isSpectator(P)) return 0;
    var sea = (P.SEA_LEVEL !== undefined) ? P.SEA_LEVEL : 63;
    var pbx = Math.floor(P.x), pby = Math.floor(P.y), pbz = Math.floor(P.z);
    if (!(pby >= sea) || !(W.canSeeSky && W.canSeeSky(pbx, pby, pbz))) return 0;
    var Eq = NS.Equip;
    var localDiff = (Eq && Eq.localDifficulty) ? Eq.localDifficulty({ x: P.x, z: P.z }) : 1;   // getLocalDifficulty(player pos); isHarderThan reads the RAW value
    if (!(localDiff > RNDFB() * 3.0)) return 0;   // isHarderThan -- see this file's header
    var rest = P.timeSinceRest || 0;
    var statBound = Math.max(1, rest);
    if (!(Math.floor(RNDFB() * statBound) >= 72000)) return 0;
    var by = pby + (20 + Math.floor(RNDFB() * 15));   // vanilla draw order: up(), east(), south()
    var bx = pbx + (-10 + Math.floor(RNDFB() * 21));
    var bz = pbz + (-10 + Math.floor(RNDFB() * 21));
    var Sp = NS.Spawn;
    if (!Sp || !Sp.clearForSpawn || !Sp.clearForSpawn('phantom', bx, by, bz)) return 0;
    var Diff = NS.Diff;
    var diffId = (Diff && Diff.LEVELS) ? Diff.LEVELS.indexOf(Diff.get()) : 2;
    if (diffId < 0) diffId = 2;
    var groupSize = 1 + Math.floor(RNDFB() * (diffId + 1));
    var spawned = 0;
    for (var i = 0; i < groupSize; i++) {
      var e = EL.spawn('phantom', bx + 0.5, by, bz + 0.5);
      if (e) spawned++;
    }
    return spawned;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
