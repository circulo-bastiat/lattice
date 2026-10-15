// 07p_trade.js — PLAN G18f: VILLAGER TRADING, the mechanism (screen substrate + the transaction
// itself), PLUS levels/XP and restocking (D-484). AFTER 07o_profession.js: same "per-profession
// extra state" slot Tame plays for wolf/cat, and it reads `e.profession`, which that file is the
// only writer of.
//
// ⚠ SCOPE, NAMED NOT GUESSED (D-48x). `tools/golden/villager-trades-1.18.2.tsv`
// (extract-villager-trades.mjs, D-480) is 328 jar-verified rows, but two real vanilla pieces
// are NOT in this unit and are named here rather than approximated (a third,
// `sell_type_variant_item_for_emerald` — fisherman's L5 boat — is now built: loop/vtype-s105
// gave every villager `e.villagerType`, and `rollTypeVariantItem` below just indexes the
// factory's own byVillagerType table with it, no new substrate of this unit's own):
//   - TRADE SELECTION: vanilla picks a random subset of a level's own listing array; this unit
//     offers EVERY row for the profession/level instead (still jar-verified VALUES, only the
//     "which ones" question is simplified) — the selection algorithm was not read this session
//     and inventing one would be exactly rule 4's mistake.
//   - Price/demand adjustment: D-505 (Trade.adjustedFirstCount); gossip, golems and raids live in 07l/07s.
// See `Trade.OWED`.
//
// Semantics per `kind` are the EXTRACTOR's own header comment (jar-verified, not remembered):
// sell_item_for_emerald = player PAYS itemQty of item, GETS priceEmerald emerald(s) ·
// buy_item_for_emerald = player PAYS priceEmerald emerald, GETS itemQty of item ·
// buy_item_for_emerald_and_item = player PAYS priceEmerald emerald AND itemQty of item, GETS
// item2Qty of item2 · sell_suspicious_stew_for_emerald = player PAYS priceEmerald emerald, GETS
// one suspicious stew carrying `effect`/`durationTicks` (applying that effect on EATING the stew
// is a potion-effect substrate this engine does not have yet — `Cb.OWED`/row 0 item 5 — the
// trade still hands over a real, correctly-tagged item).
//
// LEVELS/XP AND RESTOCKING (D-484) — javap'd off `bnw` (Villager) and `bnx` (VillagerData) in
// the staged `jars/1.18.2/1.18.2.jar` (D-470's container recipe). Every constant below is read
// off the bytecode, not remembered (rule 3/4):
//   - `bnx`'s own static `int[] d = {0, 10, 70, 150, 250}` and `bnx.c(int level)` (returns
//     `d[level]` when `1 <= level < 5`, else 0) is the xp a villager AT `level` needs before
//     `bnw.gg()` (`canLevelUp`) allows the next level. `bnw.b(bzt)` (`rewardTradeXp`) adds the
//     offer's own xp unconditionally, and — ONLY if `gg()` is now true — sets a 40-tick
//     celebration timer (`cm`, `bipush 40`) and a pending-levelup flag (`cn`); `bnw.R()`
//     (the AI tick) counts `cm` down and calls `gh()` (`increaseMerchantCareer`) when it hits 0
//     with the flag still set — the level-up is NOT instant, it waits out the celebration.
//   - `bnw.ga()` (`allowedToRestock`): `RestocksToday` (`cw`) 0 -> allowed; `cw` < 2
//     (`iconst_2`) AND `dayTime >= lastRestock + 2400` (`ldc2_w 2400l`) -> allowed; else not.
//   - `bnw.fP()`: the daily window resets (`lastRestock = dayTime`, `RestocksToday = 0`) when
//     either `dayTime >= lastRestock + 12000` (half a day, `ldc2_w 12000l`) OR the day index
//     (`dayTime / 24000`, `Level.TICKS_PER_DAY` — same constant `09b_sky.js`'s `Sky.TICKS_PER_DAY`
//     already carries) has advanced since the last check.
//   - `bnw.fO()` (`restock`): resets every offer's use counter to 0 (`bzt.h()`), which is what
//     `Trade.restock` below does to `e.tradeUses`.
// s113: the proximity-to-workstation gate on restocking IS ported now (Trade.tickRestock runs only
// from 07zv_villagerbrain.js villagerWorkRun, VillagerWorkTask.java:41-43). (Old note: this engine restocked any professioned
// villager on schedule). s108 correction: the "3 + random(4), +5 on level-up" value this line used
// to call a particle count is the EXPERIENCE ORB's value (VillagerEntity.afterUsing, .decomp :584-595)
// — owed with G21's orbs. The happy-villager particles are status 14's FIVE (Trade.produceParticles).

