// 07zv7_vbgifts.js — loop/gifts: `GiveGiftsToHeroTask` itself (.decomp/net/minecraft/entity/
// ai/brain/task/GiveGiftsToHeroTask.java, obf `azx`, read in full this session), the priority-3
// CompositeTask entry `createIdleTasks` wraps it in (VillagerTaskListProvider.java:76/135/173,
// `Pair.of(3, new GiveGiftsToHeroTask(100))` — a fresh instance every profession's own idle task
// list, matching this file's own PER-VILLAGER cooldown field below). `src/07zv4_vbidle.js`'s
// own `VB.OWED` used to name this task as un-portable because `.decomp` carried only its NAME
// MAPPING (names.tsv's own `azx` row) and `.mcdata` carried none of its 13 gift loot tables —
// both are now available this session (a decompiled `GiveGiftsToHeroTask.java` and the real
// jar's own `data/minecraft/loot_tables/gameplay/hero_of_the_village/*.json`), so that residue
// is CLOSED here; that file's own `VB.OWED` paragraph is struck to say so.
//
// ⚠ THE BABY GIFT IS A POPPY, NOT A CAT. `getGifts` (.decomp java:118-119) returns
// `ImmutableList.of(new ItemStack(Items.POPPY))` for `villager.isBaby()` — read directly off the
// decompiled source this session, not from memory or a guess.
//
// EVERY NUMBER HERE IS CITED AGAINST THE DECOMPILED SOURCE:
//   MAX_DISTANCE = 5            java:29 (field_30117) — the SAME literal `5` `method_19967`'s
//                                own `LookTargetUtil.walkTowards(..., 5)` call uses (java:100),
//                                not a second, different constant; and `isCloseEnough`'s own
//                                `BlockPos.isWithinDistance(..., 5.0)` (java:143-146) — a real
//                                `<` on the SQUARED block-pos distance (Vec3i.java:192-193, read
//                                this session: `getSquaredDistance(...) < MathHelper.square(5)`).
//   DEFAULT_DURATION = 600      java:30 (field_18985's own initial value) — the per-villager
//                                `ticksLeft` a fresh CompositeTask instance starts with, ticked
//                                down only while a hero IS nearby (`shouldRun`, java:64-72).
//   RUN_TIME = 20               java:32 (field_30120) — the `startTime` wait, once close enough,
//                                before the gift is actually thrown (java:107-112).
//   WALK_SPEED = 0.5            java:49 (field_30121) — the SAME `VB.WALK_SPEED` (0.5,
//                                07zv_villagerbrain.js:101) `VB.wanderTick` already multiplies
//                                by `t.speedMul || 1`, so no override field is needed here.
//   getNextGiftDelay            java:151-153: `600 + random.nextInt(6001)` — 600..6600 ticks,
//                                stamped onto `ticksLeft` in `finish` (java:113-117), which also
//                                forgets WALK_TARGET/LOOK_TARGET/INTERACTION_TARGET.
//   GIFTS map                   java:33-46 — 13 professions, each a `LootTables.field_190XX`
//                                constant this session's own `.decomp/net/minecraft/loot/
//                                LootTables.java:74-86` resolves to the real
//                                `gameplay/hero_of_the_village/<profession>_gift` path.
//   the 2 unmapped professions   `getGifts`'s own `else` (java:126): NONE and NITWIT (not in the
//                                13-entry GIFTS map) get `Items.field_8317` = wheat_seeds
//                                (Items.java:852, read this session).
//
// WHAT THIS ENGINE'S OWN SINGLEPLAYER SHAPE SIMPLIFIES (named, not silently dropped): real
// vanilla's `NEAREST_VISIBLE_PLAYER` memory is a sensor scan with its own range/line-of-sight
// test; this engine has exactly one player (`NS.Player`, or whatever object the caller passes —
// see `VBG.tick`'s own signature below), so "the nearest visible player" collapses to "the one
// player, if it has the effect" — the SAME no-line-of-sight simplification `07zv5_vbbreed.js`'s
// own `VillagerBreedTask` port and `07zv4_vbidle.js`'s own `breedInterestStart` already make for
// their own "nearest visible X" memories.
//
// SUBSTRATES REUSED, not re-invented: `ES.amplifierOf` (07q_effects.js, the SAME reader
// `07p_trade.js`'s own `Trade.prepareOffersFor` already uses for this exact effect);
// `Gt.giveItemTo` (src/07zv6_vbgather.js, exported this session for this file — the SAME
// eye-position/0.3-speed toss `giveHalfOfStack`'s own food/wheat/profession-item sharing
// already uses, `LookTargetUtil.give` java:81-89); `L.rollTable` (src/07e_loot.js, exported this
// session — the SAME `rollPools`/`mergeStacks` interpreter `L.drops`/`L.entityDrops` already run
// for block and entity tables, generalized to an arbitrary packed table name); `e.vbWalkTarget`/
// `e.vbLookTarget` (07zv_villagerbrain.js's own WALK_TARGET/LOOK_TARGET stand-ins, re-set live
// every tick the same way `07zv5_vbbreed.js`'s own `lookWalkTowardsEachOther` already does for a
// moving partner — vanilla's own `WalkTarget`/`LookTarget` wrap a LIVE `EntityLookTarget`,
// re-read every tick, not a snapshot).
//
// AFTER 07zv6_vbgather.js (build.mjs's own load order): reuses `Gt.giveItemTo`.
// `07zv_villagerbrain.js`'s own `VB.tick` calls `NS.VBGifts.tick` lazily, only while
// `activity === 'idle'`, the SAME separate-priority-tier shape `NS.VBBreed.tick`/
// `NS.VBGather.tick` already use next to it (createIdleTasks' own priority-3 CompositeTask
// tier, independent of whichever priority-2 RandomTask entry `tickIdle` picked that same tick).

