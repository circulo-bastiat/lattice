// 07zi_squid.js — loop/squid-s98, QUEUE 0.2 G18c: the SQUID + GLOW SQUID, whole. Runs on: MAIN
// THREAD ONLY. No DOM.
//
// .decomp/net/minecraft/entity/passive/SquidEntity.java (311 lines) and .decomp/net/minecraft/
// entity/passive/GlowSquidEntity.java (103 lines), BOTH read whole this session — every
// citation below names one of the two unless a third file is named explicitly.
//
// ⚠⚠ THE SQUID'S OWN `travel()` OVERRIDES `LivingEntity.travel()` ENTIRELY: `this.move(SELF,
// this.getVelocity())`, no friction, no gravity, no drag. Every bit of its motion is written by
// hand in `tickMovement()` — the in-water branch sets velocity DIRECTLY off the swim vector each
// tick (scaled by `swimVelocityScale`), the out-of-water branch decrements `vy` by a flat 0.08
// and multiplies by 0.98 itself. `EL.motionFor('squid'|'glow_squid')` therefore returns the
// SAME inert `[0, 1]` pair `vex`/`evoker_fangs` already use (07i_entitylist.js's own header) —
// there is nothing for the standard gravity/drag pipeline to apply, by design, not by omission.
//
// ⚠ WHAT IS A REAL PORT, WHAT IS NAMED, ON `Sq.OWED` BELOW —
//   * `Sq.swimGoalTick`/`Sq.escapeCanStart`/`Sq.escapeTick` — `SwimGoal`/`EscapeAttackerGoal`
//     verbatim (both declare NO control flags in the jar, so both simply run every tick; this
//     engine calls them directly rather than through a real `Ai.GoalSelector`/ROSTER entry,
//     which would produce the identical result for two goals that never contest a flag).
//   * `Sq.tickMovement` — `tickMovement()` verbatim: the thrust-timer wrap, the tentacle-angle
//     sine ramp, the swim-scale/turning-speed decay, the direct velocity write, and the
//     out-of-water manual gravity (`-0.08`, `*0.98`) and 90°-tilt settle.
//   * `Sq.tickAir` — `WaterCreatureEntity.tickWaterBreathingAir`/`baseTick` verbatim: 300 max,
//     -20 threshold, 2.0 drown damage, reset to 300 the instant it is back in water.
//   * `Sq.canSpawn`/`Sq.glowCanSpawn` — `WaterCreatureEntity.canSpawn`/`GlowSquidEntity.
//     canSpawn` verbatim (the y-band, the fluid-below/block-above tests, and glow squid's own
//     deep+dark+submerged test).
//   * Loot (`entities/squid`: 1-3 ink_sac; `entities/glow_squid`: 1-3 glow_ink_sac, both with
//     a looting-enchant bonus) needs NO code here at all — `tools/pack-loot.mjs` already packs
//     every `loot_tables/entities/*.json` in the jar regardless of which mobs this engine can
//     spawn, and `Cb.dropLoot` (14j_combat.js) already dispatches on `e.type` generically.
//     Attributes (`createSquidAttributes`: max_health 10, everything else `MobEntity`'s own
//     default) likewise need nothing here — `D.entities.attrs.squid`/`.glow_squid` already
//     carry `hp:10` from the SAME generic extraction every other mob's health comes from.
//   * Textures/geometry — `assets/mob-geometry.json` already carries baked `squid`/`glow_squid`
//     layers (`tools/extract-mob-textures.mjs`'s own header names `glow_squid` as a real,
//     already-mapped 1.18.2-only skin path) — nothing to add here either.
//
//   NOT HERE, NAMED ON `Sq.OWED` RATHER THAN GUESSED OR SILENTLY DROPPED —
//   - sound (ambient/hurt/death/squirt) and the ink-cloud/ambient-glow PARTICLES — no sound or
//     particle substrate exists in this engine at all yet (the same standing gap every other
//     mob module already carries; `07j_entityrender.js`'s own `setupAnim` header names "squid
//     tentacles" by name as a per-mob override this session did not port).
//   - (#1570 closed) the glow squid's full-bright draw is `ER.glowSquidBlockLight`.
//   - (struck loop/despawn-s105) `SwimGoal`'s `getDespawnCounter() > 100` branch is wired.
//   - `isTouchingWater()` is `e.inWater` (tickMovement's isInsideWaterOrBubbleColumn is ported: Sq.insideWaterOrBubbleColumn)
//     (the single feet-cell test `Ph.updateFluids` already provides) — no bubble-column model
//     exists in this engine, the same single-flag simplification `Sl.SwimmingGoal`/`Ai.
//     FloatGoal` already carry.
//   - (`canBeLeashedBy`: SquidEntity overrides WaterCreatureEntity's false to `!isLeashed()`, so a
//     squid IS leashable; the per-type gate is `Tm.NO_LEASH` in 07n_tame.js.)
//   - NBT round-trip (thrust/tilt/roll/tentacle/darkTicksRemaining) — 16b_save.js does not
//     persist entities at all yet, the same standing gap `Sl.OWED` already names.

