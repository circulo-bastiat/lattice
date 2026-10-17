// 07ze_llama.js — QUEUE 0.2 "G18e remainder close" (loop/llama-s97): the two LLAMA pieces that
// do not belong inside Mount (07r_mount.js owns llama's taming/chest/carpet-slot/food-table
// state, the same substrate donkey/mule already extended) or Breed (07m_breed.js owns the
// child strength/variant roll, `Breed.CHILD.llama`): the SPIT PROJECTILE's own kinematics and
// per-tick hit consequence (`LlamaSpitEntity`, `.decomp/net/minecraft/entity/projectile/
// LlamaSpitEntity.java`, read in full) and the CARAVAN follow-chain (`FormCaravanGoal`,
// `.decomp/net/minecraft/entity/ai/goal/FormCaravanGoal.java`, also read in full) — wired from
// 07k_goals.js's own `Ai.ROSTER.llama`/`Ai.ProjectileAttackGoal`/`Ai.FormCaravanGoal`, and from
// 07i_entitylist.js's own per-tick dispatch (the same `e.type === 'x' && NS.X.tick` idiom
// potion/tnt/evoker_fangs already use). Runs on: MAIN THREAD ONLY. No DOM.
//
// ⚠ NOT AN INIT-GATED MODULE. Every function here is a stateless read of its own arguments —
// no `NS.DATA` table to wait on the way `Mount`/`Breed` do — so `NS.Llama` carries no `.ready`
// flag and none of its callers gate on one, the same standing `Ai`'s own goal constructors
// (07k_goals.js) already hold.

