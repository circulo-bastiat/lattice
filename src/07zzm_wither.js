// src/07zzm_wither.js — QUEUE 0.00 part 2 (G18 Nether/End leftover), mob-wither: the AI slice
// two earlier research-only cloud units (confident-lamport-sbjpnu, then relinquished as
// confident-lamport-suiol8) scoped and left unclaimed after confident-lamport-mdnl4x's own
// motion-substrate-before-AI slice (`EL.motionFor('wither')`, `07i_entitylist.js`, already
// landed — `EL.canSpawn('wither')`/`EL.spawn('wither', ...)` both real since that unit,
// `entlistcheck.mjs` §wither, unchanged by this file).
//
// .decomp read whole: net/minecraft/entity/boss/WitherEntity.java (571 lines).
//
// -- WHAT THIS FILE BUILDS -------------------------------------------------------------------
// `WitherEntity.initGoals()`'s own MOVE/LOOK/TARGET rows that this engine already has real
// primitives for, ported off the SAME "no chance-gate, reuse the existing goal" convention
// every other roster in this project already stands on (shulker/ghast's own file headers):
//   targetSelector 1: RevengeGoal (`Ai.RevengeGoal`)
//   targetSelector 2: ActiveTargetGoal<LivingEntity>(0, false, false, CAN_ATTACK_PREDICATE)
//     -- `Ai.NearestAttackableTargetGoal` over `Wi.candidates`, below: every live mob/player
//     whose `Combat.mobTypeOf` is not 'undead' (`CAN_ATTACK_PREDICATE`'s own
//     `getGroup() != EntityGroup.UNDEAD`; `isMobOrPlayer()` is `o.maxHealth !== undefined`,
//     the same "has a health pool" stand-in `Gh.tickFireball`'s own hit-test already uses).
//   goalSelector 5: FlyGoal(1.0) -- `Wi.FlyGoal` below (`FlyGoal.java` is in `.decomp`:
//     `WanderAroundGoal.canStart`'s 1-in-120 gate, then `getWanderTarget` = `AboveGroundTargeting`
//     (8,7, cone PI/2, 3,1) else `NoPenaltySolidTargeting` (8,4,-2); `FlightMoveControl`
//     steers via `e.flyMove`, which also toggles `noGravity` off again once idle).
//   goalSelector 6: LookAtEntityGoal(Player, 8F) -- `Ai.LookAtPlayerGoal(e, ctx.players, 8)`,
//     the same primitive cow/shulker/etc. already reuse for this exact vanilla goal.
//   goalSelector 7: LookAroundGoal -- `Ai.RandomLookAroundGoal(e, ctx.random)`.
// Plus `tickMovement()`'s own hand-written homing/leash blend (`Wi.tickMovement`, below):
// ALWAYS damps vertical velocity by 0.6, and once the wither has a live `e.target`, ALSO blends
// velocity toward it (vertical catch-up while below/near the target, horizontal steer once
// >3 blocks away) -- real per `.decomp` lines ~141-172, not a stand-in. This is what makes a
// targeting wither actually CLOSE on its target instead of merely wandering near it, since
// `FlyGoal`'s own wander (above) claims MOVE but has no notion of a target at all.
//
// Also `WitherEntity.mobTick()`'s own SIDE-HEAD skull attacks (the two heads other than the
// center head `ProjectileAttackGoal`/`attack()` already drives) -- `Wi.sideHeadsTick`, below,
// folded into the SAME per-tick `Wi.tickMovement` slot `07i_entitylist.js` already calls (this
// unit cannot add a second dispatch line to that file, and vanilla's own `mobTick()` +
// `tickMovement()` both run once a tick regardless, so combining them changes no observable
// order this engine can tell apart). Each side head keeps its OWN `skullCooldowns`/
// `chargedSkullCooldowns` slot and its OWN tracked-target reference (this engine's own object
// reference standing in for the tracked-entity-id sync fields, the SAME substitution this
// file's own `e.target`/`Wi.tickMovement` header already uses for the center head) and fires
// independently of the other two heads (.decomp `mobTick()`, read whole, lines ~250-343).
//
// -- WHAT IS DELIBERATELY NOT HERE (Wi.OWED, below) -------------------------------------------
// STALE-DOC FIX (D-800 close): this block used to also name DescendAtHalfHealthGoal/the invuln
// timer, the ARMOR attribute, and the renderer/model as missing -- all three have since landed
// (loop/wither-invuln's Wi.tickInvuln/DescendAtHalfHealthGoal; D-798's cross-mob ARMOR substrate;
// D-790/D-793's real three-head+tail renderer in 07j_entityrender.js) and are struck, not
// deleted, on Wi.OWED below. What's actually left: the ranged attack (`ProjectileAttackGoal` +
// `WitherSkullEntity`, a whole projectile entity of its own -- the same "needs its own
// projectile, a job of its own" standing shulker's still-open `ShootBulletGoal`/
// `ShulkerBulletEntity` slice had before `confident-lamport-nq63qx` closed it), damage()'s own
// invulnerability gate (lives on the generic damage path -- 14d_survival.js/14j_combat.js --
// neither of which this file owns), the boss bar percent readout (no boss-bar UI substrate
// exists in this engine yet), the soul-sand + 3-skull summoning structure detector itself (lives
// on a block/world-interaction class, not this one), and blockBreakingCooldown / the 3x3x4
// block-destruction tick (mobGriefing-gated, reads canDestroy(BlockState), a per-block predicate
// not yet extracted off .decomp).
//
// Runs on: MAIN THREAD ONLY. No DOM, no GL.

