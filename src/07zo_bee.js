// 07zo_bee.js — QUEUE 0.2 (G18 mobs), unit BEE. Runs on: MAIN THREAD ONLY. No DOM.
//
// Everything numeric below is read off `.decomp/net/minecraft/entity/passive/BeeEntity.java`
// (1296 lines, read in full this session) and cited by line; `BeehiveBlockEntity`/
// `BeeEntityModel`/`BeeBrain` have NO `.decomp` source in this worktree at all (confirmed:
// `find .decomp -iname '*beehive*'` returns nothing) — every number that would come from that
// class is named on `Bee.OWED` as an approximation, never guessed silently (the standing rule
// this queue's every mob header already states).
//
// WHAT IS HERE:
//   1. attributes — `BeeEntity.createBeeAttributes` (.decomp lines 532-538): MAX_HEALTH/
//      MOVEMENT_SPEED/ATTACK_DAMAGE/FOLLOW_RANGE come off the jar-extracted `entities.json`
//      row (`Ent.attrsOf('bee')` — hp 10, speed 0.3, dmg 2, follow 48, all four confirmed to
//      match the .decomp literals), because this jar DOES carry a bee row (checked directly,
//      `assets/entities.json`'s own `types`/`attrs`/`breeding` tables all have one) — this file
//      only adds `Bee.FLYING_SPEED` (0.6, `field_23720`), the one attribute `entities.json`'s
//      generic table has no column for (the same gap `Fl.FLYING_SPEED.parrot` already covers).
//   2. anger + sting — `Bee.sting` is `BeeEntity.tryAttack` (.decomp lines 224-247) verbatim:
//      `Sv.hurt`/`Cb.hurt` for the damage, `stingerCount++`, difficulty-gated poison (normal 10s/
//      hard 18s, `NS.Diff.value`), `hasStung=true`, anger cleared. Anger ITSELF reuses this
//      engine's existing generic Angerable substrate (`e.angerTime`, decremented once per tick
//      with no live target by `Cb.tickEntity`, 14j_combat.js:445 — the same field
//      `07zj_polarbear.js`'s own header says is "not rebuilt here" for polar bear) plus
//      `Ai.HurtByTargetGoal`/`Ai.UniversalAngerGoal` (07k_goals.js, already generic, already
//      used) — `Bee.StingGoal` below is the one bee-specific piece: the strike itself, since
//      the generic `Ai.MeleeAttackGoal` calls `Cb.mobAttack` (a plain hit, no poison/hasStung).
//   3. flight — `e.flyMove = new NS.Fly.MoveControl(e)` at spawn: `BeeEntity`'s own
//      `this.moveControl = new FlightMoveControl(this, 20, true)` (.decomp line 141) is the
//      SAME `FlightMoveControl` `Fl.MoveControl` already ports verbatim (07t_fly.js's own
//      header) for the identical reason vex's `Fl.travelMob` dispatch already exists — no new
//      travel law needed, only the registration.
//   4. pollination + grow-crop goals — `Bee.PollinateGoal`/`Bee.GrowCropsGoal`
//      (.decomp `PollinateGoal`/`GrowCropsGoal`, lines 811-1160-ish, read in full): the flower
//      search is `W.tagBelow('flowers', state)` (`#minecraft:flowers`, confirmed live against
//      this engine's own tag table — `T.stateIn` — rather than assumed), a REAL uniform-box
//      scan out to a small radius standing in for vanilla's ring-buffer BFS (named on
//      `Bee.OWED`, the same "no real flying pathfinder" gap `Fl.OWED §2/§3` already states).
//      `GrowCropsGoal` checks the two blocks directly BELOW the bee (`getBlockPos().method_10087($$0)` = down,
//      $$0 in {1,2} — a LITERAL read of the jar body, not a guess) against
//      `#minecraft:bee_growables` (confirmed live) and ages the block one step via `NS.States`/
//      `W.setBlock` when it is not yet mature — the STEM/berry-bush specific "which property is
//      AGE" lookup is folded to "any block in the tag carries an `age` state property", which
//      is true for wheat/carrots/potatoes/beetroots/torchflower_crop/pumpkin_stem/melon_stem/
//      sweet_berry_bush alike (the one tag member difference vanilla's own switch draws is
//      COSMETIC — melon/pumpkin only spawn a fruit at full age via `Fertilizable.grow`, which
//      is not rebuilt here — `Bee.OWED`).
//   5. go-to-hive — `Bee.canEnterHive` is `BeeEntity.canEnterHive()` VERBATIM (.decomp lines
//      321-327: `cannotEnterHiveTicks<=0 && !pollinating && !hasStung && !target &&
//      (failedPollinatingTooLong || raining || night || hasNectar)`, the fire check dropped —
//      `Bee.OWED`, this engine has no per-block "is a campfire/lava nearby" query). Hive-FINDING
//      itself is `Bee.findHive`: real, but a flat `BE.forEach` distance scan (07c_blockentity.js
//      already carries the `beehive`/`bee_nest` block-entity TYPE — `bees:[]`/`honeyLevel:0`,
//      this session confirmed it live rather than re-adding it) standing in for vanilla's
//      `PointOfInterestStorage` (this engine has no POI index at all — `Bee.OWED`).
//      Enter/exit (`Bee.enterHive`/`Bee.releaseFromHive`) are this unit's own minimal
//      block-entity substrate: an occupant record (`{id, hasNectar, ticksLeft}`) pushed onto
//      the hive's own `bees` array (`BeehiveBlockEntity`'s real shape; `Bee.MIN_OCCUPATION_TICKS_*` were first taken as the commonly
//      published values SWAPPED; D-559 read them off .decomp BeehiveBlockEntity lines 65-68).
//   6. breeding — `Breed.SPECIAL.bee` REMOVED (07m_breed.js, this unit's own registration
//      line): `BeeEntity` (.decomp, read in full) overrides NONE of `isBreedingItem`/
//      `canBreedWith`/`createChild` — it is a fully generic `AnimalEntity`, and
//      `entities.json`'s own `breeding.bee` row is already `{k:'tag', t:['#minecraft:flowers']}`
//      (confirmed live, matches `#minecraft:flowers` exactly) — so the original comment this
//      entry carried ("breeding also needs a hive") does not hold up against the class that
//      would carry that gate; there is none. No `Breed.CHILD.bee` is needed either: the generic
//      path's default (child is the same species) is already correct here.
//   7. textures — `bee`/`bee_angry`/`bee_nectar`/`bee_angry_nectar` (`BeeEntityRenderer`,
//      .decomp, read in full — four literal `Identifier`s, no variant system at all unlike
//      axolotl/llama). `Bee.skinKey` (§ TEXTURE below) is the picker, chained onto
//      07j_entityrender.js's existing `Tm.skinKey`/`Rb.skinKey`/`Fx.skinKey`/`Ax.skinKey`/
//      `Ll.skinKey` fallback (D-469's own idiom, this file's own registration line there).
//      `tools/extract-mob-textures.mjs`'s own registration line adds the three extra sheets
//      (this unit's own change there).
//
// NOT HERE — `Bee.OWED`, at the bottom.