(function (NS) {
  'use strict';

  var Ll = NS.Llama = {};

  // ── LlamaSpitEntity ─────────────────────────────────────────────────────────────────────────

  // `LlamaSpitEntity.tick()` (.decomp) applies gravity/drag ITSELF, inline, rather than through
  // `ProjectileEntity`'s own fields: `setVelocity(velocity.multiply(0.99F))` (drag), then unless
  // `hasNoGravity()`, `.add(0, -0.06F, 0)` (gravity) — the exact [gravity, drag] pair
  // `EL.motionFor`'s own hardcode list reads for `llama_spit` (07i_entitylist.js, this session).
  Ll.GRAVITY = 0.06;
  Ll.DRAG = 0.99;
  // `LlamaEntity.getLeashOffset` (.decomp :493): `(0, 0.75 * standingEyeHeight, width * 0.5)`
  // (Entity default is z = width*0.4). Unrotated, like 07zzj_strider.js's own.
  Ll.leashOffset = function (e) {
    return { x: 0, y: Math.fround(0.75 * NS.Combat.eyeHeightOf(e)), z: Math.fround(e.width * 0.5) };
  };
  // `LlamaSpitEntity.onEntityHit` — flat 1.0 damage, `DamageSource.mobProjectile`, no velocity
  // scaling at all (unlike an arrow, which this engine's own `Cb.ARROW_BASE_DAMAGE` names).
  Ll.SPIT_DAMAGE = 1;
  // `spitAt`'s own `setVelocity(dx, dy + dist, dz, 1.5F, 10.0F)` — 1.5 is the POWER this file
  // transcribes; the 10.0F UNCERTAINTY (a Gaussian jitter on the aim) is the same named
  // simplification `Cb.mobShoot`'s own header already takes for the bow-arrow case (14j_combat.
  // js, read this pass) — no Gaussian-inaccuracy substrate exists anywhere in this engine yet.
  Ll.SPIT_POWER = 1.5;
  Ll.SPIT_UNCERTAINTY = 10.0;   // the 10.0F; Gaussian * 0.0075 * 10 per axis (Po.throwVelocity)
  // Neither `LlamaEntity` nor `LlamaSpitEntity` (.decomp, both read in full) exposes a
  // per-species eye-height table this engine can read; `Cb.ARROW_EYE_FRACTION` (14j_combat.js)
  // already names this exact gap for the bow-arrow case and picks `0.85 * height` as the
  // transcribed stand-in — reused verbatim here rather than invented a second time.
  Ll.EYE_FRACTION = 0.85;

  /** `new LlamaSpitEntity(World, LlamaEntity)`'s own ctor-time `setPosition` (.decomp): offset
   *  half of (width+1) sideways off the shooter's own yaw (`bodyYaw` — this engine keeps one
   *  `e.yaw`, no separate body/head split, the same collapse `Ai.ProjectileAttackGoal`'s own
   *  `e.yaw = atan2(...)` already leans on), spawned at `eyeY - 0.1`. */
  Ll.spitSpawnPos = function (e) {
    var w = (e && e.width) || 0.9, h = (e && e.height) || 1.87;
    var yaw = (NS.Ai && NS.Ai.bodyYawOf) ? NS.Ai.bodyYawOf(e) : ((e && e.yaw) || 0);
    var eye = NS.Combat.eyeHeightOf(e);   // #2746 HorseBaseEntity.getActiveEyeHeight = height*0.95
    return {
      x: e.x - (w + 1.0) * 0.5 * Math.sin(yaw),
      y: e.y + eye - 0.1,
      z: e.z + (w + 1.0) * 0.5 * Math.cos(yaw)
    };
  };

  /** `LlamaEntity.spitAt` (.decomp): aim at the target's `getBodyY(1/3)`, add a shallow upward
   *  arc scaled by horizontal distance (`dist * 0.2` — the SAME `* 0.2` shape `Cb.mobShoot`'s
   *  own `ARROW_ARC` already names for the unenchanted-bow case, transcribed independently here
   *  off llama's own literal), normalize, scale by `SPIT_POWER` (the uncertainty spread omitted,
   *  see that constant's own header). */
  Ll.spitVelocity = function (e, target, rand) {
    var spawn = Ll.spitSpawnPos(e);
    var th = (target && target.height) || 1.8;
    var ty = (target && target.y !== undefined ? target.y : e.y) + th / 3;
    var dx = target.x - e.x, dz = target.z - e.z;
    var dist = Math.sqrt(dx * dx + dz * dz) * 0.2;
    var dy = ty - spawn.y + dist;
    // ProjectileEntity.setVelocity(.., 1.5F, 10.0F): normalise, + Gaussian * 0.0075 * 10 per axis.
    var Po = NS.Potion, r = rand || NS.fbRand;
    if (Po && Po.throwVelocity) return Po.throwVelocity(dx, dy, dz, Ll.SPIT_POWER, Ll.SPIT_UNCERTAINTY, r);
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    var p = Ll.SPIT_POWER;
    return { vx: dx / len * p, vy: dy / len * p, vz: dz / len * p };
  };

  /** `ProjectileAttackGoal`'s own injected `onShoot(mob, target, pullProgress)` — the caller
   *  supplies the jar-specific consequence, the same shape `Cb.mobShoot`/`Po.witchThrow`
   *  already use for the bow/potion cases (`Ai.OWED`'s own standing convention, 07k_goals.js).
   *  Spawns the real projectile entity (`EL.spawn('llama_spit', ...)`, `07i_entitylist.js`'s
   *  own hitbox/motion rows) and flags `e.spit = true` so `Ai.SpitRevengeGoal` (07k_goals.js)
   *  drops the revenge target the instant the spit actually fires, exactly like
   *  `LlamaEntity.setSpit(true)`/`SpitRevengeGoal.shouldContinue` (.decomp) do together. */
  /** `Entity.playSound` for a llama event: silent llamas stay silent, the source is the mob's own
   *  category (neutral), and the volume/pitch are the caller's own literals (LlamaEntity.java). */
  Ll.playSound = function (e, ev, vol, pitch) {
    var MV = NS.MobVoice;
    if (!e || e.silent || !NS.Sound || !NS.Sound.play || (MV && MV.GATED && !MV.AUDITED[e.type])) return;   // #4003/#4464: silent until audited
    NS.Sound.play(ev, { x: e.x, y: e.y, z: e.z, volume: vol, pitch: pitch, source: 'neutral' });
  };
  var wob = function () { return 1 + (NS.fbRand() - NS.fbRand()) * 0.2; };
  Ll.isLlama = function (e) { return !!e && (e.type === 'llama' || e.type === 'trader_llama'); };
  /** getAmbientSound / getAngrySound / getEatSound / playAddChestSound / carpet SWAG, by name. */
  Ll.playAmbient = function (e) { Ll.playSound(e, 'entity.llama.ambient', 0.8, Ll.soundPitch(e)); };
  Ll.playAngry = function (e) { Ll.playSound(e, 'entity.llama.angry', 0.8, Ll.soundPitch(e)); };
  Ll.playEat = function (e) { Ll.playSound(e, 'entity.llama.eat', 1, wob()); };
  Ll.playAddChest = function (e) { Ll.playSound(e, 'entity.llama.chest', 1, wob()); };
  /** `LivingEntity.getSoundPitch`: a baby's pitch is raised by 0.5. */
  Ll.soundPitch = function (e) {
    var baby = NS.Breed && NS.Breed.isBaby ? NS.Breed.isBaby(e) : (e.age < 0);
    return (NS.fbRand() - NS.fbRand()) * 0.2 + (baby ? 1.5 : 1);
  };
  /** `onInventoryChanged`: SWAG (0.5) only when the carpet colour actually changed to a colour, age > 20. */
  Ll.onCarpetChanged = function (e, before) {
    if ((e.ticksAlive | 0) > 20 && e.carpetColor != null && e.carpetColor !== before) {
      Ll.playSound(e, 'entity.llama.swag', 0.5, 1);
    }
  };
  /** hurt vs death sound, chosen by whether the blow killed (LivingEntity.damage). Called from Cb.hurt. */
  Ll.onDamaged = function (e) {
    if (!Ll.isLlama(e)) return;
    if (e.health > 0) e.ambientChance = -400; // MobEntity.playHurtSound -> resetSoundDelay (death skips it)
    Ll.playSound(e, e.health <= 0 ? 'entity.llama.death' : 'entity.llama.hurt', 0.8, Ll.soundPitch(e));
  };
  /** MobEntity.baseTick's ambient roll (nextInt(1000) < ambientSoundChance++, reset to -400, HorseBaseEntity.getMinAmbientSoundDelay) only; the step
   *  sound is EL.tickStep's (#4483: one owner). */
  Ll.tickSounds = function (e) {
    if (!Ll.isLlama(e) || e.dead) return;
    e.ticksAlive = (e.ticksAlive | 0) + 1;
    if (e.ambientChance === undefined) e.ambientChance = 0;
    if (Math.floor(NS.fbRand() * 1000) < e.ambientChance++) {
      e.ambientChance = -400;
      Ll.playAmbient(e);
    }
  };

  Ll.spit = function (e, target, rand) {
    var EL = NS.EntityList;
    if (!EL || !EL.ready || !e || !target) return null;
    var pos = Ll.spitSpawnPos(e);
    var r = rand || NS.fbRand;
    var v = Ll.spitVelocity(e, target, r);
    var proj = EL.spawn('llama_spit', pos.x, pos.y, pos.z, { vx: v.vx, vy: v.vy, vz: v.vz, shooter: e });
    if (proj) Ll.seedSpitRot(proj);
    // spitAt: ENTITY_LLAMA_SPIT (1.0, 1+(r-r)*0.2) unless silent.
    if (!e.silent) {
      var Snd = NS.Sound;
      Ll.lastSpitSound = { ev: 'entity.llama.spit', pitch: 1 + (r() - r()) * 0.2 };
      if (Snd && Snd.entitySound) Snd.entitySound('entity.llama.spit', e.x, e.y, e.z, 1, Ll.lastSpitSound.pitch, 'neutral', NS.Player);
    }
    // LlamaSpitEntity.onSpawnPacket: seven SPIT particles at 0.4+0.1*i of the horizontal velocity.
    if (NS.Particle && NS.Particle.spawn && proj) {
      for (var i = 0; i < 7; i++) {
        var k = 0.4 + 0.1 * i;
        NS.Particle.spawn('spit', pos.x, pos.y, pos.z, v.vx * k, v.vy, v.vz * k, r);
      }
    }
    e.spit = true;
    return proj;
  };

  /**
   * `LlamaSpitEntity.tick()` — the per-tick CONSEQUENCE half (the motion/gravity/drag STEP
   * itself is `EL.motionFor`'s generic projectile integration, same dispatch slot
   * `Combat.tickArrow`'s own 07i_entitylist.js call site uses for arrow — this is a dispatch,
   * not a duplicate physics loop). Hits the first living entity (player or mob) whose box the
   * spit's own CURRENT point sits inside — the SAME strictly-weaker current-position test
   * `Cb.tickArrow`'s own header already names as a deviation from vanilla's whole-tick raycast,
   * not a second, different simplification invented here — or discards itself once embedded in
   * a solid block (`Physics.solidAt`, the boolean full-block collision this engine actually has;
   * `isInsideWaterOrBubbleColumn`'s water discard is modelled by `Cb.arrowTouchingWater`; its
   * bubble-column half is unverified — named on `Ll.OWED` below).
   */
  Ll.SPIT_SIZE = 0.25;   // LlamaSpitEntity's EntityType dimensions (.decomp)
  /** ProjectileEntity.setVelocity (.decomp): yaw/pitch AND prevYaw/prevPitch seeded from the velocity at spawn. */
  Ll.seedSpitRot = function (e) {
    e.spitPitch = e.spitPitchO = Math.atan2(e.vy || 0, Math.hypot(e.vx || 0, e.vz || 0)) * 180 / Math.PI;
    e.spitYaw = e.spitYawO = Math.atan2(e.vx || 0, e.vz || 0) * 180 / Math.PI;
    e.spitV0 = [e.vx || 0, e.vy || 0, e.vz || 0];
  };
  Ll.tick = function (e) {
    if (!e || e.removed) return;
    var Ph = NS.Physics, Cb = NS.Combat;
    // ProjectileEntity.updateRotation (.decomp): yaw/pitch (degrees, 0 at spawn) low-passed 0.2 toward the velocity's
    // vanilla reads v0 = getVelocity() BEFORE drag/gravity: the velocity this tick STARTED with = the one left at the end of the last hook
    var v0 = e.spitV0 || [e.vx || 0, e.vy || 0, e.vz || 0];
    e.spitV0 = [e.vx || 0, e.vy || 0, e.vz || 0];
    var vh = Math.hypot(v0[0], v0[2]), lp = function (a, b) { while (b - a < -180) a -= 360; while (b - a >= 180) a += 360; return a + (b - a) * 0.2; };
    e.spitPitchO = e.spitPitch || 0; e.spitYawO = e.spitYaw || 0;
    e.spitPitch = lp(e.spitPitchO, Math.atan2(v0[1], vh) * 180 / Math.PI);
    e.spitYaw = lp(e.spitYawO, Math.atan2(v0[0], v0[2]) * 180 / Math.PI);
    // whole-tick sweep: previous point -> current point (the entity moved before this hook)
    var px = e.spitPrevX !== undefined ? e.spitPrevX : e.x;
    var py = e.spitPrevY !== undefined ? e.spitPrevY : e.y;
    var pz = e.spitPrevZ !== undefined ? e.spitPrevZ : e.z;
    e.spitPrevX = e.x; e.spitPrevY = e.y; e.spitPrevZ = e.z;
    // vanilla tests the PRE-move box (px,py,pz), before setPosition(pos+vel)
    // vanilla: discard only when NO state in the 0.25 box is air (getStatesInBox.noneMatch(isAir)); or in water/bubble column
    var hw = Ll.SPIT_SIZE / 2;
    if (Ph && Ph.blockAt && NS.World && NS.States && NS.States.isAir) {
      var anyAir = false;
      for (var bx = Math.floor(px - hw); bx <= Math.floor(px + hw) && !anyAir; bx++)
        for (var by = Math.floor(py); by <= Math.floor(py + Ll.SPIT_SIZE) && !anyAir; by++)
          for (var bz = Math.floor(pz - hw); bz <= Math.floor(pz + hw); bz++)
            if (NS.States.isAir[Ph.blockAt(bx, by, bz)]) { anyAir = true; break; }
      if (!anyAir) { e.removed = true; return; }
    }
    if (Cb && Cb.arrowTouchingWater &&
        Cb.arrowTouchingWater({ x: px, y: py, z: pz, width: Ll.SPIT_SIZE, height: Ll.SPIT_SIZE })) {
      e.removed = true;
      return;
    }
    // ProjectileUtil.getCollision: the whole step is raycast against block collision shapes; a block hit discards
    var bh = Cb && Cb.arrowRaycast ? Cb.arrowRaycast(px, py, pz, e.x - px, e.y - py, e.z - pz) : null;
    var EL = NS.EntityList, list = EL && EL.list;
    // ProjectileEntity.shouldLeaveOwner: leftOwner flips once the owner's box is outside bbox.stretch(velocity).expand(1)
    // (owner only - the shared-root-vehicle passengers of vanilla's check are not modelled); canHit then lets it strike the owner
    var ow = e.shooter;
    if (!e.leftOwner && ow) {
      var ow2 = (ow.width !== undefined ? ow.width : 0.6) / 2, oh = ow.height !== undefined ? ow.height : 1.8, vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0;
      var sx0 = Math.min(e.x, e.x + vx) - hw - 1, sx1 = Math.max(e.x, e.x + vx) + hw + 1;
      var sy0 = Math.min(e.y, e.y + vy) - 1, sy1 = Math.max(e.y, e.y + vy) + Ll.SPIT_SIZE + 1;
      var sz0 = Math.min(e.z, e.z + vz) - hw - 1, sz1 = Math.max(e.z, e.z + vz) + hw + 1;
      if (ow.x + ow2 <= sx0 || ow.x - ow2 >= sx1 || ow.y + oh <= sy0 || ow.y >= sy1 || ow.z + ow2 <= sz0 || ow.z - ow2 >= sz1) e.leftOwner = true;
    } else if (!ow) e.leftOwner = true;
    var targets = [];
    // ProjectileEntity.canHit: !isSpectator() && isAlive() - such an entity never shadows a live target behind it
    var Gm = NS.Gamemode, P = NS.Player;
    if (P && !P.dead && !(Gm && Gm.isSpectator && Gm.isSpectator(P)) && (e.shooter !== P || e.leftOwner)) targets.push(P);
    if (list) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (!o || o === e || o.removed || o.dead || o.health <= 0 || (o === e.shooter && !e.leftOwner)) continue;
        // canHit = alive && collides(): carts and end crystals too (Cb.hurt routes them); boats/frames/paintings have no damage entry point yet
        if (o.maxHealth === undefined && o.type !== 'end_crystal' && !(Cb && Cb.isCart && Cb.isCart(o))) continue;
        if (o.type === 'llama_spit') continue;
        targets.push(o);
      }
    }
    var t = null, bestF = Infinity;   // getEntityCollision: the NEAREST entity along the ray
    for (var j = 0; j < targets.length; j++) {
      var tj = targets[j];
      var tw = tj.width !== undefined ? tj.width : 0.6;
      var th = tj.height !== undefined ? tj.height : 1.8;
      var IN = Cb && Cb.ARROW_ENTITY_INFLATE !== undefined ? Cb.ARROW_ENTITY_INFLATE : 0.3;
      var rt = Cb && Cb.rayBox ? Cb.rayBox(px, py, pz, e.x - px, e.y - py, e.z - pz,
        tj.x - tw / 2 - IN, tj.y - IN, tj.z - tw / 2 - IN, tj.x + tw / 2 + IN, tj.y + th + IN, tj.z + tw / 2 + IN) : null;
      var within = rt !== null && rt <= 1 && (!bh || rt <= bh.f);   // a nearer block shields the target
      if (within && rt < bestF) { bestF = rt; t = tj; }
    }
    if (t) {
      var hit;
      if (t === NS.Player) {
        hit = NS.Survival && NS.Survival.hurt ? NS.Survival.hurt(t, 'mobProjectile', Ll.SPIT_DAMAGE, e.shooter || e) : false;
      } else {
        var Cb = NS.Combat;
        hit = Cb && Cb.hurt ? Cb.hurt(t, Ll.SPIT_DAMAGE, undefined, false, { source: 'projectile', attacker: e.shooter }) : false;
        if (hit && Cb.notifyHurt) Cb.notifyHurt(t, e.shooter || e);
      }
      if (hit) return;   // vanilla onEntityHit never discards (only block/water/embed do, above)
    }
    if (bh) e.removed = true;
  };

  // ── FormCaravanGoal ─────────────────────────────────────────────────────────────────────────
  // A follow-chain: `e.llamaFollowing`/`e.llamaFollower` are this engine's `following`/
  // `follower` fields (`LlamaEntity.follow`/`stopFollowing`/`isFollowing`/`hasFollower`, .decomp,
  // read in full). `Mnt.isLeashed` (07r_mount.js, reading `e.leashHolder` — `07u_leash.js`'s own
  // truthy state) stands in for `AbstractHorseEntity.isLeashed()`.

  Ll.isFollowing = function (e) { return !!(e && e.llamaFollowing); };
  Ll.hasFollower = function (e) { return !!(e && e.llamaFollower); };
  /** `LlamaEntity.follow`/`stopFollowing` (.decomp), verbatim: a llama following a NEW leader
   *  first drops its old one (the source's own `follow` never calls `stopFollowing` itself,
   *  but nothing in this engine ever calls `follow` on an already-following llama except
   *  through `canStartCaravan`, which already refuses that case — this guard is belt-and-
   *  braces, not a modelled extra vanilla behaviour). */
  Ll.follow = function (e, target) {
    if (e.llamaFollowing) Ll.stopFollowing(e);
    e.llamaFollowing = target;
    target.llamaFollower = e;
  };
  Ll.stopFollowing = function (e) {
    if (e.llamaFollowing && e.llamaFollowing.llamaFollower === e) e.llamaFollowing.llamaFollower = null;
    e.llamaFollowing = null;
  };
  /** `FormCaravanGoal.canFollow` (.decomp), recursive, depth-capped at 8 exactly as the
   *  source's own `$$1 > 8` refusal reads: true the moment the chain reaches a LEASHED llama
   *  within eight hops, false if it runs out of chain or depth first. */
  Ll.canFollowChain = function (e, depth) {
    depth = depth || 0;
    if (depth > 8 || !Ll.isFollowing(e)) return false;
    var f = e.llamaFollowing;
    var Mnt = NS.Mount;
    if (Mnt && Mnt.isLeashed && Mnt.isLeashed(f)) return true;
    return Ll.canFollowChain(f, depth + 1);
  };

  Ll.CARAVAN_RANGE_XZ = 9;                  // AABB.expand(9.0, 4.0, 9.0) — the horizontal half
  Ll.CARAVAN_RANGE_Y = 4;                   // ...and the vertical half, both .decomp literals
  Ll.CARAVAN_MIN_DIST_SQ = 4.0;             // the source's own `$$2 < 4.0` refusal
  Ll.CARAVAN_SPEED_RAMP_DIST_SQ = 676.0;    // 26^2 — the source's own literal
  Ll.CARAVAN_SPEED_CAP = 3.0;
  Ll.CARAVAN_SPEED_RAMP = 1.2;
  Ll.CARAVAN_RAMP_TICKS = 40;

  function distSq(a, b) { var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; }

  /** `FormCaravanGoal.canStart` (.decomp), transcribed: refuses while already leashed or
   *  following; otherwise scans every OTHER llama/trader_llama in a box around this one
   *  (approximated as a per-axis box test rather than true entity-hitbox-expanded AABB overlap
   *  — the same standing simplification `Ai.RaidGoal`'s own nearest-raider scan already makes,
   *  07k_goals.js), preferring the nearest FOLLOWING-but-not-yet-followed llama, falling back to
   *  the nearest LEASHED-but-not-yet-followed one, and only starts once that candidate is
   *  either itself leashed or reachable through the chain (`canFollowChain`, depth 1 — the
   *  source's own `canFollow($$1, 1)`). */
  Ll.canStartCaravan = function (e) {
    var Mnt = NS.Mount;
    if (!Mnt) return false;
    if ((Mnt.isLeashed && Mnt.isLeashed(e)) || Ll.isFollowing(e)) return false;
    var EL = NS.EntityList, list = EL && EL.list;
    if (!list) return false;
    var near = [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || o === e || o.dead || o.removed) continue;
      if (o.type !== 'llama' && o.type !== 'trader_llama') continue;
      // Box.intersects (strict) of e's box expanded (9,4,9) against o's box, each at its own width/height
      var ew = (e.width || 0.9) / 2, ow = (o.width || 0.9) / 2, eh = e.height || 1.87, oh = o.height || 1.87;
      if (!(o.x - ow < e.x + ew + Ll.CARAVAN_RANGE_XZ && o.x + ow > e.x - ew - Ll.CARAVAN_RANGE_XZ &&
            o.y < e.y + eh + Ll.CARAVAN_RANGE_Y && o.y + oh > e.y - Ll.CARAVAN_RANGE_Y &&
            o.z - ow < e.z + ew + Ll.CARAVAN_RANGE_XZ && o.z + ow > e.z - ew - Ll.CARAVAN_RANGE_XZ)) continue;
      near.push(o);
    }
    var best = null, bestD = Infinity, i2, o2, d;
    for (i2 = 0; i2 < near.length; i2++) {
      o2 = near[i2];
      if (Ll.isFollowing(o2) && !Ll.hasFollower(o2)) {
        d = distSq(e, o2);
        if (d < bestD) { bestD = d; best = o2; }
      }
    }
    if (!best) {
      for (i2 = 0; i2 < near.length; i2++) {
        o2 = near[i2];
        if (Mnt.isLeashed && Mnt.isLeashed(o2) && !Ll.hasFollower(o2)) {
          d = distSq(e, o2);
          if (d < bestD) { bestD = d; best = o2; }
        }
      }
    }
    if (!best) return false;
    if (bestD < Ll.CARAVAN_MIN_DIST_SQ) return false;
    var leashed = Mnt.isLeashed && Mnt.isLeashed(best);
    if (!leashed && !Ll.canFollowChain(best, 1)) return false;
    Ll.follow(e, best);
    return true;
  };

  // QUEUE 0.2 (G18e remainder, Mnt.OWED/Ll.OWED close) -- `LlamaEntityRenderer.method_4037`
  // (.decomp, read in full): `TEXTURES[getVariant()]`, a flat 4-entry array in creamy/white/
  // brown/gray order -- `Mnt.rollLlamaVariant`/`Mnt.rollChildLlamaVariant` (07r_mount.js)
  // already store that SAME 0..3 index in `e.variant`, and `tools/extract-mob-textures.mjs`'s
  // own `FAMILY.llama`/`FAMILY.trader_llama` pack their four sheets in that identical order
  // (this session's own grep confirmed both), so no re-mapping table is owed here -- the
  // index IS the sheet number. `07j_entityrender.js`'s texKey chain (`Tm.skinKey` ->
  // `Rb.skinKey` -> `Fx.skinKey` -> this) reads it the same chained-fallback way those three
  // already do.
  Ll.skinKey = function (e) {
    if (!e || (e.type !== 'llama' && e.type !== 'trader_llama')) return null;
    var v = (e.variant !== undefined) ? (e.variant & 0xFF) : 0;
    if (v < 0 || v > 3) v = 0;
    return e.type + '#' + v;
  };

  // -- TraderLlamaEntity's DESPAWN half -- TraderLlamaEntity.tryDespawn/canDespawn/heldByTrader
  // (.decomp:70-88), transcribed. despawnDelay's own field default is 47999 (.decomp:21); when
  // HELD BY A TRADER it is not independently decremented at all -- every tick it is overwritten
  // to "the trader's own live despawnDelay minus one" (.decomp:74), so an unleashed llama falls
  // back to counting down from whatever that last snapshot was, exactly the real class's own
  // shape (not a guessed simplification).
  Ll.TRADER_DESPAWN_INITIAL = 47999;   // TraderLlamaEntity.java:21 -- `private int despawnDelay = 47999;`
  Ll.traderHolder = function (e) {
    var h = e && e.leashHolder;
    return (h && h.kind === 'entity' && h.entity && h.entity.type === 'wandering_trader' && !h.entity.removed) ? h.entity : null;
  };
  Ll.canTraderDespawn = function (e) {
    return !!e && !e.tamed && !Mnt_isLeashedByPlayer(e) && !(NS.Mount && NS.Mount.isRidden && NS.Mount.isRidden(e));
  };
  function Mnt_isLeashedByPlayer(e) {
    // `leashedByPlayer` (.decomp:82-84) -- leashed, but NOT to a trader.
    return !!(e && e.leashHolder && !Ll.traderHolder(e));
  }
  Ll.tickTraderLlamaDespawn = function (e) {
    if (!e || e.type !== 'trader_llama') return;
    if (e.despawnDelay === undefined) e.despawnDelay = Ll.TRADER_DESPAWN_INITIAL;
    if (!Ll.canTraderDespawn(e)) return;
    var trader = Ll.traderHolder(e);
    e.despawnDelay = trader ? (trader.despawnDelay || 0) - 1 : e.despawnDelay - 1;
    if (e.despawnDelay <= 0) {
      e.leashHolder = null;   // detachLeash(true, false) -- no drop item (.decomp:76), unlike a player-dropped lead
      e.removed = true;
    }
  };

  /**
   * TraderLlamaEntity.DefendTraderGoal (.decomp:113-142) -- TARGET only. Real vanilla reads the
   * trader's own `getAttacker()`/`getLastAttackedTime()` (a tracked attacker reference, edge-
   * triggered per hit); this engine's combat module (14j_combat.js) writes only `e.justHurt`/
   * `e.hurtFromX/Z` generically (no per-entity `lastAttacker` field anywhere to read without
   * editing that shared file) -- now Cb.notePlayerHit records e.lastAttacker/lastAttackedTime.
   */
  Ll.DefendTraderGoal = function (llama) {
    var offender = null, lastTime = 0;
    var FOLLOW = 40;   // TrackTargetGoal.getFollowRange: llama follow_range attribute
    var alive = function (o) { return !!o && !o.removed && !o.dead; };
    var range = function (o) { return Math.hypot(o.x - llama.x, o.y - llama.y, o.z - llama.z); };
    this.canUse = function () {
      var trader = Ll.traderHolder(llama);   // isLeashed() && holder is a WanderingTrader
      if (!trader) return false;
      var o = trader.lastAttacker, t = trader.lastAttackedTime || 0;
      // LivingEntity.baseTick :429: attacker forgotten 100 ticks after the hit (age stamp set by Cb.notePlayerHit)
      if (t === lastTime || !alive(o) || (trader.lastAttackedAge !== undefined && (trader.age | 0) - trader.lastAttackedAge > 100) || o === llama) return false;
      if (!NS.Ai.canTargetLiving(o, llama) || range(o) > FOLLOW) return false;   // canTrack(offender, DEFAULT): attackable + follow range
      offender = o;
      return true;
    };
    // TrackTargetGoal.shouldContinue: canTarget, same scoreboard team -> false, beyond followRange -> false
    this.canContinueToUse = function () {
      if (!alive(offender) || !NS.Ai.canTargetLiving(offender, llama)) return false;
      if (NS.Scoreboard && NS.Scoreboard.isTeammate(llama, offender)) return false;
      return range(offender) <= FOLLOW;
    };
    this.start = function () {
      llama.target = offender;
      var trader = Ll.traderHolder(llama);
      if (trader) lastTime = trader.lastAttackedTime || 0;
    };
    this.stop = function () { llama.target = null; offender = null; };   // TrackTargetGoal.stop: mob.setTarget(null)
    this.tick = function () {};
  };

  Ll.OWED = [];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