(function (NS) {
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6439)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = NS.JRandom ? new NS.JRandom(0x6439) : { s: 0x6439, nextDouble: function () { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return this.s / 4294967296; } }; return fbR.nextDouble(); }
  'use strict';

  var Wi = NS.Wither = { ready: false };

  // The jar's own float constants (`Entity`/`MathHelper`, not `180/Math.PI`) -- the SAME pair
  // `07j_entityrender.js` already defines for the identical purpose (kept local here since this
  // file runs on the game-logic side, not the renderer's).
  var DEG2RAD = 0.017453292;
  var RAD2DEG = 57.2957763671875;

  Wi.EXPERIENCE = 50;          // ctor: this.experiencePoints = 50
  Wi.LOOK_RANGE = 8.0;         // LookAtEntityGoal(this, PlayerEntity.class, 8.0F)

  // ── ranged attack: `ProjectileAttackGoal(this, 1.0, 40, 20.0F)` + `WitherSkullEntity`
  // (.decomp net/minecraft/entity/boss/WitherEntity.java, net/minecraft/entity/projectile/
  // WitherSkullEntity.java, net/minecraft/entity/projectile/ExplosiveProjectileEntity.java,
  // all read whole) -- head 0 (the CENTER head, `attack()`'s own `shootSkullAt(0, target)`,
  // `Wi.attack` below) fires through `ProjectileAttackGoal`; the two SIDE heads (headIndex 2/3
  // into `shootSkullAt`, per `.decomp` `mobTick()`'s own `shootSkullAt($$2 + 1, ...)` with
  // `$$2` in {1,2}) fire on their own independent cooldown/target-tracking loop, `Wi.sideHeadsTick`
  // below -- both real, both reuse this SAME `Wi.SKULL_*` table and `Wi.shootSkullAt` machinery.
  Wi.SKULL_SPEED = 1.0;              // ProjectileAttackGoal's own mobSpeed arg
  Wi.SKULL_INTERVAL = 40;            // ProjectileAttackGoal(this,1.0,40,20.0F) -- 4-arg ctor: min==max==40
  Wi.SKULL_RANGE = 20.0;             // ...,20.0F) -- maxShootRange
  Wi.SKULL_MUZZLE_Y = 3.0;           // WitherEntity.getHeadY(0): `this.getY() + 3.0`
  Wi.SKULL_CHARGED_CHANCE = 0.001;   // shootSkullAt(int,LivingEntity): `$$0==0 && random.nextFloat()<0.001F`
  Wi.SKULL_DAMAGE_OWNED = 8.0;       // WitherSkullEntity.onEntityHit, `getOwner() instanceof LivingEntity` branch
  Wi.SKULL_DAMAGE_UNOWNED = 5.0;     // ...else branch: `damage(DamageSource.MAGIC, 5.0F)`
  Wi.SKULL_HEAL_ON_KILL = 5.0;       // ...owned branch, target died: `$$3.heal(5.0F)`
  Wi.SKULL_EXPLOSION_POWER = 1.0;    // WitherSkullEntity.onCollision: `createExplosion(..., 1.0F, false, ...)`
  Wi.SKULL_DRAG = 0.95;              // ExplosiveProjectileEntity.getDrag() default (uncharged)
  Wi.SKULL_DRAG_CHARGED = 0.73;      // WitherSkullEntity.getDrag() override: `isCharged() ? 0.73F : super`
  Wi.SKULL_WITHER_AMPLIFIER = 1;     // onEntityHit: `new StatusEffectInstance(WITHER, ..., 1)`
  Wi.SKULL_WITHER_TICKS_NORMAL = 200;   // difficulty NORMAL: `20 * 10`
  Wi.SKULL_WITHER_TICKS_HARD = 800;     // difficulty HARD: `20 * 40` (EASY/PEACEFUL apply no effect)

  // ── side-head geometry/timing (.decomp WitherEntity.java, `mobTick()`/`getHeadX/Y/Z`, read
  // whole) -- the two side heads' own independent skull attacks. Every number below comes off
  // that method, not derived.
  Wi.SKULL_SIDE_MUZZLE_Y = 2.2;          // getHeadY($$0>0): `this.getY() + 2.2`
  Wi.SKULL_SIDE_RADIUS = 1.3;            // getHeadX/getHeadZ($$0>0): `cos/sin(ang) * 1.3`
  Wi.SIDE_HEAD_RECHECK_BASE = 10;        // mobTick: `this.age + 10 + this.random.nextInt(10)`
  Wi.SIDE_HEAD_RECHECK_RAND = 10;
  Wi.SIDE_HEAD_FIRE_COOLDOWN_BASE = 40;  // mobTick, on an actual fire-at-target: `this.age + 40 + this.random.nextInt(20)`
  Wi.SIDE_HEAD_FIRE_COOLDOWN_RAND = 20;
  Wi.SIDE_HEAD_CHARGED_BUILDUP = 15;     // mobTick: `this.chargedSkullCooldowns[$$2 - 1]++ > 15`
  Wi.SIDE_HEAD_TARGET_RANGE = 20.0;      // HEAD_TARGET_PREDICATE = createAttackable().setBaseMaxDistance(20.0)
  Wi.SIDE_HEAD_REFIRE_RANGE_SQ = 900.0;  // mobTick: `this.squaredDistanceTo($$9) > 900.0` (30 blocks)
  Wi.SIDE_HEAD_RANDOM_XZ = 10.0;         // hard-difficulty blind shot: `getX() +/- 10.0` / `getZ() +/- 10.0`
  Wi.SIDE_HEAD_RANDOM_Y = 5.0;           // ...: `getY() +/- 5.0`
  Wi.SIDE_HEAD_YAW_MAX_STEP = 10.0;      // tickMovement: `getNextAngle(sideHeadYaws[i], ..., 10.0F)`
  Wi.SIDE_HEAD_PITCH_MAX_STEP = 40.0;    // tickMovement: `getNextAngle(sideHeadPitches[i], ..., 40.0F)`

  // -- invulnerability timer + expiry explosion (.decomp WitherEntity.java, mobTick()
  // lines 250-266, onSummoned() lines 353-357, INVUL_TIMER/DEFAULT_INVUL_TIMER fields,
  // DescendAtHalfHealthGoal inner class lines 561-570 -- all read whole). Wi.OWED's own
  // previously-open item; the soul-sand+3-skull summoning-structure detector that is the ONLY
  // in-play caller of Wi.onSummoned (.decomp: WitherSkullBlock.java is the sole caller of
  // onSummoned()) is out of THIS unit's scope and lands on its own block/world-interaction
  // class -- Wi.onSummoned is exposed here for that future unit to call.
  Wi.DEFAULT_INVUL_TIMER = 220;        // DEFAULT_INVUL_TIMER field, and onSummoned()'s own literal
  Wi.INVUL_EXPLOSION_POWER = 7.0;      // mobTick(): createExplosion(..., 7.0F, false, $$1)
  Wi.INVUL_REGEN_AMOUNT = 10.0;        // mobTick(), invuln branch: this.heal(10.0F)
  Wi.INVUL_REGEN_INTERVAL = 10;        // mobTick(), invuln branch: this.age % 10 == 0
  Wi.SUMMON_HEALTH_FRACTION = 3.0;     // onSummoned(): this.setHealth(this.getMaxHealth() / 3.0F)

  // ── spawn ─────────────────────────────────────────────────────────────────────────
  Wi.initWither = function (e) {
    e.experiencePoints = Wi.EXPERIENCE;
    if (NS.Fly && NS.Fly.ready && !e.flyMove) e.flyMove = new NS.Fly.MoveControl(e);
    // `skullCooldowns`/`chargedSkullCooldowns` (int[2]) and the two side heads' own tracked-
    // target reference (this engine's object-reference stand-in for `TRACKED_ENTITY_ID_2/_3`,
    // the same substitution already used for the center head's `e.target`) and smoothed
    // yaw/pitch pair (`sideHeadYaws`/`sideHeadPitches`, .decomp fields of the same name).
    e.skullCooldowns = [0, 0];
    e.chargedSkullCooldowns = [0, 0];
    e.sideHeadTarget = [null, null];
    e.sideHeadYaws = [0, 0];
    e.sideHeadPitches = [0, 0];
    // `this.dataTracker.startTracking(INVUL_TIMER, 0)` (.decomp initDataTracker) --
    // `Wi.getInvulnerableTimer`/`Wi.setInvulTimer` are the get/set pair over this field.
    if (e.invulTimer === undefined) e.invulTimer = 0;   // #3648: restored from NBT 'Invul' via the mobnbt opts-copy
    // D-803 -- the wither's own `ServerBossBar` (.decomp ctor field, line 69), ported as DATA
    // (name/percent), not a UI widget -- the SAME "bossbar state as data" convention
    // `Rd.create`'s own `raid.bar` (07s_raid.js) already stands on. Real default percent is the
    // jar's own `BossBar()` ctor default, `1.0F` (.decomp `net/minecraft/entity/boss/BossBar.
    // java:22`), not a guessed 0.
    e.bossBar = { name: 'Wither', percent: 1.0, color: 'purple', darkenSky: true };
    // `mobTick()`'s own `blockBreakingCooldown` field (.decomp line 68) -- int, defaults to 0
    // (never explicitly initialised in the jar either; Java's own zero-value field default).
    e.blockBreakingCooldown = 0;
  };

  /** `mobTick()`'s own two `bossBar.setPercent(...)` call sites (.decomp lines 253/345, read
   *  whole) as one function of which branch is live -- `Wi.tickInvuln` (the invuln branch, POST-
   *  decrement `$$0`) and `Wi.tickMovement`'s else branch (the normal branch, health/maxHealth)
   *  each pass their own already-computed value in rather than re-deriving it here. */
  Wi.setBossBarPercent = function (e, pct) {
    if (!e.bossBar) e.bossBar = { name: 'Wither', percent: 1.0, color: 'purple', darkenSky: true };
    e.bossBar.percent = pct;
  };

  /** `getInvulnerableTimer()`/`setInvulTimer(int)` (.decomp lines 520-525) -- the
   *  DataTracker get/set pair this engine's own `e.invulTimer` field stands in for. */
  Wi.getInvulnerableTimer = function (e) { return e.invulTimer || 0; };
  Wi.setInvulTimer = function (e, n) { e.invulTimer = n; };

  /** `onSummoned()` (.decomp lines 353-357) -- the ONE real vanilla caller of
   *  `setInvulTimer(220)` (`WitherSkullBlock.java`'s own summoning-structure detector,
   *  out of this unit's scope -- see this file's own header and `Wi.OWED`). Exposed here
   *  so that future unit has a real method to call rather than poking `e.invulTimer`
   *  directly. */
  Wi.onSummoned = function (e) {
    Wi.setInvulTimer(e, Wi.DEFAULT_INVUL_TIMER);
    Wi.setBossBarPercent(e, 0.0);   // onSummoned(): this.bossBar.setPercent(0.0F)
    var maxHp = e.maxHealth || 300;
    e.health = maxHp / Wi.SUMMON_HEALTH_FRACTION;
  };

  /** `DescendAtHalfHealthGoal` (.decomp inner class, lines 561-570) -- `canStart()` is
   *  ported as `canUse()`/`canContinueToUse()` (this engine's own Goal interface,
   *  07k_goals.js), and the ctor's `setControls(EnumSet.of(MOVE, LOOK, JUMP))` is ported
   *  as the `Ai.MOVE | Ai.LOOK | Ai.JUMP` flag mask `Wi.roster` passes to `gs.add(0, ...)`
   *  rather than a field on the goal itself -- the SAME split every other roster row
   *  here already uses (flags live on the GoalSelector entry, not the goal object). The
   *  goal itself does nothing on start/stop/tick: simply being the highest-priority
   *  running goal while invulnerable is what blocks every lower-priority MOVE/LOOK/JUMP
   *  goal (the ranged attack, the fly-wander, the two look goals) from running --
   *  vanilla's own effect, achieved the same way here as it is there. */
  Wi.DescendAtHalfHealthGoal = function (e) {
    this.canUse = function () { return Wi.getInvulnerableTimer(e) > 0; };
    this.canContinueToUse = this.canUse;
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {};
  };

  /** `CAN_ATTACK_PREDICATE` (.decomp: `getGroup() != EntityGroup.UNDEAD && isMobOrPlayer()`):
   *  every live mob/player this wither could target, players via `ctx.players()` (the same
   *  live-reference rule `EL.aiCtx`'s own header requires) and every other live entity with a
   *  health pool via `NS.EntityList.list` directly -- `Wi.roster` is the only caller, so this
   *  needs no `ctx` wiring of its own in the shared `EL.aiCtx` (07i_entitylist.js untouched). */
  Wi.candidates = function (e, ctx) {
    var out = [];
    var Cb = NS.Combat;
    var ps = ctx && ctx.players ? ctx.players() : [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (p && p !== e && (!NS.Ai || !NS.Ai.canTargetLiving || NS.Ai.canTargetLiving(p, e))) out.push(p);   // createAttackable: no creative/spectator/peaceful
    }
    var list = NS.EntityList && NS.EntityList.list;
    if (list) {
      for (var j = 0; j < list.length; j++) {
        var o = list[j];
        if (!o || o === e || o.removed || o.dead || o.type === 'player') continue;
        if (o.maxHealth === undefined) continue;   // isMobOrPlayer() stand-in -- no health, not a target
        if (Cb && Cb.mobTypeOf && Cb.mobTypeOf(o) === 'undead') continue;
        out.push(o);
      }
    }
    return out;
  };

  /** `HEAD_TARGET_PREDICATE` (.decomp: `createAttackable().setBaseMaxDistance(20.0)
   *  .setPredicate(CAN_ATTACK_PREDICATE)`, `TargetPredicate.test`, both read whole): the SAME
   *  `Wi.candidates` roster (CAN_ATTACK_PREDICATE), further gated by the real 20-block
   *  `baseMaxDistance` and (`respectsVisibility`, on by default) `Ai.canSee` -- the SAME
   *  line-of-sight primitive `Wi.sideHeadsTick`'s own re-check below reuses, not a second one. */
  Wi.headTargetCandidates = function (e, ctx) {
    var base = Wi.candidates(e, ctx);
    var out = [];
    var Ai = NS.Ai;
    for (var i = 0; i < base.length; i++) {
      var o = base[i];
      var dx = o.x - e.x, dy = (o.y || 0) - e.y, dz = o.z - e.z;
      // TargetPredicate.test: max(20 * target.getAttackDistanceScalingFactor(wither), 2); a wither is no
      // skeleton/zombie/creeper, so the mob-head clause never applies
      var sc = o === NS.Player ? (NS.Bat ? NS.Bat.attackScale(o) : 1) : (NS.Village ? NS.Village.attackDistanceScale(o) : 1);   // loaders that omit those modules: unscaled
      var rng = Math.max(Wi.SIDE_HEAD_TARGET_RANGE * sc, 2);
      if (dx * dx + dy * dy + dz * dz > rng * rng) continue;
      // getBoundingBox().expand(20, 8, 20): the candidate's box must overlap the wither's, grown 8 vertically
      if ((o.y || 0) + (o.height !== undefined ? o.height : 1.8) <= e.y - 8 || (o.y || 0) >= e.y + (e.height || 3.5) + 8) continue;
      if (Ai && Ai.canSee && !Ai.canSee(e, o)) continue;
      out.push(o);
    }
    return out;
  };

  // -- FlyGoal.java (+ AboveGroundTargeting / NoPenaltySolidTargeting / FuzzyPositions) ------
  // No navigator object exists here (same stand-in `Fl.FlyOntoTreeGoal` uses): "navigation not
  // idle" is "not yet arrived", steered through `e.flyMove`. `getPathfindingFavor` is 0 for a
  // plain PathAwareEntity, so `guessBest` keeps the first of 10 candidates; the wither has no
  // position target, so `towardTarget` only re-bases the offset onto the mob's position.
  Wi.FLY_CHANCE = 120;
  function blk(x, y, z) { var W = NS.World; return W && W.getBlock ? W.getBlock(x, y, z) : 0; }
  function solid(x, y, z) { var P = NS.Physics; return !!(P && P.solidAt && P.solidAt(x, y, z)); }
  function badCell(e, p) {
    var S = NS.States, R = NS.Reg, Ai = NS.Ai;
    if (R && R.id && S && S.block && S.block[blk(p.x, p.y, p.z)] === R.id.water) return true;
    return !!(Ai && Ai.pathTypeAt && Ai.pathPenalty && Ai.pathPenalty(e, Ai.pathTypeAt(p.x, p.y, p.z)) !== 0);
  }
  /** `FuzzyPositions.localFuzz(random, h, v, dy0, dx, dz, cone)` -> offset or null. */
  Wi.localFuzz = function (r, h, v, dy0, dx, dz, cone) {
    var a = Math.atan2(dz, dx) - Math.PI / 2 + (2 * r() - 1) * cone;
    var rad = Math.sqrt(r()) * Math.SQRT2 * h;
    var ox = -rad * Math.sin(a), oz = rad * Math.cos(a);
    if (Math.abs(ox) > h || Math.abs(oz) > h) return null;
    return { x: Math.floor(ox), y: Math.floor(r() * (2 * v + 1)) - v + dy0, z: Math.floor(oz) };
  };
  function guessBest(fn) { var best = null; for (var i = 0; i < 10; i++) { var p = fn(); if (p && !best) best = p; } return best; }
  /** `AboveGroundTargeting.find(e, 8, 7, dx, dz, PI/2, 3, 1)` -> block pos or null. */
  Wi.aboveGroundFind = function (e, r, dx, dz) {
    var C = NS.CFG || { WORLD_MIN_Y: -64, WORLD_MAX_Y: 256 }, S = NS.States;
    return guessBest(function () {
      var o = Wi.localFuzz(r, 8, 7, 0, dx, dz, Math.PI / 2);
      if (!o) return null;
      var p = { x: Math.floor(o.x + e.x), y: Math.floor(o.y + e.y), z: Math.floor(o.z + e.z) };
      if (p.y < C.WORLD_MIN_Y || p.y > C.WORLD_MAX_Y) return null;
      // BirdNavigation.isValidPosition: hasSolidTopSurface
      if (!(S && S.fullCubeCollision ? S.fullCubeCollision(blk(p.x, p.y, p.z)) : solid(p.x, p.y, p.z))) return null;
      var above = Math.floor(r() * 3) + 1;   // nextInt(3 - 1 + 1) + 1
      if (solid(p.x, p.y, p.z)) {
        p.y++;
        while (p.y < C.WORLD_MAX_Y && solid(p.x, p.y, p.z)) p.y++;
        var base = p.y;
        while (p.y < C.WORLD_MAX_Y && p.y - base < above) { if (solid(p.x, p.y + 1, p.z)) break; p.y++; }
      }
      return badCell(e, p) ? null : p;
    });
  };
  /** `NoPenaltySolidTargeting.find(e, 8, 4, -2, dx, dz, PI/2)` -> block pos or null. */
  Wi.noPenaltySolidFind = function (e, r, dx, dz) {
    var C = NS.CFG || { WORLD_MIN_Y: -64, WORLD_MAX_Y: 256 };
    return guessBest(function () {
      var o = Wi.localFuzz(r, 8, 4, -2, dx, dz, Math.PI / 2);
      if (!o) return null;
      var p = { x: Math.floor(o.x + e.x), y: Math.floor(o.y + e.y), z: Math.floor(o.z + e.z) };
      if (p.y < C.WORLD_MIN_Y || p.y > C.WORLD_MAX_Y) return null;
      if (solid(p.x, p.y, p.z)) { p.y++; while (p.y < C.WORLD_MAX_Y && solid(p.x, p.y, p.z)) p.y++; }
      var Ai = NS.Ai;
      return (Ai && Ai.pathTypeAt && Ai.pathPenalty && Ai.pathPenalty(e, Ai.pathTypeAt(p.x, p.y, p.z)) !== 0) ? null : p;
    });
  };
  /** `FlyGoal.getWanderTarget` -> bottom-centre Vec3d or null. */
  Wi.flyWanderTarget = function (e, r) {
    // `getRotationVec(0)` horizontal part, in this engine's yaw frame (D-415): (sin yaw, -cos yaw).
    var dx = Math.sin(e.yaw || 0), dz = -Math.cos(e.yaw || 0);
    var p = Wi.aboveGroundFind(e, r, dx, dz) || Wi.noPenaltySolidFind(e, r, dx, dz);
    return p ? { x: p.x + 0.5, y: p.y, z: p.z + 0.5 } : null;
  };
  Wi.FlyGoal = function (e, speed, rand) {
    rand = rand || RNDFB;
    var tx = 0, ty = 0, tz = 0, have = false;
    this.canUse = function () {
      if (Math.floor(rand() * Wi.FLY_CHANCE) !== 0) return false;
      var t = Wi.flyWanderTarget(e, rand);
      if (!t) return false;
      tx = t.x; ty = t.y; tz = t.z; have = true;
      return true;
    };
    this.canContinueToUse = function () {
      var dx = tx - e.x, dy = ty - e.y, dz = tz - e.z;
      return have && dx * dx + dy * dy + dz * dz > NS.Fly.ARRIVED_SQ;
    };
    this.start = function () {};
    this.stop = function () { have = false; };
    this.tick = function () { if (have && e.flyMove) e.flyMove.setWantedPosition(tx, ty, tz, speed); };
  };

  Wi.roster = function (e, ctx) {
    var Ai = NS.Ai, gs = new Ai.GoalSelector();
    // goalSelector.add(0, new WitherEntity.DescendAtHalfHealthGoal()) (.decomp
    // WitherEntity.initGoals) -- priority 0 (ahead of every other row here), claims
    // MOVE|LOOK|JUMP for as long as the wither is invulnerable so nothing lower-priority
    // (the ranged attack, the fly-wander, the look goals) can run meanwhile -- the SAME
    // sharesFlag/priority-conflict arbitration 07k_goals.js's own GoalSelector already
    // does for every other roster here, not a special case.
    gs.add(0, Ai.MOVE | Ai.LOOK | Ai.JUMP, new Wi.DescendAtHalfHealthGoal(e));
    gs.add(1, Ai.TARGET, new Ai.RevengeGoal(e, ctx, {}));
    gs.add(2, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () { return Wi.candidates(e, ctx); }, { sight: true, livingBox: true }));
    // `goalSelector.add(2, new ProjectileAttackGoal(this, 1.0, 40, 20.0F))` (.decomp
    // WitherEntity.initGoals) -- the 4-arg ctor sets BOTH min/maxIntervalTicks to the same 40,
    // so `Ai.ProjectileAttackGoal`'s own 6-arg form takes 40 twice. `Wi.attack` is the injected
    // `onShoot` (the SAME shape `Ai.ROSTER.llama`'s own `Ll.spit` callback already uses,
    // 07k_goals.js) -- ports `WitherEntity.attack`'s real `shootSkullAt(0, target)` call.
    gs.add(2, Ai.MOVE | Ai.LOOK, new Ai.ProjectileAttackGoal(e, Wi.SKULL_SPEED, Wi.SKULL_INTERVAL, Wi.SKULL_INTERVAL, Wi.SKULL_RANGE, Wi.attack, true));
    gs.add(5, Ai.MOVE, new Wi.FlyGoal(e, 1.0, ctx.random));
    gs.add(6, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, Wi.LOOK_RANGE));
    gs.add(7, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
    return gs;
  };
  if (NS.Ai && NS.Ai.ROSTER) NS.Ai.ROSTER.wither = Wi.roster;

  /** `WitherEntity.getHeadX/Y/Z(int)` (.decomp, all three read whole): headIndex <= 0 is the
   *  CENTER head (body position, `Wi.SKULL_MUZZLE_Y` up); any other index is a SIDE head, whose
   *  x/z sits `Wi.SKULL_SIDE_RADIUS` out along `bodyYaw + 180*(headIndex-1)` degrees and whose y
   *  is `Wi.SKULL_SIDE_MUZZLE_Y` up -- the exact literal formula, including the real headIndex
   *  values `mobTick()` itself passes for the two side heads (2 and 3, not 1 and 2: see
   *  `Wi.sideHeadsTick`'s own header for why this file ports that quirk verbatim rather than
   *  "fixing" it into a tidier 1/2 pair no `.decomp` line supports). `bodyYaw` here is
   *  `e.bodyYaw` in THIS ENGINE'S OWN yaw convention (radians, D-415) -- safe because every use
   *  of these three functions in this file only ever consumes a DIFFERENCE or a DIRECTION
   *  derived consistently in that same convention (see `Wi.sideHeadsTick`), so the constant
   *  frame offset between this engine's yaw and vanilla's raw degrees cancels out. */
  Wi.headX = function (e, headIndex) {
    if (headIndex <= 0) return e.x;
    var ang = ((NS.Ai.bodyYawOf(e)) * RAD2DEG + 180 * (headIndex - 1)) * DEG2RAD;
    return e.x + Math.cos(ang) * Wi.SKULL_SIDE_RADIUS;
  };
  Wi.headY = function (e, headIndex) {
    return headIndex <= 0 ? e.y + Wi.SKULL_MUZZLE_Y : e.y + Wi.SKULL_SIDE_MUZZLE_Y;
  };
  Wi.headZ = function (e, headIndex) {
    if (headIndex <= 0) return e.z;
    var ang = ((NS.Ai.bodyYawOf(e)) * RAD2DEG + 180 * (headIndex - 1)) * DEG2RAD;
    return e.z + Math.sin(ang) * Wi.SKULL_SIDE_RADIUS;
  };

  /** `tickMovement()` (.decomp lines ~141-172, read whole): the vertical 0.6 damp runs
   *  UNCONDITIONALLY every tick; the catch-up/steer blend only once `e.target` is live (this
   *  engine's own object reference standing in for the tracked-entity-id-0 sync field, which
   *  exists only to tell OTHER CLIENTS which entity to draw the head cables toward -- irrelevant
   *  off a renderer this mob did not have when this line was first ported). Yaw-from-velocity
   *  reuses the SAME `atan2(vx, -vz)` idiom `Gh.LookAtTargetGoal` already established for
   *  "engine yaw off a velocity vector" (D-415's own sign convention), not a fresh derivation.
   *
   *  `Wi.sideHeadsTick` (below) is folded in here too -- see this file's own top-of-file header
   *  for why one call site can stand in for vanilla's two (`mobTick()` + `tickMovement()`, both
   *  once-a-tick). `e.bodyYaw = e.yaw` mirrors the SAME "no separate body-twist AI" convention
   *  `07zd_slime.js`/`07zj_fish.js`/`07zz1_phantom.js`/`07zzi_ghast.js` already apply to their
   *  own non-humanoid mobs (a wither's `tickMovement()` never overrides bodyYaw tracking beyond
   *  the generic `MobEntity` row those files already stand on). */
  /** `tickMovement()`'s client particles (.decomp ~150-250): smoke at each of the 3 heads (+-0.3 gaussian),
   *  entity_effect (0.7,0.7,0.5) at 1/4 below half health, and 3 entity_effect (0.7,0.7,0.9) a tick while invulnerable. */
  Wi.tickParticles = function (e, rand) {
    var Px = NS.Particle; if (!Px) return 0;
    var r = rand || NS.fbRand, n = 0;   // client-only (world.isClient): not the server entity stream (lockstep #5378)
    var g = function () { var u = r() || 1e-9; return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * r()); };
    var fx = function (x, y, z, cr, cg, cb) {
      var p = Px.spawn('effect', x, y, z, cr, cg, cb, r);
      if (p) { p.red = cr; p.green = cg; p.blue = cb; n++; }
    };
    var half = (e.health !== undefined) && e.health <= (e.maxHealth || 300) / 2;
    for (var i = 0; i < 3; i++) {
      var hx = Wi.headX(e, i), hy = Wi.headY(e, i), hz = Wi.headZ(e, i);
      if (Px.spawn('smoke', hx + g() * 0.3, hy + g() * 0.3, hz + g() * 0.3, 0, 0, 0, r)) n++;
      if (half && Math.floor(r() * 4) === 0) fx(hx + g() * 0.3, hy + g() * 0.3, hz + g() * 0.3, 0.7, 0.7, 0.5);
    }
    if (Wi.getInvulnerableTimer(e) > 0) for (var k = 0; k < 3; k++) fx(e.x + g(), e.y + r() * 3.3, e.z + g(), 0.7, 0.7, 0.9);
    return n;
  };
  Wi.tickMovement = function (e) {
    Wi.tickParticles(e);
    var vx = e.vx || 0, vy = (e.vy || 0) * 0.6, vz = e.vz || 0;
    var t = Wi.getInvulnerableTimer(e) > 0 ? null : e.target;   // tracked id 0 is set only in mobTick's non-invulnerable branch
    if (t && !t.removed && !t.dead) {
      var maxHp = e.maxHealth || 300;
      var overlay = (e.health !== undefined) && e.health <= maxHp / 2;   // shouldRenderOverlay()
      var ty = (t.y || 0);
      if (e.y < ty || (!overlay && e.y < ty + 5.0)) {
        vy = Math.max(0.0, vy);
        vy += 0.3 - vy * 0.6;
      }
      var dx = (t.x || 0) - e.x, dz = (t.z || 0) - e.z;
      var distSq = dx * dx + dz * dz;
      if (distSq > 9.0) {
        var len = Math.sqrt(distSq), nx = dx / len, nz = dz / len;
        vx += nx * 0.3 - vx * 0.6;
        vz += nz * 0.3 - vz * 0.6;
      }
    }
    e.vx = vx; e.vy = vy; e.vz = vz;
    if (vx * vx + vz * vz > 0.05) e.yaw = Math.atan2(vx, -vz);
    e.yBodyRot = e.yaw;   // the engine's own body-yaw field (Ai.bodyYawOf), not a private e.bodyYaw (#945)

    // `mobTick()`'s own if/else (.decomp lines 251-345): while invulnerable, the side-head
    // firing loop (`Wi.sideHeadsTick`) does NOT run at all (vanilla's `else { super.mobTick();
    // <side-head loop>; ... }` -- the side-head loop is inside the else, never alongside the
    // invuln branch) -- `Wi.tickInvuln` below is the if-branch (timer decrement + regen +
    // expiry explosion), gating `Wi.sideHeadsTick` the same way .decomp does.
    if (Wi.getInvulnerableTimer(e) > 0) {
      Wi.tickInvuln(e);
      if (Wi.ready) Wi.sideHeadsSmooth(e);
    } else if (Wi.ready) {
      Wi.sideHeadsTick(e);
      // mobTick()'s own else-branch tail (.decomp lines 312-345, read whole): the
      // blockBreakingCooldown countdown/trigger, THEN the health-based bossBar readout
      // (`this.bossBar.setPercent(this.getHealth() / this.getMaxHealth())`) -- both run only
      // while NOT invulnerable, same as `Wi.sideHeadsTick` just above.
      Wi.tickBlockBreaking(e);
      // mobTick() else-branch: `if (this.age % 20 == 0) this.heal(1.0F)` before the bossBar readout.
      if ((e.age || 0) % 20 === 0) {
        if (NS.Effects && NS.Effects.heal) NS.Effects.heal(e, 1);
        else e.health = Math.min(e.maxHealth || 300, (e.health || 0) + 1);
      }
      var maxHpBar = e.maxHealth || 300;
      Wi.setBossBarPercent(e, (e.health || 0) / maxHpBar);
    }
  };

  /** `mobTick()`'s own `blockBreakingCooldown` countdown + 3x3x4 destruction (.decomp lines
   *  312-341, read whole): while the cooldown is running it just decrements; the TICK it
   *  reaches exactly 0 (`Wi.attack`/`Cb.hurt`'s wither gate sets it to the real 20 whenever the
   *  wither takes an un-blocked hit -- 14j_combat.js), and ONLY if `mobGriefing` is on, every
   *  block in the real 3x3x4 volume (x-1..x+1, y+0..y+3, z-1..z+1 off `MathHelper.floor`) that
   *  passes `canDestroy` (`!isAir() && !isIn(#wither_immune)`, the SAME
   *  `Tags.stateIn('wither_immune', ...)` gate `damage()`'s own header names) is broken
   *  with `dropStacks=true` (`breakBlock(pos, true, this)`) -- its loot table, popped as items. */
  Wi.BLOCK_BREAK_COOLDOWN = 20;   // damage(): `this.blockBreakingCooldown = 20`
  /** `WorldRenderer.processWorldEvent` 1022/1024 (volume 2.0, pitch `(r-r)*0.2+1`, hostile, at the
   *  block pos +0.5) and `processGlobalEvent` 1023 (volume 1.0, pitch 1, hostile, placed 2 blocks
   *  from the camera toward the wither). `Wi.EVENT_SOUND` is the id -> sound-event table. */
  Wi.EVENT_SOUND = { 1022: 'entity.wither.break_block', 1023: 'entity.wither.spawn', 1024: 'entity.wither.shoot' };
  Wi.playEvent = function (e, id) {
    var S = NS.Sound;
    if (!S || !S.play || !e) return false;
    var x = Math.floor(e.x) + 0.5, y = Math.floor(e.y) + 0.5, z = Math.floor(e.z) + 0.5;
    var o = { source: 'hostile', volume: 2.0, x: x, y: y, z: z };
    if (id === 1023) {
      o.volume = 1.0; o.pitch = 1.0;
      var L = S.listenerNow ? S.listenerNow() : null;
      if (L) {
        var dx = x - L.x, dy = y - L.y, dz = z - L.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        o.x = L.x; o.y = L.y; o.z = L.z;
        if (d > 0) { o.x += dx / d * 2; o.y += dy / d * 2; o.z += dz / d * 2; }
      }
    } else {
      var r = NS.fbRand;   // client-side sound pitch: not the server entity stream (lockstep #5378)
      o.pitch = (r() - r()) * 0.2 + 1.0;
    }
    return S.play(Wi.EVENT_SOUND[id], o);
  };

  Wi.tickBlockBreaking = function (e) {
    if (!((e.blockBreakingCooldown | 0) > 0)) return;
    e.blockBreakingCooldown--;
    if (e.blockBreakingCooldown !== 0) return;
    var C = NS.Commands;
    var griefing = (C && typeof C.ruleGet === 'function') ? (C.ruleGet('mobGriefing') !== 'false') : true;
    if (!griefing) return;
    var W = NS.World, T = NS.Tags;
    if (!W || !T || !T.ready) return;
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z), broke = false;
    for (var dx = -1; dx <= 1; dx++) {
      for (var dz = -1; dz <= 1; dz++) {
        for (var dy = 0; dy <= 3; dy++) {
          var x = bx + dx, y = by + dy, z = bz + dz;
          var st = W.getBlock(x, y, z);
          if (st !== 0 && !T.stateIn('wither_immune', st)) {
            // `world.breakBlock(pos, true, this)`: dropStacks=true -- the block's own loot table, no
            // tool (so no harvest gate, as an explosion: `Loot.drops`, not `breakDrops`).
            var L = NS.Loot, drops = (L && L.ready) ? L.drops({ state: st }) : [];
            // `World.breakBlock` leaves `getFluidState().getBlockState()`: fluid blocks stay, a waterlogged block becomes still water
            var Wx = NS.Weather, fl = (Wx && Wx.fluidOf) ? Wx.fluidOf(st)[0] : 0;
            var left = !fl ? 0 : (NS.States.block[st] === NS.Reg.id.water || NS.States.block[st] === NS.Reg.id.lava) ? st : NS.States.stateOf('water');
            // `World.breakBlock`: syncWorldEvent(2001) for any non-fire block (break sound + dust)
            var nm = NS.Reg.names[NS.States.block[st]];
            if (nm !== 'fire' && nm !== 'soul_fire') {
              if (NS.Sound && NS.Sound.blockBreak) NS.Sound.blockBreak(st, x + 0.5, y + 0.5, z + 0.5, null);
              var Px = NS.Particle;
              if (Px && Px.spawnBlockDust) for (var pi = 0; pi < 8; pi++)
                Px.spawnBlockDust(x + RNDFB(), y + RNDFB(), z + RNDFB(), 0, 0.1, 0, st, x, y, z, RNDFB);
            }
            // returns setBlockState's result: false when the fluid replaces itself
            if (left !== st) {
              W.setBlock(x, y, z, left);
              if (NS.Save && NS.Save.record) NS.Save.record(x, y, z, left);
              broke = true;
            }
            var EL = NS.EntityList, It = NS.Items;
            if (drops.length && EL && EL.ready && EL.popResource && It && It.of) {
              for (var k = 0; k < drops.length; k++) {
                var idx = It.of(drops[k].item);
                if (idx >= 0) EL.popResource(x, y, z, idx, drops[k].count || 1);
              }
            }
          }
        }
      }
    }
    if (broke) Wi.playEvent(e, 1022);
  };

  /** `mobTick()`'s own invuln branch (.decomp lines 251-266, read whole) -- decrement the
   *  timer, explode at 0 (`Explosion.DestructionType` chosen by `DO_MOB_GRIEFING`, the SAME
   *  `Ai.BreakDoorGoal`/`Cr.explode`/etc. mobGriefing convention this project already stands
   *  on, `NS.Commands.ruleGet`), and heal 10 every 10 ticks (`this.age % 10 == 0`) while still
   *  invulnerable. Called only while `Wi.getInvulnerableTimer(e) > 0` (`Wi.tickMovement`,
   *  above) -- mirrors `.decomp`'s own `if (this.getInvulnerableTimer() > 0) { ... }` guard. */
  Wi.tickInvuln = function (e) {
    var timer = Wi.getInvulnerableTimer(e) - 1;
    // mobTick(): `this.bossBar.setPercent(1.0F - (float)$$0 / 220.0F)` -- computed off the
    // POST-decrement `$$0` (this same `timer`), BEFORE the expiry explosion check below.
    Wi.setBossBarPercent(e, 1.0 - timer / Wi.DEFAULT_INVUL_TIMER);
    if (timer <= 0) {
      var C = NS.Commands;
      var griefing = (C && typeof C.ruleGet === 'function') ? (C.ruleGet('mobGriefing') !== 'false') : true;
      if (NS.Explosion && NS.Explosion.ready) {
        var eyeH = (NS.Combat && NS.Combat.eyeHeightOf) ? NS.Combat.eyeHeightOf(e) : ((e.height || 1.8) * 0.85);
        NS.Explosion.explode(e, e.x, e.y + eyeH, e.z, Wi.INVUL_EXPLOSION_POWER, griefing);
      }
    }
    if (timer <= 0 && !e.silent) Wi.playEvent(e, 1023);
    Wi.setInvulTimer(e, timer);
    if ((e.age || 0) % Wi.INVUL_REGEN_INTERVAL === 0) {
      if (NS.Effects && NS.Effects.heal) NS.Effects.heal(e, Wi.INVUL_REGEN_AMOUNT);
      else e.health = Math.min(e.maxHealth || 300, (e.health || 0) + Wi.INVUL_REGEN_AMOUNT);
    }
  };

  /** `mobTick()`'s own per-side-head loop (.decomp lines ~271-304, `$$2` in {1,2}, read whole)
   *  PLUS `tickMovement()`'s own per-side-head yaw/pitch smoothing loop (.decomp lines ~178-199,
   *  `$$6` in {0,1}, read whole) -- kept in one function since both are pure per-tick state
   *  updates on the SAME two `skullCooldowns`/`sideHeadYaws` slots and this file has one call
   *  site to drive them from (see `Wi.tickMovement`'s own header).
   *
   *  ⚠ THE HEAD-INDEX QUIRK, PORTED LITERALLY: the smoothing loop aims using `getHeadX($$6+1)`
   *  (indices 1 and 2), but the firing loop spawns the actual skull off `getHeadX($$2+1)`
   *  (indices 2 and 3) -- NOT the same pair. `getHeadX(3)` and `getHeadX(1)` land on the exact
   *  same point (`180*(3-1) = 360 == 180*(1-1) = 0`, mod 360), so this is a real, confirmed
   *  `.decomp` quirk (the muzzle position and the aim-direction anchor for side-head slot 1 are
   *  computed from two different nominal indices that happen to coincide for slot 0 but not
   *  slot 1's *muzzle* vs slot 0's aim anchor) -- not a transcription slip on this file's part.
   *  Project rule: port the real formula, never "fix" a `.decomp`-confirmed number into a
   *  tidier one nothing in the source supports.
   *
   *  `canTarget($$9)` (.decomp `LivingEntity.canTarget`) is `Ai.canTargetLiving` (liveness plus
   *  creative/spectator/peaceful, the one gate every other per-tick target revalidation uses) -- CAN_ATTACK_PREDICATE's own undead exclusion is
   *  NOT re-applied here, matching `.decomp`: that predicate only gates the initial acquisition
   *  search (`Wi.headTargetCandidates`), not the per-tick re-check of an already-tracked target.
   *
   *  Difficulty: `(HARD || HARDCORE)` in `.decomp` -- this engine's own `NS.Diff` models a
   *  single flag with no hardcore game mode at all (`07l_spawn.js`), so this reduces to
   *  `diff === 'hard'`, the one difficulty tier hardcore would have added nothing beyond. */
  Wi.sideHeadsTick = function (e) {
    if (!e.skullCooldowns) { Wi.initWither(e); }
    var Ai = NS.Ai;
    var EL = NS.EntityList;
    var ctx = EL && EL.aiCtx ? EL.aiCtx(e) : null;
    var rand = (ctx && ctx.random) ? ctx.random : RNDFB;
    var diff = (NS.Diff && NS.Diff.get) ? NS.Diff.get() : 'normal';
    var isHard = diff === 'normal' || diff === 'hard';   // (NORMAL || HARD) per .decomp WitherEntity.mobTick

    for (var slot = 0; slot < 2; slot++) {
      if (e.age < e.skullCooldowns[slot]) continue;
      e.skullCooldowns[slot] = e.age + Wi.SIDE_HEAD_RECHECK_BASE + Math.floor(rand() * Wi.SIDE_HEAD_RECHECK_RAND);

      if (isHard) {
        // `this.chargedSkullCooldowns[$$2 - 1]++ > 15` -- Java POST-increment: the comparison
        // reads the OLD count, the slot is bumped either way (short-circuited entirely, count
        // frozen, when peaceful/easy -- hence this whole branch is `if (isHard)` first).
        var prevCharge = e.chargedSkullCooldowns[slot];
        e.chargedSkullCooldowns[slot] = prevCharge + 1;
        if (prevCharge > Wi.SIDE_HEAD_CHARGED_BUILDUP) {
          var rx = (e.x - Wi.SIDE_HEAD_RANDOM_XZ) + rand() * (Wi.SIDE_HEAD_RANDOM_XZ * 2);
          var ry = (e.y - Wi.SIDE_HEAD_RANDOM_Y) + rand() * (Wi.SIDE_HEAD_RANDOM_Y * 2);
          var rz = (e.z - Wi.SIDE_HEAD_RANDOM_XZ) + rand() * (Wi.SIDE_HEAD_RANDOM_XZ * 2);
          Wi.shootSkullAt(e, slot + 2, rx, ry, rz, true);
          e.chargedSkullCooldowns[slot] = 0;
        }
      }

      var tracked = e.sideHeadTarget[slot];
      if (tracked) {
        var alive = !tracked.dead && !tracked.removed && (!Ai || !Ai.canTargetLiving || Ai.canTargetLiving(tracked, e));   // LivingEntity.canTarget
        var tdx = tracked.x - e.x, tdy = (tracked.y || 0) - e.y, tdz = tracked.z - e.z;
        var inRange = alive && (tdx * tdx + tdy * tdy + tdz * tdz) <= Wi.SIDE_HEAD_REFIRE_RANGE_SQ;
        var seen = inRange && (!Ai || !Ai.canSee || Ai.canSee(e, tracked));
        if (alive && inRange && seen) {
          var eyeH = tracked.type === 'player' ? 1.62 : NS.Combat && NS.Combat.eyeHeightOf ? NS.Combat.eyeHeightOf(tracked) : ((tracked.height || 1.8) * 0.85);   // #4812 getStandingEyeHeight
          Wi.shootSkullAt(e, slot + 2, tracked.x, (tracked.y || 0) + eyeH * 0.5, tracked.z);
          e.skullCooldowns[slot] = e.age + Wi.SIDE_HEAD_FIRE_COOLDOWN_BASE + Math.floor(rand() * Wi.SIDE_HEAD_FIRE_COOLDOWN_RAND);
          e.chargedSkullCooldowns[slot] = 0;
        } else {
          e.sideHeadTarget[slot] = null;
        }
      } else {
        var found = Wi.headTargetCandidates(e, ctx);
        if (found.length) e.sideHeadTarget[slot] = found[Math.floor(rand() * found.length)];
      }
    }

    Wi.sideHeadsSmooth(e);
  };

  /** `tickMovement()`'s own side-head smoothing loop: vanilla runs it EVERY tick, independent of
   *  `mobTick()`'s invulnerable branch, so `Wi.tickMovement` calls it in both branches. */
  Wi.sideHeadsSmooth = function (e) {
    if (!e.skullCooldowns) { Wi.initWither(e); }
    var Ai = NS.Ai;
    // `tickMovement()`'s own smoothing loop -- `Ai.rotateTowards`/`Ai.wrapRad` (07k_goals.js)
    // are the SAME clamped-turn primitive `getNextAngle` already is elsewhere in this codebase
    // (`Ai.rotateTowards(from, to, maxDelta)` == `from + clamp(wrapRad(to-from), -maxDelta, maxDelta)`),
    // reused rather than a second implementation of the identical clamp.
    var bodyYaw = (Ai.bodyYawOf(e));
    var yawStep = Wi.SIDE_HEAD_YAW_MAX_STEP * DEG2RAD, pitchStep = Wi.SIDE_HEAD_PITCH_MAX_STEP * DEG2RAD;
    for (var s = 0; s < 2; s++) {
      var aim = e.sideHeadTarget[s];
      if (aim && !aim.dead && !aim.removed) {
        var hx = Wi.headX(e, s + 1), hy = Wi.headY(e, s + 1), hz = Wi.headZ(e, s + 1);
        var eh2 = NS.Combat && NS.Combat.eyeHeightOf ? NS.Combat.eyeHeightOf(aim) : ((aim.height || 1.8) * 0.85);
        var adx = aim.x - hx, ady = ((aim.y || 0) + eh2) - hy, adz = aim.z - hz;
        var horiz = Math.sqrt(adx * adx + adz * adz);
        var wantYaw = Math.atan2(adx, -adz);              // this engine's own yaw frame (D-415)
        var wantPitch = -Math.atan2(ady, horiz);           // vanilla sign: positive looks down
        e.sideHeadPitches[s] = Ai && Ai.rotateTowards ? Ai.rotateTowards(e.sideHeadPitches[s], wantPitch, pitchStep)
          : e.sideHeadPitches[s];
        e.sideHeadYaws[s] = Ai && Ai.rotateTowards ? Ai.rotateTowards(e.sideHeadYaws[s], wantYaw, yawStep)
          : e.sideHeadYaws[s];
      } else if (Ai && Ai.rotateTowards) {
        e.sideHeadYaws[s] = Ai.rotateTowards(e.sideHeadYaws[s], bodyYaw, yawStep);
      }
    }

    // `07j_entityrender.js`'s own `ER.witherDelta` reads exactly these two fields
    // (`e.witherSideYawRel`/`e.witherSidePitch`, both degrees, `w.sideYawRel[i]`/`w.sidePitch[i]`
    // fed straight into `* DEG2RAD`) -- `getHeadYaw(i) - bodyYaw` (.decomp `rotateHead`) is a
    // DIFFERENCE of two angles computed in the SAME engine-yaw convention, so it equals
    // vanilla's own relative angle regardless of the constant frame offset between conventions
    // (see `Wi.headX`'s own header). `getHeadPitch(i)` has no such frame ambiguity.
    e.witherSideYawRel = [(e.sideHeadYaws[0] - bodyYaw) * RAD2DEG, (e.sideHeadYaws[1] - bodyYaw) * RAD2DEG];
    e.witherSidePitch = [e.sideHeadPitches[0] * RAD2DEG, e.sideHeadPitches[1] * RAD2DEG];
  };

  /** `WitherSkullEntity` spawn (.decomp `shootSkullAt(int,double,double,double,boolean)`, read
   *  whole): the ONE spawn path both the center head (`Wi.attack`) and the two side heads
   *  (`Wi.sideHeadsTick`) go through -- `Wi.headX/Y/Z(e, headIndex)` place the muzzle,
   *  `forceCharged` carries the caller's own already-rolled charged bit (the center head rolls
   *  its own 0.1% only when `headIndex === 0`, matching `shootSkullAt(int,LivingEntity)`'s
   *  `$$0 == 0 && random.nextFloat() < 0.001F`; a side head's hard-difficulty blind shot is
   *  ALWAYS charged, `shootSkullAt($$2+1, ..., true)`, never rolled). */
  Wi.shootSkullAt = function (e, headIndex, tx, ty, tz, forceCharged) {
    var EL = NS.EntityList;
    if (!EL || !EL.canSpawn('wither_skull')) return null;
    if (!e.silent) Wi.playEvent(e, 1024);
    var mx = Wi.headX(e, headIndex), my = Wi.headY(e, headIndex), mz = Wi.headZ(e, headIndex);
    var rand = EL.random || RNDFB;
    var charged = (forceCharged !== undefined) ? forceCharged : (headIndex === 0 && rand() < Wi.SKULL_CHARGED_CHANCE);
    return EL.spawn('wither_skull', mx, my, mz, {
      shooter: e,
      power: [tx - mx, ty - my, tz - mz],
      charged: charged
    });
  };

  /** `ProjectileAttackGoal`'s injected `onShoot(mob, target)` -- `WitherEntity.attack`'s real
   *  `shootSkullAt(0, target)` (.decomp): aimed at the target's eye point (`Cb.eyeHeightOf`, the
   *  SAME stand-in table `14j_combat.js` already builds for every other ranged-attacker's aim),
   *  spawned through the same `Wi.shootSkullAt` the two side heads now also use (which plays
   *  world event 1024). */
  Wi.attack = function (e, target) {
    if (!target) return null;
    var eyeH = target.type === 'player' ? 1.62 : NS.Combat && NS.Combat.eyeHeightOf ? NS.Combat.eyeHeightOf(target) : ((target.height || 1.8) * 0.85);   // #4465 getStandingEyeHeight
    var tx = target.x, ty = (target.y || 0) + eyeH * 0.5, tz = target.z;
    return Wi.shootSkullAt(e, 0, tx, ty, tz);
  };

  /** `new WitherSkullEntity(World, LivingEntity, dx, dy, dz)` -- `ExplosiveProjectileEntity`'s
   *  own ctor normalize-and-scale (`Bl.Fireball.initPower`, 07zzh_blaze.js, reused verbatim: the
   *  SAME base class both the ghast fireball and this skull extend, off the SAME `power * 0.1`
   *  formula) -- not re-derived a second time. `07i_entitylist.js`'s own `EL.DEFAULTS.wither_skull`
   *  is the only caller. */
  Wi.initSkull = function (e, opts) {
    var p = opts && opts.power;
    if (NS.Blaze && NS.Blaze.Fireball && NS.Blaze.Fireball.initPower) {
      if (p) NS.Blaze.Fireball.initPower(e, p[0], p[1], p[2]);
      else { e.powerX = 0; e.powerY = 0; e.powerZ = 0; }
    } else { e.powerX = 0; e.powerY = 0; e.powerZ = 0; }
    if (opts && opts.shooter) { e.shooter = opts.shooter; e.yaw = e.shooter.yaw || 0; e.pitch = e.shooter.pitch || 0; }   // ctor setRotation(owner yaw, pitch)
    e.charged = !!(opts && opts.charged);
  };

  /** The SAME current-position box hit-test `Bl.Fireball`'s own private `entityHitAt`/
   *  `Gh.tickFireball` already use for the fireball pair (07zzh_blaze.js/07zzi_ghast.js) --
   *  not a second, different simplification invented here. */
  function skullHitAt(e) {
    var Cb = NS.Combat;
    if (!Cb || !Cb.rayBox) return null;
    var ox = e.x, oy = e.y, oz = e.z, vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0;
    // ProjectileEntity.tick/canHit: the owner is hittable only once the skull has LEFT it
    // (no owner box inside this tick's swept box inflated 1) -- same rule as Gh.tickFireball.
    var ow = e.shooter;
    if (!e.leftOwner) {
      e.leftOwner = true;
      if (ow) {
        var ow2 = ow.width !== undefined ? ow.width / 2 : 0.3, oh = ow.height !== undefined ? ow.height : 1.8;
        var fw = (e.width !== undefined ? e.width : 0.3125) / 2 + 1, fh = e.height !== undefined ? e.height : 0.3125;
        if (ow.x + ow2 > Math.min(ox, ox + vx) - fw && ow.x - ow2 < Math.max(ox, ox + vx) + fw &&
            ow.y + oh > Math.min(oy, oy + vy) - 1 && ow.y < Math.max(oy, oy + vy) + fh + 1 &&
            ow.z + ow2 > Math.min(oz, oz + vz) - fw && ow.z - ow2 < Math.max(oz, oz + vz) + fw) e.leftOwner = false;
      }
    }
    var targets = [];
    if (NS.Player && (ow !== NS.Player || e.leftOwner)) targets.push(NS.Player);
    var list = NS.EntityList && NS.EntityList.list;
    if (list) for (var i = 0; i < list.length; i++) {
      var t0 = list[i];
      if (!t0 || t0 === e || t0.removed || t0.noClip || (t0 === ow && !e.leftOwner)) continue;
      if (t0.maxHealth === undefined && !(NS.Ghast && NS.Ghast.COLLIDABLE_NONLIVING.test(t0.type || ''))) continue;   // canHit(): alive && collides() (boat/minecart/end_crystal too, #3810)
      targets.push(t0);
    }
    var IN = Cb.ARROW_ENTITY_INFLATE, f = 1, hit = null;
    for (var j = 0; j < targets.length; j++) {
      var t = targets[j];
      var tw = t.width !== undefined ? t.width : 0.6, th = t.height !== undefined ? t.height : 1.8;
      var ct = Cb.rayBox(ox, oy, oz, vx * f, vy * f, vz * f, t.x - tw / 2 - IN, t.y - IN, t.z - tw / 2 - IN,
                         t.x + tw / 2 + IN, t.y + th + IN, t.z + tw / 2 + IN);
      if (ct === null || ct > 1) continue;
      f *= ct; hit = t;
    }
    e._hitF = f;
    return hit;
  }

  /** `WitherSkullEntity.onEntityHit`/`onCollision` (.decomp, read whole): a LIVING owner deals
   *  `SKULL_DAMAGE_OWNED` through the real (armour-applying, `ProjectileDamageSource`, the SAME
   *  shape `Sv.DAMAGE.arrow`/`{source:'projectile'}` already model for the bow-arrow case) combat
   *  path, healing the owner `SKULL_HEAL_ON_KILL` on a kill; no owner instead deals the flat
   *  `SKULL_DAMAGE_UNOWNED` as `DamageSource.MAGIC` (`Effects.magicDamage`, the exact existing
   *  bypass-armour helper, not approximated). EITHER successful hit on a living target then also
   *  adds Wither (`Effects.addStatusEffect`) for a difficulty-scaled duration (PEACEFUL/EASY: no
   *  effect at all, matching the jar's own `$$6 = 0` default). Any collision -- entity OR block
   *  (`e.onGround` or a solid cell at/one velocity-step ahead of the skull) -- explodes at `SKULL_EXPLOSION_POWER`
   *  (`NS.Explosion.explode`, the same substrate creeper/TNT/the ghast fireball all reuse) and
   *  discards, ALWAYS, matching `WitherSkullEntity.onCollision`'s own unconditional explosion. */
  /** `WitherSkullEntity.getEffectiveExplosionResistance`: a charged skull caps the resistance
   *  of any block `WitherEntity.canDestroy` (not air, not #wither_immune) at 0.8. */
  Wi.chargedSkullResist = function (st, r) {
    return !NS.Tags.stateIn('wither_immune', st) ? Math.min(0.8, r) : r;
  };
  Wi.tickSkull = function (e) {
    if (e.removed) return;
    var C = NS.Commands;
    var griefing = C && C.ruleGet ? C.ruleGet('mobGriefing') !== 'false' : true;
    function blockHit() { if (NS.Combat && NS.Combat.projectileBlockHitFind) NS.Combat.projectileBlockHitFind(e); }   // #8660
    function explodeAndDiscard() {
      if (NS.Explosion && NS.Explosion.ready) {
        NS.Explosion.explode(e.shooter || e, e.x, e.y, e.z, Wi.SKULL_EXPLOSION_POWER, griefing,
          NS.EntityList && NS.EntityList.random || undefined, undefined,   // Explosion rays draw world.random (the entity stream), lockstep #5378
          e.charged ? Wi.chargedSkullResist : null);
      }
      e.removed = true;
    }
    // any block hit, any face: the skull's cell or the cell its velocity is about to enter is solid
    // (the generic mover stops it flush against the wall, so the probe must look one step ahead).
    // ProjectileUtil.getCollision: the NEARER of block and entity wins, so an entity in front of the
    // wall within the step is still hit (solid sampled along the segment up to the entity).
    var Ph = NS.Physics, solid = Ph && Ph.solidAt;
    if (e.onGround || (solid && Ph.solidAt(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)))) { blockHit(); explodeAndDiscard(); return; }
    var blockAhead = solid && Ph.solidAt(Math.floor(e.x + e.vx), Math.floor(e.y + e.vy), Math.floor(e.z + e.vz));
    var t = null;
    if (!(e.shooter && e.shooter !== NS.Player && e.shooter.removed)) t = skullHitAt(e);
    if (blockAhead) {
      var wallFirst = !t;
      if (t) {   // ponytail: 0.25-block sampling, can miss a wall thinner than that only if the step is tiny
        var len = Math.sqrt(e.vx * e.vx + e.vy * e.vy + e.vz * e.vz) * e._hitF, n = Math.ceil(len * 4);
        for (var k = 1; k <= n && !wallFirst; k++) {
          var q = k / n * e._hitF;
          wallFirst = Ph.solidAt(Math.floor(e.x + e.vx * q), Math.floor(e.y + e.vy * q), Math.floor(e.z + e.vz * q));
        }
      }
      if (wallFirst) { blockHit(); explodeAndDiscard(); return; }
    }
    // ExplosiveProjectileEntity.tick: discarded once its owner is removed.
    if (e.shooter && e.shooter !== NS.Player && e.shooter.removed) { e.removed = true; return; }
    if (t && t.maxHealth === undefined) {   // non-living collidable (cart/crystal/boat): onEntityHit damages ANY entity; only the Wither effect needs a LivingEntity
      if (NS.Combat && NS.Combat.hurt) {   // ponytail: boat has no damage model in Combat.hurt yet, so it is a no-op there
        if (e.shooter && e.shooter.maxHealth !== undefined) NS.Combat.hurt(t, Wi.SKULL_DAMAGE_OWNED, undefined, false, { attacker: e.shooter, source: 'projectile' });
        else NS.Combat.hurt(t, Wi.SKULL_DAMAGE_UNOWNED, undefined, false, { source: 'magic', bypassArmor: true });
      }
      explodeAndDiscard(); return;
    }
    if (t) {
      var ownerLiving = !!(e.shooter && e.shooter.maxHealth !== undefined);
      var hit = false;
      if (ownerLiving) {
        if (t === NS.Player && NS.Survival && NS.Survival.hurt) {
          hit = NS.Survival.hurt(t, 'witherSkull', Wi.SKULL_DAMAGE_OWNED, e.shooter);
        } else if (NS.Combat && NS.Combat.hurt) {
          hit = NS.Combat.hurt(t, Wi.SKULL_DAMAGE_OWNED, undefined, false, { attacker: e.shooter, source: 'projectile' });
        }
        if (hit && (t.dead || t.removed || (t.health !== undefined && t.health <= 0)) && NS.Effects && NS.Effects.heal) {
          NS.Effects.heal(e.shooter, Wi.SKULL_HEAL_ON_KILL);
        }
        // applyDamageEffects only while the victim is alive (else vanilla heals the owner, above); onTargetDamaged has no engine model
        if (hit && !(t.dead || t.removed || (t.health !== undefined && t.health <= 0)) && NS.Effects && NS.Effects.thornsOnUserDamaged) NS.Effects.thornsOnUserDamaged(t, e.shooter);   // onEntityHit: applyDamageEffects(owner, victim)
      } else if (NS.Effects && NS.Effects.magicDamage) {
        hit = NS.Effects.magicDamage(t, Wi.SKULL_DAMAGE_UNOWNED, null);
      }
      if (hit && t.maxHealth !== undefined && !(t.dead || t.removed)) {
        var diff = (NS.Diff && NS.Diff.get) ? NS.Diff.get() : 'normal';
        var ticks = diff === 'hard' ? Wi.SKULL_WITHER_TICKS_HARD : (diff === 'normal' ? Wi.SKULL_WITHER_TICKS_NORMAL : 0);
        if (ticks > 0 && NS.Effects && NS.Effects.addStatusEffect) {
          NS.Effects.addStatusEffect(t, 'wither', ticks, Wi.SKULL_WITHER_AMPLIFIER, false, true);
        }
      }
      explodeAndDiscard();
      return;
    }
    // ExplosiveProjectileEntity.tick: isTouchingWater() -> 0.8 for BOTH the 0.95 and the charged 0.73
    var Cb = NS.Combat, Fb = NS.Blaze && NS.Blaze.Fireball;
    var wet = Cb && Cb.arrowTouchingWater ? Cb.arrowTouchingWater(e) : !!e.inWater;
    var drag = wet ? (Fb ? Fb.DRAG_WATER : 0.8) : (e.charged ? Wi.SKULL_DRAG_CHARGED : Wi.SKULL_DRAG);
    // ProjectileUtil.setRotationFromVelocity(this, 0.2F): lerp 0.2 toward the flight direction (yaw frame D-415, pitch up-positive)
    var hv = Math.sqrt(e.vx * e.vx + e.vz * e.vz);
    if (hv > 1e-5 || Math.abs(e.vy) > 1e-5) {
      var TAU = Math.PI * 2, dy = Math.atan2(e.vx, -e.vz) - (e.yaw || 0);
      dy -= Math.floor((dy + Math.PI) / TAU) * TAU;
      e.yaw = (e.yaw || 0) + dy * 0.2;
      e.pitch = (e.pitch || 0) + (Math.atan2(e.vy, hv) - (e.pitch || 0)) * 0.2;
    }
    e.vx = (e.vx + e.powerX) * drag;
    e.vy = (e.vy + e.powerY) * drag;
    e.vz = (e.vz + e.powerZ) * drag;
    // ExplosiveProjectileEntity.tick: SMOKE trail at pos+vel (+0.5 y), 4 bubbles in water (rotation lerp is above).
    var Px = NS.Particle;
    if (Px && Px.spawn) {
      if (wet) for (var i = 0; i < 4; i++) Px.spawn('bubble', e.x - e.vx * 0.25, e.y - e.vy * 0.25, e.z - e.vz * 0.25, e.vx, e.vy, e.vz);
      Px.spawn('smoke', e.x + e.vx, e.y + e.vy + 0.5, e.z + e.vz, 0, 0, 0);
    }
  };

  Wi.OWED = [
    // D-796: the two side heads' own independent skull attacks are now real (`Wi.sideHeadsTick`,
    // reusing `Wi.SKULL_*`/`Wi.shootSkullAt`) -- this item is CLOSED, kept struck-through rather
    // than deleted so the file's own history of what each unit closed stays legible.
    'CLOSED (D-796): the TWO SIDE HEADS\' own independent skull attacks (WitherEntity.mobTick\'s ' +
      'own skullCooldowns/chargedSkullCooldowns/tracked-entity-id machinery) -- `Wi.sideHeadsTick` ' +
      'now drives both, populating `e.witherSideYawRel`/`e.witherSidePitch` for the existing ' +
      'renderer (`ER.witherDelta`, 07j_entityrender.js)',
    // loop/wither-invuln: DescendAtHalfHealthGoal + the 220-tick invulnerability timer +
    // regen-while-invulnerable + the invuln-expiry explosion are now real (Wi.tickInvuln,
    // Wi.DescendAtHalfHealthGoal, Wi.getInvulnerableTimer/setInvulTimer, Wi.onSummoned) --
    // this item is CLOSED. Wi.onSummoned is the real vanilla trigger (.decomp: the ONLY
    // in-play caller of setInvulTimer(220) is WitherSkullBlock.onSummoned() -- the goal itself
    // never sets the timer, it only reacts to it), left unwired here since the caller (the
    // soul-sand+3-skull detector, next item below) is out of this unit's own scope.
    'CLOSED (loop/wither-invuln): DescendAtHalfHealthGoal, the 220-tick invulnerability timer ' +
      '(INVUL_TIMER dataTracker), the regen-while-invulnerable tick, and the invuln-expiry ' +
      'explosion are all real now',
    // D-803 (session 159, loop/wither-owed): all FOUR remaining items are now real --
    // damage()'s own invuln gate (Cb.hurt's wither-type gate, 14j_combat.js), the boss bar
    // percent readout (e.bossBar, Wi.setBossBarPercent, both mobTick() branches), the real
    // soul-sand+3-skull summoning-structure detector (BE.checkWitherSummon, 07c_blockentity.js,
    // the ONE real caller of Wi.onSummoned), and blockBreakingCooldown (Wi.tickBlockBreaking +
    // Cb.hurt's own cooldown-arm) -- kept struck-through, not deleted, per this file's own
    // history convention above.
    'CLOSED (D-803): damage()\'s own invulnerability gate (getInvulnerableTimer() > 0 && ' +
      'source != OUT_OF_WORLD blocks ALL damage) is real now -- `Cb.hurt`\'s wither-type gate ' +
      '(14j_combat.js), ported off .decomp WitherEntity.java:443-470',
    'CLOSED (D-803): the boss bar percent readout (bossBar.setPercent, both branches of ' +
      'mobTick()) is real now, ported as DATA (`e.bossBar`/`Wi.setBossBarPercent`) the SAME way ' +
      '`Rd.create`\'s own `raid.bar` (07s_raid.js) already models a boss bar -- not a UI widget',
    'CLOSED (D-803): the soul-sand + 3-skull summoning structure detector is real now -- ' +
      '`BE.checkWitherSummon` (07c_blockentity.js, wired off `BE.onChanged`, the ONE place a ' +
      'block can change) is the real in-play caller of `Wi.onSummoned`, ported off ' +
      '.decomp WitherSkullBlock.java\'s own `getWitherBossPattern`/`onPlaced`',
    'CLOSED (D-790/D-793, confirmed still real at D-800 close): the renderer/model ' +
      '(three heads + a segmented tail) -- 07j_entityrender.js draws the real geometry, not a ' +
      'generic-box fallback; the tail row is emitted by extract-models witherTailRows (#1578) and ' +
      'animated in ER.witherDelta',
    'CLOSED (D-803): blockBreakingCooldown / the 3x3x4 block-destruction tick is real now -- ' +
      '`Wi.tickBlockBreaking` reads the real `#wither_immune` tag as `canDestroy(BlockState)\'s` ' +
      'stand-in and `Cb.hurt` arms the real 20-tick cooldown on every un-blocked hit, both off ' +
      '.decomp WitherEntity.java:312-341/460-463'
  ];

  Wi.ready = true;
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
