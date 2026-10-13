// 07zd_slime.js — loop/slime-s97, QUEUE 0.2 G18c: the SLIME, whole -- the first overworld mob
// this engine spawns that is not a fixed-shape `LivingEntity` at all: its own size (1/2/4,
// occasionally split further down to 1 by combat) rewrites its box, its health, its speed and
// its attack damage every time it changes, which is why this module owns a `Sl.setSize` rather
// than letting `EL.spawn`'s usual "roll once at birth" shape stand in for it. Runs on: MAIN
// THREAD ONLY. No DOM.
//
// .decomp/net/minecraft/entity/mob/SlimeEntity.java, read WHOLE this session (526 lines) —
// every citation below is that file unless named otherwise.
//
// ⚠⚠ WHAT IS A REAL PORT, AND WHAT IS A NAMED SIMPLIFICATION.
//   * `Sl.setSize`/`Sl.rollSize` — `setSize(int,boolean)`/`initialize()` verbatim: the box scale
//     (`getDimensions(pose).scaled(0.255F*size)`, off `Ent.dimensions('slime')`'s own jar-
//     extracted 2.04x2.04), the three attribute writes (MAX_HEALTH=size^2, MOVEMENT_SPEED=
//     0.2+0.1*size, ATTACK_DAMAGE=size — `field_23716`/`field_23719`/`field_23721`,
//     `EntityAttributes.java`'s own Yarn field order), and the `nextInt(3)` + difficulty-scaled
//     bump that turns it into 1/2/4. `Sl.setSize`'s per-instance MOVEMENT_SPEED write is why
//     `Ai.movementSpeedOf` (07k_goals.js) now reads `e.speedAttr` when one is set, rather than
//     the jar's static per-TYPE table `Ent.attrsOf('slime')` carries (that row is the
//     un-overridden `MobEntity` base, correct for nothing a real slime ever does).
//   * `Sl.MoveControl` — `SlimeEntity.SlimeMoveControl.tick()` verbatim: the 90°/tick yaw wrap,
//     the on-ground `ticksUntilJump` countdown (÷3 when `jumpOften`), `setMovementSpeed`'s own
//     "set it, then zero it back out while waiting" order. It sets `e.jumping` (this engine's
//     existing `JumpControl` flag, `Ph.travelMob`'s own consumer, D-417) rather than writing
//     velocity directly — `jump()`'s own override (unread here because it does not diverge:
//     `SlimeEntity` never overrides `getJumpVelocity()`, so its `jump()` computes the exact same
//     0.42-scaled hop every other rostered ground mob's un-overridden `MobEntity.jump()` already
//     produces through that same flag) needed no new code at all.
//   * The four goals (`Sl.SwimmingGoal`/`FaceTowardTargetGoal`/`RandomLookGoal`/`MoveGoal`) and
//     the two target goals (`Sl.PlayerTargetGoal`, and golem via the EXISTING
//     `Ai.NearestAttackableTargetGoal`) are real ports of their own `canStart`/`shouldContinue`/
//     `tick` bodies, at the jar's own priorities (1/2/3/5 and TARGET 1/3).
//   * `Sl.tickTouch` — `onPlayerCollision`/`damage(LivingEntity)`: `isAlive`, the size-scaled
//     `0.6*size` reach, `canAttack()` (`!isSmall() && canMoveVoluntarily()`, simplified here to
//     `!isSmall() && !riding` — nothing in this engine ever puts a slime in a vehicle, so
//     `canMoveVoluntarily`'s other gates never differ from "not riding" today).
//   * `Sl.split` — `remove(RemovalReason)`'s own splitting half verbatim: 2+nextInt(3) children
//     at half size, the `(i%2-0.5)*size/4` / `(i/2-0.5)*size/4` offset grid, a random facing
//     each, carrying `persistent`, `customName`, `aiDisabled` and `invulnerable` forward.
//   * `Sl.isSlimeChunk`/`Sl.getSlimeRandom` — `ChunkRandom.getSlimeRandom` (.decomp
//     net/minecraft/world/gen/random/ChunkRandom.java:69-71) BIT FOR BIT: the three 32-bit int
//     multiplies (`Math.imul`, chained exactly as the jar's own left-to-right int arithmetic
//     wraps), the ONE 64-bit multiply Java's `4392871L` literal forces, the 64-bit wraparound
//     sum and the final XOR — `BigInt.asIntN(64, ...)` at each step is the SAME idiom
//     `N.positionSeed` (03b_noise.js) already established for this exact class of mixed
//     int/long bytecode arithmetic, not a fresh derivation. `NS.Noise.LegacyRandom` (the
//     already-verified `java.util.Random` port, same file) is the RNG `.nextInt(10)` is asked
//     of, so a slime chunk's own membership is bit-exact against the world seed this engine
//     already carries (`W.seed64`, `07_world.js`, the full long since #546).
//
// ⚠ WHAT IS NOT HERE, NAMED ON `Sl.OWED` RATHER THAN GUESSED OR SILENTLY DROPPED:
//   - Sound (hiss/jump/squish/hurt/death) — no mob sound substrate exists in this engine at all
//     yet, the same standing gap every other mob module already carries.
//   - The renderer (inner/outer cube geometry, the stretch/squish scale `SlimeEntity.tick()`'s
//     own `targetStretch`/`stretch` fields drive) is a SEPARATE unit's job (mob model tables);
//     this file computes and stores `e.size` and nothing about how it is drawn.
//   - Magma cube's OWN divergences (`createMagmaCubeAttributes`'s extra ARMOR attribute, its
//     overridden `jump()`/`swimUpward()` with a size-scaled boost, `canAttack()` with NO
//     `isSmall()` gate, fall-damage immunity) are real and read (.decomp, in full) but not
//     wired: it is Nether-only to spawn (`MagmaCubeEntity.canMagmaCubeSpawn`, no biome/light/
//     chunk gate at all beyond difficulty) and this unit's own task named it optional. Its
//     motion pair is measured alongside slime's (`EL.motionFor`, 07i_entitylist.js) so the
//     closed-set gate does not block the day its own goals/spawn close this gap.

