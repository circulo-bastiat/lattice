// 07zt_wtrader.js — QUEUE 0.2 (G18e/Breed remainder), loop/wtrader-s103: the WANDERING TRADER +
// TRADER LLAMA + the WanderingTraderManager spawner, whole. Same standing rule every prior
// QUEUE 0.2 mob unit's own load-order comment states (build.mjs): cross-module CALLS
// (NS.Trade/NS.Effects/NS.Sky/NS.EntityList/NS.Ai) resolved LAZILY, this file loads after all
// of them.
//
// Sources (.decomp, each read in full this pass):
//   net/minecraft/entity/passive/WanderingTraderEntity.java (281 lines)
//   net/minecraft/world/WanderingTraderManager.java (156 lines)
//   net/minecraft/entity/passive/TraderLlamaEntity.java (149 lines, DefendTraderGoal/despawn
//     half only -- the rest of this file's own trader_llama business lives in 07ze_llama.js)
//   net/minecraft/village/TradeOffers.java:637-693 (WANDERING_TRADER_TRADES, both pools) and
//     net/minecraft/item/Items.java (register() calls, for the pool items with no Yarn name)
//   net/minecraft/potion/Potions.java:15 (the invisibility potion's own 3600-tick duration)
//
// WHY NO tools/extract-wtrader-trades.mjs EXISTS: extract-villager-trades.mjs's own bytecode
// walk is the right tool for this table too, but it needs javap (its own header: "SKIP - no
// javap on this machine"), and THIS machine's JDK carries a java runtime with no javap binary
// at all (checked live this session -- $(dirname $(readlink -f $(which java))) holds only
// java), the same "no jar to re-measure it from" shape 07r_mount.js's own Mnt.OWED already
// names for donkey/mule/llama motion. WT.TRADES_POOL1/POOL2 below are transcribed 1:1 off the
// Yarn-remapped .decomp source instead (exact decompiled source, not a guess), each row cited
// to its own .decomp line above. Building the real bytecode extractor once a javap-carrying
// JDK is available is WT.OWED's own line, not silently skipped.
//
// SCOPE THIS PASS (whole, per the unit's own brief):
//   1. WanderingTraderEntity: despawnDelay (48000, counted down, WT.tickEntity), the
//      invisibility-potion-at-night / milk-at-day pair (WT.DrinkInvisibilityGoal/
//      DrinkMilkGoal), WanderToTargetGoal (real, off e.wanderTarget), a combined
//      flee-from-raiders/undead rows (WT.fleeGoals: vanilla's seven FleeEntityGoal rows, each an
//      Ai.AvoidEntityGoal -- cloud unit referee-mob-avoid-panic), and
//      trading (5 random from TRADES_POOL1 + 1 from TRADES_POOL2, Trade.pickFromPool/
//      Trade.resolveOffers REUSED -- not reimplemented -- from 07p_trade.js's own villager
//      mechanism, exactly as this unit's brief asks).
//   2. WanderingTraderManager: WT.tickManager (spawnTimer/spawnDelay/spawnChance, the 1-in-10
//      near-player gate, the two leashed trader llamas) -- a pure function over a caller-built
//      ctx, the SAME "ready but not yet wired into Main.worldTick" shape 07s_raid.js's own
//      Rd.tick stood in for one session before 17_main.js wired Rd.tickLive (that file's own
//      header line: "no caller anywhere in src/ wires a real spawnFn... yet") -- WT.OWED names
//      the same standing gap here, not a hidden shortcut.
//   3. TraderLlamaEntity's DESPAWN half (WT.tickTraderLlamaDespawn) -- the DefendTraderGoal/
//      createChild/putPlayerOnBack pieces of the SAME entity live in 07ze_llama.js, which owns
//      every other trader_llama concern (spit, caravan, skin) already.
(function (NS) {
  'use strict';
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6440)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = NS.JRandom ? new NS.JRandom(0x6440) : { s: 0x6440, nextDouble: function () { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return this.s / 4294967296; } }; return fbR.nextDouble(); }

  var WT = NS.WT = { ready: false };

  // -- 1. THE TWO TRADE POOLS (TradeOffers.java:637-693) --------------------------------------
  // Every row is `new SellItemFactory(Item, priceEmerald, itemQty, maxUses, xp)` -- the 5-arg
  // ctor (TradeOffers.java:900-902) -- which SellItemFactory.create (TradeOffers.java:916-921)
  // turns into TradeOffer(new ItemStack(EMERALD, priceEmerald), new ItemStack(item, itemQty),
  // maxUses, xp, 0.05F): the player PAYS priceEmerald emerald(s), GETS itemQty of item --
  // Trade.SUPPORTED's own buy_item_for_emerald kind (07p_trade.js), not sell_item_for_emerald
  // (that kind is the OTHER direction, a villager selling crops for emeralds).
  function row(item, priceEmerald, itemQty, maxUses, xp) {
    return { kind: 'buy_item_for_emerald', item: item, priceEmerald: priceEmerald,
      itemQty: itemQty, maxUses: maxUses, xp: xp, priceMult: 0.05 };
  }

  /** TradeOffers.java:638-661 -- 62 rows. Items with no Yarn name are cited by their own
   *  register("<id>", ...) call in .decomp/net/minecraft/item/Items.java (grepped live this
   *  session, not remembered) rather than left as a raw field_NNNN. */
  WT.TRADES_POOL1 = [
    row('sea_pickle', 2, 1, 5, 1), row('slime_ball', 4, 1, 5, 1),          // Items.java:1001
    row('glowstone', 2, 1, 5, 1), row('nautilus_shell', 5, 1, 5, 1),       // Items.java:1475
    row('fern', 1, 1, 12, 1), row('sugar_cane', 1, 1, 8, 1),
    row('pumpkin', 1, 1, 4, 1), row('kelp', 3, 1, 12, 1),
    row('cactus', 3, 1, 8, 1), row('dandelion', 1, 1, 12, 1),
    row('poppy', 1, 1, 12, 1), row('blue_orchid', 1, 1, 8, 1),
    row('allium', 1, 1, 12, 1), row('azure_bluet', 1, 1, 12, 1),
    row('red_tulip', 1, 1, 12, 1), row('orange_tulip', 1, 1, 12, 1),
    row('white_tulip', 1, 1, 12, 1), row('pink_tulip', 1, 1, 12, 1),
    row('oxeye_daisy', 1, 1, 12, 1), row('cornflower', 1, 1, 12, 1),
    row('lily_of_the_valley', 1, 1, 7, 1),
    row('wheat_seeds', 1, 1, 12, 1),          // Items.java:852
    row('beetroot_seeds', 1, 1, 12, 1),       // Items.java:1412
    row('pumpkin_seeds', 1, 1, 12, 1),        // Items.java:1061
    row('melon_seeds', 1, 1, 12, 1),          // Items.java:1062
    row('acacia_sapling', 5, 1, 8, 1), row('birch_sapling', 5, 1, 8, 1),
    row('dark_oak_sapling', 5, 1, 8, 1), row('jungle_sapling', 5, 1, 8, 1),
    row('oak_sapling', 5, 1, 8, 1), row('spruce_sapling', 5, 1, 8, 1),
    // the 16 dyes, TradeOffers.java:661-676, each dye's item Items.java:1020-1035
    row('red_dye', 1, 3, 12, 1), row('white_dye', 1, 3, 12, 1),
    row('blue_dye', 1, 3, 12, 1), row('pink_dye', 1, 3, 12, 1),
    row('black_dye', 1, 3, 12, 1), row('green_dye', 1, 3, 12, 1),
    row('light_gray_dye', 1, 3, 12, 1), row('magenta_dye', 1, 3, 12, 1),
    row('yellow_dye', 1, 3, 12, 1), row('gray_dye', 1, 3, 12, 1),
    row('purple_dye', 1, 3, 12, 1), row('light_blue_dye', 1, 3, 12, 1),
    row('lime_dye', 1, 3, 12, 1), row('orange_dye', 1, 3, 12, 1),
    row('brown_dye', 1, 3, 12, 1), row('cyan_dye', 1, 3, 12, 1),
    row('brain_coral_block', 3, 1, 8, 1), row('bubble_coral_block', 3, 1, 8, 1),
    row('fire_coral_block', 3, 1, 8, 1), row('horn_coral_block', 3, 1, 8, 1),
    row('tube_coral_block', 3, 1, 8, 1),
    row('vine', 1, 1, 12, 1), row('brown_mushroom', 1, 1, 12, 1),
    row('red_mushroom', 1, 1, 12, 1),
    row('lily_pad', 1, 2, 5, 1), row('small_dripleaf', 1, 2, 5, 1),
    row('sand', 1, 8, 8, 1), row('red_sand', 1, 4, 6, 1),
    row('pointed_dripstone', 1, 2, 5, 1), row('rooted_dirt', 1, 2, 5, 1),
    row('moss_block', 1, 2, 5, 1)
  ];

  /** TradeOffers.java:662-668 -- 6 rows. */
  WT.TRADES_POOL2 = [
    row('tropical_fish_bucket', 5, 1, 4, 1),  // Items.java:988
    row('pufferfish_bucket', 5, 1, 4, 1),     // Items.java:977
    row('packed_ice', 3, 1, 6, 1),
    row('blue_ice', 6, 1, 6, 1),
    row('gunpowder', 1, 1, 8, 1),             // Items.java:851
    row('podzol', 3, 3, 6, 1)
  ];

  // -- 2. TRADING -- WanderingTraderEntity.fillRecipes (.decomp:117-131), REUSING 07p_trade.js's
  // own mechanism rather than reimplementing it: Trade.pickFromPool is the exact vanilla
  // MerchantEntity.fillRecipesFromPool HashSet-of-distinct-indices draw (07p_trade.js's own
  // header cites it) and Trade.resolveOffers is the exact static/procedural row resolver --
  // every WT.TRADES_POOL1/POOL2 row is the static buy_item_for_emerald kind, so resolveOffers
  // only ever passes each one through unchanged here, but going through it anyway means a
  // future procedural wandering-trader row (none exist today) is handled for free, not bypassed
  // by a shortcut.
  //
  // ONE NAMED DEVIATION FROM Trade.pickFromPool: vanilla's OWN pool-2 draw is a single
  // random.nextInt(pool2.length) index (fillRecipes, .decomp:124-127) -- no HashSet, no
  // distinctness question (there is only one slot to fill) -- so WT.rollTrades draws pool 2
  // with a bare index roll, and reserves Trade.pickFromPool for pool 1's real 5-of-62 HashSet
  // draw, matching each pool's own real algorithm rather than forcing both through one call.
  WT.OFFERS_FROM_POOL1 = 5;   // fillRecipesFromPool(offers, pool1, 5) -- .decomp:122
  WT.rollTrades = function (e, rng) {
    rng = rng || RNDFB;
    var Trade = NS.Trade;
    if (!Trade) return [];
    var picked1 = Trade.pickFromPool(WT.TRADES_POOL1, WT.OFFERS_FROM_POOL1, rng);
    var idx2 = Math.floor(rng() * WT.TRADES_POOL2.length);
    var rows = picked1.concat([WT.TRADES_POOL2[idx2]]);
    return Trade.resolveOffers(rows, e, rng);
  };

  /** Lazily attach this wandering trader's own fixed-for-life offer list -- isLeveledMerchant()
   *  returns false (.decomp:96-99), so unlike a villager there is no xp/level/restock to attach
   *  alongside it; e.tradeUses still exists (every offer's own use counter, Trade.disabled/
   *  Trade.maxUses read it generically, not villager-gated). */
  WT.ensureTrades = function (e, rng) {
    if (!e || e.type !== 'wandering_trader') return null;
    if (!e.tradeOffers) {
      e.tradeOffers = WT.rollTrades(e, rng);
      e.tradeUses = e.tradeOffers.map(function () { return 0; });
      e.tradeDemand = e.tradeOffers.map(function () { return 0; });
      e.tradeSpecial = e.tradeOffers.map(function () { return 0; });
    }
    return e.tradeOffers;
  };

  /** takeAcross -- the exact private helper 07p_trade.js's own Trade.attempt uses, duplicated
   *  rather than exported: pulling straight from the whole inventory instead of two placed
   *  input slots is that file's own named simplification (Trade.OWED), inherited here
   *  unchanged, not re-decided. */
  function takeAcross(inv, id, count) {
    var Iv = NS.Inventory, left = count;
    for (var i = 0; i < Iv.SIZE && left > 0; i++) {
      var s = Iv.getItem(inv, i);
      if (Iv.isEmpty(s) || s.i !== id) continue;
      var take = Math.min(left, s.n);
      var rem = s.n - take;
      Iv.setItem(inv, i, rem > 0 ? { i: s.i, n: rem, d: s.d, t: s.t } : null);
      left -= take;
    }
    return left === 0;
  }

  /**
   * MerchantEntity.trade off WanderingTraderEntity.interactMob (.decomp:104-116) -- no
   * xp/level/restock (unlike Trade.attempt, villager-only), reusing Trade.disabled and
   * Trade.previewFor (both already generic over any entity carrying tradeOffers/tradeUses,
   * 07p_trade.js's own header) for the affordability question and the resolved need/give pair,
   * so this function only owns the actual inventory transfer and the use-counter bump.
   */
  WT.attempt = function (e, i, P, rand) {
    var Trade = NS.Trade;
    if (!Trade || !e || !e.tradeOffers || !e.tradeOffers[i]) return { ok: false, reason: 'no such offer' };
    if (Trade.disabled(e, i)) return { ok: false, reason: 'sold out' };
    if (!P || !P.inventory) return { ok: false, reason: 'no inventory' };
    var prev = Trade.previewFor(e.tradeOffers[i], e, i);
    if (!prev || !prev.in1 || !prev.out) return { ok: false, reason: 'unsupported kind' };
    var inv = P.inventory, Iv = NS.Inventory;
    if (!P.instabuild) {
      if (prev.in1.i < 0 || Iv.countOf(inv, prev.in1.i) < prev.in1.n) return { ok: false, reason: 'not enough emerald' };
      takeAcross(inv, prev.in1.i, prev.in1.n);
    }
    if (prev.out.i >= 0) Iv.add(inv, { i: prev.out.i, n: prev.out.n, d: 0 });
    e.tradeUses[i]++;
    // WanderingTraderEntity.afterUsing: shouldRewardPlayerExperience() (always true here) ->
    // an orb of 3 + nextInt(4) at (x, y+0.5, z).
    var orb = 3 + Math.floor((rand || RNDFB)() * 4);
    if (NS.Xp && NS.Xp.ready) NS.Xp.spawn(e.x, e.y + 0.5, e.z, orb);
    WT.sound(e, 'entity.wandering_trader.yes', 1, 1);   // MerchantEntity.onSellingItem -> getTradingSound(!stack.isEmpty())
    return { ok: true, xp: e.tradeOffers[i].xp || 0, orb: orb };
  };

  // -- 3. DESPAWN -- WanderingTraderEntity.tickDespawnDelay (.decomp:216-220), verbatim: a
  // positive despawnDelay, no active customer, counted to zero, discards. hasCustomer has no
  // substrate in this engine (no trade-screen-open flag anywhere -- grepped live, none) --
  // named on WT.OWED rather than invented; the countdown itself is exact.
  WT.DESPAWN_DELAY = 48000;   // WanderingTraderManager.trySpawn: $$8.setDespawnDelay(48000), .decomp:106
  WT.tickEntity = function (e) {
    if (!e || e.type !== 'wandering_trader') return;
    WT.ensureTrades(e);
    if (e.despawnDelay === undefined) e.despawnDelay = 0;
    WT.tickUse(e);   // D-567: LivingEntity.tickActiveItemStack, the entity-tick half of HoldInHandsGoal
    if (e.despawnDelay > 0 && !e.customer && --e.despawnDelay === 0) e.removed = true;
  };

  // -- 4. THE POTION/MILK PAIR -- HoldInHandsGoal (.decomp WanderingTraderEntity.java:63-71 +
  // ai/goal/HoldInHandsGoal.java), whole since D-567. start() equips the stack in the MAIN hand
  // and setCurrentHand(MAIN_HAND) begins a use of getMaxUseTime() = 32 ticks (PotionItem.java:75,
  // MilkBucketItem.java:39); shouldContinue() is isUsingItem(); stop() empties the main hand. The
  // countdown itself is LivingEntity.tickActiveItemStack -> tickItemStackUsage, an ENTITY tick
  // (LivingEntity.java:2831-2845), so it lives in WT.tickEntity below, not in the goal's own
  // tick (1.18.2 GoalSelector ticks a non-every-tick goal on alternate ticks only). When it
  // reaches 0 the item's finishUsing lands: the potion adds INVISIBILITY 3600 (Potions.java:15),
  // the milk calls clearStatusEffects() -- ALL effects, not just invisibility
  // (MilkBucketItem.java:31-33) -- which the pre-D-567 one-shot got wrong.
  WT.INVIS_DURATION = 3600;   // Potions.java:15 -- new StatusEffectInstance(INVISIBILITY, 3600)
  WT.USE_TIME = 32;           // PotionItem.getMaxUseTime / MilkBucketItem.getMaxUseTime
  WT.finishUsing = function (e, item) {
    var ES = NS.Effects;
    if (!ES) return;
    if (item === 'potion') { if (ES.addStatusEffect) ES.addStatusEffect(e, 'invisibility', WT.INVIS_DURATION, 0, false, true); }
    else if (item === 'milk_bucket') { if (ES.clearStatusEffects) ES.clearStatusEffects(e); }
  };
  WT.sound = function (e, ev, vol, pitch) {
    if (!e || e.silent || !NS.Sound || !NS.Sound.mobSound) return;
    NS.Sound.mobSound(e, ev, vol, pitch);
  };
  WT.tickUse = function (e) {
    var u = e && e.useItem;
    if (!u) return;
    // LivingEntity.shouldSpawnConsumptionEffects: left <= maxUse-7 && left%4==0 -> getDrinkSound at 0.5, rnd*0.1+0.9
    if (u.left <= WT.USE_TIME - 7 && u.left % 4 === 0)
      WT.sound(e, u.item === 'milk_bucket' ? 'entity.wandering_trader.drink_milk' : 'entity.wandering_trader.drink_potion', 0.5, RNDFB() * 0.1 + 0.9);
    if (--u.left <= 0) { e.useItem = null; WT.finishUsing(e, u.item); }
  };
  WT.HoldInHandsGoal = function (e, item, cond) {
    var Eq = function () { return NS.Equip; }, IT = function () { return NS.Items; };
    this.canUse = function () { return cond(); };
    this.canContinueToUse = function () { return !!e.useItem; };   // isUsingItem()
    this.start = function () {
      var eq = Eq(), it = IT();
      if (eq && it && eq.stackOf) {
        var st = eq.stackOf(item);
        if (st && item === 'potion') { if (!st.t) st.t = {}; st.t.Potion = 'minecraft:invisibility'; }
        eq.setEquipped(e, it.MAINHAND, st);
      }
      e.useItem = { item: item, left: WT.USE_TIME };
    };
    this.stop = function () {
      var eq = Eq(), it = IT();
      if (eq && it) eq.setEquipped(e, it.MAINHAND, null);
      WT.sound(e, item === 'potion' ? 'entity.wandering_trader.disappeared' : 'entity.wandering_trader.reappeared', 1.0, RNDFB() * 0.2 + 0.9);   // HoldInHandsGoal.stop
      e.useItem = null;   // the hand changed -> clearActiveItem (LivingEntity.java:2836-2837)
    };
    this.tick = function () {};
  };
  WT.DrinkInvisibilityGoal = function (e) {
    WT.HoldInHandsGoal.call(this, e, 'potion', function () {
      var Sky = NS.Sky, ES = NS.Effects;
      if (!Sky || !Sky.isNight || !ES || !ES.hasStatusEffect) return false;
      return Sky.isNight() && !ES.hasStatusEffect(e, 'invisibility');   // world.isNight() && !isInvisible()
    });
  };
  WT.DrinkMilkGoal = function (e) {
    WT.HoldInHandsGoal.call(this, e, 'milk_bucket', function () {
      var Sky = NS.Sky, ES = NS.Effects;
      if (!Sky || !Sky.isDay || !ES || !ES.hasStatusEffect) return false;
      return Sky.isDay() && ES.hasStatusEffect(e, 'invisibility');     // world.isDay() && isInvisible()
    });
  };

  // -- 5. WanderToTargetGoal -- WanderingTraderEntity.WanderToTargetGoal (.decomp:243-278),
  // transcribed: canStart/canContinueToUse -- a wander target exists and is more than
  // proximityDistance away; tick -- walk toward it directly once within 10 blocks, else toward
  // a point 10 blocks along the line to it (never the whole distance in one nav order, matching
  // the real class's own two-branch shape). Ai.findPath/Ai.stepToward stand in for
  // Navigation.startMovingTo (the same substitution every other roster goal in 07k_goals.js
  // already makes); navigation.isIdle()'s own gate is approximated as "no path currently in
  // flight" (WT.OWED).
  WT.WanderToTargetGoal = function (e, proximityDistance, speed) {
    var path = null, idx = 1;
    // BlockPos.isWithinDistance(Position) is centre-based: measured from (x+.5, y+.5, z+.5)
    function distTo(t) { return Math.hypot(t.x + 0.5 - e.x, t.y + 0.5 - e.y, t.z + 0.5 - e.z); }
    var self = this;
    function tooFar(t, d) { return !!t && distTo(t) > d; }
    this.canUse = function () { return tooFar(e.wanderTarget, proximityDistance); };
    this.canContinueToUse = this.canUse;
    this.start = function () { path = null; idx = 1; };
    this.stop = function () { e.wanderTarget = null; path = null; };
    this.tick = function () {
      var t = e.wanderTarget;
      if (!t) return;
      if (path && idx < path.length) {
        NS.Ai.stepToward(e, path[idx], speed);
        if (NS.Ai.closeTo(e, path[idx])) idx++;
        return;
      }
      var tx, ty, tz;
      if (tooFar(t, 10.0)) {
        // vanilla normalises the full 3D vector (raw block coords, no centre), so dy shortens the horizontal step
        var dx = t.x - e.x, dy = t.y - e.y, dz = t.z - e.z, len = Math.hypot(dx, dy, dz) || 1;
        tx = e.x + (dx / len) * 10; ty = e.y + (dy / len) * 10; tz = e.z + (dz / len) * 10;
      } else { tx = t.x; ty = t.y; tz = t.z; }
      self.lastOrder = { x: tx, y: ty, z: tz };
      path = NS.Ai.findPath(e.x, e.y, e.z, tx, ty, tz, { mob: e });
      idx = 1;
    };
  };

  // -- 6. FLEE -- vanilla's own seven FleeEntityGoal rows (.decomp:71-77) are ALL (0.5, 0.5)
  // speed pairs, differing only in class and distance -- one table, seven real goals built from it
  // (WT.fleeGoals below); any of these seven mob types this engine has not built at all simply never matches, the
  // same honest no-op every other roster goal's "type this engine doesn't have" case already is).
  WT.FLEE_TYPES = { zombie: 8.0, evoker: 12.0, vindicator: 8.0, vex: 8.0, pillager: 15.0,
    illusioner: 12.0, zoglin: 10.0 };
  WT.FLEE_SPEED = 0.5;
  // `ZombieEntity.class` matches its subclasses too (husk, drowned, zombie villager, zombified
  // piglin -- every `extends ZombieEntity` in .decomp); the other six classes have none.
  WT.FLEE_CLASS = { husk: 'zombie', drowned: 'zombie', zombie_villager: 'zombie', zombified_piglin: 'zombie' };
  /** The seven rows as vanilla builds them: one `FleeEntityGoal` each (priority 1, MOVE), ported as
   *  `Ai.AvoidEntityGoal` -- the same TargetPredicate range gate, NoPenaltyTargeting.findFrom(16, 7)
   *  escape pick, farther-than-here refusal and follow-range path the creeper/cat rows use. (Was one
   *  hand-rolled goal that ran a fixed 16 blocks straight away and never re-checked the threat.) */
  WT.fleeGoals = function (e) {
    var out = [];
    Object.keys(WT.FLEE_TYPES).forEach(function (cls) {
      var threats = function () {
        var EL = NS.EntityList, list = (EL && EL.list) || [], r = [];
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (!o || o === e || o.removed || o.dead) continue;
          if (o.type === cls || WT.FLEE_CLASS[o.type] === cls) r.push(o);
        }
        return r;
      };
      out.push(new NS.Ai.AvoidEntityGoal(e, WT.FLEE_TYPES[cls], WT.FLEE_SPEED, threats,
        function () { return true; }, { fastSpeed: WT.FLEE_SPEED }));
    });
    return out;
  };

  /**
   * WanderingTraderEntity.initGoals (.decomp:53-84) roster -- Ai.ROSTER.wandering_trader
   * (07k_goals.js) calls this. Priorities match the real class's own MOVE-priority-bearing rows
   * (0/0/0/1/1/2/8/9/10) -- the rows this engine has no live substrate for at all
   * (StopFollowingCustomerGoal/LookAtCustomerGoal, both gated on a "mid-trade" flag no entity
   * here carries, and GoToWalkTargetGoal, gated on a positionTarget this engine's mob substrate
   * never tracks) are named on WT.OWED, not silently dropped from the comment the way a guess
   * would be.
   */
  // MerchantEntity customer state: e.customer is the trading player (setCustomer/hasCustomer).
  WT.setCustomer = function (e, p) { e.customer = p || null; };
  WT.hasCustomer = function (e) { return !!e.customer; };
  /** StopFollowingCustomerGoal (.decomp): stands still while a customer within 4 blocks is trading; stop() drops the customer. */
  WT.StopFollowingCustomerGoal = function (e) {
    this.canUse = function () {
      var c = e.customer;
      if (!c || e.dead || e.removed || !e.onGround || e.inWater || e.velocityModified) return false;
      var dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z;
      return dx * dx + dy * dy + dz * dz <= 16 && c.currentScreenHandler != null;   // customer.currentScreenHandler != null
    };
    this.canContinueToUse = this.canUse;
    this.start = function () { if (e.path) e.path = null; };
    this.stop = function () { e.customer = null; };
    this.tick = function () {};
  };
  /** LookAtCustomerGoal (.decomp): LOOK at the customer while there is one. */
  WT.LookAtCustomerGoal = function (e) {
    this.canUse = function () { return !!e.customer; };
    this.canContinueToUse = this.canUse;
    this.start = function () {};
    this.stop = function () {};
    this.tick = function () {
      var t = e.customer;
      if (t && e.look) e.look.setLookAt(t.x, t.y + (t.eyeHeight || 0), t.z);
    };
  };

  WT.rosterGoals = function (e, ctx) {
    var Ai = NS.Ai;
    var gs = new Ai.GoalSelector();
    gs.add(0, Ai.MOVE | Ai.JUMP, new Ai.FloatGoal(e, ctx.random));
    gs.add(0, 0, new WT.DrinkInvisibilityGoal(e));
    gs.add(0, 0, new WT.DrinkMilkGoal(e));
    gs.add(1, Ai.JUMP | Ai.MOVE, new WT.StopFollowingCustomerGoal(e));
    WT.fleeGoals(e).forEach(function (g) { gs.add(1, Ai.MOVE, g); });
    // EscapeDangerGoal(this, 0.5) -> Ai.PanicGoal -- the SAME substitution 07k_goals.js's own
    // llama/horse rosters already make (this file's own header cites the precedent).
    gs.add(1, Ai.MOVE, new Ai.PanicGoal(e, 0.5));
    gs.add(1, Ai.LOOK, new WT.LookAtCustomerGoal(e));
    gs.add(2, Ai.MOVE, new WT.WanderToTargetGoal(e, 2.0, 0.35));
    // WanderAroundFarGoal(this, 0.35): probability 0.001 NoPenalty, else FuzzyTargeting 10/7 (15/7 in water)
    gs.add(8, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 0.35, ctx.random));
    gs.add(4, Ai.MOVE, new Ai.GoToWalkTargetGoal(e, 0.35, ctx.random));
    // StopAndLookAtEntityGoal(Player, 3, 1): LookAtEntityGoal with controls MOVE|LOOK (.decomp)
    gs.add(9, Ai.LOOK | Ai.MOVE, new Ai.LookAtPlayerGoal(e, ctx.players, 3.0, undefined, 1.0));
    gs.add(10, Ai.LOOK, new Ai.LookAtMobGoal(e, ctx, 8.0));
    return gs;
  };

  // -- 7. THE MANAGER -- WanderingTraderManager (.decomp, whole). A pure function over a
  // caller-supplied ctx (this file's own header names the precedent: Rd.tick/Rd.buildLiveCtx,
  // 07s_raid.js, before Main.worldTick wired it) rather than reaching for a live world
  // singleton this engine's test harnesses cannot build headless.
  //   ctx.rand()            -- random() in [0,1); default Math.random
  //   ctx.players()         -- the live player list (EL.aiCtx's own convention)
  //   ctx.doTraderSpawning  -- GameRules.DO_TRADER_SPAWNING, default true if omitted
  //   ctx.doMobSpawning     -- GameRules.DO_MOB_SPAWNING, default true if omitted
  //   ctx.heightAt(x, z)    -- World.heightAt (07_world.js), null/undefined on no column
  //   ctx.isSpawnable(type, x, y, z)  -- SpawnRestriction.Location stand-in, default true
  //   ctx.collisionEmpty(x, y, z)     -- block's collision shape is empty, default true
  //   ctx.isOceanBiome(pos) -- the ocean-biome exclusion (.decomp:98-100), default false/unbuilt
  //   ctx.spawnFn(type, x, y, z)      -- EntityList.spawn stand-in
  WT.Manager = { spawnTimer: 1200, spawnDelay: 24000, spawnChance: 25 };
  WT.SPAWN_TIMER_RESET = 1200;   // DEFAULT_SPAWN_TIMER
  WT.SPAWN_DELAY_RESET = 24000;  // DEFAULT_SPAWN_DELAY
  WT.MIN_SPAWN_CHANCE = 25;
  WT.MAX_SPAWN_CHANCE = 75;
  WT.SPAWN_CHANCE_STEP = 25;

  WT.resetManager = function () {
    WT.Manager.spawnTimer = WT.SPAWN_TIMER_RESET;
    WT.Manager.spawnDelay = WT.SPAWN_DELAY_RESET;
    WT.Manager.spawnChance = WT.MIN_SPAWN_CHANCE;
  };

  /** ServerWorldProperties' WanderingTraderSpawnDelay/Chance (+ the engine's own spawnTimer):
   *  the manager's three counters as plain JSON for 16b_save.js, restored by fromJSON. */
  WT.managerToJSON = function () {
    var M = WT.Manager;
    return { timer: M.spawnTimer | 0, delay: M.spawnDelay | 0, chance: M.spawnChance | 0 };
  };
  WT.managerFromJSON = function (o) {
    WT.resetManager();   // absent (a save from before this) = the fresh-world counters
    if (!o || typeof o !== 'object') return;
    var M = WT.Manager;
    if (isFinite(o.timer) && o.timer >= 0) M.spawnTimer = o.timer | 0;
    if (isFinite(o.delay) && o.delay >= 0) M.spawnDelay = o.delay | 0;
    if (isFinite(o.chance) && o.chance >= 0 && o.chance <= 100) M.spawnChance = o.chance | 0;
  };

  /** WanderingTraderManager.getNearbySpawnPos (.decomp:129-142) -- 10 tries, a random point in
   *  a radius*2 square re-centred on origin, its column's own heightAt, ctx.isSpawnable
   *  standing in for SpawnHelper.canSpawn(SpawnRestriction.Location...). */
  WT.getNearbySpawnPos = function (ctx, origin, radius, rand) {
    for (var i = 0; i < 10; i++) {
      var x = origin.x + Math.floor(rand() * radius * 2) - radius;
      var z = origin.z + Math.floor(rand() * radius * 2) - radius;
      var y = ctx.heightAt ? ctx.heightAt(x, z) : origin.y;
      if (y === null || y === undefined) continue;
      if (!ctx.isSpawnable || ctx.isSpawnable('wandering_trader', x, y, z)) return { x: x, y: y, z: z };
    }
    return null;
  };

  /** WanderingTraderManager.doesNotSuffocateAt (.decomp:144-151) -- the 2x3x2 volume (x..x+1, y..y+2, z..z+1), every collision shape empty. */
  WT.doesNotSuffocateAt = function (ctx, pos) {
    if (!ctx.collisionEmpty) return true;
    for (var dx = 0; dx <= 1; dx++) for (var dy = 0; dy <= 2; dy++) for (var dz = 0; dz <= 1; dz++)
      if (!ctx.collisionEmpty(pos.x + dx, pos.y + dy, pos.z + dz)) return false;
    return true;
  };

  /** WanderingTraderManager.spawnLlama (.decomp:108-115) -- a llama within radius of the
   *  trader's own block position, LEASHED to it. e.leashHolder = {kind:'entity', entity} is ONE
   *  new holder kind on the existing leash substrate (Tm.leashToHolder's own {kind:'player'}/
   *  {kind:'knot'} shape, 07n_tame.js) -- Ls.holderAnchor (07u_leash.js) gets the matching
   *  one-branch addition so the rope still renders, not a parallel leash system. */
  WT.spawnLlama = function (ctx, trader, radius, rand) {
    var pos = WT.getNearbySpawnPos(ctx, { x: Math.floor(trader.x), z: Math.floor(trader.z) }, radius, rand);
    if (!pos) return null;
    var llama = ctx.spawnFn ? ctx.spawnFn('trader_llama', pos.x + 0.5, pos.y, pos.z + 0.5) : null;
    if (llama) llama.leashHolder = { kind: 'entity', entity: trader };
    return llama;
  };

  /** WanderingTraderManager.trySpawn (.decomp:84-107). $$6 = PointOfInterestStorage.getPosition(
   *  MEETING (bell), any, playerPos, 48, ANY).orElse(playerPos) (.decomp:96-100, #3843): the spawn
   *  search, wanderTarget and home all centre on a bell within 48 blocks, else on the player. */
  WT.trySpawn = function (ctx, rand) {
    var players = (ctx.players && ctx.players()) || [];
    if (!players.length) return true;   // getRandomAlivePlayer() == null -> true, .decomp:86
    if (Math.floor(rand() * 10) !== 0) return false;   // random.nextInt(10) != 0, .decomp:88
    var p = players[Math.floor(rand() * players.length)];
    var origin = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    var P = NS.Poi;
    if (P && P.getPosition) {
      var bell = P.getPosition(function (t) { return t === P.MEETING; }, null, P.STATUS.ANY, origin, 48, rand);
      if (bell) origin = bell;
    }
    var pos = WT.getNearbySpawnPos(ctx, origin, 48, rand);
    if (!pos || !WT.doesNotSuffocateAt(ctx, pos)) return false;
    if (ctx.isOceanBiome && ctx.isOceanBiome(pos)) return false;   // .decomp:98-100 is the_void (never generated): no caller supplies this (#4193)
    var trader = ctx.spawnFn ? ctx.spawnFn('wandering_trader', pos.x + 0.5, pos.y, pos.z + 0.5) : null;
    if (!trader) return false;
    for (var i = 0; i < 2; i++) WT.spawnLlama(ctx, trader, 4, rand);
    trader.despawnDelay = WT.DESPAWN_DELAY;
    trader.wanderTarget = origin;
    NS.Ai.setPositionTarget(trader, origin, 16);   // .decomp:110, the 16-block home radius
    return true;
  };

  /** WanderingTraderManager.spawn (.decomp:47-77), verbatim countdown/gate shape. Returns 1 on
   *  a spawn, 0 otherwise -- Spawner.spawn's own return convention. */
  WT.tickManager = function (ctx) {
    ctx = ctx || {};
    var rand = ctx.rand || RNDFB;
    var M = WT.Manager;
    if (ctx.doTraderSpawning === false) return 0;
    if (--M.spawnTimer > 0) return 0;
    M.spawnTimer = WT.SPAWN_TIMER_RESET;
    M.spawnDelay -= WT.SPAWN_TIMER_RESET;
    if (M.spawnDelay > 0) return 0;
    M.spawnDelay = WT.SPAWN_DELAY_RESET;
    if (ctx.doMobSpawning === false) return 0;
    var prevChance = M.spawnChance;
    M.spawnChance = Math.min(Math.max(M.spawnChance + WT.SPAWN_CHANCE_STEP, WT.MIN_SPAWN_CHANCE), WT.MAX_SPAWN_CHANCE);
    if (Math.floor(rand() * 100) > prevChance) return 0;
    if (WT.trySpawn(ctx, rand)) { M.spawnChance = WT.MIN_SPAWN_CHANCE; return 1; }
    return 0;
  };

  WT.OWED = [
    // CLOSED #5909: tools/extract-wtrader-trades.mjs + wtradercheck §1b diff both pools against .decomp.
    // CLOSED #5327: StopFollowingCustomerGoal tests customer.currentScreenHandler (set by H.openTrading).
    // struck D-567: the 32-tick item use -- WT.HoldInHandsGoal + WT.tickUse, milk clears ALL effects.
    // CLOSED #1799: ctx.isSpawnable is Spawn.canSpawnOnGround (17_main.js).
    // STRUCK #6339: vanilla's only biome gate is BiomeKeys.THE_VOID (.decomp:97, never generated), not mushroom fields (#4193); ctx.isOceanBiome stays unwired.
    // CLOSED s103 (orchestrator): WT.tickManager is wired into Main.worldTick (17_main.js).
    // CLOSED #1307: despawnDelay/wanderTarget/offers (07zw_mobnbt.js) and the manager counters
    // (WT.managerToJSON, 16b_save.js `wtm`) now round-trip.
    // CLOSED #5325: DefendTraderGoal tracks trader.lastAttacker (Cb.notePlayerHit); vanilla's attacker is
    // not written to NBT either (LivingEntity.writeCustomDataToNbt has no attacker), so not persisting is parity.
  ];

  WT.ready = true;
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
