// 07w_passive.js — QUEUE 0.2 (G18c): the sheep/chicken/pig-specific state `Ai.ROSTER`'s shared
// substrate (07k_goals.js) does not cover — wool colour, shearing's product, and chicken's egg
// timer/slow-fall. Everything else about these three (spawning, goals, breeding-food, model,
// texture) reuses machinery the cow/horse units already built; this file is only the leftover.
//
// Runs on: MAIN THREAD ONLY. No DOM.
//
// ⚠⚠ NOT ONE NUMBER HERE IS TYPED IN. Every constant is read straight off `.decomp`'s own
// SheepEntity.java/ChickenEntity.java (Yarn-named 1.18.2 source, `.decomp/net/minecraft/entity/
// passive/`) rather than remembered — see each function's own header for the exact line.
//
// ⚠⚠ QUEUE 0.2 (G18c) ITEMS 1-2 ARE DONE: `Passive.EatGrassGoal` (grass-eating, the dirt
//    conversion, wool regrow via `Passive.onEatingGrass`, and the baby growth boost) and the
//    shears/dye interaction (`14l_use.js`'s `Use.entityUse` dispatches to `Passive.shear`/
//    `Passive.dyeSheep`) are real and unit-tested (`passivecheck.mjs` §10-§11).
//
// loop/fleece-s97: the fleece LAYER RENDER (item 3) is now REAL. `Passive.fleeceColor`/
//    `Passive.fleeceTintFor` transcribe `SheepEntity.getDyedColor`/`getRgbColor` (.decomp lines
//    89-100) off `DyeColor.java`'s own 16 packed RGB literals (lines 11-26) — no colour is typed
//    in twice. `07j_entityrender.js`'s `ER.visible` pushes a SECOND `fur#null`-textured `it` for
//    a live, unsheared, non-invisible sheep (the exact `mobLayer`-same/`texKey`-different shape
//    D-471's collar already uses), tinted through a new `it.tintRGB` override so it does not
//    fight the shared `e.tintRGB` diagnostics channel (`mobrendercheck.mjs` §5).
//    STILL OWED (`Passive.OWED`): the invisible-sheep OUTLINE pass (`SheepWoolFeatureRenderer`
//    lines 30-39), which needs an outline render channel nothing here has — a permanent
//    simplification until one exists, not slipped in half-verified.
//    STRUCK loop/nameplate: the `jeb_` custom-name rainbow cycle (same method, lines 44-55) is
//    now real (`Passive.jebColorAt`/`Passive.fleeceTintFor`, this file) now that `e.customName`
//    exists (14l_use.js's name_tag branch) -- see this file's own `jebColorAt` header.
//
// loop/fleece-s97: pig SADDLING (`PigEntity implements Saddleable`, .decomp lines 158-182) is
//    real — `Passive.pigCanBeSaddled`/`Passive.pigSaddle`, dispatched from `14l_use.js`'s
//    `Use.entityUse` the same slot the sheep shears/dye branch already uses (`SaddleItem.
//    useOnEntity`, .decomp, read whole) — and the saddle RENDER (`saddle#null`, baked the same
//    pass `fur#null` was) draws whenever `e.saddled`. `Passive.pigBoost`/`Passive.pigTravelSpeed`
//    transcribe `SaddledComponent.boost(Random)`/`ItemSteerable.travel`'s speed line (.decomp)
//    as PURE functions, unit-tested against the jar's own constants (`passivecheck.mjs` §13) —
// loop/pigride-s98: pig MOUNTING + carrot-on-a-stick STEERING is now REAL. `Passive.pigMount`
//    reuses the SAME `e.rider` field the horse family rides on (no `Mnt.MOUNTABLE` edit needed
//    at all — `Mnt.isRidden`/`Mnt.dismount`/`Mnt.mountedHeightOffset`/`Mnt.findDismountPos`,
//    07r_mount.js, all read that field generically), `Passive.pigCanBeControlledByRider` is
//    `PigEntity.canBeControlledByRider` (carrot on a stick, either hand), and `Passive.pigTravel`
//    is `ItemSteerable.travel`'s pig-specific whole — wired from `07i_entitylist.js`'s own
//    per-mob tick (a pig-first branch ahead of the generic `Mount.isRidden && Mount.isSaddled`
//    check there, which would otherwise misfire on a saddled ridden pig too) and from
//    `Use.entityUse`/`Use.pigBoostOnAStick` (14l_use.js, this session's own file). See
//    `Passive.OWED` for the one real gap this pass leaves (the death-drop, no loot-drop
//    dispatch exists anywhere in this engine yet to hang it on).
//
// loop/renderres-s104: chicken flap ANIMATION and sheep EAT-GRASS HEAD POSE are now REAL,
//    state (here) through pose (`07j_entityrender.js`'s `ER.chickenWingRoll`/`ER.sheepEatGrass`
//    + `ER.setupAnimDelta`'s chicken/sheep branches), asserted by `tools/renderrescheck.mjs`.
//
// loop/jockey: chicken jockeys (`hasJockey`) are now REAL -- `Passive.setChickenJockey`
//    (this file, the chicken-side flag/no-egg refusal) + `Undead.tryChickenJockey`
//    (07zk_undead.js, the baby-zombie roll/search/mount, since it needs the zombie-family
//    context) + `Undead.trySpiderJockey`/`trySpiderEffect` (spider's own 1/100 skeleton rider
//    and hard-difficulty potion roll, SpiderEntity.java). See `Passive.OWED`'s struck line.

