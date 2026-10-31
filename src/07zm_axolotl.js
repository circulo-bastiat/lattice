// 07zm_axolotl.js — loop/panda-axolotl-s101 (QUEUE 0.2 G18c, missing overworld mob): the
// AXOLOTL, whole. Runs on: MAIN THREAD ONLY. No DOM.
//
// Everything below is read off `.decomp/net/minecraft/entity/passive/AxolotlEntity.java` (634
// lines) and `.decomp/net/minecraft/entity/passive/AxolotlBrain.java` (179 lines), BOTH read in
// full this session, unless a comment says otherwise. Dimensions ([0.75, 0.42]), the three
// attributes (MAX_HEALTH 14.0, MOVEMENT_SPEED 1.0, ATTACK_DAMAGE 2.0 — `createAxolotlAttributes`)
// and the breeding food (`#minecraft:axolotl_tempt_items` — tropical_fish_bucket, a TAG, not an
// item list) are NOT re-declared here: they come out of the jar-bytecode-extracted entity table
// generically (`NS.Entities.attrsOf('axolotl')`/`NS.Entities.breedFood('axolotl')`), the same "a
// constant here would be a D-263" standing every prior QUEUE 0.2 mob's own header states —
// `axolotlcheck` asserts those rows directly against `assets/entities.json`.
//
// #1034: THE FIGHT ACTIVITY IS NOW PORTED (§ FIGHT below, off AxolotlAttackablesSensor.java, which IS in
// .decomp); the header paragraphs below that say no Sensor source exists are stale.
//
// ⚠⚠ **AXOLOTL IS `Brain`-DRIVEN, NOT `GoalSelector`-DRIVEN — AND THIS ENGINE ONLY HAS THE
// LATTER**, the exact standing gap `07zj_goat.js`'s own header names for `GoatBrain`. Unlike
// goat, axolotl's own Sensor-driven pieces (`AxolotlAttackablesSensor`'s hostile-target list,
// `NearestLivingEntitySensor`) have NO decompiled SOURCE in this worktree at all (`.decomp` has
// `AxolotlEntity.java`/`AxolotlBrain.java` only — no Sensor subclass files) — so unlike goat's
// RAM/LONG_JUMP activities (ported from a fully-read source), axolotl's FIGHT activity
// (`RangedApproachTask`/`MeleeAttackTask`, its own hostile-target list) is named on `Ax.OWED`
// RATHER THAN GUESSED, not ported at all: inventing a target list this file has no jar text for
// would be exactly the "a constant here would be a D-263" mistake this file's OWN header above
// refuses to make for a number it DOES have. What IS ported, off `AxolotlBrain`'s fully-read
// IDLE activity: wander (`Ax.WanderGoal`, a bespoke straight-line-stepToward approximation of
// `AmphibiousPathNodeMaker`'s real pathfinding, the SAME kind of simplification `Gt.RamGoal`'s
// own header names for its own straight-line charge), tempt/breed/follow-parent (the SAME
// generic goals every other rostered animal already uses, off the real tag-based tempt food),
// and `FollowMobTask(PLAYER, 6.0F)` (idle player-following) — named on `Ax.OWED`, the identical
// "no FollowMobTask equivalent exists in this codebase for ANY mob" gap `Gt.OWED` already names
// for goat's own `FollowMobTask(HORSE,...)`.
//
// WHAT IS HERE, PER THE UNIT'S OWN SPEC:
//   1. `Spawn.RULES.axolotl` (07l_spawn.js's own one-line hook) — `AxolotlEntity.canSpawn`
//      (static overload), verbatim: `#minecraft:axolotls_spawnable_on` below, NO light check
//      (§ SPAWN, wired in 07l_spawn.js directly)
//   2. `Ax.Variant`/`Ax.SKIN`/`Ax.skinKey` — the five variants (lucy/wild/gold/cyan/blue), the
//      natural-vs-unnatural split, and the texture-family picker `AxolotlEntityRenderer` would
//      read (§ VARIANT)
//   3. `Ax.randomNaturalVariant`/`Ax.createChild` — the natural spawn roll and the breeding
//      inheritance (50/50 a parent's variant, 1/1200 mutates to the one unnatural variant,
//      blue) (§ VARIANT)
//   4. `Ax.onDamaged`/`Ax.tickPlayDead` — the play-dead trigger (`damage()`'s own
//      random.nextInt(3)==0 && (nextInt(3)<amount || health/maxHealth<0.5) && amount<health &&
//      touching-water gate) and its 200-tick countdown (§ PLAY DEAD)
//   5. `Ax.buffPlayer` — the Regeneration/Poison-clear buff (`buffPlayer`, verbatim); the
//      TRIGGER (`appreciatePlayer`'s own "this axolotl's hunted target died to a nearby player"
//      condition) needs the FIGHT-activity target substrate named unbuilt above, so this
//      function is real and unit-tested but has no live caller yet (§ PLAY DEAD)
//   6. `Ax.WanderGoal`/`Ai.ROSTER.axolotl` (07k_goals.js) — the goal-substrate port (§ GOALS)
//   7. bucketing — `axolotl_bucket` capture/release, `14l_use.js`'s own two new branches (this
//      unit's own registration lines, § BUCKET, wired directly in that file)
//   8. breeding: `Breed.CHILD.axolotl`/`Breed.SPECIAL.axolotl` removed (07m_breed.js, this
//      unit's own registration line)
//   9. `EL.motionFor('axolotl')`/`EL.DEFAULTS.axolotl` (07i_entitylist.js, this unit's own
//      registration lines)
//
// NOT HERE (this unit's own OWED, at the bottom, `Ax.OWED`):
//   - the FIGHT activity (`RangedApproachTask`/`MeleeAttackTask`, its own hostile-target list)
//     — no decompiled Sensor source exists in this worktree to read the real target list off;
//     inventing one would be a guess, not a port (this file's own header, above).
//   - `Ax.buffPlayer`'s own TRIGGER (`appreciatePlayer`: this axolotl's hunted-and-killed
//     target died to a player within 20 blocks) — downstream of the FIGHT-activity gap above;
//     the buff itself is real and callable, just never called by anything yet.
//   - `FollowMobTask(PLAYER, 6.0F)` (idle player-following) — no `FollowMobTask` equivalent
//     exists in this codebase for ANY mob yet (`Gt.OWED`'s own standing gap, goat).
//   - the real `AmphibiousPathNodeMaker`/`SwimNavigation` pathfinding — `Ax.WanderGoal` walks
//     straight at a random nearby point instead (`Gt.RamGoal`'s own straight-line precedent).
//   - the real per-tick amphibious `travel()` (direct `updateVelocity`+`move`+`*0.9` drag while
//     submerged, standard gravity/drag on land) — `EL.motionFor('axolotl')`'s own header
//     (07i_entitylist.js) already names this: the plain-MobEntity fallback applies uniformly.
//   - (struck D-649: `hydrateFromPotion`/`tickAir`/`getMaxAir` are real, § AIR below.)
//   - the real `AxolotlData`/pack-of-two-candidate-variants natural-spawn roll — one
//     independent `Ax.randomNaturalVariant` roll per placement instead (`EL.DEFAULTS.axolotl`'s
//     own header, 07i_entitylist.js).
//   - every sound, `getModelAngles`/the per-part angle map (`AngledModelEntity`, a render-only
//     axolotl-specific interface no mob's render path in this engine reads), `squaredAttackRange`
//     (downstream of the FIGHT-activity gap above).
//   - bucket NBT beyond the variant this file's own `14l_use.js` registration line preserves
//     (age/breeding-cooldown, the `HuntingCooldown` memory) — `Use.swapHeld`'s own generic
//     bucket-swap has no NBT substrate at all; a captured axolotl always re-releases as an
//     adult with the SAME variant it had, nothing else.

