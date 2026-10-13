// 07ox_enchhelper.js — PLAN G18f follow-up (D-48x's own Trade.OWED "SellEnchantedToolFactory"
// line): `EnchantmentHelper.enchant`/`generateEnchantments`/`getPossibleEntries`
// (.decomp/net/minecraft/enchantment/EnchantmentHelper.java:280-386), the FULL enchanting-table
// algorithm villager `SellEnchantedToolFactory.create` calls directly
// (.decomp/net/minecraft/village/TradeOffers.java:874-881: `EnchantmentHelper.enchant(random,
// new ItemStack(tool), 5+nextInt(15), false)`), ported here as ONE deterministic function of an
// injected `rng()` (matching this codebase's own nextInt-via-`Math.floor(rng()*n)` convention —
// see 07p_trade.js's `rollEnchantBook`/`rollDyedArmor` — never a bit-exact `java.util.Random`).
//
// BEFORE 07p_trade.js (sorts as 07o... < 07p, same load slot as the enchant table it feeds).
// Owns ONLY this algorithm; 07p_trade.js's own `ENCH` roster (maxLevel/weight/treasure/target,
// used by `rollEnchantBook`'s uniform book pick) is untouched and NOT read from here — this
// file carries its own copy of the same jar-verified roster (same citations) because the power
// windows below are a property of THIS unit, not that one.
//
// NOT ported (named, not guessed): `EnchantedBookItem` tag stacking across the multi-enchant
// result onto a *book* — moot here, `enchant()` is only ever called on a real tool/armor/weapon
// stack by this trade, never on `Items.field_8529` (book) per TradeOffers.java:874-881, so the
// `isOf(book)` branch in `EnchantmentHelper.enchant` (line 298-300) is dead code for this
// caller and is not reproduced.

