// 02h_recipes.js — PLAN G9. The 1,058 recipes, and the matcher that reads them.
//
// MAIN THREAD ONLY, and no DOM: a grid is an array of stacks, so every recipe in the game can be
// exercised inside `craftcheck` without a browser.
//
// ⚠ WHAT IS DATA AND WHAT IS NOT. 1,045 of 1,058 recipes are JSON in the jar and are read, never
// written — `tools/pack-recipes.mjs` packs them to 15.8 KB. The remaining THIRTEEN are
// `crafting_special_*`: files with a type and nothing else, whose whole content is a hard-coded
// Java class. Those are the functions at the bottom of this file, and `craftcheck` asserts that
// every name the packer found has one — a special that silently does nothing looks exactly like
// a special that was never implemented.
//
// ⚠ INGREDIENTS STAY AS TAG REFERENCES. `#minecraft:planks` is resolved through `Tags.items()` at
// match time rather than flattened into the blob, so the tag payload G1 already ships stays the
// single source of truth for what a plank is. The cost is one set lookup per ingredient test and
// it is paid on a 3x3 grid, not in a hot loop.
//
// ⚠ THE TWO MATCHERS ARE DIFFERENT ALGORITHMS AND BOTH ARE EASY TO GET WRONG:
//   shaped     every offset the recipe fits in the grid, MIRRORED and not, and every cell
//              OUTSIDE the recipe box must be empty. Dropping the mirror breaks every
//              left-handed player's muscle memory; dropping the outside test lets a stray item
//              in the corner craft a sword.
//   shapeless  a BIPARTITE MATCHING, not a greedy walk. With tag ingredients one input can
//              satisfy several ingredients, and greedy assignment fails on cases a correct
//              matching solves — so this does augmenting paths, which for a 3x3 grid is nine
//              nodes and costs nothing.