(function (NS) {
  'use strict';
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6214)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = NS.JRandom ? new NS.JRandom(0x6214) : { s: 0x6214, nextDouble: function () { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return this.s / 4294967296; } }; return fbR.nextDouble(); }

  var Passive = NS.Passive = { ready: false };

  Passive.init = function () {
    Passive.ready = true;
    return Passive;
  };

  // ── SHEEP: WOOL COLOUR ──────────────────────────────────────────────────────────────────
  //
  // `SheepEntity.generateDefaultColor(Random)` (.decomp), read in full:
  //   int i = random.nextInt(100);
  //   if (i < 5) return BLACK; else if (i < 10) return GRAY; else if (i < 15) return LIGHT_GRAY;
  //   else if (i < 18) return BROWN; else return random.nextInt(500) == 0 ? PINK : WHITE;
  // The five thresholds and the 1-in-500 pink roll are the jar's own; nothing here picks a
  // distribution, it TRANSCRIBES the branch exactly, in the same order.
  Passive.rollWoolColor = function (rnd) {
    var r = (rnd || RNDFB)() * 100;
    if (r < 5) return 'black';
    if (r < 10) return 'gray';
    if (r < 15) return 'light_gray';
    if (r < 18) return 'brown';
    return (Math.floor((rnd || RNDFB)() * 500) === 0) ? 'pink' : 'white';
  };

  /**
   * `SheepEntity.getChildColor` (.decomp), read in full: builds a 2-slot crafting inventory
   * holding the two parents' own dye items and asks the REAL recipe manager for a dye-mixing
   * match (`RecipeType.CRAFTING`'s own shapeless dye recipes — orange = red+yellow, light_gray =
   * gray+white, and so on, all of them ALREADY data this engine's `Recipes` module loaded from
   * the datapack, D-263's rule: reuse the jar's own table rather than re-typing the mixing
   * chart from memory); with no match, `world.random.nextBoolean() ? colorA : colorB` — a coin
   * flip between the two PARENTS, not a third colour invented for the miss.
   */
  Passive.childWoolColor = function (colorA, colorB, rnd) {
    var R = NS.Recipes, Iv = NS.Inventory;
    var r = rnd || RNDFB;
    if (R && R.ready && Iv) {
      var a = Iv.stack(colorA + '_dye', 1);
      var b = Iv.stack(colorB + '_dye', 1);
      if (a && b) {
        var out = R.craft([a, b], 2, 1, null);
        if (out && !Iv.isEmpty(out)) {
          var IT = NS.Items, name = IT ? IT.nameOf(out.i) : '';
          if (name && name.length > 4 && name.slice(-4) === '_dye') return name.slice(0, name.length - 4);
        }
      }
    }
    return r() < 0.5 ? colorA : colorB;
  };

  /**
   * `SheepEntity.sheared(SoundCategory)` (.decomp), the drop half only (the sound is a renderer/
   * audio concern, `Passive.OWED`'s "the interaction" line): `1 + random.nextInt(3)` wool items
   * of the sheep's OWN colour, sheared set true. Refuses a baby (`isShearable`: `!isBaby()`) or
   * an already-sheared sheep, both read off the same method.
   */
  Passive.shear = function (e, rnd) {
    if (!e || e.type !== 'sheep' || e.sheared || e.dead === true || e.removed) return null;
    if ((e.growAge | 0) < 0) return null;   // isShearable(): !isBaby()
    var r = rnd || RNDFB;
    e.sheared = true;
    if (NS.GameEvent) NS.GameEvent.emit('shear', e.x, e.y, e.z, e);   // SheepEntity.sheared
    return { item: (e.woolColor || 'white') + '_wool', count: 1 + Math.floor(r() * 3) };
  };

  // ── CHICKEN: EGG TIMER ──────────────────────────────────────────────────────────────────
  //
  // `ChickenEntity.eggLayTime` field initialiser (.decomp): `random.nextInt(6000) + 6000` — the
  // SAME expression re-run every time the timer resets (`tickMovement`'s own `if (... --this.
  // eggLayTime <= 0) { ...; this.eggLayTime = this.random.nextInt(6000) + 6000; }`).
  Passive.EGG_MIN = 6000;
  Passive.EGG_SPAN = 6000;
  Passive.rollEggTimer = function (rnd) {
    return Passive.EGG_MIN + Math.floor((rnd || RNDFB)() * Passive.EGG_SPAN);
  };

  /**
   * One tick of `ChickenEntity.tickMovement`'s own egg half (.decomp/net/minecraft/entity/
   * passive/ChickenEntity.java:90): `!isAlive()` is `EL.tickMob`'s own dead-guard;
   * `!isBaby()`/`!hasJockey()` are both read here (loop/jockey: `hasJockey` is real now,
   * `Passive.setChickenJockey`, so a ridden chicken correctly never lays). Returns true the
   * tick an egg should drop (and re-rolls the timer, matching the jar's own reset-in-the-same-
   * branch shape), false otherwise.
   */
  Passive.tickChicken = function (e, rnd) {
    if (!e || e.type !== 'chicken' || (e.growAge | 0) < 0 || e.hasJockey) return false;
    e.eggLayTime = (e.eggLayTime | 0) - 1;
    if (e.eggLayTime > 0) return false;
    e.eggLayTime = Passive.rollEggTimer(rnd);
    return true;
  };

  // ── CHICKEN: JOCKEY (loop/jockey) ───────────────────────────────────────────────────────
  //
  // `ChickenEntity.hasJockey`/`setHasJockey` (.decomp:44,180-186): a plain boolean field, no
  // other state. The ROLL/SEARCH/MOUNT half (who becomes a jockey, and when) is a baby ZOMBIE
  // decision (`ZombieEntity.initialize`), not a chicken one, so it lives in `Undead.
  // tryChickenJockey` (07zk_undead.js) -- this is only the chicken's own two effects of
  // carrying the flag: no egg (`Passive.tickChicken` above) and `canImmediatelyDespawn() ==
  // true` (`ChickenEntity.java:163-165`, read by `Spawn.canImmediatelyDespawn`'s own `chicken`
  // case, 07l_spawn.js). XP-on-death (`getXpToDrop` returning 10 instead of the base 1,
  // ChickenEntity.java:143) is named, not wired -- this engine has no experience-orb system
  // at all yet to hand it to (`Passive.OWED`).
  Passive.setChickenJockey = function (e, val) {
    if (!e || e.type !== 'chicken') return;
    e.hasJockey = !!val;
  };

  // ── CHICKEN: SLOW FALL ──────────────────────────────────────────────────────────────────
  //
  // `ChickenEntity.tickMovement` (.decomp): `if (!this.onGround && velocity.y < 0.0)
  // this.setVelocity(velocity.multiply(1.0, 0.6, 1.0));` — read in full, the 0.6 is the jar's.
  Passive.CHICKEN_FALL_MULT = 0.6;

  // ── CHICKEN: WING FLAP ANIMATION (loop/renderres-s104) ──────────────────────────────────
  //
  // `ChickenEntity.tickMovement` (.decomp/net/minecraft/entity/passive/ChickenEntity.java,
  // lines 73-89), the STATE half only -- prev snapshot then the same three updates the jar
  // does, in the jar's own order (maxWingDeviation before flapSpeed before flapProgress). The
  // POSE half (the sin curve `ChickenEntityRenderer.method_3893` lines 20-23, and the roll
  // assignment `ChickenEntityModel.setAngles` lines 74-76) is `ER.chickenWingRoll` +
  // `ER.setupAnimDelta`'s chicken branch, 07j_entityrender.js -- this file's own scope is
  // state, not overlay-draw (see `Passive.OWED`'s note on the sheep neck pose for why that
  // line is drawn the same way here).
  Passive.tickChickenFlap = function (e) {
    if (!e || (e.type !== 'chicken' && e.type !== 'parrot')) return;   // ParrotEntity.flapWings is the same three updates
    e.prevFlapProgress = e.flapProgress || 0;
    e.prevMaxWingDeviation = e.maxWingDeviation || 0;
    var dev = (e.maxWingDeviation || 0) + (!e.onGround && !(e.type === 'parrot' && e.vehicle) ? 4.0 : -1.0) * 0.3;
    e.maxWingDeviation = dev < 0 ? 0 : (dev > 1 ? 1 : dev);
    var speed = e.flapSpeed === undefined ? 1.0 : e.flapSpeed;
    if (!e.onGround && speed < 1.0) speed = 1.0;
    speed *= 0.9;
    e.flapSpeed = speed;
    e.flapProgress = (e.flapProgress || 0) + speed * 2.0;
    if (!e.onGround && NS.GameEvent && (e.ticksAlive | 0) % 10 === 0) NS.GameEvent.emit('flap', e.x, e.y, e.z, e);   // ParrotEntity/Bee/Bat flap -> FLAP
  };

  // ── SHEEP: EAT GRASS (grass-eating, dirt conversion, wool regrow, baby growth boost) ────
  //
  // `EatGrassGoal` (.decomp/net/minecraft/entity/ai/goal/EatGrassGoal.java), read in full —
  // QUEUE 0.2 (G18c) item 1. `MAX_TIMER = 40` and the trigger tick `getTickCount(4)` are the
  // jar's own GOAL ticks (`toGoalTicks(n) = ceilDiv(n,2)`, since `shouldRunEveryTick()` is not
  // overridden) — vanilla's own `GoalSelector` only calls a non-`shouldRunEveryTick` goal's
  // `tick()` every OTHER real tick, so 20 goal-ticks land 40 real ticks apart and 2 goal-ticks
  // land 4 real ticks apart. This engine's own `GoalSelector.tick()` has NO alternator
  // (07k_goals.js's own header) and runs every real tick, so — the SAME reproduction rule
  // `Ai.HorseBondWithPlayerGoal`'s own header (07k_goals.js) already used for this exact
  // halving — the RAW jar constants (40, 4) are used directly here rather than their halved
  // goal-tick form.
  Passive.EAT_GRASS_MAX_TIMER = 40;     // EatGrassGoal.MAX_TIMER
  Passive.EAT_GRASS_TRIGGER = 5;        // getTickCount(4) = 2 goal ticks; start() also ticks once, so 34 real ticks after start is timer 40-1-34 = 5 (#6301 lockstep)
  // canStart: nextInt(isBaby() ? 50 : 1000) == 0 - RAW in the jar, but vanilla only evaluates canStart
  // every OTHER tick and this selector has no alternator, so the per-tick roll is doubled (referee: 17%
  // vs 31% eaten by tick 400 at 1/1000 per tick).
  Passive.EAT_GRASS_BABY_ROLL = 100;
  Passive.EAT_GRASS_ADULT_ROLL = 2000;

  function blockIdAt(x, y, z) {
    var W = NS.World, S = NS.States;
    if (!W || !S || !W.getBlock) return -1;
    return S.block[W.getBlock(x, y, z)];
  }

  /**
   * `Entity.onEatingGrass` (`SheepEntity`'s own override, .decomp, read in full):
   * `setSheared(false)`, and — `if (isBaby()) growUp(60)` — the baby-growth boost, wired
   * through the SAME `Breed.ageUp` (`PassiveEntity.growUp`, `07m_breed.js`) every OTHER feed-
   * driven growth boost in this engine already goes through, not a second copy of it.
   */
  Passive.onEatingGrass = function (e) {
    if (!e || e.type !== 'sheep') return;
    e.sheared = false;
    if ((e.growAge | 0) < 0 && NS.Breed && NS.Breed.ready && NS.Breed.ageUp) {
      NS.Breed.ageUp(e, 60, false);
    }
  };

  /**
   * `EatGrassGoal` itself — `canStart`/`start`/`stop`/`shouldContinue`/`tick`, transcribed at
   * this engine's own goal shape (`this.canUse`/`this.canContinueToUse`/`this.start`/`this.
   * stop`/`this.tick`, the same shape `Ai.BreakDoorGoal`/`Ai.TemptGoal` already use, 07k_goals.
   * js). Reads/writes the world through `NS.World`/`NS.States` directly — the same standing
   * `Ai.doorAt`/`Ai.breakDoor` already use for their own block edits rather than an injected
   * `ctx` — this IS the live world, not a per-caller fixture.
   *
   * ⚠ `world.sendEntityStatus(mob, (byte)10)` (the eating-particle burst on `start()`) is NOT
   * reproduced — this engine has no per-entity status-event channel to send it down, and it is
   * a purely cosmetic burst a headless check cannot see (`Passive.OWED`, named below —
   * actually a permanent, honest simplification rather than a queued item, since nothing in
   * play can ever observe it). The head-down POSE itself IS real: `e.eatGrassTimer` is kept in
   * step every tick, the field `07j_entityrender.js`'s own renderer reads for `SheepEntity.
   * getHeadRotation`'s own `eatGrassTimer > 0 ? PI/5 : ...` branch (that file's own remainder).
   */
  Passive.EatGrassGoal = function (e, ctx) {
    ctx = ctx || {};
    var rand = ctx.random || RNDFB;
    var mobGriefing = ctx.mobGriefing || function () { return true; };
    var timer = 0;
    function grassAt(x, y, z) {
      var R = NS.Reg;
      return !!(R && R.ready) && blockIdAt(x, y, z) === R.id.grass;
    }
    function grassBlockAt(x, y, z) {
      var R = NS.Reg;
      return !!(R && R.ready) && blockIdAt(x, y, z) === R.id.grass_block;
    }
    this.getTimer = function () { return timer; };
    this.canUse = function () {
      var R = NS.Reg;
      if (!e || e.type !== 'sheep' || !R || !R.ready) return false;
      var roll = (e.growAge | 0) < 0 ? Passive.EAT_GRASS_BABY_ROLL : Passive.EAT_GRASS_ADULT_ROLL;
      if (Math.floor(rand() * roll) !== 0) return false;
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      return grassAt(bx, by, bz) || grassBlockAt(bx, by - 1, bz);
    };
    this.canContinueToUse = function () { return timer > 0; };
    this.start = function () {
      timer = Passive.EAT_GRASS_MAX_TIMER;
      e.eatGrassTimer = timer;
      e.path = null;   // start(): mob.getNavigation().stop()
    };
    this.stop = function () {
      timer = 0;
      e.eatGrassTimer = 0;
    };
    // worldEvent 2001: the block's break sound + dust (cf. Tu.tickDigSound)
    function breakEvent(state, x, y, z) {
      var Sd = NS.Sound, Px = NS.Particle;
      if (Sd && Sd.blockBreak) Sd.blockBreak(state, x + 0.5, y + 0.5, z + 0.5, null);
      if (Px && Px.spawnBlockDust) for (var i = 0; i < 8; i++)
        Px.spawnBlockDust(x + RNDFB(), y + 0.1 + RNDFB() * 0.8, z + RNDFB(), 0, 0.1, 0, state, x, y, z, RNDFB);
    }
    this.tick = function () {
      timer = Math.max(0, timer - 1);
      e.eatGrassTimer = timer;
      if (timer !== Passive.EAT_GRASS_TRIGGER) return;
      var W = NS.World, S = NS.States;
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      if (grassAt(bx, by, bz)) {
        if (mobGriefing() && W && W.setBlock) {
          breakEvent(W.getBlock(bx, by, bz), bx, by, bz);
          W.setBlock(bx, by, bz, 0);
          if (NS.Save && NS.Save.record) NS.Save.record(bx, by, bz, 0);
        }
        Passive.onEatingGrass(e);
      } else if (grassBlockAt(bx, by - 1, bz)) {
        if (mobGriefing() && W && W.setBlock && S && S.stateOf) {
          var dirtState = S.stateOf('dirt');
          breakEvent(W.getBlock(bx, by - 1, bz), bx, by - 1, bz);
          W.setBlock(bx, by - 1, bz, dirtState);
          if (NS.Save && NS.Save.record) NS.Save.record(bx, by - 1, bz, dirtState);
        }
        Passive.onEatingGrass(e);
      }
    };
  };

  // ── SHEEP: DYE (right-click with a dye recolours an unsheared sheep) ─────────────────────────────────────
  //
  // `DyeItem.useOnEntity` (.decomp/net/minecraft/item/DyeItem.java), the SheepEntity half read
  // in full: `isAlive() && !isSheared() && getColor() != color`. `isAlive`/removed is the
  // CALLER's own guard (`14l_use.js`'s `Use.entityUse` already refuses a removed entity before
  // this is ever reached), so this function is the colour-and-refusal half only — the same
  // split `Passive.shear` already draws between the drop math here and the durability/sound
  // half `14l_use.js` owns.
  Passive.dyeSheep = function (e, color) {
    if (!e || e.type !== 'sheep' || e.sheared) return false;
    if (!color || (e.woolColor || 'white') === color) return false;
    e.woolColor = color;
    return true;
  };

  // ── SHEEP: FLEECE TINT (the wool-coat overlay's colour, read by 07j_entityrender.js) ────
  //
  // `DyeColor.java`'s own sixteen enum constants (.decomp lines 11-26), read in ordinal order —
  // each entry's 3rd positional int is the packed RGB the constructor (lines 44-47) turns into
  // `colorComponents` (`(v>>16&255)/255, (v>>8&255)/255, (v&255)/255`). Transcribed as packed
  // ints here rather than as floats so this table reads exactly like the enum body it comes
  // from — the division happens in `Passive.fleeceColor`, not smuggled into these constants.
  Passive.DYE_COLOR_SRC = {
    white: 16383998, orange: 16351261, magenta: 13061821, light_blue: 3847130,
    yellow: 16701501, lime: 8439583, pink: 15961002, gray: 4673362,
    light_gray: 10329495, cyan: 1481884, purple: 8991416, blue: 3949738,
    brown: 8606770, green: 6192150, red: 11546150, black: 1908001
  };

  // `DyeColor.byId(int)` (.decomp/net/minecraft/util/DyeColor.java:11-26), read in full: the
  // enum's OWN declared id order (0..15), the SAME order `Passive.DYE_COLOR_SRC` above was
  // already written in -- named here as its own array because `jebColorAt` below indexes it
  // by an ARITHMETIC id (`SheepWoolFeatureRenderer.method_4198`, .decomp lines 44-50, `%
  // DyeColor.values().length`), not by name, and object key order is not a contract worth
  // leaning on twice.
  Passive.DYE_COLOR_ORDER = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime',
    'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

  /**
   * `SheepWoolFeatureRenderer.method_4198`'s `jeb_` branch (.decomp/net/minecraft/client/
   * render/entity/feature/SheepWoolFeatureRenderer.java:44-55), read in full and transcribed
   * arithmetic-for-arithmetic, not approximated:
   *
   *   int idx0 = sheep.age / 25 + sheep.id;             // line 46 ($$14)
   *   int n = DyeColor.values().length;                 // 16, line 47 ($$15)
   *   int c0 = idx0 % n, c1 = (idx0 + 1) % n;            // lines 48-49 ($$16/$$17)
   *   float t = ((sheep.age % 25) + tickDelta) / 25.0F;  // line 50 ($$18)
   *   lerp(SheepEntity.getRgbColor(byId(c0)), SheepEntity.getRgbColor(byId(c1)), t);  // 51-56
   *
   * `SheepEntity.getRgbColor` (.decomp SheepEntity.java:99) is a cache over `getDyedColor`
   * (lines 89-96) -- exactly `Passive.fleeceColor` above, already real and unit-tested
   * (mobrendercheck.mjs) -- so no second colour table is built for this. `e.age`/`e.id` are
   * the same fields `07i_entitylist.js` already advances/assigns for every entity (its own
   * `(e.age + e.id) % ...` staggering at line 1455 is the identical pairing, not a new one
   * invented here). `partial` (tickDelta) defaults to 0, matching every OTHER per-tick-only
   * caller in this file when a render-time partial isn't threaded through.
   */
  Passive.jebColorAt = function (e, partial) {
    var age = (e && e.age) || 0, id = (e && e.id) || 0;
    var n = Passive.DYE_COLOR_ORDER.length;   // 16, DyeColor.values().length
    var idx0 = ((Math.floor(age / 25) + id) % n + n) % n;
    var idx1 = (idx0 + 1) % n;
    var t = (((age % 25) + (partial === undefined ? 0 : partial)) / 25);
    var c0 = Passive.fleeceColor(Passive.DYE_COLOR_ORDER[idx0]);
    var c1 = Passive.fleeceColor(Passive.DYE_COLOR_ORDER[idx1]);
    return [
      c0[0] * (1 - t) + c1[0] * t,
      c0[1] * (1 - t) + c1[1] * t,
      c0[2] * (1 - t) + c1[2] * t
    ];
  };

  /**
   * `SheepEntity.getDyedColor(DyeColor)` (.decomp, private, lines 89-96), read in full: WHITE is
   * a LITERAL (0.9019608 per channel — NOT `DyeColor.field_7952`'s own `colorComponents`, the
   * jar special-cases it), every other colour is its own `getColorComponents()` (`DyeColor.
   * java` lines 44-47, off `Passive.DYE_COLOR_SRC` above) scaled by 0.75. `SheepEntity.
   * getRgbColor(DyeColor)` (line 99) is just `COLORS.get(color)`, a cache over this same
   * function baked at class-init — computed on demand here instead, since nothing here redraws
   * fast enough for that to matter.
   */
  Passive.fleeceColor = function (name) {
    if (!name || name === 'white' || Passive.DYE_COLOR_SRC[name] === undefined) {
      return [0.9019608, 0.9019608, 0.9019608];
    }
    var v = Passive.DYE_COLOR_SRC[name];
    var r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
    return [r * 0.75, g * 0.75, b * 0.75];
  };

  /**
   * `SheepWoolFeatureRenderer.method_4198` (.decomp lines 26-66), the GATE half only — the
   * colour half is `Passive.fleeceColor`/`Passive.jebColorAt` above. Sheared (line 29) draws
   * nothing at all. The jar's INVISIBLE branch (line 30) draws ONLY through an entity-outline
   * render pass (`RenderLayer.getOutline`) this engine has no channel for at all — refusing
   * here too is the honest match for "no fleece", not a guess (named again in `Passive.OWED`).
   * `jeb_` (lines 44-55, the per-tick rainbow cycle keyed off a custom name tag) is STRUCK off
   * `Passive.OWED` (loop/nameplate) — `Passive.fleeceTintFor` below routes to it the moment
   * `e.customName === 'jeb_'`. Invisibility ITSELF (the status effect, not the outline pass) is a
   * RENDER-time fact read at the call site in `07j_entityrender.js`, the same split D-471's own
   * collar gate already draws between `Tm.collarKey`'s RULE and that file's own effect check.
   */
  Passive.fleeceTintFor = function (e, partial) {
    if (!e || e.type !== 'sheep' || e.sheared) return null;
    // loop/nameplate -- `e.customName` now exists (14l_use.js's name_tag branch), so the
    // `jeb_` half of this file's own OWED line is real: `SheepWoolFeatureRenderer.method_4198`
    // (.decomp, read whole) checks `hasCustomName() && "jeb_".equals(getName().asString())`
    // BEFORE the plain per-colour lookup -- exact-string, no case-fold, matching
    // `Use.entityUse`'s own verbatim `display.Name` copy.
    if (e.customName === 'jeb_') return Passive.jebColorAt(e, partial);
    return Passive.fleeceColor(e.woolColor || 'white');
  };

  // ── PIG: SADDLE (equip only — see this file's own header for what riding/steering still owes) ──
  //
  // `PigEntity implements Saddleable` (.decomp lines 50, 158-182), read in full. `canBeSaddled`
  // (lines 158-161) is `isAlive() && !isBaby()` — NO taming requirement at all, unlike a horse
  // (`Mnt.canBeSaddled`, 07r_mount.js, gates on `e.tamed` too) — pigs are never tamed in
  // vanilla. `saddle(SoundCategory)` (lines 176-182) just flips the flag; the sound is
  // `Use.OWED`'s own gap, the same simplification `Mnt.saddle`'s own header already takes for
  // horses (no per-entity sound channel exists yet).
  Passive.pigCanBeSaddled = function (e) {
    return !!(e && e.type === 'pig' && e.dead !== true && !e.removed && (e.growAge | 0) >= 0);
  };
  Passive.pigIsSaddled = function (e) { return !!(e && e.saddled); };
  /** D-550 -- `PigEntity.dropInventory` (.decomp 164-169): a saddled pig drops one saddle on
   *  death (`Cb.dropLoot` spawns it). Every other type drops nothing through this hook. */
  Passive.dropInventory = function (e) {
    if (!e || e.type !== 'pig' || !e.saddled) return [];
    e.saddled = false;
    return [{ item: 'saddle', count: 1 }];
  };

  /**
   * `SaddleItem.useOnEntity` (.decomp, read in full): refuses unless `!isSaddled() &&
   * canBeSaddled()`, else `saddle()` and `decrement(1)`. The stack-consume half (creative's own
   * exemption) is `14l_use.js`'s own call site, the same split `Passive.shear`'s durability
   * spend already draws — this function is the equip fact alone.
   */
  Passive.pigSaddle = function (e) {
    if (!Passive.pigCanBeSaddled(e) || Passive.pigIsSaddled(e)) return false;
    e.saddled = true;
    // PigEntity.saddle: playSoundFromEntity(null, this, ENTITY_PIG_SADDLE, NEUTRAL, 0.5F, 1.0F)
    if (!e.silent && NS.Sound && NS.Sound.entitySound)
      NS.Sound.entitySound('entity.pig.saddle', e.x, e.y, e.z, 0.5, 1, 'neutral', NS.Player);
    return true;
  };

  // ── PIG: CARROT-ON-A-STICK BOOST (pure math — SaddledComponent/ItemSteerable, .decomp) ──────
  //
  // `SaddledComponent` (.decomp): `MIN_BOOST_TIME = 140` (line 9), the roll range `nextInt(841)`
  // (line 36, `field_30061 = 700` at line 10 is `841 - 141`, i.e. the roll spans
  // `[140, 980]` inclusive — `nextInt(841)` returns `[0, 840]`, `+140` gives `[140, 980]`).
  // `boost(Random)` (lines 30-40) refuses a re-boost while already boosted (the durability-spend
  // half, `CarrotOnAStickItem.useOnEntity`'s own `consumeOnAStickItem()` gate, is the CALLER's
  // job — this function is the dice roll and latch alone, matching `Passive.pigSaddle`'s own
  // split above).
  Passive.PIG_BOOST_MIN = 140;
  Passive.PIG_BOOST_ROLL = 841;   // nextInt(841): [0, 840]

  Passive.pigBoost = function (e, rnd) {
    if (!e || e.boosted) return false;
    var r = rnd || RNDFB;
    e.boosted = true;
    e.boostedTime = 0;
    e.currentBoostTime = Math.floor(r() * Passive.PIG_BOOST_ROLL) + Passive.PIG_BOOST_MIN;
    return true;
  };

  /**
   * `PigEntity.getSaddledSpeed()` (.decomp lines 242-245): `movementSpeedAttr * 0.225`.
   * `ItemSteerable.travel`'s own boost line (lines 34-37, read in full): while `boosted`, the
   * speed gains `speed * 1.15 * sin(boostedTime / currentBoostTime * PI)` — a half-sine hump
   * that peaks at the boost's midpoint and is zero at both ends, not a flat multiplier.
   * `boostedTime` incrementing past `currentBoostTime` (line 29, the CALLER's own per-tick
   * job — not reproduced here, this function is one tick's speed READ, not the counter's own
   * advance) ends the boost. `PIG_SADDLED_SPEED_MUL` is the jar's own literal, not this
   * engine's movement-speed attribute default (which lives in 07h_entities.js).
   */
  Passive.PIG_SADDLED_SPEED_MUL = 0.225;

  Passive.pigTravelSpeed = function (movementSpeedAttr, e) {
    var base = movementSpeedAttr * Passive.PIG_SADDLED_SPEED_MUL;
    if (!e || !e.boosted || !(e.currentBoostTime > 0)) return base;
    return base + base * 1.15 * Math.sin((e.boostedTime || 0) / e.currentBoostTime * Math.PI);
  };

  // ── PIG: MOUNTING + CARROT-ON-A-STICK STEERING (loop/pigride-s98) ────────────────────────────
  //
  // `PigEntity.interactMob` (.decomp, read in full): saddled + no rider yet + not sneaking +
  // NOT holding this pig's own breeding food (carrot/potato/beetroot, `Br.isFood('pig', item)`)
  // mounts the rider UNCONDITIONALLY, whatever else is (or is not) in hand -- `Use.entityUse`
  // (14l_use.js, this session's own wiring) runs this check first, exactly where vanilla's own
  // override sits ahead of `super.interactMob`'s breed/saddle fallthrough. `Passive.pigMount`
  // is the state change alone (mirrors `Mnt.mount`'s own split, 07r_mount.js) -- it reuses the
  // SAME `e.rider`/`P.vehicle` field every horse-family mount already rides on, so
  // `Mnt.isRidden`, `Mnt.dismount`, `Mnt.mountedHeightOffset` and `Mnt.findDismountPos`
  // (07r_mount.js, all four read `e.rider`/`e`'s generic shape, none of them gate on
  // `Mnt.MOUNTABLE`) all keep working on a mounted pig with NO changes to that shared file.
  Passive.pigMount = function (e) {
    if (!e || e.type !== 'pig' || e.rider) return false;
    if (!Passive.pigIsSaddled(e)) return false;
    e.rider = 'player';
    return true;
  };

  /**
   * `PigEntity.canBeControlledByRider` (.decomp, read in full): the rider must be a player
   * holding a carrot on a stick in EITHER hand (`Items.field_8184`, `.decomp/net/minecraft/
   * item/Items.java` line 722-724, confirmed `"carrot_on_a_stick"`). This engine's single-
   * hotbar-slot player has no functional OFF-hand item anywhere else either (`14_player.js`'s
   * own `P.heldItem()` is the only "what am I holding" read any interaction in this codebase
   * consults) -- checking slot 40 (`14f_inventory.js`'s own offhand slot, real storage, just
   * never read by an interaction before now) is free, so it IS read here rather than silently
   * dropped; a plain `Passive.OWED` note would have been the wrong call once the one extra
   * read costs nothing.
   */
  Passive.pigCanBeControlledByRider = function (e) {
    if (!e || e.type !== 'pig' || e.rider !== 'player') return false;
    var P = NS.Player, IT = NS.Items;
    if (!P || !IT || !IT.ready) return false;
    if (P.heldItemName && P.heldItemName() === 'carrot_on_a_stick') return true;
    var Iv = NS.Inventory;
    if (Iv && P.inventory) {
      var off = Iv.getItem(P.inventory, 40);
      if (off && !Iv.isEmpty(off) && IT.nameOf(off.i | 0) === 'carrot_on_a_stick') return true;
    }
    return false;
  };

  /**
   * `ItemSteerable.travel` (.decomp, read in full) -- the pig-specific whole of it, called from
   * `07i_entitylist.js`'s own per-mob tick in the SAME slot `Mount.travelRidden` already
   * occupies for the horse family (that call site's own generic `isRidden(e) && isSaddled(e)`
   * gate would otherwise misfire on a saddled, ridden PIG too -- both flags are the same shared
   * `e.rider`/`e.saddled` fields horses use -- so this session's own dispatch edit there checks
   * `e.type === 'pig'` FIRST and calls this instead).
   *
   * UNCONTROLLED (no carrot in hand): vanilla's own `travel()` falls to its `else` branch,
   * which leaves `setMovementInput` running the mob's OWN goal-selector-driven input untouched
   * -- this engine's equivalent is simply not to touch `e.mobSpeed`/`e.zza` at all and let
   * whatever `Ai`'s goals already set for this tick stand (`07i_entitylist.js`'s own "AFTER THE
   * GOALS, BEFORE THE TRAVEL" ordering).
   *
   * CONTROLLED: yaw synced from the rider, pitch halved (`ItemSteerable.travel`'s own
   * `setPitch(pitch * 0.5F)`), `boostedTime` advanced (POST-increment compare, jar-exact:
   * `boosted && boostedTime++ > currentBoostTime` unboosts using the PRE-increment value, then
   * the speed read a few lines later sees the POST-increment one), `setMovementInput(0,0,1)` --
   * ALWAYS full forward, never steered by the rider's own forward/strafe keys the way a horse
   * is -- so `e.zza` is pinned to `1` rather than read from `e.riderInput`.
   */
  Passive.pigTravel = function (e, rnd) {
    var Ph = NS.Physics;
    if (!Ph) return;
    if (!Passive.pigCanBeControlledByRider(e)) { Ph.travelMob(e); return; }
    var ri = e.riderInput || {};
    if (ri.yaw !== undefined) e.yaw = ri.yaw;
    e.pitch = (ri.pitch || 0) * 0.5;
    if (e.boosted) {
      var bt = e.boostedTime || 0;
      var expired = bt > (e.currentBoostTime || 0);
      e.boostedTime = bt + 1;
      if (expired) e.boosted = false;
    }
    var Ent = NS.Entities;
    var base = e.movementSpeedAttr !== undefined ? e.movementSpeedAttr
      : ((Ent && Ent.attrsOf('pig').speed) || 0.25); // `PigEntity.createPigAttributes()`, .decomp
    e.mobSpeed = Passive.pigTravelSpeed(base, e);
    e.zza = 1;
    e.stepHeight = 1.0; e.maxUpStep = 1.0;   // #4111 ItemSteerable.travel controlled branch
    e.bodyYaw = e.headYaw = e.yaw; e.prevYaw = e.yaw;
    e.airStrafingSpeed = e.mobSpeed * 0.1;
    Ph.travelMob(e, 0);
  };

  // loop/renderres-s104 STRUCK: 'sheep eat-grass HEAD POSE' and 'chicken flap animation' --
  // both are now real end to end. State lives here (`e.eatGrassTimer`, `Passive.EatGrassGoal
  // .tick`, already-live; `Passive.tickChickenFlap`, new this pass); the pose half is
  // `ER.chickenWingRoll`/`ER.sheepEatGrass` + `ER.setupAnimDelta`'s chicken/sheep branches
  // (07j_entityrender.js), asserted by `tools/renderrescheck.mjs`.
  Passive.OWED = [
    // struck loop/jockey: chicken jockeys (hasJockey) are real -- Passive.setChickenJockey
    // (this file) + Undead.tryChickenJockey/trySpiderJockey/trySpiderEffect (07zk_undead.js).
    // Struck G21: ChickenEntity.getXpToDrop's own hasJockey?10 is now Xp.xpToDrop's own
    // chicken special case (07zz_xporb.js), fed by this file's own e.hasJockey. The
    // IsChickenJockey + rider round-trip is struck D-590 (07zw_mobnbt.js: hasJockey persisted,
    // riders re-mounted via vehicleIdx; mobnbtcheck).
  ];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
