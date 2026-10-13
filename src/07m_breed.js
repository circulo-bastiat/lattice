// 07m_breed.js — PLAN G18e: LOVE MODE, BREEDING, AND AGE.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// Vanilla splits this across two classes and so does this file: `AgeableMob` owns the AGE (one
// signed integer: negative is a baby counting up to nought, positive is a breeding cooldown
// counting down to nought) and `Animal` owns LOVE MODE and what happens when two animals in it
// touch. Everything below is those two classes' own arithmetic.
//
// ⚠⚠ **NOT ONE NUMBER HERE IS TYPED IN.** `tools/extract-breeding.mjs` reads `AgeableMob` and
// `Animal` out of the 1.18.2 bytecode — they are the only two classes in the jar carrying the
// `ForcedAge` and `InLove` NBT keys, which is how they are found without a mapping — and writes
// `tools/golden/breeding-1.18.2.tsv`: the eight constants and, per species, its own `isFood`.
// `tools/pack-entities.mjs` carries both into `NS.DATA.entities`, and `Entities.breedFood`
// and `Entities.BREED` are how they are read here. A constant in this file would be a D-263.
//
// ⚠⚠ **`e.growAge` IS NOT `e.age`, AND THE TWO ARE ONE TYPO APART.** `EntityList.spawn` has
// always given every entity an `age` — how many ticks it has existed, which is what the item
// despawn and the merge read. Vanilla's `AgeableMob.age` is a different thing entirely and it
// runs BACKWARDS from -24000. Reusing the field would have made every dropped item a baby and
// every cow despawn at twenty minutes (D-276: the bugs live in the joins).
//
// ⚠ WHAT IS NOT HERE, AND IS NAMED RATHER THAN GUESSED (`Breed.OWED`):
//   * loop/hearts (this session) closed the HEART and growth PUFF line: `07zx_particle.js`'s
//     substrate, wired from `Br.tickLove`/`Br.tickAge`/`Br.breed` (`Br.emitLoveHeart`/
//     `Br.emitGrowthPuff`/`Br.emitBreedHearts`). The DRAW is still owed -- `Particle.OWED`,
//     not this file's, names why (no particle atlas extracted).
//   * the experience orb is spawned and carries its value, but nothing picks one up (G21).
//   * `turtle` breeds by laying an EGG, not by spawning a child, and `mooshroom`, `panda`,
//     `fox`, `horse` and the tamable animals each have their own `getBreedOffspring` (llama
//     closed loop/llama-s97: `Breed.CHILD.llama`, off `LlamaEntity`'s own strength/variant
//     roll, .decomp).
//     Only the generic path is built, and `Breed.SPECIAL` refuses the species that need more.

