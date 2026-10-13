// 07zj_polarbear.js — Dan's scheduled parallel night, QUEUE row 0 item 0.2 (G18c: missing
// overworld mobs), branch loop/polarbear-s99: the POLAR BEAR, whole. Runs on: MAIN THREAD ONLY.
// No DOM.
//
// .decomp/net/minecraft/entity/passive/PolarBearEntity.java (352 lines) read whole this
// session; every citation below is that file unless a third file is named explicitly. Its own
// four inner classes (AttackGoal, PolarBearEscapeDangerGoal, PolarBearRevengeGoal,
// ProtectBabiesGoal) are all read in full and each has its own goal below — none of the
// existing 07k_goals.js primitives reproduces their exact per-mob overrides (the non-squared
// attack-reach formula, the baby-defers-and-calls-for-help revenge split, the halved
// getFollowRange protect-cub search), the same standing reason rabbit's own EatCarrotCropGoal
// lives in ITS file rather than 07k_goals.js (07zh_rabbit.js's own header).
//
// ⚠⚠ ANGER IS NOT REBUILT HERE. `PolarBearEntity implements Angerable` and its own
// `ANGER_TIME_RANGE` field is `TimeHelper.betweenSeconds(20, 39)` — the EXACT SAME range
// `IronGolemEntity`'s own `bin` (D-486, javap'd) already gave `Ai.ANGER_TIME_MIN`/`MAX` in
// 07k_goals.js, and target priority 5 (`new UniversalAngerGoal<>(this, false)`) is `Ai.
// UniversalAngerGoal` verbatim — `triggerOthers=false`, same as the golem's own call. This unit
// wires those two existing exports into the roster below rather than re-deriving the range a
// third time; `14j_combat.js:436`'s `e.angerTime > 0 && !e.target` decrement is ALREADY type-
// generic (not gated to wolf/iron_golem), so a polar bear's countdown runs the instant
// `e.angerTime` is non-zero with no touch to that file either.
//
// WHAT IS HERE, PER THE UNIT'S OWN SPEC —
//   1. `Pb.canSpawn`'s own rule lives in `Spawn.RULES.polar_bear` (07l_spawn.js), the SAME
//      split rabbit/bat/squid already use (placement logic inline in the spawn file, citing
//      this unit's own header) — see that file's own comment block for the two BlockTags names
//      read straight off `.decomp/net/minecraft/tag/BlockTags.java` (`field_35567` = literal
//      `"animals_spawnable_on"`, `field_35572` = literal
//      `"polar_bears_spawnable_on_in_frozen_ocean"`) and the two BiomeKeys read off `.decomp/
//      net/minecraft/world/biome/BiomeKeys.java` (`field_9435`="frozen_ocean",
//      `field_9418`="deep_frozen_ocean" — NOT frozen_river, a name this unit almost assumed
//      from memory instead of reading the literal).
//   2. `Pb.AttackGoal` — `PolarBearEntity.AttackGoal.attack` (lines 250-274) verbatim, including
//      its own `getSquaredMaxAttackDistance` override, which despite the inherited method's
//      name is NOT squared in the jar (`return (double)(4.0F + $$0.getWidth());`) — transcribed
//      as written, not "fixed" to look like the base class.
//   3. `Pb.EscapeDangerGoal` — `PolarBearEscapeDangerGoal.isInDanger` (lines 289-298) verbatim:
//      `getAttacker() != null && isBaby() || isOnFire()`. The base `EscapeDangerGoal` target
//      search (#1314: water within 5 when burning, else NoPenalty 5/4) is `Ai.PanicGoal` with
//      this `isInDanger` passed as `opts.inDanger`.
//   4. `Pb.RevengeGoal` — `PolarBearRevengeGoal.start`/`setMobEntityTarget` (lines 305-320)
//      reconstructed (the jar's base `RevengeGoal` class itself is not in `.decomp` — only its
//      two 1.18.2 subclasses, `SpitRevengeGoal`/`PolarBearRevengeGoal`, ever got pulled — so
//      this is read off the OVERRIDE's own two methods, not a second copy of `Ai.RevengeGoal`):
//      a baby that is hit sets no target of its own and instead sets EVERY non-baby polar bear
//      within earshot's target to the attacker (`callSameTypeForRevenge` + the `!isBaby` filter
//      `setMobEntityTarget` applies); an adult retaliates directly, same as any other RevengeGoal.
//   5. `Pb.ProtectBabiesGoal` — `ProtectBabiesGoal.canStart`/`getFollowRange` (lines 322-341)
//      verbatim: an adult with a cub within `.expand(8.0, 4.0, 8.0)` of itself may target the
//      nearest player within HALF its own `followRange` attribute.
//   6. `Pb.setWarning`/`isWarning`/`tickWarningAnim`/`getWarningAnimationProgress`/
//      `applyDimensions` — `isWarning`/`setWarning`/`tick`'s own client half (lines 195-210)/
//      `getWarningAnimationProgress`/`getDimensions` (lines 226-234), transcribed: the 0..6
//      ramp, ±1 per tick, and the box scaling `(1 + progress/6)` on HEIGHT only. This engine has
//      no client/server split (`world.isClient` always true here, there being exactly one
//      view) — the ramp runs every tick unconditionally, which is the ONLY branch vanilla's own
//      `tick()` has for it anyway.
//   7. `EL.DEFAULTS.polar_bear` (07i_entitylist.js) — the natural-spawn baby chance. `Passive
//      Entity.initialize`'s own `new PassiveEntity.PassiveData(1.0F)` (this class's own
//      `initialize` override, lines 243-248) means `babyChance` is a flat 1.0, not the 0.05
//      default every other `PassiveData(true)` animal gets — `spawnedCount > 0` (every polar
//      bear placed AFTER the first one in the SAME natural pack) is therefore ALWAYS a cub, not
//      "usually". `Pb.BABY_CHANCE` below carries that literal so a future re-read of the jar
//      finds the number named, not buried in a conditional.
//
// NOT HERE — `Pb.OWED`, at the bottom, names each gap; the summary —
//   - fox targeting is WIRED (#1312): `Ai.ROSTER.polar_bear` target priority 4.
//   - the warning growl plays through `MobVoice.emit` (07zzp_mobvoice.js); ambient/hurt/death/step
//     are MobVoice's own rows.
//   - `targetChangeCooldown` (vanilla's `ActiveTargetGoal`'s own 20-tick "don't flicker
//     targets" timer) is not modeled on `Pb.ProtectBabiesGoal`/the plain `Ai.AngryPlayerTarget
//     Goal` reused for target priority 3 — the same standing simplification `Ai.
//     NearestAttackableTargetGoal`'s own header already carries for iron golem (D-336 gap).

