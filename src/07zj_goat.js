// 07zj_goat.js — loop/goat-s99 (QUEUE 0.2 G18c, missing overworld mob): the GOAT, whole.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// Everything here is read off `.decomp/net/minecraft/entity/passive/GoatEntity.java` and
// `.decomp/net/minecraft/entity/passive/GoatBrain.java` (1.18.2, Yarn-named, both read in
// full) unless a comment says otherwise. Dimensions ([0.9, 1.3]), the three attributes
// (MAX_HEALTH 10.0, MOVEMENT_SPEED 0.2, ATTACK_DAMAGE 2.0 — `createGoatAttributes`) and the
// breeding food (wheat — `GoatBrain.getTemptItems`) are NOT re-declared here: they come out
// of the jar-bytecode-extracted entity table generically (`tools/extract-entities.mjs`/
// `extract-breeding.mjs`, `NS.Entities.attrsOf('goat')`/`NS.Entities.breedFood('goat')`), the
// same "a constant here would be a D-263" standing `07zh_rabbit.js`'s own header already
// states for rabbit's two rows — `goatcheck` asserts those rows directly against
// `assets/entities.json` rather than duplicating a number the table already owns.
//
// ⚠⚠ **GOATS ARE `Brain`-DRIVEN, NOT `GoalSelector`-DRIVEN — AND THIS ENGINE ONLY HAS THE
// LATTER.** `GoatEntity.mobTick` ticks a `Brain<GoatEntity>` built by `GoatBrain.create`, four
// task lists keyed by `Activity` (CORE/IDLE/LONG_JUMP/RAM) with their own memory-module gates
// and per-tick re-evaluation (`GoatBrain.updateActivities`). This engine's `Ai.ROSTER`/
// `Ai.GoalSelector` (07k_goals.js) is the ONLY goal substrate every other rostered mob in this
// codebase runs on — rabbit substituted three brain-shaped vanilla goals for `GoalSelector`
// equivalents already (`07zh_rabbit.js`'s own header: SwimGoal->FloatGoal, EscapeDangerGoal->
// PanicGoal, WanderAroundFarGoal->WaterAvoidingRandomStrollGoal) and this file does the same,
// wider: `GoatBrain`'s IDLE activity (`TemptTask`/`WalkTowardClosestAdultTask`/`StrollTask`/
// `GoTowardsLookTarget`/`WaitTask`/`BreedTask`) becomes the ORDINARY `Ai.TemptGoal`/
// `Ai.FollowParentGoal`/`Ai.WaterAvoidingRandomStrollGoal`/`Ai.BreedGoal` every other animal in
// `Ai.ROSTER` already uses (`Ai.ROSTER.goat`, 07k_goals.js), and its RAM/LONG_JUMP activities
// become the two goals THIS file exports (`Gt.RamGoal`/`Gt.LongJumpGoal`) for that same roster
// entry to add. `FollowMobTask(EntityType.PLAYER, 6.0F)` (idle look at a player) is an inline
// look goal in `Ai.ROSTER.goat` (#4716).
//
// WHAT IS HERE, PER THE UNIT'S OWN SPEC:
//   1. `Gt.canSpawn`/`Spawn.RULES.goat` (07l_spawn.js's own one-line hook) — GoatEntity.canSpawn
//      (§ SPAWN)
//   2. the screaming roll (2%, `Gt.spawnInit`) and its breeding inheritance (`Gt.childScreaming`,
//      wired as `Breed.CHILD.goat`, 07m_breed.js) (§ SCREAMING)
//   3. `Gt.RamGoal` — the ram attack, reproduced as ONE `GoalSelector` goal covering
//      `PrepareRamTask`+`RamImpactTask`'s own cooldown/target-pick/prepare/charge/impact/
//      knockback/screaming-cooldown shape (§ RAM)
//   4. `Gt.LongJumpGoal` + `Gt.jumpVelocity`/`Gt.bestJumpVelocity` — the long jump, the real
//      `LongJumpTask.getRammingVelocity` projectile-arc kernel (closed form + arc sweep) driving the
//      candidate grid / weighted pick / 40-tick delay / LONG_JUMPING pose (§ LONG JUMP)
//   5. `Gt.adjustFallDamage` — `computeFallDamage`'s own `- 10` (§ FALL DAMAGE)
//   6. milking (`Use.entityUse`'s own one new branch, 14l_use.js) and breeding with wheat (the
//      generic `Br.interact`/`Ai.TemptGoal`/`Ai.BreedGoal` path every other rostered animal
//      already runs, off `NS.Entities.breedFood('goat')` == wheat) (§ MILK)
//
// NOT HERE (this unit's own OWED, at the bottom, `Gt.OWED`):
//   - the real `Brain`/`MemoryModuleType` substrate PrepareRamTask/RamImpactTask/LongJumpTask
//     actually run on (activity switching, memory expiry, `WalkTarget`/`LookTarget` objects) —
//     `Gt.RamGoal`/`Gt.LongJumpGoal` are a single `GoalSelector` goal apiece with the SAME
//     numbers, not that substrate rebuilt.
//   - `RamImpactTask`'s own potion-effect knockback adjustment (`StatusEffects.SPEED`/
//     `SLOWNESS` amplifiers, `0.25F * (speedAmp - slowAmp)`) and shield block-and-halve
//     (`blockedByShield`) — this engine tracks neither status effects on a mob nor a shield
//     block state yet.
//   (#1184: the prepare/impact/leap/step sounds are `Gt.sound`; milk/eat are in Use.entityUse.)
//   - `PowderSnowJumpGoal` — GoatEntity does not use it (.decomp: only rabbit/fox/silverfish/
//     endermite add it), so nothing is owed here.
//   - `getHeadPitch()`'s ram-charge head-down animation (`field_33488`, the `handleStatus`
//     58/59 byte pair) — pose/animation, this unit's file does
//     not own the renderer's per-mob head-pitch table.  (`getMaxHeadRotation() == 15` is `Ai.HEAD_LIMITS.goat`, asserted by headcheck.)