(function (NS) {
  'use strict';

  var R = NS.Recipes = {
    ready: false,
    SHAPED: 0, SHAPELESS: 1, SMELTING: 2, BLASTING: 3, SMOKING: 4, CAMPFIRE: 5,
    STONECUTTING: 6, SMITHING: 7, SPECIAL: 8,
    all: null,        // every recipe record
    ings: null,       // the ingredient alternative-sets
    byType: null,     // type code -> [recipe]
    specials: null    // name -> { matches, assemble }
  };

  var Inv = null;
  function inv() { return Inv || (Inv = NS.Inventory); }

  // ── decode ────────────────────────────────────────────────────────────────────────────────
  R.init = function (data) {
    if (!data || !data.recipes) { R.ready = false; return R; }
    // the same byte-to-char walk `07e_loot.js` uses: correct, and much faster than TextDecoder
    // at this size. The chunking is because `String.fromCharCode.apply` has an argument limit.
    var bytes = NS.Z.unpack(data.recipes, data.recipesBytes);
    var CH = 8192, parts = [];
    for (var b = 0; b < bytes.length; b += CH) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(b, Math.min(b + CH, bytes.length))));
    }
    var blob = JSON.parse(parts.join(''));
    R.ings = blob.ings;
    R.all = blob.r;
    R.byType = [];
    for (var t = 0; t <= 8; t++) R.byType[t] = [];
    for (var i = 0; i < R.all.length; i++) R.byType[R.all[i].t].push(R.all[i]);
    R.byId = Object.create(null);
    for (i = 0; i < R.all.length; i++) R.byId[R.all[i].id] = R.all[i];
    // D-269 — the furnace fuel map, out of the bytecode. It rides in this blob because a furnace
    // is a recipe machine; see the note in tools/pack-recipes.mjs.
    R.fuel = blob.fuel || null;
    // D-268: DyeColor's three per-colour numbers and FlowerBlock's effect map, both bytecode.
    R.dyes = blob.dyes || null;
    R.flowers = blob.flowers || null;
    ingCache = new Array(R.ings.length);
    R.ready = true;
    return R;
  };

  // ── ingredients ───────────────────────────────────────────────────────────────────────────
  var ingCache = null;
  /**
   * The item-index set an ingredient accepts, resolved once and cached. A tag alternative is
   * expanded through `Tags.items()` HERE rather than in the packer, so the tag blob stays the one
   * place that knows what `#minecraft:planks` means.
   */
  function ingSet(idx) {
    if (ingCache[idx]) return ingCache[idx];
    var IT = NS.Items, T = NS.Tags;
    var alts = R.ings[idx], out = Object.create(null), n = 0;
    for (var i = 0; i < alts.length; i++) {
      var a = alts[i];
      if (a.charCodeAt(0) === 35) {                        // '#'
        var list = (T && T.items) ? T.items(a.slice(1)) : [];
        for (var j = 0; j < list.length; j++) {
          var id = IT.of(String(list[j]).replace(/^minecraft:/, ''));
          if (id >= 0 && !out[id]) { out[id] = 1; n++; }
        }
      } else {
        var k = IT.of(a);
        if (k >= 0 && !out[k]) { out[k] = 1; n++; }
      }
    }
    out.__n = n;
    ingCache[idx] = out;
    return out;
  }
  R.ingredientSize = function (idx) { return ingSet(idx).__n; };

  /** Does this stack satisfy ingredient `idx`? ⚠ Ingredients ignore NBT — vanilla's do too. */
  R.ingredientMatches = function (idx, stack) {
    var I = inv();
    if (I.isEmpty(stack)) return false;
    return ingSet(idx)[stack.i] === 1;
  };

  // ── shaped ────────────────────────────────────────────────────────────────────────────────
  function shapedMatchesAt(rec, grid, gw, gh, ox, oy, mirror) {
    var I = inv();
    for (var y = 0; y < gh; y++) {
      for (var x = 0; x < gw; x++) {
        var rx = x - ox, ry = y - oy;
        var cell = grid[y * gw + x];
        if (rx < 0 || ry < 0 || rx >= rec.w || ry >= rec.h) {
          // ⚠ EVERY CELL OUTSIDE THE RECIPE BOX MUST BE EMPTY. Without this a sword plus a stray
          // cobblestone in the corner still crafts a sword.
          if (!I.isEmpty(cell)) return false;
          continue;
        }
        var ing = rec.k[ry * rec.w + (mirror ? (rec.w - rx - 1) : rx)];
        if (ing < 0) { if (!I.isEmpty(cell)) return false; continue; }
        if (!R.ingredientMatches(ing, cell)) return false;
      }
    }
    return true;
  }

  R.shapedMatches = function (rec, grid, gw, gh) {
    if (rec.w > gw || rec.h > gh) return false;
    for (var oy = 0; oy <= gh - rec.h; oy++) {
      for (var ox = 0; ox <= gw - rec.w; ox++) {
        if (shapedMatchesAt(rec, grid, gw, gh, ox, oy, false)) return true;
        if (shapedMatchesAt(rec, grid, gw, gh, ox, oy, true)) return true;
      }
    }
    return false;
  };

  // ── shapeless ─────────────────────────────────────────────────────────────────────────────
  /**
   * A maximum bipartite matching between the recipe's ingredients and the grid's non-empty
   * stacks. ⚠ A GREEDY WALK IS WRONG: give a recipe `[#planks, oak_planks]` and a grid holding
   * `[oak_planks, birch_planks]`, and greedy assigns oak to `#planks` first and then fails.
   * Augmenting paths cost nothing at this size and are simply correct.
   */
  R.shapelessMatches = function (rec, grid, gw, gh) {
    var I = inv();
    var items = [];
    for (var i = 0; i < grid.length; i++) if (!I.isEmpty(grid[i])) items.push(grid[i]);
    if (items.length !== rec.in.length) return false;

    var m = rec.in.length;
    var matchOf = new Array(items.length);
    for (i = 0; i < items.length; i++) matchOf[i] = -1;

    function tryAssign(ingIdx, seen) {
      for (var k = 0; k < items.length; k++) {
        if (seen[k]) continue;
        if (!R.ingredientMatches(rec.in[ingIdx], items[k])) continue;
        seen[k] = 1;
        if (matchOf[k] === -1 || tryAssign(matchOf[k], seen)) { matchOf[k] = ingIdx; return true; }
      }
      return false;
    }
    for (var a = 0; a < m; a++) {
      var seen = new Array(items.length);
      if (!tryAssign(a, seen)) return false;
    }
    return true;
  };

  // ── the crafting entry point ──────────────────────────────────────────────────────────────
  /**
   * craft(grid, w, h, player) -> the RESULT stack, or EMPTY.
   * `grid` is w*h stacks, row-major, EMPTY for a blank cell. The result is a fresh stack; nothing
   * is consumed. ⚠ Specials are tried FIRST, because several of them (repairitem, shulkerbox
   * colouring) would otherwise be shadowed by nothing at all and simply never fire.
   */
  R.craft = function (grid, w, h, player) {
    var I = inv();
    if (!R.ready) return I.EMPTY;
    var i, rec;
    var sp = R.byType[R.SPECIAL];
    for (i = 0; i < sp.length; i++) {
      var fn = R.specials[sp[i].s];
      if (fn && fn.matches(grid, w, h)) {
        var out = fn.assemble(grid, w, h);
        if (!I.isEmpty(out)) return out;
      }
    }
    var shaped = R.byType[R.SHAPED];
    for (i = 0; i < shaped.length; i++) {
      rec = shaped[i];
      if (R.shapedMatches(rec, grid, w, h)) return I.stack(rec.r.i, rec.r.n);
    }
    var less = R.byType[R.SHAPELESS];
    for (i = 0; i < less.length; i++) {
      rec = less[i];
      if (R.shapelessMatches(rec, grid, w, h)) return I.stack(rec.r.i, rec.r.n);
    }
    return I.EMPTY;
  };

  /** Which recipe a grid matches, for the recipe book and for tests that want the id. */
  R.craftingRecipeFor = function (grid, w, h) {
    if (!R.ready) return null;
    var i, sp = R.byType[R.SPECIAL];
    for (i = 0; i < sp.length; i++) {
      var fn = R.specials[sp[i].s];
      if (fn && fn.matches(grid, w, h)) return sp[i];
    }
    var shaped = R.byType[R.SHAPED];
    for (i = 0; i < shaped.length; i++) if (R.shapedMatches(shaped[i], grid, w, h)) return shaped[i];
    var less = R.byType[R.SHAPELESS];
    for (i = 0; i < less.length; i++) if (R.shapelessMatches(less[i], grid, w, h)) return less[i];
    return null;
  };

  // ── the single-ingredient families ────────────────────────────────────────────────────────
  /** Smelting and its three faster cousins. `type` is one of SMELTING/BLASTING/SMOKING/CAMPFIRE. */
  R.cookingFor = function (stack, type) {
    if (!R.ready) return null;
    var list = R.byType[type];
    for (var i = 0; i < list.length; i++) {
      if (R.ingredientMatches(list[i].in[0], stack)) {
        return { id: list[i].id, result: inv().stack(list[i].r.i, list[i].r.n), time: list[i].c, xp: list[i].x };
      }
    }
    return null;
  };
  /** ⚠ Vanilla falls back to the SMELTING recipe for a blast furnace only through the tag on the
   *  recipe itself — there is no inheritance. So a blasting lookup that misses really is a miss. */
  R.smeltingFor = function (stack) { return R.cookingFor(stack, R.SMELTING); };

  /** Every stonecutter output for this input, in registry order — the stonecutter shows a list. */
  R.stonecuttingFor = function (stack) {
    if (!R.ready) return [];
    var out = [], list = R.byType[R.STONECUTTING];
    for (var i = 0; i < list.length; i++) {
      if (R.ingredientMatches(list[i].in[0], stack)) {
        out.push({ id: list[i].id, result: inv().stack(list[i].r.i, list[i].r.n) });
      }
    }
    return out;
  };

  /** Smithing: a base item plus an addition. ⚠ The result KEEPS the base's tag and damage. */
  R.smithingFor = function (base, addition) {
    if (!R.ready) return null;
    var I = inv(), list = R.byType[R.SMITHING];
    for (var i = 0; i < list.length; i++) {
      var rec = list[i];
      if (!R.ingredientMatches(rec.in[0], base)) continue;
      if (!R.ingredientMatches(rec.in[1], addition)) continue;
      var out = I.stack(rec.r.i, rec.r.n, base.d);
      var tag = I.tagOf(base);
      if (tag) out = I.withTag(out, tag);
      return { id: rec.id, result: out };
    }
    return null;
  };

  // ── fuel ──────────────────────────────────────────────────────────────────────────────────
  /**
   * How many ticks this stack burns for, or 0 (D-269). ⚠ The table is COMPILED JAVA in vanilla —
   * `AbstractFurnaceBlockEntity.getFuel()` — and arrives through `tools/extract-fuel.mjs`, not
   * from memory. ⚠ The ITEM is asked first and the TAGS second, which is vanilla's order and
   * matters: `dried_kelp_block` burns for 4001 ticks, one more than the round number anybody
   * writing the table by hand would have put there, and a tag lookup would never reach it.
   */
  R.fuel = null;
  R.fuelTime = function (stack) {
    var I = inv();
    if (I.isEmpty(stack) || !R.fuel) return 0;
    var IT = NS.Items, T = NS.Tags;
    var name = IT.nameOf(stack.i);
    // vanilla's order: an exact item row wins first...
    if (R.fuel.items[name] !== undefined) return R.fuel.items[name];
    // ⚠⚠ ...then the EXCLUSION, and only then the tags (D-269). `getFuel`'s tag helper skips
    // every item in `#minecraft:non_flammable_wood`, which is why crimson and warped planks are
    // members of `#planks` and still burn for nothing. Checking the tags first would make the
    // whole nether wood family fuel, and no count of anything would notice.
    if (R.fuel.exclude && T && T.itemIn && T.itemIn(R.fuel.exclude, name)) return 0;
    var tags = R.fuel.tagNames;
    for (var i = 0; i < tags.length; i++) {
      if (T && T.itemIn && T.itemIn(tags[i], name)) return R.fuel.tags[tags[i]];
    }
    return 0;
  };
  R.isFuel = function (stack) { return R.fuelTime(stack) > 0; };

  // ── the thirteen specials ─────────────────────────────────────────────────────────────────
  // Each is `{ matches(grid, w, h), assemble(grid, w, h) }`, exactly vanilla's pair. They are
  // registered by the NAME the packer read out of the recipe file, so the two cannot drift.
  var S = R.specials = Object.create(null);

  function cells(grid) {
    var I = inv(), out = [];
    for (var i = 0; i < grid.length; i++) if (!I.isEmpty(grid[i])) out.push(grid[i]);
    return out;
  }
  function nameOf(s) { return inv().isEmpty(s) ? '' : NS.Items.nameOf(s.i); }
  function countOf(list, pred) { var n = 0; for (var i = 0; i < list.length; i++) if (pred(list[i])) n++; return n; }
  function firstOf(list, pred) { for (var i = 0; i < list.length; i++) if (pred(list[i])) return list[i]; return null; }
  var isDye = function (s) { var n = nameOf(s); return n.length > 4 && n.slice(-4) === '_dye'; };
  var dyeColour = function (s) { var n = nameOf(s); return n.slice(0, n.length - 4); };
  var isBanner = function (s) { var n = nameOf(s); return n.length > 7 && n.slice(-7) === '_banner'; };
  var isShulker = function (s) {
    var n = nameOf(s);
    return n === 'shulker_box' || (n.length > 12 && n.slice(-12) === '_shulker_box');
  };
  var isLeather = function (s) {
    var n = nameOf(s);
    return n === 'leather_helmet' || n === 'leather_chestplate' || n === 'leather_leggings'
        || n === 'leather_boots' || n === 'leather_horse_armor';
  };
  /** A stack that can take damage — `ItemStack.isDamageableItem`. */
  function damageable(s) {
    if (inv().isEmpty(s)) return false;
    var dur = NS.Items.durability[s.i];
    return !!dur;
  }

  // 1. repairitem — two damaged items of the same type, plus 5% of the maximum
  S.repairitem = {
    matches: function (grid) {
      var c = cells(grid), I = inv();
      if (c.length !== 2) return false;
      if (c[0].i !== c[1].i) return false;
      if (c[0].n !== 1 || c[1].n !== 1) return false;
      return damageable(c[0]) && damageable(c[1]) && !I.hasTag(c[0]) && !I.hasTag(c[1]);
    },
    assemble: function (grid) {
      var c = cells(grid), I = inv();
      var max = NS.Items.durability[c[0].i];
      // vanilla: `max - ((max - dA) + (max - dB) + max * 5 / 100)` clamped at 0
      var left = (max - c[0].d) + (max - c[1].d) + ((max * 5 / 100) | 0);
      var dmg = max - left;
      if (dmg < 0) dmg = 0;
      return I.stack(c[0].i, 1, dmg);
    }
  };

  // 2. bookcloning — one written book plus 1..8 blank books, all copies one generation on
  S.bookcloning = {
    matches: function (grid) {
      var c = cells(grid);
      if (c.length < 2) return false;
      var written = null, blanks = 0;
      for (var i = 0; i < c.length; i++) {
        var n = nameOf(c[i]);
        if (n === 'written_book') { if (written || c[i].n !== 1) return false; written = c[i]; }
        else if (n === 'writable_book') { if (c[i].n !== 1) return false; blanks++; }
        else return false;
      }
      if (!written || !blanks) return false;
      // ⚠ generation 2 is a COPY OF A COPY and cannot be copied again.
      var g = (inv().tagOf(written) || {}).generation | 0;
      return g === 0 || g === 1;
    },
    assemble: function (grid) {
      var c = cells(grid), I = inv();
      var written = firstOf(c, function (s) { return nameOf(s) === 'written_book'; });
      var blanks = countOf(c, function (s) { return nameOf(s) === 'writable_book'; });
      var tag = I.cloneTag(I.tagOf(written) || {});
      tag.generation = ((tag.generation | 0) + 1);
      var out = I.stack('written_book', blanks, 0);
      return I.withTag(out, tag);
    }
  };

  // 3. mapcloning — one filled map plus 1..8 empty maps
  S.mapcloning = {
    matches: function (grid) {
      var c = cells(grid);
      if (c.length < 2) return false;
      var filled = 0, empty = 0;
      for (var i = 0; i < c.length; i++) {
        var n = nameOf(c[i]);
        if (n === 'filled_map') { if (c[i].n !== 1) return false; filled++; }
        else if (n === 'map') empty++;
        else return false;
      }
      return filled === 1 && empty >= 1;
    },
    assemble: function (grid) {
      var c = cells(grid), I = inv();
      var filled = firstOf(c, function (s) { return nameOf(s) === 'filled_map'; });
      var n = 0;
      for (var i = 0; i < c.length; i++) if (nameOf(c[i]) === 'map') n += c[i].n;
      var out = I.stack('filled_map', n + 1, filled.d);
      return I.withTag(out, I.tagOf(filled));
    }
  };

  // 4. mapextending — a filled map at the centre, eight paper around it
  S.mapextending = {
    matches: function (grid, w, h) {
      var I = inv();
      if (w !== 3 || h !== 3) return false;
      for (var y = 0; y < 3; y++) {
        for (var x = 0; x < 3; x++) {
          var s = grid[y * 3 + x];
          if (x === 1 && y === 1) {
            if (I.isEmpty(s) || nameOf(s) !== 'filled_map') return false;
            var sc = (I.tagOf(s) || {}).map_scale_direction;
            if (((I.tagOf(s) || {}).scale | 0) >= 4) return false;
            if (sc !== undefined && sc !== null) return false;
          } else if (I.isEmpty(s) || nameOf(s) !== 'paper') return false;
        }
      }
      return true;
    },
    assemble: function (grid) {
      var I = inv();
      var map = grid[4];
      var tag = I.cloneTag(I.tagOf(map) || {});
      tag.scale = (tag.scale | 0) + 1;
      return I.withTag(I.stack('filled_map', 1, map.d), tag);
    }
  };

  // 5. bannerduplicate — a patterned banner plus a blank one of the SAME colour
  S.bannerduplicate = {
    matches: function (grid) {
      var c = cells(grid), I = inv();
      if (c.length !== 2) return false;
      if (!isBanner(c[0]) || !isBanner(c[1])) return false;
      if (c[0].i !== c[1].i) return false;
      var a = patternsOf(c[0]), b = patternsOf(c[1]);
      return (a.length > 0 && b.length === 0) || (b.length > 0 && a.length === 0);
    },
    assemble: function (grid) {
      var c = cells(grid), I = inv();
      var src = patternsOf(c[0]).length ? c[0] : c[1];
      return I.withTag(I.stack(src.i, 1, 0), I.tagOf(src));
    }
  };
  function patternsOf(s) {
    var t = inv().tagOf(s);
    if (!t || !t.BlockEntityTag || !t.BlockEntityTag.Patterns) return [];
    return t.BlockEntityTag.Patterns;
  }

  // 6. shielddecoration — a plain shield plus a banner
  S.shielddecoration = {
    matches: function (grid) {
      var c = cells(grid), I = inv();
      if (c.length !== 2) return false;
      var shield = firstOf(c, function (s) { return nameOf(s) === 'shield'; });
      var banner = firstOf(c, isBanner);
      if (!shield || !banner) return false;
      var t = I.tagOf(shield);
      return !(t && t.BlockEntityTag);
    },
    assemble: function (grid) {
      var c = cells(grid), I = inv();
      var shield = firstOf(c, function (s) { return nameOf(s) === 'shield'; });
      var banner = firstOf(c, isBanner);
      var bt = I.cloneTag((I.tagOf(banner) || {}).BlockEntityTag || {});
      // the banner's base colour comes from its ITEM, not from its tag
      bt.Base = bannerColourIndex(nameOf(banner));
      var tag = I.cloneTag(I.tagOf(shield) || {});
      tag.BlockEntityTag = bt;
      return I.withTag(I.stack('shield', 1, shield.d), tag);
    }
  };

  // 7. shulkerboxcoloring — a shulker box plus one dye, keeping its contents
  S.shulkerboxcoloring = {
    matches: function (grid) {
      var c = cells(grid);
      if (c.length !== 2) return false;
      var box = firstOf(c, isShulker), dye = firstOf(c, isDye);
      return !!box && !!dye;
    },
    assemble: function (grid) {
      var c = cells(grid), I = inv();
      var box = firstOf(c, isShulker), dye = firstOf(c, isDye);
      var out = I.stack(dyeColour(dye) + '_shulker_box', 1, 0);
      if (I.isEmpty(out)) return I.EMPTY;
      // ⚠ THE CONTENTS TRAVEL. Dyeing a full shulker box in vanilla keeps everything in it, and
      // a clone that rebuilds the item from its name alone quietly eats a chest of diamonds.
      return I.withTag(out, I.tagOf(box));
    }
  };

  // 8. tippedarrow — eight arrows around one lingering potion
  S.tippedarrow = {
    matches: function (grid, w, h) {
      var I = inv();
      if (w !== 3 || h !== 3) return false;
      for (var y = 0; y < 3; y++) {
        for (var x = 0; x < 3; x++) {
          var s = grid[y * 3 + x];
          if (I.isEmpty(s)) return false;
          if (x === 1 && y === 1) { if (nameOf(s) !== 'lingering_potion') return false; }
          else if (nameOf(s) !== 'arrow') return false;
        }
      }
      return true;
    },
    assemble: function (grid) {
      var I = inv();
      var potion = grid[4];
      var tag = I.cloneTag(I.tagOf(potion) || {});
      return I.withTag(I.stack('tipped_arrow', 8, 0), tag);
    }
  };

  // ── the five that needed the colour tables (D-268) ───────────────────────────────────────
  // ⚠ These were shipped UNAVAILABLE for an hour rather than approximated, because inventing
  // sixteen RGB values that look about right is the D-263 mistake wearing a new hat. They are
  // live now because `tools/extract-colours.mjs` read `DyeColor` and `FlowerBlock` out of the
  // bytecode. ⚠ THE FIREWORK COLOUR IS NOT THE DIFFUSE COLOUR — white is 0xF0F0F0 against
  // 0xF9FFFE — which is why `armordye` and `firework_star` read different columns of one table.
  R.UNAVAILABLE = [];
  var dyeOf = function (s) {
    if (!R.dyes) return null;
    var n = nameOf(s);
    if (!(n.length > 4 && n.slice(-4) === '_dye')) return null;
    return R.dyes[n.slice(0, n.length - 4)] || null;
  };

  // 9. armordye — vanilla's `DyeableLeatherItem.dyeArmor`, arithmetic and all
  S.armordye = {
    matches: function (grid) {
      var c = cells(grid);
      if (c.length < 2 || !R.dyes) return false;
      var armour = 0, dyes = 0;
      for (var i = 0; i < c.length; i++) {
        if (isLeather(c[i])) { if (c[i].n !== 1) return false; armour++; }
        else if (dyeOf(c[i])) dyes++;
        else return false;
      }
      return armour === 1 && dyes >= 1;
    },
    assemble: function (grid) {
      var c = cells(grid), I = inv();
      var armour = firstOf(c, isLeather);
      // ⚠ THE BLEND IS NOT AN AVERAGE. Vanilla sums the components AND the per-colour maximum,
      // divides both by the count, then rescales the mean so its own largest component equals
      // the mean maximum — which is what keeps a mix of dyes bright instead of muddy grey.
      var r = 0, g = 0, b = 0, total = 0, n = 0;
      var tag = I.cloneTag(I.tagOf(armour) || {});
      if (tag.display && tag.display.color !== undefined) {
        var cur = tag.display.color | 0;
        var cr = (cur >> 16) & 255, cg = (cur >> 8) & 255, cb = cur & 255;
        total += Math.max(cr, Math.max(cg, cb));
        r += cr; g += cg; b += cb; n++;
      }
      for (var i = 0; i < c.length; i++) {
        var d = dyeOf(c[i]);
        if (!d) continue;
        var v = d.diffuse | 0;
        var vr = (v >> 16) & 255, vg = (v >> 8) & 255, vb = v & 255;
        total += Math.max(vr, Math.max(vg, vb));
        r += vr; g += vg; b += vb; n++;
      }
      if (!n) return I.EMPTY;
      r = (r / n) | 0; g = (g / n) | 0; b = (b / n) | 0;
      var mean = total / n;
      var mx = Math.max(r, Math.max(g, b));
      if (mx > 0) { r = (r * mean / mx) | 0; g = (g * mean / mx) | 0; b = (b * mean / mx) | 0; }
      if (!tag.display) tag.display = {};
      tag.display.color = (r << 16) | (g << 8) | b;
      return I.withTag(I.stack(armour.i, 1, armour.d), tag);
    }
  };

  // 10. firework_star
  // The shape modifiers, by the item vanilla names: 1 large ball, 2 star, 3 creeper, 4 burst.
  // Default 0, a small ball. `_head`/`_skull` covers the six skulls vanilla accepts as a creeper.
  function starShape(s) {
    var n = nameOf(s);
    if (n === 'fire_charge') return 1;
    if (n === 'gold_nugget') return 2;
    if (n === 'feather') return 4;
    if (n.length > 5 && (n.slice(-5) === '_head' || n.slice(-6) === '_skull')) return 3;
    return -1;
  }
  S.firework_star = {
    matches: function (grid) {
      var c = cells(grid);
      if (c.length < 2 || !R.dyes) return false;
      var powder = 0, dyes = 0, shape = 0, flicker = 0, trail = 0;
      for (var i = 0; i < c.length; i++) {
        var n = nameOf(c[i]);
        if (n === 'gunpowder') powder++;
        else if (dyeOf(c[i])) dyes++;
        else if (n === 'glowstone_dust') flicker++;
        else if (n === 'diamond') trail++;
        else if (starShape(c[i]) >= 0) shape++;
        else return false;
      }
      return powder === 1 && dyes >= 1 && shape <= 1 && flicker <= 1 && trail <= 1;
    },
    assemble: function (grid) {
      var c = cells(grid), I = inv();
      var colours = [], shape = 0, flicker = false, trail = false;
      for (var i = 0; i < c.length; i++) {
        var d = dyeOf(c[i]), n = nameOf(c[i]);
        if (d) { colours.push(d.firework | 0); continue; }       // ⚠ the FIREWORK column
        if (n === 'glowstone_dust') { flicker = true; continue; }
        if (n === 'diamond') { trail = true; continue; }
        var sh = starShape(c[i]);
        if (sh >= 0) shape = sh;
      }
      var ex = { Type: shape, Colors: colours };
      if (flicker) ex.Flicker = 1;
      if (trail) ex.Trail = 1;
      return I.withTag(I.stack('firework_star', 1, 0), { Explosion: ex });
    }
  };

  // 11. firework_star_fade — a star plus dyes gains FadeColors
  S.firework_star_fade = {
    matches: function (grid) {
      var c = cells(grid);
      if (c.length < 2 || !R.dyes) return false;
      var star = 0, dyes = 0;
      for (var i = 0; i < c.length; i++) {
        if (nameOf(c[i]) === 'firework_star') { if (c[i].n !== 1) return false; star++; }
        else if (dyeOf(c[i])) dyes++;
        else return false;
      }
      return star === 1 && dyes >= 1;
    },
    assemble: function (grid) {
      var c = cells(grid), I = inv();
      var star = firstOf(c, function (s) { return nameOf(s) === 'firework_star'; });
      var fade = [];
      for (var i = 0; i < c.length; i++) {
        var d = dyeOf(c[i]);
        if (d) fade.push(d.firework | 0);
      }
      var tag = I.cloneTag(I.tagOf(star) || {});
      if (!tag.Explosion) tag.Explosion = { Type: 0, Colors: [] };
      tag.Explosion.FadeColors = fade;
      return I.withTag(I.stack('firework_star', 1, 0), tag);
    }
  };

  // 12. firework_rocket — paper, 1..3 gunpowder for the flight duration, 0..7 stars
  S.firework_rocket = {
    matches: function (grid) {
      var c = cells(grid);
      if (c.length < 2) return false;
      var paper = 0, powder = 0, stars = 0;
      for (var i = 0; i < c.length; i++) {
        var n = nameOf(c[i]);
        if (n === 'paper') paper++;
        else if (n === 'gunpowder') powder++;
        else if (n === 'firework_star') stars++;
        else return false;
      }
      return paper === 1 && powder >= 1 && powder <= 3;
    },
    assemble: function (grid) {
      var c = cells(grid), I = inv();
      var powder = 0, explosions = [];
      for (var i = 0; i < c.length; i++) {
        var n = nameOf(c[i]);
        if (n === 'gunpowder') powder++;
        else if (n === 'firework_star') {
          var t = I.tagOf(c[i]);
          if (t && t.Explosion) explosions.push(I.cloneTag(t.Explosion));
        }
      }
      var fw = { Flight: powder };
      if (explosions.length) fw.Explosions = explosions;
      // ⚠ THREE rockets, not one. The recipe's own result count is 3, and it is the one special
      // whose output is a stack rather than a single item.
      return I.withTag(I.stack('firework_rocket', 3, 0), { Fireworks: fw });
    }
  };

  // 13. suspiciousstew — the flower decides the effect, and the table is bytecode
  S.suspiciousstew = {
    matches: function (grid) {
      var c = cells(grid);
      if (c.length !== 4 || !R.flowers) return false;
      var red = 0, brown = 0, bowl = 0, flower = 0;
      for (var i = 0; i < c.length; i++) {
        var n = nameOf(c[i]);
        if (n === 'red_mushroom') red++;
        else if (n === 'brown_mushroom') brown++;
        else if (n === 'bowl') bowl++;
        else if (R.flowers[n]) flower++;
        else return false;
      }
      return red === 1 && brown === 1 && bowl === 1 && flower === 1;
    },
    assemble: function (grid) {
      var c = cells(grid), I = inv();
      var f = null;
      for (var i = 0; i < c.length; i++) {
        var e = R.flowers[nameOf(c[i])];
        if (e) { f = e; break; }
      }
      if (!f) return I.EMPTY;
      // ⚠ THE BYTECODE HOLDS SECONDS; `SuspiciousStewItem` multiplies by 20 when it is eaten. The
      // tag carries TICKS, so the conversion happens once, here, rather than at every meal.
      return I.withTag(I.stack('suspicious_stew', 1, 0),
        { Effects: [{ EffectId: f.id, EffectDuration: f.ticks }] });
    }
  };

  /** The 16 dye colours, in vanilla's own order, derived from the ITEM REGISTRY, not written. */
  R.dyeNames = function () {
    var IT = NS.Items, out = [];
    for (var i = 0; i < IT.count; i++) {
      var n = IT.names[i];
      if (n.length > 4 && n.slice(-4) === '_dye') out.push(n.slice(0, n.length - 4));
    }
    return out;
  };
  function bannerColourIndex(itemName) {
    var colour = itemName.slice(0, itemName.length - 7);
    var order = R.dyeNames();
    var k = order.indexOf(colour);
    return k < 0 ? 0 : k;
  }
  R.bannerColourIndex = bannerColourIndex;
})(MCL);
