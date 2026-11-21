// 07v_spell.js — QUEUE 0.2 raid loop (loop/spells-s93): the evoker/illusioner SPELL-CAST STATE
// MACHINE and its concrete spells. Runs on: MAIN THREAD ONLY. No DOM.
//
// Closes the gap `07s_raid.js`'s own `Rd.OWED` and `07k_goals.js`'s own `Ai.OWED` both name:
// "evoker's/illusioner's spells ... no spell-cast state machine exists
// (SpellcastingIllagerEntity.spellTicks/getSpell) to transcribe into; neither mob casts
// anything". This file IS that state machine — `SpellcastingIllagerEntity`'s own
// `CastSpellGoal`/`LookAtTargetGoal` (`.decomp/net/minecraft/entity/mob/
// SpellcastingIllagerEntity.java`), transcribed generic and parameterised the same way
// `Ai.RangedBowAttackGoal`/`Ai.CrossbowAttackGoal` already are (07k_goals.js) — and FIVE of
// the six concrete spells: `ConjureFangsGoal` (`.decomp/.../EvokerEntity.java`, its own
// `EvokerFangsEntity`, `.decomp/.../EvokerFangsEntity.java`), `BlindTargetGoal`/
// `GiveInvisibilityGoal` (`.decomp/.../IllusionerEntity.java`), calling `NS.Effects`'s existing
// API (`07q_effects.js`) rather than touching it, and — loop/raidvex-s96 — `SummonVexGoal`
// (`.decomp/.../EvokerEntity.java`'s own inner class), spawning three real, moving `vex`
// entities through the flight substrate `07t_fly.js`/`07k_goals.js` add this same pass.
// `WololoGoal` is wired too (s98, `SP.WololoGoal`).
//
// ⚠⚠ **THE TICK-RATE HALVING IS NOT REPRODUCED, AND IS NAMED ONCE HERE.** Real
// `MobEntity.tickNewAi()` runs a goal's full `canStart`/`start`/`stop`/`tick` evaluation on only
// every OTHER real tick (`(server.getTicks()+id)%2==0`) and `Goal.getTickCount(count)` HALVES
// (`toGoalTicks`, `ceilDiv(count,2)`) any cooldown built from that halved cadence to land on the
// same real-time duration. This engine's own `Ai.GoalSelector.tick()` (07k_goals.js) has no such
// split — it runs the full evaluation every real tick, the same "one fixed tick rate" standing
// `Ai.OWED` already gives `LeapAtTargetGoal`'s `reducedTickDelay` roll. Applying `getTickCount`'s
// halving on TOP of a selector that already ticks every real tick would make a cast's real-world
// cooldown HALF of vanilla's; `SP.CastSpellGoal` below uses `CastSpellGoal.getInitialCooldown()`'s
// raw, un-halved value as a real-tick count instead, which is the closer real-time match — named
// as a deliberate divergence from the Java call site, not a bytecode re-walk.
//
// ⚠ NEEDS `NS.Effects` (07q_effects.js, loaded before this file — see build.mjs) for
// blindness/invisibility. Needs nothing else at definition time (ARCH's own no-cross-module-
// work-at-definition-time rule); every other module (`NS.Physics`, `NS.Combat`, `NS.Diff`) is
// read lazily inside a function body, exactly like `Ai.pathTypeAt` already does for `Ph`.