(function (NS) {
  'use strict';
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6438)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = new NS.JRandom(0x6438); return fbR.nextDouble(); }

  var Ax = NS.Axolotl = {};

  Ax.OWED = [
    // struck #5736: FollowMobTask(PLAYER, 6) TimeLimitedTask(30..60) = Ax.TimedLookGoal; RangedApproachTask speed = Ax.approachSpeed.
    // struck #5581: AmphibiousPathNodeMaker land<->water node types (Ax.nodeType/Ax.amphibiousPath). #6431: 8 horizontal diagonals with LandPathNodeMaker.isValidDiagonalSuccessor corner test; the 0.75x0.42 box is one cell, so the cell test is the box test.
    // struck D-649: tickAir/hydrateFromPotion/getMaxAir (Ax § AIR).
    'getModelAngles/the per-part angle map ' +
      '(AngledModelEntity, a render-only interface no mob\'s render path in this engine reads).',
    'the sensor\'s 20-tick NearestVisibleLivingEntitySensor cadence is kept (FIGHT approach uses Ax.navStep + Ax.approachSpeed, #5736).'
  ];

  Ax.ready = true;

  // ── § VARIANT — `AxolotlEntity.Variant` (.decomp lines ~590-625), verbatim ─────────────────
  Ax.Variant = { LUCY: 0, WILD: 1, GOLD: 2, CYAN: 3, BLUE: 4 };
  Ax.VARIANT_NAMES = ['lucy', 'wild', 'gold', 'cyan', 'blue'];
  Ax.VARIANT_NATURAL = [true, true, true, true, false];   // only blue(4) is NOT natural
  Ax.NATURAL_VARIANTS = [0, 1, 2, 3];
  Ax.UNNATURAL_VARIANTS = [4];

  Ax.variantName = function (id) { return Ax.VARIANT_NAMES[id | 0] || Ax.VARIANT_NAMES[0]; };

  // `AxolotlEntityRenderer`'s own `String.format("textures/entity/axolotl/axolotl_%s.png",
  // getName())` (.decomp AxolotlEntity.java's own header comment) -- `tools/
  // extract-mob-textures.mjs`'s own `axolotl:` family entry already bakes these five sheets in
  // Variant ordinal order (D-527, that file's own header), so the index lines up directly with
  // `Ax.Variant` with no remapping.
  Ax.SKIN = ['axolotl', 'axolotl#1', 'axolotl#2', 'axolotl#3', 'axolotl#4'];
  Ax.skinKey = function (e) {
    if (!e || NS.Entities.bare(e.type) !== 'axolotl') return null;
    return Ax.SKIN[e.axolotlVariant | 0] || Ax.SKIN[0];
  };

  /** `Variant.getRandomNatural(Random)` (.decomp lines ~627-629): uniform over the four
   *  natural variants. Wired as `EL.DEFAULTS.axolotl` (07i_entitylist.js). */
  Ax.randomNaturalVariant = function (rnd) {
    rnd = rnd || RNDFB;
    return Ax.NATURAL_VARIANTS[Math.floor(rnd() * Ax.NATURAL_VARIANTS.length)];
  };
  /** `Variant.getRandomUnnatural(Random)` — trivial today (blue is the only member) but kept
   *  as its own function rather than a hardcoded 4, matching the jar's own generality. */
  Ax.randomUnnaturalVariant = function (rnd) {
    rnd = rnd || RNDFB;
    return Ax.UNNATURAL_VARIANTS[Math.floor(rnd() * Ax.UNNATURAL_VARIANTS.length)];
  };

  Ax.BLUE_BABY_CHANCE = 1200;   // `BLUE_BABY_CHANCE` (.decomp line 98), verbatim

  /** `shouldBabyBeDifferent` (.decomp lines 213-215) + `createChild` (.decomp lines 259-274),
   *  verbatim: 1/1200 mutates the child to the one unnatural variant (blue) outright; otherwise
   *  a straight coin flip onto one parent's own variant. Wired as `Breed.CHILD.axolotl`
   *  (07m_breed.js, this unit's own registration line). */
  Ax.createChild = function (child, a, b, rand) {
    rand = rand || RNDFB;
    if (rand() < 1 / Ax.BLUE_BABY_CHANCE) {
      child.axolotlVariant = Ax.randomUnnaturalVariant(rand);
    } else {
      child.axolotlVariant = (rand() < 0.5) ? (a.axolotlVariant | 0) : (b.axolotlVariant | 0);
    }
    child.persistent = true;   // vanilla createChild: child.setPersistent()
  };

  // ── § PLAY DEAD — `AxolotlEntity.damage()`'s own trigger (.decomp lines 335-347) +
  // `PLAY_DEAD_TICKS` (.decomp line 68) ───────────────────────────────────────────────────────
  Ax.PLAY_DEAD_TICKS = 200;

  /**
   * `damage(DamageSource, float)`'s own FIRST half, verbatim: `!world.isClient &&
   * !isAiDisabled() && random.nextInt(3)==0 && (random.nextInt(3) < amount ||
   * health/maxHealth < 0.5F) && amount < health && isTouchingWater() && (getAttacker()!=null ||
   * getSource()!=null) && !isPlayingDead()`. `isAiDisabled()`/the attacker-or-source half both
   * fold to "always true" here — neither an AI-disabled flag nor a sourceless-damage path
   * exists on this engine's mobs yet (every `Cb.hurt` caller is either a player's melee swing
   * or a mob's own attack goal, both real entities). Called from `Cb.hurt` (14j_combat.js,
   * this unit's own registration line) BEFORE health is decremented, so `health`/`maxHealth`
   * here are the values immediately before this hit lands, matching the jar's own read order
   * (`float $$0 = this.getHealth();` at the top of the override, .decomp line 336).
   */
  Ax.onDamaged = function (e, amount, rand) {
    if (!e || e.type !== 'axolotl') return false;
    if (e.playingDead) return false;
    if (!e.inWater) return false;
    if (!(amount > 0) || !(amount < (e.health || 0))) return false;
    rand = rand || RNDFB;
    if (Math.floor(rand() * 3) !== 0) return false;
    var maxHp = e.maxHealth || 14;
    var lowHealth = (e.health / maxHp) < 0.5;
    if (!(Math.floor(rand() * 3) < amount) && !lowHealth) return false;
    e.playingDead = true;
    e.playDeadTicks = Ax.PLAY_DEAD_TICKS;
    // PlayDeadTask.run: addStatusEffect(Regeneration, 200, 0) (forgets WALK_TARGET/LOOK_TARGET too)
    var ES = NS.Effects;
    if (ES && ES.addStatusEffect) ES.addStatusEffect(e, 'regeneration', Ax.PLAY_DEAD_TICKS, 0);
    e.path = null; e.walkTarget = null; e.lookTarget = null;
    return true;
  };

  /** `PlayDeadTask`'s own countdown (a `Brain` task in the real jar; this engine has no Brain
   *  substrate, so the countdown is a plain per-tick decrement instead, wired as part of
   *  `Ai.ROSTER.axolotl`'s own per-tick housekeeping, 07k_goals.js). */
  Ax.tickPlayDead = function (e) {
    if (e && e.huntingCooldown > 0) e.huntingCooldown--;
    if (!e || !e.playingDead) return;
    if (e.breedTarget) { e.playingDead = false; e.playDeadTicks = 0; return; }   // ForgetTask(hasBreedTarget, PLAY_DEAD)
    e.playDeadTicks = (e.playDeadTicks | 0) - 1;
    // PlayDeadTask stops out of water, but only PlayDeadTimerTask's memory expiry ends playingDead
    if (e.playDeadTicks <= 0) { e.playingDead = false; e.playDeadTicks = 0; }
  };

  // ── § AIR — D-649: `AxolotlEntity.baseTick`/`tickAir`/`hydrateFromPotion`/`getMaxAir`
  // (.decomp passive/AxolotlEntity.java:180-209). Out of water (and rain) the air counts down
  // one a tick from 6000; at -20 it resets to 0 and the axolotl takes 2.0 DRYOUT (a plain
  // source: armour applies); wet, it snaps back to 6000. `baseTick` captures the air BEFORE
  // LivingEntity's own breath step and `tickAir` overwrites from that, so the generic step never
  // shows. A splash water bottle adds 1800 (capped). ──────────────────────────────────────────
  Ax.MAX_AIR = 6000;           // getMaxAir()
  Ax.DRYOUT_AT = -20;          // getAir() == -20
  Ax.DRYOUT_DAMAGE = 2.0;      // DamageSource.DRYOUT, 2.0F
  Ax.HYDRATE_AIR = 1800;       // hydrateFromPotion's own + 1800
  /** `Entity.isWet()` = touching water || rained on || in a bubble column (no bubble columns here). */
  Ax.isWet = function (e) {
    return !!e.inWater || !!(NS.Sky && NS.Sky.isEntityRainedOn && NS.Sky.isEntityRainedOn(e));
  };
  Ax.tickAir = function (e) {
    if (!e || e.removed) return;
    if (e.air === undefined) e.air = Ax.MAX_AIR;
    if (!e.dead && e.health > 0 && !Ax.isWet(e)) {
      e.air = e.air - 1;
      if (e.air === Ax.DRYOUT_AT) {
        e.air = 0;
        var Cb = NS.Combat;
        if (Cb && Cb.hurt) Cb.hurt(e, Ax.DRYOUT_DAMAGE, undefined, false, { source: 'dryout' });
      }
    } else {
      e.air = Ax.MAX_AIR;
    }
  };
  Ax.hydrateFromPotion = function (e) {
    if (e.air === undefined) e.air = Ax.MAX_AIR;
    e.air = Math.min(e.air + Ax.HYDRATE_AIR, Ax.MAX_AIR);
  };

  // ── § BUFF — `buffPlayer` (.decomp lines 419-427), verbatim ────────────────────────────────
  Ax.REGEN_ADD_DURATION = 100;      // the flat `100 +` this call adds each time
  Ax.REGEN_MAX_DURATION = 2400;     // MAX_REGENERATION_BUFF_DURATION, the cap this adds up to
  Ax.buffPlayer = function (P) {
    var ES = NS.Effects;
    if (!ES || !ES.ready || !P) return false;
    var cur = ES.getStatusEffect(P, 'regeneration');
    var curDuration = cur ? cur.duration : 0;
    var next = Math.min(Ax.REGEN_MAX_DURATION, Ax.REGEN_ADD_DURATION + curDuration);
    if (curDuration < Ax.REGEN_MAX_DURATION) {
      ES.addStatusEffect(P, 'regeneration', next, 0, false, true);
    }
    ES.removeStatusEffect(P, 'mining_fatigue');
    return true;
  };

  // ── § GOALS — `AxolotlBrain.addIdleActivities`'s wander half (.decomp lines 96-134), folded
  // onto ONE bespoke `GoalSelector` goal (this file's own header explains why: no Brain
  // substrate to split CORE/IDLE/FIGHT/PLAY_DEAD activities across) ─────────────────────────
  // ── § FIGHT — `AxolotlAttackablesSensor` + `AxolotlBrain.addFightActivities` (.decomp, read in
  // full) + `AxolotlEntity.tryAttack/squaredAttackRange/appreciatePlayer`. Tags are the jar's
  // `entity_types/axolotl_always_hostiles.json` / `axolotl_hunt_targets.json`. ────────────────
  Ax.ALWAYS_HOSTILE = { drowned: 1, guardian: 1, elder_guardian: 1 };
  Ax.HUNT_TARGETS = { tropical_fish: 1, pufferfish: 1, salmon: 1, cod: 1, squid: 1, glow_squid: 1 };
  Ax.SENSE_RANGE_SQ = 64;          // isInRange: squaredDistanceTo <= 64.0
  Ax.HUNTING_COOLDOWN = 2400;      // remembered when FIGHT is left
  Ax.ATTACK_INTERVAL = 20;         // MeleeAttackTask(20)
  Ax.APPROACH_SPEED_WATER = 0.6;   // getTargetApproachingSpeed
  Ax.APPROACH_SPEED_LAND = 0.15;
  Ax.BUFF_RANGE = 20;              // appreciatePlayer's box expand(20.0)
  Ax.squaredAttackRange = function (t) { return 1.5 + ((t && t.width) || 0.6) * 2; };

  /** `AxolotlAttackablesSensor.matches` for candidate `t` seen by axolotl `e`. */
  Ax.canTarget = function (e, t) {
    if (!t || t === e || t.dead || t.removed || !t.inWater) return false;
    var dx = t.x - e.x, dy = t.y - e.y, dz = t.z - e.z;
    if (dx * dx + dy * dy + dz * dz > Ax.SENSE_RANGE_SQ) return false;
    var ty = NS.Entities.bare ? NS.Entities.bare(t.type) : t.type;
    if (!(Ax.ALWAYS_HOSTILE[ty] || (!(e.huntingCooldown > 0) && Ax.HUNT_TARGETS[ty]))) return false;
    if (NS.Ai.canTargetLiving && !NS.Ai.canTargetLiving(t, e)) return false;
    return !NS.Ai.canSee || NS.Ai.canSee(e, t);
  };

  /** `AxolotlEntity.appreciatePlayer`: the hunted target died to a player within 20 blocks. */
  Ax.appreciatePlayer = function (e, t) {
    var P = NS.Player;
    if (!t || !t.dead || !P || t.lastAttacker !== P) return false;
    if (Math.abs(P.x - e.x) > Ax.BUFF_RANGE + 0.45 || Math.abs(P.y - e.y) > Ax.BUFF_RANGE + 0.9 ||
        Math.abs(P.z - e.z) > Ax.BUFF_RANGE + 0.45) return false;
    return Ax.buffPlayer(P);
  };

  /** FIGHT activity: sensor every 20 ticks, RangedApproachTask, MeleeAttackTask(20),
   *  cooldown of 2400 on leaving FIGHT. Runs on the goal selector's TARGET+MOVE slots. */
  Ax.FightGoal = function (e, ctx) {
    ctx = ctx || {};
    var sense = 0, atk = 0, nav = {};
    this.canUse = function () {
      if (e.playingDead || e.breedTarget) return false;   // getAttackTarget: empty while hasBreedTarget
      if (e.target && e.target.type !== undefined && !e.target.dead && e.target.inWater) return true;
      if (--sense > 0) return false;
      sense = 20;
      var all = ctx.entities ? ctx.entities() : [], best = null, bd = Infinity;
      for (var i = 0; i < all.length; i++) {
        var c = all[i];
        if (!Ax.canTarget(e, c)) continue;
        var d = (c.x - e.x) * (c.x - e.x) + (c.y - e.y) * (c.y - e.y) + (c.z - e.z) * (c.z - e.z);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best) return false;
      e.target = best;
      return true;
    };
    this.canContinueToUse = function () {
      if (e.playingDead || e.breedTarget || !e.target || e.removed) return false;
      if (e.target.dead) { Ax.appreciatePlayer(e, e.target); return false; }   // ForgetAttackTargetTask
      return !e.target.removed;
    };
    this.start = function () { atk = 0; };
    this.stop = function () {
      if (e.target) e.target = null;
      e.huntingCooldown = Ax.HUNTING_COOLDOWN;
    };
    this.tick = function () {
      var t = e.target;
      if (!t) return;
      var dx = t.x - e.x, dy = t.y - e.y, dz = t.z - e.z;
      if (atk > 0) atk--;
      if (dx * dx + dy * dy + dz * dz <= Ax.squaredAttackRange(t)) {
        if (atk <= 0) {
          atk = Ax.ATTACK_INTERVAL;
          if (NS.EntityRender && NS.EntityRender.swingHand) NS.EntityRender.swingHand(e);
          // AxolotlEntity.tryAttack: entity.axolotl.attack (1, 1) on a landed hit
          if (NS.Combat && NS.Combat.mobAttack && NS.Combat.mobAttack(e, t) && NS.MobVoice) NS.MobVoice.emit(e, 'entity.axolotl.attack', 1, 1);
        }
      } else if (NS.Ai && NS.Ai.stepToward) {
        Ax.navStep(e, nav, Math.floor(t.x), t.y, Math.floor(t.z), Ax.approachSpeed(e));
      }
    };
  };

  Ax.WANDER_H = 10; Ax.WANDER_V = 7;            // StrollTask(0.15F, false): FuzzyTargeting.find(mob, 10, 7)
  Ax.AQUATIC_LADDER = [[1, 1], [3, 3], [5, 5], [6, 5], [7, 7], [10, 7]];   // AquaticStrollTask.NORMALIZED_POS_MULTIPLIERS
  Ax.WAIT_WATER = [30, 60]; Ax.WAIT_GROUND = [200, 400];   // WaitTask(30,60) in water / WaitTask(200,400) on ground
  Ax.WANDER_SPEED_WATER = 0.5;    // `getIdleSpeed`/`AquaticStrollTask` own in-water speed
  Ax.WANDER_SPEED_LAND = 0.15;    // its own on-land speed

  /** `AmphibiousPathNodeMaker.getDefaultNodeType` + `init`'s malus (.decomp): water next to a BLOCKED cell is WATER_BORDER
   *  (penalty 4), other water WATER (0), standable land WALKABLE (6); air over water is the breach OPEN node (penalty 0);
   *  everything else BLOCKED (-1). `Ax.NODE_PENALTY` is the table the check swaps to prove the types matter. */
  Ax.NODE_PENALTY = { WATER: 0, WATER_BORDER: 4, WALKABLE: 6, OPEN: 0 };
  Ax.nodeType = function (x, y, z) {
    var Ai = NS.Ai, T = Ai.NodeType, c = Ai.commonNodeType(x, y, z);
    if (c === T.WATER) {
      var D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      for (var i = 0; i < 6; i++) if (Ai.commonNodeType(x + D[i][0], y + D[i][1], z + D[i][2]) === T.BLOCKED) return 'WATER_BORDER';
      return 'WATER';
    }
    if (c !== T.OPEN) return 'BLOCKED';
    var below = Ai.commonNodeType(x, y - 1, z);
    if (below === T.WATER) return 'OPEN';
    return below === T.BLOCKED ? 'WALKABLE' : 'BLOCKED';
  };
  /** `PathMinHeap.java` verbatim (binary min-heap on heapWeight, heapIndex cached on the node): its sift order IS the A* tie order. */
  Ax.PathMinHeap = function () { this.nodes = []; };
  Ax.PathMinHeap.prototype.isEmpty = function () { return this.nodes.length === 0; };
  Ax.PathMinHeap.prototype.push = function (n) { this.nodes.push(n); n.heapIndex = this.nodes.length - 1; this._up(n.heapIndex); return n; };
  Ax.PathMinHeap.prototype.pop = function () {
    var a = this.nodes, n = a[0], last = a.pop();
    if (a.length > 0) { a[0] = last; this._down(0); }
    n.heapIndex = -1;
    return n;
  };
  Ax.PathMinHeap.prototype.setNodeWeight = function (n, w) { var old = n.heapWeight; n.heapWeight = w; if (w < old) this._up(n.heapIndex); else this._down(n.heapIndex); };
  Ax.PathMinHeap.prototype._up = function (i) {
    var a = this.nodes, n = a[i], w = n.heapWeight;
    while (i > 0) { var p = (i - 1) >> 1, pn = a[p]; if (!(w < pn.heapWeight)) break; a[i] = pn; pn.heapIndex = i; i = p; }
    a[i] = n; n.heapIndex = i;
  };
  Ax.PathMinHeap.prototype._down = function (i) {
    var a = this.nodes, n = a[i], w = n.heapWeight;
    for (;;) {
      var l = 1 + (i << 1), r = l + 1;
      if (l >= a.length) break;
      var ln = a[l], lw = ln.heapWeight, rn = r >= a.length ? null : a[r], rw = rn ? rn.heapWeight : Infinity;
      if (lw < rw) { if (!(lw < w)) break; a[i] = ln; ln.heapIndex = i; i = l; }
      else { if (!(rw < w)) break; a[i] = rn; rn.heapIndex = i; i = r; }
    }
    a[i] = n; n.heapIndex = i;
  };
  /** A* over `Ax.nodeType` nodes (6 faces + 4 horizontal diagonals; step cost euclidean distance + the node's malus; a diagonal needs both flanking cells passable). Returns [{x,y,z}...] or the node nearest the goal. */
  Ax.amphibiousPath = function (sx, sy, sz, tx, ty, tz, maxNodes) {
    var P = Ax.NODE_PENALTY, f = Math.floor, k = function (n) { return n.x + ',' + n.y + ',' + n.z; };
    var goal = { x: f(tx), y: f(ty), z: f(tz) }, start = { x: f(sx), y: f(sy), z: f(sz) };
    var h = function (n) { return Math.sqrt(Math.pow(n.x - goal.x, 2) + Math.pow(n.y - goal.y, 2) + Math.pow(n.z - goal.z, 2)); };
    // #7651: per-call caches (key, h, node type) and an open-set index; the open list is still re-sorted (stable) every pop, so the order is unchanged
    var types = new Map(), nodeType = function (x, y, z) {
      var tk = x + ',' + y + ',' + z, v = types.get(tk);
      if (v === undefined) { v = Ax.nodeType(x, y, z); types.set(tk, v); }
      return v;
    };
    start.k = k(start); start.h = h(start);
    // #10714: the real Pathfinder's PathMinHeap pop order (tie-exact) and LandPathNodeMaker.getSuccessors order
    // (S, W, E, N, the four diagonals, then AmphibiousPathNodeMaker's up, down); one node object per cell
    var heap = new Ax.PathMinHeap(), nodes = {}, from = {}, g = {}, closed = {}, best = start, bestH = start.h, seen = 0;
    nodes[start.k] = start; g[start.k] = 0; start.heapWeight = start.h; start.heapIndex = -1; heap.push(start);
    var D = [[0, 0, 1], [-1, 0, 0], [1, 0, 0], [0, 0, -1]];
    if (!Ax.DIAGONALS_OFF) D.push([-1, 0, -1], [1, 0, -1], [-1, 0, 1], [1, 0, 1]);
    D.push([0, 1, 0], [0, -1, 0]);
    while (!heap.isEmpty() && seen++ < (maxNodes || 600)) {
      var cur = heap.pop(), ck = cur.k;
      if (cur.h === 0) { best = cur; break; }
      closed[ck] = true;
      if (cur.h < bestH) { best = cur; bestH = cur.h; }
      var curOpen = nodeType(cur.x, cur.y, cur.z) === 'OPEN';
      for (var i = 0; i < D.length; i++) {
        var nb = { x: cur.x + D[i][0], y: cur.y + D[i][1], z: cur.z + D[i][2] }, nk = k(nb), diag = D[i][0] !== 0 && D[i][2] !== 0;
        if (closed[nk] || nb.y < NS.CFG.WORLD_MIN_Y) continue;
        var nt = nodeType(nb.x, nb.y, nb.z), pen = P[nt];
        if (nt !== 'WATER' && nt !== 'WATER_BORDER' && D[i][1] === 0 && curOpen) continue;   // a breach node is a surface bob: it leads back into water, never along the air or onto a ledge
        if (pen === undefined) continue;
        if (diag) {   // isValidDiagonalSuccessor: both flanking cells must be passable (penalty >= 0)
          var fa = nodeType(cur.x + D[i][0], cur.y, cur.z), fb = nodeType(cur.x, cur.y, cur.z + D[i][2]);
          if (P[fa] === undefined || P[fb] === undefined) continue;
          if (curOpen) continue;
        }
        var t = g[ck] + (diag ? Math.SQRT2 : 1) + pen;
        if (g[nk] === undefined || t < g[nk]) {
          g[nk] = t; from[nk] = cur;
          var ex = nodes[nk];
          if (ex && ex.heapIndex >= 0) heap.setNodeWeight(ex, t + ex.h);
          else if (!ex) { nb.k = nk; nb.h = h(nb); nb.heapWeight = t + nb.h; nb.heapIndex = -1; nodes[nk] = nb; heap.push(nb); }
        }
      }
    }
    var path = [best];
    while (from[k(best)]) { best = from[k(best)]; path.push(best); }
    return path.reverse();
  };

  /** `EntityNavigation.startMovingTo` + its tick: A* (`Ai.findPath`, the dolphin's precedent -- this engine's one
   *  water-capable A*) re-planned every 10 ticks or when the goal block changes, walked node by node. Falls back to a
   *  straight step when no path exists. State lives on `st` (one per goal). */
  /** AxolotlBrain.getTargetApproachingSpeed: 0.6 in water/bubble column, else 0.15 (RangedApproachTask's speed supplier). */
  Ax.approachSpeed = function (e) { return e.inWater ? Ax.APPROACH_SPEED_WATER : Ax.APPROACH_SPEED_LAND; };

  /** IDLE pri 0 TimeLimitedTask(FollowMobTask(PLAYER, 6.0F), UniformIntProvider(30, 60)): runs for a drawn 30..60 ticks, then
   *  a drawn 30..60 tick quiet spell (resetTimeLeft). `inner` is the look half (Ai.LookAtPlayerGoal(6)). */
  Ax.LOOK_WINDOW = [30, 60];
  Ax.TimedLookGoal = function (e, inner, rand, window) {
    var w = window || Ax.LOOK_WINDOW, left = 0, quiet = 0, self = this;
    rand = rand || RNDFB;
    var draw = function () { return w[0] + Math.floor(rand() * (w[1] - w[0] + 1)); };
    this.lastWindow = 0;
    this.canUse = function () {
      if (quiet > 0) { quiet--; return false; }
      return inner.canUse();
    };
    this.canContinueToUse = function () { return left > 0 && inner.canContinueToUse(); };
    this.start = function () { left = self.lastWindow = draw(); if (inner.start) inner.start(); };
    this.stop = function () { left = 0; quiet = draw(); self.lastQuiet = quiet; if (inner.stop) inner.stop(); };
    this.tick = function () { left--; inner.tick(); };
  };

  Ax.navStep = function (e, st, tx, ty, tz, speed) {
    var Ai = NS.Ai, k = Math.floor(tx) + ',' + Math.floor(ty) + ',' + Math.floor(tz);
    // #7651: a goal with no route (st.path null) is re-planned on the same 10-tick cadence, not every tick (two A* searches of up to 600 nodes each)
    if (st.done) return;
    if (st.key !== k || st.idx >= (st.path ? st.path.length : 0) && st.path || --st.repath <= 0 || (!st.path && st.repath === undefined)) {
      // in water: AmphibiousPathNodeMaker's vertical swim nodes = the 6-connected water A* (#4073); on land / no swim route: walking A*
      var p = NS.Physics ? Ax.amphibiousPath(e.x, e.y, e.z, tx, ty, tz) : null;
      if (!p || p.length < 2) p = Ai.findPath(e.x, e.y, e.z, tx, ty, tz, { mob: e, partial: true });
      st.path = p && p.length > 1 ? p : null; st.idx = 1; st.key = k; st.repath = 10;
    }
    if (!st.path) { Ai.stepToward(e, { x: tx, y: ty, z: tz }, speed); return; }
    // EntityNavigation.tick: continueFollowingPath (advance past the reached node) BEFORE MoveControl.moveTo aims at the current one
    st.idx = Ai.advancePathNode(e, st.path, st.idx);
    if (st.stopAtEnd && st.idx >= st.path.length) { st.done = true; return; }   // EntityNavigation.tick: a finished path is idle, MoveControl.moveTo is not called
    Ai.stepToward(e, st.path[Math.min(st.idx, st.path.length - 1)], speed);
  };

  /** AxolotlBrain IDLE priority 4 CompositeTask(ORDERED, TRY_ALL) of AquaticStrollTask / StrollTask(0.15, false) /
   *  WaitTask(30,60 in water | 200,400 on ground) (.decomp, read whole). The composite keeps running until its longest
   *  child (the WaitTask) ends, so one stroll starts per wait: `canUse` re-arms only after `rand(30..60)` water /
   *  `rand(200..400)` ground ticks. Water: `findAquatic` (the 6-rung ladder, each rung a `localFuzz`, chained along the
   *  first direction while the target stays in fluid); land: `localFuzz(10, 7)`. (ponytail: no
   *  NoPenaltyTargeting validation / 10-sample favor pick; GoTowardsLookTarget not ported.) Refuses while playing dead. */
  Ax.WanderGoal = function (e, ctx) {
    ctx = ctx || {};
    var rand = ctx.random || RNDFB;
    var cooldown = 0, target = null, nav = {};
    var fuzz = function (h, v) {
      return { x: e.x + Math.floor(rand() * (2 * h + 1)) - h, y: e.y + Math.floor(rand() * (2 * v + 1)) - v,
               z: e.z + Math.floor(rand() * (2 * h + 1)) - h };
    };
    var inFluid = function (p) {
      var W = NS.World, S = NS.States, R = NS.Reg;
      return !!(W && S && R && S.block[W.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))] === R.id.water);
    };
    var findAquatic = function () {
      var prev = null, cur = null, L = Ax.AQUATIC_LADDER;
      for (var i = 0; i < L.length; i++) {
        if (!prev) cur = fuzz(L[i][0], L[i][1]);
        else {
          var dx = prev.x - e.x, dy = prev.y - e.y, dz = prev.z - e.z, m = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          cur = { x: e.x + dx / m * L[i][0], y: e.y + dy / m * L[i][1], z: e.z + dz / m * L[i][0] };
        }
        if (!inFluid(cur)) return prev;
        prev = cur;
      }
      return cur;
    };
    this.canUse = function () {
      if (e.playingDead) return false;
      if (--cooldown > 0) return false;
      var w = e.inWater ? Ax.WAIT_WATER : Ax.WAIT_GROUND;
      cooldown = w[0] + Math.floor(rand() * (w[1] - w[0] + 1));
      var t = e.inWater ? findAquatic() : fuzz(Ax.WANDER_H, Ax.WANDER_V);
      if (!t || (Math.floor(t.x) === Math.floor(e.x) && Math.floor(t.z) === Math.floor(e.z))) return false;
      target = t;
      return true;
    };
    this.canContinueToUse = function () {
      if (e.playingDead || !target) return false;
      var dx = target.x - e.x, dy = target.y - e.y, dz = target.z - e.z;
      return (dx * dx + dy * dy + dz * dz) > 1;
    };
    this.start = function () {};
    this.stop = function () { target = null; };
    this.tick = function () {
      if (!target || !NS.Ai || !NS.Ai.stepToward) return;
      var speed = e.inWater ? Ax.WANDER_SPEED_WATER : Ax.WANDER_SPEED_LAND;
      Ax.navStep(e, nav, target.x, target.y, target.z, speed);
    };
  };

  /** `SeekWaterTask(6, 0.15F)` (.decomp, AxolotlBrain IDLE priority 3): every 40 ticks (first after 22) while the
   *  axolotl's own block holds no water, scan +-6 for a water block not in its own column, preferring one with air
   *  above (else the first one >1.5 away), and walk at 0.15, in BlockPos.iterateOutwards' exact order. */
  Ax.iterateOutwards = function (cx, cy, cz, rx, ry, rz, fn) {   // BlockPos.iterateOutwards verbatim; fn true stops
    var total = rx + ry + rz, md = 0, limX = 0, limY = 0, dx = 0, dy = 0, swap = false, px = 0, py = 0, pz = 0;
    for (;;) {
      if (swap) { swap = false; pz = cz - (pz - cz); if (fn(px, py, pz)) return; continue; }
      var got = false;
      while (!got) {
        if (dy > limY) {
          dx++;
          if (dx > limX) { md++; if (md > total) return; limX = Math.min(rx, md); dx = -limX; }
          limY = Math.min(ry, md - Math.abs(dx)); dy = -limY;
        }
        var k = md - Math.abs(dx) - Math.abs(dy);
        if (k <= rz) { swap = k !== 0; px = cx + dx; py = cy + dy; pz = cz + k; got = true; }
        dy++;
      }
      if (fn(px, py, pz)) return;
    }
  };
  Ax.seekWaterScan = function (bx, by, bz, n, isWater, isAirAt, ex, ey, ez) {
    var any = null, air = null;
    Ax.iterateOutwards(bx, by, bz, n, n, n, function (x, y, z) {
      if (x === bx && z === bz) return false;
      if (!isWater(x, y, z)) return false;
      if (isAirAt(x, y + 1, z)) { air = { x: x + 0.5, y: y, z: z + 0.5 }; return true; }
      if (!any) {
        var dx = x + 0.5 - ex, dy = y - ey, dz = z + 0.5 - ez;   // isWithinDistance(pos, 1.5) on the block corner
        if (dx * dx + dy * dy + dz * dz >= 2.25) any = { x: x + 0.5, y: y, z: z + 0.5 };
      }
      return false;
    });
    return air || any;
  };
  Ax.SEEK_WATER_RANGE = 6; Ax.SEEK_WATER_SPEED = 0.15;
  Ax.SeekWaterGoal = function (e) {
    var next = 22, target = null;
    var isWater = function (x, y, z) {
      var W = NS.World, S = NS.States, R = NS.Reg;
      return S.block[W.getBlock(x, y, z)] === R.id.water;
    };
    this.canUse = function () {
      if (e.playingDead || e.inWater || --next > 0) return false;
      var W = NS.World, S = NS.States, n = Ax.SEEK_WATER_RANGE;
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      if (isWater(bx, by, bz)) return false;
      var W2 = NS.World;
      target = Ax.seekWaterScan(bx, by, bz, n, isWater, function (x, y, z) { return !!(S.isAir && S.isAir[W2.getBlock(x, y, z)]); }, e.x, e.y, e.z);
      if (!target) return false;
      next = 40;
      return true;
    };
    this.canContinueToUse = function () {
      if (e.playingDead || e.inWater || !target) return false;
      var dx = target.x - e.x, dy = target.y - e.y, dz = target.z - e.z;
      return dx * dx + dy * dy + dz * dz > 1;
    };
    this.start = function () {};
    this.stop = function () { target = null; };
    this.tick = function () { if (target) NS.Ai.stepToward(e, target, Ax.SEEK_WATER_SPEED); };
  };

  /** `AxolotlMoveControl` (`AquaticMoveControl(85,10,0.1F,0.5F,false)`) + `AxolotlEntity.travel` (.decomp
   *  AxolotlEntity.java:500-509,555-569), one tick after the goals' `Ai.stepToward` set `e.navNode`: pitch toward the
   *  target (<=85 deg, 5 deg/tick), vertical swim, then in water updateVelocity+move+*0.9 (no gravity, not buoyant);
   *  on land the plain ground travel. */
  Ax.travelMob = function (e) {
    var Ph = NS.Physics, D2R = Math.PI / 180;
    var node = e.navNode, nav = !!e.navigating;
    e.navNode = null; e.navigating = false;
    if (!e.inWater) { if (Ph && Ph.travelMob) Ph.travelMob(e); return; }
    if (Math.abs(e.vx || 0) < 0.003) e.vx = 0; if (Math.abs(e.vy || 0) < 0.003) e.vy = 0; if (Math.abs(e.vz || 0) < 0.003) e.vz = 0;   // LivingEntity.tickMovement's per-axis 0.003 floor, before travel
    var fwd = 0, up = 0, speed = 0, S = e.mobSpeed || 0;
    if (node && nav && !e.playingDead) {
      var dx = node.x + 0.5 - e.x, dy = node.y - e.y, dz = node.z + 0.5 - e.z;
      if (dx * dx + dy * dy + dz * dz >= 2.5000003e-7) {
        var h = Math.sqrt(dx * dx + dz * dz);
        if (Math.abs(dy) > 1e-5 || Math.abs(h) > 1e-5) {
          var want = Math.max(-85, Math.min(85, -(Math.atan2(dy, h) / D2R)));
          var d = want - (e.axPitch || 0); if (d > 5) d = 5; if (d < -5) d = -5;
          e.axPitch = (e.axPitch || 0) + d;
        }
        fwd = Math.cos((e.axPitch || 0) * D2R) * S * 0.98;   // LivingEntity.tickMovement forwardSpeed *= 0.98
         up = -Math.sin((e.axPitch || 0) * D2R) * S;
        speed = S * 0.1;
      }
    }
    e.zza = 0;
    var len = fwd * fwd + up * up;
    if (len >= 1e-7 && speed) {
      var k = speed / (len > 1 ? Math.sqrt(len) : 1);
      e.vx = (e.vx || 0) + fwd * k * Math.sin(e.yaw || 0);
      e.vz = (e.vz || 0) - fwd * k * Math.cos(e.yaw || 0);
      e.vy = (e.vy || 0) + up * k;
    }
    if (Ph && Ph.move) Ph.move(e, e.vx || 0, e.vy || 0, e.vz || 0);
    e.vx *= 0.9; e.vy *= 0.9; e.vz *= 0.9;
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
