// 07zzq_brewing.js — G23 (#299): `BrewingRecipeRegistry`, the recipe tree. Translated whole from
// `.decomp/net/minecraft/recipe/BrewingRecipeRegistry.java` (read in full): `registerDefaults`'
// three potion types, two ITEM_RECIPES and 59 POTION_RECIPES in their own order, then
// `isValidIngredient`, `isPotionType` (POTION_TYPE_PREDICATE), `isBrewable`, `hasRecipe`/
// `hasItemRecipe`/`hasPotionRecipe` and `craft`. `brewregcheck` re-derives every row from the
// decompile each run, so a typo here is red.
//
// Items are named by registry path ('sugar', 'splash_potion'), potions by their `Potions.java`
// registry path ('long_swiftness') — the same keys as `Po.POTIONS` (07z_potion.js), which every
// potion here must name. A stack is the engine's `{ i, n, d, t }` (14f_inventory.js); its potion
// is `PotionUtil.getPotion`: the tag's `Potion` string, `empty` when absent or unknown (the
// POTION registry is defaulted to `empty`).
//
// ⚠ ARGUMENT ORDER IS VANILLA'S: `hasRecipe(input, ingredient)` but `craft(ingredient, input)`.
//
// Runs on: MAIN THREAD ONLY. No DOM. The tick that calls `craft` (BrewingStandBlockEntity) is
// not here; `Menu.brewingIsIngredient` (14g_menu.js) is `isValidIngredient`.

