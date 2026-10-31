// 07e_loot.js — PLAN G3: the 835 vanilla block loot tables, interpreted.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// ── WHY AN INTERPRETER AND NOT A DROP LIST ───────────────────────────────────────────────
// PLAN G3 ends on one sentence: *"Fortune and Silk Touch are therefore **data**, not special
// cases."* That is only true if the tables ship whole, because every one of those behaviours is
// a node INSIDE a table — `stone` is an `alternatives` entry whose first child is guarded by
// `match_tool{silk_touch}`, `diamond_ore` runs `apply_bonus{ore_drops}`, `gravel`'s flint is a
// `table_bonus` whose four numbers ARE Fortune's curve, `wheat` reads `age=7` off the block
// state. Flattening to "block -> item" at build time would throw all of it away and then need
// four hand-written special cases to put a worse version of it back.
//
// `tools/pack-loot.mjs` packs the 835 block files, the 91 entity files and the one fishing
// table a `loot_table` reference reaches, with every string interned, and REFUSES to build if a
// table uses a verb this file does not implement (D-202) — so a missing drop is a build failure
// rather than a silence. (Chest loot is still not packed — G19b's, when there is a container to
// open one FROM (D-381).)
//
// ── THE VOCABULARY, ALL OF IT ────────────────────────────────────────────────────────────
//   entries     item · alternatives · dynamic · empty · loot_table · item_choice
//   conditions  survives_explosion · match_tool · block_state_property · table_bonus ·
//               random_chance · alternative · inverted · entity_properties · location_check ·
//               killed_by_player · random_chance_with_looting · damage_source_properties
//   functions   set_count · apply_bonus · explosion_decay · limit_count · copy_name ·
//               copy_state · copy_nbt · set_contents · looting_enchant · furnace_smelt ·
//               set_potion
//
// `item_choice` does not exist in vanilla — it is `pack-loot.mjs`'s own pack-time rewrite of a
// `minecraft:tag{expand:true}` entry (only user: creeper's music discs) into a plain item list,
// so this file does not need a whole tag-membership system at runtime for one entry.
//
// Three of those are honest partials, and each says so where it is implemented rather than in a
// footnote: `copy_name`, `copy_state` and `copy_nbt` write item NBT, and item NBT is PLAN G8's
// inventory (a named chest keeps its name; a honey_block keeps `honey_level`). They record onto
// the stack's `nbt` field and change no count. `dynamic{contents}` and `set_contents` are a
// shulker box's cargo, which needs a container to have had cargo in it — they read
// `ctx.contents` and emit nothing when there is none.
//
// ── DETERMINISM ──────────────────────────────────────────────────────────────────────────
// A loot roll is random, and a check that cannot reproduce a roll cannot assert one. `ctx.rng`
// is an object with `nextFloat()` and `nextInt(n)`; `Loot.rng(seed)` builds a deterministic one
// so `minecheck` can assert an exact multiset over 10,000 rolls. With no rng supplied the
// module makes one from `Math.random`, which is what the game wants.
(function (NS) {
  'use strict';

  var L = NS.Loot = {};
  var ENTITY_TAGS = { skeletons: ['skeleton', 'stray', 'wither_skeleton'] };   // tags/entity_types/skeletons.json

  L.ready = false;
  L.version = '';
  var strings = null;
  var packed = null;          // table name index -> the packed subtree
  var byName = null;          // table name -> packed subtree
  var cache = null;           // table name -> the unpacked table

  /**
   * A small deterministic generator, so a check can name a seed and get the same drops. It is
   * NOT vanilla's `java.util.Random`: nothing in a loot table's shape depends on the generator's
   * bit pattern, only on its uniformity, and matching Java's LCG here would buy nothing that the
   * worldgen's own ported `Random` (03b_noise.js) does not already provide where it matters.
   * Written as `xorshift128+`'s cheap cousin because it is four lines and passes a chi-square.
   */
  L.rng = function (seed) {
    var s = (seed | 0) || 1;
    return {
      nextFloat: function () {
        s ^= s << 13; s |= 0; s ^= s >>> 17; s ^= s << 5; s |= 0;
        return ((s >>> 0) % 16777216) / 16777216;
      },
      nextInt: function (n) { return n <= 0 ? 0 : Math.floor(this.nextFloat() * n) % n; },
    };
  };
  var DEFAULT_RNG = {
    nextFloat: function () { return Math.random(); },
    nextInt: function (n) { return n <= 0 ? 0 : Math.floor(Math.random() * n); },
  };

  function unpack(node) {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) {
      var arr = new Array(node.length);
      for (var i = 0; i < node.length; i++) arr[i] = unpack(node[i]);
      return arr;
    }
    if (node.s !== undefined && Object.keys(node).length === 1) return strings[node.s];
    var out = {};
    for (var k in node) out[strings[k | 0]] = unpack(node[k]);
    return out;
  }

  /** init(data) — `data.loot` is base64 of the deflated interned blob. */
  L.init = function (data) {
    if (!data || !data.loot) { L.ready = false; return L; }
    var bytes = NS.Z.unpack(data.loot, data.lootBytes);
    var CH = 8192, parts = [];
    for (var i = 0; i < bytes.length; i += CH) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length))));
    }
    var blob = JSON.parse(parts.join(''));
    strings = blob.s;
    L.version = blob.v;
    packed = blob.t;
    byName = Object.create(null);
    cache = Object.create(null);
    var n = 0;
    for (var key in packed) { byName[strings[key | 0]] = packed[key]; n++; }
    L.tableCount = n;
    L.ready = true;
    return L;
  };

  /**
   * The parsed table for a block name, or undefined. Unpacked ON FIRST USE and cached: a session
   * touches a few dozen of the 835, and unpacking all of them at boot is 140 KB of object graph
   * nobody asked for — the same argument D-186 made for the structure templates.
   */
  L.table = function (name) {
    if (!L.ready) return undefined;
    var k = String(name);
    if (k.lastIndexOf('minecraft:', 0) === 0) k = k.slice(10);
    if (cache[k]) return cache[k];
    var raw = byName[k];
    if (!raw) return undefined;
    return (cache[k] = unpack(raw));
  };

  L.hasTable = function (name) { return L.ready && byName[L.key(name)] !== undefined; };
  L.key = function (name) {
    var k = String(name);
    return k.lastIndexOf('minecraft:', 0) === 0 ? k.slice(10) : k;
  };

  // ── number providers ──────────────────────────────────────────────────────────────────
  // `rolls`, `count` and `limit` are all vanilla `NumberProvider`s. Every one the block tables
  // use is a constant, a `uniform` or a `binomial`; the packer's vocabulary gate means a fourth
  // kind is a build failure, not a wrong number.
  function number(v, rng) {
    if (typeof v === 'number') return v;
    if (!v || typeof v !== 'object') return 0;
    if (v.type === 'uniform') {
      var lo = number(v.min, rng), hi = number(v.max, rng);
      return lo + rng.nextInt(Math.floor(hi) - Math.floor(lo) + 1);
    }
    if (v.type === 'binomial') {
      var n = number(v.n, rng), p = number(v.p, rng), c = 0;
      for (var i = 0; i < n; i++) if (rng.nextFloat() < p) c++;
      return c;
    }
    if (v.type === 'constant') return number(v.value, rng);
    return 0;
  }
  /** `LootNumberProvider.nextFloat` -- the FLOAT draw, distinct from `number` (`nextInt`) above.
   *  Uniform: `MathHelper.nextBetween(random, min, max)` = min + nextFloat()*(max-min), a real
   *  fraction (UniformLootNumberProvider.java), not an integer; binomial: its `nextInt` as a
   *  float; constant: the value. cloud unit referee-looting: `looting_enchant` read `number`,
   *  so `uniform 0..1` was 0 or 1 and a Looting III bonus was zero half the time, not 1/6. */
  function numberF(v, rng) {
    if (v && typeof v === 'object' && v.type === 'uniform') {
      var lo = numberF(v.min, rng), hi = numberF(v.max, rng);
      return lo + rng.nextFloat() * (hi - lo);
    }
    return number(v, rng);
  }

  // `NumberProvider.nextFloat` — `looting_enchant` multiplies the level by a FLOAT draw
  // (`MathHelper.nextFloat(random, min, max)` for uniform), where `set_count` uses `nextInt`
  // (`number` above). Rounding `3 * U` is what gives Looting III its 1/6 chance of adding nothing.
  function numberF(v, rng) {
    if (v && typeof v === 'object' && v.type === 'uniform') {
      var lo = numberF(v.min, rng), hi = numberF(v.max, rng);
      return lo >= hi ? lo : lo + rng.nextFloat() * (hi - lo);
    }
    if (v && typeof v === 'object' && v.type === 'constant') return numberF(v.value, rng);
    return number(v, rng);
  }

  // ── conditions ────────────────────────────────────────────────────────────────────────
  function stateProp(ctx, prop) {
    var R = NS.Reg, S = NS.States;
    if (!R || !S || ctx.state === undefined) return undefined;
    var pid = R.PROP[prop];
    if (pid === undefined) return undefined;
    var vid = S.propValue(ctx.state, pid);
    return vid === undefined || vid < 0 ? undefined : R.valueNames[vid];
  }

  function matchTool(pred, ctx) {
    if (!pred) return true;
    var item = ctx.item || '';
    if (pred.items) {
      var ok = false;
      for (var i = 0; i < pred.items.length; i++) if (L.key(pred.items[i]) === item) ok = true;
      if (!ok) return false;
    }
    // ⚠ `tag` is an ITEM tag, and it is G1's whole point: `cluster_max_harvestables` is the set
    // of tools that get a full amethyst cluster, and there is no other way to know it.
    if (pred.tag) {
      if (!NS.Tags || !NS.Tags.itemIn(pred.tag, item)) return false;
    }
    if (pred.enchantments) {
      for (var j = 0; j < pred.enchantments.length; j++) {
        var e = pred.enchantments[j];
        var lvl = L.enchantLevel(ctx, L.key(e.enchantment));
        var lv = e.levels;
        if (lv && typeof lv === 'object') {
          if (lv.min !== undefined && lvl < lv.min) return false;
          if (lv.max !== undefined && lvl > lv.max) return false;
        } else if (typeof lv === 'number' && lvl !== lv) return false;
        else if (!lv && lvl <= 0) return false;
      }
    }
    return true;
  }

  /**
   * The held tool's level of one enchantment. `ctx.enchants` is a plain object; the two
   * shorthands `ctx.silkTouch` and `ctx.fortune` exist because every caller in the game wants
   * exactly those two and nobody should have to spell `{ enchants: { fortune: 3 } }`.
   */
  L.enchantLevel = function (ctx, name) {
    if (ctx.enchants && ctx.enchants[name] !== undefined) return ctx.enchants[name] | 0;
    if (name === 'silk_touch') return ctx.silkTouch ? (ctx.silkTouch === true ? 1 : ctx.silkTouch | 0) : 0;
    if (name === 'fortune') return ctx.fortune | 0;
    if (name === 'looting') return ctx.looting | 0;
    return 0;
  };

  function condition(c, ctx, rng) {
    if (!c || !c.condition) return true;
    switch (L.key(c.condition)) {
      case 'survives_explosion':
        // vanilla: no explosion => always; otherwise a 1/radius coin per drop
        if (!(ctx.explosionRadius > 0)) return true;
        return rng.nextFloat() <= 1 / ctx.explosionRadius;
      case 'match_tool':
        return matchTool(c.predicate, ctx);
      case 'block_state_property': {
        if (c.block && ctx.blockName && L.key(c.block) !== ctx.blockName) return false;
        for (var k in (c.properties || {})) {
          if (String(stateProp(ctx, k)) !== String(c.properties[k])) return false;
        }
        return true;
      }
      case 'table_bonus': {
        // `chances` is indexed by enchantment level and CLAMPED at the end, which is how
        // Fortune V on gravel is still the Fortune III chance.
        var lvl = L.enchantLevel(ctx, L.key(c.enchantment));
        var ch = c.chances || [];
        var v = ch[Math.min(lvl, ch.length - 1)];
        return rng.nextFloat() < v;
      }
      case 'random_chance':
        return rng.nextFloat() < number(c.chance, rng);
      case 'alternative': {
        var terms = c.terms || [];
        for (var i = 0; i < terms.length; i++) if (condition(terms[i], ctx, rng)) return true;
        return terms.length === 0;
      }
      case 'inverted':
        return !condition(c.term, ctx, rng);
      case 'entity_properties': {
        // Every use in the block tables (snow, chorus_flower) is `{predicate: {}, entity: "this"}`.
        // ⚠ `{}` is NOT `EntityPredicate.ANY`: `fromJson({})` builds a NEW predicate, and its
        // `test` returns false for a null entity (.decomp EntityPredicate.java:137-141). So it means
        // "some entity broke this": melting snow (`SnowBlock.randomTick` -> 3-arg `dropStacks`, no
        // entity) and `/setblock|/fill ... destroy` (`breakBlock(pos, true)`) drop nothing. A caller
        // with no entity says so with `ctx.noEntity`; every other caller has one. G18d's entity tables
        // are the first real users of a non-empty predicate: `entity` picks WHICH side of the
        // kill to test (`this` the victim, `killer` whoever dealt the hit), and the two shapes
        // that appear are a `flags.is_on_fire` check (the burning-mob cooked-drop rule) and a
        // `type` tag check (a creeper's music disc, only when the killer is `#skeletons`).
        var subj = c.entity === 'killer' ? ctx.killer : ctx;
        var pred = c.predicate;
        if (!subj || (c.entity !== 'killer' && ctx.noEntity)) return false;
        if (!pred || Object.keys(pred).length === 0) return true;
        if (pred.flags && pred.flags.is_on_fire !== undefined) {
          if (!!subj.isOnFire !== !!pred.flags.is_on_fire) return false;
        }
        if (pred.fishing_hook && pred.fishing_hook.in_open_water !== undefined) {
          if (!!ctx.openWater !== !!pred.fishing_hook.in_open_water) return false;   // FishingHookPredicate
        }
        if (pred.type !== undefined) {
          var want = String(pred.type);
          var tag = want.charAt(0) === '#' ? want.slice(1).replace(/^minecraft:/, '') : null;
          if (tag) {
            var fam = (ctx.entityTypeTags && ctx.entityTypeTags[tag]) || ENTITY_TAGS[tag] || null;
            if (!fam || fam.indexOf(subj.type) < 0) return false;
          } else if (L.key(want) !== subj.type) return false;
        }
        return true;
      }
      case 'time_check': {
        // TimeCheckLootCondition: time of day, optionally `% period`, tested against a number or {min,max}
        var tm = ctx.dayTime !== undefined ? ctx.dayTime : (NS.Sky ? NS.Sky.dayTime : 0);
        if (c.period) tm = ((tm % c.period) + c.period) % c.period;
        var tv = c.value;
        if (tv && typeof tv === 'object' && (tv.min !== undefined || tv.max !== undefined)) {
          if (tv.min !== undefined && tm < number(tv.min, rng)) return false;
          if (tv.max !== undefined && tm > number(tv.max, rng)) return false;
          return true;
        }
        return tm === number(tv, rng);
      }
      case 'killed_by_player':
        return !!ctx.killedByPlayer;
      case 'random_chance_with_looting':
        return rng.nextFloat() < (number(c.chance, rng) + (ctx.looting || 0) * (c.looting_multiplier || 0));
      case 'damage_source_properties': {
        var dp = c.predicate || {};
        var src = ctx.damageSource || {};
        for (var dk in dp) if (!!src[dk] !== !!dp[dk]) return false;
        return true;
      }
      case 'location_check': {
        // The only users are tall_grass and large_fern, which check the OTHER half so a
        // two-block plant drops once rather than twice. Needs the world, so `ctx.blockNameAt`
        // supplies it; with no world the answer is NO, which drops nothing rather than double.
        if (c.predicate && c.predicate.biome !== undefined) return L.key(c.predicate.biome) === ctx.biome;   // fishing/junk bamboo
        var off = [c.offsetX | 0, c.offsetY | 0, c.offsetZ | 0];
        if (!ctx.blockNameAt) return false;
        var got = ctx.blockNameAt(off[0], off[1], off[2]);
        var bp = c.predicate && c.predicate.block;
        if (!bp) return true;
        if (bp.blocks) {
          var hit = false;
          for (var q = 0; q < bp.blocks.length; q++) if (L.key(bp.blocks[q]) === got) hit = true;
          if (!hit) return false;
        }
        if (bp.state) {
          if (!ctx.statePropAt) return false;
          for (var pk in bp.state) if (String(ctx.statePropAt(off[0], off[1], off[2], pk)) !== String(bp.state[pk])) return false;
        }
        return true;
      }
      default:
        return true;
    }
  }

  // Predicates are datapack content (1.18.2 ships none), so the registry starts empty:
  // `/execute if predicate <id>` resolves here. A predicate is one condition or a list of them (all must hold).
  var predicates = {};
  L.registerPredicate = function (id, json) { predicates[L.key(id)] = json; };
  L.clearPredicates = function () { predicates = {}; };
  L.hasPredicate = function (id) { return predicates[L.key(id)] !== undefined; };
  L.testPredicate = function (id, ctx) {
    var p = predicates[L.key(id)];
    if (p === undefined) return false;
    var c = ctx || {}, rng = c.rng || DEFAULT_RNG;
    return conditions(Array.isArray(p) ? p : [p], c, rng);
  };

  function conditions(list, ctx, rng) {
    if (!list) return true;
    for (var i = 0; i < list.length; i++) if (!condition(list[i], ctx, rng)) return false;
    return true;
  }

  // ── functions ─────────────────────────────────────────────────────────────────────────
  function applyFn(f, stack, ctx, rng) {
    if (!f || !f.function) return stack;
    if (!conditions(f.conditions, ctx, rng)) return stack;
    switch (L.key(f.function)) {
      case 'set_count': {
        var v = number(f.count, rng);
        // A count <= 0 makes the ItemStack EMPTY, and an empty stack's `getCount()` is 0 — so a
        // spider eye's `uniform(-1,1)` rolling -1 is 0 when `looting_enchant` then increments it.
        stack.count = Math.max(0, f.add ? stack.count + v : v);        return stack;
      }
      case 'apply_bonus': {
        var lvl = L.enchantLevel(ctx, L.key(f.enchantment));
        var form = L.key(f.formula), par = f.parameters || {};
        if (form === 'ore_drops') {
          // vanilla ApplyBonusCount.OreDrops: multiply by max(1, nextInt(level+2) - 1 + 1)
          var i = rng.nextInt(lvl + 2) - 1;
          if (i < 0) i = 0;
          stack.count = stack.count * (i + 1);
        } else if (form === 'uniform_bonus_count') {
          stack.count += rng.nextInt((par.bonusMultiplier || 1) * lvl + 1);
        } else if (form === 'binomial_with_bonus_count') {
          var n = (par.extra || 0) + lvl, p = par.probability || 0;
          for (var k = 0; k < n; k++) if (rng.nextFloat() < p) stack.count++;
        }
        return stack;
      }
      case 'explosion_decay': {
        if (!(ctx.explosionRadius > 0)) return stack;
        var chance = 1 / ctx.explosionRadius, kept = 0;
        for (var q = 0; q < stack.count; q++) if (rng.nextFloat() <= chance) kept++;
        stack.count = kept;
        return stack;
      }
      case 'limit_count': {
        var lim = f.limit || {};
        if (lim.min !== undefined) stack.count = Math.max(number(lim.min, rng), stack.count);
        if (lim.max !== undefined) stack.count = Math.min(number(lim.max, rng), stack.count);
        return stack;
      }
      // ── the three NBT writers. They change no count; PLAN G8 is where an inventory can
      //    finally read them, and until then they are recorded so nothing is silently lost.
      case 'copy_name':
        if (ctx.customName) (stack.nbt || (stack.nbt = {})).name = ctx.customName;
        return stack;
      case 'copy_state': {
        var props = f.properties || [];
        for (var pi = 0; pi < props.length; pi++) {
          var val = stateProp(ctx, props[pi]);
          if (val !== undefined) ((stack.nbt || (stack.nbt = {})).state || (stack.nbt.state = {}))[props[pi]] = val;
        }
        return stack;
      }
      case 'copy_nbt':
        if (ctx.blockEntity) (stack.nbt || (stack.nbt = {})).blockEntity = ctx.blockEntity;
        return stack;
      case 'set_contents':
        if (ctx.contents && ctx.contents.length) (stack.nbt || (stack.nbt = {})).contents = ctx.contents.slice();
        return stack;
      case 'looting_enchant': {
        // `LootingEnchantFunction.run` — a no-op at level <= 0, WITHOUT drawing from `rng`
        // (vanilla returns the stack untouched before it ever asks the number provider for a
        // value), so a 0-looting kill stays deterministic against the same seed.
        var lvl = ctx.looting || 0;
        if (!(lvl > 0)) return stack;
        var add = Math.round(lvl * numberF(f.count, rng));        stack.count = f.limit ? Math.min(f.limit, stack.count + add) : stack.count + add;
        return stack;
      }
      case 'furnace_smelt': {
        // `SmeltItemFunction` — runs the item through the furnace's own smelting recipe (a
        // burning mob's meat drop cooks itself). `conditions` on the function itself (an
        // `entity_properties{flags:{is_on_fire:true}}` in every table that uses this) already
        // gate the call through `applyFn`'s own `conditions()` check above, so by the time
        // this case runs the mob line is already confirmed on fire.
        var cooked = L.SMELTS[stack.item];
        if (cooked) stack.item = cooked;
        return stack;
      }
      case 'set_damage': {
        // SetDamageLootFunction: damage = floor((1 - uniform float) * maxDamage), never a full break.
        var IT = NS.Items, id = IT && IT.of ? IT.of(stack.item) : 0, mx = id && IT.durability ? IT.durability[id] : 0;
        var fr = numberF(f.damage, rng);
        if (mx) stack.d = Math.floor((1 - fr) * mx);
        return stack;
      }
      case 'enchant_with_levels': {
        // EnchantWithLevelsLootFunction: EnchantmentHelper.enchant(random, stack, levels, treasure).
        var EHl = NS.EnchHelper, picked = [];
        if (EHl && EHl.enchant) {
          var rf = function () { return rng.nextFloat(); };
          picked = EHl.enchant(rf, stack.item, null, number(f.levels, rng), !!f.treasure) || [];
        }
        if (stack.item === 'book' && picked.length) stack.item = 'enchanted_book';
        stack.ench = picked;
        return stack;
      }
      case 'set_potion':
        // Written as data, like `copy_name`/`copy_state`/`copy_nbt` above: nothing here can
        // DRINK or THROW a potion yet (that is the brewing/status-effect stage, G22), so the
        // effect id is recorded onto the stack rather than dropped on the floor.
        (stack.nbt || (stack.nbt = {})).potion = L.key(f.id);
        return stack;
      default:
        return stack;
    }
  }

  /**
   * The furnace's smelting result for a loot-table item — ONLY the entries `furnace_smelt`
   * actually needs (the burning-mob drops: beef, porkchop, mutton, chicken, potato, rabbit and
   * the fish the fishing table can hand a drowned/guardian). Vanilla asks the real recipe
   * manager; this is the same answer for the same finite set of loot-table inputs, named rather
   * than a general smelting-recipe lookup this stage does not need (07d_mining owns mining;
   * this is drops only).
   */
  L.SMELTS = {
    beef: 'cooked_beef', porkchop: 'cooked_porkchop', mutton: 'cooked_mutton',
    chicken: 'cooked_chicken', rabbit: 'cooked_rabbit', potato: 'baked_potato',
    cod: 'cooked_cod', salmon: 'cooked_salmon'
  };

  function applyAll(list, stack, ctx, rng) {
    if (!list) return stack;
    for (var i = 0; i < list.length; i++) stack = applyFn(list[i], stack, ctx, rng);
    return stack;
  }

  // ── entries ───────────────────────────────────────────────────────────────────────────
  /**
   * `skipTop` exists because the pool below has ALREADY evaluated this entry's own conditions to
   * decide its weight, and a condition may consume the generator — `gravel`'s flint is a
   * `table_bonus` roll. Evaluating it twice would draw two numbers where vanilla draws one, and
   * the second answer could differ from the first, which is a drop that depends on how many
   * times the interpreter happened to ask.
   */
  function expand(entry, ctx, rng, out, skipTop) {
    if (!entry) return false;
    if (!skipTop && !conditions(entry.conditions, ctx, rng)) return false;
    var type = L.key(entry.type || 'item');
    if (type === 'alternatives') {
      var kids = entry.children || [];
      for (var i = 0; i < kids.length; i++) {
        if (expand(kids[i], ctx, rng, out, false)) return true;
      }
      return false;
    }
    if (type === 'item') {
      var stack = { item: L.key(entry.name), count: 1, nbt: null };
      stack = applyAll(entry.functions, stack, ctx, rng);
      if (stack.count > 0) out.push(stack);
      return true;
    }
    if (type === 'dynamic') {
      // `minecraft:contents` — a shulker box drops what is inside it. Nothing here can invent
      // an inventory, so this emits what the caller handed over and nothing otherwise (G8).
      if (ctx.contents) for (var c = 0; c < ctx.contents.length; c++) out.push({ item: ctx.contents[c].item, count: ctx.contents[c].count, nbt: null });
      return true;
    }
    if (type === 'empty') {
      // `minecraft:empty` — a real weighted choice in the pool that is "nothing" (guardian's
      // second pool: prismarine crystals OR a fish OR nothing). Winning it means the pool
      // produces no stack this roll, which is a different thing from the entry failing its
      // conditions (that would let a LOWER-weight sibling try again; this does not).
      return true;
    }
    if (type === 'loot_table') {
      // `minecraft:loot_table` — a NESTED table reference (a colour of sheep deferring to the
      // shared `entities/sheep` table for its shears/breeding rows; a guardian's rare fish drop
      // pointing at `gameplay/fishing/fish`). Rolled with the SAME rng so the sequence stays
      // deterministic, and the entry's own `functions` (guardian's `furnace_smelt`) apply to
      // every stack the sub-table produced, exactly as a real entry's functions would.
      var sub = L.table(entry.name);
      if (!sub) return true;
      var nested = [];
      rollPools(sub, ctx, rng, nested);
      for (var ni = 0; ni < nested.length; ni++) out.push(applyAll(entry.functions, nested[ni], ctx, rng));
      return true;
    }
    if (type === 'item_choice') {
      // Pack-time rewrite of a `minecraft:tag{expand:true}` entry (creeper's music discs) into
      // a plain list of item names — see `pack-loot.mjs`'s `resolveTags`. Vanilla builds this as
      // one synthetic per-item choice and picks uniformly; `items.length` is always > 0 because
      // the packer only ever produces this from a non-empty tag file.
      var items = entry.items || [];
      var pick = items.length === 1 ? 0 : rng.nextInt(items.length);
      var tstack = { item: L.key(items[pick]), count: 1, nbt: null };
      tstack = applyAll(entry.functions, tstack, ctx, rng);
      if (tstack.count > 0) out.push(tstack);
      return true;
    }
    return false;
  }

  /**
   * `LootTable.getRandomItems` for a block. `ctx`:
   *   state / blockName    the block being broken (either; state gives property conditions)
   *   item                 the held item name, '' for a bare hand
   *   fortune / silkTouch  shorthands; or `enchants: {fortune: 3}`
   *   explosionRadius      set only when an explosion broke it
   *   rng                  a {nextFloat, nextInt}; `Loot.rng(seed)` makes a deterministic one
   *   blockNameAt/statePropAt/contents/customName/blockEntity   see the notes above
   * Returns an array of `{item, count, nbt}` — merged by item, because vanilla hands the player
   * ItemStacks and two pools of the same item are two stacks.
   */
  /**
   * One table's pools, rolled into `out` (raw stacks, table-level `functions` already applied,
   * NOT yet merged by item — `loot_table` entries need the unmerged form so a nested table's own
   * merge does not hide from the entry function wrapping it). Shared by `L.drops` (blocks),
   * `L.entityDrops` (G18d) and the `loot_table` entry case above, so a fix to the weighted-choice
   * or rolls arithmetic lands in every table kind at once rather than three times.
   */
  function rollPools(table, ctx, rng, out) {
    var c = ctx || {};
    var pools = table.pools || [];
    for (var i = 0; i < pools.length; i++) {
      var pool = pools[i];
      if (!conditions(pool.conditions, ctx, rng)) continue;
      var rolls = number(pool.rolls, rng) + Math.floor(number(pool.bonus_rolls, rng) * (c.luck || 0));
      // `LootPool.addGeneratedLoot` wraps its consumer in the POOL's own `functions` (sweet_berry_bush's
      // set_count + fortune live there, blockrefdropcheck), so a pool with any collects apart first.
      var dest = out;
      if (pool.functions) { out = []; }
      for (var r = 0; r < rolls; r++) {
        var entries = pool.entries || [];
        // Weighted choice across the pool's entries. Every block table has exactly one entry
        // per pool, so this is a straight line in practice — but a pool IS a weighted choice
        // and writing it as "take entries[0]" would be a bug waiting for the first table that
        // is not (guardian's fish-or-crystals-or-nothing pool is, and chest tables are too).
        var total = 0, k, w = [];
        for (k = 0; k < entries.length; k++) {
          if (!conditions(entries[k].conditions, ctx, rng)) { w.push(0); continue; }
          var weight = entries[k].weight === undefined ? 1 : entries[k].weight;
          // LootPoolEntry.getWeight(luck): max(floor(weight + quality * luck), 0)
          if (entries[k].quality) weight = Math.max(Math.floor(weight + entries[k].quality * (c.luck || 0)), 0);
          w.push(weight); total += weight;
        }
        if (total <= 0) continue;
        var pick = entries.length === 1 ? 0 : rng.nextInt(total), chosen = -1;
        for (k = 0; k < entries.length; k++) { pick -= w[k]; if (w[k] > 0 && pick < 0) { chosen = k; break; } }
        if (chosen < 0) continue;
        expand(entries[chosen], ctx, rng, out, true);
      }
      if (pool.functions) {
        for (var f = 0; f < out.length; f++) dest.push(applyAll(pool.functions, out[f], ctx, rng));
        out = dest;
      }
    }
    if (table.functions) for (var q = 0; q < out.length; q++) out[q] = applyAll(table.functions, out[q], ctx, rng);
    return out;
  }

  function mergeStacks(out) {
    var merged = [];
    for (var m = 0; m < out.length; m++) {
      if (out[m].count <= 0) continue;
      var found = null;
      for (var n = 0; n < merged.length; n++) if (merged[n].item === out[m].item && !merged[n].nbt && !out[m].nbt) found = merged[n];
      if (found) found.count += out[m].count; else merged.push(out[m]);
    }
    return merged;
  }

  L.drops = function (ctx) {
    var c = ctx || {};
    var rng = c.rng || DEFAULT_RNG;
    var name = c.blockName;
    if (!name && c.state !== undefined && NS.States && NS.States.ready) name = NS.Reg.names[NS.States.block[c.state]];
    if (!name) return [];
    c.blockName = name;
    var table = L.table(name);
    // ⚠ NO TABLE IS A REAL ANSWER, NOT A MISSING ONE. 65 of the 900 blocks have no loot table
    // file — air, the fluids, fire, the portal blocks, bedrock's neighbours in spirit — and
    // vanilla's answer for them is the empty list.
    if (!table) return [];
    return mergeStacks(rollPools(table, ctx, rng, []));
  };

  /**
   * `LivingEntity.dropFromLootTable` — G18d. `ctx`:
   *   type            the entity's bare type name ('cow', 'creeper', ...); the table is
   *                   `entities/<type>` exactly as vanilla names it
   *   killedByPlayer  true only when a player's own hit is what reduced health to 0
   *   killer          `{type: <bare type name>}` of whoever dealt the killing hit, or undefined
   *   isOnFire        the mob's burning flag at the moment it died (the cooked-drop rule)
   *   table           the table id when it is not `entities/<type>` (a sheep's colour table, `Cb.lootTableId`)
   *   looting         the Looting level of the killer's main hand (`Cb.lootingOf`)
   *   rng             as `L.drops`
   * Returns the same `{item, count, nbt}[]` shape as `L.drops`, or `[]` for a type with no table
   * (a handful of utility entities — armor stand, item frame — have none; that is correct).
   */
  L.entityDrops = function (ctx) {
    var c = ctx || {};
    if (!c.type) return [];
    var rng = c.rng || DEFAULT_RNG;
    var table = L.table(c.table || ('entities/' + c.type));    if (!table) return [];
    return mergeStacks(rollPools(table, ctx, rng, []));
  };

  /**
   * `LootTable.getRandomItems` for an arbitrary packed table NAME (not the `blocks`/`entities/`
   * convention `L.drops`/`L.entityDrops` each build for the caller) -- src/07zv7_vbgifts.js's
   * own `GiveGiftsToHeroTask` reads one of the 13 `gameplay/hero_of_the_village/<profession>_
   * gift` tables `tools/pack-loot.mjs` now packs by explicit path (the SAME one-off-path
   * convention that file's own `gameplay/fishing/fish` entry already uses), and nothing else in
   * this file's own `blocks`/`entities/` naming covers a `gameplay/` table. Factored out of
   * `L.drops`/`L.entityDrops` rather than copied a third time (D-202's own "one interpreter"
   * point applies just as much to the CALLER side as to the vocabulary itself). `ctx.rng` as
   * every other roll here.
   */
  L.rollTable = function (name, ctx) {
    var c = ctx || {};
    var rng = c.rng || DEFAULT_RNG;
    var table = L.table(name);
    if (!table) return [];
    return mergeStacks(rollPools(table, ctx, rng, []));
  };

  /**
   * `FishingBobberEntity.use` loot roll: `gameplay/fishing` with LootContext luck = Luck of the Sea level +
   * the player's luck attribute. `ctx`: luckOfTheSea, playerLuck (or a ready `luck`), openWater (the
   * fishing_hook is_open_water predicate; treasure needs it), biome, item (the rod), x/y/z, rng.
   */
  L.fish = function (ctx) {
    var c = {};
    for (var k in ctx) c[k] = ctx[k];
    if (c.luck === undefined) c.luck = Math.max(0, c.luckOfTheSea | 0) + (c.playerLuck || 0);
    c.isFishing = true;
    return L.rollTable('gameplay/fishing', c);
  };

  /**
   * What breaking this block with this tool actually gives the player — the one call the game
   * makes. It is `drops` plus the rule that lives OUTSIDE the tables: a block that requires a
   * correct tool and did not get one drops nothing at all, whatever its table says.
   */
  L.breakDrops = function (state, ctx) {
    var c = ctx || {};
    var S = NS.States;
    if (!S || !S.ready) return [];
    var block = S.block[state];
    if (NS.Mining && NS.Mining.ready && !NS.Mining.canHarvest(block, c.item)) return [];
    var d = { state: state, blockName: NS.Reg.names[block] };
    for (var k in c) d[k] = c[k];
    d.state = state;
    return L.drops(d);
  };
})(MCL);