(function (NS) {
  'use strict';

  var EH = NS.EnchHelper = {};

  // -- the enchantment roster -- maxLevel/weight/treasure/target: Enchantment.java + subclasses
  // (.decomp/net/minecraft/enchantment/*.java), same citations as 07p_trade.js's own copy
  // (trade.js:293-300). `rand` is `isAvailableForRandomSelection()` (Enchantment.java:135-137;
  // only SoulSpeedEnchantment.java:31-33 overrides it false).
  var ENCH = EH.ENCH = {
    protection: { maxLevel: 4, weight: 10, treasure: false, target: 'armor', rand: true },
    fire_protection: { maxLevel: 4, weight: 5, treasure: false, target: 'armor', rand: true },
    feather_falling: { maxLevel: 4, weight: 5, treasure: false, target: 'armor_feet', rand: true },
    blast_protection: { maxLevel: 4, weight: 2, treasure: false, target: 'armor', rand: true },
    projectile_protection: { maxLevel: 4, weight: 5, treasure: false, target: 'armor', rand: true },
    respiration: { maxLevel: 3, weight: 2, treasure: false, target: 'armor_head', rand: true },
    aqua_affinity: { maxLevel: 1, weight: 2, treasure: false, target: 'armor_head', rand: true },
    thorns: { maxLevel: 3, weight: 1, treasure: false, target: 'armor_chest', rand: true },
    depth_strider: { maxLevel: 3, weight: 2, treasure: false, target: 'armor_feet', rand: true },
    frost_walker: { maxLevel: 2, weight: 2, treasure: true, target: 'armor_feet', rand: true },
    binding_curse: { maxLevel: 1, weight: 1, treasure: true, target: 'armor', rand: true },
    soul_speed: { maxLevel: 3, weight: 1, treasure: true, target: 'armor_feet', rand: false },
    sharpness: { maxLevel: 5, weight: 10, treasure: false, target: 'weapon', rand: true },
    smite: { maxLevel: 5, weight: 5, treasure: false, target: 'weapon', rand: true },
    bane_of_arthropods: { maxLevel: 5, weight: 5, treasure: false, target: 'weapon', rand: true },
    knockback: { maxLevel: 2, weight: 5, treasure: false, target: 'weapon', rand: true },
    fire_aspect: { maxLevel: 2, weight: 2, treasure: false, target: 'weapon', rand: true },
    looting: { maxLevel: 3, weight: 2, treasure: false, target: 'weapon', rand: true },
    sweeping: { maxLevel: 3, weight: 2, treasure: false, target: 'weapon', rand: true },
    efficiency: { maxLevel: 5, weight: 10, treasure: false, target: 'digger', rand: true },
    silk_touch: { maxLevel: 1, weight: 1, treasure: false, target: 'digger', rand: true },
    unbreaking: { maxLevel: 3, weight: 5, treasure: false, target: 'breakable', rand: true },
    fortune: { maxLevel: 3, weight: 2, treasure: false, target: 'digger', rand: true },
    power: { maxLevel: 5, weight: 10, treasure: false, target: 'bow', rand: true },
    punch: { maxLevel: 2, weight: 2, treasure: false, target: 'bow', rand: true },
    flame: { maxLevel: 1, weight: 2, treasure: false, target: 'bow', rand: true },
    infinity: { maxLevel: 1, weight: 1, treasure: false, target: 'bow', rand: true },
    luck_of_the_sea: { maxLevel: 3, weight: 2, treasure: false, target: 'fishing_rod', rand: true },
    lure: { maxLevel: 3, weight: 2, treasure: false, target: 'fishing_rod', rand: true },
    loyalty: { maxLevel: 3, weight: 5, treasure: false, target: 'trident', rand: true },
    impaling: { maxLevel: 5, weight: 2, treasure: false, target: 'trident', rand: true },
    riptide: { maxLevel: 3, weight: 2, treasure: false, target: 'trident', rand: true },
    channeling: { maxLevel: 1, weight: 1, treasure: false, target: 'trident', rand: true },
    multishot: { maxLevel: 1, weight: 2, treasure: false, target: 'crossbow', rand: true },
    quick_charge: { maxLevel: 3, weight: 5, treasure: false, target: 'crossbow', rand: true },
    piercing: { maxLevel: 4, weight: 10, treasure: false, target: 'crossbow', rand: true },
    mending: { maxLevel: 1, weight: 2, treasure: true, target: 'breakable', rand: true },
    vanishing_curse: { maxLevel: 1, weight: 1, treasure: true, target: 'breakable', rand: true }
  };

  // NOTE: looting/fortune/luck_of_the_sea/lure/efficiency/silk_touch/unbreaking/thorns/knockback/
  // fire_aspect max power is `super.getMinPower(l)+50` (LuckEnchantment.java:17 etc.) where `super`
  // is the abstract base -- `(1+l*10)+50`, NOT the overridden min (Enchantment.java:62-64).
  // -- per-enchantment getMinPower(level)/getMaxPower(level) overrides -- every one of the
  // 30-odd `Enchantment` subclasses in .decomp/net/minecraft/enchantment/*.java overrides both
  // (the abstract base's own `1+level*10`/`min+5`, Enchantment.java:62-68, is therefore dead for
  // every id below, kept only as MIN/MAX's own fallback for a roster id with no entry here).
  var MIN = EH.MIN_POWER = {
    // ProtectionEnchantment.java:17-18 + Type(basePower,powerPerLevel) enum (line 78-82):
    // protection(1,11) fire_protection(10,8) feather_falling(5,6) blast_protection(5,8)
    // projectile_protection(3,6)
    protection: function (l) { return 1 + (l - 1) * 11; },
    fire_protection: function (l) { return 10 + (l - 1) * 8; },
    feather_falling: function (l) { return 5 + (l - 1) * 6; },
    blast_protection: function (l) { return 5 + (l - 1) * 8; },
    projectile_protection: function (l) { return 3 + (l - 1) * 6; },
    respiration: function (l) { return 10 * l; },                       // RespirationEnchantment.java:11-12
    aqua_affinity: function () { return 1; },                           // AquaAffinityEnchantment.java:11-12
    thorns: function (l) { return 10 + 20 * (l - 1); },                 // ThornsEnchantment.java:20-21
    depth_strider: function (l) { return l * 10; },                     // DepthStriderEnchantment.java:11-12
    frost_walker: function (l) { return l * 10; },                      // FrostWalkerEnchantment.java:20-21
    binding_curse: function () { return 25; },                         // BindingCurseEnchantment.java:11-12
    soul_speed: function (l) { return l * 10; },                        // SoulSpeedEnchantment.java:11-12
    // DamageEnchantment.java:17-18,28-29: BASE_POWERS[1,5,5] POWERS_PER_LEVEL[11,8,8]
    sharpness: function (l) { return 1 + (l - 1) * 11; },
    smite: function (l) { return 5 + (l - 1) * 8; },
    bane_of_arthropods: function (l) { return 5 + (l - 1) * 8; },
    knockback: function (l) { return 5 + 20 * (l - 1); },               // KnockbackEnchantment.java:11-12
    fire_aspect: function (l) { return 10 + 20 * (l - 1); },            // FireAspectEnchantment.java:11-12
    // LuckEnchantment.java:11-12 (backs looting/fortune/luck_of_the_sea, three registered
    // instances of the same class -- Enchantments.java field_9110/field_9130/field_9114)
    looting: function (l) { return 15 + (l - 1) * 9; },
    fortune: function (l) { return 15 + (l - 1) * 9; },
    luck_of_the_sea: function (l) { return 15 + (l - 1) * 9; },
    sweeping: function (l) { return 5 + (l - 1) * 9; },                 // SweepingEnchantment.java:11-12
    efficiency: function (l) { return 1 + 10 * (l - 1); },              // EfficiencyEnchantment.java:13-14
    silk_touch: function () { return 15; },                            // SilkTouchEnchantment.java:11-12
    unbreaking: function (l) { return 5 + (l - 1) * 8; },               // UnbreakingEnchantment.java:14-15
    power: function (l) { return 1 + (l - 1) * 10; },                   // PowerEnchantment.java:11-12
    punch: function (l) { return 12 + (l - 1) * 20; },                  // PunchEnchantment.java:11-12
    flame: function () { return 20; },                                 // FlameEnchantment.java:11-12
    infinity: function () { return 20; },                              // InfinityEnchantment.java:11-12
    lure: function (l) { return 15 + (l - 1) * 9; },                    // LureEnchantment.java:11-12
    loyalty: function (l) { return 5 + l * 7; },                        // LoyaltyEnchantment.java:11-12
    impaling: function (l) { return 1 + (l - 1) * 8; },                 // ImpalingEnchantment.java:12-13
    riptide: function (l) { return 10 + l * 7; },                       // RiptideEnchantment.java:11-12
    channeling: function () { return 25; },                            // ChannelingEnchantment.java:11-12
    multishot: function () { return 20; },                             // MultishotEnchantment.java:11-12
    quick_charge: function (l) { return 12 + (l - 1) * 20; },           // QuickChargeEnchantment.java:11-12
    piercing: function (l) { return 1 + (l - 1) * 10; },                // PiercingEnchantment.java:11-12
    mending: function (l) { return l * 25; },                           // MendingEnchantment.java:11-12
    vanishing_curse: function () { return 25; }                        // VanishingCurseEnchantment.java:11-12
  };
  var MAX = EH.MAX_POWER = {
    protection: function (l) { return MIN.protection(l) + 11; },
    fire_protection: function (l) { return MIN.fire_protection(l) + 8; },
    feather_falling: function (l) { return MIN.feather_falling(l) + 6; },
    blast_protection: function (l) { return MIN.blast_protection(l) + 8; },
    projectile_protection: function (l) { return MIN.projectile_protection(l) + 6; },
    respiration: function (l) { return MIN.respiration(l) + 30; },     // RespirationEnchantment.java:16-17
    aqua_affinity: function (l) { return MIN.aqua_affinity(l) + 40; }, // AquaAffinityEnchantment.java:16-17
    thorns: function (l) { return (1 + l * 10) + 50; },               // ThornsEnchantment.java:25-26
    depth_strider: function (l) { return MIN.depth_strider(l) + 15; },// DepthStriderEnchantment.java:16-17
    frost_walker: function (l) { return MIN.frost_walker(l) + 15; },  // FrostWalkerEnchantment.java:25-26
    binding_curse: function () { return 50; },                       // BindingCurseEnchantment.java:16-17
    soul_speed: function (l) { return MIN.soul_speed(l) + 15; },       // SoulSpeedEnchantment.java:16-17
    sharpness: function (l) { return MIN.sharpness(l) + 20; },         // DamageEnchantment.java:19,33-34
    smite: function (l) { return MIN.smite(l) + 20; },
    bane_of_arthropods: function (l) { return MIN.bane_of_arthropods(l) + 20; },
    knockback: function (l) { return (1 + l * 10) + 50; },         // KnockbackEnchantment.java:16-17
    fire_aspect: function (l) { return (1 + l * 10) + 50; },     // FireAspectEnchantment.java:16-17
    looting: function (l) { return (1 + l * 10) + 50; },             // LuckEnchantment.java:16-17
    fortune: function (l) { return (1 + l * 10) + 50; },
    luck_of_the_sea: function (l) { return (1 + l * 10) + 50; },
    sweeping: function (l) { return MIN.sweeping(l) + 15; },           // SweepingEnchantment.java:16-17
    efficiency: function (l) { return (1 + l * 10) + 50; },       // EfficiencyEnchantment.java:18-19
    silk_touch: function (l) { return (1 + l * 10) + 50; },       // SilkTouchEnchantment.java:16-17
    unbreaking: function (l) { return (1 + l * 10) + 50; },       // UnbreakingEnchantment.java:19-20
    power: function (l) { return MIN.power(l) + 15; },                 // PowerEnchantment.java:16-17
    punch: function (l) { return MIN.punch(l) + 25; },                 // PunchEnchantment.java:16-17
    flame: function () { return 50; },                                // FlameEnchantment.java:16-17
    infinity: function () { return 50; },                             // InfinityEnchantment.java:16-17
    lure: function (l) { return (1 + l * 10) + 50; },                   // LureEnchantment.java:16-17
    loyalty: function () { return 50; },                              // LoyaltyEnchantment.java:16-17
    impaling: function (l) { return MIN.impaling(l) + 20; },           // ImpalingEnchantment.java:17-18
    riptide: function () { return 50; },                              // RiptideEnchantment.java:16-17
    channeling: function () { return 50; },                           // ChannelingEnchantment.java:16-17
    multishot: function () { return 50; },                            // MultishotEnchantment.java:16-17
    quick_charge: function () { return 50; },                         // QuickChargeEnchantment.java:16-17
    piercing: function () { return 50; },                             // PiercingEnchantment.java:16-17
    mending: function (l) { return MIN.mending(l) + 50; },             // MendingEnchantment.java:16-17
    vanishing_curse: function () { return 50; }                       // VanishingCurseEnchantment.java:16-17
  };
  EH.getMinPower = function (id, l) { return MIN[id] ? MIN[id](l) : 1 + l * 10; };
  EH.getMaxPower = function (id, l) { return MAX[id] ? MAX[id](l) : EH.getMinPower(id, l) + 5; };

  // -- `Enchantment.canCombine`/`canAccept` overrides (.decomp .../enchantment/*.java, each
  // `canAccept` cited on its `return`). The base's own `this != $$0` (Enchantment.java:82-84) is
  // exactly `a !== b`, handled once for every id below since (unlike vanilla's per-instance
  // objects) two DIFFERENT registered enchantments never share an id here, and the
  // Protection/Damage/Luck classes' own "same type/class" self-exclusion collapses to the same
  // `a === b` check because each class's per-type instances are 1:1 with the ids below.
  function canAccept(a, b) {
    switch (a) {
      // DamageEnchantment.java:54-56: `!(other instanceof DamageEnchantment)`
      case 'sharpness': case 'smite': case 'bane_of_arthropods':
        return !(b === 'sharpness' || b === 'smite' || b === 'bane_of_arthropods');
      // ProtectionEnchantment.java:48-57: same type -> false; else true only if either side is
      // feather_falling (Type.field_9140)
      case 'protection': case 'fire_protection': case 'blast_protection': case 'projectile_protection': {
        var otherIsProt = (b === 'protection' || b === 'fire_protection' || b === 'feather_falling' ||
          b === 'blast_protection' || b === 'projectile_protection');
        return !otherIsProt || b === 'feather_falling';
      }
      case 'feather_falling':
        return true;
      // DepthStriderEnchantment.java:26-27 / FrostWalkerEnchantment.java:65-66
      case 'depth_strider': return b !== 'frost_walker';
      case 'frost_walker': return b !== 'depth_strider';
      // InfinityEnchantment.java:26-27 (mending has no override -> default true, AND still fails)
      case 'infinity': return b !== 'mending';
      // LuckEnchantment.java:26-27 (backs looting/fortune/luck_of_the_sea) / SilkTouchEnchantment.java:26-27
      case 'looting': case 'fortune': case 'luck_of_the_sea': return b !== 'silk_touch';
      case 'silk_touch': return b !== 'fortune';
      // MultishotEnchantment.java:26-27 / PiercingEnchantment.java:26-27
      case 'multishot': return b !== 'piercing';
      case 'piercing': return b !== 'multishot';
      // RiptideEnchantment.java:26-27
      case 'riptide': return b !== 'loyalty' && b !== 'channeling';
      default: return true; // Enchantment.java:82-84 default (self already excluded by a===b below)
    }
  }
  EH.canCombine = function (a, b) {
    return a !== b && canAccept(a, b) && canAccept(b, a);
  };

  // -- vanilla's own metadata per id, beside the roster above (whose `target` is the trade table's
  // own coarser key): `type` = the EnchantmentTarget (Enchantment.java:22 `type`, each subclass's
  // super(...) call), `curse` = isCursed (Binding/VanishingCurse), `book` =
  // isAvailableForEnchantedBookOffer (SoulSpeedEnchantment.java:26 only false), `rarity` weight is
  // ENCH.weight (Enchantments.java Rarity 10/5/2/1).
  var TYPE = EH.TYPE = {
    protection: 'armor', fire_protection: 'armor', blast_protection: 'armor', projectile_protection: 'armor',
    feather_falling: 'armor_feet', respiration: 'armor_head', aqua_affinity: 'armor_head', thorns: 'armor_chest',
    depth_strider: 'armor_feet', frost_walker: 'armor_feet', soul_speed: 'armor_feet', binding_curse: 'wearable',
    sharpness: 'weapon', smite: 'weapon', bane_of_arthropods: 'weapon', knockback: 'weapon', fire_aspect: 'weapon',
    looting: 'weapon', sweeping: 'weapon', efficiency: 'digger', silk_touch: 'digger', fortune: 'digger',
    unbreaking: 'breakable', mending: 'breakable', vanishing_curse: 'vanishable',
    power: 'bow', punch: 'bow', flame: 'bow', infinity: 'bow',
    luck_of_the_sea: 'fishing_rod', lure: 'fishing_rod',
    loyalty: 'trident', impaling: 'trident', riptide: 'trident', channeling: 'trident',
    multishot: 'crossbow', quick_charge: 'crossbow', piercing: 'crossbow'
  };
  EH.isCurse = function (id) { return id === 'binding_curse' || id === 'vanishing_curse'; };
  EH.isBookOffer = function (id) { return !!ENCH[id] && id !== 'soul_speed'; };
  EH.ids = function () { return Object.keys(ENCH); };
  /** Every id `id` cannot coexist with (Enchantment.canCombine false), self excluded. */
  EH.incompatible = function (id) {
    var out = [], k;
    for (k in ENCH) if (k !== id && !EH.canCombine(id, k)) out.push(k);
    return out;
  };

  // -- per-item applicability: EnchantmentTarget.isAcceptableItem (EnchantmentTarget.java) by item
  // NAME, plus the four `Enchantment.isAcceptableItem` overrides (Damage: axe; Efficiency: shears;
  // Thorns: any armor; Unbreaking: any damageable).
  function isArmor(n) { return /_(helmet|chestplate|leggings|boots)$/.test(n); }
  function isWearable(n) { return isArmor(n) || n === 'elytra' || n === 'carved_pumpkin' || /(_skull|_head)$/.test(n); }
  function isDamageable(n) { var IT = NS.Items; return !!(IT && IT.ready && IT.index[n] !== undefined && IT.durability[IT.index[n]] > 0); }
  var TARGET_OK = {
    armor: isArmor,
    armor_feet: function (n) { return /_boots$/.test(n); },
    armor_legs: function (n) { return /_leggings$/.test(n); },
    armor_chest: function (n) { return /_chestplate$/.test(n); },
    armor_head: function (n) { return /_helmet$/.test(n); },
    weapon: function (n) { return /_sword$/.test(n); },
    digger: function (n) { return /_(pickaxe|axe|shovel|hoe)$/.test(n); },
    fishing_rod: function (n) { return n === 'fishing_rod'; },
    trident: function (n) { return n === 'trident'; },
    breakable: isDamageable,
    bow: function (n) { return n === 'bow'; },
    wearable: isWearable,
    crossbow: function (n) { return n === 'crossbow'; },
    // Vanishable: Bow/MiningTool/Sword/FishingRod/Crossbow/Trident/Compass/Wearable + damageable
    vanishable: function (n) {
      return isWearable(n) || n === 'compass' || /_(sword|pickaxe|axe|shovel|hoe)$/.test(n) ||
        n === 'bow' || n === 'crossbow' || n === 'trident' || n === 'fishing_rod' || isDamageable(n);
    }
  };
  EH.targetAccepts = function (type, itemName) { return !!TARGET_OK[type] && TARGET_OK[type](itemName); };
  /** `Enchantment.isAcceptableItem(stack)` for the item named `itemName`. */
  EH.isAcceptableItem = function (id, itemName) {
    if (!ENCH[id]) return false;
    if (id === 'sharpness' || id === 'smite' || id === 'bane_of_arthropods') { if (/_axe$/.test(itemName)) return true; }
    else if (id === 'efficiency') { if (itemName === 'shears') return true; }
    else if (id === 'thorns') { if (isArmor(itemName)) return true; }
    else if (id === 'unbreaking') { if (isDamageable(itemName)) return true; }
    return EH.targetAccepts(TYPE[id], itemName);
  };

  // -- the stack Enchantments substrate (EnchantmentHelper.get/set, EnchantedBookItem): a book
  // keeps `StoredEnchantments`, everything else `Enchantments`; entries are {id:'minecraft:x', lvl}.
  function listKey(stack) {
    var IT = NS.Items;
    return (IT && IT.ready && stack && IT.nameOf(stack.i) === 'enchanted_book') ? 'StoredEnchantments' : 'Enchantments';
  }
  function bare(id) { return String(id).replace(/^minecraft:/, ''); }
  /** `EnchantmentHelper.get(stack)`: {id(bare): level} (later duplicate entries win, as the map put does). */
  EH.get = function (stack) {
    var L = stack && stack.t && stack.t[listKey(stack)], out = {}, i;
    if (L) for (i = 0; i < L.length; i++) if (L[i] && L[i].id) out[bare(L[i].id)] = L[i].lvl | 0;
    return out;
  };
  /** `EnchantmentHelper.set(map, stack)`: lvl<=0 entries are dropped; an empty list removes the tag. */
  EH.set = function (stack, map) {
    if (!stack) return stack;
    var key = listKey(stack), out = [], k;
    for (k in map) if (map[k] > 0) out.push({ id: 'minecraft:' + k, lvl: map[k] | 0 });
    if (out.length) { if (!stack.t) stack.t = {}; stack.t[key] = out; }
    else if (stack.t) { delete stack.t[key]; }
    return stack;
  };
  /** `ItemStack.addEnchantment` / `EnchantedBookItem.addEnchantment`: replaces the same id's level, else appends. */
  EH.addEnchantment = function (stack, id, lvl) {
    if (!stack || !ENCH[bare(id)]) return false;
    var key = listKey(stack), want = 'minecraft:' + bare(id), L, i;
    if (!stack.t) stack.t = {};
    L = stack.t[key] = stack.t[key] || [];
    for (i = 0; i < L.length; i++) if (L[i] && bare(L[i].id) === bare(id)) { L[i] = { id: want, lvl: lvl | 0 }; return true; }
    L.push({ id: want, lvl: lvl | 0 });
    return true;
  };
  /** Remove one enchantment id; returns whether it was there. An emptied list drops the tag. */
  EH.removeEnchantment = function (stack, id) {
    var key = listKey(stack), L = stack && stack.t && stack.t[key], i, hit = false;
    if (!L) return false;
    for (i = L.length - 1; i >= 0; i--) if (L[i] && bare(L[i].id) === bare(id)) { L.splice(i, 1); hit = true; }
    if (!L.length) delete stack.t[key];
    return hit;
  };

  // -- `Item.getEnchantability()` for exactly the items `sell_enchanted_tool_for_emeralds` rows
  // use (07p_trade.js's own `TARGET_OF` keys). FishingRodItem.java:64-66 and
  // RangedWeaponItem.java:31-33 (bow AND crossbow -- CrossbowItem extends RangedWeaponItem with
  // no override) both hard-code 1; tool/armor materials read off ToolMaterials.java:9-14
  // (IRON=14, DIAMOND=10) and ArmorMaterials.java:14,16 (DIAMOND=10).
  var ENCHANTABILITY = EH.ENCHANTABILITY = {
    fishing_rod: 1, bow: 1, crossbow: 1,
    iron_sword: 14, diamond_sword: 10,
    iron_axe: 14, diamond_axe: 10,
    iron_shovel: 14, diamond_shovel: 10,
    iron_pickaxe: 14, diamond_pickaxe: 10,
    diamond_leggings: 10, diamond_boots: 10, diamond_helmet: 10, diamond_chestplate: 10
  };

  /** `EnchantmentHelper.getPossibleEntries` (EnchantmentHelper.java:369-386): every non-treasure
   *  (unless `treasureAllowed`), `isAvailableForRandomSelection`, target-compatible id, at the
   *  HIGHEST level (counting down from `maxLevel`) whose own `[minPower,maxPower]` window
   *  contains `power` -- one candidate per id at most, exactly as vanilla's own `break` does. */
  function getPossibleEntries(power, targets, treasureAllowed) {
    var out = [], ids = Object.keys(ENCH), i, id, e, l;
    for (i = 0; i < ids.length; i++) {
      id = ids[i]; e = ENCH[id];
      if (e.treasure && !treasureAllowed) continue;
      if (!e.rand) continue;
      if (targets.indexOf(e.target) < 0) continue;
      for (l = e.maxLevel; l >= 1; l--) {
        if (power >= EH.getMinPower(id, l) && power <= EH.getMaxPower(id, l)) { out.push({ id: id, level: l }); break; }
      }
    }
    return out;
  }
  EH.getPossibleEntries = getPossibleEntries;

  function weightedPick(pool, rng) {
    var total = 0, i;
    for (i = 0; i < pool.length; i++) total += ENCH[pool[i].id].weight;
    if (total <= 0) return pool[pool.length - 1];
    var draw = rng() * total, at = 0;
    for (i = 0; i < pool.length; i++) {
      at += ENCH[pool[i].id].weight;
      if (draw < at) return pool[i];
    }
    return pool[pool.length - 1];
  }

  /** `EnchantmentHelper.removeConflicts` (EnchantmentHelper.java:349-357): drop every pool entry
   *  that can't combine with the just-picked one. */
  function removeConflicts(pool, picked) {
    var out = [], i;
    for (i = 0; i < pool.length; i++) if (EH.canCombine(picked.id, pool[i].id)) out.push(pool[i]);
    return out;
  }

  /** `EnchantmentHelper.generateEnchantments` (EnchantmentHelper.java:317-346): the enchantability
   *  power bump + jitter, then the weighted multi-enchantment draw ("while nextInt(50) <= power",
   *  halving power and pruning conflicts each iteration) that
   *  `EnchantmentHelper.enchant` (line 299-312) wraps and this factory calls directly
   *  (TradeOffers.java:874-877). Returns `[{id, level}, ...]` (possibly empty -- enchantability 0
   *  or no compatible candidates at the rolled power, both real vanilla outcomes). */
  EH.generateEnchantments = function (rng, itemKey, targets, basePower, treasureAllowed) {
    var ench = ENCHANTABILITY[itemKey] || 0;
    if (ench <= 0) return [];
    var quarter = Math.floor(ench / 4);
    var power = basePower + 1 + Math.floor(rng() * (quarter + 1)) + Math.floor(rng() * (quarter + 1));
    var jitter = (rng() + rng() - 1) * 0.15;
    power = Math.round(power + power * jitter);
    if (power < 1) power = 1;

    var pool = getPossibleEntries(power, targets, !!treasureAllowed);
    var result = [];
    if (!pool.length) return result;
    result.push(weightedPick(pool, rng));

    while (Math.floor(rng() * 50) <= power) {
      pool = removeConflicts(pool, result[result.length - 1]);
      if (!pool.length) break;
      result.push(weightedPick(pool, rng));
      power = Math.floor(power / 2);
    }
    return result;
  };

  /** `EnchantmentHelper.enchant` (EnchantmentHelper.java:299-312) minus the dead enchanted-book
   *  branch (see file header) -- this IS what `SellEnchantedToolFactory.create` calls. */
  EH.enchant = function (rng, itemKey, targets, basePower, treasureAllowed) {
    return EH.generateEnchantments(rng, itemKey, targets, basePower, treasureAllowed);
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