(function (NS) {
  'use strict';

  var Br = NS.Brewing = {};

  // ── registerDefaults() ──────────────────────────────────────────────────────────────────
  Br.POTION_TYPES = ['potion', 'splash_potion', 'lingering_potion'];
  // registerItemRecipe(input item, ingredient, output item)
  Br.ITEM_RECIPES = [
    ['potion', 'gunpowder', 'splash_potion'],
    ['splash_potion', 'dragon_breath', 'lingering_potion']
  ];
  // registerPotionRecipe(input potion, ingredient, output potion) — vanilla's order, row for row
  Br.POTION_RECIPES = [
    ['water', 'glistering_melon_slice', 'mundane'],
    ['water', 'ghast_tear', 'mundane'],
    ['water', 'rabbit_foot', 'mundane'],
    ['water', 'blaze_powder', 'mundane'],
    ['water', 'spider_eye', 'mundane'],
    ['water', 'sugar', 'mundane'],
    ['water', 'magma_cream', 'mundane'],
    ['water', 'glowstone_dust', 'thick'],
    ['water', 'redstone', 'mundane'],
    ['water', 'nether_wart', 'awkward'],
    ['awkward', 'golden_carrot', 'night_vision'],
    ['night_vision', 'redstone', 'long_night_vision'],
    ['night_vision', 'fermented_spider_eye', 'invisibility'],
    ['long_night_vision', 'fermented_spider_eye', 'long_invisibility'],
    ['invisibility', 'redstone', 'long_invisibility'],
    ['awkward', 'magma_cream', 'fire_resistance'],
    ['fire_resistance', 'redstone', 'long_fire_resistance'],
    ['awkward', 'rabbit_foot', 'leaping'],
    ['leaping', 'redstone', 'long_leaping'],
    ['leaping', 'glowstone_dust', 'strong_leaping'],
    ['leaping', 'fermented_spider_eye', 'slowness'],
    ['long_leaping', 'fermented_spider_eye', 'long_slowness'],
    ['slowness', 'redstone', 'long_slowness'],
    ['slowness', 'glowstone_dust', 'strong_slowness'],
    ['awkward', 'turtle_helmet', 'turtle_master'],
    ['turtle_master', 'redstone', 'long_turtle_master'],
    ['turtle_master', 'glowstone_dust', 'strong_turtle_master'],
    ['swiftness', 'fermented_spider_eye', 'slowness'],
    ['long_swiftness', 'fermented_spider_eye', 'long_slowness'],
    ['awkward', 'sugar', 'swiftness'],
    ['swiftness', 'redstone', 'long_swiftness'],
    ['swiftness', 'glowstone_dust', 'strong_swiftness'],
    ['awkward', 'pufferfish', 'water_breathing'],
    ['water_breathing', 'redstone', 'long_water_breathing'],
    ['awkward', 'glistering_melon_slice', 'healing'],
    ['healing', 'glowstone_dust', 'strong_healing'],
    ['healing', 'fermented_spider_eye', 'harming'],
    ['strong_healing', 'fermented_spider_eye', 'strong_harming'],
    ['harming', 'glowstone_dust', 'strong_harming'],
    ['poison', 'fermented_spider_eye', 'harming'],
    ['long_poison', 'fermented_spider_eye', 'harming'],
    ['strong_poison', 'fermented_spider_eye', 'strong_harming'],
    ['awkward', 'spider_eye', 'poison'],
    ['poison', 'redstone', 'long_poison'],
    ['poison', 'glowstone_dust', 'strong_poison'],
    ['awkward', 'ghast_tear', 'regeneration'],
    ['regeneration', 'redstone', 'long_regeneration'],
    ['regeneration', 'glowstone_dust', 'strong_regeneration'],
    ['awkward', 'blaze_powder', 'strength'],
    ['strength', 'redstone', 'long_strength'],
    ['strength', 'glowstone_dust', 'strong_strength'],
    ['water', 'fermented_spider_eye', 'weakness'],
    ['weakness', 'redstone', 'long_weakness'],
    ['awkward', 'phantom_membrane', 'slow_falling'],
    ['slow_falling', 'redstone', 'long_slow_falling']
  ];

  // registerPotionRecipe/registerItemRecipe/registerPotionType throw on a non-potion; the JS
  // equivalent is a load-time assertion that every name is one the rest of the engine knows.
  (function () {
    var P = NS.Potion && NS.Potion.POTIONS;
    if (!P) return;   // a check that loads this without 07z_potion.js gets no validation, not a crash
    for (var k = 0; k < Br.POTION_RECIPES.length; k++) {
      var r = Br.POTION_RECIPES[k];
      if (!P[r[0]] || !P[r[2]]) throw new Error('BrewingRecipeRegistry: unknown potion in row ' + k + ': ' + r.join(' + '));
    }
  })();

  function itemName(st) {
    if (!st || st.n <= 0) return null;
    return NS.Items && NS.Items.nameOf ? NS.Items.nameOf(st.i) : null;
  }
  /** `PotionUtil.getPotion(stack)` — the tag's `Potion`, `empty` when missing or unknown. */
  Br.potionOf = function (st) {
    var t = st && st.t;
    if (!t || t.Potion === undefined || t.Potion === null) return 'empty';
    var id = String(t.Potion);
    if (id.indexOf(':') < 0) id = 'minecraft:' + id;
    if (id.lastIndexOf('minecraft:', 0) !== 0) return 'empty';
    id = id.slice(10);
    var P = NS.Potion && NS.Potion.POTIONS;
    return (P && P[id]) ? id : 'empty';
  };
  /** `PotionUtil.setPotion(new ItemStack(item), potion)` — a fresh one-count stack; `empty` has no tag. */
  Br.potionStack = function (item, potion) {
    var I = NS.Inventory;
    return I.stack(item, 1, 0, potion === 'empty' ? undefined : { Potion: 'minecraft:' + potion });
  };

  /** `isItemRecipeIngredient` */
  Br.isItemRecipeIngredient = function (st) {
    var n = itemName(st);
    for (var k = 0; k < Br.ITEM_RECIPES.length; k++) if (Br.ITEM_RECIPES[k][1] === n) return true;
    return false;
  };
  /** `isPotionRecipeIngredient` */
  Br.isPotionRecipeIngredient = function (st) {
    var n = itemName(st);
    for (var k = 0; k < Br.POTION_RECIPES.length; k++) if (Br.POTION_RECIPES[k][1] === n) return true;
    return false;
  };
  /** `isValidIngredient` — the brewing stand's ingredient slot `mayPlace`. */
  Br.isValidIngredient = function (st) {
    return Br.isItemRecipeIngredient(st) || Br.isPotionRecipeIngredient(st);
  };
  /** `POTION_TYPE_PREDICATE.test` — a potion, splash or lingering potion (not a glass bottle). */
  Br.isPotionType = function (st) {
    return Br.POTION_TYPES.indexOf(itemName(st)) >= 0;
  };
  /** `isBrewable(potion)` — some POTION_RECIPES row outputs it. */
  Br.isBrewable = function (potion) {
    for (var k = 0; k < Br.POTION_RECIPES.length; k++) if (Br.POTION_RECIPES[k][2] === potion) return true;
    return false;
  };
  /** `hasItemRecipe(input, ingredient)` */
  Br.hasItemRecipe = function (input, ingredient) {
    var item = itemName(input), ing = itemName(ingredient);
    for (var k = 0; k < Br.ITEM_RECIPES.length; k++) {
      var r = Br.ITEM_RECIPES[k];
      if (r[0] === item && r[1] === ing) return true;
    }
    return false;
  };
  /** `hasPotionRecipe(input, ingredient)` */
  Br.hasPotionRecipe = function (input, ingredient) {
    var p = Br.potionOf(input), ing = itemName(ingredient);
    for (var k = 0; k < Br.POTION_RECIPES.length; k++) {
      var r = Br.POTION_RECIPES[k];
      if (r[0] === p && r[1] === ing) return true;
    }
    return false;
  };
  /** `hasRecipe(input, ingredient)` */
  Br.hasRecipe = function (input, ingredient) {
    return !Br.isPotionType(input) ? false : Br.hasItemRecipe(input, ingredient) || Br.hasPotionRecipe(input, ingredient);
  };
  /**
   * `craft(ingredient, input)` — the item recipes first (the potion carried over onto the new
   * item), then the potion recipes (the same item, the new potion). Both build a FRESH stack, so
   * any other tag the input carried is dropped, as vanilla's `new ItemStack(...)` drops it. No
   * match returns `input` itself.
   */
  Br.craft = function (ingredient, input) {
    if (input && input.n > 0) {
      var p = Br.potionOf(input), item = itemName(input), ing = itemName(ingredient), k, r;
      for (k = 0; k < Br.ITEM_RECIPES.length; k++) {
        r = Br.ITEM_RECIPES[k];
        if (r[0] === item && r[1] === ing) return Br.potionStack(r[2], p);
      }
      for (k = 0; k < Br.POTION_RECIPES.length; k++) {
        r = Br.POTION_RECIPES[k];
        if (r[0] === p && r[1] === ing) return Br.potionStack(item, r[2]);
      }
    }
    return input;
  };

  /** Every distinct ingredient item, in first-registration order (item recipes first). */
  Br.ingredients = function () {
    var out = [], k;
    for (k = 0; k < Br.ITEM_RECIPES.length; k++) if (out.indexOf(Br.ITEM_RECIPES[k][1]) < 0) out.push(Br.ITEM_RECIPES[k][1]);
    for (k = 0; k < Br.POTION_RECIPES.length; k++) if (out.indexOf(Br.POTION_RECIPES[k][1]) < 0) out.push(Br.POTION_RECIPES[k][1]);
    return out;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
