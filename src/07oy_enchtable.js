// 07oy_enchtable.js — PLAN G22. The enchanting TABLE's own algorithm: `EnchantmentScreenHandler`
// (.decomp/net/minecraft/screen/EnchantmentScreenHandler.java) minus the slots, and the item
// facts it asks (`Item.getEnchantability`, `EnchantmentTarget.isAcceptableItem`,
// `ItemStack.isEnchantable`). The enchantment ROSTER and its power windows are 07ox's (`NS.EnchHelper`).
//
// ⚠ A REAL `java.util.Random`. The table shows a CLUE per button, and vanilla's own seed makes the clue
// and the result agree (the seed + button index reseeds the roll), so the roll here is the
// LCG itself rather than 07ox's `rng()*n` stand-in — that shortcut is fine for a villager's one-off
// trade, but a screen that shows "Sharpness" and then applies Smite has broken its own promise.
//
// ⚠ ITEM FACTS ARE BY NAME, transcribed from ToolMaterials/ArmorMaterials/the item classes
// (enchantability: wood 15, stone 5, iron 14, gold 22, diamond 10, netherite 15; leather 15, chain 12,
// iron 9, gold 25, diamond 10, turtle 9, netherite 15; bow/crossbow/trident/rod 1, shield 9, book 1).
// `targets` are 07ox's `ENCH[id].target` strings an item is acceptable to: `Damage`/sharpness
// accepts SwordItem only at the table (axes get it at the anvil, `isAcceptableItem(ItemStack)`).