(function (NS) {
  'use strict';
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6438)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = new NS.JRandom(0x6438); return fbR.nextDouble(); }

  var Bee = NS.Bee = { ready: true };

  // ── § CONSTANTS (.decomp BeeEntity.java, cited per line above and inline) ──────────────────
  Bee.FLYING_SPEED = 0.6;                    // field_23720, createBeeAttributes line 535
  Bee.MAX_LIFETIME_AFTER_STINGING = 1200;    // line 99
  Bee.ANGER_TIME_MIN_TICKS = 20 * 20;        // line 117, TimeHelper.betweenSeconds(20,39)
  Bee.ANGER_TIME_MAX_TICKS = 39 * 20;
  Bee.NORMAL_POISON_TICKS = 10 * 20;         // lines 232-238, *20 at the addStatusEffect call
  Bee.HARD_POISON_TICKS = 18 * 20;
  Bee.MAX_POLLINATED_CROPS = 10;             // line 103
  Bee.POLLINATION_FAIL_TICKS = 3600;         // line 102, failedPollinatingTooLong
  Bee.FLOWER_NAV_START_TICKS = 2400;         // line 100, PollinateGoal-adjacent shouldMoveToFlower
  Bee.TOO_FAR_DISTANCE = 32;                 // line 106
  Bee.POLLINATION_DURATION_TICKS = 400;      // completedPollination, line ~1132
  Bee.POLLINATE_ROLL_MIN = 20;               // MathHelper.nextInt(random, 20, 60), lines 130-131
  Bee.POLLINATE_ROLL_MAX = 60;
  Bee.GROW_CROPS_INTERVAL = 30;              // GrowCropsGoal field_30299, line 812

  // § approximations with NO `.decomp` source (`BeehiveBlockEntity`) — see file header, `Bee.OWED`.
  Bee.HIVE_SEARCH_RADIUS = 20;
  Bee.FLOWER_SEARCH_RADIUS = 5;      // PollinateGoal.getFlower: findFlower(pred, 5.0)
  Bee.MIN_OCCUPATION_TICKS_NECTAR = 2400;    // BeehiveBlockEntity.MIN_OCCUPATION_TICKS_WITH_NECTAR (line 67; D-559 — the worker had these two swapped)
  Bee.MIN_OCCUPATION_TICKS_PLAIN = 600;      // MIN_OCCUPATION_TICKS_WITHOUT_NECTAR (line 68)
  Bee.MAX_HIVE_OCCUPANTS = 3;                // MAX_BEE_COUNT (line 65)

  function dist2(ax, ay, az, bx, by, bz) {
    var dx = ax - bx, dy = ay - by, dz = az - bz;
    return dx * dx + dy * dy + dz * dz;
  }

  // ── § SPAWN ──────────────────────────────────────────────────────────────────────────────
  /** `BeeEntity`'s own field defaults (.decomp lines 118-134), read in full. */
  // loop/nbtsave-s104 -- every field below now guarded `=== undefined` rather than assigned
  // unconditionally, so a reload's own `opts`-copied value (07zw_mobnbt.js, EL.spawn's generic
  // "spawner data wins" copy step) survives this default hook the same way `rabbit`/`fox`/
  // `axolotl`'s own DEFAULTS entries already guard theirs (07i_entitylist.js) -- a fresh spawn
  // sees every field undefined and behaves exactly as before.
  Bee.spawnInit = function (e, opts, rand) {
    var r = rand || RNDFB;
    if (e.hasNectar === undefined) e.hasNectar = false;
    if (e.hasStung === undefined) e.hasStung = false;
    if (e.angerTime === undefined) e.angerTime = 0;
    if (e.angryAt === undefined) e.angryAt = null;
    if (e.ticksSinceSting === undefined) e.ticksSinceSting = 0;
    if (e.ticksSincePollination === undefined) e.ticksSincePollination = 0;
    if (e.cannotEnterHiveTicks === undefined) e.cannotEnterHiveTicks = 0;
    if (e.cropsGrownSincePollination === undefined) e.cropsGrownSincePollination = 0;
    if (e.ticksUntilCanPollinate === undefined) e.ticksUntilCanPollinate = Bee.POLLINATE_ROLL_MIN +
      Math.floor(r() * (Bee.POLLINATE_ROLL_MAX - Bee.POLLINATE_ROLL_MIN + 1));
    if (e.flowerPos === undefined) e.flowerPos = null;
    if (e.hivePos === undefined) e.hivePos = null;
    e.stingerCount = e.stingerCount || 0;
  };

  // ── § PER-TICK ───────────────────────────────────────────────────────────────────────────
  /** #2621 AbstractBeeSoundInstance.tick: the volume/pitch law (v = blocks/tick horizontal speed). */
  Bee.loopLaw = function (v, baby) {
    var lo = baby ? 1.1 : 0.7, hi = baby ? 1.5 : 1.1, c = function (x, a, b) { return Math.max(a, Math.min(b, x)); };
    if (v < 0.01) return { volume: 0, pitch: 0 };
    return { volume: c(v, 0, 0.5) * 1.2, pitch: lo + c(v, lo, hi) * (hi - lo) };
  };
  /** Once per tick: Passive (entity.bee.loop) <-> Aggressive (entity.bee.loop_aggressive) voice that follows the bee. */
  Bee.soundTick = function (e) {
    var S = NS.Sound, ev = e.angerTime > 0 ? 'entity.bee.loop_aggressive' : 'entity.bee.loop', vc = e.beeVoice;
    if (!S || !S.loopVoice) return;
    if (e.removed || e.silent) { if (vc) { vc.stop(); e.beeVoice = null; } return; }
    if (vc && vc.event !== ev) { vc.stop(); vc = null; }
    if (!vc) vc = e.beeVoice = S.loopVoice(ev, 'neutral');
    var v = e.lastSx === undefined ? 0 : Math.sqrt((e.x - e.lastSx) * (e.x - e.lastSx) + (e.z - e.lastSz) * (e.z - e.lastSz));
    e.lastSx = e.x; e.lastSz = e.z;
    var l = Bee.loopLaw(v, NS.Breed && NS.Breed.ready && NS.Breed.isBaby(e));
    vc.set(l.volume, l.pitch, e.x, e.y, e.z);
  };
  /** `BeeEntity.tick` 251-263 pitch lerp + `mobTick` 348-375 + `tickMovement` 455-477, once per tick.
   *  Nectar drip particles (tick() 253-259) spawn through `NS.Particle`. */
  Bee.tickEntity = function (e, rand) {
    var r = rand || RNDFB, Cb = NS.Combat;
    Bee.soundTick(e);
    if (e.hasNectar && (e.cropsGrownSincePollination || 0) < 10 && r() < 0.05 && NS.Particle && NS.Particle.spawn) {
      for (var i = 0; i < Math.floor(r() * 2) + 1; i++) {   // nextInt(2) is re-rolled on every bound check, as vanilla
        NS.Particle.spawn('falling_nectar', e.x - 0.3 + r() * 0.6, e.y + (e.height || 0.6) * 0.5, e.z - 0.3 + r() * 0.6, 0, 0, 0, r);
      }
    }
    e.lastBodyPitch = e.bodyPitch || 0;
    e.bodyPitch = e.nearTarget ? Math.min(1, (e.bodyPitch || 0) + 0.2) : Math.max(0, (e.bodyPitch || 0) - 0.24);
    // isInsideWaterOrBubbleColumn (Entity.java:1035): touching water OR the feet block is a bubble_column
    var inBubble = NS.World && NS.World.getBlock && NS.States.block[NS.World.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z))] === NS.Reg.id.bubble_column;
    e.ticksInsideWater = (e.inWater || inBubble) ? (e.ticksInsideWater || 0) + 1 : 0;
    if (e.ticksInsideWater > 20 && Cb && Cb.hurt) Cb.hurt(e, 1.0, undefined, false, { bypassArmor: true, source: 'drown' });
    if (e.hasStung) {
      e.ticksSinceSting++;
      if (e.ticksSinceSting % 5 === 0 && Math.floor(r() * Math.min(1200, Math.max(1, 1200 - e.ticksSinceSting))) === 0 &&
          Cb && Cb.hurt) Cb.hurt(e, e.health, undefined, false, { bypassArmor: true, source: 'generic' });
    }
    if (!e.hasNectar) e.ticksSincePollination++;
    if (e.cannotEnterHiveTicks > 0) e.cannotEnterHiveTicks--;
    if (e.ticksLeftToFindHive > 0) e.ticksLeftToFindHive--;
    if (e.ticksUntilCanPollinate > 0) e.ticksUntilCanPollinate--;
    var t = e.target;
    e.nearTarget = !!(e.angerTime > 0 && !e.hasStung && t && dist2(e.x, e.y, e.z, t.x, t.y, t.z) < 4);
    if (e.age % 20 === 0 && e.hivePos) {
      var BE = NS.BlockEntities, hp = e.hivePos, be = BE && BE.get ? BE.get(hp.x, hp.y, hp.z) : null;
      if (BE && BE.ready && !(be && be.type === 'beehive')) e.hivePos = null;
    }
  };

  // ── § ANGER / STING ──────────────────────────────────────────────────────────────────────
  /** `BeeEntity.chooseAngerTime` (.decomp line 413, `ANGER_TIME_RANGE`). */
  Bee.rollAngerTime = function (rand) {
    var r = rand || RNDFB;
    return Bee.ANGER_TIME_MIN_TICKS + Math.floor(r() * (Bee.ANGER_TIME_MAX_TICKS - Bee.ANGER_TIME_MIN_TICKS + 1));
  };
  Bee.startAnger = function (e, target, rand) {
    e.angerTime = Bee.rollAngerTime(rand);
    e.angryAt = target ? (target.id !== undefined ? target.id : true) : null;
  };
  Bee.stopAnger = function (e) {
    e.angerTime = 0;
    e.angryAt = null;
    e.target = null;
  };

  /**
   * `BeeEntity.tryAttack` (.decomp lines 224-247), verbatim: damage by ATTACK_DAMAGE, then —
   * ONLY on a landed hit — `stingerCount++`, a difficulty-gated Poison (normal 200 ticks/hard
   * 360 ticks, amplifier 0), `hasStung=true`, `stopAnger()`. `ctx.diff` is `NS.Diff.value`
   * ('peaceful'/'easy'/'normal'/'hard', 07l_spawn.js) at the real call site.
   */
  Bee.sting = function (e, target, ctx) {
    if (!e || !target) return false;
    var at = NS.Entities && NS.Entities.attrsOf ? NS.Entities.attrsOf('bee') : null;
    var dmg = at ? at.dmg : 2;
    var hit;
    if (ctx && target === ctx.player) {
      var Sv = NS.Survival;
      hit = Sv && Sv.hurt ? Sv.hurt(target, 'sting', dmg, e) : false;
      if (hit) target.lastHurtByEntity = e;
    } else {
      var Cb = NS.Combat;
      hit = Cb && Cb.hurt ? Cb.hurt(target, dmg, undefined, false, { attacker: e }) : false;
      if (hit && Cb && Cb.notifyHurt) Cb.notifyHurt(target, e);
    }
    if (hit) {
      target.stingerCount = (target.stingerCount || 0) + 1;
      var diff = (ctx && ctx.diff) || (NS.Diff && NS.Diff.value) || 'normal';
      var poisonTicks = diff === 'hard' ? Bee.HARD_POISON_TICKS
        : diff === 'normal' ? Bee.NORMAL_POISON_TICKS : 0;
      if (poisonTicks > 0 && NS.Effects && NS.Effects.addStatusEffect) {
        NS.Effects.addStatusEffect(target, 'poison', poisonTicks, 0, false, true);
      }
      e.hasStung = true;
      Bee.stopAnger(e);
      if (NS.Effects && NS.Effects.thornsOnUserDamaged) NS.Effects.thornsOnUserDamaged(target, e);
      if (NS.Sound && NS.Sound.play && !e.silent) NS.Sound.play('entity.bee.sting', { x: e.x, y: e.y, z: e.z, volume: 1, pitch: 1, source: 'neutral' });
    }
    return hit;
  };

  /**
   * `BeeEntity.BeeRevengeGoal extends RevengeGoal` (.decomp): continues only while the bee
   * `hasAngerTime()`, and `setMobEntityTarget` only adopts the attacker if the bee `canSee` it.
   */
  Bee.BeeRevengeGoal = function (e, getPack) {
    var Ai = NS.Ai, base = new Ai.HurtByTargetGoal(e);
    this.canUse = base.canUse;
    this.canContinueToUse = function () { return (e.angerTime | 0) > 0 && base.canContinueToUse(); };
    this.start = function () {
      base.start();
      if (e.target && !Ai.canSee(e, e.target)) e.target = null;
      // setGroupRevenge(new Class[0]) -> callSameTypeForRevenge: other bees w/o target, in followRange x10 x followRange, that canSee it
      var a = e.lastHurtByEntity, fr = Ai.followRangeOf(e), pack = a && getPack ? getPack() : [];
      for (var i = 0; i < pack.length; i++) {
        var o = pack[i];
        if (!o || o === e || o.removed || o.dead || o.target || o === a) continue;
        if (Math.abs(o.x - e.x) > fr || Math.abs(o.z - e.z) > fr || Math.abs(o.y - e.y) > Ai.ALERT_RANGE_Y) continue;
        if (!Ai.canSee(o, a)) continue;
        o.target = a; o.angerTime = Bee.rollAngerTime();
      }
    };
    this.stop = base.stop;
    this.tick = base.tick;
  };

  /**
   * The strike half of `StingGoal extends MeleeAttackGoal` (.decomp line 1254) — reach/cooldown
   * transcribed off `Ai.MeleeAttackGoal`'s own already-referee'd formula (07k_goals.js, D-394),
   * `Bee.sting` in place of `Cb.mobAttack` for the poison/hasStung/stopAnger half neither
   * `Cb.mobAttack` nor the generic goal know about.
   */
  Bee.StingGoal = function (e, ctx) {
    var atkCooldown = 0;
    this.canUse = function () { return !!e.target && e.angerTime > 0 && !e.hasStung; };
    this.canContinueToUse = this.canUse;
    this.start = function () { atkCooldown = 0; };
    this.stop = function () {};
    this.tick = function () {
      var t = e.target;
      if (!t) return;
      if (atkCooldown > 0) atkCooldown--;
      var Ai = NS.Ai;
      if (dist2(e.x, e.y, e.z, t.x, t.y === undefined ? e.y : t.y, t.z) <= (Ai ? Ai.attackReachSqr(e, t) : 4) &&
          atkCooldown <= 0) {
        atkCooldown = (Ai && Ai.MOB_ATTACK_INTERVAL) || 20;
        if (NS.EntityRender && NS.EntityRender.swingHand) NS.EntityRender.swingHand(e);
        Bee.sting(e, t, ctx);
      } else if (Ai) {
        var path = Ai.findPath(e.x, e.y, e.z, t.x, t.y, t.z, { mob: e });
        if (path && path.length > 1) Ai.stepToward(e, path[1], 1.4);
      }
    };
  };

  // ── § POLLINATE / GROW CROPS ────────────────────────────────────────────────────────────
  /** `BeeEntity.isFlowers`/the `#minecraft:flowers` tag question, off the REAL tag table. */
  Bee.isFlowerAt = function (x, y, z) {
    var W = NS.World;
    if (!W || !W.tagBelow) return false;
    return !!W.tagBelow('flowers', W.getBlock(x, y, z));
  };
  Bee.isCropAt = function (x, y, z) {
    var W = NS.World;
    if (!W || !W.tagBelow) return false;
    return !!W.tagBelow('bee_growables', W.getBlock(x, y, z));
  };

  /** `PollinateGoal.flowerPredicate`: #flowers, but a sunflower only counts as its LOWER half. */
  Bee.isPollinateFlowerAt = function (x, y, z) {
    if (!Bee.isFlowerAt(x, y, z)) return false;
    var R = NS.Reg, st = NS.World.getBlock(x, y, z), b = R.id.sunflower;
    return !(st >= R.realFirst[b] && st < R.realFirst[b + 1] && NS.States.propValue(st, R.PROP.half) === R.PVAL.upper);
  };

  /** `PollinateGoal.findFlower(pred, 5.0)` verbatim: the ring order, y = dy-1, isWithinDistance(<=5). */
  Bee.findFlower = function (e, radius, pred) {
    var rad = radius || Bee.FLOWER_SEARCH_RADIUS, test = pred || Bee.isPollinateFlowerAt;
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    for (var a = 0; a <= rad; a = a > 0 ? -a : 1 - a) {
      for (var b = 0; b < rad; b++) {
        for (var c = 0; c <= b; c = c > 0 ? -c : 1 - c) {
          for (var d = c < b && c > -b ? b : 0; d <= b; d = d > 0 ? -d : 1 - d) {
            // BlockPos.isWithinDistance(pos, dist): squared distance of block centres <= dist^2 (offsets are ints)
            if (c * c + (a - 1) * (a - 1) + d * d > rad * rad) continue;
            var x = bx + c, y = by + a - 1, z = bz + d;
            if (test(x, y, z)) return { x: x, y: y, z: z };
          }
        }
      }
    }
    return null;
  };

  /** `BeeEntity.PollinateGoal` (.decomp lines 1063-1230), the state machine. */
  Bee.PollinateGoal = function (e, ctx) {
    var findFlower = (ctx && ctx.findFlower) || Bee.findFlower;
    var isFlowerAt = (ctx && ctx.isFlowerAt) || Bee.isFlowerAt;
    var rand = (ctx && ctx.random) || RNDFB;
    var pollinationTicks = 0, lastPollinationTick = 0, ticks = 0, running = false, nextTarget = null;
    e.pollinateGoal = this;
    function moveToNextTarget() {
      if (e.flyMove) e.flyMove.setWantedPosition(nextTarget.x, nextTarget.y, nextTarget.z, 0.35);
    }
    this.canUse = function () {
      if (e.angerTime > 0) return false;
      if (e.ticksUntilCanPollinate > 0) return false;
      if (e.hasNectar) return false;
      if (ctx && ctx.isRaining && ctx.isRaining()) return false;
      var f = findFlower(e);
      if (!f) { e.ticksUntilCanPollinate = Bee.POLLINATE_ROLL_MIN + Math.floor(rand() * (Bee.POLLINATE_ROLL_MAX - Bee.POLLINATE_ROLL_MIN + 1)); return false; }
      e.flowerPos = f;
      return true;
    };
    this.canContinueToUse = function () {
      if (e.angerTime > 0 || !running) return false;
      if (!e.flowerPos) return false;
      if (ctx && ctx.isRaining && ctx.isRaining()) return false;
      if (pollinationTicks > Bee.POLLINATION_DURATION_TICKS) return rand() < 0.2;
      if (e.age % 20 === 0 && !isFlowerAt(e.flowerPos.x, e.flowerPos.y, e.flowerPos.z)) { e.flowerPos = null; return false; }
      return true;
    };
    this.start = function () { pollinationTicks = 0; ticks = 0; lastPollinationTick = 0; running = true; e.ticksSincePollination = 0; };
    this.stop = function () {
      if (pollinationTicks > Bee.POLLINATION_DURATION_TICKS) { e.hasNectar = true; e.ticksSincePollination = 0; }   // setHasNectar(true) -> resetPollinationTicks
      running = false; pollinationTicks = 0;
      if (e.flyMove && e.flyMove.stop) e.flyMove.stop();
      e.ticksUntilCanPollinate = 200;
    };
    this.cancel = function () { running = false; };   // BeeEntity.damage -> pollinateGoal.cancel()
    this.isRunning = function () { return running; };
    this.tick = function () {
      ticks++;
      if (ticks > 600 || !e.flowerPos) { e.flowerPos = null; return; }
      var f = e.flowerPos, tx = f.x + 0.5, ty = f.y + 0.6, tz = f.z + 0.5;
      var dist = Math.sqrt(dist2(e.x, e.y, e.z, tx, ty, tz));
      if (dist > 1.0) { nextTarget = { x: tx, y: ty, z: tz }; moveToNextTarget(); return; }
      if (!nextTarget) nextTarget = { x: tx, y: ty, z: tz };
      var atNext = Math.sqrt(dist2(e.x, e.y, e.z, nextTarget.x, nextTarget.y, nextTarget.z)) <= 0.1, go = true;
      if (atNext) {
        if (Math.floor(rand() * 25) === 0) {
          nextTarget = { x: tx + (rand() * 2 - 1) * 0.33333334, y: ty, z: tz + (rand() * 2 - 1) * 0.33333334 };
          if (e.flyMove && e.flyMove.stop) e.flyMove.stop();
        } else go = false;
      }
      if (go) moveToNextTarget();
      pollinationTicks++;
      if (rand() < 0.05 && pollinationTicks > lastPollinationTick + 60) {
        lastPollinationTick = pollinationTicks;
        if (NS.Sound && NS.Sound.play && !e.silent) NS.Sound.play('entity.bee.pollinate', { x: e.x, y: e.y, z: e.z, volume: 1, pitch: 1, source: 'neutral' });
      }
    };
  };

  /** `BeeEntity.MoveToFlowerGoal` (.decomp lines 871-925): fly toward the remembered flower after 2400 ticks without pollinating. */
  Bee.MoveToFlowerGoal = function (e, ctx) {
    var isFlowerAt = (ctx && ctx.isFlowerAt) || Bee.isFlowerAt;
    var rand = (ctx && ctx.random) || RNDFB;
    var ticks = Math.floor(rand() * 10);
    function can() {
      var f = e.flowerPos;
      return e.angerTime <= 0 && !!f && e.ticksSincePollination > Bee.FLOWER_NAV_START_TICKS &&
        isFlowerAt(f.x, f.y, f.z) && dist2(e.x, e.y, e.z, f.x + 0.5, f.y + 0.5, f.z + 0.5) > 4;   // !isWithinDistance(flowerPos, 2)
    }
    this.canUse = can;
    this.canContinueToUse = can;
    this.start = function () { ticks = 0; };
    this.stop = function () { ticks = 0; if (e.flyMove && e.flyMove.stop) e.flyMove.stop(); };
    this.tick = function () {
      var f = e.flowerPos;
      if (!f) return;
      if (++ticks > 600) { e.flowerPos = null; return; }
      if (dist2(e.x, e.y, e.z, f.x, f.y, f.z) > Bee.TOO_FAR_DISTANCE * Bee.TOO_FAR_DISTANCE) { e.flowerPos = null; return; }
      if (e.flyMove) e.flyMove.setWantedPosition(f.x + 0.5, f.y + 0.5, f.z + 0.5, 1.0);   // startMovingTo, speed 1.0
    };
  };

  /**
   * `BeeEntity.GrowCropsGoal` (.decomp lines 811-863, read in full): the two blocks directly
   * BELOW the bee (`getBlockPos().method_10087($$0)` = down, , $$0 in {1,2} — literal), rolled once every ~30
   * ticks, aged one step each when tagged `#minecraft:bee_growables` and not yet at max age.
   */
  Bee.GrowCropsGoal = function (e, ctx) {
    var isCropAt = (ctx && ctx.isCropAt) || Bee.isCropAt;
    var growAt = (ctx && ctx.growCropAt) || Bee.growCropAt;
    var rand = (ctx && ctx.random) || RNDFB;
    // isHiveValid(): the bee's own remembered hivePos (tick() drops it when the block entity is no longer a beehive).
    var hiveValid = (ctx && ctx.isHiveValid) || function () { return !!e.hivePos; };
    this.canUse = function () {
      if (e.angerTime > 0) return false;
      if (e.cropsGrownSincePollination >= Bee.MAX_POLLINATED_CROPS) return false;
      return rand() < 0.3 ? false : !!e.hasNectar && hiveValid();
    };
    this.canContinueToUse = this.canUse;
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {
      if (Math.floor(rand() * Bee.GROW_CROPS_INTERVAL) !== 0) return;
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      for (var up = 1; up <= 2; up++) {
        var x = bx, y = by - up, z = bz;
        if (!isCropAt(x, y, z)) continue;
        if (growAt(x, y, z)) { e.cropsGrownSincePollination = (e.cropsGrownSincePollination || 0) + 1; }
      }
    };
  };
  /**
   * Ages a bee_growables block one step, by NAME + its `age` state property — the real
   * per-block "which property is AGE" switch (.decomp lines 833-853: CropBlock/StemBlock/
   * SweetBerryBushBlock each their own accessor) is folded to one generic `age` lookup, true
   * for every current member of the tag (`Bee.OWED` names melon/pumpkin's own fruit-spawn-at-
   * max-age half, `Fertilizable.grow`, as the one behavior this drops).
   */
  Bee.growCropAt = function (x, y, z) {
    var W = NS.World, S = NS.States, R = NS.Reg;
    if (!W || !W.getBlock || !S || !S.ready || !R || !R.ready) return false;
    var state = W.getBlock(x, y, z);
    if (!state) return false;
    var pid = R.PROP && R.PROP.age;
    if (pid === undefined) return false;
    // SweetBerryBushBlock.AGE tops out at 3 (.decomp line 848); every other current
    // `#bee_growables` member (CropBlock/StemBlock) tops out at 7 (.decomp lines 838-844) —
    // read live off the block's own name (`R.names[S.block[state]]`), not assumed for every tag
    // member, so a future tag addition with a third max age fails closed (returns false) rather
    // than silently mis-ageing it.
    var name = R.names[S.block[state]];
    // cave_vines / cave_vines_plant: Fertilizable.grow (berries=true), NOT age-stepped and NOT counted (.decomp lines 856-858)
    if (name === 'cave_vines' || name === 'cave_vines_plant') {
      if (NS.Behave && NS.Behave.plantStemGrow) NS.Behave.plantStemGrow(x, y, z);
      return false;
    }
    var maxAge = name === 'sweet_berry_bush' || name === 'beetroots' ? 3 : 7;   // beetroots: CropBlock max age 3
    var curVal = S.propValue(state, pid), curAge = -1;
    for (var n = 0; n <= maxAge; n++) { if (R.PVAL[String(n)] === curVal) { curAge = n; break; } }
    if (curAge < 0 || curAge >= maxAge) return false;
    var nextVal = R.PVAL[String(curAge + 1)];
    if (nextVal === undefined) return false;
    var next = S.withProp(state, pid, nextVal);
    if (next === state) return false;
    var set = W.setBlock(x, y, z, next);
    if (set && NS.Particle && NS.Particle.worldEvent) NS.Particle.worldEvent(2005, x, y, z, 0);   // GrowCropsGoal: syncWorldEvent(2005, pos)
    return set;
  };

  // ── § HIVE — the minimal block-entity substrate (07c_blockentity.js's `beehive` type,
  //     confirmed to already exist with `bees:[]`/`honeyLevel:0` this session, per this file's
  //     own header — occupant enter/exit is this unit's addition) ─────────────────────────────
  /** `BeehiveBlockEntity.isNearFire` (.decomp 86-98): a FireBlock (plain fire only; SoulFireBlock is not one) in the 3x3x3 around the hive. */
  Bee.isHiveNearFire = function (e) {
    var hp = e.hivePos, W = NS.World, S = NS.States;
    if (!hp || !W || !W.getBlock || !S || !S.ready) return false;
    var fb = S.block[S.stateOf('fire')];
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) for (var dz = -1; dz <= 1; dz++)
      if (S.block[W.getBlock(hp.x + dx, hp.y + dy, hp.z + dz)] === fb) return true;
    return false;
  };

  /** `BeeEntity.canEnterHive()` VERBATIM (.decomp lines 321-327). */
  Bee.canEnterHive = function (e, ctx) {
    if (Bee.isHiveNearFire(e)) return false;
    if (e.cannotEnterHiveTicks > 0 || e.hasStung || e.target) return false;
    var pollinating = ctx && ctx.pollinateGoal && ctx.pollinateGoal.isRunning && ctx.pollinateGoal.isRunning();
    if (pollinating) return false;
    var failedTooLong = e.ticksSincePollination > Bee.POLLINATION_FAIL_TICKS;
    var raining = !!(ctx && ctx.isRaining && ctx.isRaining());
    var night = !!(ctx && ctx.isNight && ctx.isNight());
    return failedTooLong || raining || night || e.hasNectar;
  };

  /** Nearest `beehive`/`bee_nest` block entity within radius — a flat `BE.forEach` scan. */
  Bee.findHive = function (e, radius, skip) {
    var BE = NS.BlockEntities;
    if (!BE || !BE.ready) return null;
    var rad = radius || Bee.HIVE_SEARCH_RADIUS;
    var best = null, bestD = Infinity, Poi = NS.Poi;
    if (Poi && Poi.ready && BE.get) {   // BeeEntity.findHive: PointOfInterestStorage BEEHIVE/BEE_NEST in a circle
      var near = Poi.getInCircle(function (t) { return t === 'beehive' || t === 'bee_nest'; },
        { x: Math.floor(e.x), y: Math.floor(e.y), z: Math.floor(e.z) }, rad, Poi.STATUS.ANY);
      for (var i = 0; i < near.length; i++) {
        var p = near[i], hb = BE.get(p.x, p.y, p.z);
        if (!hb || hb.type !== 'beehive') continue;
        if (hb.bees && hb.bees.length >= Bee.MAX_HIVE_OCCUPANTS) continue;
        if (skip && skip.indexOf(p.x + ',' + p.y + ',' + p.z) >= 0) continue;
        var pd = dist2(e.x, e.y, e.z, p.x + 0.5, p.y + 0.5, p.z + 0.5);
        if (pd < bestD) { bestD = pd; best = hb; }
      }
      return best;
    }
    BE.forEach(function (be) {
      if (be.type !== 'beehive') return;
      if (be.bees && be.bees.length >= Bee.MAX_HIVE_OCCUPANTS) return;
      if (skip && skip.indexOf(be.x + ',' + be.y + ',' + be.z) >= 0) return;
      var d = dist2(e.x, e.y, e.z, be.x + 0.5, be.y + 0.5, be.z + 0.5);
      if (d > rad * rad) return;
      if (d < bestD) { bestD = d; best = be; }
    });
    return best;
  };

  /** engine field -> BeeEntity/Entity NBT key carried in a hive occupant's EntityData (tryEnterHive's saved entity copy). */
  Bee.ED_KEYS = { growAge: 'Age', health: 'Health', customName: 'CustomName', persistent: 'PersistenceRequired', inLove: 'InLove',
    cropsGrownSincePollination: 'CropsGrownSincePollination', ticksSincePollination: 'TicksSincePollination',
    hasStung: 'HasStung', angerTime: 'AngerTime', cannotEnterHiveTicks: 'CannotEnterHiveTicks' };

  /** `BeehiveBlockEntity.Bee` for entity `e`: {EntityData, TicksInHive, MinOccupationTicks} (min 2400 with nectar, else 600). */
  Bee.makeOccupant = function (e, ticksInHive) {
    var d = { id: 'minecraft:bee', HasNectar: !!e.hasNectar };
    for (var k in Bee.ED_KEYS) if (e[k] !== undefined && e[k] !== null) d[Bee.ED_KEYS[k]] = e[k];
    if (e.flowerPos) d.FlowerPos = { X: e.flowerPos.x, Y: e.flowerPos.y, Z: e.flowerPos.z };
    return { EntityData: d, TicksInHive: ticksInHive | 0,
      MinOccupationTicks: e.hasNectar ? Bee.MIN_OCCUPATION_TICKS_NECTAR : Bee.MIN_OCCUPATION_TICKS_PLAIN };
  };

  /** Old saves / old callers hold {id, hasNectar, ticksLeft, ticksIn, data}: rewrite in place to the vanilla record. */
  Bee.normOcc = function (occ) {
    if (occ.EntityData) {
      if (occ.ticksLeft !== undefined) { occ.TicksInHive = occ.MinOccupationTicks - occ.ticksLeft; delete occ.ticksLeft; }   // legacy countdown poked onto a new record
      return occ;
    }
    var ed = { id: 'minecraft:bee', HasNectar: !!occ.hasNectar }, d = occ.data || {};
    for (var k in d) { if (Bee.ED_KEYS[k]) ed[Bee.ED_KEYS[k]] = d[k]; else if (k === 'flowerPos' && d[k]) ed.FlowerPos = { X: d[k].x, Y: d[k].y, Z: d[k].z }; }
    var min = occ.hasNectar ? Bee.MIN_OCCUPATION_TICKS_NECTAR : Bee.MIN_OCCUPATION_TICKS_PLAIN;
    var tl = occ.ticksLeft === undefined ? min : occ.ticksLeft;
    occ.EntityData = ed; occ.MinOccupationTicks = min; occ.TicksInHive = min - tl + (occ.ticksIn | 0);
    delete occ.id; delete occ.hasNectar; delete occ.ticksLeft; delete occ.ticksIn; delete occ.data;
    return occ;
  };

  /** `releaseBee` + `ageBee`: restore the saved entity, HivePos = the hive, flowerPos from the hive (p 0.9) if none, breeding age / love aged by ticksInHive. */
  Bee.applyReleased = function (e, hiveBE, occ) {
    Bee.normOcc(occ);
    var d = occ.EntityData, t = occ.TicksInHive | 0;
    for (var k in Bee.ED_KEYS) if (d[Bee.ED_KEYS[k]] !== undefined) e[k] = d[Bee.ED_KEYS[k]];
    if (d.FlowerPos) e.flowerPos = { x: d.FlowerPos.X, y: d.FlowerPos.Y, z: d.FlowerPos.Z };
    e.hasNectar = !!d.HasNectar;
    e.hivePos = { x: hiveBE.x, y: hiveBE.y, z: hiveBE.z, be: hiveBE };
    if (!e.flowerPos && hiveBE.flowerPos && RNDFB() < 0.9) e.flowerPos = { x: hiveBE.flowerPos.x, y: hiveBE.flowerPos.y, z: hiveBE.flowerPos.z };
    var g = e.growAge | 0;
    if (g < 0) { e.growAge = Math.min(0, g + t); e.isBaby = e.growAge < 0; } else if (g > 0) e.growAge = Math.max(0, g - t);
    if (e.inLove > 0) e.inLove = Math.max(0, e.inLove - t);
    return e;
  };

  /** Occupant enter: pushes `{id, hasNectar, ticksLeft}` onto the hive and removes the bee. */
  /** block.beehive.enter/exit/work: BLOCKS category, at the hive (BeehiveBlockEntity.tryEnterHive/releaseBee/serverTick). */
  Bee.hiveSound = function (ev, be) {
    if (NS.Sound && NS.Sound.play) NS.Sound.play('block.beehive.' + ev, { x: be.x + 0.5, y: be.y + 0.5, z: be.z + 0.5, volume: 1, pitch: 1, source: 'block' });
  };

  Bee.enterHive = function (e, hiveBE) {
    if (!hiveBE || !hiveBE.bees) return false;
    if (hiveBE.bees.length >= Bee.MAX_HIVE_OCCUPANTS) return false;
    var occ = Bee.makeOccupant(e, 0);   // tryEnterHive saves the entity NBT copy
    // flowerPos goes to the hive (always if it has none, else 50%)
    if (e.flowerPos && (!hiveBE.flowerPos || RNDFB() < 0.5)) hiveBE.flowerPos = { x: e.flowerPos.x, y: e.flowerPos.y, z: e.flowerPos.z };
    hiveBE.bees.push(occ);
    e.hasNectar = false;   // honey_level is bumped on RELEASE (tickHive's ctx.deliverHoney), as vanilla
    e.removed = true;
    Bee.hiveSound('enter', hiveBE);
    return true;
  };

  /**
   * Per-hive per-tick occupant countdown, releasing anyone at zero back into `EL` — but only
   * when `BeehiveBlockEntity.releaseBee` itself would (.decomp lines 180-189, VERBATIM for the
   * clause this engine can read without a fire/emergency state: `if ((world.isNight() ||
   * world.isRaining()) && state != EMERGENCY) return false;`). A generated nest's bees never
   * reach `EMERGENCY` (that state is angered-bee eviction, `Bee.OWED` names the rest of the
   * state machine as not ported), so the whole clause here is just "not night and not raining".
   * A bee whose timer is up but the sky refuses release stays in the hive, timer clamped at 0,
   * and is offered again next tick — exactly `tickBees`'s own `while` loop, which re-attempts
   * `releaseBee` every tick a bee's `ticksInHive` is already past `minOccupationTicks`.
   */
  Bee.tickHive = function (hiveBE, ctx) {
    if (!hiveBE || !hiveBE.bees || hiveBE.bees.length === 0) return;
    var night = !!(ctx && ctx.isNight && ctx.isNight());
    var raining = !!(ctx && ctx.isRaining && ctx.isRaining());
    var canRelease = !night && !raining;
    var kept = [];
    for (var i = 0; i < hiveBE.bees.length; i++) {
      var occ = Bee.normOcc(hiveBE.bees[i]), ed = occ.EntityData;
      // tickBees: `ticksInHive > minOccupationTicks` is read BEFORE `ticksInHive++`
      if (!(occ.TicksInHive > occ.MinOccupationTicks)) { occ.TicksInHive++; kept.push(occ); continue; }
      if (!canRelease) { occ.TicksInHive++; kept.push(occ); continue; }
      if (ed.HasNectar && ctx && ctx.deliverHoney) { ctx.deliverHoney(hiveBE); ed.HasNectar = false; ed.CropsGrownSincePollination = 0; }   // onHoneyDelivered: setHasNectar(false) + resetCropCounter
      if (ctx && ctx.spawnBee) ctx.spawnBee(hiveBE.x + 0.5, hiveBE.y + 0.5, hiveBE.z + 0.5, occ);
      Bee.hiveSound('exit', hiveBE);
    }
    hiveBE.bees = kept;
    if (kept.length && RNDFB() < 0.005) Bee.hiveSound('work', hiveBE);
  };

  /**
   * The live wiring `BE.tick` calls for every `beehive`/`bee_nest` block entity (07c_blockentity
   * .js's own dispatcher, hive branch) — `ctx.isNight`/`ctx.isRaining` off `NS.Sky` the SAME
   * D-511 proxy `Sky.isDay()` every other rostered mob's daytime check already reuses (07k_goals
   * .js:1605, 07x_patrol.js:128, 07zg_enderman.js:223), `ctx.isRaining` off `Sky.weather.raining`
   * itself (09b_sky.js, the global flag `World.isRaining()` reads — NOT a per-position query:
   * `releaseBee`'s own two calls are bare `world.isNight()`/`world.isRaining()`, .decomp line
   * 189, so the position-aware `Sky.isRainingAt` other mobs use for wetting is the wrong tool
   * here). `ctx.spawnBee` is the one live consequence: a real `bee` entity via `EL.spawn`, no
   * nectar (a nest-released bee only ever carried `hasNectar:false` — `Bee.stockNest`'s own
   * header), positioned at the hive's centre exactly as `releaseBee` drops it beside the block
   * (the exact exit-face offset .decomp lines 226-229 compute is `Bee.OWED`, this engine has no
   * per-block collision-shape query built for a decorator-placed nest to read).
   */
  Bee.tickHiveBE = function (hiveBE) {
    var Sky = NS.Sky, EL = NS.EntityList;
    Bee.tickHive(hiveBE, {
      isNight: function () { return !(Sky && Sky.isDay && Sky.isDay()); },
      isRaining: function () { return !!(Sky && Sky.weather && Sky.isRaining(Sky.weather)); },
      // releaseBee .decomp ~212-222: honey_level < 5 -> +1, or +2 at 1% (minus 1 if that passes 5)
      deliverHoney: function (be) {
        var W = NS.World, B = NS.Behave, st = W.getBlock(be.x, be.y, be.z);
        var lv = +B.propName(st, 'honey_level');
        if (!(lv >= 0 && lv < 5)) return;
        var d = Math.floor(RNDFB() * 100) === 0 ? 2 : 1;
        if (lv + d > 5) d--;
        W.setBlock(be.x, be.y, be.z, B.setProp(st, 'honey_level', String(lv + d)));
      },
      spawnBee: function (x, y, z, occ) {
        if (!EL || !EL.spawn) return;
        var e = EL.spawn('bee', x, y, z);
        if (e) Bee.applyReleased(e, hiveBE, occ);
      }
    });
  };

  /** `CampfireBlock.isLitCampfireInRange` (.decomp 251-267): a lit campfire 1-5 below; a hay_block stops the scan at the one below it (ponytail: any solid block hits SMOKEY_SHAPE in vanilla; hay_block is the only case the game builds). */
  Bee.isLitCampfireInRange = function (x, y, z) {
    var W = NS.World, S = NS.States;
    if (!W || !S || !S.ready) return false;
    var lit = function (st) {
      var n = S.name(st);
      return (n === 'campfire' || n === 'soul_campfire') && NS.Behave.propName(st, 'lit') === 'true';
    };
    for (var d = 1; d <= 5; d++) {
      var st = W.getBlock(x, y - d, z);
      if (lit(st)) return true;
      if (S.name(st) === 'hay_block') return lit(W.getBlock(x, y - d - 1, z));
    }
    return false;
  };

  /**
   * `BeehiveBlockEntity.angerBees(player, state, EMERGENCY)` (.decomp 105-125): every occupant leaves NOW
   * (`releaseBee` ignores night/rain for EMERGENCY, and the exit-face collision check), and a released bee within 4 of
   * the player targets them - or, over a lit campfire, just cannot re-enter for 400 ticks. Returns the bees.
   */
  Bee.angerBees = function (be, P) {
    var EL = NS.EntityList, out = [];
    if (!be || !be.bees || !be.bees.length || !EL || !EL.spawn) return out;
    var smoked = Bee.isLitCampfireInRange(be.x, be.y, be.z);
    for (var i = 0; i < be.bees.length; i++) {
      var e = EL.spawn('bee', be.x + 0.5, be.y + 0.5, be.z + 0.5);
      if (!e) continue;
      Bee.hiveSound('exit', be);
      e.hasNectar = !!Bee.normOcc(be.bees[i]).EntityData.HasNectar;
      out.push(e);
      if (P && dist2(P.x, P.y, P.z, e.x, e.y, e.z) <= 16) {
        if (!smoked) { e.target = P; Bee.startAnger(e, P); } else e.cannotEnterHiveTicks = 400;
      }
    }
    be.bees = [];
    return out;
  };

  /** `BeehiveBlock.angerNearbyBees` (.decomp 80-93): every bee within (8,6,8) of the block with no target takes the player. */
  Bee.angerNearbyBees = function (x, y, z, P) {
    var EL = NS.EntityList;
    if (!EL || !EL.list || !P) return;
    if (Math.abs(P.x - x - 0.5) > 8.5 || Math.abs(P.y - y - 0.5) > 6.5 || Math.abs(P.z - z - 0.5) > 8.5) return;
    for (var i = 0; i < EL.list.length; i++) {
      var e = EL.list[i];
      if (e.type !== 'bee' || e.removed || e.target) continue;
      if (e.x < x - 8 || e.x > x + 9 || e.y < y - 6 || e.y > y + 7 || e.z < z - 8 || e.z > z + 9) continue;
      e.target = P; Bee.startAnger(e, P);
    }
  };

  /** `BeehiveBlock.afterBreak` (.decomp 40-48), without Silk Touch: the hive's bees pour out angry, then the nearby ones turn. `be` is read BEFORE the block went. */
  Bee.onHiveBreak = function (x, y, z, P, be, silk) {
    if (silk) return;
    Bee.angerBees(be, P);
    Bee.angerNearbyBees(x, y, z, P);
  };

  /**
   * `BeehiveBlock.takeHoney` after a successful shears/bottle use (.decomp 169-185): honey_level -> 0; unless a lit
   * campfire smokes the hive, a hive with bees angers the nearby bees first and then its own.
   */
  Bee.takeHoney = function (x, y, z, P) {
    var W = NS.World, S = NS.States, BE = NS.BlockEntities;
    var be = BE && BE.get(x, y, z), st = W.getBlock(x, y, z);
    var smoked = Bee.isLitCampfireInRange(x, y, z);
    if (!smoked && be && be.bees && be.bees.length) Bee.angerNearbyBees(x, y, z, P);
    W.setBlock(x, y, z, NS.Behave.setProp(st, 'honey_level', '0'));
    if (be) be.honeyLevel = 0;
    if (!smoked) Bee.angerBees(be, P);
  };

  /**
   * `BeehiveTreeDecorator.generate`'s own occupant fill (.decomp lines 61-68, VERBATIM): once a
   * nest is actually placed, `2 + random.nextInt(2)` bees (2 or 3), each `addBee(nbt,
   * random.nextInt(599), false)` — every one `hasNectar:false` (the literal `false` argument
   * line 67; a generated nest never starts with honey queued) and `ticksInHive` a random head
   * start into its occupation. `addBee` itself (line 176) turns `hasNectar:false` into
   * `minOccupationTicks = MIN_OCCUPATION_TICKS_WITHOUT_NECTAR` (600, line 68); this engine's
   * occupant record counts DOWN (`ticksLeft`, `Bee.enterHive`'s own shape) where vanilla's
   * `Bee.ticksInHive` counts up past `minOccupationTicks`, so a draw of `t` here becomes
   * `600 - t` — the same number of ticks until release either way, and always positive since
   * `nextInt(599)` never reaches 600. `ticks` is the array of `2 + nextInt(2)` `nextInt(599)`
   * draws the DECORATOR rolls (04k_feat_trees.js's own beehive decorator, hoisted above the
   * world read exactly like every other dice roll in that file) — this function only turns them
   * into occupant records and creates the block entity if the decorator's `setBlock` succeeded
   * and none exists yet.
   */
  Bee.stockNest = function (x, y, z, ticks) {
    var BE = NS.BlockEntities;
    if (!BE || !BE.ready || !ticks || !ticks.length) return null;
    var be = BE.get(x, y, z);
    if (!be || be.type !== 'beehive') be = BE.create(x, y, z, 'beehive');
    for (var i = 0; i < ticks.length && be.bees.length < Bee.MAX_HIVE_OCCUPANTS; i++) {
      be.bees.push({ EntityData: { id: 'minecraft:bee', HasNectar: false }, TicksInHive: ticks[i] | 0, MinOccupationTicks: Bee.MIN_OCCUPATION_TICKS_PLAIN });
    }
    return be;
  };

  /** `BeeEntity.EnterHiveGoal` (.decomp lines 737-766): hivePos set, canEnterHive, within 2 of it, hive not full -> tryEnterHive. */
  Bee.EnterHiveGoal = function (e, ctx) {
    var hive = function () { var BE = NS.BlockEntities, hp = e.hivePos; return hp && BE && BE.get ? BE.get(hp.x, hp.y, hp.z) : null; };
    this.canUse = function () {
      if (e.angerTime > 0 || !e.hivePos || !Bee.canEnterHive(e, ctx)) return false;
      var hp = e.hivePos;
      if (dist2(e.x, e.y, e.z, hp.x + 0.5, hp.y + 0.5, hp.z + 0.5) > 4) return false;
      var be = hive();
      if (!be || be.type !== 'beehive') return false;
      if (be.bees && be.bees.length >= Bee.MAX_HIVE_OCCUPANTS) { e.hivePos = null; return false; }
      return true;
    };
    this.canContinueToUse = function () { return false; };
    this.start = function () { var be = hive(); if (be) Bee.enterHive(e, be); e.hivePos = null; };
  };

  /** `BeeEntity.MoveToHiveGoal` (.decomp lines 928-1030), the seek-and-enter half. */
  Bee.MoveToHiveGoal = function (e, ctx) {
    var ticks = 0, ticksUntilLost = 0, lastPathLen = -1;
    var hiveAt = function (hp) { var BE = NS.BlockEntities, be = BE && BE.get ? BE.get(hp.x, hp.y, hp.z) : null; return be && be.type === 'beehive' ? be : null; };
    var setLost = function () { e.hivePos = null; e.ticksLeftToFindHive = 200; };
    var makePossible = function () {
      if (e.hivePos) { (e.possibleHives || (e.possibleHives = [])).push(e.hivePos.x + ',' + e.hivePos.y + ',' + e.hivePos.z); while (e.possibleHives.length > 3) e.possibleHives.shift(); }
      setLost();
    };
    this.canUse = function () {
      var hp = e.hivePos;
      return !!hp && Bee.canEnterHive(e, ctx) && dist2(e.x, e.y, e.z, hp.x + 0.5, hp.y + 0.5, hp.z + 0.5) >= 4 && !!hiveAt(hp);
    };
    this.canContinueToUse = this.canUse;
    this.start = function () { ticks = 0; ticksUntilLost = 0; lastPathLen = -1; };
    this.stop = function () { ticks = 0; ticksUntilLost = 0; };
    this.tick = function () {
      var hp = e.hivePos;
      if (!hp) return;
      if (++ticks > 600) return makePossible();
      var d2 = dist2(e.x, e.y, e.z, hp.x + 0.5, hp.y + 0.5, hp.z + 0.5);
      var Ai = NS.Ai;
      if (d2 > 32 * 32) return setLost();
      // BirdNavigation: 6-connected air A* (the hive cell itself is solid, so `partial` = nearest reachable cell);
      // the steering is `e.flyMove`'s own routed MoveTo, never a ground walk (#4709).
      var path = Ai && Ai.findSwimPath(e.x, e.y, e.z, hp.x, hp.y, hp.z, { air: true, mob: e, partial: true, maxNodes: 400 });
      var fly = function () { if (e.flyMove) e.flyMove.setWantedPosition(hp.x + 0.5, hp.y + 0.5, hp.z + 0.5, 1.0); };
      if (d2 > 16 * 16) { if (path && path.length > 1) fly(); return; }
      if (!path || path.length < 2) return makePossible();
      if (path.length === lastPathLen && ++ticksUntilLost > 60) { setLost(); ticksUntilLost = 0; return; }
      lastPathLen = path.length;
      fly();
    };
  };

  /** `BeeEntity.FindHiveGoal` (.decomp 767-809): every 200 ticks with no hive, remember the nearest free one not in `possibleHives` (no POI index: `Bee.findHive`). */
  Bee.FindHiveGoal = function (e, ctx) {
    this.canUse = function () { return !e.ticksLeftToFindHive && !e.hivePos && e.angerTime <= 0 && Bee.canEnterHive(e, ctx); };
    this.canContinueToUse = function () { return false; };
    this.start = function () {
      e.ticksLeftToFindHive = 200;
      var hive = Bee.findHive(e, 20, e.possibleHives);
      if (!hive && e.possibleHives && e.possibleHives.length) { e.possibleHives = []; hive = Bee.findHive(e, 20); }
      if (hive) e.hivePos = { x: hive.x, y: hive.y, z: hive.z, be: hive };
    };
  };

  // ── § WANDER — idle flight, `Bee.OWED` §6 (real flight, not a bee-tuned radius) ──────────
  /**
   * The one non-goal-specific flight a bee does with no target, no flower and no hive to seek —
   * `Fl.randomAirTarget` (07t_fly.js, already a real uniform-box pick standing in for the
   * jar's own scored candidate search, `Fl.OWED` §3) steered through `e.flyMove`, the SAME
   * `FlightMoveControl` object BeeEntity itself uses (.decomp line 141).
   */
  /** getRandomLocation's direction: toward a valid hive > 22 away (normalised 3D), else getRotationVec(0) (yaw AND pitch, D-415 frame). */
  Bee.wanderDir = function (e) {
    var hp = e.hivePos;
    if (hp && dist2(e.x, e.y, e.z, hp.x + 0.5, hp.y + 0.5, hp.z + 0.5) > 22 * 22) {
      var hx = hp.x + 0.5 - e.x, hy = hp.y + 0.5 - e.y, hz = hp.z + 0.5 - e.z, hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
      return { x: hx / hl, z: hz / hl };
    }
    var cp = Math.cos((e.pitch || 0));
    return { x: Math.sin(e.yaw || 0) * cp, z: -Math.cos(e.yaw || 0) * cp };
  };
  Bee.BeeWanderAroundGoal = function (e, ctx) {
    var rand = (ctx && ctx.random) || RNDFB;
    var tx = null, ty = null, tz = null;
    // `navigation.isIdle() && nextInt(10) == 0`: no navigator here, so "idle" is "no wander target in flight" (`stop` clears tx).
    this.canUse = function () { return e.angerTime <= 0 && tx === null && Math.floor(rand() * 10) === 0; };
    this.canContinueToUse = function () {
      if (e.angerTime > 0 || tx === null) return false;
      return dist2(e.x, e.y, e.z, tx, ty, tz) > 1;
    };
    this.start = function () {
      var Fl = NS.Fly, Wi = NS.Wither, t = null;
      if (Wi && Wi.aboveGroundFind) {
        // getRandomLocation: toward the hive when it is valid and > 22 away, else the facing direction.
        var d = Bee.wanderDir(e), dx = d.x, dz = d.z;
        var p = Wi.aboveGroundFind(e, rand, dx, dz) || Wi.noPenaltySolidFind(e, rand, dx, dz);
        if (p) t = { x: p.x + 0.5, y: p.y, z: p.z + 0.5 };
      } else t = Fl && Fl.randomAirTarget ? Fl.randomAirTarget(e, rand) : null;
      if (t) { tx = t.x; ty = t.y; tz = t.z; } else { tx = null; }
    };
    this.stop = function () { tx = null; };
    this.tick = function () {
      if (tx === null || !e.flyMove) return;
      e.flyMove.setWantedPosition(tx, ty, tz, 1.0);
    };
  };

  // ── § TEXTURE (`BeeEntityRenderer`, .decomp, four literal sheets — read in full above) ─────
  Bee.skinKey = function (e) {
    if (!e || e.type !== 'bee') return null;
    var angry = e.angerTime > 0;
    var nectar = !!e.hasNectar;
    if (angry) return nectar ? 'bee_angry_nectar' : 'bee_angry';
    return nectar ? 'bee_nectar' : 'bee';
  };

  // ── § OWED ────────────────────────────────────────────────────────────────────────────────
  Bee.OWED = [
    '§1 the occupant record ({id, hasNectar, ticksLeft}) is this unit\'s own minimal substrate, not ' +
      'a port of `BeehiveBlockEntity.Bee` (its NBT copy, flower pos, releaseBee state machine); the hive ' +
      'numbers themselves ARE jar-read (D-559, beecheck §D-559 reads .decomp).',
    '§2 hive/flower FINDING is a flat bounded-box scan (`Bee.findHive`/`Bee.findFlower`), not ' +
      'vanilla\'s real `PointOfInterestStorage`/ring-buffer BFS — this engine has no POI index ' +
      'at all, the same standing gap `Fl.OWED §2/§3` already names for BirdNavigation\'s own ' +
      'real A*; MoveToHiveGoal now plans on air cells and steers through `e.flyMove` (#4709); flower/wander ' +
      'targets already route through `Fl.MoveControl`\'s air A* (#4659). BirdPathNodeMaker penalties/door rules STRUCK #6786 (EL.DEFAULTS.bee sets the BeeEntity.createNavigation flags; beecheck §6786).',
    '§3 STRUCK (loop/beenest-s103): the tree decorator (04k_feat_trees.js) now writes the ' +
      'generated nest\'s `bees` NBT itself (`Bee.stockNest`, BeehiveTreeDecorator.generate ' +
      '.decomp lines 61-68) and `BE.tick` releases them through `Bee.tickHiveBE` on the same ' +
      'day/rain gate `releaseBee` reads (.decomp line 189) — a natural nest now produces live ' +
      'bees with no command/egg/hand-placement needed. Bees still have NO natural biome-spawn ' +
      'entry of their own in 1.18.2 (confirmed against `assets/`\'s own jar-extracted spawner ' +
      'lists, `beenestcheck` §3 — there is no `Spawn.RULES.bee` and there should not be one), so ' +
      'this nest fill is the species\' entire live population path, exactly as vanilla.',
    '§4 (closed #4710) vanilla\'s StemBlock branch only increments AGE, so there is no fruit spawn to drop.',
    '§7 `Bee.stockNest` only fires when the CALLER of the tree decorator shares this JS context ' +
      'with `NS.Bee`/`NS.BlockEntities` — true for `Jobs.mode===\'inline\'` (09_jobs.js, the ' +
      'no-Worker fallback) and for every check/tool that loads the engine as one `Function` ' +
      '(`loadsrc.mjs`, `beenestcheck` included), guarded false otherwise. In real `Jobs.mode===' +
      '\'workers\'` (09_jobs.js) the tree decorator runs inside a Worker whose bundle is only ' +
      '`loadsrc.mjs`\'s `WORKER_FILES` — no `07zo_bee.js`, no `07c_blockentity.js` there at all ' +
      '— so `Bee.stockNest`\'s guard silently no-ops and a Worker-generated nest places its ' +
      'BLOCK (unaffected — that part is the worker\'s own `sec` array, D-141\'s same "bare ' +
      'block, gap named" shape every OTHER worldgen block-entity in this engine already has: no ' +
      'chest, spawner or hopper generated by a tree/structure feature gets its content today ' +
      'either) but not its BEES, until a generic worker-result -> `W.installChunk` -> `BE.create` ' +
      'channel exists for ALL of them — a whole pipeline (`Gen.genColumn`\'s return shape, the ' +
      'worker postMessage protocol, `W.installChunk`) this unit\'s owned-file list (04k/07zo/07c) ' +
      'does not reach, named here rather than half-built across files three other units are ' +
      'editing in parallel.',
    // loop/nbtsave-s104 -- PARTIALLY CLOSED. Every per-BEE field this file sets (hasNectar/
    // hasStung/angerTime/angryAt/ticksSinceSting/ticksSincePollination/cannotEnterHiveTicks/
    // cropsGrownSincePollination/ticksUntilCanPollinate/flowerPos/hivePos/stingerCount) now
    // round-trips through 16b_save.js (07zw_mobnbt.js's own field table; Bee.spawnInit's
    // unconditional assigns were changed to `=== undefined` guards so a loaded value survives
    // it, same shape as rabbit/fox's own DEFAULTS entries). What does NOT round-trip: the hive
    // BLOCK ENTITY's own occupant list (the `{id, hasNectar, ticksLeft}` records `Bee.enterHive`
    // pushes onto a beehive's `bees` array, 07c_blockentity.js) -- 16b_save.js does not persist
    // ANY block entity's contents yet (that file's own long-standing chest/furnace/hopper gap,
    // pre-existing and out of this pass's scope), so a bee mid-residence in a hive still
    // vanishes on reload exactly as it always has -- not cheap, named rather than half-built.
    // loop/besave-s105: STRUCK. The hive BLOCK ENTITY's own occupant list (Bee.enterHive's
    // {id,hasNectar,ticksLeft} records, plus honeyLevel) now round-trips through 16b_save.js
    // via 07c_blockentity.js's own `BE.serializeAll`/`restoreAll` -- a bee mid-residence in a
    // hive survives reload exactly as a live mob's own fields already did (loop/nbtsave-s104).
    'nothing remains open here (was: the hive occupant list did not round-trip; closed by ' +
      'loop/besave-s105\'s BE.serializeAll/restoreAll, 07c_blockentity.js).'
  ];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