(function (NS) {
  'use strict';
  var VB = NS.VB;
  if (!VB) return;

  var VBG = NS.VBGifts = NS.VBGifts || {};

  VBG.MAX_DISTANCE = 5;          // field_30117 (java:29) — isCloseEnough's squared gate AND
                                  // method_19967's own walkTowards completionRange literal (100)
  VBG.DEFAULT_DURATION = 600;    // field_18985's initial ticksLeft (java:30/48)
  VBG.RUN_TIME = 20;             // field_30120 (java:32/109)
  VBG.MIN_GIFT_DELAY = 600;      // getNextGiftDelay's own literal (java:152)
  VBG.GIFT_DELAY_SPREAD = 6001;  // `random.nextInt(6001)` — 600..6600 inclusive

  // GiveGiftsToHeroTask.GIFTS (.decomp java:33-46), resolved against LootTables.java:74-86 to
  // the real `gameplay/hero_of_the_village/<profession>_gift` table names `tools/pack-loot.mjs`
  // now packs by explicit path (this file's own header).
  VBG.GIFTS = {
    armorer: 'gameplay/hero_of_the_village/armorer_gift',
    butcher: 'gameplay/hero_of_the_village/butcher_gift',
    cartographer: 'gameplay/hero_of_the_village/cartographer_gift',
    cleric: 'gameplay/hero_of_the_village/cleric_gift',
    farmer: 'gameplay/hero_of_the_village/farmer_gift',
    fisherman: 'gameplay/hero_of_the_village/fisherman_gift',
    fletcher: 'gameplay/hero_of_the_village/fletcher_gift',
    leatherworker: 'gameplay/hero_of_the_village/leatherworker_gift',
    librarian: 'gameplay/hero_of_the_village/librarian_gift',
    mason: 'gameplay/hero_of_the_village/mason_gift',
    shepherd: 'gameplay/hero_of_the_village/shepherd_gift',
    toolsmith: 'gameplay/hero_of_the_village/toolsmith_gift',
    weaponsmith: 'gameplay/hero_of_the_village/weaponsmith_gift',
  };

  function rnd() { return (VB.rand || Math.random)(); }
  function nextInt(n) { return Math.floor(rnd() * n); }
  // A `{nextFloat, nextInt}` wrapper over `VB.rand` — the SAME shape `src/07s_raid.js`'s own
  // `rand: { nextFloat: Math.random, nextInt: ... }` already builds for a Loot roll, just
  // sourced off `VB.rand` (overridable by a check, 07zv_villagerbrain.js:192's own comment) so a
  // deterministic villager-brain seed also pins the gift roll.
  function lootRng() { return { nextFloat: rnd, nextInt: nextInt }; }

  /** `getNextGiftDelay` (.decomp java:151-153): `600 + random.nextInt(6001)`. */
  function getNextGiftDelay() { return VBG.MIN_GIFT_DELAY + nextInt(VBG.GIFT_DELAY_SPREAD); }

  /** `isHero`/`isNearestPlayerHero`/`getNearestPlayerIfHero` (.decomp java:132-140), collapsed
   *  to the one `player` this engine was handed (file header's own singleplayer simplification).
   *  Returns `player` itself when it has the effect, else null — the SAME "the memory itself IS
   *  the answer" shape `getNearestPlayerIfHero` returns (`Optional<PlayerEntity>`). */
  function heroPlayer(player) {
    var ES = NS.Effects;
    if (!player || !ES || !ES.amplifierOf) return null;
    return ES.amplifierOf(player, 'hero_of_the_village') >= 0 ? player : null;
  }

  /** `isCloseEnough` (.decomp java:143-146): `BlockPos.isWithinDistance(..., 5.0)` — a real `<`
   *  on the squared distance between the two ENTITIES' floored block positions (Vec3i.java:
   *  192-193, read this session), NOT the manhattan/`<=` shape `e.vbWalkTarget`'s own
   *  `hasReached` (07zv_villagerbrain.js:387) uses for the walking machinery's own arrival test —
   *  a separate gate, on purpose, matching the two separate vanilla checks. */
  function isCloseEnough(e, player) {
    var dx = Math.floor(e.x) - Math.floor(player.x);
    var dy = Math.floor(e.y) - Math.floor(player.y);
    var dz = Math.floor(e.z) - Math.floor(player.z);
    return (dx * dx + dy * dy + dz * dz) < VBG.MAX_DISTANCE * VBG.MAX_DISTANCE;
  }

  /** `getGifts` (.decomp java:118-129): a baby always gets one poppy; an adult with a mapped
   *  profession rolls that profession's real loot table (`L.rollTable`, this file's own
   *  header — a LEGITIMATE roll can come back empty, `fletcher_gift`'s own tipped-arrow entries
   *  each carry a `set_count{uniform(0,1)}` that is sometimes 0, java:120-125/LootTables); an
   *  unmapped profession (NONE/NITWIT) always gets one wheat_seeds — that branch is NOT a
   *  "table missing" fallback, it is what `getGifts`'s own `else` (java:126) always returns for
   *  those two professions specifically. */
  function getGifts(e) {
    if (e.isBaby) return [{ item: 'poppy', count: 1 }];
    var tableName = VBG.GIFTS[e.profession];
    if (!tableName) return [{ item: 'wheat_seeds', count: 1 }];
    var L = NS.Loot;
    if (!L || !L.ready || !L.rollTable) return [];
    var ctx = { rng: lootRng(), pos: { x: Math.floor(e.x), y: Math.floor(e.y), z: Math.floor(e.z) } };
    return L.rollTable(tableName, ctx) || [];
  }

  /** `giveGifts` (.decomp java:114-117): every stack `getGifts` produced, each tossed
   *  individually via `LookTargetUtil.give` — `Gt.giveItemTo`, this file's own header. */
  function giveGifts(e, player) {
    var Gt = NS.VBGather;
    if (!Gt || !Gt.giveItemTo) return;
    var gifts = getGifts(e);
    for (var i = 0; i < gifts.length; i++) {
      var g = gifts[i];
      if (g && g.count > 0) Gt.giveItemTo(e, player, g.item, g.count);
    }
  }

  /**
   * `GiveGiftsToHeroTask`'s own `shouldRun`/`run`/`shouldKeepRunning`/`tick`/`finish`
   * (.decomp java:64-117), folded into one per-villager-per-tick call the SAME way
   * `07zv5_vbbreed.js`'s own `NS.VBBreed.tick` already folds `VillagerBreedTask` — called from
   * `07zv_villagerbrain.js`'s own `VB.tick` while `activity === 'idle'`, for EVERY villager.
   * `player` is whatever the caller passes (real hookup: `NS.Player`, this engine's one
   * singleplayer character) so a check can hand it a stub without touching `NS.Player` at all.
   * `e.vbGift` (absent = not running) mirrors the task's own started/not-started state;
   * `e.vbGiftCooldown` (lazily 600 on first call, `DEFAULT_DURATION`) mirrors `ticksLeft`.
   */
  VBG.tick = function (e, now, tnow, player) {
    if (e.vbGiftCooldown === undefined) e.vbGiftCooldown = VBG.DEFAULT_DURATION;
    var hero = heroPlayer(player);
    if (!e.vbGift) {
      // shouldRun (java:64-72): ticksLeft only counts down while a hero IS nearby; no hero at
      // all means shouldRun returns false WITHOUT decrementing it (java:65-66).
      if (!hero) return;
      if (e.vbGiftCooldown > 0) { e.vbGiftCooldown--; return; }
      // run (java:74-80): remember INTERACTION_TARGET, look at the hero.
      e.vbGift = { startTime: tnow, done: false };
      e.vbLookTarget = { x: hero.x, y: hero.y, z: hero.z };
      return;
    }
    // shouldKeepRunning (java:96-98): hero still present AND not already done.
    if (!hero || e.vbGift.done) {
      // finish (java:113-117): re-roll the cooldown, forget WALK_TARGET/LOOK_TARGET.
      e.vbGiftCooldown = getNextGiftDelay();
      e.vbGift = null;
      e.vbWalkTarget = null;
      e.vbLookTarget = null;
      return;
    }
    // tick (java:100-112): re-aim every tick; close enough and past the RUN_TIME wait throws
    // the gift and marks done (finish runs the FOLLOWING tick, matching the real Task
    // lifecycle — keepRunning is checked before tick(), not after); too far walks toward the
    // hero's CURRENT position (live tracking, this file's own header).
    e.vbLookTarget = { x: hero.x, y: hero.y, z: hero.z };
    if (isCloseEnough(e, hero)) {
      if (tnow - e.vbGift.startTime > VBG.RUN_TIME) {
        giveGifts(e, hero);
        e.vbGift.done = true;
      }
    } else {
      e.vbWalkTarget = { x: hero.x, y: hero.y, z: hero.z, range: VBG.MAX_DISTANCE };
    }
  };

  VBG.ready = true;

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
