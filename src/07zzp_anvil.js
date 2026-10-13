// 07zzp_anvil.js — G22d: the anvil's rules. `AnvilScreenHandler.updateResult`/`onTakeOutput`/
// `getNextCost`/`canTakeOutput` (.decomp/net/minecraft/screen/AnvilScreenHandler.java), the
// `canRepair` overrides (ToolItem/ArmorItem/ShieldItem/ElytraItem), `EnchantmentTarget.isAcceptableItem`
// and `AnvilBlock.getLandingState` (chipped -> damaged -> gone). Pure functions over stacks
// ({i, n, d, t}); enchantments live in `t.Enchantments` / `t.StoredEnchantments` ([{id, lvl}]),
// the prior-work penalty in `t.RepairCost`, the rename in `t.display.Name` (14l_use.js reads it).
//
// The GUI (AnvilScreen: `Hud.openAnvil`, `Menu.anvilMenu`) and the right-click hook (14l_use.js) consume `Anvil.compute` / `Anvil.take`.

(function (NS) {
  'use strict';

  var An = NS.Anvil = {};

  // Rarity weight -> `Enchantment.Rarity` anvil multiplier (COMMON 10 -> 1, UNCOMMON 5 -> 2,
  // RARE 2 -> 4, VERY_RARE 1 -> 8; the switch at AnvilScreenHandler.java:~150).
  function rarityMult(w) { return w >= 10 ? 1 : w >= 5 ? 2 : w >= 2 ? 4 : 8; }

  function itName(s) { return NS.Items.nameOf(s.i); }
  function isEmpty(s) { return !s || !(s.n > 0); }
  function maxDamage(s) { var d = NS.Items.durability; return d ? (d[s.i] | 0) : 0; }
  function damageable(s) { return maxDamage(s) > 0; }
  function copy(s) { return NS.Inventory.copy(s); }
  function tag(s) { return s.t || (s.t = {}); }
  function idOf(s) { return String(s.id || '').replace(/^minecraft:/, ''); }

  var TOOL_KIND = /_(sword|pickaxe|axe|shovel|hoe)$/;
  var ARMOR_KIND = /_(helmet|chestplate|leggings|boots)$/;
  var PLANKS = /_planks$/;

  /** `Item.canRepair(stack, material)` for a damageable item: ToolMaterials / ArmorMaterials
   *  repair ingredients (ToolMaterials.java:9-14, ArmorMaterials.java:11-17), ShieldItem's planks
   *  tag, ElytraItem's phantom membrane; everything else `Item.canRepair` false. */
  An.canRepair = function (name, mat) {
    var m;
    if (name === 'shield') return PLANKS.test(mat);
    if (name === 'elytra') return mat === 'phantom_membrane';
    if (TOOL_KIND.test(name)) {
      m = name.split('_')[0];
      if (m === 'wooden') return PLANKS.test(mat);
      if (m === 'stone') return mat === 'cobblestone' || mat === 'cobbled_deepslate' || mat === 'blackstone';
      if (m === 'iron') return mat === 'iron_ingot';
      if (m === 'golden') return mat === 'gold_ingot';
      if (m === 'diamond') return mat === 'diamond';
      if (m === 'netherite') return mat === 'netherite_ingot';
      return false;
    }
    if (ARMOR_KIND.test(name)) {
      m = name.split('_')[0];
      if (m === 'leather') return mat === 'leather';
      if (m === 'chainmail' || m === 'iron') return mat === 'iron_ingot';
      if (m === 'golden') return mat === 'gold_ingot';
      if (m === 'diamond') return mat === 'diamond';
      if (m === 'turtle') return mat === 'scute';
      if (m === 'netherite') return mat === 'netherite_ingot';
    }
    return false;
  };

  // `EnchantmentTarget.isAcceptableItem` + the per-enchantment overrides (Damage: axes too,
  // Efficiency: shears, Thorns: any armor, Unbreaking: any damageable).
  var WEARABLE = /_(helmet|chestplate|leggings|boots)$|^(elytra|carved_pumpkin)$|_(head|skull)$/;
  function targetOk(target, name, dmg) {
    switch (target) {
      case 'armor': return ARMOR_KIND.test(name);
      case 'armor_head': return /_helmet$/.test(name);
      case 'armor_chest': return /_chestplate$/.test(name);
      case 'armor_legs': return /_leggings$/.test(name);
      case 'armor_feet': return /_boots$/.test(name);
      case 'weapon': return /_sword$/.test(name);
      case 'digger': return /_(pickaxe|axe|shovel|hoe)$/.test(name);
      case 'fishing_rod': return name === 'fishing_rod';
      case 'trident': return name === 'trident';
      case 'breakable': return dmg;
      case 'bow': return name === 'bow';
      case 'crossbow': return name === 'crossbow';
      case 'wearable': return WEARABLE.test(name);
      case 'vanishable': return dmg || WEARABLE.test(name) || name === 'compass';
    }
    return false;
  }
  An.isAcceptable = function (id, name, dmg) {
    var e = NS.EnchHelper.ENCH[id];
    if (!e) return false;
    var t = e.target;
    if (id === 'binding_curse') t = 'wearable';
    else if (id === 'vanishing_curse') t = 'vanishable';
    if (targetOk(t, name, dmg)) return true;
    if ((id === 'sharpness' || id === 'smite' || id === 'bane_of_arthropods') && /_axe$/.test(name)) return true;
    if (id === 'efficiency' && name === 'shears') return true;
    if (id === 'thorns' && ARMOR_KIND.test(name)) return true;
    if (id === 'unbreaking' && dmg) return true;
    return false;
  };

  // -- the stack's enchantment map (EnchantmentHelper.get: a book reads StoredEnchantments) -----
  function listKey(s) { return itName(s) === 'enchanted_book' ? 'StoredEnchantments' : 'Enchantments'; }
  function getEnch(s, key) {
    var out = {}, L = s.t && s.t[key || listKey(s)];
    if (L) for (var i = 0; i < L.length; i++) { var id = idOf(L[i]); if (id) out[id] = L[i].lvl | 0; }
    return out;
  }
  /** `EnchantmentHelper.set`: a book carries StoredEnchantments, everything else Enchantments. */
  function setEnch(s, map) {
    var ids = Object.keys(map), L = [];
    for (var i = 0; i < ids.length; i++) if (map[ids[i]] > 0) L.push({ id: 'minecraft:' + ids[i], lvl: map[ids[i]] });
    var t = tag(s);
    delete t.Enchantments;
    delete t.StoredEnchantments;
    if (L.length) t[itName(s) === 'enchanted_book' ? 'StoredEnchantments' : 'Enchantments'] = L;
  }
  An.enchantsOf = getEnch;

  function repairCostOf(s) { return (s.t && s.t.RepairCost) | 0; }
  An.getNextCost = function (c) { return c * 2 + 1; };   // AnvilScreenHandler.getNextCost
  An.nameOf = function (s) { return s && s.t && s.t.display && typeof s.t.display.Name === 'string' ? s.t.display.Name : null; };
  function setName(s, n) {
    var t = tag(s);
    if (n === null) { if (t.display) { delete t.display.Name; if (!Object.keys(t.display).length) delete t.display; } }
    else { t.display = t.display || {}; t.display.Name = n; }
  }

  /**
   * `updateResult()`. `a`/`b`: the two input stacks, `name`: the rename field, `opts`:
   * `{creative, defaultName(stack) -> string}`. Returns `{output|null, cost, repairUsage}`;
   * `cost` 0 with a null output is "nothing"; a null output with cost >= 40 is "Too Expensive!".
   */
  An.compute = function (a, b, name, opts) {
    opts = opts || {};
    var none = { output: null, cost: 0, repairUsage: 0 };
    if (isEmpty(a)) return none;
    var out = copy(a), cost = 0, extra = 0, rename = 0, usage = 0;
    var map = getEnch(out);
    var IT = NS.Items, EH = NS.EnchHelper;
    extra += repairCostOf(a) + (isEmpty(b) ? 0 : repairCostOf(b));
    var bEmpty = isEmpty(b);
    if (!bEmpty) {
      var book = itName(b) === 'enchanted_book' && Object.keys(getEnch(b)).length > 0;
      if (damageable(out) && An.canRepair(itName(a), itName(b))) {
        var step = Math.min(out.d | 0, maxDamage(out) / 4 | 0);
        if (step <= 0) return none;
        var n;
        for (n = 0; step > 0 && n < b.n; n++) {
          out.d = (out.d | 0) - step;
          cost++;
          step = Math.min(out.d | 0, maxDamage(out) / 4 | 0);
        }
        usage = n;
      } else {
        if (!book && (out.i !== b.i || !damageable(out))) return none;
        if (damageable(out) && !book) {
          var left1 = maxDamage(a) - (a.d | 0), left2 = maxDamage(b) - (b.d | 0);
          var sum = left1 + left2 + (maxDamage(out) * 12 / 100 | 0);
          var nd = maxDamage(out) - sum;
          if (nd < 0) nd = 0;
          if (nd < (out.d | 0)) { out.d = nd; cost += 2; }
        }
        var bm = getEnch(b), any = false, bad = false;
        var dmg = damageable(a), an = itName(a);
        for (var id in bm) {
          var cur = map[id] | 0, lv = bm[id];
          lv = cur === lv ? lv + 1 : Math.max(lv, cur);
          var ok = An.isAcceptable(id, an, dmg);
          if (opts.instabuild || an === 'enchanted_book') ok = true;
          for (var o in map) if (o !== id && !EH.canCombine(id, o)) { ok = false; cost++; }
          if (!ok) bad = true;
          else {
            any = true;
            var max = EH.ENCH[id].maxLevel;
            if (lv > max) lv = max;
            map[id] = lv;
            var mult = rarityMult(EH.ENCH[id].weight);
            if (book) mult = Math.max(1, mult / 2 | 0);
            cost += mult * lv;
            if (a.n > 1) cost = 40;
          }
        }
        if (bad && !any) return none;
      }
    }
    if (!name || !String(name).trim()) {
      if (An.nameOf(a) !== null) { rename = 1; cost += 1; setName(out, null); }
    } else if (name !== (opts.defaultName ? opts.defaultName(a) : itName(a))) {
      rename = 1; cost += 1; setName(out, name);
    }
    var total = extra + cost;
    if (cost <= 0) out = null;
    if (rename === cost && rename > 0 && total >= 40) total = 39;
    if (total >= 40 && !opts.instabuild) out = null;
    if (out) {
      var rc = repairCostOf(out);
      if (!bEmpty && rc < repairCostOf(b)) rc = repairCostOf(b);
      if (rename !== cost || rename === 0) rc = An.getNextCost(rc);
      tag(out).RepairCost = rc;
      setEnch(out, map);
      if (!Object.keys(tag(out)).length) delete out.t;
    }
    return { output: out, cost: total, repairUsage: usage };
  };

  /** `canTakeOutput`: creative or enough levels, and a positive cost. */
  An.canTake = function (cost, levels, creative) { return (creative || levels >= cost) && cost > 0; };

  /** `AnvilBlock.getLandingState`: the block name after a use that damages it, null = destroyed. */
  An.landing = function (blockName) {
    return blockName === 'anvil' ? 'chipped_anvil' : blockName === 'chipped_anvil' ? 'damaged_anvil' : null;
  };

  /**
   * `onTakeOutput`: spends the levels, empties input 0, uses `repairUsage` of input 1 (else clears
   * it), and rolls the 12% block damage (`nextFloat() < 0.12`, survival only). `m` = `{a, b}`
   * (mutated), `r` = an `An.compute` result. Returns `{levels, block}`: the levels to spend and
   * `{sound: 1029|1030, to: name|null|undefined}` (1029 = destroyed, 1030 = used, `to` set when
   * the block changes).
   */
  An.take = function (m, r, blockName, creative, rng) {
    var Iv = NS.Inventory;
    m.a = Iv.EMPTY;
    if (r.repairUsage > 0 && !isEmpty(m.b) && m.b.n > r.repairUsage) m.b.n -= r.repairUsage;
    else m.b = Iv.EMPTY;
    var block = { sound: 1030 };
    if (!creative && /^(chipped_|damaged_)?anvil$/.test(blockName) && rng() < 0.12) {
      var to = An.landing(blockName);
      block.to = to;
      block.sound = to === null ? 1029 : 1030;
    }
    return { levels: creative ? 0 : r.cost, block: block };
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