(function (NS) {
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6439)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = NS.JRandom ? new NS.JRandom(0x6439) : { s: 0x6439, nextDouble: function () { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return this.s / 4294967296; } }; return fbR.nextDouble(); }
  'use strict';

  var Sl = NS.Slime = { ready: false };

  Sl.init = function () {
    Sl.ready = !!(NS.EntityList && NS.EntityList.ready && NS.Entities && NS.Entities.ready);
    return Sl;
  };

  var DEG = Math.PI / 180;

  // ── SIZE, THE BOX AND THE THREE ATTRIBUTES ────────────────────────────────────────────────
  Sl.MIN_SIZE = 1;    // SlimeEntity.MIN_SIZE
  Sl.MAX_SIZE = 127;  // SlimeEntity.MAX_SIZE

  Sl.isSmall = function (e) { return (e.size || 1) <= 1; };          // isSmall(): getSize()<=1

  /**
   * `setSize(int, boolean)` verbatim. `heal` is vanilla's own second argument — true at natural
   * spawn and at a split child's own construction, false nowhere any live caller in this engine
   * reaches yet (`Sl.OWED`'s standing "no NBT round trip" gap, same as every other mob).
   */
  Sl.setSize = function (e, size, heal) {
    size = Math.max(Sl.MIN_SIZE, Math.min(Sl.MAX_SIZE, size | 0));
    e.size = size;
    var dim = NS.Entities.dimensions(e.type);
    var scale = 0.255 * size;             // getDimensions(pose).scaled(0.255F * size)
    if (dim) { e.width = dim.width * scale; e.height = dim.height * scale; }
    e.maxHealth = size * size;            // field_23716 MAX_HEALTH
    if (heal) e.health = e.maxHealth;
    else if (e.health > e.maxHealth) e.health = e.maxHealth;
    e.speedAttr = 0.2 + 0.1 * size;       // field_23719 MOVEMENT_SPEED -- Ai.movementSpeedOf reads this
    if (e.type === 'magma_cube') {        // MagmaCubeEntity.setSize / jump / swimUpward overrides
      e.armorBase = size * 3;             // field_23724 ARMOR (Eq.armorOf reads it)
      e.jumpBonus = size * 0.1;
      e.lavaSwimVy = 0.22 + size * 0.05;
    }
    e.attackDamage = size + (e.type === 'magma_cube' ? 2 : 0);   // ATTACK_DAMAGE; MagmaCubeEntity.getDamageAmount() = super + 2
    e.experiencePoints = size;            // SlimeEntity.setSize's own xp field, now consumed by
                                           // Xp.xpToDrop (07zz_xporb.js, G21) on death
  };

  // ── SOUNDS + LANDING PARTICLES — SlimeEntity.tick / SlimeMoveControl / damage ──────────────
  function play(e, ev, vol, pitch) {
    if (e.silent || !NS.Sound || !NS.Sound.play) return false;
    return NS.Sound.play(ev, { x: e.x, y: e.y, z: e.z, volume: vol, pitch: pitch, source: 'neutral' });
  }
  Sl.play = play;
  function prefix(e) { return e.type === 'magma_cube' ? 'entity.magma_cube.' : 'entity.slime.'; }
  /** `getSoundVolume()` = 0.4 * size. */
  Sl.soundVolume = function (e) { return 0.4 * (e.size || 1); };
  /** `getJumpSound()` + `getJumpSoundPitch()`: small 1.4, else 0.8 (magma: one `jump` event, no `_small`). */
  Sl.playJump = function (e) {
    var small = Sl.isSmall(e), ev = prefix(e) + (e.type === 'magma_cube' || !small ? 'jump' : 'jump_small');
    var pitch = ((RNDFB() - RNDFB()) * 0.2 + 1.0) * (small ? 1.4 : 0.8);
    return play(e, ev, Sl.soundVolume(e), pitch);
  };
  /** `getParticles()`: magma_cube flame (field_11240), slime item_slime (a slime-ball item crack). */
  Sl.spawnLandingParticles = function (e) {
    var Px = NS.Particles, size = e.size || 1, n = 0;
    if (!Px || !Px.spawn) return 0;
    for (var i = 0; i < size * 8; i++) {
      var a = RNDFB() * Math.PI * 2, f = RNDFB() * 0.5 + 0.5;
      var ox = Math.sin(a) * size * 0.5 * f, oz = Math.cos(a) * size * 0.5 * f;
      var q = e.type === 'magma_cube' ? Px.spawn('flame', e.x + ox, e.y, e.z + oz, 0, 0, 0)
        : Px.spawn('item_crack', e.x + ox, e.y, e.z + oz, 0, 0, 0, undefined, 'slime_ball');
      if (q) n++;
    }
    return n;
  };
  /** The landing half of `SlimeEntity.tick`: onGround && !onGroundLastTick -> particles + squish. */
  Sl.tickLanding = function (e) {
    var land = !!e.onGround && !e.onGroundLastTick;   // the one shared flag; Sl.tickStretch advances it
    if (!land) return false;
    Sl.spawnLandingParticles(e);
    play(e, prefix(e) + (Sl.isSmall(e) ? 'squish_small' : 'squish'), Sl.soundVolume(e),
      ((RNDFB() - RNDFB()) * 0.2 + 1.0) / 0.8);
    return true;
  };

  /** `getTicksUntilNextJump()` — `random.nextInt(20) + 10`. */
  Sl.ticksUntilNextJump = function (rand, e) {
    var r = rand || RNDFB;
    var t = Math.floor(r() * 20) + 10;
    return (e && e.type === 'magma_cube') ? t * 4 : t;   // MagmaCubeEntity: super * 4
  };

  /**
   * `initialize(...)` — the natural-spawn size roll. `nextInt(3)` then a difficulty-scaled bump
   * that can only ever move 0->1 or 1->2 (never 2->3, `sizeIdx<2` gates it), giving 1/2/4.
   * `LocalDifficulty.getClampedLocalDifficulty()` is `Eq.clampedLocalDifficulty()`
   * (07y_equip.js) — the SAME already-collapsed `Diff.get()` table `MobEntity.initEquipment`'s
   * own armour roll already uses, not a second approximation of the same jar method.
   */
  Sl.rollSize = function (e, rand) {
    var r = rand || RNDFB;
    var Eq = NS.Equip;
    var localDiff = (Eq && Eq.clampedLocalDifficulty) ? Eq.clampedLocalDifficulty(Eq.at ? Eq.at(e) : undefined) : 1.0;
    var sizeIdx = Math.floor(r() * 3);
    if (sizeIdx < 2 && r() < 0.5 * localDiff) sizeIdx++;
    Sl.setSize(e, 1 << sizeIdx, true);
  };

  // ── THE MOVE CONTROL — `SlimeEntity.SlimeMoveControl.tick()` ─────────────────────────────
  //
  // One per mob, attached lazily at spawn (`Ai.ROSTER.slime`, below) — the same "control object
  // per mob, ticked once after the goals" shape `e.flyMove` (07t_fly.js) already established,
  // reused verbatim rather than re-invented for the ground case.
  function MoveControl(e) {
    this.e = e;
    this.targetYaw = e.yaw || 0;
    this.jumpOften = false;
    this.moving = false;
    this.speed = 0;
  }
  /** `look(float, boolean)`. */
  MoveControl.prototype.look = function (yaw, jumpOften) { this.targetYaw = yaw; this.jumpOften = !!jumpOften; };
  /** `move(double)` — sets state to MOVE_TO. */
  MoveControl.prototype.move = function (speed) { this.speed = speed; this.moving = true; };
  MoveControl.prototype.tick = function () {
    var Ai = NS.Ai, e = this.e;
    e.yaw = Ai.rotlerp(e.yaw, this.targetYaw, 90 * DEG);
    e.headYaw = e.yaw; e.bodyYaw = e.yaw;
    if (!this.moving) { Ai.setMobSpeed(e, 0); return; }   // state != MOVE_TO -> setForwardSpeed(0)
    this.moving = false;                                   // state = WAIT, immediately
    if (e.onGround) {
      Ai.setMobSpeed(e, this.speed * Ai.movementSpeedOf(e));
      if (e.slimeTicksUntilJump === undefined) e.slimeTicksUntilJump = 0;   // field starts 0
      if (e.slimeTicksUntilJump-- <= 0) {                                    // post-decrement, as vanilla
        e.slimeTicksUntilJump = Sl.ticksUntilNextJump(null, e);
        if (this.jumpOften) e.slimeTicksUntilJump = Math.floor(e.slimeTicksUntilJump / 3);
        e.jumping = true;   // JumpControl.setActive() -- Ph.travelMob's own consumer, D-417
        Sl.playJump(e);     // makesJumpSound() = size > 0, always true
      } else {
        Ai.setMobSpeed(e, 0);   // sidewaysSpeed = forwardSpeed = 0, movementSpeed = 0
      }
    } else {
      Ai.setMobSpeed(e, this.speed * Ai.movementSpeedOf(e));
    }
  };
  Sl.MoveControl = MoveControl;

  // ── THE FOUR GOALS ─────────────────────────────────────────────────────────────────────────

  /** `SwimmingGoal` — MOVE|JUMP, priority 1. */
  function SwimmingGoal(e) { this.e = e; }
  SwimmingGoal.prototype.canUse = function () { return !!(this.e.inWater || this.e.inLava); };
  SwimmingGoal.prototype.canContinueToUse = SwimmingGoal.prototype.canUse;
  SwimmingGoal.prototype.start = function () {};
  SwimmingGoal.prototype.stop = function () {};
  SwimmingGoal.prototype.tick = function () {
    var e = this.e;
    if (RNDFB() < 0.8) e.jumping = true;
    e.slimeMove.move(1.2);
  };
  Sl.SwimmingGoal = SwimmingGoal;

  /** `FaceTowardTargetGoal` — LOOK, priority 2. */
  function FaceTowardTargetGoal(e) { this.e = e; this.ticksLeft = 0; }
  function targetGone(t) { return !t || t.dead || t.removed; }
  FaceTowardTargetGoal.prototype.canUse = function () {
    var t = this.e.target;
    return !targetGone(t) && NS.Ai.canTargetLiving(t, this.e);   // canTarget(target)
  };
  FaceTowardTargetGoal.prototype.canContinueToUse = function () {
    if (targetGone(this.e.target) || !NS.Ai.canTargetLiving(this.e.target, this.e)) return false;   // shouldContinue: canTarget(target)
    return --this.ticksLeft > 0;
  };
  FaceTowardTargetGoal.prototype.start = function () { this.ticksLeft = 300; };   // toGoalTicks(300)
  FaceTowardTargetGoal.prototype.stop = function () {};
  FaceTowardTargetGoal.prototype.tick = function () {
    var Ai = NS.Ai, e = this.e, t = e.target;
    if (t) {
      // `lookAtEntity(target, 10, 10)` folded into this engine's single combined yaw (D-422's
      // own named simplification: no separate head/body yaw exists here at all) -- 10 deg/tick,
      // bearing convention matching `Fl.MoveControl`'s own `atan2(d0, -d2)` (07t_fly.js).
      var desired = Math.atan2(t.x - e.x, -(t.z - e.z));
      e.yaw = Ai.rotlerp(e.yaw, desired, 10 * DEG);
    }
    e.slimeMove.look(e.yaw, Sl.canAttack(e));
  };
  Sl.FaceTowardTargetGoal = FaceTowardTargetGoal;

  /** `RandomLookGoal` — LOOK, priority 3. */
  function RandomLookGoal(e) { this.e = e; this.targetYaw = e.yaw || 0; this.timer = 0; }
  RandomLookGoal.prototype.canUse = function () {
    var e = this.e;
    var Ef = NS.Effects;
    return !e.target && !!(e.onGround || e.inWater || e.inLava ||
      (Ef && Ef.amplifierOf && Ef.amplifierOf(e, 'levitation') >= 0));
  };
  RandomLookGoal.prototype.canContinueToUse = RandomLookGoal.prototype.canUse;
  RandomLookGoal.prototype.start = function () {};
  RandomLookGoal.prototype.stop = function () {};
  RandomLookGoal.prototype.tick = function () {
    if (--this.timer <= 0) {
      this.timer = 40 + Math.floor(RNDFB() * 60);   // getTickCount(40 + nextInt(60))
      this.targetYaw = RNDFB() * 2 * Math.PI;        // nextInt(360), as radians
    }
    this.e.slimeMove.look(this.targetYaw, false);
  };
  Sl.RandomLookGoal = RandomLookGoal;

  /** `MoveGoal` — MOVE|JUMP, priority 5. */
  function MoveGoal(e) { this.e = e; }
  MoveGoal.prototype.canUse = function () { return !this.e.riding; };   // !hasVehicle()
  MoveGoal.prototype.canContinueToUse = MoveGoal.prototype.canUse;
  MoveGoal.prototype.start = function () {};
  MoveGoal.prototype.stop = function () {};
  MoveGoal.prototype.tick = function () { this.e.slimeMove.move(1.0); };
  Sl.MoveGoal = MoveGoal;

  // ── THE TARGET GOALS ───────────────────────────────────────────────────────────────────────

  /** `canAttack()` — `!isSmall() && canMoveVoluntarily()`; `canMoveVoluntarily` simplified to
   *  `!riding && !aiDisabled` (Sl.OWED: nothing else it gates on — sleeping, being ridden by a passenger with
   *  control — applies to a slime in this engine today). */
  Sl.canAttack = function (e) {
    const mv = !e.riding && !e.aiDisabled;           // canMoveVoluntarily(): MobEntity adds !isAiDisabled()
    if (e.type === 'magma_cube') return mv;          // MagmaCubeEntity.canAttack(): canMoveVoluntarily() only
    return !Sl.isSmall(e) && mv;
  };

  /**
   * `ActiveTargetGoal<PlayerEntity>(this, 10, true, false, |dy|<=4)` — priority 1, TARGET.
   * `checkVisibility=true` is `Sl.OWED`'s named `canSee`-always-true gap (this goal's own
   * `canUse` never actually calls a visibility check here, same standing as every other
   * rostered mob's target goal).
   */
  function PlayerTargetGoal(e, ctx) { this.e = e; this.ctx = ctx || {}; this.unseen = 0; }
  PlayerTargetGoal.prototype.canUse = function () {
    var e = this.e, players = this.ctx.players ? this.ctx.players() : [];
    // ActiveTargetGoal(…, 10, …): 10 is reciprocalChance, reducedTickDelay 5 per every-other-tick selection -> 1/10 per tick
    if ((this.ctx.rand || RNDFB)() >= 0.1) return false;
    var best = null, bestD = NS.Ai.followRangeOf(e);   // TrackTargetGoal.getFollowRange(): FOLLOW_RANGE 16
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (!p || Math.abs(p.y - e.y) > 4 || !NS.Ai.canTargetLiving(p, e) || !NS.Ai.canSee(e, p)) continue;   // TargetPredicate: no creative/spectator/peaceful
      var d = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z);
      if (d <= bestD) { best = p; bestD = d; }
    }
    if (best) { e.target = best; this.unseen = 0; return true; }
    return false;
  };
  PlayerTargetGoal.prototype.canContinueToUse = function () {
    var e = this.e, t = e.target;
    if (!t) return false;
    if (!NS.Ai.canTargetLiving(t, e)) return false;   // no |dy| test here: it lives only in ActiveTargetGoal.targetPredicate (canUse)
    // TrackTargetGoal.shouldContinue: mustSee -> drop after >60 ticks unseen
    if (NS.Ai.canSee(e, t)) this.unseen = 0; else if (++this.unseen > 60) return false;
    return Math.hypot(t.x - e.x, t.y - e.y, t.z - e.z) <= NS.Ai.followRangeOf(e);   // getFollowRange()
  };
  PlayerTargetGoal.prototype.start = function () {};
  PlayerTargetGoal.prototype.stop = function () { this.e.target = null; };
  PlayerTargetGoal.prototype.tick = function () {};
  Sl.PlayerTargetGoal = PlayerTargetGoal;

  // ── CONTACT DAMAGE — `onPlayerCollision`/`damage(LivingEntity)` ─────────────────────────────
  //
  // Called once per tick per live slime, `EL.tickMob`'s own slot (07i_entitylist.js), the same
  // "after the goals" position `Cr.tick`/`Trade.tick` already occupy. Only `NS.Player` is a
  // reachable target today (`EL.aiCtx.players`'s own header: this engine has exactly one).
  // Box contact gate: player = PlayerEntity.tickMovement box.expand(1.0, 0.5, 1.0); others = plain box overlap.
  function touches(e, p, ex, ey) {
    var sw = (e.width || 0.52 * (e.size || 1)) / 2, sh = e.height || 0.52 * (e.size || 1);
    var pw = (p.width || 0.6) / 2 + ex, ph = p.height || 1.8;
    return Math.abs(p.x - e.x) < pw + sw && Math.abs(p.z - e.z) < pw + sw &&
      p.y - ey < e.y + sh && p.y + ph + ey > e.y;
  }
  Sl.tickTouch = function (e, ctx) {
    if (!Sl.ready || !e || (e.type !== 'slime' && e.type !== 'magma_cube') || e.dead || !e.health || e.health <= 0) return;
    if (!Sl.canAttack(e)) return;
    var players = (ctx && ctx.players) ? ctx.players() : (NS.Player ? [NS.Player] : []);
    var size = e.size || 1;
    var reach = 0.6 * size;
    // `pushAwayFrom`: an IronGolemEntity in contact is damaged the same way (#2825).
    var golems = (ctx && ctx.golems) ? ctx.golems() : [];
    var all = players.concat(golems);
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (!p) continue;
      if (p.type === 'iron_golem') {
        if (p.dead || p.removed) continue;
        var gx = p.x - e.x, gy = p.y - e.y, gz = p.z - e.z;
        if (gx * gx + gy * gy + gz * gz >= reach * reach || !touches(e, p, 0, 0) || !NS.Ai.canSee(e, p)) continue;
        if (ctx.hurt && ctx.hurt(p, (e.attackDamage || size), e))
          Sl.play(e, 'entity.slime.attack', 1.0, (RNDFB() - RNDFB()) * 0.2 + 1.0);
        continue;
      }
      var dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
      if (dx * dx + dy * dy + dz * dz >= reach * reach || !touches(e, p, 1.0, 0.5) || !NS.Ai.canSee(e, p)) continue;   // damage(): canSee(target)
      var Sv = NS.Survival;
      if (Sv && Sv.hurt && Sv.hurt(p, 'mob', (e.attackDamage || size), e)) {
        p.lastHurtByEntity = e;
        // `applyDamageEffects(this, target)` -> `EnchantmentHelper.onUserDamaged`: Thorns
        if (NS.Effects && NS.Effects.thornsOnUserDamaged) NS.Effects.thornsOnUserDamaged(p, e);
        Sl.play(e, 'entity.slime.attack', 1.0, (RNDFB() - RNDFB()) * 0.2 + 1.0);   // field_14863
      }
    }
  };

  // ── SPLIT ON DEATH — `remove(RemovalReason)` ─────────────────────────────────────────────
  //
  // Called from `EL.remove` (07i_entitylist.js) the moment a size>1 slime that DIED leaves the
  // world. `spawnFn` is `EL.spawn` itself, passed in rather than closed over so this module
  // never has to guess its own load order against 07i_entitylist.js.
  Sl.split = function (e, spawnFn) {
    var size = e.size || 1;
    if (size <= 1 || !spawnFn) return;
    var childSize = (size / 2) | 0;
    var count = 2 + Math.floor(RNDFB() * 3);   // 2 + nextInt(3) -> 2..4
    var scale = size / 4;
    for (var i = 0; i < count; i++) {
      var ox = ((i % 2) - 0.5) * scale;
      var oz = (Math.floor(i / 2) - 0.5) * scale;
      var opts = { size: childSize };
      if (e.persistent) opts.persistent = true;   // the one carried flag this engine's entities have
      var child = spawnFn(e.type, e.x + ox, e.y + 0.5, e.z + oz, opts);
      if (child && e.customName) child.customName = e.customName;   // setCustomName(getCustomName())
      if (child && e.aiDisabled) child.aiDisabled = true;           // setAiDisabled(isAiDisabled())
      if (child && e.invulnerable) child.invulnerable = true;       // setInvulnerable(isInvulnerable())
      if (child) child.yaw = RNDFB() * 2 * Math.PI;   // nextFloat() * 360, as radians
    }
  };

  /** `SlimeEntity.tick()`'s stretch half (#1004): stretch eases to targetStretch, lastStretch copies it,
   *  then the landing/leaving-ground edge sets targetStretch and updateStretch decays it (*0.6, magma *0.9). */
  Sl.tickStretch = function (e) {
    e.stretch = (e.stretch || 0) + ((e.targetStretch || 0) - (e.stretch || 0)) * 0.5;
    e.lastStretch = e.stretch;
    var g = !!e.onGround;
    Sl.tickLanding(e);
    if (g && !e.onGroundLastTick) e.targetStretch = -0.5;
    else if (!g && e.onGroundLastTick) e.targetStretch = 1.0;
    e.onGroundLastTick = g;
    e.targetStretch = (e.targetStretch || 0) * (e.type === 'magma_cube' ? 0.9 : 0.6);
  };

  // ── SLIME CHUNKS — `ChunkRandom.getSlimeRandom` ───────────────────────────────────────────
  Sl.SLIME_CHUNK_SALT = 987234911;

  /** `ChunkRandom.getSlimeRandom(chunkX, chunkZ, seed, salt)` — a real `NS.Noise.LegacyRandom`
   *  (`java.util.Random` port), seeded bit-for-bit off this file's own header derivation. */
  Sl.getSlimeRandom = function (chunkX, chunkZ, seed, salt) {
    var LR = NS.Noise && NS.Noise.LegacyRandom;
    if (!LR) return null;
    var t1 = Math.imul(Math.imul(chunkX, chunkX), 4987142);
    var t2 = Math.imul(chunkX, 5947611);
    var t3 = BigInt(Math.imul(chunkZ, chunkZ)) * 4392871n;
    var t4 = Math.imul(chunkZ, 389711);
    var sum = BigInt.asIntN(64, BigInt(seed) + BigInt(t1) + BigInt(t2) + t3 + BigInt(t4));
    var xored = BigInt.asIntN(64, sum ^ BigInt(salt === undefined ? Sl.SLIME_CHUNK_SALT : salt));
    return new LR(xored);
  };

  Sl.isSlimeChunk = function (chunkX, chunkZ, seed) {
    var r = Sl.getSlimeRandom(chunkX, chunkZ, seed, Sl.SLIME_CHUNK_SALT);
    return !!r && r.nextInt(10) === 0;
  };

  // ── THE ROSTER ENTRY — `SlimeEntity.initGoals()` ══════════════════════════════════════════
  NS.Ai && (NS.Ai.ROSTER.slime = function (e, ctx) {
    var Ai = NS.Ai;
    if (!e.slimeMove) e.slimeMove = new MoveControl(e);
    var gs = new Ai.GoalSelector();
    gs.add(1, Ai.MOVE | Ai.JUMP, new SwimmingGoal(e));
    gs.add(2, Ai.LOOK, new FaceTowardTargetGoal(e));
    gs.add(3, Ai.LOOK, new RandomLookGoal(e));
    gs.add(5, Ai.MOVE | Ai.JUMP, new MoveGoal(e));
    gs.add(1, Ai.TARGET, new PlayerTargetGoal(e, ctx));
    // `ActiveTargetGoal<IronGolemEntity>(this, true)` -- the EXISTING generic target goal
    // (07k_goals.js), fed the new `ctx.golems()` getter (07i_entitylist.js's own `EL.aiCtx`).
    gs.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.golems || function () { return []; }));
    return gs;
  });

  // loop/mob-test-nether-deep -- `Ai.ROSTER.magma_cube` was never set (only `slime` above was),
  // so a spawned magma_cube got `e.ai` undefined at spawn (`EL.spawn`'s own
  // `if (NS.Ai.ROSTER[name])` gate, 07i_entitylist.js) -- zero movement, zero targeting, nothing
  // but gravity, confirmed live (`tools/nethermobpeek.mjs`: hasAi:false, 0.000 blocks/s in every
  // phase). `MagmaCubeEntity extends SlimeEntity` and overrides no goal (.decomp, checked) --
  // `initGoals()` is verbatim SlimeEntity's, so this is a pure wiring gap (the logic above is
  // already fully type-agnostic, no `magma_cube`-specific branch needed), not new behavior:
  // the ARMOR/size-scaled-jump/no-isSmall-gate/fall-damage-immunity items `Sl.OWED` already
  // names stay owed, unaffected by this alias.
  NS.Ai && (NS.Ai.ROSTER.magma_cube = NS.Ai.ROSTER.slime);

  Sl.OWED = [];
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
