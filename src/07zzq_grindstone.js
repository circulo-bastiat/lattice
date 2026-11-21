// 07zzq_grindstone.js — G22e: GrindstoneScreenHandler (.decomp/net/minecraft/screen/
// GrindstoneScreenHandler.java) as NS.Grind.menu*: two input slots + a result slot; the result is
// the repair-combine / disenchant of the inputs (curses kept, an enchanted book with no curse
// becomes a plain book), taking it spawns XP from the removed enchantments' MIN powers and
// empties both inputs. Stacks are `{i, n, d, t}`, `d` = damage, `t` = the NBT tag.
//
// AFTER 07ox_enchhelper.js (getMinPower) and 07zz_xporb.js (Xp.spawn); both read live.
(function (NS) {
  'use strict';

  var Grind = NS.Grind = {};
  var CURSES = { 'minecraft:binding_curse': 1, 'minecraft:vanishing_curse': 1 };   // Enchantment.isCursed
  Grind.SLOTS = { in1: [49, 19], in2: [49, 40], out: [129, 34] };                 // GrindstoneScreenHandler ctor

  function short(id) { return id.replace(/^minecraft:/, ''); }
  function items() { return NS.Items; }
  function empty(s) { return !s || !(s.n > 0); }
  function maxDamage(s) { return items().durability[s.i] | 0; }
  function isBook(s) { return s.i === items().of('enchanted_book'); }
  function copy(s) { return { i: s.i, n: s.n, d: s.d || 0, t: s.t ? JSON.parse(JSON.stringify(s.t)) : s.t }; }
  function cursed(id) { return !!CURSES[id]; }

  /** `EnchantmentHelper.get`: StoredEnchantments on an enchanted book, else Enchantments. */
  Grind.enchantsOf = function (s) {
    var L = s && s.t && s.t[isBook(s) ? 'StoredEnchantments' : 'Enchantments'], out = [];
    for (var i = 0; L && i < L.length; i++) out.push({ id: NS.Combat.enchantId(L[i].id), lvl: L[i].lvl | 0 });
    return out;
  };
  /** `ItemStack.hasEnchantments`: the Enchantments list only (a book's Stored list doesn't count). */
  function hasEnchantments(s) { return !!(s.t && s.t.Enchantments && s.t.Enchantments.length); }
  function canInsert(s) { return !empty(s) && (!!maxDamage(s) || isBook(s) || hasEnchantments(s)); }
  Grind.canInsert = canInsert;

  function addEnchantment(s, id, lvl) {
    s.t = s.t || {};
    (s.t.Enchantments = s.t.Enchantments || []).push({ id: id, lvl: lvl });
  }
  /** `EnchantmentHelper.set`. */
  function setEnchants(s, list) {
    var key = isBook(s) ? 'StoredEnchantments' : 'Enchantments';
    s.t = s.t || {};
    delete s.t.Enchantments; delete s.t.StoredEnchantments;
    if (list.length) s.t[key] = list.map(function (e) { return { id: e.id, lvl: e.lvl }; });
  }
  /** `AnvilScreenHandler.getNextCost`. */
  Grind.nextCost = function (c) { return c * 2 + 1; };

  function transfer(a, b) {
    var r = copy(a), L = Grind.enchantsOf(b);
    for (var i = 0; i < L.length; i++) {
      var have = Grind.enchantsOf(r).some(function (e) { return e.id === L[i].id && e.lvl > 0; });
      if (!cursed(L[i].id) || !have) addEnchantment(r, L[i].id, L[i].lvl);
    }
    return r;
  }
  function grind(s, damage, count) {
    var r = copy(s), keep = Grind.enchantsOf(s).filter(function (e) { return cursed(e.id); });
    if (r.t) { delete r.t.Enchantments; delete r.t.StoredEnchantments; }
    r.d = damage > 0 ? damage : 0;
    r.n = count;
    setEnchants(r, keep);
    r.t = r.t || {}; r.t.RepairCost = 0;
    if (isBook(r) && !keep.length) {
      var name = s.t && s.t.display && s.t.display.Name;
      r = { i: items().of('book'), n: count, d: 0, t: name ? { display: { Name: name } } : undefined };
    }
    for (var k = 0; k < keep.length; k++) r.t.RepairCost = Grind.nextCost(r.t.RepairCost | 0);
    return r;
  }
  function same(a, b) { return a.i === b.i && a.n === b.n && (a.d || 0) === (b.d || 0) && JSON.stringify(a.t || null) === JSON.stringify(b.t || null); }

  /** `updateResult`: the result stack for the two input slots, or null. */
  Grind.result = function (a, b) {
    var has1 = !empty(a), has2 = !empty(b);
    if (!has1 && !has2) return null;
    var plain = function (s) { return !empty(s) && !isBook(s) && !hasEnchantments(s); };
    if ((has1 && a.n > 1) || (has2 && b.n > 1) || (!(has1 && has2) && (plain(a) || plain(b)))) return null;
    var count = 1, dmg, base;
    if (has1 && has2) {
      if (a.i !== b.i) return null;
      var max = maxDamage(a);
      var sum = (max - (a.d || 0)) + (max - (b.d || 0)) + Math.trunc(max * 5 / 100);
      dmg = Math.max(max - sum, 0);
      base = transfer(a, b);
      if (!maxDamage(base)) { if (!same(a, b)) return null; count = 2; }
    } else {
      base = has1 ? a : b; dmg = base.d || 0;
    }
    return grind(base, dmg, count);
  };

  /** `getExperience(World)`: the removed enchantments' MIN powers (curses excluded), halved, plus a random half. */
  Grind.experience = function (a, b, rand) {
    var sum = 0;
    [a, b].forEach(function (s) {
      if (empty(s)) return;
      Grind.enchantsOf(s).forEach(function (e) { if (!cursed(e.id)) sum += NS.EnchHelper.getMinPower(short(e.id), e.lvl); });
    });
    if (sum <= 0) return 0;
    var half = Math.ceil(sum / 2);
    return half + Math.floor((rand || Math.random)() * half);
  };

  Grind.menuOpen = function (P) { return { P: P, slots: [null, null], result: null }; };
  /** Put a stack in an input slot (refused if `canInsert` says so); recomputes the result. */
  Grind.menuSet = function (m, k, s) {
    if (s && !canInsert(s)) return false;
    m.slots[k] = s || null;
    m.result = Grind.result(m.slots[0], m.slots[1]);
    return true;
  };
  /** Take the result: XP orbs at `pos` (x,y,z), both inputs emptied. Returns the taken stack or null. */
  Grind.menuTake = function (m, pos, rand) {
    var r = m.result;
    if (!r) return null;
    var xp = Grind.experience(m.slots[0], m.slots[1], rand);
    if (xp > 0 && pos && NS.Xp && NS.Xp.spawn) NS.Xp.spawn(pos.x, pos.y, pos.z, xp, rand);
    m.slots = [null, null]; m.result = null;
    m.lastXp = xp;
    return r;
  };
  /** `close` -> `dropInventory`: hand the inputs back to the inventory. Returns leftovers to drop. */
  Grind.menuClose = function (m) {
    var left = [];
    for (var k = 0; k < 2; k++) {
      var s = m.slots[k];
      if (s && NS.Inventory.add(m.P.inventory, s) > 0) left.push(s);
      m.slots[k] = null;
    }
    m.result = null;
    return left;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