(function (NS) {
  'use strict';
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6440)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = NS.JRandom ? new NS.JRandom(0x6440) : { s: 0x6440, nextDouble: function () { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return this.s / 4294967296; } }; return fbR.nextDouble(); }

  var Trade = NS.Trade = { ready: false };

  Trade.OWED = [
    // struck loop/vtype-s105: sell_type_variant_item_for_emerald (fisherman L5 boat) keyed off
    // the villager biome TYPE (Prof.typeAtBiome; villagertypecheck).
    // struck s113: restocking is gated on the work task (VillagerWorkTask.run, within 1.73 of the
    // claimed job site, WORK activity) -- Trade.tickRestock is called from villagerWorkRun only.
    // struck loop/enchpow-s105: SellEnchantedToolFactory now runs the real EnchantmentHelper.enchant
    // (07ox_enchhelper.js -- power windows, canCombine, multi-enchant draw; enchhelpercheck).
    // struck #229 (G18f-b): SellMapFactory's rendered terrain -- NS.MapContent (07pm_mapcontent.js,
    // mapcontentcheck) ports fillExplorationMap; a map's pixels are `MapContent.colorsFor(o.tag)`.
    // loop/tipped -- CLOSED the effect-APPLICATION half: `Cb.applyArrowTip`/`Po.tipFromTag`
    // (07z_potion.js/14j_combat.js) now replay `ArrowEntity.onHit`'s real dur/8-base-potion +
    // undivided-custom-effects shape, `tippedcheck.mjs`-verified.
    // struck loop/bow -- 'SellPotionHoldingItemFactory: ... nothing in this engine ever FIRES
    // a tipped arrow'. `Use.bowRelease` (14l_use.js) is a real `BowItem.onStoppedUsing`: a
    // player who buys this trade's own tipped_arrow, loads it (offhand/mainhand/inventory
    // search, `Use.getArrowSlot`) and draws a bow now fires a real, in-flight arrow carrying
    // this item's own jar-verified Potion tag through to `Cb.applyArrowTip` on hit
    // (`bowcheck.mjs`). Mob ammo-selection (a skeleton's OWN inventory bow) is still not built
    // -- named on `Po.OWED`'s own closing line, not this trade's -- but that was never this
    // item's own path: a villager sells to the PLAYER, not to a mob's equipment slot.
    // ~~the slot-placement economy (#228)~~ Trade.menu*: two input slots + result, click-to-select
    // autofill, take-result depletes the INPUT slots, the list scrolls past 7 (MerchantScreenHandler/Screen).
    // ~~the real slot/button widgets~~ D-483: `Trade.previewFor` + `Gui.MERCHANT_SLOT`/
    // `MERCHANT_ARROW`, javap'd off `aqo`/`clq$a` — see 15b_gui.js and Hud.drawTrading.
    // ~~levels 2-5, the XP/level-up system~~ D-484: `bnx`'s own xp table, `bnw.gg()`/`gh()`/`R()`.
    // ~~restocking (the use-counter reset itself)~~ D-484: `bnw.ga()`/`fP()`/`fO()`.
  ];

  var SUPPORTED = {
    sell_item_for_emerald: true,
    buy_item_for_emerald: true,
    buy_item_for_emerald_and_item: true,
    sell_suspicious_stew_for_emerald: true,
    enchant_book_for_emeralds: true,
    sell_enchanted_tool_for_emeralds: true,
    sell_dyed_armor_for_emerald: true,
    sell_map_for_emerald: true,
    sell_potion_holding_item_for_emerald: true,
    sell_type_variant_item_for_emerald: true
  };

  Trade.ready = !!(NS.DATA && NS.DATA.villagerTrades);

  /** `bnx`'s own static xp table (D-484): the xp a villager AT `level` (1-4) needs to level up. */
  Trade.MAX_LEVEL = 5;
  // Vanilla's own English merchant-level names (translation keys merchant.level.1-5) — display
  // text, not a code-owned number; not chased via javap.
  Trade.LEVEL_NAMES = ['', 'Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master'];
  var LEVEL_XP = [0, 10, 70, 150, 250]; // bnx.d, jar-verified — index by level directly
  var CELEBRATE_TICKS = 40;             // bnw.b(bzt): `bipush 40` into `cm`
  var RESTOCK_MAX_PER_DAY = 2;          // bnw.ga(): `iconst_2`
  var RESTOCK_MIN_GAP_TICKS = 2400;     // bnw.ga(): `ldc2_w 2400l`
  var RESTOCK_HALF_DAY_TICKS = 12000;   // bnw.fP(): `ldc2_w 12000l`
  var TICKS_PER_DAY = (NS.Sky && NS.Sky.TICKS_PER_DAY) || 24000; // bnw.fP() / Level.TICKS_PER_DAY

  Trade.xpForNextLevel = function (level) {
    return (level >= 1 && level < Trade.MAX_LEVEL) ? LEVEL_XP[level] : 0;
  };

  /** `bnw.gg()` — both directions matter (rule 6): under the threshold refuses, at/over allows. */
  Trade.canLevelUp = function (e) {
    var level = e.villagerLevel || 1;
    if (level < 1 || level >= Trade.MAX_LEVEL) return false;
    return (e.tradeXp || 0) >= LEVEL_XP[level];
  };

  /** Every buildable offer ROW at exactly `level` (data rows then procedural) — the whole table, for
   *  tests and lookups. A real villager draws 2 of the level's pool: `Trade.rollLevel`. */
  Trade.offersForLevel = function (profession, level) {
    var t = NS.DATA && NS.DATA.villagerTrades;
    var out = [];
    var rows = (t && t[profession] && t[profession][level]) || [];
    for (var i = 0; i < rows.length; i++) if (SUPPORTED[rows[i].kind]) out.push(rows[i]);
    var proc = PROCEDURAL[profession] && PROCEDURAL[profession][level];
    if (proc) for (var j = 0; j < proc.length; j++) out.push(proc[j]);
    return out;
  };

  /**
   * `TradeOffers.PROFESSION_TO_LEVELED_TRADE`'s own ARRAY ORDER for every level that mixes static
   * rows with procedural ones: `s` = the next row of the data table (in the table's order, the
   * unsupported boat row included), `p` = the next `PROCEDURAL` entry. Read off
   * `.decomp/net/minecraft/village/TradeOffers.java` (lines 124-562); `tradecheck` §8 re-derives
   * the multiset from that file and fails on any drift. A level not listed has no procedural
   * entries and is its data rows in order.
   */
  Trade.POOL_PATTERN = {
    fisherman: { 3: 'sp' },
    fletcher: { 4: 'sp', 5: 'spp' },
    librarian: { 1: 'sps', 2: 'sps', 3: 'sps', 4: 'spss' },
    cartographer: { 2: 'sp', 3: 'sp' },
    armorer: { 4: 'pp', 5: 'pp' },
    weaponsmith: { 1: 'ssp', 4: 'sp', 5: 'p' },
    toolsmith: { 3: 'sppps', 4: 'spp', 5: 'p' },
    leatherworker: { 1: 'spp', 2: 'spp', 3: 'sp', 4: 'sp', 5: 'sp' }
  };

  /** The level's WHOLE vanilla factory array, in vanilla order — unsupported kinds included (they
   *  resolve to no offer, the way this engine cannot build them), so the random draw below is
   *  over the same N indices vanilla draws over. */
  Trade.poolForLevel = function (profession, level) {
    var t = NS.DATA && NS.DATA.villagerTrades;
    var rows = (t && t[profession] && t[profession][level]) || [];
    var proc = (PROCEDURAL[profession] && PROCEDURAL[profession][level]) || [];
    var pat = Trade.POOL_PATTERN[profession] && Trade.POOL_PATTERN[profession][level];
    if (!pat) return rows.concat(proc);
    var out = [], si = 0, pi = 0;
    for (var i = 0; i < pat.length; i++) out.push(pat[i] === 'p' ? proc[pi++] : rows[si++]);
    return out;
  };

  /** `MerchantEntity.fillRecipesFromPool(offers, pool, count)` — VillagerEntity.fillRecipes passes
   *  count 2. More factories than `count`: draw `random.nextInt(pool.length)` into a HashSet until
   *  it holds `count` distinct indices; else take every index. The HashSet of small Integers
   *  iterates in ASCENDING order (hash = value), so the offers are added in pool order. */
  Trade.OFFERS_PER_LEVEL = 2;
  Trade.pickFromPool = function (pool, count, rng) {
    rng = rng || RNDFB;
    var picked = {}, n = 0, i;
    if (pool.length > count) {
      while (n < count) { i = Math.floor(rng() * pool.length); if (!picked[i]) { picked[i] = true; n++; } }
    } else for (i = 0; i < pool.length; i++) picked[i] = true;
    var out = [];
    for (i = 0; i < pool.length; i++) if (picked[i]) out.push(pool[i]);
    return out;
  };

  /** A level's rolled offers: the vanilla draw, then each drawn factory's `create` (null dropped). */
  Trade.rollLevel = function (profession, level, e, rng) {
    return Trade.resolveOffers(Trade.pickFromPool(Trade.poolForLevel(profession, level),
      Trade.OFFERS_PER_LEVEL, rng), e, rng);
  };

  /** Back-compat: level-1 only (existing callers/tests build off a fresh villager's own start). */
  Trade.offersFor = function (profession) { return Trade.offersForLevel(profession, 1); };

  // ── D-48x REMAINDER: THE FIVE PROCEDURAL FACTORIES, TradeOffers.java (.decomp) ──────────────
  //
  // `extract-villager-trades.mjs` only walks TradeOffers' STATIC factory-argument literals
  // (SellItemFactory/BuyForOneEmeraldFactory/ProcessItemFactory/TypeAwareBuyForOneEmeraldFactory/
  // SellSuspiciousStewFactory) — the five below build their OFFER at `Factory.create(Entity,
  // Random)` time, not at table-read time, so their per-instance randomness (which enchantment,
  // which dye, which potion, where the map points) is rolled HERE, once, when a villager's own
  // `Trade.ensure`/`Trade.increaseLevel` first pushes that row into `e.tradeOffers` — exactly
  // when vanilla's own `MerchantOffers.add(factory.create(villager, random))` runs. Restocking
  // (`Trade.restock`) only resets `tradeUses` (bnw.fO(), already true above) and never re-rolls,
  // matching `create` never being called again for an existing offer.
  //
  // PRICE ROSTER (jar-verified, TradeOffers.java, cited per row): the profession/level/item/
  // price/maxUses/xp/multiplier below are copied 1:1 off the constructor calls; only the
  // RANDOM part of each (which enchant, which dye, which potion, the map target) is rolled.
  var PROCEDURAL = {
    fisherman: {
      3: [{ profession: 'fisherman', level: 3, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'fishing_rod', basePrice: 3, maxUses: 3, xp: 10, priceMult: 0.2 }]
      // TradeOffers.java:125 `new SellEnchantedToolFactory(field_8378 fishing_rod, 3, 3, 10, 0.2F)`
    },
    fletcher: {
      4: [{ profession: 'fletcher', level: 4, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'bow', basePrice: 2, maxUses: 3, xp: 15, priceMult: 0.05 }],
      // TradeOffers.java:277 `new SellEnchantedToolFactory(field_8102 bow, 2, 3, 15)` (4-arg ctor, mult defaults 0.05F)
      5: [{ profession: 'fletcher', level: 5, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'crossbow', basePrice: 3, maxUses: 3, xp: 15, priceMult: 0.05 },
          // TradeOffers.java:282 `new SellEnchantedToolFactory(field_8399 crossbow, 3, 3, 15)`
          { profession: 'fletcher', level: 5, kind: 'sell_potion_holding_item_for_emerald',
            secondBuy: 'arrow', secondCount: 5, sell: 'tipped_arrow', sellCount: 5,
            priceEmerald: 2, maxUses: 12, xp: 30 }]
          // TradeOffers.java:283 `new SellPotionHoldingItemFactory(field_8107 arrow,5, field_8087
          // tipped_arrow,5, price 2, maxUses 12, xp 30)`
    },
    librarian: {
      1: [{ profession: 'librarian', level: 1, kind: 'enchant_book_for_emeralds', xp: 1 }],
      2: [{ profession: 'librarian', level: 2, kind: 'enchant_book_for_emeralds', xp: 5 }],
      3: [{ profession: 'librarian', level: 3, kind: 'enchant_book_for_emeralds', xp: 10 }],
      4: [{ profession: 'librarian', level: 4, kind: 'enchant_book_for_emeralds', xp: 15 }]
      // TradeOffers.java:296,304,312,320 `new EnchantBookFactory(1|5|10|15)` — the xp argument
    },
    cartographer: {
      2: [{ profession: 'cartographer', level: 2, kind: 'sell_map_for_emerald',
            structureKeyword: 'monument', nameKey: 'filled_map.monument', price: 13, maxUses: 12, xp: 5 }],
      // TradeOffers.java:340 `new SellMapFactory(13, ..._monument tag, "filled_map.monument", MONUMENT icon, 12, 5)`
      3: [{ profession: 'cartographer', level: 3, kind: 'sell_map_for_emerald',
            structureKeyword: 'mansion', nameKey: 'filled_map.mansion', price: 14, maxUses: 12, xp: 10 }]
      // TradeOffers.java:345 `new SellMapFactory(14, ..._mansion tag, "filled_map.mansion", MANSION icon, 12, 10)`
    },
    armorer: {
      4: [{ profession: 'armorer', level: 4, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'diamond_leggings', basePrice: 14, maxUses: 3, xp: 15, priceMult: 0.2 },
          { profession: 'armorer', level: 4, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'diamond_boots', basePrice: 8, maxUses: 3, xp: 15, priceMult: 0.2 }],
      // TradeOffers.java:431-432
      5: [{ profession: 'armorer', level: 5, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'diamond_helmet', basePrice: 8, maxUses: 3, xp: 30, priceMult: 0.2 },
          { profession: 'armorer', level: 5, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'diamond_chestplate', basePrice: 16, maxUses: 3, xp: 30, priceMult: 0.2 }]
      // TradeOffers.java:436-437
    },
    weaponsmith: {
      1: [{ profession: 'weaponsmith', level: 1, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'iron_sword', basePrice: 2, maxUses: 3, xp: 1, priceMult: 0.05 }],
      // TradeOffers.java:450 `new SellEnchantedToolFactory(field_8371 iron_sword, 2, 3, 1)` (4-arg, mult 0.05F)
      4: [{ profession: 'weaponsmith', level: 4, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'diamond_axe', basePrice: 12, maxUses: 3, xp: 15, priceMult: 0.2 }],
      // TradeOffers.java:462
      5: [{ profession: 'weaponsmith', level: 5, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'diamond_sword', basePrice: 8, maxUses: 3, xp: 30, priceMult: 0.2 }]
      // TradeOffers.java:465
    },
    toolsmith: {
      3: [{ profession: 'toolsmith', level: 3, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'iron_axe', basePrice: 1, maxUses: 3, xp: 10, priceMult: 0.2 },
          { profession: 'toolsmith', level: 3, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'iron_shovel', basePrice: 2, maxUses: 3, xp: 10, priceMult: 0.2 },
          { profession: 'toolsmith', level: 3, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'iron_pickaxe', basePrice: 3, maxUses: 3, xp: 10, priceMult: 0.2 }],
      // TradeOffers.java:489-491
      4: [{ profession: 'toolsmith', level: 4, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'diamond_axe', basePrice: 12, maxUses: 3, xp: 15, priceMult: 0.2 },
          { profession: 'toolsmith', level: 4, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'diamond_shovel', basePrice: 5, maxUses: 3, xp: 15, priceMult: 0.2 }],
      // TradeOffers.java:497-498
      5: [{ profession: 'toolsmith', level: 5, kind: 'sell_enchanted_tool_for_emeralds',
            item: 'diamond_pickaxe', basePrice: 13, maxUses: 3, xp: 30, priceMult: 0.2 }]
      // TradeOffers.java:501
    },
    leatherworker: {
      1: [{ profession: 'leatherworker', level: 1, kind: 'sell_dyed_armor_for_emerald',
            item: 'leather_leggings', price: 3, maxUses: 12, xp: 1 },
          { profession: 'leatherworker', level: 1, kind: 'sell_dyed_armor_for_emerald',
            item: 'leather_chestplate', price: 7, maxUses: 12, xp: 1 }],
      // TradeOffers.java:541-542 (2-arg ctor: `this($$0, $$1, 12, 1)`, always maxUses 12 xp 1)
      2: [{ profession: 'leatherworker', level: 2, kind: 'sell_dyed_armor_for_emerald',
            item: 'leather_helmet', price: 5, maxUses: 12, xp: 5 },
          { profession: 'leatherworker', level: 2, kind: 'sell_dyed_armor_for_emerald',
            item: 'leather_boots', price: 4, maxUses: 12, xp: 5 }],
      // TradeOffers.java:547-548 (4-arg ctor, explicit xp 5)
      3: [{ profession: 'leatherworker', level: 3, kind: 'sell_dyed_armor_for_emerald',
            item: 'leather_chestplate', price: 7, maxUses: 12, xp: 1 }],
      // TradeOffers.java:552 (2-arg ctor again — vanilla's own level-3 chestplate row really is
      // maxUses 12 / xp 1, same as level 1's; not a transcription slip)
      4: [{ profession: 'leatherworker', level: 4, kind: 'sell_dyed_armor_for_emerald',
            item: 'leather_horse_armor', price: 6, maxUses: 12, xp: 15 }],
      // TradeOffers.java:557
      5: [{ profession: 'leatherworker', level: 5, kind: 'sell_dyed_armor_for_emerald',
            item: 'leather_helmet', price: 5, maxUses: 12, xp: 30 }]
      // TradeOffers.java:562
    }
  };

  // ── the enchantment roster, Enchantment.java + Enchantments.java + thirty-one per-enchantment
  // subclasses (.decomp/net/minecraft/enchantment/*.java) — minLevel is 1 for every one of them
  // (no subclass overrides `getMinLevel`), so only maxLevel is carried. `weight` is
  // `Enchantment.Rarity.getWeight()` (COMMON 10, UNCOMMON 5, RARE 2, VERY_RARE 1). `treasure` is
  // `isTreasure()`. `target` is each subclass's own `super(...)` `EnchantmentTarget` argument
  // (EnchantmentTarget.java's `isAcceptableItem` bodies, read in ordinal order). `bookOffer` is
  // `isAvailableForEnchantedBookOffer()` — true for every enchantment except `soul_speed`.
  var ENCH = {
    protection: { maxLevel: 4, weight: 10, treasure: false, target: 'armor', bookOffer: true },
    fire_protection: { maxLevel: 4, weight: 5, treasure: false, target: 'armor', bookOffer: true },
    feather_falling: { maxLevel: 4, weight: 5, treasure: false, target: 'armor_feet', bookOffer: true },
    blast_protection: { maxLevel: 4, weight: 2, treasure: false, target: 'armor', bookOffer: true },
    projectile_protection: { maxLevel: 4, weight: 5, treasure: false, target: 'armor', bookOffer: true },
    respiration: { maxLevel: 3, weight: 2, treasure: false, target: 'armor_head', bookOffer: true },
    aqua_affinity: { maxLevel: 1, weight: 2, treasure: false, target: 'armor_head', bookOffer: true },
    thorns: { maxLevel: 3, weight: 1, treasure: false, target: 'armor_chest', bookOffer: true },
    depth_strider: { maxLevel: 3, weight: 2, treasure: false, target: 'armor_feet', bookOffer: true },
    frost_walker: { maxLevel: 2, weight: 2, treasure: true, target: 'armor_feet', bookOffer: true },
    binding_curse: { maxLevel: 1, weight: 1, treasure: true, target: 'armor', bookOffer: true },
    soul_speed: { maxLevel: 3, weight: 1, treasure: true, target: 'armor_feet', bookOffer: false },
    sharpness: { maxLevel: 5, weight: 10, treasure: false, target: 'weapon', bookOffer: true },
    smite: { maxLevel: 5, weight: 5, treasure: false, target: 'weapon', bookOffer: true },
    bane_of_arthropods: { maxLevel: 5, weight: 5, treasure: false, target: 'weapon', bookOffer: true },
    knockback: { maxLevel: 2, weight: 5, treasure: false, target: 'weapon', bookOffer: true },
    fire_aspect: { maxLevel: 2, weight: 2, treasure: false, target: 'weapon', bookOffer: true },
    looting: { maxLevel: 3, weight: 2, treasure: false, target: 'weapon', bookOffer: true },
    sweeping: { maxLevel: 3, weight: 2, treasure: false, target: 'weapon', bookOffer: true },
    efficiency: { maxLevel: 5, weight: 10, treasure: false, target: 'digger', bookOffer: true },
    silk_touch: { maxLevel: 1, weight: 1, treasure: false, target: 'digger', bookOffer: true },
    unbreaking: { maxLevel: 3, weight: 5, treasure: false, target: 'breakable', bookOffer: true },
    fortune: { maxLevel: 3, weight: 2, treasure: false, target: 'digger', bookOffer: true },
    power: { maxLevel: 5, weight: 10, treasure: false, target: 'bow', bookOffer: true },
    punch: { maxLevel: 2, weight: 2, treasure: false, target: 'bow', bookOffer: true },
    flame: { maxLevel: 1, weight: 2, treasure: false, target: 'bow', bookOffer: true },
    infinity: { maxLevel: 1, weight: 1, treasure: false, target: 'bow', bookOffer: true },
    luck_of_the_sea: { maxLevel: 3, weight: 2, treasure: false, target: 'fishing_rod', bookOffer: true },
    lure: { maxLevel: 3, weight: 2, treasure: false, target: 'fishing_rod', bookOffer: true },
    loyalty: { maxLevel: 3, weight: 5, treasure: false, target: 'trident', bookOffer: true },
    impaling: { maxLevel: 5, weight: 2, treasure: false, target: 'trident', bookOffer: true },
    riptide: { maxLevel: 3, weight: 2, treasure: false, target: 'trident', bookOffer: true },
    channeling: { maxLevel: 1, weight: 1, treasure: false, target: 'trident', bookOffer: true },
    multishot: { maxLevel: 1, weight: 2, treasure: false, target: 'crossbow', bookOffer: true },
    quick_charge: { maxLevel: 3, weight: 5, treasure: false, target: 'crossbow', bookOffer: true },
    piercing: { maxLevel: 4, weight: 10, treasure: false, target: 'crossbow', bookOffer: true },
    mending: { maxLevel: 1, weight: 2, treasure: true, target: 'breakable', bookOffer: true },
    vanishing_curse: { maxLevel: 1, weight: 1, treasure: true, target: 'breakable', bookOffer: true }
  };
  Trade.ENCH = ENCH;   // the creative inventory's enchanted-book variants (15e_creative.js) walk this same roster
  var ENCH_BOOK_IDS = Object.keys(ENCH).filter(function (id) { return ENCH[id].bookOffer; });

  /** Item -> the EnchantmentTarget categories it satisfies (EnchantmentTarget.java's own
   *  `isAcceptableItem`, applied by hand to the specific items these trades sell — every one of
   *  them is also BREAKABLE, `isDamageable()`, which is where `unbreaking` comes from). */
  var TARGET_OF = {
    fishing_rod: ['fishing_rod', 'breakable'],
    bow: ['bow', 'breakable'],
    crossbow: ['crossbow', 'breakable'],
    iron_sword: ['weapon', 'breakable'],
    diamond_sword: ['weapon', 'breakable'],
    iron_axe: ['digger', 'breakable'], diamond_axe: ['digger', 'breakable'],
    iron_shovel: ['digger', 'breakable'], diamond_shovel: ['digger', 'breakable'],
    iron_pickaxe: ['digger', 'breakable'], diamond_pickaxe: ['digger', 'breakable'],
    diamond_leggings: ['armor', 'armor_legs', 'breakable'],
    diamond_boots: ['armor', 'armor_feet', 'breakable'],
    diamond_helmet: ['armor', 'armor_head', 'breakable'],
    diamond_chestplate: ['armor', 'armor_chest', 'breakable']
  };

  /** `DyeColor`'s own sixteen `textureDiffuseColor`s, ordinal order — the SAME column
   *  `crafting_special_armordye` reads (D-268) and `tools/golden/dye-colours-1.18.2.tsv`
   *  carries; transcribed here rather than importing the renderer module so this file
   *  stays loadable with no GL/DOM present (`tradecheck` runs headless). */
  var DYE_NAMES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
    'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  var DYE_RGB = [0xF9FFFE, 0xF9801D, 0xC74EBD, 0x3AB3DA, 0xFED83D, 0x80C71F, 0xF38BAA, 0x474F52,
    0x9D9D97, 0x169C9C, 0x8932B8, 0x3C44AA, 0x835432, 0x5E7C16, 0xB02E26, 0x1D1D21];

  /** `Potions.java`'s own registered list, minus the five effect-less base potions (empty, water,
   *  mundane, thick, awkward) and `luck` — `luck` has no brewing recipe in vanilla
   *  (`BrewingRecipeRegistry.isBrewable` is false for it), which is the second half of
   *  `SellPotionHoldingItemFactory`'s own filter (`!effects.isEmpty() && isBrewable`). */
  var BREWABLE_POTIONS = ['night_vision', 'long_night_vision', 'invisibility', 'long_invisibility',
    'leaping', 'long_leaping', 'strong_leaping', 'fire_resistance', 'long_fire_resistance',
    'swiftness', 'long_swiftness', 'strong_swiftness', 'slowness', 'long_slowness',
    'strong_slowness', 'turtle_master', 'long_turtle_master', 'strong_turtle_master',
    'water_breathing', 'long_water_breathing', 'healing', 'strong_healing', 'harming',
    'strong_harming', 'poison', 'long_poison', 'strong_poison', 'regeneration',
    'long_regeneration', 'strong_regeneration', 'strength', 'long_strength', 'strong_strength',
    'weakness', 'long_weakness', 'slow_falling', 'long_slow_falling'];

  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

  /** `EnchantBookFactory.create` (TradeOffers.java:742): a UNIFORM pick over every
   *  `isAvailableForEnchantedBookOffer` enchantment (curses and mending included, only
   *  `soul_speed` excluded — jar-verified, not a guess), a uniform level in its own
   *  [1, maxLevel], then `2 + nextInt(5 + level*10) + 3*level`, doubled if treasure, capped 64. */
  function rollEnchantBook(row, e, rng) {
    var id = pick(ENCH_BOOK_IDS, rng);
    var e = ENCH[id];
    var level = 1 + Math.floor(rng() * e.maxLevel);
    var price = 2 + Math.floor(rng() * (5 + level * 10)) + 3 * level;
    if (e.treasure) price *= 2;
    if (price > 64) price = 64;
    return {
      kind: row.kind, priceEmerald: price, maxUses: 12, xp: row.xp, priceMult: 0.2,
      item: 'enchanted_book', tag: { StoredEnchantments: [{ id: 'minecraft:' + id, lvl: level }] }
    };
  }

  /**
   * `SellEnchantedToolFactory.create` (TradeOffers.java:855-881): vanilla rolls a "shelf level"
   * `5 + nextInt(15)` and hands it straight to `EnchantmentHelper.enchant(random, stack, level,
   * false)` (07ox_enchhelper.js's `EnchHelper.enchant` — the full per-enchantment-level
   * min/max POWER windows, weighted multi-enchantment draw and `canCombine` exclusion groups,
   * jar-verified table by table — see that file's own header). `treasureAllowed=false` is
   * jar-verified from this same call site (excludes mending/curses/frost_walker/soul_speed).
   * The tool's own price (`min(basePrice + level, 64)`), maxUses, xp and multiplier are exact
   * and depend only on `level`, never on which enchantment(s) were drawn.
   */
  function rollEnchantedTool(row, e, rng) {
    var level = 5 + Math.floor(rng() * 15);
    var targets = TARGET_OF[row.item] || [];
    var picks = NS.EnchHelper.enchant(rng, row.item, targets, level, false);
    var price = Math.min(row.basePrice + level, 64);
    var tag = picks.length
      ? { Enchantments: picks.map(function (p) { return { id: 'minecraft:' + p.id, lvl: p.level }; }) }
      : undefined;
    return {
      kind: row.kind, priceEmerald: price, maxUses: row.maxUses, xp: row.xp, priceMult: row.priceMult,
      item: row.item, tag: tag
    };
  }

  /**
   * `SellDyedArmorFactory.create` (TradeOffers.java:812): one dye always, +1 more if
   * `nextFloat() > 0.7F`, +1 more if `nextFloat() > 0.8F` (so 1..3, weighted toward 1), then
   * `DyeableItem.blendAndSetColor` — the SAME weighted-by-brightest-component blend
   * `crafting_special_armordye` already implements (02h_recipes.js `S.armordye`), reproduced
   * here on a bare (untagged) base stack so this file stays independent of the crafting module.
   */
  /** D-669: `create` dyes only `instanceof DyeableArmorItem` — Items.java registers exactly the
   *  four leather armour pieces as that class; leather_horse_armor is a DyeableHorseArmorItem and
   *  sells UNDYED (and draws no dye RNG). */
  var DYEABLE_ARMOR = { leather_helmet: 1, leather_chestplate: 1, leather_leggings: 1, leather_boots: 1 };
  function rollDyedArmor(row, e, rng) {
    if (!DYEABLE_ARMOR[row.item]) {
      return { kind: row.kind, priceEmerald: row.price, maxUses: row.maxUses, xp: row.xp, priceMult: 0.2, item: row.item };
    }
    // vanilla's own draw ORDER (SellDyedArmorFactory.create): dye, then `nextFloat() > 0.7` and its dye, then `nextFloat() > 0.8` and its dye
    var dyes = [Math.floor(rng() * 16) % 16];
    if (rng() > 0.7) dyes.push(Math.floor(rng() * 16) % 16);
    if (rng() > 0.8) dyes.push(Math.floor(rng() * 16) % 16);
    var n = dyes.length;
    var r = 0, g = 0, b = 0, total = 0, i;
    for (i = 0; i < n; i++) {
      var di = dyes[i];
      var v = DYE_RGB[di];
      var vr = (v >> 16) & 255, vg = (v >> 8) & 255, vb = v & 255;
      total += Math.max(vr, Math.max(vg, vb));
      r += vr; g += vg; b += vb;
    }
    r = (r / n) | 0; g = (g / n) | 0; b = (b / n) | 0;
    var mean = total / n, mx = Math.max(r, Math.max(g, b));
    if (mx > 0) { r = (r * mean / mx) | 0; g = (g * mean / mx) | 0; b = (b * mean / mx) | 0; }
    return {
      kind: row.kind, priceEmerald: row.price, maxUses: row.maxUses, xp: row.xp, priceMult: 0.2,
      item: row.item, tag: { display: { color: (r << 16) | (g << 8) | b } }
    };
  }

  /**
   * `SellMapFactory.create` (TradeOffers.java:925): `ServerWorld.locateStructure` over the
   * real placement grid — ported here as a spiral search of `Structures.ST`'s own
   * `startsOfRegion` (04r_structures.js), the SAME per-region start test worldgen itself asks,
   * out to vanilla's own 100-CHUNK search radius. Returns `null` (no offer, matching vanilla's
   * `create` returning `null` when no structure is found) rather than fabricating a position.
   * The rendered terrain pixels: `NS.MapContent.colorsFor(tag)` (07pm_mapcontent.js), lazily.
   */
  var _mapIdSeq = 1;
  function rollMap(row, e, rng) {
    var pos = Trade.locateStructure(row.structureKeyword, e && e.x, e && e.z);
    if (!pos) return null;
    return {
      kind: row.kind, priceEmerald: row.price, maxUses: row.maxUses, xp: row.xp, priceMult: 0.2,
      item: 'filled_map', mapId: (_mapIdSeq++) & 0xFFFF,
      tag: { scale: 2, unlimitedTracking: true, locked: true, dimension: 'overworld',
             target: { x: pos.x, z: pos.z }, decoration: '+', nameKey: row.nameKey }
    };
  }

  /**
   * `TypeAwareBuyForOneEmeraldFactory.create` (`r.cls === 'c'`, extract-villager-trades.mjs) --
   * fisherman L5's own boat trade, the ONLY vanilla offer keyed off the VILLAGER'S OWN biome
   * TYPE rather than a random roll: `row.byVillagerType` is the jar's own 7-entry `VillagerType
   * -> boat item` table (extracted straight off the factory's own field pairs, D-480), and this
   * just indexes it by `e.villagerType` (Prof.typeAtBiome/forBiome, loop/vtype-s105) -- no RNG
   * involved, unlike every other PROCEDURAL_KINDS entry above. `e.villagerType` is never
   * undefined past spawn (07i_entitylist.js/07zr_zvillager.js's own DEFAULTS both default it to
   * 'plains', which `byVillagerType` itself carries a row for), so the fallback below is a
   * belt-and-braces default for a caller that hands this a bare row/entity in a test, not a
   * live gap.
   */
  function rollTypeVariantItem(row, e, rng) {
    var byType = row.byVillagerType;
    if (!byType) return null;
    var type = (e && e.villagerType) || 'plains';
    var item = byType[type] || byType.plains;
    if (!item) return null;
    return {
      kind: row.kind, priceEmerald: row.priceEmerald || 1, itemQty: row.itemQty,
      maxUses: row.maxUses, xp: row.xp, priceMult: 0.05, item: item   // create()'s own 0.05F (D-669)
    };
  }

  /**
   * `SellPotionHoldingItemFactory.create` (TradeOffers.java:964): a uniform pick over the real
   * brewable-potion roster (jar-verified above), `PotionUtil.setPotion`'s own `Potion` NBT key.
   */
  function rollPotionHoldingItem(row, e, rng) {
    var name = pick(BREWABLE_POTIONS, rng);
    return {
      kind: row.kind, priceEmerald: row.priceEmerald, maxUses: row.maxUses, xp: row.xp, priceMult: 0.05,
      secondBuy: row.secondBuy, secondCount: row.secondCount, item: row.sell, itemQty: row.sellCount,
      tag: { Potion: 'minecraft:' + name }
    };
  }

  /**
   * `ChunkGenerator.locateStructure`'s own grid walk (D-183's placement, not a fresh search):
   * find `set` (the `structure_set` whose name contains `keyword` — 'monument'/'mansion' each
   * name exactly one live set, `ocean_monuments.json`/`woodland_mansions.json`), then expand a
   * square ring of REGIONS (Structures.js's own unit — see `randomSpread`) outward from the
   * region containing (x, z), asking `ST.startsOfRegion` (04r_structures.js's own start test,
   * not a copy of it) at each, out past vanilla's 100-chunk radius. First hit wins, same as
   * vanilla's nearest-candidate search.
   */
  Trade.locateStructure = function (keyword, x, z) {
    var ST = NS.Structures;
    if (!ST || !ST.ready || typeof x !== 'number' || typeof z !== 'number') return null;
    var set = null, i;
    for (i = 0; i < ST.sets.length; i++) {
      if (ST.sets[i].name.indexOf(keyword) >= 0 && ST.sets[i].live) { set = ST.sets[i]; break; }
    }
    if (!set || set.placement.kind !== 'random_spread') return null;
    var cx = Math.floor(x) >> 4, cz = Math.floor(z) >> 4;
    var out = [0, 0];
    set.placement.regionOf(cx, cz, out);
    var r0x = out[0], r0z = out[1];
    var maxRadius = Math.max(1, Math.ceil(100 / set.placement.spacing)) + 1;
    for (var radius = 0; radius <= maxRadius; radius++) {
      for (var dz = -radius; dz <= radius; dz++) {
        for (var dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          var starts = ST.startsOfRegion(set.index, r0x + dx, r0z + dz);
          if (starts && starts.length) {
            var st = starts[0];
            return { x: (st.x0 + st.x1) >> 1, z: (st.z0 + st.z1) >> 1 };
          }
        }
      }
    }
    return null;
  };

  /** Resolve a level's own row list into concrete offers — every static row passes through
   *  unchanged; every procedural row is rolled through its factory exactly once, here, which is
   *  `Trade.ensure`/`Trade.increaseLevel`'s only caller of the roll functions. A roll that
   *  returns `null` (SellMapFactory finding no structure) drops that offer, matching vanilla's
   *  own `MerchantOffers.add` skipping a `null` `Factory.create`. */
  var PROCEDURAL_KINDS = {
    enchant_book_for_emeralds: rollEnchantBook,
    sell_enchanted_tool_for_emeralds: rollEnchantedTool,
    sell_dyed_armor_for_emerald: rollDyedArmor,
    sell_map_for_emerald: rollMap,
    sell_potion_holding_item_for_emerald: rollPotionHoldingItem,
    sell_type_variant_item_for_emerald: rollTypeVariantItem
  };
  Trade.resolveOffers = function (rows, e, rng) {
    rng = rng || RNDFB;
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], roll = PROCEDURAL_KINDS[r.kind];
      if (!r || !SUPPORTED[r.kind]) continue;          // a factory this engine cannot build: no offer
      if (!roll) { out.push(r); continue; }
      var resolved = roll(r, e, rng);
      if (resolved) out.push(resolved);
    }
    return out;
  };

  /**
   * Lazily attach this villager's own offer list, xp and level. Re-rolled from scratch if the
   * profession itself changed underneath it (a villager that just claimed a new workstation) —
   * `Prof.tryClaim` is the only writer of `e.profession` (07o_profession.js) and this never
   * writes it back, the same one-way read `Tame`/`Breed` already give it.
   */
  Trade.ensure = function (e) {
    if (e && e.type === 'wandering_trader') return NS.WT && NS.WT.ensureTrades ? NS.WT.ensureTrades(e) : null;
    if (!e || e.type !== 'villager') return null;
    if (e.tradeProfession !== e.profession || !e.tradeOffers) {
      e.villagerLevel = 1;
      e.tradeXp = 0;
      e.tradeCelebrateTicks = 0;
      e.tradePendingLevelUp = false;
      e.tradeRestocksToday = 0;
      e.tradeLastRestock = 0;
      e.tradeLastDayMark = undefined;
      e.tradeOffers = Trade.rollLevel(e.profession, 1, e);
      e.tradeUses = e.tradeOffers.map(function () { return 0; });
      e.tradeDemand = e.tradeOffers.map(function () { return 0; });
      e.tradeSpecial = e.tradeOffers.map(function () { return 0; });
      e.tradeProfession = e.profession;
    }
    return e.tradeOffers;
  };

  Trade.maxUses = function (offer) { return offer.maxUses || 1; };

  /** Both directions matter here (rule 6): an offer under its cap trades, one at the cap refuses. */
  Trade.disabled = function (e, i) {
    if (!e.tradeUses || !e.tradeOffers || !e.tradeOffers[i]) return true;
    return e.tradeUses[i] >= Trade.maxUses(e.tradeOffers[i]);
  };

  function itemId(name) { return (NS.Items && NS.Items.of) ? NS.Items.of(name) : -1; }

  /**
   * Execute offer `i` on villager `e` for player `P` (`P.inventory`, `P.instabuild`).
   * Returns `{ok:true, xp}` or `{ok:false, reason}` and changes NOTHING on a refusal — both
   * directions, asserted by `tradecheck` §3: an affordable offer trades, an unaffordable or
   * exhausted one refuses with the inventory untouched and the use counter unmoved.
   */
  /**
   * The offer's need/give pairs — ONE place, shared by `Trade.attempt` (which spends them) and
   * the GUI (`Trade.previewFor`, which only shows them). D-483: pulled out of `attempt` itself
   * so the trading SCREEN cannot draw a cost `attempt` would not actually charge (D-276's joins
   * rule) — before this unit the two were separate switches that could silently drift apart.
   */
  function needGiveFor(o) {
    var need = [], give = [];
    switch (o.kind) {
      case 'sell_item_for_emerald':
        need.push({ id: itemId(o.item), n: o.itemQty, name: o.item });
        give.push({ id: itemId('emerald'), n: o.priceEmerald || 1 });
        break;
      case 'buy_item_for_emerald':
        need.push({ id: itemId('emerald'), n: o.priceEmerald, name: 'emerald' });
        give.push({ id: itemId(o.item), n: o.itemQty });
        break;
      case 'buy_item_for_emerald_and_item':
        need.push({ id: itemId('emerald'), n: o.priceEmerald, name: 'emerald' });
        need.push({ id: itemId(o.item), n: o.itemQty, name: o.item });
        give.push({ id: itemId(o.item2), n: o.item2Qty });
        break;
      case 'sell_suspicious_stew_for_emerald':
        // D-669: `SuspiciousStewItem.addEffectToStew` (TradeOffers.java:1013) — the SAME
        // Effects/EffectId/EffectDuration tag the crafted and mooshroom stews carry.
        need.push({ id: itemId('emerald'), n: o.priceEmerald || 1, name: 'emerald' });
        give.push({ id: itemId('suspicious_stew'), n: 1,
          tag: o.effectId != null ? { Effects: [{ EffectId: o.effectId, EffectDuration: o.durationTicks }] } : undefined });
        break;
      // fisherman L5's own boat trade -- D-669: `TypeAwareBuyForOneEmeraldFactory.create`
      // (TradeOffers.java:1037) is `new TradeOffer(boat x count, emerald, ..)`: the player PAYS
      // itemQty of the villager's OWN type's boat (resolved onto o.item by rollTypeVariantItem)
      // and GETS one emerald — the same direction as sell_item_for_emerald (it was reversed).
      case 'sell_type_variant_item_for_emerald':
        need.push({ id: itemId(o.item), n: o.itemQty || 1, name: o.item });
        give.push({ id: itemId('emerald'), n: o.priceEmerald || 1 });
        break;
      // ── D-48x remainder: the five procedural kinds resolve to a concrete item/tag on the
      // OFFER OBJECT ITSELF (Trade.resolveOffers, at offer-creation time) — needGiveFor just
      // reads it, same as every static kind above.
      case 'enchant_book_for_emeralds':
        // D-669: `EnchantBookFactory.create` (TradeOffers.java:765) — emeralds AND one plain BOOK
        // (`new TradeOffer(emerald x price, new ItemStack(BOOK), book, ..)`); it charged no book.
        need.push({ id: itemId('emerald'), n: o.priceEmerald, name: 'emerald' });
        need.push({ id: itemId('book'), n: 1, name: 'book' });
        give.push({ id: itemId(o.item), n: 1, tag: o.tag });
        break;
      case 'sell_enchanted_tool_for_emeralds':
      case 'sell_dyed_armor_for_emerald':
        need.push({ id: itemId('emerald'), n: o.priceEmerald, name: 'emerald' });
        give.push({ id: itemId(o.item), n: 1, tag: o.tag });
        break;
      case 'sell_map_for_emerald':
        need.push({ id: itemId('emerald'), n: o.priceEmerald, name: 'emerald' });
        give.push({ id: itemId('filled_map'), n: 1, d: o.mapId, tag: o.tag });
        break;
      case 'sell_potion_holding_item_for_emerald':
        need.push({ id: itemId('emerald'), n: o.priceEmerald, name: 'emerald' });
        need.push({ id: itemId(o.secondBuy), n: o.secondCount, name: o.secondBuy });
        give.push({ id: itemId('tipped_arrow'), n: o.itemQty, tag: o.tag });
        break;
      default:
        return null;
    }
    return { need: need, give: give };
  }

  // ── D-505: PRICE ADJUSTMENT — `TradeOffer.demandBonus`/`specialPrice` (Yarn 1.18.2,
  // .decomp/net/minecraft/village/TradeOffer.java:74-131, VillagerEntity.java:392-471) ─────────
  // Both live per VILLAGER per offer (`e.tradeDemand[i]`, `e.tradeSpecial[i]`), like `tradeUses`,
  // because an offer object here can be a shared static row. Only the FIRST buy stack moves
  // (`getAdjustedFirstBuyItem`), which is `need[0]` for every kind `needGiveFor` builds.
  function priceMultOf(o) { return Math.fround(+(o.priceMult || 0)); }
  /** `TradeOffer.getAdjustedFirstBuyItem().getCount()` for villager `e`'s offer `i`. */
  Trade.adjustedFirstCount = function (e, i) {
    var o = e && e.tradeOffers && e.tradeOffers[i], ng = o && needGiveFor(o);
    if (!ng || !ng.need[0]) return 0;
    var n = ng.need[0].n, demand = (e.tradeDemand && e.tradeDemand[i]) || 0;
    var special = (e.tradeSpecial && e.tradeSpecial[i]) || 0;
    var bonus = Math.max(0, Math.floor(Math.fround(Math.fround(n * demand) * priceMultOf(o))));
    var max = (NS.Items && NS.Items.maxStack && ng.need[0].id >= 0) ? NS.Items.maxStack(ng.need[0].id) : 64;
    return Math.min(Math.max(n + bonus + special, 1), max);
  };
  /** needGiveFor with villager `e`'s own adjusted first-buy count — what `attempt` charges and the
   *  screen shows (one join, D-276). Without `e`, the table's own count. */
  function needGiveAt(o, e, i) {
    var ng = needGiveFor(o);
    if (!ng || !e || !ng.need[0]) return ng;
    ng.need[0] = Object.assign({}, ng.need[0], { n: Trade.adjustedFirstCount(e, i) });
    return ng;
  }
  /** Public `needGiveAt` (src/07zv8_vbhold.js: HoldTradeOffersTask reads each offer's buy/sell stacks). */
  Trade.needGive = function (e, i) { var o = e && e.tradeOffers && e.tradeOffers[i]; return o ? needGiveAt(o, e, i) : null; };
  /** `TradeOffer.updateDemandBonus` over every offer: demand += uses - (maxUses - uses). */
  Trade.updateDemandBonus = function (e) {
    if (!e.tradeOffers) return;
    if (!e.tradeDemand) e.tradeDemand = e.tradeOffers.map(function () { return 0; });
    for (var i = 0; i < e.tradeOffers.length; i++) {
      var u = (e.tradeUses && e.tradeUses[i]) || 0;
      e.tradeDemand[i] = (e.tradeDemand[i] || 0) + u - (Trade.maxUses(e.tradeOffers[i]) - u);
    }
  };
  /** `VillagerEntity.restockAndUpdateDemandBonus` — the daily-count reset's own catch-up. */
  Trade.restockAndUpdateDemandBonus = function (e) {
    var missed = 2 - (e.tradeRestocksToday || 0);
    if (missed > 0 && e.tradeUses) for (var i = 0; i < e.tradeUses.length; i++) e.tradeUses[i] = 0;
    for (var k = 0; k < missed; k++) Trade.updateDemandBonus(e);
  };
  /** `VillagerEntity.prepareOffersFor(player)` — on opening the screen: reputation discount
   *  `-floor(rep * priceMult)` and Hero of the Village `-max(floor((0.3+0.0625*amp)*count),1)`. */
  Trade.prepareOffersFor = function (e, P) {
    if (!e || !e.tradeOffers) return;
    if (!e.tradeSpecial) e.tradeSpecial = e.tradeOffers.map(function () { return 0; });
    var rep = (NS.Village && NS.Village.getReputation) ? NS.Village.getReputation(e, P) : 0, i;
    if (rep !== 0) for (i = 0; i < e.tradeOffers.length; i++)
      e.tradeSpecial[i] += -Math.floor(Math.fround(Math.fround(rep) * priceMultOf(e.tradeOffers[i])));
    var ES = NS.Effects, amp = (ES && ES.amplifierOf) ? ES.amplifierOf(P, 'hero_of_the_village') : -1;
    if (amp >= 0) for (i = 0; i < e.tradeOffers.length; i++) {
      var ng = needGiveFor(e.tradeOffers[i]);
      var cnt = ng && ng.need[0] ? ng.need[0].n : 0;
      e.tradeSpecial[i] += -Math.max(Math.floor((0.3 + 0.0625 * amp) * cnt), 1);
    }
  };
  /** `VillagerEntity.resetCustomer` → `clearSpecialPrices` — on closing the screen. */
  Trade.clearSpecialPrices = function (e) {
    if (e && e.tradeSpecial) for (var i = 0; i < e.tradeSpecial.length; i++) e.tradeSpecial[i] = 0;
  };

  /**
   * D-483 — the three GUI slot stacks for offer `o`: `in1`/`in2` (the payment(s), `aqx` slots 0
   * and 1) and `out` (the result, the `aqp` slot). `in2` is null unless the kind needs a second
   * payment (`buy_item_for_emerald_and_item`) — `Hud.drawTrading` skips a null slot, same as an
   * empty vanilla one. Stacks are display-only (`Trade.attempt` still pulls from the whole
   * inventory, not these slots — Trade.OWED's real slot-placement economy remains unbuilt).
   */
  Trade.previewFor = function (o, e, i) {
    var ng = o && needGiveAt(o, e, i);
    if (!ng) return { in1: null, in2: null, out: null };
    var need = ng.need, give = ng.give;
    return {
      in1: need[0] ? { i: need[0].id, n: need[0].n } : null,
      in2: need[1] ? { i: need[1].id, n: need[1].n } : null,
      out: give[0] ? { i: give[0].id, n: give[0].n } : null
    };
  };

  // ── D-8xx  MerchantScreenHandler: two input slots + result, autofill, scrolling list ─────────
  // `menu = {e, P, slots:[in0,in1], sel, scroll}`. Slots 3..38 of the handler are the 36 main
  // inventory slots (0..35 of Inventory); armour/offhand are not autofilled from.
  Trade.MAX_LIST_ROWS = 7;   // MerchantScreen.MAX_TRADE_OFFERS
  Trade.menuOpen = function (e, P) {
    Trade.ensure(e);
    return { e: e, P: P, slots: [null, null], sel: -1, scroll: 0 };
  };
  var sameKind = function (a, id) { return !!(a && a.n > 0 && a.i === id); };
  Trade.menuHeld = function (m, id) {
    var n = 0;
    for (var k = 0; k < 2; k++) if (sameKind(m.slots[k], id)) n += m.slots[k].n;
    return n;
  };
  /** `MerchantInventory.updateOffers` for the selected offer: the two slots satisfy the offer's
   *  adjusted first cost and second cost, in either order (`depleteBuyItems($$3,$$4) || ($$4,$$3)`). */
  Trade.menuMatch = function (m) {
    var o = m.e.tradeOffers && m.e.tradeOffers[m.sel];
    var ng = o && needGiveAt(o, m.e, m.sel);
    if (!ng || !ng.need[0]) return false;
    var a = m.slots[0], b = m.slots[1], n0 = ng.need[0], n1 = ng.need[1];
    var ok = function (x, y) {
      if (!sameKind(x, n0.id) || x.n < n0.n) return false;
      return n1 ? (sameKind(y, n1.id) && y.n >= n1.n) : true;
    };
    return ok(a, b) || ok(b, a);
  };
  Trade.menuDeplete = function (m, need) {
    var a = m.slots[0], b = m.slots[1];
    var orderA = sameKind(a, need[0].id) && a.n >= need[0].n &&
      (!need[1] || (sameKind(b, need[1].id) && b.n >= need[1].n));
    var s0 = orderA ? 0 : 1, s1 = 1 - s0;
    var take = function (k, n) {
      var st = m.slots[k]; st.n -= n; if (st.n <= 0) m.slots[k] = null;
    };
    take(s0, need[0].n);
    if (need[1]) take(s1, need[1].n);
  };
  /** Both input slots back into the inventory (`switchTo`'s insertItem / `close`'s offerOrDrop).
   *  Returns false and leaves the leftover in the slot if the inventory cannot hold it. */
  Trade.menuClose = function (m) {
    var Iv = NS.Inventory, ok = true;
    for (var k = 0; k < 2; k++) {
      var s = m.slots[k];
      if (!s) continue;
      if (Iv.add(m.P.inventory, s) > 0) ok = false; else m.slots[k] = null;
    }
    return ok;
  };
  /** `MerchantScreenHandler.autofill`: pull matching stacks out of inventory 0..35 into slot `k`. */
  function autofill(m, k, need) {
    if (!need || need.id < 0) return;
    var Iv = NS.Inventory, inv = m.P.inventory, maxc = NS.Items.maxStack(need.id);
    for (var i = 0; i < 36; i++) {
      var st = Iv.getItem(inv, i);
      if (Iv.isEmpty(st) || st.i !== need.id) continue;
      var cur = m.slots[k], have = cur ? cur.n : 0;
      var mv = Math.min(maxc - have, st.n);
      if (mv <= 0) break;
      m.slots[k] = { i: st.i, n: have + mv, d: st.d, t: st.t };
      var rem = st.n - mv;
      Iv.setItem(inv, i, rem > 0 ? { i: st.i, n: rem, d: st.d, t: st.t } : null);
      if (have + mv >= maxc) break;
    }
  }
  /** `MerchantScreenHandler.switchTo` — click an offer: empty the slots back to the inventory
   *  (abort if it cannot), then autofill both payments from the inventory. */
  /** `MerchantEntity.onSellingItem` + trade()'s reset: yes/no by result slot, vanilla volume/pitch, gated on ambientSoundChance > -minDelay+20. */
  Trade.sellSound = function (e, filled) {
    var MV = NS.MobVoice, md = MV && MV.delay ? MV.delay(e) : 80;
    if ((e.ambientSoundChance | 0) > -md + 20 && !e.silent) {
      if (MV && MV.emit) MV.emit(e, 'entity.' + e.type + (filled ? '.yes' : '.no'));
      else if (NS.Sound && NS.Sound.mobSound) NS.Sound.mobSound(e, 'entity.' + e.type + (filled ? '.yes' : '.no'), 1, 1);
    }
    e.ambientSoundChance = -md;
  };
  Trade.menuSelect = function (m, i, quiet) {
    var offers = m.e.tradeOffers;
    if (!offers || i < 0 || i >= offers.length) return false;
    m.sel = i;
    if (!Trade.menuClose(m)) return false;
    var ng = needGiveAt(offers[i], m.e, i);
    if (ng) { autofill(m, 0, ng.need[0]); autofill(m, 1, ng.need[1]); }
    if (!quiet) Trade.sellSound(m.e, Trade.menuMatch(m));
    return true;
  };
  /** `MerchantScreen.mouseScrolled`: `indexStartOffset` clamped to [0, n-7], only past 7 offers. */
  Trade.menuCanScroll = function (n) { return n > Trade.MAX_LIST_ROWS; };
  Trade.menuScroll = function (m, dy) {
    var n = m.e.tradeOffers.length;
    if (Trade.menuCanScroll(n)) m.scroll = Math.max(0, Math.min(n - Trade.MAX_LIST_ROWS, Math.trunc(m.scroll - dy)));
    return m.scroll;
  };
  /** Scrollbar thumb Y (`renderScrollbar`) and the drag mapping (`mouseDragged`). */
  Trade.scrollThumbY = function (n, off) {
    var k = n + 1 - 7;
    if (k <= 1) return 0;
    var sp = 139 - (27 + Math.trunc((k - 1) * 139 / k));
    var step = 1 + Math.trunc(sp / k) + Math.trunc(139 / k);
    return off === k - 1 ? 113 : Math.min(113, off * step);
  };
  Trade.scrollFromDrag = function (n, relY) {   // relY = mouseY - (panelY + 18)
    var cap = n - 7;
    var f = (relY - 13.5) / (139 - 27) * cap + 0.5;
    return Math.max(0, Math.min(cap, Math.trunc(f)));
  };
  /** The visible offer indices (the 7-row window). */
  Trade.menuVisible = function (m) {
    var n = m.e.tradeOffers.length, out = [];
    var st = Trade.menuCanScroll(n) ? m.scroll : 0;
    for (var i = st; i < n && out.length < 7; i++) out.push(i);
    return out;
  };

  Trade.attempt = function (e, i, P, menu) {
    var offers = Trade.ensure(e);
    if (!offers || !offers[i]) return { ok: false, reason: 'no such offer' };
    if (Trade.disabled(e, i)) return { ok: false, reason: 'sold out' };
    if (!P || !P.inventory) return { ok: false, reason: 'no inventory' };
    var o = offers[i], inv = P.inventory, Iv = NS.Inventory;
    var ng = needGiveAt(o, e, i);
    if (!ng) return { ok: false, reason: 'unsupported kind ' + o.kind };
    var need = ng.need, give = ng.give;
    var k, own = false;
    // MerchantScreenHandler: payment lives in the two INPUT slots (TradeOutputSlot.onTakeItem ->
    // depleteBuyItems). A caller without a screen gets the same path through a transient menu
    // autofilled from the inventory (creative without a screen keeps the old free trade).
    if (!menu && !P.instabuild) { menu = Trade.menuOpen(e, P); own = true; Trade.menuSelect(menu, i, true); }
    if (menu) {
      menu.sel = i;
      if (!Trade.menuMatch(menu)) {
        var why = 'not enough ' + need[0].name;
        for (k = 0; k < need.length; k++) {
          if (need[k].id < 0 || Iv.countOf(inv, need[k].id) + Trade.menuHeld(menu, need[k].id) < need[k].n) { why = 'not enough ' + need[k].name; break; }
        }
        if (own) Trade.menuClose(menu);
        return { ok: false, reason: why };
      }
      Trade.menuDeplete(menu, need);
      if (own) Trade.menuClose(menu);
    }
    for (k = 0; k < give.length; k++) {
      if (give[k].id < 0) continue;
      Iv.add(inv, { i: give[k].id, n: give[k].n, d: give[k].d || 0, t: give[k].tag });
    }
    e.tradeUses[i]++;
    // MerchantEntity.onSellingItem (yes sound, only if ambientSoundChance > -minDelay+20) then trade(): ambientSoundChance = -minDelay
    Trade.sellSound(e, true);
    if (e.type === 'wandering_trader') {
      // WanderingTraderEntity.isLeveledMerchant() == false: no tradeXp/level-up/gossip, only afterUsing's orb
      if (NS.Xp && NS.Xp.ready && o.rewardXp !== false) NS.Xp.spawn(e.x, e.y + 0.5, e.z, 3 + Math.floor(RNDFB() * 4));
      return { ok: true, xp: o.xp || 0 };
    }
    // D-484 — `bnw.b(bzt)`: xp is added unconditionally; the celebration timer/pending flag are
    // only armed if this trade JUST crossed the villager's own next-level threshold.
    var xp = o.xp || 0;
    if (xp) e.tradeXp = (e.tradeXp || 0) + xp;
    var leveledUp = Trade.canLevelUp(e);
    if (leveledUp) {
      e.tradeCelebrateTicks = CELEBRATE_TICKS;
      e.tradePendingLevelUp = true;
    }
    // G21 — `VillagerEntity.afterUsing` (.decomp:582-595): a PLAYER-FACING xp orb, separate
    // from the villager's own `tradeXp`/level table just above — `3 + random.nextInt(4)`, +5 the
    // trade this same tick crosses a level, gated on `TradeOffer.shouldRewardPlayerExperience()`
    // (TradeOffer.java:154, defaults true and no offer in Trade.OFFERS below ever sets it false
    // via NBT, the only path that can). Spawned at the villager's own position, half a block up.
    if (NS.Xp && NS.Xp.ready) {
      var reward = 3 + (Math.floor(RNDFB() * 4));
      if (leveledUp) reward += 5;
      NS.Xp.spawn(e.x, e.y + 0.5, e.z, reward);
    }
    // ROW 0.2 REMAINDER — `VillagerEntity.onInteractionWith(EntityInteraction.TRADE, ...)`'s
    // own call site (`this.lastCustomer`), javap'd: trading(2) gossip for the trading villager.
    if (NS.Village && NS.Village.onTrade) NS.Village.onTrade(e, P);
    e.tradeLastCustomer = true;      // `this.lastCustomer = this.getCustomer()` (VillagerEntity.java:586)
    return { ok: true, xp: xp };
  };

  /** `bnw.gh()` — the level-up itself: bump the level, ADD (never replace) that level's offers. */
  Trade.increaseLevel = function (e) {
    var level = e.villagerLevel || 1;
    if (level >= Trade.MAX_LEVEL) return;
    e.villagerLevel = level + 1;
    var rows = Trade.rollLevel(e.profession, e.villagerLevel, e);
    if (!rows.length || !e.tradeOffers) return;
    for (var i = 0; i < rows.length; i++) {
      e.tradeOffers.push(rows[i]);
      e.tradeUses.push(0);
      if (e.tradeDemand) e.tradeDemand.push(0);
      if (e.tradeSpecial) e.tradeSpecial.push(0);
    }
  };

  /** `bnw.fZ()` — true while any offer has been used at least once (restocking has work to do). */
  Trade.needsRestock = function (e) {
    if (!e.tradeUses) return false;
    for (var i = 0; i < e.tradeUses.length; i++) if (e.tradeUses[i] > 0) return true;
    return false;
  };

  /** `bnw.fO()` — resets every offer's own use counter; `bnw.ga()`'s daily budget is spent. */
  Trade.restock = function (e) {
    if (!e.tradeUses) return;
    Trade.updateDemandBonus(e);                 // VillagerEntity.restock: demand BEFORE resetUses
    for (var i = 0; i < e.tradeUses.length; i++) e.tradeUses[i] = 0;
    e.tradeLastRestock = NS.Behave ? NS.Behave.gameTime : 0;   // world.getTime(), not timeOfDay
    e.tradeRestocksToday = (e.tradeRestocksToday || 0) + 1;
  };

  /**
   * `bnw.fP()`+`ga()`+`fO()`, one call per villager tick. The daily window (up to
   * `RESTOCK_MAX_PER_DAY`, `RESTOCK_MIN_GAP_TICKS` apart) resets at a half-day-since-last-restock
   * or a day-index change, then restocks if the budget allows AND an offer actually needs it.
   */
  Trade.shouldRestock = function (e) {
    // D-505: transcribed line for line off VillagerEntity.shouldRestock/canRestock (.decomp
    // VillagerEntity.java:413-435) — strict `>` on both the 12000 half-day and the 2400 gap, the
    // day-index test only once a previous check exists (`lastRestockCheckTime > 0`), and the
    // window reset runs `clearDailyRestockCount` (restockAndUpdateDemandBonus) before zeroing.
    if (!e.tradeOffers) return;
    var dayTime = (NS.Sky && typeof NS.Sky.dayTime === 'number') ? NS.Sky.dayTime : 0;
    // game time (world.getTime()) for lastRestock/+12000/+2400; only the day index + lastDayMark use timeOfDay
    var gameTime = NS.Behave ? NS.Behave.gameTime : 0;
    var last = e.tradeLastRestock || 0;
    var due = gameTime > last + RESTOCK_HALF_DAY_TICKS;
    if ((e.tradeLastDayMark || 0) > 0)
      due = due || Math.floor(dayTime / TICKS_PER_DAY) > Math.floor(e.tradeLastDayMark / TICKS_PER_DAY);
    e.tradeLastDayMark = dayTime;
    if (due) {
      e.tradeLastRestock = gameTime;
      Trade.restockAndUpdateDemandBonus(e);
      e.tradeRestocksToday = 0;
    }
    var restocksToday = e.tradeRestocksToday || 0;
    var allowed = restocksToday === 0 ||
      (restocksToday < RESTOCK_MAX_PER_DAY && gameTime > (e.tradeLastRestock || 0) + RESTOCK_MIN_GAP_TICKS);
    return !!(allowed && Trade.needsRestock(e));
  };

  /** `VillagerWorkTask.run`'s own tail (.decomp VillagerWorkTask.java:41-43):
   *  `if (villager.shouldRestock()) villager.restock();` -- the ONLY caller of shouldRestock/restock
   *  in 1.18.2 (grep of .decomp, s113). So a villager restocks only on a work-task run, i.e. while
   *  standing within 1.73 blocks of its claimed job site during the WORK activity
   *  (07zv_villagerbrain.js villagerWorkRun) -- no longer on every mob tick (was D-484's shortcut). */
  Trade.tickRestock = function (e) {
    if (!e.tradeOffers) return false;
    if (Trade.shouldRestock(e)) { Trade.restock(e); return true; }
    return false;
  };

  /** `StatusEffectInstance(REGENERATION, 200, 0)` at the end of the celebration (VillagerEntity.java:284). */
  Trade.CELEBRATE_REGEN_TICKS = 200;
  /** `MerchantEntity.produceParticles` (.decomp MerchantEntity.java:198-205): FIVE particles, each at
   *  its own `getParticleX(1.0)`/`getRandomBodyY() + 1.0`/`getParticleZ(1.0)`, velocity
   *  nextGaussian()*0.02 per axis. Returns how many were spawned. */
  Trade.PRODUCE_PARTICLE_COUNT = 5;
  Trade.produceParticles = function (e, type, rand) {
    var Px = NS.Particle;
    if (!Px || !Px.spawn) return 0;
    var r = rand || RNDFB, w = e.width || 0, h = e.height || 0, n = 0;
    var g = function () { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    for (var i = 0; i < Trade.PRODUCE_PARTICLE_COUNT; i++) {
      var vx = g() * 0.02, vy = g() * 0.02, vz = g() * 0.02;
      if (Px.spawn(type, e.x + w * (2 * r() - 1), e.y + h * r() + 1.0, e.z + w * (2 * r() - 1), vx, vy, vz, r)) n++;
    }
    return n;
  };

  /** One mob-tick's worth of villager-only bookkeeping — called from `EL.tickMob` (D-484). */
  Trade.tick = function (e) {
    if (!e || e.type !== 'villager') return;
    if (e.tradeCelebrateTicks > 0) {
      e.tradeCelebrateTicks--;
      if (e.tradeCelebrateTicks === 0) {
        if (e.tradePendingLevelUp) {
          Trade.increaseLevel(e);
          e.tradePendingLevelUp = false;
        }
        // s108 — VillagerEntity.mobTick (.decomp VillagerEntity.java:284): when the celebration
        // timer runs out, `addStatusEffect(new StatusEffectInstance(REGENERATION (field_5924), 200, 0))`
        // — OUTSIDE the levelingUp branch, so it fires whenever the timer expires.
        if (NS.Effects && NS.Effects.addStatusEffect) NS.Effects.addStatusEffect(e, 'regeneration', Trade.CELEBRATE_REGEN_TICKS, 0);
      }
    }
    // s108 — VillagerEntity.mobTick (:288-291): a trade last tick left `lastCustomer` set, so this
    // tick sends entity status 14 -> handleStatus(14) -> produceParticles(HAPPY_VILLAGER
    // (field_11211)) (:737-738), then clears it. The trade -> particle JOIN (rule 7).
    if (e.tradeLastCustomer) {
      e.tradeLastCustomer = false;
      Trade.produceParticles(e, 'happy_villager');
    }
    // s113: restocking left this per-tick path -- it runs from VillagerWorkTask only (Trade.tickRestock
    // is called by 07zv_villagerbrain.js villagerWorkRun), the job-site gate vanilla has.
  };
})(MCL);