(function (NS) {
  'use strict';
  // rolls draw from the mob's own e.random (java.util.Random, #6437); FB only when no mob is in hand
  var FBP = new NS.JRandom(0x6437);
  var FBdP = function () { return FBP.nextFloat(); };
  function rf(e) { var r = e && e.random; return r ? function () { return r.nextFloat(); } : FBdP; }
  function ri(e, n) { return e && e.random ? e.random.nextInt(n) : FBP.nextInt(n); }

  var Pb = NS.PolarBear = {};

  Pb.OWED = [
    'ActiveTargetGoal\'s own targetChangeCooldown (20 ticks) is not modeled on ' +
      'Pb.ProtectBabiesGoal or the reused Ai.AngryPlayerTargetGoal — the same standing gap ' +
      'Ai.NearestAttackableTargetGoal\'s own header names for iron golem.'
  ];

  Pb.ready = true;

  // ── § ANGER — reused, not reimplemented (see file header) ─────────────────────────────────
  // `Ai.ROSTER.polar_bear` below wires `Ai.UniversalAngerGoal`/`Ai.AngryPlayerTargetGoal`
  // straight off 07k_goals.js; nothing in this file re-derives `Ai.ANGER_TIME_MIN`/`MAX`.

  // ── § BABY CHANCE — `PassiveEntity.initialize`'s own `new PassiveData(1.0F)` ───────────────
  Pb.BABY_CHANCE = 1.0;   // PolarBearEntity's own literal — every non-first pack member is a cub

  // ── § WARNING STATE ─────────────────────────────────────────────────────────────────────────
  Pb.WARNING_MAX = 6.0;   // `field_30352` — PolarBearEntity's own hard-coded 6.0F
  Pb.WARNING_SOUND_COOLDOWN = 40;   // `playWarningSound`'s own literal

  Pb.isWarning = function (e) { return !!e.warning; };
  Pb.setWarning = function (e, v) { e.warning = !!v; };

  /** `playWarningSound` (lines 165-170): 40-tick cooldown gate, then
   *  `playSound(entity.polar_bear.warning, 1.0F, getSoundPitch())` through MobVoice.emit. */
  Pb.playWarningSound = function (e) {
    if ((e.warningSoundCooldown | 0) <= 0) {
      if (NS.MobVoice && NS.MobVoice.emit) NS.MobVoice.emit(e, 'entity.polar_bear.warning', 1.0, NS.MobVoice.pitch(e));
      e.warningSoundCooldown = Pb.WARNING_SOUND_COOLDOWN;
    }
  };

  /** `tick()`'s client-only ramp (lines 195-210), run unconditionally — see file header ¶6. */
  Pb.tickWarningAnim = function (e) {
    if (e.warningAnimationProgress === undefined) e.warningAnimationProgress = 0;
    if (e.lastWarningAnimationProgress === undefined) e.lastWarningAnimationProgress = 0;
    e.lastWarningAnimationProgress = e.warningAnimationProgress;
    if (Pb.isWarning(e)) {
      e.warningAnimationProgress = Math.min(Pb.WARNING_MAX, e.warningAnimationProgress + 1);
    } else {
      e.warningAnimationProgress = Math.max(0, e.warningAnimationProgress - 1);
    }
    if (e.warningSoundCooldown > 0) e.warningSoundCooldown--;
  };

  /** `getWarningAnimationProgress(float)` (lines 231-233): lerp(partial, last, cur) / 6. */
  Pb.getWarningAnimationProgress = function (e, partial) {
    var p = partial === undefined ? 1 : partial;
    var a = e.lastWarningAnimationProgress || 0, b = e.warningAnimationProgress || 0;
    return (a + (b - a) * p) / Pb.WARNING_MAX;
  };

  /** `getDimensions(EntityPose)` (lines 226-234): the box height only is scaled by
   *  `1 + progress/6`; width is untouched. Baby scale (`Br.C.babyScale`, 07m_breed.js) is
   *  applied FIRST, the same order `super.getDimensions($$0).scaled(1, mult)` reads (the
   *  warning stretch is layered on top of whatever box the entity already has). Recomputed
   *  fresh off `NS.Entities.dimensions` every call, the same reason `Br.refreshDimensions`
   *  never accumulates a multiply onto a multiply. */
  Pb.applyDimensions = function (e) {
    var E = NS.Entities, Br = NS.Breed;
    var d = E && E.ready ? E.dimensions('polar_bear') : null;
    if (!d) return;
    var s = (Br && Br.isBaby && Br.isBaby(e)) ? ((Br.C && Br.C.babyScale) || 0.5) : 1;
    var mult = 1;
    if (e.warningAnimationProgress > 0) mult = 1 + (e.warningAnimationProgress / Pb.WARNING_MAX);
    e.width = d.width * s;
    e.height = d.height * s * mult;
  };

  /** `EL`'s own per-tick mob-AI slot (`07i_entitylist.js`, the SAME slot rabbit's `mobTick`/
   *  enderman's `mobTick`/squid's `tick` already run in) — animation ramp + dynamic hitbox,
   *  every tick, natural spawn or egg alike. */
  Pb.tick = function (e) {
    Pb.tickWarningAnim(e);
    Pb.applyDimensions(e);
  };

  function isBaby(x) {
    var Br = NS.Breed;
    return (Br && Br.isBaby) ? Br.isBaby(x) : !!x.isBaby;
  }

  // ── § ATTACK GOAL — `PolarBearEntity.AttackGoal` (lines 250-274), verbatim ─────────────────
  Pb.MELEE_SPEED = 1.25;         // `super(PolarBearEntity.this, 1.25, true)`
  Pb.ATTACK_COOLDOWN = 20;       // MeleeAttackGoal's own default attackIntervalTicks

  /** `getSquaredMaxAttackDistance` (lines 285-287) — NOT squared despite the name; see header. */
  Pb.attackMaxDist = function (target) {
    return 4.0 + ((target && target.width) || 0.6);
  };

  Pb.AttackGoal = function (e) {
    var st = { cd: 0, tx: 0, ty: 0, tz: 0, path: null, idx: 1 }, cooldown = 0;
    var lastUpdate = 0;   // MeleeAttackGoal.lastUpdateTime
    function alive() { var t = e.target; return !!t && !t.dead && !t.removed; }
    // `MeleeAttackGoal.canStart`: 20-tick gate, alive target, then a path or already in reach.
    this.canUse = function () {
      var now = e.age || 0;
      if (now - lastUpdate < 20) return false;
      lastUpdate = now;
      if (!alive()) return false;
      var t = e.target, Ai = NS.Ai;
      var p = Ai && Ai.findPath ? Ai.findPath(e.x, e.y, e.z, t.x, t.y, t.z, { mob: e }) : null;
      if (p) return true;
      var dy = (t.y === undefined ? e.y : t.y) - e.y;
      return Pb.attackMaxDist(t) >= (t.x - e.x) * (t.x - e.x) + dy * dy + (t.z - e.z) * (t.z - e.z);
    };
    // `MeleeAttackGoal.shouldContinue`: a target gone creative/spectator ends the goal.
    this.canContinueToUse = function () {
      if (!alive()) return false;
      var t = e.target, Gm = NS.Gamemode;
      if (t === NS.Player || t.type === 'player') {
        if (Gm && Gm.isSpectator && Gm.isSpectator(t)) return false;
        if (Gm && Gm.isCreative && Gm.isCreative(t)) return false;
      }
      return true;
    };
    this.start = function () { st.path = null; st.idx = 1; st.cd = 0; cooldown = 0; e.aggressive = true; };
    this.stop = function () { if (e.target && e.target.invulnerableGamemode) e.target = null; st.path = null; e.aggressive = false; Pb.setWarning(e, false); };
    this.tick = function () {
      if (!e.target) return;
      var t = e.target;
      if (cooldown > 0) cooldown--;
      var cooledDown = cooldown <= 0;
      var dx = t.x - e.x, dy = (t.y === undefined ? e.y : t.y) - e.y, dz = t.z - e.z;
      var distSq = dx * dx + dy * dy + dz * dz;
      var maxD = Pb.attackMaxDist(t);
      // `attack(LivingEntity, double)` (lines 251-274) verbatim three-way split:
      if (distSq <= maxD && cooledDown) {
        cooldown = Pb.ATTACK_COOLDOWN;
        if (NS.Combat && NS.Combat.mobAttack) NS.Combat.mobAttack(e, t);
        Pb.setWarning(e, false);
      } else if (distSq <= maxD * 2.0) {
        if (cooledDown) { Pb.setWarning(e, false); cooldown = Pb.ATTACK_COOLDOWN; }
        if (cooldown <= 10) { Pb.setWarning(e, true); Pb.playWarningSound(e); }
      } else {
        cooldown = Pb.ATTACK_COOLDOWN;
        Pb.setWarning(e, false);
      }
      // MeleeAttackGoal.tick's look + repath cadence (#4428): shared `Ai.meleeNavTick`; the path is
      // followed until it ends, never dropped within reach (vanilla does not).
      var Ai = NS.Ai;
      if (!Ai) return;
      Ai.meleeNavTick(e, t, st, distSq, false, rf(e));
      if (st.path && st.idx < st.path.length) {
        Ai.stepToward(e, st.path[st.idx], Pb.MELEE_SPEED);
        if (Ai.closeTo(e, st.path[st.idx])) st.idx++;
      }
    };
  };

  // ── § ESCAPE DANGER — `PolarBearEscapeDangerGoal.isInDanger` (lines 289-298) ───────────────
  Pb.ESCAPE_SPEED = 2.0;   // `super(PolarBearEntity.this, 2.0)`

  Pb.EscapeDangerGoal = function (e) {
    var Ai = NS.Ai;
    // `getAttacker() != null && isBaby() || isOnFire()` — Java operator precedence: `&&` binds
    // tighter than `||`, so this is `(attacker && baby) || onFire`. The target search (water within 5
    // when burning, else FuzzyTargeting 5/4) is `Ai.PanicGoal`'s own EscapeDangerGoal port, with this isInDanger.
    function inDanger() { return (!!(NS.Fly ? NS.Fly.attackerOf(e) : e.lastHurtByEntity) && isBaby(e)) || !!e.isOnFire; }
    var base = Ai ? new Ai.PanicGoal(e, Pb.ESCAPE_SPEED, { inDanger: inDanger }) : null;
    this.inDanger = inDanger;
    this.start = function () { if (base) base.start(); };
    this.stop = function () { if (base) base.stop(); };
    this.tick = function () { if (base) base.tick(); };
    this.canContinueToUse = function () { return base ? base.canContinueToUse() : false; };
    this.canUse = function () { return base ? base.canUse() : inDanger(); };
  };

  // ── § REVENGE — `PolarBearRevengeGoal` (lines 305-320); see file header ¶4 for why this is
  // reconstructed rather than composed with `Ai.RevengeGoal` ────────────────────────────────
  Pb.RevengeGoal = function (e, ctx) {
    var lastSeen = -1;
    this.canUse = function () {
      var seq = e.hurtSeq || 0;
      if (seq <= lastSeen) return false;
      return !!e.lastHurtByEntity && NS.Ai.canTargetLiving(e.lastHurtByEntity, e);   // #4413 RevengeGoal.canTrack
    };
    this.canContinueToUse = function () { return !!e.target && NS.Ai.canTargetLiving(e.target, e); };
    this.start = function () {
      var attacker = e.lastHurtByEntity;
      lastSeen = e.hurtSeq || 0;
      if (isBaby(e)) {
        // `callSameTypeForRevenge()` then `this.stop()` — every ADULT polar bear (`setMobEntityTarget`'s
        // own `!isBaby` filter) inside `Box.from(pos).expand(followRange, 10, followRange)` that has
        // no target yet is told to hunt the attacker; the cub never fights back itself.
        var Ai = NS.Ai, fr = (Ai && Ai.followRangeOf) ? Ai.followRangeOf(e) : 20;
        if (ctx && ctx.animals) {
          var mates = ctx.animals();
          for (var i = 0; i < mates.length; i++) {
            var o = mates[i];
            if (!o || o === e || o.target || o.removed || isBaby(o)) continue;
            if (!Ai.canTargetLiving(attacker, o)) continue;   // #4413 canTrack per mate
            if (Math.abs(o.x - e.x) > fr || Math.abs(o.z - e.z) > fr || Math.abs(o.y - e.y) > 10) continue;
            o.target = attacker;
          }
        }
        e.target = null;
        return;
      }
      e.target = attacker;
    };
    this.stop = function () { e.target = null; };
    this.tick = function () {};
  };

  // ── § PROTECT BABIES — `ProtectBabiesGoal.canStart`/`getFollowRange` (lines 322-341) ───────
  Pb.PROTECT_BOX = { dx: 8.0, dy: 4.0, dz: 8.0 };   // `.expand(8.0, 4.0, 8.0)`

  Pb.ProtectBabiesGoal = function (e, ctx) {
    var players = (ctx && ctx.players) || function () { return []; };
    var Ai = NS.Ai;
    // `ActiveTargetGoal(…, reciprocalChance 20, mustSee true, …)`: reducedTickDelay(20)=10 per goal
    // selection, run every other tick -> 1/20 per tick here (same conversion as Ai.NearestAttackable-
    // TargetGoal). `ctx.rand` is a test seam.
    var rrand = (ctx && ctx.rand) || rf(ctx && ctx.e);
    function overlap(a, b, dx, dy, dz) {   // a.getBoundingBox().expand(dx,dy,dz) ∩ b.getBoundingBox()
      var bw = (b.width || 0.6) / 2, aw = (a.width || 0.6) / 2;
      if (Math.abs(a.x - b.x) >= aw + dx + bw) return false;
      if (Math.abs(a.z - b.z) >= aw + dz + bw) return false;
      return a.y - dy < b.y + (b.height || 1.8) && a.y + (a.height || 1.8) + dy > b.y;
    }
    function hasNearbyCub() {
      var EL = NS.EntityList;
      if (!EL) return false;
      var box = Pb.PROTECT_BOX;
      for (var i = 0; i < EL.list.length; i++) {
        var o = EL.list[i];
        if (o.type !== 'polar_bear' || o.removed || !isBaby(o)) continue;
        if (overlap(e, o, box.dx, box.dy, box.dz)) return true;
      }
      return false;
    }
    function followRange() {
      var fr = (Ai && Ai.followRangeOf) ? Ai.followRangeOf(e) : 0;
      return fr * 0.5;   // `getFollowRange()` override: `super.getFollowRange() * 0.5`
    }
    this.canUse = function () {
      if (isBaby(e)) return false;
      if (rrand() >= 1 / 20) return false;   // ActiveTargetGoal.canStart's reciprocalChance roll
      var fr = followRange();
      if (!(fr > 0)) return false;
      var ps = players();
      var best = null, bestD = Infinity;
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (!overlap(e, p, fr, 4, fr)) continue;                    // getSearchBox: expand(range, 4, range)
        if (Ai && Ai.canTargetLiving && !Ai.canTargetLiving(p, e)) continue;   // not creative/spectator
        if (Ai && Ai.canSee && !Ai.canSee(e, p)) continue;          // TargetPredicate visibility
        var d = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z);
        if (d <= fr && d < bestD) { best = p; bestD = d; }
      }
      if (!best) return false;
      if (!hasNearbyCub()) return false;
      e.target = best;
      return true;
    };
    this.canContinueToUse = function () {
      if (!e.target) return false;
      var d = Math.hypot(e.target.x - e.x, e.target.y - e.y, e.target.z - e.z);
      return d <= followRange() * 1.5;   // same leash-slack approximation Ai.NearestAttackable-
    };                                    // TargetGoal's own header already names (D-336 gap).
    this.start = function () {};
    this.stop = function () { e.target = null; };
    this.tick = function () {};
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