(function (NS) {
  'use strict';
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6440)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = NS.JRandom ? new NS.JRandom(0x6440) : { s: 0x6440, nextDouble: function () { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return this.s / 4294967296; } }; return fbR.nextDouble(); }

  var SP = NS.Spell = { ready: false };

  SP.OWED = [
    // ── CLOSED THIS PASS (loop/raidvex-s96) — `SummonVexGoal` now really summons three live,
    // moving `vex` entities (`SP.SummonVexGoal`/`SP.castSummonVex`, above); `vex` itself now
    // has a motion row (`07i_entitylist.js`'s own `EL.motionFor` hardcode) and a real flight
    // substrate (`Fl.VexMoveControl`, 07t_fly.js) and goal set (`Ai.ROSTER.vex`, 07k_goals.js).
    // What THAT pass itself simplifies is named on `Fl.OWED`/`Ai.OWED`, not repeated here. ──
    // ── the one spell this pass still names rather than approximates ──────────────────────
    // ── CLOSED s98 -- WololoGoal (SP.WololoGoal): sheep carry `e.woolColor` since D-523/D-536. ──
    // ── simplifications inside the FOUR spells this pass DOES wire ───────────────────────
    'IllusionerEntity\'s own mirror-image clones (`field_7297`\'s four ghost offsets, drawn only ' +
      'while invisible and hurt) are a RENDER effect, not a spell — `SpellcastingIllagerEntity` ' +
      'does not own them and this file does not either; named here because they are easy to ' +
      'mistake for spell state at a glance',
    'KW-41 (s151) FIXED: BlindTargetGoal\'s own difficulty gate (`world.getLocalDifficulty(pos).' +
      'isHarderThan(NORMAL.ordinal()=2)`, IllusionerEntity.java:229) now reads the REAL regional ' +
      'value (`Eq.localDifficulty()`, 07y_equip.js — time played, moon phase, global difficulty), ' +
      'the same stand-in husk/zombie-reinforcement/phantom already use, compared with the same ' +
      '`> 2` vanilla runs — no longer the GLOBAL difficulty-LEVEL-index approximation this bullet ' +
      'used to name (that let a fresh normal-mode world, real local difficulty 1.5, blind ' +
      'immediately; vanilla never does, 1.5 is not harder than 2)'
  ];

  SP.init = function () {
    SP.ready = !!(NS.Effects && NS.Effects.ready);
    return SP;
  };

  // ── SpellcastingIllagerEntity.Spell (Yarn enum, .decomp .../SpellcastingIllagerEntity.java:
  // 191-201) — the id `dataTracker`/NBT round-trips and `07j_entityrender.js` would read for the
  // casting pose the day it wires one; this file only ever WRITES it (`e.spell`).
  SP.NONE = 0; SP.SUMMON_VEX = 1; SP.FANGS = 2; SP.WOLOLO = 3; SP.DISAPPEAR = 4; SP.BLINDNESS = 5;

  // EvokerEntity's SoundEvents (.decomp EvokerEntity.java getAmbient/Death/Hurt/CastSpell/Celebrating +
  // each spell goal's getSoundPrepare); the per-mob voice table `SP.evokerSound` plays from.
  SP.EVOKER_SOUND = {
    ambient: 'entity.evoker.ambient', death: 'entity.evoker.death', hurt: 'entity.evoker.hurt',
    cast: 'entity.evoker.cast_spell', celebrate: 'entity.evoker.celebrate',
    prepareAttack: 'entity.evoker.prepare_attack', prepareSummon: 'entity.evoker.prepare_summon',
    prepareWololo: 'entity.evoker.prepare_wololo'
  };
  /** `Entity.playSound(ev, 1, getSoundPitch())` (ambient/hurt/death); CastSpellGoal start/tick pass `fixedPitch` 1.0: volume 1, pitch `(rand-rand)*0.2+1`, hostile category. */
  SP.evokerSound = function (e, ev, fixedPitch) {
    if (!ev || !NS.Sound || !NS.Sound.play || e.silent) return false;
    return NS.Sound.play(ev, { x: e.x, y: e.y, z: e.z, volume: 1, pitch: fixedPitch !== undefined ? fixedPitch : (RNDFB() - RNDFB()) * 0.2 + 1, source: 'hostile' });
  };
  /** `MobEntity.baseTick` ambient roll (`nextInt(1000) < ambientSoundChance++`, min delay 80). */
  SP.tickAmbient = function (e) {
    if (e.dead || !(e.health > 0)) return;
    if (e.ambientSoundChance === undefined) e.ambientSoundChance = 0;
    if (Math.floor(RNDFB() * 1000) < e.ambientSoundChance++) {
      e.ambientSoundChance = -80;
      SP.evokerSound(e, SP.EVOKER_SOUND.ambient);
    }
  };

  /** #1017 -- `IllusionerEntity.tickMovement` client half (.decomp IllusionerEntity.java:101-137), run
   *  only while invisible: `e.mirrorTicks` (field_7296) and `e.mirrorOffsets` ([prev, cur] x 4 Vec3,
   *  field_7297). On `hurtTime == 1 || age % 1200 == 0` re-rolls the four offsets, spawns 16 cloud
   *  puffs (CLOUD) and plays
   *  ENTITY_ILLUSIONER_MIRROR_MOVE; on `hurtTime == maxHurtTime - 1` collapses them to zero. */
  SP.tickMirror = function (e, rand) {
    if (!e || e.type !== 'illusioner') return false;
    var ES = NS.Effects;
    if (!(ES && ES.hasStatusEffect && ES.hasStatusEffect(e, 'invisibility'))) return false;
    var r = rand || RNDFB;
    if (!e.mirrorOffsets) {
      e.mirrorOffsets = [[[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]];
    }
    var m = e.mirrorOffsets, i;
    e.mirrorTicks = Math.max(0, (e.mirrorTicks | 0) - 1);
    var hurt = e.hurtTime | 0, maxHurt = e.maxHurtTime === undefined ? 10 : e.maxHurtTime;
    if (hurt === 1 || (e.age | 0) % 1200 === 0) {
      e.mirrorTicks = 3;
      for (i = 0; i < 4; i++) {
        m[0][i] = m[1][i];
        m[1][i] = [(-6 + Math.floor(r() * 13)) * 0.5, Math.max(0, Math.floor(r() * 6) - 4), (-6 + Math.floor(r() * 13)) * 0.5];
      }
      var Px = NS.Particle;
      for (i = 0; i < 16 && Px; i++) {
        Px.spawn('cloud', e.x + (r() - 0.5) * e.width, e.y + r() * e.height, e.z + (r() - 0.5) * e.width, 0, 0, 0, r);
      }
      SP.evokerSound(e, 'entity.illusioner.mirror_move', 1);
      return true;
    } else if (hurt === maxHurt - 1) {
      e.mirrorTicks = 3;
      for (i = 0; i < 4; i++) { m[0][i] = m[1][i]; m[1][i] = [0, 0, 0]; }
    }
    return false;
  };

  /** `IllusionerEntity.method_7065(partial)`: the four ghost offsets, lerped while `mirrorTicks > 0`. */
  SP.mirrorOffsets = function (e, partial) {
    var m = e.mirrorOffsets || [[[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]];
    if ((e.mirrorTicks | 0) <= 0) return m[1];
    var k = Math.pow(((e.mirrorTicks | 0) - partial) / 3, 0.25), out = [];
    for (var i = 0; i < 4; i++) {
      out.push([m[1][i][0] * (1 - k) + m[0][i][0] * k, m[1][i][1] * (1 - k) + m[0][i][1] * k, m[1][i][2] * (1 - k) + m[0][i][2] * k]);
    }
    return out;
  };

  /** `SpellcastingIllagerEntity.isSpellcasting()` (server half: `spellTicks > 0`). */
  SP.isSpellcasting = function (e) { return !!e && (e.spellTicks || 0) > 0; };

  /** `Spell.particleVelocity` (SpellcastingIllagerEntity.java:192-197), indexed by spell id: the
   *  ENTITY_EFFECT particle's velocity triple IS its RGB (`SpellParticle.EntityFactory.setColor`). */
  SP.PARTICLE_COLOR = [[0, 0, 0], [0.7, 0.7, 0.8], [0.4, 0.3, 0.35], [0.7, 0.5, 0.2], [0.3, 0.3, 0.8], [0.1, 0.1, 0.2]];

  /** `SpellcastingIllagerEntity.tick` client half (:74-90): two `entity_effect` particles at
   *  y+1.8, +-0.6 along the arm swing angle, tinted by the current spell. Returns the count. */
  SP.tickParticles = function (e, rand) {
    var Px = NS.Particle;
    if (!Px || !SP.isSpellcasting(e)) return 0;
    var c = SP.PARTICLE_COLOR[e.spell | 0] || SP.PARTICLE_COLOR[0];
    var yaw = (e.yBodyRot !== undefined ? e.yBodyRot : (e.yaw || 0)) - Math.PI;   // engine yaw -> vanilla bodyYaw
    var a = yaw + Math.fround(Math.cos(Math.fround((e.age || 0) * 0.6662)) * 0.25);
    var cs = Math.cos(a), sn = Math.sin(a), n = 0;
    for (var s = 1; s >= -1; s -= 2) {
      var p = Px.spawn('effect', e.x + s * cs * 0.6, e.y + 1.8, e.z + s * sn * 0.6, c[0], c[1], c[2], rand);
      if (p) { p.red = c[0]; p.green = c[1]; p.blue = c[2]; n++; }
    }
    return n;
  };

  /**
   * `SpellcastingIllagerEntity.CastSpellGoal` (.decomp .../SpellcastingIllagerEntity.java:97-
   * 150), generic and parameterised — the same shape `Ai.RangedBowAttackGoal`'s own header
   * cites as precedent. `cfg`: `{ spellId, spellTicks, initialCooldown (default 20, `getInitial
   * Cooldown()`'s own default), startTimeDelay (`startTimeDelay()`), castSpell(e, ctx)
   * (`castSpell()`), canUse(e, ctx) (an EXTRA gate a concrete spell adds on top of "have a live
   * target and am not already casting" — `BlindTargetGoal`'s difficulty/one-shot-per-target
   * check, `WololoGoal`'s own no-target-at-all shape; optional) }`.
   *
   * Flags: NONE (0) — real `CastSpellGoal` never calls `setControls`, so it holds no MOVE/LOOK/
   * TARGET flag in vanilla either; the real exclusivity is `canUse`'s own `!isSpellcasting()`
   * check, not the GoalSelector's flag-conflict rule (`Ai.GoalSelector`'s own header, 07k_goals.js).
   */
  SP.CastSpellGoal = function (e, ctx, cfg) {
    var startTime = 0;
    var cooldown = 0;
    // vanilla: spellCooldown = getTickCount(n) = ceil(n/2) goal ticks, one goal tick per 2 real ticks,
    // the first on the start tick itself -> cast on real tick start + 2*ceil(n/2) - 2. This selector
    // ticks every real tick, so decrement 2*ceil(n/2)-1 times (n=20 -> 19, cast at start+18).
    var initialCooldown = 2 * Math.ceil((cfg.initialCooldown || 20) / 2) - 1;
    this.canUse = function () {
      var t = e.target;
      if (!t || t.dead || !(t.health > 0)) return false;
      if (SP.isSpellcasting(e)) return false;
      if ((e.age || 0) < startTime) return false;
      return !cfg.canUse || cfg.canUse(e, ctx);
    };
    this.canContinueToUse = function () {
      var t = e.target;
      return !!t && !t.dead && (t.health > 0) && cooldown > 0;
    };
    this.start = function () {
      cooldown = initialCooldown;
      e.spellTicks = cfg.spellTicks;
      startTime = (e.age || 0) + (cfg.startTimeDelay || 0);
      e.spell = cfg.spellId;
      if (cfg.prepareSound) SP.evokerSound(e, cfg.prepareSound, 1);
      if (cfg.onStart) cfg.onStart(e, ctx);
    };
    this.stop = function () { if (cfg.onStop) cfg.onStop(e, ctx); };
    this.tick = function () {
      if (cooldown > 0) cooldown--;
      if (cooldown === 0) { cfg.castSpell(e, ctx); if (cfg.castSound) SP.evokerSound(e, cfg.castSound, 1); cooldown = -1; }
    };
  };

  /**
   * `SpellcastingIllagerEntity.LookAtTargetGoal` (.decomp, same file, lines 157-190) — the
   * priority-1 MOVE|LOOK goal that owns the casting POSE: stop moving, face the target, and
   * reset `e.spell` to NONE the instant `getSpellTicks() <= 0` (this goal's own `canUse` going
   * false is what stops it — vanilla resets the visible spell in `stop()`, unconditionally, and
   * so does this). `e.spellTicks` counts down in `SP.mobTick`, not here.
   */
  SP.LookAtTargetGoal = function (e) {
    this.canUse = function () { return (e.spellTicks || 0) > 0; };
    this.canContinueToUse = this.canUse;
    // start(): `navigation.stop()` -- the MOVE-flag preemption already stops the walking goals
    // (their own stop() drops their path); this clears any path the mob itself carries.
    this.start = function () { e.path = null; };
    this.stop = function () { e.spell = SP.NONE; };
    this.tick = function () {
      // s98 -- `EvokerEntity.LookAtTargetOrWololoTarget.tick`: the target, else the wololo sheep.
      // `getLookControl().lookAt(t, maxHeadRotation, maxLookPitchChange)`: a rate-limited head turn
      // (the body follows via BodyControl), never a yaw write (#1126).
      var t = e.target || e.wololoTarget;
      if (t && e.look) e.look.setLookAt(t.x, t.y + (t.eyeHeight || 0), t.z);
    };
  };

  /** `SpellcastingIllagerEntity.mobTick()`: `if (spellTicks > 0) spellTicks--`, unconditionally (#1126). */
  SP.mobTick = function (e) { if (e.spellTicks > 0) e.spellTicks--; };

  // ════════════════════════ EvokerEntity$SummonVexGoal ═══════════════════════════════════════
  // .decomp/net/minecraft/entity/mob/EvokerEntity.java (`SummonVexGoal`, inner class, read in
  // full this pass) — spellTicks 100, startTimeDelay 340 (both javap'd literals, the same shape
  // `ConjureFangsGoal`'s own 40/100 pair below already reads off this file).
  SP.VEX_NEARBY_RANGE = 16;    // `closeVexPredicate`'s own `setBaseMaxDistance(16.0)`

  /** `SummonVexGoal.canStart()`'s own EXTRA gate (on top of the base `CastSpellGoal.canStart`
   *  `SP.CastSpellGoal` already enforces via `cfg.canUse`): count live vexes within
   *  `SP.VEX_NEARBY_RANGE` blocks (the box-vs-predicate double filter `.decomp` uses collapses
   *  to a single Euclidean radius here, same standing simplification `SP.conjureFangs`' own
   *  ground search already makes for a box test) and refuse unless `nextInt(8)+1 > count`. */
  SP.canStartSummonVex = function (e, ctx) {
    var rand = (ctx && ctx.random) || RNDFB;
    var ents = ctx && ctx.entities ? ctx.entities() : [];
    var near = 0;
    for (var i = 0; i < ents.length; i++) {
      var o = ents[i];
      if (!o || o === e || o.type !== 'vex' || o.removed) continue;
      var d = Math.hypot(o.x - e.x, o.y - e.y, o.z - e.z);
      if (d <= SP.VEX_NEARBY_RANGE) near++;
    }
    return (Math.floor(rand() * 8) + 1) > near;
  };

  /** `SummonVexGoal.castSpell()`, verbatim shape: three vexes, each at
   *  `getBlockPos().add(-2+nextInt(5), 1, -2+nextInt(5))`, `setOwner(this)`, `setBounds(pos)`,
   *  `setLifeTicks(20*(30+nextInt(90)))`. Spawned through `ctx.spawnFn`, the SAME injected-
   *  callback shape `SP.conjureFangs`/`Ai.RangedBowAttackGoal`'s own `onShoot` already use — a
   *  `null` back (the closed-set spawn refusal, `EL.spawn`'s own header) is skipped, not
   *  retried, matching vanilla's own "spawn always succeeds" assumption having nothing to
   *  fall back to either. */
  SP.castSummonVex = function (e, ctx) {
    var rand = (ctx && ctx.random) || RNDFB;
    if (!ctx || !ctx.spawnFn) return;
    for (var i = 0; i < 3; i++) {
      var bx = Math.floor(e.x) + (-2 + Math.floor(rand() * 5));
      var by = Math.floor(e.y) + 1;
      var bz = Math.floor(e.z) + (-2 + Math.floor(rand() * 5));
      var vex = ctx.spawnFn('vex', bx + 0.5, by, bz + 0.5);
      if (!vex) continue;
      vex.owner = e;
      vex.bounds = { x: bx, y: by, z: bz };
      // `setLifeTicks` — `this.alive = true; this.lifeTicks = $$0;` (VexEntity.java, read in
      // full above); `Fl.tickVexLife` (07t_fly.js) is the only reader of either field.
      vex.vexAlive = true;
      vex.vexLifeTicks = 20 * (30 + Math.floor(rand() * 90));
    }
  };

  SP.SummonVexGoal = function (e, ctx) {
    var g = new SP.CastSpellGoal(e, ctx, {
      spellId: SP.SUMMON_VEX, spellTicks: 100, startTimeDelay: 340,
      canUse: SP.canStartSummonVex, castSpell: SP.castSummonVex,
      prepareSound: SP.EVOKER_SOUND.prepareSummon, castSound: SP.EVOKER_SOUND.cast
    });
    g.auditName = 'EvokerEntity.SummonVexGoal';   // tools/goalaudit.mjs: which jar inner class this CastSpellGoal is
    return g;
  };

  // ════════════════════════ EvokerEntity$WololoGoal (s98) ══════════════════════════════════
  // .decomp/net/minecraft/entity/mob/EvokerEntity.java:316-390, read whole. NOT a plain
  // `SP.CastSpellGoal`: it needs NO target (it refuses one) and continues on its own sheep.
  // BLUE sheep within the box expanded (16, 4, 16) and TargetPredicate base distance 16 ->
  // RED (`DyeColor.field_7966` blue -> `field_7964` red). getInitialCooldown 40, getSpellTicks
  // 60, startTimeDelay 140; gated on the mobGriefing gamerule.
  SP.WOLOLO_FROM = 'blue';
  SP.WOLOLO_TO = 'red';
  SP.WOLOLO_WARMUP = 40;   // getInitialCooldown
  SP.wololoCandidates = function (e, list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || o.type !== 'sheep' || o.dead || o.removed) continue;
      if ((o.woolColor || 'white') !== SP.WOLOLO_FROM) continue;
      var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z;
      var hw = (e.w || 0.6) / 2 + 16 + (o.w || 0.9) / 2;
      if (Math.abs(dx) > hw || Math.abs(dz) > hw) continue;                       // box.expand(16, 4, 16)
      if (o.y + (o.h || 1.3) < e.y - 4 || o.y > e.y + (e.h || 1.95) + 4) continue;
      if (dx * dx + dy * dy + dz * dz > 16 * 16) continue;                           // setBaseMaxDistance(16)
      if (NS.Ai && NS.Ai.canSee && !NS.Ai.canSee(e, o)) continue;                   // no ignoreVisibility(): TargetPredicate.test needs canSee
      out.push(o);
    }
    return out;
  };
  SP.WololoGoal = function (e, ctx) {
    var startTime = 0, cooldown = 0;
    var rand = (ctx && ctx.random) || RNDFB;
    this.canUse = function () {
      if (e.target) return false;
      if (SP.isSpellcasting(e)) return false;
      if ((e.age || 0) < startTime) return false;
      var griefing = ctx && typeof ctx.mobGriefing === 'function' ? ctx.mobGriefing()
        : (ctx && ctx.mobGriefing !== undefined ? !!ctx.mobGriefing : true);
      if (!griefing) return false;
      var list = (NS.EntityList && NS.EntityList.list) || [];
      var c = SP.wololoCandidates(e, list);
      if (!c.length) return false;
      e.wololoTarget = c[Math.floor(rand() * c.length)];
      return true;
    };
    this.canContinueToUse = function () { return !!e.wololoTarget && cooldown > 0; };
    this.start = function () {
      cooldown = SP.WOLOLO_WARMUP;
      e.spellTicks = 60;
      startTime = (e.age || 0) + 140;
      e.spell = SP.WOLOLO;
      SP.evokerSound(e, SP.EVOKER_SOUND.prepareWololo, 1);
    };
    this.stop = function () { e.wololoTarget = null; };
    this.tick = function () {
      if (cooldown > 0) cooldown--;
      if (cooldown === 0) {
        var s2 = e.wololoTarget;
        if (s2 && !s2.dead && !s2.removed) s2.woolColor = SP.WOLOLO_TO;
        SP.evokerSound(e, SP.EVOKER_SOUND.cast, 1);
        cooldown = -1;
      }
    };
  };

  // ════════════════════════ EvokerEntity$ConjureFangsGoal ═════════════════════════════════
  // .decomp/net/minecraft/entity/mob/EvokerEntity.java:151-232 (`ConjureFangsGoal`) and
  // .decomp/net/minecraft/entity/mob/EvokerFangsEntity.java (the entity it spawns).
  SP.FANGS_TICKS_LEFT = 22;      // EvokerFangsEntity's own field init, `ticksLeft = 22`
  SP.FANGS_WARMUP_CLOSE = 0;     // conjureFangs' own literal 0 for the close ring
  SP.FANGS_WARMUP_OUTER = 3;     // and 3 for the wider ring
  SP.FANG_DAMAGE = 6;            // EvokerFangsEntity.damage(): DamageSource.MAGIC, 6.0F

  /** Collision boxes (cell-local AABBs) of the voxel, or null: `Physics.shapesForState` of the
   *  live block, so snow layers / carpets (not flagged solid) still report their real height;
   *  an ungenerated column falls back to `Physics.shapeAt` (full cube, D-73). */
  SP.worldShapeAt = function (x, y, z) {
    var Ph = NS.Physics, id = NS.World && NS.World.getBlock ? NS.World.getBlock(x, y, z) : 0;
    if (!id) return Ph.shapeAt(x, y, z);
    return Ph.shapesForState(id);
  };
  function topIsFull(boxes) {      // `isSideSolidFullSquare(UP)`: a box reaching y=1 that covers the whole face
    if (!boxes) return false;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (b[4] >= 1 && b[0] <= 0 && b[2] <= 0 && b[3] >= 1 && b[5] >= 1) return true;
    }
    return false;
  }
  function maxY(boxes) {           // VoxelShape.getMax(Y); 0 for an empty shape
    var m = 0;
    for (var i = 0; boxes && i < boxes.length; i++) if (boxes[i][4] > m) m = boxes[i][4];
    return m;
  }

  /** `EvokerFangsEntity`'s own ground search (`conjureFangs`'s do-while). The block below must
   *  have a full solid top (`isSideSolidFullSquare(UP)`); a non-air block AT the found position
   *  lifts the fang by its collision max-Y (snow layers, carpets). With `shapeAt` (x,y,z ->
   *  boxes|null) that is exact; without it the legacy boolean `solidAt` decides and no offset
   *  applies. Returns the fang's spawn Y, or null (no ground found within `floor(minY)-1`). */
  SP.findFangGround = function (solidAt, x, z, minY, maxY_, shapeAt) {
    var fx = Math.floor(x), fz = Math.floor(z);
    var y = Math.floor(maxY_);
    var floorMinY = Math.floor(minY);
    do {
      if (shapeAt) {
        if (topIsFull(shapeAt(fx, y - 1, fz))) return y + maxY(shapeAt(fx, y, fz));
      } else if (solidAt(fx, y - 1, fz)) return y;
      y--;
    } while (y >= floorMinY - 1);
    return null;
  };

  /** One `conjureFangs(x, z, minY, maxY, angle, warmup)` call — finds ground, spawns the fang
   *  entity through `ctx.spawnFn` (the same injected-callback shape `Ai.RangedBowAttackGoal`'s
   *  own `onShoot` already uses), and stamps its warmup/owner. Returns the entity or null. */
  SP.conjureFangs = function (owner, ctx, x, z, minY, maxY, angle, warmup) {
    var solidAt = (ctx && ctx.solidAt) || (NS.Physics && NS.Physics.solidAt);
    if (!solidAt || !ctx || !ctx.spawnFn) return null;
    var y = SP.findFangGround(solidAt, x, z, minY, maxY, ctx.shapeAt || (ctx.solidAt ? null : SP.worldShapeAt));
    if (y === null) return null;
    var fangs = ctx.spawnFn('evoker_fangs', x, y, z);
    if (!fangs) return null;
    fangs.yaw = angle * 57.29578;   // EvokerFangsEntity ctor: setYaw(angle * (180/PI)), DEGREES
    fangs.clientTicksLeft = SP.FANGS_TICKS_LEFT;   // the client copy of `ticksLeft` (handleStatus side)
    fangs.playingAnimation = false;
    fangs.warmup = warmup;
    fangs.ticksLeft = SP.FANGS_TICKS_LEFT;
    fangs.startedAttack = false;
    fangs.owner = owner;
    return fangs;
  };

  /** `ConjureFangsGoal.castSpell()`, verbatim shape: close (<9 squared distance to target) ->
   *  a 5-fang inner ring (warmup 0) plus an 8-fang outer ring (warmup 3); far -> a 16-fang line
   *  toward the target, `1.25*(i+1)` apart, warmup `i`. */
  SP.castFangs = function (e, ctx) {
    var t = e.target;
    if (!t) return;
    var minY = Math.min(t.y, e.y);
    var maxY = Math.max(t.y, e.y) + 1.0;
    var baseAngle = Math.atan2(t.z - e.z, t.x - e.x);
    var dx = t.x - e.x, dy = (t.y === undefined ? e.y : t.y) - e.y, dz = t.z - e.z;
    var i, ang;
    if (dx * dx + dy * dy + dz * dz < 9.0) {
      for (i = 0; i < 5; i++) {
        ang = baseAngle + i * Math.PI * 0.4;
        SP.conjureFangs(e, ctx, e.x + Math.cos(ang) * 1.5, e.z + Math.sin(ang) * 1.5, minY, maxY, ang, SP.FANGS_WARMUP_CLOSE);
      }
      for (i = 0; i < 8; i++) {
        ang = baseAngle + i * Math.PI * 2.0 / 8.0 + Math.PI * 2.0 / 5.0;
        SP.conjureFangs(e, ctx, e.x + Math.cos(ang) * 2.5, e.z + Math.sin(ang) * 2.5, minY, maxY, ang, SP.FANGS_WARMUP_OUTER);
      }
    } else {
      for (i = 0; i < 16; i++) {
        var dist = 1.25 * (i + 1);
        SP.conjureFangs(e, ctx, e.x + Math.cos(baseAngle) * dist, e.z + Math.sin(baseAngle) * dist, minY, maxY, baseAngle, i);
      }
    }
  };

  SP.ConjureFangsGoal = function (e, ctx) {
    var g = new SP.CastSpellGoal(e, ctx, {
      spellId: SP.FANGS, spellTicks: 40, startTimeDelay: 100, castSpell: SP.castFangs,
      prepareSound: SP.EVOKER_SOUND.prepareAttack, castSound: SP.EVOKER_SOUND.cast
    });
    g.auditName = 'EvokerEntity.ConjureFangsGoal';   // tools/goalaudit.mjs: which jar inner class this CastSpellGoal is
    return g;
  };

  /** `EvokerFangsEntity.tick()`'s server half (warmup countdown, the ONE `warmup==-8` damage
   *  tick, `ticksLeft` discard) — 07i_entitylist.js's own `EL.tick()` does not know about this
   *  type-specific state machine (it is not a rostered `Ai.ROSTER` mob), so this is a free
   *  function a caller ticks per spawned fang, the same "reachable only from checks" standing
   *  `Rd.tick`'s own header already holds itself to (07s_raid.js) until a live caller exists. */
  SP.tickFangs = function (e, ctx) {
    if (!e || e.removed || e.dead) return;
    SP.tickFangsClient(e);   // the client half runs BEFORE the status is sent below: it counts from the NEXT tick
    e.warmup = (e.warmup === undefined ? 0 : e.warmup) - 1;
    if (e.warmup < 0) {
      if (e.warmup === -8) SP.fangsDamage(e, ctx);
      if (!e.startedAttack) { e.startedAttack = true; SP.fangsStatus4(e); }   // sendEntityStatus(4)
      e.ticksLeft = (e.ticksLeft === undefined ? SP.FANGS_TICKS_LEFT : e.ticksLeft) - 1;
      if (e.ticksLeft < 0) e.removed = true;           // discard()
    }
  };

  /** `EvokerFangsEntity.handleStatus(4)`: starts the animation and plays `entity.evoker_fangs.attack`
   *  (volume 1, pitch `rand*0.2+0.85`, the entity's own sound category — neutral for this type, see
   *  tools/golden/mob-sounds-1.18.2.tsv) unless silent. */
  SP.fangsStatus4 = function (e) {
    e.playingAnimation = true;
    if (e.silent || !NS.Sound || !NS.Sound.play) return false;
    return NS.Sound.play('entity.evoker_fangs.attack', { x: e.x, y: e.y, z: e.z, volume: 1, pitch: RNDFB() * 0.2 + 0.85, source: 'neutral' });
  };

  /** `EvokerFangsEntity.tick()`'s client branch: while playing, `ticksLeft--`, and on 14 twelve
   *  CRIT particles (`field_11205`) at the fang's feet, each with its own upward kick. */
  SP.tickFangsClient = function (e) {
    if (!e.playingAnimation) return;
    e.clientTicksLeft = (e.clientTicksLeft === undefined ? SP.FANGS_TICKS_LEFT : e.clientTicksLeft) - 1;
    if (e.clientTicksLeft !== 14 || !NS.Particle || !NS.Particle.spawn) return;
    var w = e.width || 0.5, r = RNDFB;
    for (var i = 0; i < 12; i++) {
      NS.Particle.spawn('crit',
        e.x + (r() * 2 - 1) * w * 0.5, e.y + 0.05 + r() + 1, e.z + (r() * 2 - 1) * w * 0.5,
        (r() * 2 - 1) * 0.3, 0.3 + r() * 0.3, (r() * 2 - 1) * 0.3);
    }
  };

  /** `EvokerFangsEntity.getAnimationProgress(tickDelta)`: 0 until the bite starts, then 0..1. */
  SP.fangsProgress = function (e, partial) {
    if (!e.playingAnimation) return 0;
    var t = (e.clientTicksLeft === undefined ? SP.FANGS_TICKS_LEFT : e.clientTicksLeft) - 2;
    return t <= 0 ? 1 : 1 - (t - partial) / 20;
  };

  /** `EvokerFangsEntityModel.setAngles`: jaw rolls (absolute, radians) and the shared pivotY lift
   *  (model units, subtracted from the rest 24), from the animation progress. */
  SP.fangsPose = function (progress) {
    var t = Math.min(progress * 2, 1);
    t = 1 - t * t * t;
    return { upperRoll: Math.PI - t * 0.35 * Math.PI, lowerRoll: Math.PI + t * 0.35 * Math.PI,
             lift: (progress + Math.sin(progress * 2.7)) * 0.6 * 12 };
  };

  /** `EvokerFangsEntityRenderer.render`'s scale: 2, shrinking to 0 over the last tenth. */
  SP.fangsScale = function (progress) { return progress > 0.9 ? 2 * (1 - progress) / 0.1 : 2; };

  /** `EvokerFangsEntity.damage()` — every living entity in `getBoundingBox().expand(0.2,0.0,
   *  0.2)`, skipping the owner's teammates (`SP.isTeammate`). */
  SP.ILLAGER_TYPES = { evoker: 1, vindicator: 1, pillager: 1, illusioner: 1 };   // EntityGroup.ILLAGER
  /** `EvokerEntity.isTeammate(target)` (same scoreboard team, else): self, a vex whose owner is a teammate, any illager. */
  SP.isTeammate = function (owner, t) {
    if (!t) return false;
    if (t === owner) return true;
    if (NS.Scoreboard && NS.Scoreboard.isTeammate(owner, t)) return true;
    if (t.type === 'vex') return !!t.owner && SP.isTeammate(owner, t.owner);
    return !!SP.ILLAGER_TYPES[t.type];
  };
  SP.fangsDamage = function (e, ctx) {
    var list = (ctx && ctx.entities) ? ctx.entities() : [];
    var Gm = NS.Gamemode;
    var hw = (e.width || 0.5) / 2 + 0.2;
    var loY = e.y, hiY = e.y + (e.height || 0.8);   // expand(0.2, 0.0, 0.2): no Y growth
    for (var i = 0; i < list.length; i++) {
      var target = list[i];
      if (!target || target === e || (e.owner && SP.isTeammate(e.owner, target))) continue;
      if (target.invulnerable) continue;
      if (target.dead || !(target.health > 0)) continue;
      // getNonSpectatingEntities + damage()'s isInvulnerableTo (creative players take no damage)
      if (target.spectator || (Gm && ((Gm.isSpectator && Gm.isSpectator(target)) || (Gm.isCreative && Gm.isCreative(target))))) continue;
      var thw = (target.width || 0.6) / 2;
      if (Math.abs(target.x - e.x) > hw + thw) continue;
      if (Math.abs(target.z - e.z) > hw + thw) continue;
      var ty0 = target.y, ty1 = target.y + (target.height || 1.8);
      if (ty1 <= loY || ty0 >= hiY) continue;   // Box.intersects is strict
      if (ctx && ctx.hurt) ctx.hurt(target, target.type === 'witch' ? SP.FANG_DAMAGE * 0.15 : SP.FANG_DAMAGE, { bypassArmor: true, source: 'magic', attacker: e.owner || undefined });   // DamageSource.magic: bypasses armour
    }
  };

  // ════════════════════════ IllusionerEntity$BlindTargetGoal / $GiveInvisibilityGoal ═══════
  // .decomp/net/minecraft/entity/mob/IllusionerEntity.java:229-300.
  SP.BLINDNESS_DURATION = 400;       // StatusEffectInstance(BLINDNESS, 400) — 20s
  SP.INVISIBILITY_DURATION = 1200;   // StatusEffectInstance(INVISIBILITY, 1200) — 60s

  /** KW-41 (s151): vanilla's own gate is `world.getLocalDifficulty(pos).isHarderThan(NORMAL.
   *  ordinal()=2)` (IllusionerEntity.java:229's own call site; `Difficulty.java:12`'s
   *  `field_5802("normal", 2)`; `LocalDifficulty.isHarderThan($$0)` is `localDifficulty > $$0`,
   *  .decomp/net/minecraft/world/LocalDifficulty.java:31) -- a REAL regional number (day clock +
   *  moon phase + global difficulty, `ServerWorld.getLocalDifficulty`), not "global difficulty
   *  is at least normal". The old collapse compared the global difficulty LEVEL INDEX instead
   *  (`idx > 1` -> normal/hard both passed unconditionally on tick 0), so a fresh normal-mode
   *  world blinded immediately; real local difficulty there is 1.5 (`2 * 0.75`, time/inhabited/
   *  moon terms all 0), which is NOT harder than 2 -- vanilla never blinds on a fresh normal
   *  world. `Eq.localDifficulty()` (07y_equip.js) already computes this exact real value for
   *  every other difficulty-scaled roll in this engine (armour, husk hunger, zombie
   *  reinforcements, phantom) -- reused here instead of re-deriving it. */
  SP.difficultyAboveEasy = function (e) {
    var Eq = NS.Equip;
    if (!Eq || typeof Eq.localDifficulty !== 'function') return false;   // no regional model yet -> vanilla default (fresh local difficulty is never > 2)
    return Eq.localDifficulty(Eq.at ? Eq.at(e) : undefined) > 2;   // IllusionerEntity.java:229, at getBlockPos()
  };

  SP.BlindTargetGoal = function (e, ctx) {
    var targetId = -1;
    var inner = new SP.CastSpellGoal(e, ctx, {
      spellId: SP.BLINDNESS, spellTicks: 20, startTimeDelay: 180,
      prepareSound: 'entity.illusioner.prepare_blindness', castSound: 'entity.illusioner.cast_spell',
      canUse: function () {
        if (!SP.difficultyAboveEasy(e)) return false;
        return !e.target || e.target.id !== targetId;
      },
      onStart: function () { targetId = e.target ? e.target.id : -1; },
      castSpell: function () {
        if (e.target && NS.Effects) NS.Effects.addStatusEffect(e.target, 'blindness', SP.BLINDNESS_DURATION, 0, false, true);
      }
    });
    this.canUse = inner.canUse;
    this.canContinueToUse = inner.canContinueToUse;
    this.start = inner.start;
    this.stop = inner.stop;
    this.tick = inner.tick;
  };

  SP.GiveInvisibilityGoal = function (e, ctx) {
    var inner = new SP.CastSpellGoal(e, ctx, {
      spellId: SP.DISAPPEAR, spellTicks: 20, startTimeDelay: 340,
      prepareSound: 'entity.illusioner.prepare_mirror', castSound: 'entity.illusioner.cast_spell',
      canUse: function () { return !(NS.Effects && NS.Effects.hasStatusEffect(e, 'invisibility')); },
      castSpell: function () {
        if (NS.Effects) NS.Effects.addStatusEffect(e, 'invisibility', SP.INVISIBILITY_DURATION, 0, false, true);
      }
    });
    this.canUse = inner.canUse;
    this.canContinueToUse = inner.canContinueToUse;
    this.start = inner.start;
    this.stop = inner.stop;
    this.tick = inner.tick;
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