(function (NS) {
  'use strict';

  var ET = NS.EnchTable = {};

  // ── java.util.Random ───────────────────────────────────────────────────────────────────
  var MASK = (1n << 48n) - 1n, MULT = 0x5DEECE66Dn;
  function JRandom(seed) { this.setSeed(seed); }
  JRandom.prototype.setSeed = function (seed) {
    this.s = (BigInt.asUintN(64, BigInt(seed)) ^ MULT) & MASK;
  };
  JRandom.prototype.next = function (bits) {
    this.s = (this.s * MULT + 0xBn) & MASK;
    return Number(BigInt.asIntN(32, this.s >> (48n - BigInt(bits))));
  };
  JRandom.prototype.nextInt = function (bound) {
    if (bound === undefined) return this.next(32);
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    var bits, val;
    do { bits = this.next(31); val = bits % bound; } while (bits - val + (bound - 1) > 2147483647);
    return val;
  };
  JRandom.prototype.nextFloat = function () { return this.next(24) / 16777216; };
  ET.Random = JRandom;

  // ── item facts ───────────────────────────────────────────────────────────────────────────
  var TOOL_ENCH = { wooden: 15, stone: 5, iron: 14, golden: 22, diamond: 10, netherite: 15 };
  var ARMOR_ENCH = { leather: 15, chainmail: 12, iron: 9, golden: 25, diamond: 10, netherite: 15 };
  var SLOT_TARGET = { helmet: 'armor_head', chestplate: 'armor_chest', leggings: 'armor_legs', boots: 'armor_feet' };
  var FIXED = {
    bow: [1, ['bow', 'breakable']], crossbow: [1, ['crossbow', 'breakable']],
    trident: [1, ['trident', 'breakable']], fishing_rod: [1, ['fishing_rod', 'breakable']],
    shield: [9, ['breakable']], turtle_helmet: [9, ['armor', 'armor_head', 'breakable']],
    book: [1, []]
  };

  /** `{ ench, targets, book }` for an item name, or null when `Item.getEnchantability()` is 0
   *  or the item is not damageable (so `isEnchantable` is false). */
  ET.info = function (name) {
    if (!name) return null;
    var f = FIXED[name];
    if (f) return { ench: f[0], targets: f[1], book: name === 'book' };
    var m = /^(wooden|stone|iron|golden|diamond|netherite)_(sword|axe|pickaxe|shovel|hoe)$/.exec(name);
    if (m) return { ench: TOOL_ENCH[m[1]], targets: [m[2] === 'sword' ? 'weapon' : 'digger', 'breakable'], book: false };
    m = /^(leather|chainmail|iron|golden|diamond|netherite)_(helmet|chestplate|leggings|boots)$/.exec(name);
    if (m) return { ench: ARMOR_ENCH[m[1]], targets: ['armor', SLOT_TARGET[m[2]], 'breakable'], book: false };
    return null;
  };

  /** `ItemStack.hasEnchantments` — a non-empty `Enchantments` list (a book's is `StoredEnchantments`). */
  ET.hasEnchantments = function (st) {
    var L = st && st.t && st.t.Enchantments;
    return !!(L && L.length);
  };

  /** `ItemStack.isEnchantable`: the item allows it (count 1) and nothing is on it yet. */
  ET.isEnchantable = function (st) {
    if (!st || st.n !== 1) return false;
    var inf = ET.info(NS.Items.nameOf(st.i));
    return !!inf && !ET.hasEnchantments(st);
  };

  // ── the bookshelves ──────────────────────────────────────────────────────────────────────
  // `EnchantingTableBlock.BOOKSHELF_OFFSETS`: the 5x5 ring at the table's own height and one up.
  var OFFSETS = ET.BOOKSHELF_OFFSETS = (function () {
    var out = [];
    for (var dy = 0; dy <= 1; dy++) for (var dz = -2; dz <= 2; dz++) for (var dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) === 2 || Math.abs(dz) === 2) out.push([dx, dy, dz]);
    }
    return out;
  }());

  /** `AbstractBlockState.isAir` — the three air blocks, so a shelf seen across a cave_air pocket counts. */
  ET.isAirName = function (name) {
    return name === 'air' || name === 'cave_air' || name === 'void_air';
  };

  /** `EnchantmentScreenHandler.onContentChanged`'s count: a bookshelf at the offset AND air on the cell
   *  half way between it and the table (`canAccessBookshelf`). `blockAt(x,y,z)` -> block name. */
  ET.countBookshelves = function (blockAt, x, y, z) {
    var n = 0;
    for (var i = 0; i < OFFSETS.length; i++) {
      var o = OFFSETS[i];
      if (blockAt(x + o[0], y + o[1], z + o[2]) === 'bookshelf' &&
          ET.isAirName(blockAt(x + ((o[0] / 2) | 0), y + o[1], z + ((o[2] / 2) | 0)))) n++;
    }
    return n;
  };

  // ── the roll ─────────────────────────────────────────────────────────────────────────────
  /** `EnchantmentHelper.calculateRequiredExperienceLevel` */
  ET.requiredLevel = function (rnd, button, shelves, info) {
    if (!info || info.ench <= 0) return 0;
    if (shelves > 15) shelves = 15;
    var v = rnd.nextInt(8) + 1 + (shelves >> 1) + rnd.nextInt(shelves + 1);
    if (button === 0) return Math.max((v / 3) | 0, 1);
    return button === 1 ? ((v * 2 / 3) | 0) + 1 : Math.max(v, shelves * 2);
  };

  function weightedRandom(rnd, pool) {
    var EH = NS.EnchHelper, total = 0, i;
    for (i = 0; i < pool.length; i++) total += EH.ENCH[pool[i].id].weight;
    if (total <= 0) return null;
    var r = rnd.nextInt(total);
    for (i = 0; i < pool.length; i++) {
      r -= EH.ENCH[pool[i].id].weight;
      if (r < 0) return pool[i];
    }
    return null;
  }

  /** `EnchantmentHelper.generateEnchantments(random, stack, power, false)` -> [{id, level}] */
  ET.generate = function (rnd, info, power) {
    var EH = NS.EnchHelper, out = [];
    if (!info || info.ench <= 0) return out;
    var q = (info.ench / 4) | 0;
    power += 1 + rnd.nextInt(q + 1) + rnd.nextInt(q + 1);
    var jit = Math.fround(Math.fround(rnd.nextFloat() + rnd.nextFloat() - 1) * 0.15);
    power = Math.max(1, Math.round(Math.fround(power + Math.fround(power * jit))));
    var pool = EH.getPossibleEntries(power, info.book ? ET.ALL_TARGETS : info.targets, false), pick;
    if (!pool.length) return out;
    if ((pick = weightedRandom(rnd, pool))) out.push(pick);
    while (rnd.nextInt(50) <= power) {
      if (out.length) {
        var last = out[out.length - 1];
        pool = pool.filter(function (e) { return EH.canCombine(last.id, e.id); });
      }
      if (!pool.length) break;
      if ((pick = weightedRandom(rnd, pool))) out.push(pick);
      power = (power / 2) | 0;
    }
    return out;
  };
  ET.ALL_TARGETS = ['armor', 'armor_head', 'armor_chest', 'armor_legs', 'armor_feet', 'weapon', 'digger',
    'breakable', 'bow', 'fishing_rod', 'trident', 'crossbow'];

  /** The table's state for a stack: `{ power[3], id[3], level[3] }`, exactly `onContentChanged`'s tail. */
  ET.offers = function (seed, shelves, stack) {
    var o = { power: [0, 0, 0], id: [null, null, null], level: [-1, -1, -1] };
    if (!ET.isEnchantable(stack)) return o;
    var info = ET.info(NS.Items.nameOf(stack.i)), rnd = new JRandom(seed), b;
    for (b = 0; b < 3; b++) {
      o.power[b] = ET.requiredLevel(rnd, b, shelves, info);
      if (o.power[b] < b + 1) o.power[b] = 0;
    }
    for (b = 0; b < 3; b++) {
      if (o.power[b] > 0) {
        // `generateEnchantments` reseeds `this.random` with seed + button, and the clue is the NEXT
        // draw off that same generator — so the roll and the clue share one state.
        var r2 = new JRandom(seed + b);
        var list = ET.rollWith(r2, info, o.power[b]);
        if (list.length) {
          var e = list[r2.nextInt(list.length)];
          o.id[b] = e.id; o.level[b] = e.level;
        }
      }
    }
    return o;
  };

  /** `EnchantmentScreenHandler.generateEnchantments` on an already-seeded generator: roll, and for a
   *  book drop one random entry when more than one came up. */
  ET.rollWith = function (rnd, info, power) {
    var list = ET.generate(rnd, info, power);
    if (info.book && list.length > 1) list.splice(rnd.nextInt(list.length), 1);
    return list;
  };
  /** The same, seeded `seed + button` — what pressing the button applies. */
  ET.rollFor = function (seed, button, info, power) {
    return ET.rollWith(new JRandom(seed + button), info, power);
  };

  /** `ItemStack.addEnchantment` / `EnchantedBookItem.addEnchantment` */
  ET.addEnchantment = function (stack, id, level, stored) {
    var key = stored ? 'StoredEnchantments' : 'Enchantments';
    if (!stack.t) stack.t = {};
    var L = stack.t[key] || (stack.t[key] = []);
    L.push({ id: 'minecraft:' + id, lvl: level });
  };

  /** The player's `enchantmentTableSeed` roll: a fresh 32-bit int. */
  ET.newSeed = function (rng) {
    return ((rng ? rng() : Math.random()) * 4294967296 | 0);
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