(function (NS) {
  'use strict';
  // rolls draw from the mob's own e.random (java.util.Random, #6437); FB only when no mob is in hand
  var FBG = new NS.JRandom(0x6437);
  var FBdG = function () { return FBG.nextFloat(); };
  function rf(e) { var r = e && e.random; return r ? function () { return r.nextFloat(); } : FBdG; }
  function ri(e, n) { return e && e.random ? e.random.nextInt(n) : FBG.nextInt(n); }

  var Gt = NS.Goat = {};

  Gt.OWED = [
    'the Task objects themselves (WalkTarget/LookTarget memories, per-tick start/run/finish order) -- ' +
      'Gt.RamGoal/Gt.LongJumpGoal are still one GoalSelector goal apiece; the memory store, ' +
      'TemptationCooldownTask expiry, ram_target/mid_jump and the CORE/IDLE/LONG_JUMP/RAM switch are Gt.brainOf.'
  ];

  // GoatEntity.tickMovement: field_33488 (ram head ticks) +1 while preparingRam (status 58), -2
  // otherwise (status 59), clamped 0..20; GoatEntityModel: head.pitch = getHeadPitch() =
  // field/20*30deg when nonzero. Called by Ai.tickHead after the look control, so it wins.
  Gt.RAM_HEAD_TICKS = 20; Gt.RAM_HEAD_PITCH_DEG = 30;
  // ── § BRAIN — the MemoryModuleType store + Activity switch GoatBrain runs on (Brain.java) ────
  // MemoryModuleType names (MemoryModuleType.java register("...")): field_33483 ram_cooldown_ticks,
  // field_30244 long_jump_cooling_down, field_28326 temptation_cooldown_ticks, field_33484 ram_target,
  // field_30245 long_jump_mid_jump, field_28325 tempting_player, field_18448 breed_target.
  // `e.ramCooldown`/`e.longJumpCooldown` are accessors onto the first two (undefined until first
  // remembered; 0 once TemptationCooldownTask has forgotten them), so every caller shares one store.
  Gt.COOLDOWN_MEMORIES = ['ram_cooldown_ticks', 'long_jump_cooling_down', 'temptation_cooldown_ticks'];
  Gt.brainOf = function (e) {
    if (e.goatBrain && e.goatBrain.mem) return e.goatBrain;
    var b = e.goatBrain = { mem: {}, seen: {}, activity: 'idle' };
    var link = function (prop, name) {
      Object.defineProperty(e, prop, { configurable: true, enumerable: false,
        get: function () { return b.mem[name] !== undefined ? b.mem[name] : (b.seen[name] ? 0 : undefined); },
        set: function (v) { if (v === undefined) { delete b.mem[name]; delete b.seen[name]; } else Gt.remember(e, name, v); } });
    };
    link('ramCooldown', 'ram_cooldown_ticks'); link('longJumpCooldown', 'long_jump_cooling_down');
    return b;
  };
  Gt.remember = function (e, name, v) { var b = Gt.brainOf(e); b.mem[name] = v; b.seen[name] = true; };
  Gt.forget = function (e, name) { delete Gt.brainOf(e).mem[name]; };
  Gt.hasMemory = function (e, name) { return Gt.brainOf(e).mem[name] !== undefined; };
  // GoatBrain.updateActivities -> Brain.resetPossibleActivities([RAM, LONG_JUMP, IDLE]): the first
  // activity whose memory gates hold (CORE always runs). RAM: tempting_player, breed_target,
  // ram_cooldown_ticks all ABSENT; LONG_JUMP: tempting_player, breed_target, long_jump_cooling_down
  // ABSENT; IDLE: ram_target, long_jump_mid_jump ABSENT. Falls back to the default (IDLE).
  Gt.updateActivities = function (e) {
    var b = Gt.brainOf(e), m = b.mem, none = function (n) { return m[n] === undefined; };
    var free = none('tempting_player') && none('breed_target');
    b.activity = free && none('ram_cooldown_ticks') ? 'ram'
      : free && none('long_jump_cooling_down') ? 'long_jump' : 'idle';
    return b.activity;
  };
  // TemptationCooldownTask (GoatBrain CORE, x3): runs while its memory is present; keepRunning
  // remembers n-1 while n > 0; once shouldKeepRunning is false (n <= 0) finishRunning forgets it.
  Gt.tickCooldowns = function (e) {
    var b = Gt.brainOf(e);
    for (var i = 0; i < Gt.COOLDOWN_MEMORIES.length; i++) {
      var n = Gt.COOLDOWN_MEMORIES[i], v = b.mem[n];
      if (v === undefined) continue;
      if (v > 0) b.mem[n] = v - 1; else delete b.mem[n];
    }
    Gt.updateActivities(e);
  };
  // One trace row: activity, each memory's remaining ticks (null = absent), block-free position.
  Gt.brainTrace = function (e) {
    var m = Gt.brainOf(e).mem, g = function (n) { return m[n] === undefined ? null : m[n]; };
    return { activity: e.goatBrain.activity, ram: g('ram_cooldown_ticks'), jump: g('long_jump_cooling_down'),
      ramTarget: m.ram_target !== undefined, midJump: m.long_jump_mid_jump !== undefined, x: e.x, y: e.y, z: e.z };
  };
  Gt.tickRamHead = function (e) {
    Gt.tickCooldowns(e);
    var n = e.ramHeadTicks || 0;
    n = e.preparingRam ? Math.min(Gt.RAM_HEAD_TICKS, n + 1) : Math.max(0, n - 2);
    e.ramHeadTicks = n;
    if (n) e.xHeadRot = n / Gt.RAM_HEAD_TICKS * Gt.RAM_HEAD_PITCH_DEG * Math.PI / 180;
  };

  Gt.ready = true;

  // ── § SPAWN — `GoatEntity.canSpawn` (.decomp lines 273-275), verbatim: the block below must
  // carry `#minecraft:goats_spawnable_on` (BlockTags.field_35569, `.decomp/net/minecraft/tag/
  // BlockTags.java:132`) AND `isLightLevelValidForNaturalSpawn` — `AnimalEntity`'s own
  // `getBaseLightLevel(pos,0) > 8` (.decomp/net/minecraft/entity/passive/AnimalEntity.java:
  // 107-112), the SAME formula `Spawn.RULES.rabbit`'s own `isBrightEnoughToSpawn` helper
  // already implements for `Animal.isBrightEnoughToSpawn` (07l_spawn.js) — wired there, as
  // `Spawn.RULES.goat`, not duplicated in this file.
  Gt.SPAWNABLE_ON_TAG = 'goats_spawnable_on';

  // ── § SCREAMING — `GoatEntity.SCREAMING_CHANCE` (0.02, .decomp line 71) ────────────────────
  Gt.SCREAMING_CHANCE = 0.02;

  /**
   * `GoatEntity.initialize` (.decomp lines 200-204): `this.setScreaming(random.nextDouble() <
   * 0.02)`, run on EVERY spawn (natural, egg or command) — `initDataTracker`'s own default is
   * plain `false`, this is the roll that can turn it on. Wired as `EL.DEFAULTS.goat`
   * (07i_entitylist.js).
   */
  Gt.spawnInit = function (e, rnd) {
    if (!e) return;
    Gt.brainOf(e);   // links e.ramCooldown/e.longJumpCooldown to the brain's memories
    e.screaming = (rnd || rf(e))() < Gt.SCREAMING_CHANCE;
  };

  /**
   * `GoatEntity.method_35177` (`createChild`, .decomp lines 132-143), verbatim: `$$3 = $$1
   * instanceof GoatEntity && $$1.isScreaming()` where `$$1` is the OTHER parent (`b` here, the
   * one passed to `createChild`, not `this`/`a`) — `$$2.setScreaming($$3 || rand.nextDouble() <
   * 0.02)`. ⚠⚠ **ONLY `b`'S OWN FLAG IS EVER READ — NOT `a`'S.** This looks like it should be
   * "either parent" (this unit's own QUEUE line says exactly that) and the bytecode does not
   * do that: a screaming mother bred as the FIRST argument to `Br.breed` never passes her own
   * flag on through this branch at all, only through the 2% independent roll — named here as a
   * real vanilla asymmetry, not smoothed into the more sensible-sounding "either" a reader
   * would expect.
   */
  Gt.childScreaming = function (b, rnd) {
    rnd = rnd || rf(b);
    return !!(b && b.screaming) || rnd() < Gt.SCREAMING_CHANCE;
  };

  // ── § FALL DAMAGE — `GoatEntity.computeFallDamage` (.decomp lines 105-108): the ordinary
  // formula minus a flat 10, floored at whatever `Ph.fallDamage`'s own `Math.max(0, ...)`
  // already floors it at. Wired as one guarded line in `Ph.landed` (14b_physics.js).
  Gt.FALL_DAMAGE_SUBTRACTOR = 10;
  Gt.adjustFallDamage = function (e, dmg) {
    if (!e || e.type !== 'goat' || !(dmg > 0)) return dmg;
    return Math.max(0, (dmg | 0) - Gt.FALL_DAMAGE_SUBTRACTOR);
  };

  // ── § RAM — `GoatBrain`'s own constants (.decomp lines 34-51), verbatim ────────────────────
  Gt.MIN_RAM_TARGET_DISTANCE = 4;   // GoatBrain.MIN_RAM_TARGET_DISTANCE
  Gt.MAX_RAM_TARGET_DISTANCE = 7;   // GoatBrain.MAX_RAM_TARGET_DISTANCE
  Gt.PREPARE_RAM_DURATION = 20;     // GoatBrain.PREPARE_RAM_DURATION (PrepareRamTask's prepareTime arg)
  Gt.RAM_SPEED = 3.0;               // GoatBrain.RAM_SPEED (RamImpactTask's own WalkTarget speed)
  Gt.RAM_COOLDOWN_MIN = 600; Gt.RAM_COOLDOWN_MAX = 6000;                     // RAM_COOLDOWN_RANGE
  Gt.SCREAMING_RAM_COOLDOWN_MIN = 100; Gt.SCREAMING_RAM_COOLDOWN_MAX = 300;  // SCREAMING_RAM_COOLDOWN_RANGE
  Gt.ADULT_RAM_STRENGTH_MULTIPLIER = 2.5;  // GoatBrain.ADULT_RAM_STRENGTH_MULTIPLIER
  Gt.BABY_RAM_STRENGTH_MULTIPLIER = 1.0;   // GoatBrain.BABY_RAM_STRENGTH_MULTIPLIER
  Gt.DEFAULT_ATTACK_DAMAGE = 2;     // GoatEntity.DEFAULT_ATTACK_DAMAGE (also createGoatAttributes' base)
  Gt.BABY_ATTACK_DAMAGE = 1;        // GoatEntity.BABY_ATTACK_DAMAGE (onGrowUp's baby override)
  // `RamImpactTask.SPEED_STRENGTH_MULTIPLIER`/its own `clamp(f, 0.2F, 3.0F)` (.decomp lines
  // 27-28, 70): `f9 = clamp(mob.getMovementSpeed() * 1.65F, 0.2F, 3.0F)`.
  Gt.SPEED_STRENGTH_MULTIPLIER = 1.65;
  Gt.MIN_KNOCKBACK_SPEED = 0.2;
  Gt.MAX_KNOCKBACK_SPEED = 3.0;
  // ⚠ NOT A JAR CONSTANT — `RamImpactTask.method_36281` (.decomp lines 62-79) checks the LIVE
  // targets overlapping the charging goat's own bounding box every tick
  // (`ServerWorld.getTargets(..., mob.getBoundingBox())`), not a fixed radius. This engine has
  // no generic "entities overlapping this box" query for a goal to call, so a flat proximity
  // check approximates it — named, not claimed exact (`Gt.OWED`'s sibling gap one line up).
  Gt.RAM_HIT_RANGE = 1.2;

  Gt.rollRamCooldown = function (e, rnd) {
    rnd = rnd || rf(e);
    var lo = (e && e.screaming) ? Gt.SCREAMING_RAM_COOLDOWN_MIN : Gt.RAM_COOLDOWN_MIN;
    var hi = (e && e.screaming) ? Gt.SCREAMING_RAM_COOLDOWN_MAX : Gt.RAM_COOLDOWN_MAX;
    return lo + Math.floor(rnd() * (hi - lo + 1));
  };

  /**
   * `RamImpactTask.method_36281`'s own impact half (.decomp lines 62-79), verbatim shape:
   * damage = the attack-damage attribute (baby 1 / adult 2, `GoatEntity.onGrowUp`), then
   * knockback = `clamp(movementSpeed * 1.65, 0.2, 3.0) * strengthMultiplier` (adult 2.5 / baby
   * 1.0), pushed along the direction from the goat toward its target. The shield/potion terms
   * are `Gt.OWED` (this file's own header).
   */
  /** `Entity.playSoundFromEntity(null, e, ev, category, volume, pitch)` at the goat; `ev` is the plain/screaming pair. */
  Gt.sound = function (e, role, volume, pitch, source) {
    var ev = 'entity.goat.' + (e.screaming && role !== 'step' ? 'screaming.' : '') + role;   // goat.step has no screaming twin
    if (e.silent || !NS.Sound || !NS.Sound.play) return null;
    NS.Sound.play(ev, { x: e.x, y: e.y, z: e.z, volume: volume, pitch: pitch, source: source || 'neutral' });
    return ev;
  };

  Gt.impact = function (e, target, rnd, dir) {
    var Cb = NS.Combat, Ai = NS.Ai;
    if (!Cb || !e || !target) return false;
    var dmg = e.isBaby ? Gt.BABY_ATTACK_DAMAGE : Gt.DEFAULT_ATTACK_DAMAGE;
    // `DamageSource.mob(goat).setNeutral()`: an entity-dealt blow (attacker credit + hurt-by memory),
    // flagged neutral. The player takes it through `Survival.hurt(...,'mob',...)` like `Cb.mobAttack`.
    var hit;
    if (target === NS.Player && NS.Survival && NS.Survival.hurt) {
      hit = NS.Survival.hurt(target, 'mob', dmg, e);
      if (hit) target.lastHurtByEntity = e;
    } else {
      hit = Cb.hurt(target, dmg, undefined, false, { attacker: e, source: 'mob', neutral: true });
    }
    // RamImpactTask.method_36281 ignores damage()'s result: sound + knockback run even when refused (i-frames)
    Gt.sound(e, 'ram_impact', 1, 1, 'hostile');   // HOSTILE, 1.0, 1.0
    if (hit && Cb.notifyHurt && target !== NS.Player) Cb.notifyHurt(target, e);
    // getMovementSpeed() is the field MoveControl last set (speedModifier * attribute: 0.6 mid-charge)
    var moveSpeed = e.mobSpeed ? e.mobSpeed : (Ai && Ai.movementSpeedOf) ? Ai.movementSpeedOf(e) : 0;
    var kbSpeed = moveSpeed * Gt.SPEED_STRENGTH_MULTIPLIER;
    if (kbSpeed < Gt.MIN_KNOCKBACK_SPEED) kbSpeed = Gt.MIN_KNOCKBACK_SPEED;
    if (kbSpeed > Gt.MAX_KNOCKBACK_SPEED) kbSpeed = Gt.MAX_KNOCKBACK_SPEED;
    // + 0.25 * (speedAmp - slowAmp), amp = amplifier + 1 (0 when absent)
    var Ef = NS.Effects, amp = function (n) {
      var a = Ef && Ef.amplifierOf ? Ef.amplifierOf(e, n) : -1;
      return Ef && Ef.hasStatusEffect && Ef.hasStatusEffect(e, n) ? a + 1 : 0;
    };
    kbSpeed += 0.25 * (amp('speed') - amp('slowness'));
    var shield = (NS.Use && NS.Use.blockedByShield && target === NS.Player && NS.Use.blockedByShield(target, null, e)) ? 0.5 : 1.0;
    var strengthMult = e.isBaby ? Gt.BABY_RAM_STRENGTH_MULTIPLIER : Gt.ADULT_RAM_STRENGTH_MULTIPLIER;
    // direction: the FIXED charge direction (RamImpactTask.direction), not goat->target.
    var dx, dz;
    if (dir) { dx = dir.x; dz = dir.z; } else { dx = target.x - e.x; dz = target.z - e.z; }
    if (Cb.knockback) Cb.knockback(target, shield * kbSpeed * strengthMult, dx, dz);
    return true;
  };

  // `ServerWorld.getTargets(LivingEntity.class, RAM_TARGET_PREDICATE, goat, goat.getBoundingBox())`:
  // live non-goat attackables whose box overlaps the goat's.
  Gt.boxHits = function (e, list) {
    var hw = (e.width || 0.9) / 2, hh = e.height || 1.3, out = [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || o === e || o.removed || o.dead || o.type === 'goat') continue;
      if (o.health !== undefined && o.health <= 0) continue;
      if (o.invulnerableGamemode) continue;
      var ow = (o.width || 0.6) / 2, oh = o.height || 1.8;
      if (Math.abs(o.x - e.x) < hw + ow && Math.abs(o.z - e.z) < hw + ow &&
          o.y < e.y + hh && o.y + oh > e.y) out.push(o);
    }
    return out;
  };

  Gt.RAM_SENSOR_RANGE = 16;   // MobEntity FOLLOW_RANGE 16: NearestLivingEntitiesSensor's box expansion
  Gt.RAM_PREPARE_WALK_SPEED = 1.25;   // GoatBrain's PrepareRamTask speed arg (walk to the lane start)

  // `PrepareRamTask.canReach`: a valid walking cell whose node type carries penalty 0.
  Gt.ramCanReach = function (e, x, y, z) {
    var Ai = NS.Ai;
    if (!Ai || !Ai.pathTypeAt) return true;
    var t = Ai.pathTypeAt(x, y, z);
    return t === Ai.NodeType.WALKABLE && (Ai.pathPenalty ? Ai.pathPenalty(e, t) : 0) === 0;
  };

  /**
   * `PrepareRamTask.findRamStart`: from the target's block, walk each of the four cardinal
   * directions up to MAX_RAM_TARGET_DISTANCE cells while the cell stays reachable; a lane whose
   * far end is >= MIN_RAM_TARGET_DISTANCE (manhattan) from the target is a candidate. The nearest
   * candidate to the goat that it can path to wins. Returns {sx,sy,sz} or null.
   */
  Gt.findRamStart = function (e, target) {
    var Ai = NS.Ai;
    var tx = Math.floor(target.x), ty = Math.floor(target.y), tz = Math.floor(target.z);
    if (!Gt.ramCanReach(e, tx, ty, tz)) return null;
    var dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]], cands = [];
    for (var i = 0; i < dirs.length; i++) {
      var cx = tx, cz = tz;
      for (var k = 0; k < Gt.MAX_RAM_TARGET_DISTANCE; k++) {
        var nx = cx + dirs[i][0], nz = cz + dirs[i][1];
        if (!Gt.ramCanReach(e, nx, ty, nz)) break;
        cx = nx; cz = nz;
      }
      if (Math.abs(cx - tx) + Math.abs(cz - tz) >= Gt.MIN_RAM_TARGET_DISTANCE) cands.push({ sx: cx, sy: ty, sz: cz });
    }
    var ex = Math.floor(e.x), ey = Math.floor(e.y), ez = Math.floor(e.z);
    cands.sort(function (a, b) {
      return ((a.sx - ex) * (a.sx - ex) + (a.sy - ey) * (a.sy - ey) + (a.sz - ez) * (a.sz - ez)) -
             ((b.sx - ex) * (b.sx - ex) + (b.sy - ey) * (b.sy - ey) + (b.sz - ez) * (b.sz - ez));
    });
    for (var j = 0; j < cands.length; j++) {
      if (!Ai || !Ai.findPath) return cands[j];
      var c = cands[j];
      var path = Ai.findPath(e.x, e.y, e.z, c.sx + 0.5, c.sy, c.sz + 0.5, { mob: e });
      if (path) return c;
    }
    return null;
  };

  /**
   * `PrepareRamTask` + `RamImpactTask`, folded into one `GoalSelector` goal (this file's own
   * header explains why: no `Brain`/`Activity` substrate exists to split them across). Shape:
   * cooldown gate (screaming: 100-300 ticks, else 600-6000) -> pick the nearest candidate
   * within [4,7] blocks -> face it and hold for `PREPARE_RAM_DURATION` (20 ticks) -> charge
   * straight at its live position at `RAM_SPEED` -> on contact, `Gt.impact`, reset the cooldown.
   * `ctx.players` is the same live enumerator every other rostered animal's `AvoidEntityGoal`/
   * `TemptGoal` already trusts (`EL.aiCtx`, 07i_entitylist.js) — the real `RAM_TARGET_PREDICATE`
   * (`TargetPredicate.createAttackable()`, any attackable LivingEntity, not just players) is
   * narrower than that in this engine only because no generic "every attackable mob" enumerator
   * exists for a goal to call yet (the same standing gap `Ai.ROSTER.rabbit`'s own `hostiles()`
   * helper works around locally for flee, not attack).
   */
  Gt.RamGoal = function (e, ctx) {
    ctx = ctx || {};
    var getPlayers = ctx.livings || ctx.players || function () { return []; };   // RAM_TARGET_PREDICATE: any attackable living, goats excluded
    var rand = ctx.random || rf(e);
    var Ai = NS.Ai;
    var phase = 'idle';   // 'preparing' | 'charging'
    var target = null, prepTicks = 0, chargeTicks = 0;
    var endX = 0, endZ = 0, dir = null;   // PrepareRamTask's fixed ram end + RamImpactTask.direction
    var CHARGE_TIMEOUT = 200;   // RamImpactTask super(..., 200)
    var PREPARE_TIMEOUT = 160, runTicks = 0, timedOut = false;   // PrepareRamTask super(..., 160)

    function pickTarget() {
      var list = getPlayers();
      var best = null, bestD = Infinity;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (!p || p === e || p.type === 'goat' || p.removed || p.dead || p.invulnerableGamemode) continue;
        if (p.health !== undefined && p.health <= 0) continue;
        var WB = NS.World && NS.World.border, hw = (p.width || 0.6) / 2;
        if (WB && !(WB.contains(p.x - hw, p.z - hw) && WB.contains(p.x + hw, p.z + hw))) continue;   // GoatBrain:52 border.contains(boundingBox)
        // NearestLivingEntitiesSensor: the goat's box grown by 16 on every axis, nearest first. The
        // 4..7 numbers are PrepareRamTask's LANE length (findRamStart), not a target-distance gate.
        var dx = p.x - e.x, dz = p.z - e.z, dy = p.y - e.y;
        if (Math.abs(dx) > Gt.RAM_SENSOR_RANGE || Math.abs(dz) > Gt.RAM_SENSOR_RANGE || Math.abs(dy) > Gt.RAM_SENSOR_RANGE) continue;
        if (Ai.canSee && !Ai.canSee(e, p)) continue;   // VISIBLE_MOBS: NEAREST_VISIBLE_LIVING_ENTITIES needs line of sight
        var d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { best = p; bestD = d; }
      }
      return best;
    }

    var ram = null;   // PrepareRamTask.Ram: {sx,sy,sz} lane start, {ex,ez} = the target's block (lane end)
    function findRam() {
      var st = Gt.findRamStart(e, target);
      ram = st ? { sx: st.sx, sy: st.sy, sz: st.sz, ex: Math.floor(target.x), ez: Math.floor(target.z) } : null;
      prepTicks = 0;
      return !!ram;
    }
    this.canUse = function () {
      // vanilla resetLongJumpCooldown (initialize / createChild) always rolls RAM_COOLDOWN_RANGE, screaming or not
      if (e.ramCooldown === undefined) e.ramCooldown = Gt.rollRamCooldown({}, rand);
      if (e.ramCooldown > 0) return false;
      var t = pickTarget();
      if (!t) return false;
      target = t;
      return !!Gt.findRamStart(e, t);
    };
    this.canContinueToUse = function () {
      if (!target || target.removed) return false;
      if (target.health !== undefined && target.health <= 0) return false;
      if (phase === 'preparing' && !ram) return false;   // PrepareRamTask.shouldKeepRunning: ram.isPresent()
      if (timedOut) return false;
      return true;
    };
    this.start = function () {
      phase = 'preparing'; prepTicks = 0; chargeTicks = 0; runTicks = 0; timedOut = false; e.preparingRam = false;
      if (target) findRam();
    };
    this.stop = function () {
      e.preparingRam = false;
      // PrepareRamTask.finishRunning (wind-up aborted, no RAM_TARGET): the FIXED range minimum; only RamImpactTask.finishRam rolls.
      // RamImpactTask has no finishRunning: a charge that times out keeps RAM_TARGET and leaves the cooldown alone.
      if (!(phase === 'charging' && timedOut)) e.ramCooldown = phase === 'preparing' ? (e.screaming ? Gt.SCREAMING_RAM_COOLDOWN_MIN : Gt.RAM_COOLDOWN_MIN) : Gt.rollRamCooldown(e, rand);
      if (!(phase === 'charging' && timedOut)) Gt.forget(e, 'ram_target');   // RamImpactTask.finishRam forgets RAM_TARGET; a timed-out charge keeps it
      phase = 'idle'; target = null; ram = null;
    };
    this.tick = function () {
      if (!target) return;
      if (phase === 'preparing') {
        if (!ram) return;
        if (++runTicks >= PREPARE_TIMEOUT && prepTicks < Gt.PREPARE_RAM_DURATION) { timedOut = true; return; }   // RUN_TIME ends the wind-up task
        var Ai0 = NS.Ai;
        // The target left the block the lane was scouted for: re-scout (stop walking, restart the wind-up).
        if (Math.floor(target.x) !== ram.ex || Math.floor(target.z) !== ram.ez) { e.preparingRam = false; findRam(); return; }
        // PrepareRamTask: look at the target, walk to the lane start at 1.25, wind up once standing on it.
        var fx = target.x - e.x, fz = target.z - e.z;
        var atStart = Math.floor(e.x) === ram.sx && Math.floor(e.z) === ram.sz;
        if (!atStart) {
          if (Ai0 && Ai0.stepToward) Ai0.stepToward(e, { x: ram.sx, y: ram.sy, z: ram.sz }, Gt.RAM_PREPARE_WALK_SPEED);
          return;
        }
        if (Ai0 && Ai0.rotlerp) e.yaw = Ai0.rotlerp(e.yaw, Math.atan2(fx, -fz), Ai0.YAW_MAX_DELTA);
        if (prepTicks === 0) {
          e.preparingRam = true;
        }
        prepTicks++;
        if (prepTicks > Gt.PREPARE_RAM_DURATION) {   // PrepareRamTask: `now - prepareStartTime >= 20` - the start tick is tick 0, so the 21st counted tick sets RAM_TARGET
          phase = 'charging'; chargeTicks = 0; e.preparingRam = false;
          var MVp = NS.MobVoice;   // PrepareRamTask.method_36271: HOSTILE, 1.0, getSoundPitch when the wind-up finishes
          Gt.sound(e, 'prepare_ram', 1, MVp && MVp.pitch ? MVp.pitch(e) : 1, 'hostile');
          // calculateRamTarget: lane end block bottom-centre + 0.5 * sign(end - start) on each axis.
          endX = ram.ex + 0.5 + 0.5 * Math.sign(ram.ex - ram.sx);
          endZ = ram.ez + 0.5 + 0.5 * Math.sign(ram.ez - ram.sz);
          // method_36280 fixes direction = goat block - end, normalized.
          var ddx = Math.floor(e.x) - endX, ddz = Math.floor(e.z) - endZ, dl = Math.hypot(ddx, ddz) || 1;
          dir = { x: ddx / dl, z: ddz / dl };
          Gt.remember(e, 'ram_target', { x: endX, y: ram.sy, z: endZ });   // PrepareRamTask: remember(RAM_TARGET, calculateRamTarget)
        }
        return;
      }
      chargeTicks++;
      var hits = Gt.boxHits(e, getPlayers());
      if (hits.length) { Gt.impact(e, hits[0], rand, dir); this.stop(); return; }
      if (Math.hypot(endX - e.x, endZ - e.z) < 0.25) { this.stop(); return; }
      if (chargeTicks > CHARGE_TIMEOUT) { timedOut = true; this.stop(); return; }
      if (Ai && Ai.stepToward) Ai.stepToward(e, { x: endX - 0.5, y: e.y, z: endZ - 0.5 }, Gt.RAM_SPEED);   // fixed point, never the live target
    };
    this.phase = function () { return phase; };   // for goatcheck to look without poking closures
  };

  // ── § LONG JUMP — `GoatBrain`'s own constants (.decomp lines 44-47) ────────────────────────
  Gt.LONG_JUMP_COOLDOWN_MIN = 600; Gt.LONG_JUMP_COOLDOWN_MAX = 1200;   // LONG_JUMP_COOLDOWN_RANGE
  Gt.LONG_JUMP_VERTICAL_RANGE = 5;     // LONG_JUMP_VERTICAL_RANGE
  Gt.LONG_JUMP_HORIZONTAL_RANGE = 5;   // LONG_JUMP_HORIZONTAL_RANGE
  Gt.LONG_JUMP_MAX_RANGE = 1.5;        // LONG_JUMP_MAX_RANGE (the initial launch speed's own cap)
  Gt.JUMP_GRAVITY = 0.08;              // the literal `0.08` in LongJumpTask.getRammingVelocity — a
                                        // projectile's per-tick gravity, same value `Cb.ARROW`'s own
                                        // family and `07za_explosion.js`'s TNT arc both already use.

  Gt.rollLongJumpCooldown = function (rnd) {
    rnd = rnd || rf(null);
    return Gt.LONG_JUMP_COOLDOWN_MIN + Math.floor(rnd() * (Gt.LONG_JUMP_COOLDOWN_MAX - Gt.LONG_JUMP_COOLDOWN_MIN + 1));
  };

  /**
   * `LongJumpTask.getRammingVelocity(MobEntity, Vec3d, int angleDeg)` (.decomp lines 163-197),
   * transcribed CLOSED-FORM (no obstruction sweep — `Gt.OWED`): pull the target 0.5 blocks
   * toward the jumper along the horizontal bearing, solve the projectile-range equation for the
   * launch speed that lands exactly on it at the given angle, refuse a speed above `maxRange`,
   * and return the (vx,vy,vz) that speed implies, scaled by the jar's own trailing `* 0.95F`.
   * Pure and stateless — unit-testable against the algebra directly, no world/goal needed.
   */
  Gt.jumpVelocity = function (fromX, fromY, fromZ, toX, toY, toZ, angleDeg, maxRange, reach) {
    var ddx = toX - fromX, ddz = toZ - fromZ;
    var norm = Math.hypot(ddx, ddz);
    var offX = 0, offZ = 0;
    if (norm > 0) { offX = (ddx / norm) * 0.5; offZ = (ddz / norm) * 0.5; }
    var tx = toX - offX, tz = toZ - offZ;
    var dx = tx - fromX, dy = toY - fromY, dz = tz - fromZ;
    var rad = angleDeg * Math.PI / 180;
    var az = Math.atan2(dz, dx);
    var horizSq = dx * dx + dz * dz;
    var horiz = Math.sqrt(horizSq);
    var sin2a = Math.sin(2 * rad);
    var cos2 = Math.cos(rad) * Math.cos(rad);
    var denom = horiz * sin2a - 2 * dy * cos2;
    var v0sq = (horizSq * Gt.JUMP_GRAVITY) / denom;
    if (!(v0sq >= 0) || !isFinite(v0sq)) return null;
    var v0 = Math.sqrt(v0sq);
    if (v0 > maxRange) return null;
    var vxh = v0 * Math.cos(rad), vy = v0 * Math.sin(rad);
    if (reach) {   // the jar's arc sweep: sample the parabola, canReach each consecutive pair
      var n = Math.ceil(horiz / vxh) * 2, d = 0, prev = null, c = Math.cos(az), sn = Math.sin(az);
      for (var i = 0; i < n - 1; i++) {
        d += horiz / n;
        var pt = { x: fromX + d * c, y: fromY + Math.sin(rad) / Math.cos(rad) * d - d * d * Gt.JUMP_GRAVITY / (2 * v0sq * Math.cos(rad) * Math.cos(rad)), z: fromZ + d * sn };
        if (prev && !reach(prev, pt)) return null;
        prev = pt;
      }
    }
    return { x: vxh * Math.cos(az) * 0.95, y: vy * 0.95, z: vxh * Math.sin(az) * 0.95 };
  };

  /**
   * `LongJumpTask.getRammingVelocity(MobEntity, Vec3d)` (.decomp lines 158-162): the SAME four
   * angles the jar tries (65,70,75,80 degrees), keeping the shortest (least launch speed)
   * success — a goat leaps as gently as the arc allows, not as hard as it can.
   */
  Gt.bestJumpVelocity = function (fromX, fromY, fromZ, toX, toY, toZ, maxRange, reach) {
    var best = null, bestLenSq = Infinity;
    for (var deg = 65; deg < 85; deg += 5) {
      var v = Gt.jumpVelocity(fromX, fromY, fromZ, toX, toY, toZ, deg, maxRange, reach);
      if (v) {
        var lenSq = v.x * v.x + v.y * v.y + v.z * v.z;
        if (lenSq < bestLenSq) { best = v; bestLenSq = lenSq; }
      }
    }
    return best;
  };

  Gt.LONG_JUMP_DELAY = 40;   // LongJumpTask TARGET_RETAIN_TIME: ticks between picking a target and leaping
  // GoatEntity.getDimensions(LONG_JUMPING) = LONG_JUMPING_DIMENSIONS (0.9x1.3 scaled 0.7) scaled by getScaleFactor()
  Gt.longJumpDims = function (e) {
    var s = e.isBaby ? 0.5 : 1;
    return { width: 0.9 * 0.7 * s, height: 1.3 * 0.7 * s };
  };
  Gt.setLongJumpPose = function (e, on) {
    var Br = NS.Breed;
    e.pose = on ? 'long_jumping' : 'standing';
    if (on) { var d = Gt.longJumpDims(e); e.width = d.width; e.height = d.height; }
    else if (Br && Br.refreshDimensions) Br.refreshDimensions(e);
  };
  // LongJumpTask.canReach: step the box (long-jumping dims) from a to b, 0.9*min(w,h) at a time, each must be space-empty
  Gt.canReach = function (e, a, b) {
    var Ph = NS.Physics;
    if (!Ph || !Ph.shapeAt) return true;
    var d = Gt.longJumpDims(e), step = Math.min(d.width, d.height);
    var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
    var n = Math.ceil(len / step), p = { x: a.x, y: a.y, z: a.z };
    for (var i = 0; i < n; i++) {
      if (i === n - 1) p = b; else { p = { x: p.x + dx / len * step * 0.9, y: p.y + dy / len * step * 0.9, z: p.z + dz / len * step * 0.9 }; }
      var x0 = p.x - d.width / 2, x1 = p.x + d.width / 2, y0 = p.y, y1 = p.y + d.height, z0 = p.z - d.width / 2, z1 = p.z + d.width / 2;
      for (var bx = Math.floor(x0); bx <= Math.floor(x1 - 1e-7); bx++)
        for (var by = Math.floor(y0); by <= Math.floor(y1 - 1e-7); by++)
          for (var bz = Math.floor(z0); bz <= Math.floor(z1 - 1e-7); bz++) {
            var sh = Ph.shapeAt(bx, by, bz);
            if (!sh) continue;
            for (var k = 0; k < sh.length; k++) {
              var q = sh[k];
              if (bx + q[0] < x1 && bx + q[3] > x0 && by + q[1] < y1 && by + q[4] > y0 && bz + q[2] < z1 && bz + q[5] > z0) return false;
            }
          }
    }
    return true;
  };

  /**
   * LongJumpTask as one goal. Cooldown (600-1200) -> on the ground and off cooldown, start() builds the
   * candidate grid (every column in the 11x11x11 box with a solid floor, solved by bestJumpVelocity with the
   * canReach arc sweep, weight ceil(distSq)) -> tick picks one weighted-random target, looks at it, waits
   * LONG_JUMP_DELAY ticks, then leaps in the LONG_JUMPING pose. The goat stands still the whole time
   * (canContinueToUse ends if it moves, the 20 pick attempts run out, or the grid is empty).
   * A pick the goat can path to (Ai.findPath complete, 8 range) is dropped, as vanilla's reachesTarget skip does.
   */
  Gt.LongJumpGoal = function (e, ctx) {
    ctx = ctx || {};
    var rand = ctx.random || rf(e);
    var Ph = NS.Physics;
    var targets = [], last = null, lastPos = null, cooldown = 0, ticks = 0, targetTime = 0, leaped = false;

    this.canUse = function () {
      if (e.longJumpCooldown === undefined) e.longJumpCooldown = Gt.rollLongJumpCooldown(rand);
      if (e.leapPending && !e.onGround && ++e.leapAge < 100) return false;   // LeapingChargeTask runs while !onGround, max 100 ticks
      if (e.leapPending) { Gt.forget(e, 'long_jump_mid_jump'); e.leapPending = false; e.noDrag = false; e.vx *= 0.1; e.vy *= 0.1; e.vz *= 0.1; Gt.setLongJumpPose(e, false); Gt.sound(e, 'step', 2, 1); e.longJumpCooldown = Gt.rollLongJumpCooldown(rand); }   // LeapingChargeTask.finishRunning: the cooldown is rolled on landing
      if (!e.onGround) return false;
      var W = NS.World, SR = NS.States;
      if (W && SR && W.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) === SR.stateOf('honey_block')) return false;   // LongJumpTask.shouldRun: not in a honey_block cell
      if (e.longJumpCooldown > 0) return false;
      return true;
    };
    this.canContinueToUse = function () {
      return !leaped && !!lastPos && lastPos.x === e.x && lastPos.y === e.y && lastPos.z === e.z && cooldown > 0 && (!!last || targets.length > 0);
    };
    this.start = function () {
      last = null; cooldown = 20; targets = []; ticks = 0; leaped = false;
      lastPos = { x: e.x, y: e.y, z: e.z };
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      var H = Gt.LONG_JUMP_HORIZONTAL_RANGE, V = Gt.LONG_JUMP_VERTICAL_RANGE;
      var reach = function (a, b) { return Gt.canReach(e, a, b); };
      for (var x = bx - H; x <= bx + H; x++) for (var y = by - V; y <= by + V; y++) for (var z = bz - H; z <= bz + H; z++) {
        if (x === bx && z === bz) continue;
        var fs = Ph && Ph.blockAt(x, y - 1, z), SRt = NS.States;
        if (!(SRt && SRt.fullCubeCollision && SRt.fullCubeCollision(fs) && SRt.atten[fs] >= 15)) continue;   // isValidPosition: block below isOpaqueFullCube = full-cube collision AND opaque (light atten 15; glass is full but not opaque)
        if (NS.Ai && NS.Ai.pathTypeAt && NS.Ai.pathPenalty && NS.Ai.pathPenalty(e, NS.Ai.pathTypeAt(x, y, z)) !== 0) continue;   // getPathfindingPenalty(getLandNodeType) == 0
        var v = Gt.bestJumpVelocity(e.x, e.y, e.z, x + 0.5, y + 0.5, z + 0.5, Gt.LONG_JUMP_MAX_RANGE, reach);   // Vec3d.ofCenter
        if (v) targets.push({ x: x, y: y, z: z, v: v, w: Math.ceil((x - bx) * (x - bx) + (y - by) * (y - by) + (z - bz) * (z - bz)) });
      }
    };
    this.tick = function () {
      ticks++;
      if (last) {
        if (ticks - targetTime >= Gt.LONG_JUMP_DELAY) {
          var Pp = NS.Physics, l = Math.hypot(last.v.x, last.v.y, last.v.z), k = l > 0 && Pp && Pp.jumpBoostVelocity ? (l + Pp.jumpBoostVelocity(e)) / l : 1;   // + getJumpBoostVelocityModifier
          e.vx = last.v.x * k; e.vy = last.v.y * k; e.vz = last.v.z * k; e.onGround = false; e.noDrag = true;
          Gt.remember(e, 'long_jump_mid_jump', true);   // LongJumpTask.run: LONG_JUMP_MID_JUMP
          e.leapPending = true; e.leapAge = 0; leaped = true; if (e.bodyYaw != null) e.yaw = e.bodyYaw;   // method_35083: setYaw(bodyYaw)
          e.longJumpCooldown = 0;
          Gt.setLongJumpPose(e, true);
          Gt.sound(e, 'long_jump', 1, 1);   // LongJumpTask: NEUTRAL, 1.0, 1.0
        }
        return;
      }
      cooldown--;
      var total = 0, i;   // Weighting.getRandom
      for (i = 0; i < targets.length; i++) total += targets[i].w;
      if (!total) return;
      var r = Math.floor(rand() * total);
      for (i = 0; i < targets.length - 1 && (r -= targets[i].w) >= 0; i++);
      var pick = targets.splice(i, 1)[0], NA = NS.Ai;
      // method_35083: findPathTo(pos,0,8) -- a target the goat can simply walk to is dropped (the attempt is spent), not leapt at
      if (ctx.walkable !== false && NA && NA.findPath && NA.findPath(e.x, e.y, e.z, pick.x + 0.5, pick.y, pick.z + 0.5, { mob: e, maxDistance: 8 })) return;
      last = pick; targetTime = ticks;
      e.yaw = Math.atan2(last.x + 0.5 - e.x, -(last.z + 0.5 - e.z));   // BlockPosLookTarget
    };
    this.stop = function () {
      if (leaped) return;   // rolled on landing (canUse)
      e.longJumpCooldown = Math.floor(Gt.rollLongJumpCooldown(rand) / 2);   // no leap: the jar remembers cooldown/2
    };
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