(function (NS) {
  'use strict';

  var Sq = NS.Squid = { ready: false };

  Sq.init = function () {
    Sq.ready = !!(NS.EntityList && NS.EntityList.ready && NS.Entities && NS.Entities.ready);
    return Sq;
  };

  Sq.random = null;   // injection point (same contract as `Bat.random`/`EL.random`)
  function rndSrc() { return Sq.random || (NS.EntityList && NS.EntityList.random) || NS.fbRand; }
  // java.util.Random (the generator JRandom in 07j_entityrender.js is): vanilla seeds each squid's own
  // `random` with getId(). An injected Sq.random still wins (the checks force rolls through it).
  function JRnd(seed) { this.s = (BigInt(seed) ^ 0x5DEECE66Dn) & 0xFFFFFFFFFFFFn; }
  JRnd.prototype.next = function (bits) {
    this.s = (this.s * 0x5DEECE66Dn + 0xBn) & 0xFFFFFFFFFFFFn;
    return Number(this.s >> BigInt(48 - bits));
  };
  JRnd.prototype.nextFloat = function () { return this.next(24) / 16777216; };
  JRnd.prototype.nextInt = function (bound) {
    var bits, val;
    do { bits = this.next(31); val = bits % bound; } while (bits - val + (bound - 1) > 0x7FFFFFFF);
    return val;
  };
  Sq.JRnd = JRnd;
  function own(e) { return e.sqRandom || (e.sqRandom = new JRnd(e.id | 0)); }
  function rint(e, n) { return Sq.random ? Math.floor(Sq.random() * n) : own(e).nextInt(n); }
  function rfloat(e) { return Sq.random ? Sq.random() : own(e).nextFloat(); }

  // ── SPAWN-TIME INIT — `SquidEntity`'s own constructor field initialisers ─────────────────
  Sq.spawnInit = function (e) {
    e.thrustTimer = 0; e.prevThrustTimer = 0;
    e.tentacleAngle = 0; e.prevTentacleAngle = 0;
    e.tiltAngle = 0; e.prevTiltAngle = 0;
    e.rollAngle = 0; e.prevRollAngle = 0;
    e.swimVelocityScale = 0; e.turningSpeed = 0;
    e.swimX = 0; e.swimY = 0; e.swimZ = 0;
    // `this.random.setSeed(this.getId()); this.thrustTimerSpeed = 1F/(nextFloat()+1F)*0.2F` —
    // the per-instance reseed is e.sqRandom (java.util.Random seeded with the id).
    e.sqRandom = new JRnd(e.id | 0);
    e.thrustTimerSpeed = 1 / (rfloat(e) + 1) * 0.2;
    e.squidAir = 300;
    // s113: guarded so a save-restored DarkTicksRemaining (07zw_mobnbt.js) survives this init.
    if (e.type === 'glow_squid' && e.darkTicksRemaining === undefined) e.darkTicksRemaining = 0;   // `initDataTracker`'s own default
  };

  Sq.setSwimmingVector = function (e, x, y, z) { e.swimX = x; e.swimY = y; e.swimZ = z; };
  Sq.hasSwimmingVector = function (e) { return e.swimX !== 0 || e.swimY !== 0 || e.swimZ !== 0; };

  // ── HELPERS — block/fluid tests, the same shape `Bat`'s `solidBlockAt`/`isAir` already use ──
  function isAir(x, y, z) { return NS.World.getBlock(x, y, z) === 0; }
  function isWaterAt(x, y, z) {
    var st = NS.World.getBlock(x, y, z);
    return st > 0 && NS.States.block[st] === NS.Reg.id.water;
  }

  // ── THE TWO GOALS — `SwimGoal` (priority 0) then `EscapeAttackerGoal` (priority 1). Neither
  // declares a control flag in the jar, so both simply run every tick; ticked in priority
  // order, `Sq.escapeTick` (ticked SECOND) overwrites the swim vector `Sq.swimGoalTick` (ticked
  // FIRST) may just have set, exactly the effect the jar's own 0-then-1 goal selector order
  // produces. ─────────────────────────────────────────────────────────────────────────────────

  /** `SwimGoal.tick()`. */
  Sq.swimGoalTick = function (e) {
    // `toGoalTicks(50)` collapse for a goal that does not override `shouldRunEveryTick()` (so
    // it defaults false) — the SAME `nextInt(50) === 0` reduction 07k_goals.js's own
    // `HorseBondWithPlayerGoal` header derives for the identical `toGoalTicks(50)` shape.
    // loop/despawn-s105: the `getDespawnCounter() > 100` branch (SquidEntity.java:299-301) --
    // an idle squid far from the player stops swimming (07l_spawn.js keeps the counter now).
    if ((e.despawnCounter | 0) > 100) { Sq.setSwimmingVector(e, 0, 0, 0); return; }
    if (rint(e, 50) === 0 || !e.inWater || !Sq.hasSwimmingVector(e)) {
      var angle = rfloat(e) * (Math.PI * 2);
      var x = Math.cos(angle) * 0.2;
      var y = -0.1 + rfloat(e) * 0.2;
      var z = Math.sin(angle) * 0.2;
      Sq.setSwimmingVector(e, x, y, z);
    }
  };

  /** `EscapeAttackerGoal.canStart()`. `e.lastHurtByEntity` (`Cb.notifyHurt`, 14j_combat.js) is
   *  this engine's own stand-in for `getAttacker()` — the same field `Ai.HurtByTargetGoal`/
   *  `Ai.UniversalAngerGoal` already read for the identical reason (07k_goals.js's D-391
   *  header): one attacker type, one field, no separate `setAttacker` substrate to port. */
  Sq.escapeCanStart = function (e) {
    var a = NS.Fly.attackerOf(e);   // getAttacker(): forgotten 100 ticks after the last hit
    if (!e.inWater || !a || a.dead || a.removed) return false;
    var dx = e.x - a.x, dy = e.y - a.y, dz = e.z - a.z;
    return (dx * dx + dy * dy + dz * dz) < 100.0;   // `squaredDistanceTo($$0) < 100.0`
  };

  /** `EscapeAttackerGoal.tick()`. */
  Sq.escapeTick = function (e) {
    var a = NS.Fly.attackerOf(e);
    if (!a) return;
    e.squidEscapeTimer = (e.squidEscapeTimer || 0) + 1;
    var dx = e.x - a.x, dy = e.y - a.y, dz = e.z - a.z;
    var bx = Math.floor(e.x + dx), by = Math.floor(e.y + dy), bz = Math.floor(e.z + dz);
    var air = isAir(bx, by, bz);
    if (isWaterFluidAt(bx, by, bz) || air) {
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > 0) {
        // vanilla's `$$1.normalize();` discards its result (Vec3d is immutable): the RAW delta is scaled
        var scale = 3.0;
        if (len > 5.0) scale -= (len - 5.0) / 5.0;
        if (scale > 0) { dx *= scale; dy *= scale; dz *= scale; }
      }
      if (air) dy = 0;   // `$$1.subtract(0.0, $$1.y, 0.0)` -- the air-above half strips vy
      Sq.setSwimmingVector(e, dx / 20, dy / 20, dz / 20);
    }
    // EscapeAttackerGoal.tick: a bubble poke every 10th tick (timer % 10 === 5)
    if (e.squidEscapeTimer % 10 === 5 && NS.Particle) {
      NS.Particle.spawn('bubble', e.x, e.y, e.z, 0, 0, 0);
    }
  };

  // The jar's two goals as selector goals (no control flags: flags 0, they never contest anything).
  Sq.SwimGoal = function (e) {
    this.canUse = function () { return true; }; this.canContinueToUse = this.canUse;
    this.start = function () {}; this.stop = function () {};
    this.tick = function () { Sq.swimGoalTick(e); };
  };
  Sq.EscapeAttackerGoal = function (e) {
    this.canUse = function () { return Sq.escapeCanStart(e); }; this.canContinueToUse = this.canUse;
    this.start = function () { e.squidEscapeTimer = 0; };   // vanilla start(): timer = 0
    this.stop = function () {};
    this.tick = function () { Sq.escapeTick(e); };
  };
  /** Both goals in selector order, for direct callers (squidcheck); the live path is the roster's selector. */
  Sq.tickAi = function (e) {
    Sq.swimGoalTick(e);
    if (Sq.escapeCanStart(e)) Sq.escapeTick(e);
  };
  if (NS.Ai && NS.Ai.ROSTER) NS.Ai.ROSTER.squid = NS.Ai.ROSTER.glow_squid = function (e) {
    var gs = new NS.Ai.GoalSelector();
    gs.add(0, 0, new Sq.SwimGoal(e));
    gs.add(1, 0, new Sq.EscapeAttackerGoal(e));
    return gs;
  };

  // ── AIR / DROWNING — `WaterCreatureEntity.tickWaterBreathingAir`/`baseTick` verbatim ───────
  Sq.tickAir = function (e) {
    if (e.squidAir === undefined) e.squidAir = 300;
    if (e.dead) return;
    if (e.inWater) { e.squidAir = 300; return; }
    e.squidAir--;
    if (e.squidAir === -20) {
      e.squidAir = 0;
      if (NS.Combat && NS.Combat.hurt) NS.Combat.hurt(e, 2.0);   // `DamageSource.DROWN`
    }
  };

  /** `Entity.isInsideWaterOrBubbleColumn()`: touching water OR the block at the feet is a bubble_column. */
  Sq.insideWaterOrBubbleColumn = function (e) {
    if (e.inWater) return true;
    var W = NS.World;
    return !!(W && W.getBlock && NS.States.block[W.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z))] === NS.Reg.id.bubble_column);
  };

  // ── tickMovement() — the thrust/tentacle/tilt/roll state machine and the velocity write ────
  Sq.tickMovement = function (e) {
    e.prevTiltAngle = e.tiltAngle || 0;
    e.prevRollAngle = e.rollAngle || 0;
    e.prevThrustTimer = e.thrustTimer || 0;
    e.prevTentacleAngle = e.tentacleAngle || 0;
    e.thrustTimer = (e.thrustTimer || 0) + (e.thrustTimerSpeed === undefined ? 0.2 : e.thrustTimerSpeed);
    if (e.thrustTimer > Math.PI * 2) {
      e.thrustTimer -= Math.PI * 2;
      if (rint(e, 10) === 0) e.thrustTimerSpeed = 1 / (rfloat(e) + 1) * 0.2;
      // `world.sendEntityStatus(this, 19)` resets the CLIENT copy of `thrustTimer` to 0 — this
      // single-process engine has no separate client, and the server-side effect above (the
      // `-= 2π` wrap) already IS the post-reset value the split would otherwise produce.
    }
    if (Sq.insideWaterOrBubbleColumn(e)) {
      if (e.thrustTimer < Math.PI) {
        var t0 = e.thrustTimer / Math.PI;
        e.tentacleAngle = Math.sin(t0 * t0 * Math.PI) * Math.PI * 0.25;
        if (t0 > 0.75) { e.swimVelocityScale = 1.0; e.turningSpeed = 1.0; }
        else { e.turningSpeed = (e.turningSpeed || 0) * 0.8; }
      } else {
        e.tentacleAngle = 0.0;
        e.swimVelocityScale = (e.swimVelocityScale || 0) * 0.9;
        e.turningSpeed = (e.turningSpeed || 0) * 0.99;
      }
      e.vx = (e.swimX || 0) * e.swimVelocityScale;
      e.vy = (e.swimY || 0) * e.swimVelocityScale;
      e.vz = (e.swimZ || 0) * e.swimVelocityScale;
      // `bodyYaw += (-atan2(vx,vz)deg - bodyYaw)*0.1F; setYaw(bodyYaw)` -- UNWRAPPED and run at
      // zero velocity too (atan2(0,0)=0), like vanilla (#3076). Radians; the engine's yaw is
      // vanilla's + PI (`atan2(dx,-dz)`, D-415), so the target is PI - atan2(vx,vz).
      e.yaw = (e.yaw || 0) + (Math.PI - Math.atan2(e.vx, e.vz) - (e.yaw || 0)) * 0.1;
      e.rollAngle = (e.rollAngle || 0) + Math.PI * e.turningSpeed * 1.5;
      var hlen = Math.sqrt(e.vx * e.vx + e.vz * e.vz);
      var targetTilt = -Math.atan2(hlen, e.vy) * (180 / Math.PI);
      e.tiltAngle = (e.tiltAngle || 0) + (targetTilt - (e.tiltAngle || 0)) * 0.1;
    } else {
      e.tentacleAngle = Math.abs(Math.sin(e.thrustTimer)) * Math.PI * 0.25;
      var vy = e.vy || 0;
      // `hasStatusEffect(LEVITATION)` -- the rise is SET, `0.05*(amp+1)`, not eased toward as
      // LivingEntity.travel's land branch does (#295, .decomp SquidEntity.java:154-158).
      var lev = NS.Effects && NS.Effects.amplifierOf ? NS.Effects.amplifierOf(e, 'levitation') : -1;
      if (lev >= 0) vy = 0.05 * (lev + 1);
      else if (!e.noGravity) vy -= 0.08; // `MobEntity`'s own un-overridden gravity literal
      e.vx = 0; e.vy = vy * 0.98; e.vz = 0;
      e.tiltAngle = (e.tiltAngle || 0) + (-90.0 - (e.tiltAngle || 0)) * 0.02;
    }
    // `GlowSquidEntity.tickMovement`'s own half: the countdown, THEN the ambient glow particle
    if (e.type === 'glow_squid') {
      if (e.darkTicksRemaining > 0) e.darkTicksRemaining--;
      if (NS.Particle) {   // addParticle(GLOW, getParticleX(0.6), getRandomBodyY(), getParticleZ(0.6), 0, 0, 0)
        NS.Particle.spawn('glow', e.x + (e.width || 0.8) * (2 * NS.fbRand() - 1) * 0.6, e.y + NS.fbRand() * (e.height || 0.8),
          e.z + (e.width || 0.8) * (2 * NS.fbRand() - 1) * 0.6, 0, 0, 0);
      }
    }
  };

  /** `travel(Vec3d)` — `this.move(SELF, this.getVelocity())` VERBATIM: no friction, no gravity,
   *  no drag folded in here, all of it already happened in `Sq.tickMovement` above. */
  Sq.travelMob = function (e) {
    if (NS.Physics && NS.Physics.move) NS.Physics.move(e, e.vx || 0, e.vy || 0, e.vz || 0);
  };

  /** One squid's whole tick, called from `EL.tickMob`'s own goal-adjacent slot
   *  (07i_entitylist.js), the SAME slot `Bat.mobTick`/`e.slimeMove.tick()` already occupy. */
  Sq.tick = function (e) {
    if (!Sq.ready) return;
    Sq.tickAir(e);
    // #1617: vanilla's tickMovement() runs super.tickMovement() (-> travel -> move with the
    // velocity LEFT BY THE PREVIOUS TICK, or by knockback/bubbles/pistons) and only THEN writes
    // the new swim velocity.
    Sq.travelMob(e);
    Sq.tickMovement(e);
  };

  // ── DAMAGE — `damage()` (the ink squirt) and `GlowSquidEntity.damage()` (dark ticks) ──────

  /** Called from `Cb.notifyHurt` (14j_combat.js) — that call site is guaranteed a real
   *  `byEntity`, this engine's own stand-in for vanilla's `getAttacker() != null` gate on
   *  `squirt()`. */
  Sq.onAttacked = function (e) {
    e.inkSquirts = (e.inkSquirts || 0) + 1;
    Sq.squirt(e);
  };

  /** `SquidEntity.squirt()`: the squirt sound at the mob's sound volume, then 30 ink particles
   *  (`getInkParticle()`: squid_ink / glow_squid_ink) from the body-rotated point below the squid. */
  Sq.squirt = function (e) {
    var glow = e.type === 'glow_squid';
    if (NS.MobVoice) NS.MobVoice.emit(e, glow ? 'entity.glow_squid.squirt' : 'entity.squid.squirt');
    if (!NS.Particle) return;
    var tilt = (e.prevTiltAngle || 0) * Math.PI / 180, by = (e.yaw || 0) - Math.PI;   // vanilla bodyYaw = engine yaw - pi
    var ct = Math.cos(tilt), st = Math.sin(tilt), cy = Math.cos(-by), sy = Math.sin(-by);
    function rot(x, y, z) {   // Vec3d.rotateX(tilt) then rotateY(-bodyYaw)
      var y1 = y * ct + z * st, z1 = z * ct - y * st;
      return [x * cy + z1 * sy, y1, z1 * cy - x * sy];
    }
    var o = rot(0, -1, 0), ox = o[0] + e.x, oy = o[1] + e.y, oz = o[2] + e.z;
    for (var i = 0; i < 30; i++) {
      var d = rot(NS.fbRand() * 0.6 - 0.3, -1, NS.fbRand() * 0.6 - 0.3), k = (0.3 + NS.fbRand() * 2) * 0.1;
      NS.Particle.spawn(glow ? 'glow_squid_ink' : 'squid_ink', ox, oy + 0.5, oz, d[0] * k, d[1] * k, d[2] * k);
    }
  };

  /** Called from `Cb.hurt` (14j_combat.js) on ANY successful hit landing, attacker or not
   *  (fire included) — `GlowSquidEntity.damage()`'s own UNCONDITIONAL half, which is why this
   *  is separate from `Sq.onAttacked` above and not gated the same way. */
  Sq.onDamaged = function (e) {
    if (e.type === 'glow_squid') e.darkTicksRemaining = 100;
  };

  // ── SPAWN RULES — `WaterCreatureEntity.canSpawn` / `GlowSquidEntity.canSpawn` verbatim ────
  // FluidTags.WATER: the water block plus kelp/seagrass/waterlogged cells (States.fluidKind 1)
  function isWaterFluidAt(x, y, z) {
    var st = NS.World.getBlock(x, y, z);
    return st > 0 && NS.States.fluidKind[st] === 1;
  }

  Sq.SEA_LEVEL = 63;   // Spawn.SEA_LEVEL's own literal (07l_spawn.js) — NoiseGeneratorSettings overworld

  /** Squid's own rule (no override): `y` within 13 of sea level, fluid below is water, AND the
   *  block directly above is the `water` block itself (not merely "in the water fluid tag"). */
  Sq.canSpawn = function (x, y, z, seaLevel) {
    var sl = seaLevel === undefined ? Sq.SEA_LEVEL : seaLevel;
    if (y < sl - 13 || y > sl) return false;
    if (!isWaterFluidAt(x, y - 1, z)) return false;
    return isWaterAt(x, y + 1, z);
  };

  /** Glow squid's own rule: deep (33+ below sea level), pitch dark (`getBaseLightLevel(pos,0)
   *  === 0`, i.e. both the sky and block components are zero), and the position itself is
   *  literally inside a water block. */
  Sq.glowCanSpawn = function (x, y, z, seaLevel) {
    var sl = seaLevel === undefined ? Sq.SEA_LEVEL : seaLevel;
    if (y > sl - 33) return false;
    var L = NS.World.getLight(x, y, z);
    var sky = (L >> 4) & 15, blk = L & 15;
    if (blk !== 0 || sky !== 0) return false;
    return isWaterAt(x, y, z);
  };

  Sq.OWED = [
    // struck loop/despawn-s105: SwimGoal's getDespawnCounter()>100 branch (Spawn.despawnTick keeps the counter)
    'NBT: thrust/tilt/roll/tentacle state and darkTicksRemaining are not read back on load -- ' +
      '16b_save.js does not persist entities at all yet, the same standing gap Sl.OWED names'
  ];
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