(function (NS) {
  'use strict';
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6440)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = NS.JRandom ? new NS.JRandom(0x6440) : { s: 0x6440, nextDouble: function () { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return this.s / 4294967296; } }; return fbR.nextDouble(); }

  var Br = NS.Breed = { ready: false };

  /**
   * Species whose breeding is NOT the generic path, with what each one needs. A refusal is a
   * question someone has to answer; a generic baby turtle would be a silent lie (07i's header).
   */
  Br.SPECIAL = {
    // loop/turtle-s102 (QUEUE 0.2 G18 mobs) -- turtle LEFT Breed.SPECIAL this session: it
    // never goes through Breed.breed at all now -- Tu.MateGoal (07zp_turtle.js), the port
    // of TurtleEntity.MateGoal's own breed() override, sets hasEgg(true) and spawns the xp
    // orb (Br.spawnXp, read live) directly from the goal instead of calling the generic
    // child-spawning path this refusal used to guard. The real egg -> hatch -> baby chain
    // is Tu.LayEggGoal/Tu.placeEgg (07zp_turtle.js), not a Breed.CHILD row.
    // loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- panda LEFT Breed.SPECIAL this session: it
    // has a real Breed.CHILD.panda now (PandaEntity.initGenes, .decomp), the same shape
    // goat/fox/rabbit each left through before it (Pd.createChild, 07zl_panda.js).
    // loop/goat-s99 (QUEUE 0.2 G18c) -- goat LEFT Breed.SPECIAL this session: it has a real
    // Breed.CHILD.goat now (GoatEntity.method_35177, .decomp), the same shape rabbit/sheep/
    // donkey/mule/llama each left through before it (Gt.childScreaming, 07zj_goat.js).
    // loop/rabbit-s98 (QUEUE 0.2 G18c) -- rabbit LEFT Breed.SPECIAL this session: it has a
    // real Breed.CHILD.rabbit now (RabbitEntity.method_6620, .decomp), the same shape
    // sheep/wolf/cat/donkey/mule/llama/horse each left through before it.
    // loop/fox-s99 (QUEUE 0.2 G18c) -- fox ALSO left Breed.SPECIAL this session, the same
    // shape: a real Breed.CHILD.fox now (FoxEntity.method_18260, .decomp), trust handled by
    // Br.breed's own caller below rather than a refusal.
    // donkey/mule closed loop/donkey-s96 (QUEUE 0.2 G18e remainder) — `Breed.CHILD_SPECIES`/
    // `Breed.CHILD.donkey`/`.mule`/`Breed.MATE.mule` below, off `DonkeyEntity`/`MuleEntity`'s
    // own `canBreedWith`/`createChild` (.decomp, both read in full this pass). llama closed
    // loop/llama-s97 — `Breed.CHILD.llama` below, off `LlamaEntity.method_6804`'s own
    // strength/variant roll (.decomp). trader_llama closed loop/wtrader-s103: `LlamaEntity.
    // canBreedWith` (.decomp) is `other instanceof LlamaEntity`, no species check at all, so a
    // llama x trader_llama pair mates too — the SAME cross-type exception `Br.canMate` below
    // already carries for horse/donkey, extended by one more pair rather than duplicated.
    // loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- axolotl LEFT Breed.SPECIAL this session:
    // it has a real Breed.CHILD.axolotl now (AxolotlEntity.createChild, .decomp), the same
    // shape (Ax.createChild, 07zm_axolotl.js).
    // QUEUE 0.2 (G18 mobs) -- bee LEFT Breed.SPECIAL this unit: `BeeEntity` (.decomp, read in
    // full) overrides NONE of `isBreedingItem`/`canBreedWith`/`createChild` -- it is a fully
    // generic `AnimalEntity`, and `entities.json`'s own `breeding.bee` row is already
    // `{k:'tag', t:['#minecraft:flowers']}` (confirmed live), so the generic path (no
    // `Breed.CHILD.bee` needed -- child defaults to the same species, which is correct here)
    // was already right; the old comment on this entry ('breeding also needs a hive') does not
    // hold up against a class with no such gate.
  };

  Br.OWED = [
    // QUEUE 0.2 (mob swing/breed remainder): wolf, cat and now sheep (`Br.MATE`/`Br.CHILD`,
    // 07w_passive.js's own `e.woolColor`) are the `Breed.SPECIAL` entries this engine can
    // actually close, because they are the species with supporting per-entity state
    // (`tamed`/`owner`/`collarColor`/`catVariant`, 07n_tame.js; `woolColor`, G18c). Every other
    // `Breed.SPECIAL` entry names a field this engine has never built ANYWHERE — panda no
    // gene pair, fox no trust list, horse
    // no attribute rolls (llama's OWN roll closed loop/llama-s97), axolotl no variant,
    // turtle no egg-laying, mooshroom no
    // mushroom-type — though the species themselves are real, spawnable, textured mobs
    // (`extract-mob-textures.mjs`, `extract-models.mjs`'s own sheep_fur read). Writing a
    // `getBreedOffspring` rule against a field that does not exist would be inventing the field
    // to make the rule look closed, the
    // opposite of `Breed.SPECIAL`'s own point (07m_breed.js header). Each such field is its own
    // feature (dyeing, a screaming-goat behaviour, a gene system) and belongs to whichever
    // stage builds it, not to a breeding pass.
    // STRUCK loop s111: Br.SPECIAL is EMPTY (every species left it — turtle/panda/goat/fox/
    // rabbit/sheep/donkey/mule/llama/axolotl/mooshroom each through its own Breed.CHILD row or goal).
    'a tempt ingredient of its own: vanilla builds TemptGoal with its own Ingredient, and for ' +
      'cow that Ingredient is Items.WHEAT, the same item isFood reads (refereed, bij.u()). ' +
      'Any species rostered later needs its own read rather than this assumption.'
  ];

  Br.init = function () {
    var E = NS.Entities;
    if (!E || !E.ready || !E.BREED || !Number.isFinite(E.BREED.inLoveTicks)) { Br.ready = false; return Br; }
    Br.C = E.BREED;
    Br.ready = true;
    return Br;
  };

  // ── the food question ──────────────────────────────────────────────────────────────────────
  /**
   * `Animal.isFood(stack)` for a type, by ITEM NAME. Four answers, and they are different
   * questions: a list, a tag, `none` (vanilla says this animal cannot be bred at all — parrot
   * and polar bear) and `predicate` (the rule is not a list: a wolf takes any edible item whose
   * FoodProperties say meat, which needs the food table G19d will build).
   */
  /**
   * D-493 — `WolfEntity.isBreedingItem`: `item.isFood() && item.getFoodComponent().isMeat()`.
   * The eleven `FoodComponents` built with `.meat()` (Yarn `net.minecraft.item.FoodComponents`,
   * .decomp, read in full): each registers the item of the same name. The wolf's predicate is
   * exactly this set, so it is a list after all — just one the entity table cannot state.
   */
  Br.MEAT = ['beef', 'chicken', 'cooked_beef', 'cooked_chicken', 'cooked_mutton', 'cooked_porkchop',
             'cooked_rabbit', 'mutton', 'porkchop', 'rabbit', 'rotten_flesh'];

  Br.isFood = function (type, item) {
    var f = NS.Entities.breedFood(type);
    if (!f || !item) return false;
    if (f.k === 'predicate') return NS.Entities.bare(type) === 'wolf' && Br.MEAT.indexOf(String(item).replace('minecraft:', '')) >= 0;
    if (f.k === 'none') return false;
    for (var i = 0; i < f.i.length; i++) if (f.i[i] === item) return true;
    var T = NS.Tags;
    if (T && T.ready && T.itemIn) {
      for (var j = 0; j < f.t.length; j++) {
        var name = f.t[j].replace(/^#/, '').replace(/^minecraft:/, '');
        if (T.itemIn(name, item)) return true;
      }
    }
    return false;
  };
  /**
   * The registry name of whatever a caller calls a held item: a name, an inventory stack, or
   * the FUNCTION the live player carries (`P.heldItem()`). Returns '' when there is nothing.
   */
  Br.itemNameOf = function (stack) {
    if (!stack) return '';
    if (typeof stack === 'function') { try { stack = stack(); } catch (err) { return ''; } }
    if (!stack) return '';
    if (typeof stack === 'string') return stack;
    var IT = NS.Items;
    if (IT && stack.i !== undefined && stack.i >= 0) return IT.nameOf(stack.i) || '';
    return '';
  };

  /** True when this engine will run the whole breeding loop for a type, not just half of it. */
  Br.canBreed = function (type) {
    var f = NS.Entities.breedFood(type);
    if (!f || f.k === 'none') return false;
    if (f.k === 'predicate' && NS.Entities.bare(type) !== 'wolf') return false;
    return !Br.SPECIAL[NS.Entities.bare(type)];
  };

  // ── AgeableMob: the age ────────────────────────────────────────────────────────────────────
  Br.getAge = function (e) { return e.growAge | 0; };
  Br.isBaby = function (e) { return (e.growAge | 0) < 0; };
  /**
   * `AgeableMob.setAge`. The sign crossing is what makes a baby a baby, so it is the only thing
   * this has to notice; `e.isBaby` is kept in step because the goals (`FollowParentGoal`) and
   * the renderer both read the flag rather than the number.
   *
   * ⚠ AND THE BOX FOLLOWS THE SIGN. Vanilla's `setAge` fires the synced-data update that calls
   * `refreshDimensions()`, which is why a calf fits under a slab its mother does not — the
   * crossing is the event, not the tick, so this is the only place that needs to know.
   */
  Br.setAge = function (e, age) {
    var wasBaby = !!e.isBaby;
    e.growAge = age | 0;
    e.isBaby = e.growAge < 0;
    if (wasBaby !== e.isBaby) Br.refreshDimensions(e);
  };
  /**
   * `LivingEntity.getDimensions(pose)` = the TYPE's box scaled by `getScale()`, and
   * `getScale()` is `isBaby() ? 0.5F : 1.0F` — one class ABOVE `AgeableMob`, so it is every
   * living entity's rule and not an animal's. The 0.5 is `Entities.BREED.babyScale`, read out
   * of the bytecode by `extract-breeding.mjs` like everything else here.
   */
  /** `getScaleFactor()` overrides (.decomp): TurtleEntity.java:263 is 0.3F for a baby. */
  Br.SCALE_OVERRIDE = { turtle: 0.3 };
  Br.refreshDimensions = function (e) {
    var E = NS.Entities;
    var d = E && E.ready ? E.dimensions(e.type) : null;
    if (!d) return;
    var s = Br.isBaby(e) ? (Br.SCALE_OVERRIDE[e.type] || Br.C.babyScale) : 1;
    e.width = d.width * s;
    e.height = d.height * s;
  };
  /** `AgeableMob.setBaby(boolean)` — the start age is the jar's -24000, not a guess. */
  Br.setBaby = function (e, baby) { Br.setAge(e, baby ? Br.C.babyStartAge : 0); };
  /**
   * `AgeableMob.ageUp(amount, forced)`. ⚠ THE AMOUNT IS IN SECONDS AND THE AGE IS IN TICKS —
   * the multiplier is the jar's `ageUpUnit`. `forced` is the feeding path: it banks the delta
   * in `forcedAge` and, the moment the animal actually reaches nought, re-applies it, which is
   * why feeding a baby past adulthood does not overshoot.
   */
  Br.ageUp = function (e, amount, forced) {
    var age = Br.getAge(e), prev = age;
    age += (amount | 0) * Br.C.ageUpUnit;
    if (age > 0) age = 0;
    var delta = age - prev;
    Br.setAge(e, age);
    if (forced) {
      e.forcedAge = (e.forcedAge | 0) + delta;
      if (!(e.forcedAgeTimer > 0)) e.forcedAgeTimer = Br.C.forcedAgeTimer;
    }
    if (Br.getAge(e) === 0) Br.setAge(e, e.forcedAge | 0);
  };

  // ── Animal: love mode ──────────────────────────────────────────────────────────────────────
  Br.isInLove = function (e) { return (e.inLove | 0) > 0; };
  /** `Animal.canFallInLove` — NOT the same question as "may this animal be fed". */
  Br.canFallInLove = function (e) { return !((e.inLove | 0) > 0); };
  Br.setInLove = function (e, player) {
    e.inLove = Br.C.inLoveTicks;
    if (player) e.loveCause = player;
  };
  /** `Animal.lovePlayer` (AnimalEntity.java:196-202): setInLove + `sendEntityStatus(18)`, the 7-heart burst. */
  Br.lovePlayer = function (e, player, rand) {
    Br.setInLove(e, player);
    Br.emitBreedHearts(e, rand);
  };
  Br.resetLove = function (e) { e.inLove = 0; };

  /**
   * `Entity.getParticleX(1.0)`/`getRandomBodyY()+0.5`/`getParticleZ(1.0)` (.decomp/net/
   * minecraft/entity/Entity.java:2951-2988), reproduced here because this engine's entities
   * are plain data objects, not `Entity` instances carrying those methods themselves.
   */
  Br.particlePoint = function (e, rand) {
    var r = rand || RNDFB;
    var w = e.width || 0, h = e.height || 0;
    return [e.x + w * (2 * r() - 1), e.y + h * r() + 0.5, e.z + w * (2 * r() - 1)];
  };

  /** `Animal.tickMovement`'s heart -- `Br.tickLove` calls this on the `loveTicks % 10 == 0`
   *  tick (AnimalEntity.java:60-67). The gaussian*0.02 roll is made for RNG-consumption parity
   *  with the jar even though `Px.spawn('heart', ...)` itself discards it (see that file's own
   *  header for why: `EmotionParticle`'s constructor never reads the velocity it is handed). */
  Br.emitLoveHeart = function (e, rand) {
    var Px = NS.Particle;
    if (!Px) return;
    var r = rand || RNDFB;
    var pt = Br.particlePoint(e, r);
    Px.spawn('heart', pt[0], pt[1], pt[2],
      Px._gauss(r) * 0.02, Px._gauss(r) * 0.02, Px._gauss(r) * 0.02, r);
  };

  /** `Animal.handleStatus(18)` -- seven hearts, `Br.breed`'s own caller (AnimalEntity.java:
   *  243-249). Returns the count actually spawned (`Px.MAX` can refuse some). */
  Br.emitBreedHearts = function (e, rand) {
    var Px = NS.Particle;
    if (!Px) return 0;
    var r = rand || RNDFB;
    var pt = Br.particlePoint(e, r);
    return Px.spawnBurst('heart', pt[0], pt[1], pt[2], r);
  };

  /** `PassiveEntity.tickMovement`'s growth puff -- `Br.tickAge` calls this on the
   *  `forcedAgeTimer % growParticleInterval == 0` tick, velocity (0,0,0) verbatim
   *  (PassiveEntity.java:126-133: `addParticle(HAPPY_VILLAGER, x, y+0.5, z, 0.0, 0.0, 0.0)`). */
  Br.emitGrowthPuff = function (e, rand) {
    var Px = NS.Particle;
    if (!Px) return;
    var r = rand || RNDFB;
    var pt = Br.particlePoint(e, r);
    Px.spawn('happy_villager', pt[0], pt[1], pt[2], 0, 0, 0, r);
  };

  /** `Animal.canMate` — same class, not merely the same type, and BOTH in love. */
  /**
   * `Animal.canMate` — same class in vanilla, which this engine reads as "same type", WITH ONE
   * NAMED EXCEPTION: `DonkeyEntity.canBreedWith`/`HorseEntity.canBreedWith` (.decomp, loop/
   * donkey-s96) each explicitly accept the OTHER of the pair too (-> a mule, `Br.CHILD_SPECIES`
   * below) — no other species in this engine has a cross-type override at all, so this is the
   * one place `a.type !== b.type` does not mean an automatic refusal.
   */
  // loop/wtrader-s103 — `LlamaEntity.canBreedWith` (.decomp) accepts ANY llama-family
  // partner (`other instanceof LlamaEntity`, no type check at all), so llama x
  // trader_llama is the SECOND named cross-type pair, same shape as horse/donkey.
  Br.crossMate = function (a, b) {
    var ta = NS.Entities.bare(a), tb = NS.Entities.bare(b);
    return (ta === 'horse' && tb === 'donkey') || (ta === 'donkey' && tb === 'horse') ||
      (ta === 'llama' && tb === 'trader_llama') || (ta === 'trader_llama' && tb === 'llama');
  };
  Br.canMate = function (a, b) {
    if (a === b || !a || !b) return false;
    var ta = NS.Entities.bare(a.type), tb = NS.Entities.bare(b.type);
    if (ta !== tb && !Br.crossMate(ta, tb)) return false;
    var ga = Br.MATE[ta];
    if (ga && !ga(a, b)) return false;
    if (ta !== tb) {
      var gb = Br.MATE[tb];
      if (gb && !gb(b, a)) return false;
    }
    return Br.isInLove(a) && Br.isInLove(b);
  };

  /**
   * D-493 — the per-species `canBreedWith` overrides (Yarn, .decomp): WolfEntity — both tamed,
   * and the partner not in its sitting pose; CatEntity — both tamed. (Then `super`'s in-love test.)
   * `mule` (loop/donkey-s96) — `MuleEntity` never overrides `HorseBaseEntity.canBreedWith` at
   * all, so it keeps that base class's own literal `return false`: a mule refuses EVERY
   * partner, same species included — infertile is not merely "no createChild", it never even
   * reaches `isInLove`.
   */
  // HorseBaseEntity.canBreed (.decomp): no passengers/vehicle, tame, adult, full health
  // (horse/donkey/llama all route through it; the in-love half is Br.canMate's own).
  function equidCanBreed(e) {
    return !e.rider && !e.vehicle && !!e.tamed && !Br.isBaby(e) &&
      !(e.health < (e.maxHealth !== undefined ? e.maxHealth : Infinity));
  }
  function equidMate(a, b) { return equidCanBreed(a) && equidCanBreed(b); }
  Br.MATE = {
    horse: equidMate, donkey: equidMate, llama: equidMate, trader_llama: equidMate,
    wolf: function (a, b) { return !!a.tamed && !!b.tamed && !b.sitting; },
    cat: function (a, b) { return !!a.tamed && !!b.tamed; },
    mule: function () { return false; },
    // ZombieHorseEntity/SkeletonHorseEntity keep HorseBaseEntity.canBreedWith's literal false (#3958)
    zombie_horse: function () { return false; },
    skeleton_horse: function () { return false; }
  };

  /**
   * `DonkeyEntity.createChild`/`HorseEntity.createChild` (.decomp, loop/donkey-s96): the
   * resulting SPECIES a bred pair produces — the only species this engine's generic `Br.breed`
   * does not simply reuse `a.type` for. `MuleEntity.createChild` always answers `mule` too
   * (unreachable through `Br.canMate` — `Br.MATE.mule` above refuses first — but named the
   * same way the jar names it, not special-cased around).
   */
  Br.CHILD_SPECIES = function (aType, bType) {
    var a = NS.Entities.bare(aType), b = NS.Entities.bare(bType);
    if (a === 'mule') return 'mule';
    if ((a === 'horse' && b === 'donkey') || (a === 'donkey' && b === 'horse')) return 'mule';
    return a;
  };

  /**
   * D-493 — the per-species `createChild` rules for the species this engine breeds (Yarn,
   * .decomp): WolfEntity — the child takes the first parent's owner and is tamed if it had one;
   * CatEntity — variant from either parent (nextBoolean), and if the first parent is tamed, the
   * child is tamed to its owner with either parent's collar colour (nextBoolean again).
   */
  Br.CHILD = {
    // HoglinEntity.createChild -> setPersistent() on the baby (.decomp)
    hoglin: function (child) { child.persistent = true; },
    wolf: function (child, a, b, rand) {
      // WolfEntity.createChild -> pup.setTamed(true): max_health 20 and setHealth(20) (as Tm.feed does)
      if (a.owner) { child.owner = a.owner; child.tamed = true; child.maxHealth = 20; child.health = 20; }
    },
    cat: function (child, a, b, rand) {
      child.catVariant = rand() < 0.5 ? a.catVariant : b.catVariant;
      if (a.tamed) {
        child.owner = a.owner; child.tamed = true;
        child.collarColor = rand() < 0.5 ? a.collarColor : b.collarColor;
      }
    },
    // QUEUE 0.2 (G18c) -- `SheepEntity.method_6640`/`getChildColor` (.decomp), the sheep half
    // of `Breed.SPECIAL` this session closes (the entry above named it, `Br.SPECIAL.sheep`
    // removed now that the field it needed -- `e.woolColor`, `07w_passive.js` -- exists).
    // s101 -- MooshroomEntity.method_6495/chooseBabyType (.decomp): Breed.SPECIAL.mooshroom closed.
    mooshroom: function (child, a, b, rand) {
      if (NS.Mooshroom) child.mooshroomType = NS.Mooshroom.chooseBabyType(a, b, rand);
    },
    sheep: function (child, a, b, rand) {
      var Ps = NS.Passive;
      if (Ps) child.woolColor = Ps.childWoolColor(a.woolColor, b.woolColor, rand);
    },
    /**
     * QUEUE 0.2 (G18e remainder) — `HorseBaseEntity.setChildAttributes` (.decomp), verbatim:
     * each of the three attributes is `(parentA's base value + parentB's base value + a fresh
     * getChildXBonus() roll) / 3.0`. This engine keeps each parent's own rolled value in
     * `xAttr` (`Mount.rollAttributes`/this same averaging, both 07r_mount.js/07m_breed.js),
     * falling back to the flat vanilla DEFAULT for a parent from before this session's roll
     * existed (an old save, or a fixture built by hand) — the jar's own `getAttributeBaseValue`
     * always has SOME base value to read; this is this engine's version of "always has one".
     */
    horse: function (child, a, b, rand) {
      var M = NS.Mount;
      if (!M) return;
      M.setChildAttributes(child, a, b, rand);

      // QUEUE 0.2 (G18e remainder, this pass) -- `HorseEntity.createChild`'s OTHER half
      // (.decomp, read in full): the colour/marking roll, `Mount.rollChildVariant`. Runs LAST
      // and unconditionally, same shape as the three attributes above -- it OVERWRITES whatever
      // `EL.spawn`'s own `EL.DEFAULTS.horse` default hook (07i_entitylist.js) already rolled for
      // the freshly spawned child entity, exactly the way the attribute averaging above already
      // overwrites that same default hook's `Mount.rollAttributes` call. Only reached when the
      // CHILD itself is a horse (`Breed.CHILD_SPECIES` sent a horse+donkey cross to `.mule`
      // below instead, which has no variant at all — .decomp, neither donkey/mule class tracks
      // one).
      if (M.rollChildVariant) child.variant = M.rollChildVariant(a, b, rand);
    },
    /**
     * loop/donkey-s96 (QUEUE 0.2 G18e remainder close) — `HorseBaseEntity.setChildAttributes`
     * alone (`Mount.setChildAttributes`), no variant roll: this is what a donkey+donkey pair,
     * OR a horse+donkey pair whose `Breed.CHILD_SPECIES` answer is `donkey` (never happens —
     * that combination always yields `mule` — named so the reader doesn't have to re-derive it)
     * produces. Reached only for a same-species donkey pair in practice.
     */
    donkey: function (child, a, b, rand) {
      var M = NS.Mount;
      if (M) M.setChildAttributes(child, a, b, rand);
    },
    /**
     * `MuleEntity` (.decomp): no `createChild` attribute logic of its own beyond the SAME
     * `setChildAttributes` every `HorseBaseEntity` subtype inherits — reached whenever
     * `Breed.CHILD_SPECIES` answers `mule` (a horse x donkey cross, either order; a mule
     * parent itself never reaches here at all, `Breed.MATE.mule` refuses first).
     */
    mule: function (child, a, b, rand) {
      var M = NS.Mount;
      if (M) M.setChildAttributes(child, a, b, rand);
    },
    /**
     * `LlamaEntity.method_6804(ServerWorld, PassiveEntity)` (.decomp, loop/llama-s97) — the real
     * `getBreedOffspring`/`createChild` pairing for llama, read in full: the same three-attribute
     * `setChildAttributes` averaging every `HorseBaseEntity` subtype shares, PLUS its own two
     * extras neither donkey nor mule track — `Mount.rollChildStrength` (`random.nextInt(max(a,b
     * strength))+1`, +1 on a flat 3% roll) and `Mount.rollChildLlamaVariant` (a coin flip onto
     * one parent's own `variant`, no fresh roll). Only ever reached for a same-species llama
     * pair — `Breed.CHILD_SPECIES` echoes `a.type` back unchanged for every pair this file does
     * not special-case, and llama gets no entry there (no horse-x-llama cross exists in vanilla).
     */
    llama: function (child, a, b, rand) {
      var M = NS.Mount;
      if (!M) return;
      M.setChildAttributes(child, a, b, rand);
      M.setStrength(child, M.rollChildStrength(a, b, rand));
      child.variant = M.rollChildLlamaVariant(a, b, rand);
    },
    /**
     * loop/rabbit-s98 (QUEUE 0.2 G18c) -- `RabbitEntity.method_6620` (`createChild`, .decomp,
     * read in full): a fresh biome-based roll (`Rb.chooseTypeAt`) is the DEFAULT, overridden 19
     * times out of 20 (`random.nextInt(20) != 0`) by -- coin-flip, `nextBoolean()` -- the OTHER
     * parent's own type, or else THIS parent's (`a`'s) own type. Vanilla calls the child's own
     * `chooseType` unconditionally before the override, so the fresh roll still happens (and
     * still costs a `rand()` call) even on the 95% path that immediately discards it -- read
     * verbatim, not simplified away, so a seeded check sees the same number of rolls the jar
     * makes.
     */
    rabbit: function (child, a, b, rand) {
      var Rb = NS.Rabbit;
      if (!Rb) return;
      var fresh = Rb.chooseTypeAt(child.x, child.z, rand);
      var type = fresh;
      if (rand() >= 1 / 20) {
        type = (NS.Entities.bare(b.type) === 'rabbit' && rand() < 0.5) ? b.rabbitType : a.rabbitType;
      }
      Rb.setRabbitType(child, type);
    },
    /**
     * loop/fox-s99 (QUEUE 0.2 G18c) -- `FoxEntity.method_18260(ServerWorld, PassiveEntity)`
     * (`createChild`, .decomp, read in full): a coin flip onto ONE parent's own type
     * (`random.nextBoolean() ? this.getFoxType() : mate.getFoxType()`) -- no fresh biome roll
     * at all, unlike rabbit's own `createChild` two rows up.
     */
    fox: function (child, a, b, rand) {
      var Fx = NS.Fox;
      if (!Fx) return;
      Fx.createChild(child, a, b, rand);
    },
    /**
     * loop/goat-s99 (QUEUE 0.2 G18c) -- `GoatEntity.method_35177` (`createChild`, .decomp, read
     * in full): `Gt.childScreaming` (07zj_goat.js) IS this method, verbatim -- including its own
     * asymmetry (only `b`'s flag is read, not `a`'s; `Gt.childScreaming`'s own header names it).
     */
    goat: function (child, a, b, rand) {
      var Gt = NS.Goat;
      if (!Gt) return;
      child.screaming = Gt.childScreaming(b, rand);
    },
    /**
     * loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- `PandaEntity.createChild`/`initGenes`
     * (.decomp, read in full): `Pd.createChild` (07zl_panda.js) IS this method, verbatim,
     * including the two independent 1/32 mutation rolls on each gene slot.
     */
    panda: function (child, a, b, rand) {
      var Pd = NS.Panda;
      if (!Pd) return;
      Pd.createChild(child, a, b, rand);
    },
    /**
     * loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- `AxolotlEntity.createChild`/
     * `shouldBabyBeDifferent` (.decomp, read in full): `Ax.createChild` (07zm_axolotl.js) IS
     * this method, verbatim -- the 1/1200 blue-mutation roll, else a coin flip onto one
     * parent's own variant.
     */
    axolotl: function (child, a, b, rand) {
      var Ax = NS.Axolotl;
      if (!Ax) return;
      Ax.createChild(child, a, b, rand);
    }
  };

  // loop/wtrader-s103 -- TraderLlamaEntity.createChild (.decomp, whole) overrides only WHICH
  // ENTITY TYPE the child is (always trader_llama; `Breed.CHILD_SPECIES`'s own generic "echo
  // parent a" default already gives that back unchanged when `a` is itself a trader_llama) --
  // the attribute/strength/variant averaging is the SAME `LlamaEntity.method_6804` call every
  // llama pair already runs, so the child-attribute RULE is one function, reused, not a second
  // copy of it for the cross-type pair.
  Br.CHILD.trader_llama = Br.CHILD.llama;

  // ── the tick ───────────────────────────────────────────────────────────────────────────────
  /**
   * `AgeableMob.tick`'s server half: the age walks TOWARD nought from whichever side it is on,
   * one tick at a time, and the forced-age timer runs down beside it.
   */
  Br.tickAge = function (e) {
    if (e.growAge === undefined) return;
    if (e.dead) return;
    var age = Br.getAge(e);
    if (age < 0) Br.setAge(e, age + 1);
    else if (age > 0) Br.setAge(e, age - 1);
    if (e.forcedAgeTimer > 0) {
      // `PassiveEntity.tickMovement`'s own growth-puff cadence -- checked BEFORE the
      // decrement, so the puff also fires on the tick the timer is SET to 40
      // (PassiveEntity.java:126-133): 40,36,...,4 -- ten puffs over the forty ticks.
      if (Br.C.growParticleInterval && e.forcedAgeTimer % Br.C.growParticleInterval === 0) Br.emitGrowthPuff(e);
      e.forcedAgeTimer--;
    }
  };
  /**
   * `Animal.aiStep`'s own half: an animal that is not an adult cannot be in love, and love runs
   * out. ⚠ THE ORDER IS THE JAR'S — the age check comes FIRST, so feeding a baby (which sets a
   * negative age) cancels love rather than leaving a baby chasing a mate.
   */
  Br.tickLove = function (e) {
    if (e.inLove === undefined) return;
    if (Br.getAge(e) !== 0) e.inLove = 0;
    if (e.inLove > 0) {
      e.inLove--;
      // `Animal.tickMovement`'s own heart cadence -- checked AFTER the decrement, so the
      // FINAL tick (inLove reaching 0) still gets its heart (AnimalEntity.java:60-67).
      if (Br.C.heartInterval && e.inLove % Br.C.heartInterval === 0) Br.emitLoveHeart(e);
    }
  };
  // ⚠ D-433 — `Br.tick` IS DELETED, NOT KEPT BESIDE ITS REPLACEMENT (D-139). It was written as
  // "both halves in vanilla's own order" and it only ever called `tickAge`; `EL.tickMob` calls
  // `tickAge` BEFORE the goals and `tickLove` AFTER them, because that is where the jar puts
  // them (`AgeableMob.tick` vs `Animal.aiStep`), so a single wrapper cannot express the order
  // at all. Nothing called it. `tickcheck` — whose whole job is "is every per-tick function
  // something the loop CALLS" (D-301) — was right to name it.

  // ── the interaction ────────────────────────────────────────────────────────────────────────
  /**
   * `Animal.mobInteract` — feeding. Returns 'love' when the animal fell in love, 'grow' when a
   * baby was aged up, or false when nothing happened, which is what the caller needs to know to
   * decide whether the hand swings and the item is consumed.
   *
   * ⚠⚠ **THE BABY BRANCH'S ARITHMETIC IS AN INTEGER DIVIDE FIRST.** Vanilla is
   * `ageUp((int)((float)(-age / 20) * 0.1F), true)` — an INTEGER divide, then a `float`
   * multiply, then a truncation. Written the obvious way (`-age / 200`) it is a different
   * function: at age -24001 the jar grows the baby by 120 and the obvious reading by 120.005
   * truncated, and the two part company the moment the divide is not exact.
   * ⚠ `Math.fround` IS THERE BECAUSE THE JAR SAYS `0.1F`, NOT BECAUSE IT CHANGES AN ANSWER.
   * D-421's lid took eleven ticks on exactly this difference, so it was CHECKED rather than
   * assumed here: `breedcheck` §3 sweeps every reachable age (-24000..-1) and asserts the
   * float and the double agree at all 24,000 of them. They do. The `fround` stays because the
   * bytecode has it and the sweep is what would notice if that ever stopped being true.
   */
  Br.interact = function (e, item, opts) {
    if (!Br.ready || !e || e.dead) return false;
    if (!Br.isFood(e.type, item)) return false;
    // ⚠ `instabuild`, NOT `creative` (D-433). Vanilla's `Animal.usePlayerItem` asks
    // `player.getAbilities().instabuild` — an ABILITY, not a gamemode — which is what G6 spent
    // a whole stage replacing the `creative` boolean with, and what the one call site
    // (`Use.entityUse`) has always passed. The option was simply still carrying the old name,
    // which `modecheck` §6's scan reads as the boolean creeping back, and it was right to: a
    // name that survives the thing it named is how it comes back.
    var instabuild = !!(opts && opts.instabuild);
    var age = Br.getAge(e);
    // TurtleEntity.canEat() = super.canEat() && !hasEgg()
    // HoglinEntity.canEat() = !HoglinBrain.isNearPlayer (PACIFIED memory) && super.canEat()
    var pacified = e.type === 'hoglin' && NS.Hoglin && NS.Hoglin.pacified(e);
    if (age === 0 && Br.canFallInLove(e) && !pacified && !(e.type === 'turtle' && e.hasEgg)) {
      Br.eat(opts, instabuild);
      Br.lovePlayer(e, (opts && opts.player) || null);
      if (e.type === 'hoglin') e.persistent = true;   // HoglinEntity.interactMob: accepted -> setPersistent()
      return 'love';
    }
    if (Br.isBaby(e)) {
      Br.eat(opts, instabuild);
      var secs = Math.trunc(Math.fround(Math.trunc(-age / 20) * Math.fround(0.1)));
      Br.ageUp(e, secs, true);
      if (e.type === 'hoglin') e.persistent = true;
      return 'grow';
    }
    return false;
  };
  /** `Animal.eat` — or the caller's own override (`opts.eat`, e.g. `AxolotlEntity.eat`, which runs even for instabuild). */
  Br.eat = function (opts, instabuild) {
    if (opts && typeof opts.eat === 'function') opts.eat();
    else if (!instabuild) Br.consume(opts);
  };
  /** `Animal.usePlayerItem` — one item off the stack, and never when `instabuild` is set. */
  Br.consume = function (opts) {
    if (opts && typeof opts.consume === 'function') opts.consume(1);
  };

  /**
   * `Animal.spawnChildFromBreeding` — the consequence, and the ONLY place a baby is born.
   * Both parents go to the breeding cooldown age, both fall out of love, the child is a baby at
   * the first parent's feet, and the experience orb is rolled `nextInt(xpBound) + 1`.
   * Returns the child, or null when this engine refuses the species (`Breed.SPECIAL`).
   */
  Br.breed = function (a, b, ctx) {
    if (!Br.ready || !Br.canMate(a, b)) return null;
    if (!Br.canBreed(a.type)) return null;
    // loop/donkey-s96 -- `Breed.CHILD_SPECIES`: same species for every pair this engine bred
    // before this pass (it echoes `a.type` back unchanged for all of them), and `mule` for the
    // one cross-type exception (`DonkeyEntity.createChild`/`HorseEntity.createChild`, .decomp).
    var childType = Br.CHILD_SPECIES(a.type, b.type);
    var EL = NS.EntityList;
    var child = EL && EL.ready ? EL.spawn(childType, a.x, a.y, a.z) : null;
    if (!child) return null;
    var ch = Br.CHILD[NS.Entities.bare(childType)];
    if (ch) ch(child, a, b, (ctx && ctx.random) || RNDFB);
    // loop/fox-s99 (QUEUE 0.2 G18c) -- `MateGoal.breed` (.decomp, FoxEntity.java lines
    // 1213-1230): the child trusts whichever loving player(s) caused each parent's love
    // mode, `Fx.addTrustedId` (OWNER first, OTHER_TRUSTED second — a.loveCause always wins
    // the owner slot, b.loveCause only added when it is a DIFFERENT cause, verbatim).
    if (NS.Entities.bare(childType) === 'fox' && NS.Fox && NS.Fox.addTrustedId) {
      var causeA = a.loveCause ? NS.Fox.playerId(a.loveCause) : null;
      var causeB = b.loveCause ? NS.Fox.playerId(b.loveCause) : null;
      if (causeA) NS.Fox.addTrustedId(child, causeA);
      if (causeB && causeB !== causeA) NS.Fox.addTrustedId(child, causeB);
    }
    if (NS.Mount && NS.Mount.isMountable && NS.Mount.isMountable(child)) child.bred = true;   // HorseBaseEntity.setBred (createChild)
    Br.setBaby(child, true);
    // AnimalEntity.breed: getLovingPlayer (own, else partner's) -> incrementStat(ANIMALS_BRED).
    // ponytail: Criteria.BRED_ANIMALS not fired -- no advancement trigger layer exists yet (G26d).
    if ((a.loveCause || b.loveCause) && NS.Stats && NS.Stats.inc) NS.Stats.inc('animals_bred');
    Br.setAge(a, Br.C.breedCooldownAge);
    Br.setAge(b, Br.C.breedCooldownAge);
    Br.resetLove(a);
    Br.resetLove(b);
    // `Animal.spawnChildFromBreeding` -- `world.sendEntityStatus(this, (byte)18)`, `this`
    // being the parent the caller bred FROM (`a`, this engine's convention) -- ONLY that
    // parent's `handleStatus(18)` fires, not `b`'s (AnimalEntity.java:236-241).
    Br.emitBreedHearts(a, ctx && ctx.random);
    Br.spawnXp(a, ctx);
    return child;
  };
  /**
   * The orb, behind vanilla's own `doMobLoot` gamerule -- `Animal.spawnChildFromBreeding`'s own
   * `world.spawnEntity(new ExperienceOrbEntity(..., this.getRandom().nextInt(7) + 1))`
   * (.decomp/net/minecraft/entity/passive/AnimalEntity.java, read whole). Routed through
   * `Xp.spawn` (07zz_xporb.js, G21) so a breeding orb gets the SAME orb-size split/merge/
   * physics/follow/pickup every other orb in this engine gets, rather than a bespoke one-off
   * entity nothing else recognises -- struck `Br.OWED`'s own "experience orb pickup" line, now
   * that `Xp.pickupTick` (07zz_xporb.js) exists to close it.
   */
  Br.spawnXp = function (a, ctx) {
    var rand = (ctx && ctx.random) || RNDFB;
    if (!Br.mobLoot()) return null;
    var amount = Math.floor(rand() * Br.C.xpBound) + 1;
    if (NS.Xp && NS.Xp.ready) return NS.Xp.spawn(a.x, a.y, a.z, amount, rand);
    var EL = NS.EntityList;
    var orb = EL && EL.ready ? EL.spawn('experience_orb', a.x, a.y, a.z) : null;
    if (!orb) return null;
    orb.value = amount;
    return orb;
  };
  /** The same lazy-command-tree guard `EntityList.aiCtx` uses for `mobGriefing` (D-399). */
  Br.mobLoot = function () {
    var C = NS.Commands;
    if (C && typeof C.ruleGet === 'function') return C.ruleGet('doMobLoot') === 'true';
    var r = NS.DATA && NS.DATA.gameRules && NS.DATA.gameRules.doMobLoot;
    return !r || r.d === 'true';
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
