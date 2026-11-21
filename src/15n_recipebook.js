// MC-Lite — #11390: the recipe book screen's MODEL (pure, no DOM). Ports RecipeBookResults paging, RecipeResultCollection
// craftable/fitting sets, RecipeBookWidget.refreshResults (filter chain + search) and RecipeGridAligner (where a clicked
// recipe's ghost ingredients land in the grid). recipebookcheck compares each with the .decomp source.
(function (NS) {
  'use strict';
  var RB = NS.RecipeBookUI = {};
  RB.PAGE_SIZE = 20;                 // RecipeBookResults: 20 result buttons per page
  RB.SEARCH_MAX = 50;                // RecipeBookWidget: searchField.setMaxLength(50)

  /** RecipeBookWidget.getTabsLeft/Top geometry that matters to hit tests: the book is 147 wide, 166 tall. */
  RB.W = 147; RB.H = 166;

  /** Recipe.fits(w, h): shaped needs the box, shapeless needs enough cells. */
  RB.fits = function (rec, w, h) {
    var R = NS.Recipes;
    if (rec.t === R.SHAPED) return w >= rec.w && h >= rec.h;
    if (rec.t === R.SHAPELESS) return w * h >= rec.in.length;
    return true;
  };

  /** new RecipeResultCollection(list): recipes in order; unlocked/craftable/fitting are computed against a book. */
  RB.collection = function (recipes, outputKey) {
    var c = { recipes: recipes.slice(), craftable: Object.create(null), fitting: Object.create(null), unlocked: Object.create(null), nUnlocked: 0 };
    var single = true;
    for (var i = 1; i < recipes.length; i++) if (outputKey(recipes[i]) !== outputKey(recipes[0])) single = false;
    c.singleOutput = single;
    return c;
  };
  /** initialize(book): mark which recipes the player's book holds. */
  RB.initialize = function (c, book) {
    for (var i = 0; i < c.recipes.length; i++) if (book.has(c.recipes[i].id) && !c.unlocked[c.recipes[i].id]) { c.unlocked[c.recipes[i].id] = true; c.nUnlocked++; }
  };
  RB.isInitialized = function (c) { return c.nUnlocked > 0; };
  /** computeCraftables(matcher, w, h, book): fitting = fits && inBook; craftable = fitting && matcher(recipe). */
  RB.computeCraftables = function (c, canMake, w, h, book) {
    for (var i = 0; i < c.recipes.length; i++) {
      var r = c.recipes[i], f = RB.fits(r, w, h) && book.has(r.id);
      if (f) c.fitting[r.id] = true; else delete c.fitting[r.id];
      if (f && canMake(r)) c.craftable[r.id] = true; else delete c.craftable[r.id];
    }
  };
  RB.hasFitting = function (c) { for (var k in c.fitting) return true; return false; };
  RB.hasCraftable = function (c) { for (var k in c.craftable) return true; return false; };

  /**
   * RecipeBookWidget.refreshResults: collections of the current tab -> drop uninitialised, drop non-fitting,
   * keep search hits (search = lower-cased text; `matchesSearch(c, text)` stands in for the RECIPE_OUTPUT index),
   * and with the craftable toggle on keep only collections with a craftable recipe.
   */
  RB.refreshResults = function (cols, book, canMake, w, h, search, filterCraftable, matchesSearch) {
    var out = [], i;
    for (i = 0; i < cols.length; i++) RB.computeCraftables(cols[i], canMake, w, h, book);
    for (i = 0; i < cols.length; i++) { if (!RB.isInitialized(cols[i])) RB.initialize(cols[i], book); }
    for (i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (!RB.isInitialized(c) || !RB.hasFitting(c)) continue;
      if (search && search.length && !matchesSearch(c, search.toLowerCase())) continue;
      if (filterCraftable && !RB.hasCraftable(c)) continue;
      out.push(c);
    }
    return out;
  };

  /** RecipeBookResults: page state. setResults(list, resetPage); next/prev button visibility; the "n/m" label. */
  RB.pages = function () { return { cols: [], pageCount: 0, page: 0 }; };
  RB.setResults = function (p, cols, reset) {
    p.cols = cols;
    p.pageCount = Math.ceil(cols.length / RB.PAGE_SIZE);
    if (p.pageCount <= p.page || reset) p.page = 0;
  };
  RB.pageItems = function (p) { return p.cols.slice(p.page * RB.PAGE_SIZE, p.page * RB.PAGE_SIZE + RB.PAGE_SIZE); };
  RB.nextVisible = function (p) { return p.pageCount > 1 && p.page < p.pageCount - 1; };
  RB.prevVisible = function (p) { return p.pageCount > 1 && p.page > 0; };
  RB.next = function (p) { if (RB.nextVisible(p)) p.page++; };
  RB.prev = function (p) { if (RB.prevVisible(p)) p.page--; };
  RB.pageLabel = function (p) { return p.pageCount > 1 ? (p.page + 1) + '/' + p.pageCount : ''; };

  /** The text field: max 50 chars, matched lower-case. */
  RB.clampSearch = function (s) { return String(s).slice(0, RB.SEARCH_MAX); };

  /**
   * RecipeGridAligner.alignRecipeToGrid(gw, gh, resultSlot, recipe, ingredients, ...): the handler slot id each
   * ingredient lands in (ingredient list = shaped k[] with -1 for empty cells, shapeless in[]). Returns [{slot, ing}];
   * a slot at or past the result slot index is shifted by one, exactly as vanilla's counter does.
   */
  RB.alignRecipeToGrid = function (gw, gh, resultSlot, rec, ings) {
    var R = NS.Recipes, out = [], rw = gw, rh = gh, it = 0, s = 0, y, x, a, b, cond;
    if (rec.t === R.SHAPED) { rw = rec.w; rh = rec.h; }
    for (y = 0; y < gh; y++) {
      if (s === resultSlot) s++;
      cond = rh < gh / 2;
      a = Math.floor(gh / 2 - rh / 2);
      if (cond && a > y) { s += gw; y++; }
      for (x = 0; x < gw; x++) {
        if (it >= ings.length) return out;
        cond = rw < gw / 2;
        a = Math.floor(gw / 2 - rw / 2);
        var edge = rw, inside = x < rw;
        if (cond) { edge = a + rw; inside = a <= x && x < a + rw; }
        if (inside) out.push({ slot: s, ing: ings[it++] });
        else if (edge === x) { s += gw - x; break; }
        s++;
      }
    }
    return out;
  };
  // ── the screen: collections, layout, click/key handling, the InputSlotFiller (server side of clickRecipe) ───────────
  /** RecipeBookGroup.CRAFTING_*: search first (all), then equipment, building blocks, misc, redstone (tab order). */
  RB.TABS = ['search', 'equipment', 'building', 'misc', 'redstone'];
  RB.TAB_LANG = { search: 'itemGroup.search', equipment: 'recipe.group.equipment', building: 'recipe.group.building', misc: 'recipe.group.misc', redstone: 'recipe.group.redstone' };

  /** ClientRecipeBook.getGroupForRecipe for crafting: item group BUILDING -> building, TOOLS/COMBAT -> equipment, REDSTONE -> redstone, else misc. */
  RB.groupOf = function (rec) {
    var IT = NS.Items, ix = IT.of(rec.r.i), col = IT.tabOf ? IT.tabOf(ix) : -1, t = col >= 0 ? IT.tabs.filter(function (x) { return x.col === col; })[0] : null;
    var lang = t ? t.lang : '';
    if (lang === 'itemGroup.buildingBlocks') return 'building';
    if (lang === 'itemGroup.tools' || lang === 'itemGroup.combat') return 'equipment';
    if (lang === 'itemGroup.redstone') return 'redstone';
    return 'misc';
  };

  /** ClientRecipeBook.reload: crafting recipes (specials are ignored in the book) grouped by (category, recipe group string; empty -> own id). */
  RB.buildCollections = function () {
    var R = NS.Recipes, out = { search: [], equipment: [], building: [], misc: [], redstone: [] }, keyed = Object.create(null), lists = [R.byType[R.SHAPED], R.byType[R.SHAPELESS]];
    var key = function (r) { return r.r.i; };
    for (var l = 0; l < lists.length; l++) for (var i = 0; i < lists[l].length; i++) {
      var rec = lists[l][i], cat = RB.groupOf(rec), k = cat + '|' + (rec.g ? 'g:' + rec.g : 'id:' + rec.id);
      if (!keyed[k]) { keyed[k] = []; keyed[k].cat = cat; }
      keyed[k].push(rec);
    }
    for (var kk in keyed) {
      var c = RB.collection(keyed[kk], key);
      out[keyed[kk].cat].push(c); out.search.push(c);
    }
    return out;
  };

  /** Item counts available to the matcher: the player's inventory (main+offhand) and the grid slots. */
  RB.available = function (inv, grid, n) {
    var a = Object.create(null), I = NS.Inventory, i, s;
    var add = function (st) { if (st && !I.isEmpty(st)) a[st.i] = (a[st.i] || 0) + st.n; };
    for (i = 0; i < I.MAIN; i++) add(inv.slots[i]);
    add(inv.slots[I.OFFHAND]);
    for (i = 0; i < n; i++) add(grid.get(i));
    return a;
  };
  /** The ingredient indices of a recipe (shaped: -1 cells skipped later, shapeless: in[]). */
  RB.ingredients = function (rec) { return rec.t === NS.Recipes.SHAPED ? rec.k : rec.in; };
  /** RecipeMatcher.match(recipe, amount): pick an item per ingredient so each has `n` copies left; item ids, or null. */
  RB.assign = function (avail, rec, n) {
    var R = NS.Recipes, left = Object.create(null), k, ings = RB.ingredients(rec), out = [], i;
    for (k in avail) left[k] = avail[k];
    for (i = 0; i < ings.length; i++) {
      if (ings[i] < 0) { out.push(-1); continue; }
      var pick = -1;
      for (k in left) if (left[k] >= n && R.ingredientMatches(ings[i], { i: +k, n: 1, d: 0, t: null })) { pick = +k; break; }
      if (pick < 0) return null;
      left[pick] -= n; out.push(pick);
    }
    return out;
  };
  RB.canMake = function (avail, rec) { return !!RB.assign(avail, rec, 1); };
  /** RecipeMatcher.countCrafts: the most copies the matcher can make (cap 64 as a stack). */
  RB.countCrafts = function (avail, rec) { for (var n = 64; n >= 1; n--) if (RB.assign(avail, rec, n)) return n; return 0; };

  /**
   * InputSlotFiller.fillInputSlots: return the grid to the inventory, then place `amount` of each ingredient where
   * RecipeGridAligner says (amount: 1, or countCrafts for shift, capped by the smallest max stack among the picks).
   * Returns false (and changes nothing) when the matcher cannot make it or the inventory cannot take the grid back.
   */
  RB.fill = function (inv, grid, gw, gh, rec, all) {
    var I = NS.Inventory, nSlots = gw * gh, snap = [], i;
    for (i = 0; i < I.SIZE; i++) snap.push(I.copy(inv.slots[i]));
    var gsnap = []; for (i = 0; i < nSlots; i++) gsnap.push(I.copy(grid.get(i)));
    var restore = function () { for (var j = 0; j < I.SIZE; j++) inv.slots[j] = snap[j]; for (j = 0; j < nSlots; j++) grid.set(j, gsnap[j]); return false; };
    var av = RB.available(inv, grid, nSlots);
    if (!RB.assign(av, rec, 1)) return false;
    var count = RB.countCrafts(av, rec), amount = all ? count : 1;
    var picks = RB.assign(av, rec, amount);
    if (!picks) return false;
    for (i = 0; i < picks.length; i++) if (picks[i] >= 0) amount = Math.min(amount, NS.Items.maxStack(picks[i]));
    for (i = 0; i < nSlots; i++) { var g = grid.get(i); if (g && !I.isEmpty(g)) { if (I.add(inv, g) > 0) return restore(); grid.set(i, null); } }
    var ings = RB.ingredients(rec), al = RB.alignRecipeToGrid(gw, gh, 0, rec, ings.map(function (x, ix) { return ix; }));
    picks = RB.assign(RB.available(inv, grid, nSlots), rec, amount);
    if (!picks) return restore();
    for (i = 0; i < al.length; i++) {
      var item = picks[al[i].ing];
      if (item < 0) continue;
      var need = amount;
      for (var j = 0; j < I.SIZE && need > 0; j++) {
        var st = inv.slots[j];
        if (!st || I.isEmpty(st) || st.i !== item) continue;
        var take = Math.min(need, st.n); st.n -= take; need -= take;
        if (st.n <= 0) inv.slots[j] = null;
      }
      if (need > 0) return restore();
      grid.set(al[i].slot - 1, I.stack(item, amount));
    }
    return true;
  };

  /** The item the ghost shows for an ingredient: its first member (the real client cycles through them). */
  RB.ghostItem = function (ing) { var IT = NS.Items, R = NS.Recipes, k; for (k in IT.index) { var id = IT.index[k]; if (R.ingredientMatches(ing, { i: id, n: 1 })) return id; } return -1; };

  /** Layout in GUI pixels. `inventory` book: toggle at (x+104, h/2-22); crafting: (x+5, h/2-49). Book origin & tabs per RecipeBookWidget. */
  RB.layout = function (guiW, guiH, bgW, narrow, open) {
    var off = narrow ? 0 : 86, bx = Math.floor((guiW - 147) / 2) - off, by = Math.floor((guiH - 166) / 2);
    var x = open && !narrow ? 177 + Math.floor((guiW - bgW - 200) / 2) : Math.floor((guiW - bgW) / 2);
    return { x: x, bookX: bx, bookY: by, search: [bx + 25, by + 14, 80, 14], toggle: [bx + 110, by + 12, 26, 16],
      tabX: bx - 30, tabY: by + 3, next: [bx + 93, by + 137, 12, 17], prev: [bx + 38, by + 137, 12, 17] };
  };
  RB.resultXY = function (L, i) { return [L.bookX + 11 + 25 * (i % 5), L.bookY + 31 + 25 * ((i / 5) | 0)]; };
  RB.inRect = function (r, px, py) { return px >= r[0] && px < r[0] + r[2] && py >= r[1] && py < r[1] + r[3]; };

  /** A recipe-book controller for one screen: kind 'inventory' (2x2) or 'crafting' (3x3). */
  RB.ctl = function (kind) {
    var cols = RB.buildCollections();
    var c = { kind: kind, gw: kind === 'crafting' ? 3 : 2, gh: kind === 'crafting' ? 3 : 2, bgW: 176, open: false, tab: 0, search: '', focus: false,
      filter: false, pages: RB.pages(), cols: cols, ghost: null, last: [] };
    c.narrow = function (guiW) { return guiW < 379; };
    c.refresh = function (inv, grid, reset) {
      var book = (NS.Player && NS.Player.recipeBook) || new Set(), av = RB.available(inv, grid, c.gw * c.gh);
      var tabId = RB.TABS[c.tab];
      var res = RB.refreshResults(c.cols[tabId], { has: function (id) { return book.has(id.indexOf(':') < 0 ? 'minecraft:' + id : id); } },
        function (r) { return RB.canMake(av, r); }, c.gw, c.gh, c.search, c.filter,
        function (col, text) { return col.recipes.some(function (r) { return NS.Items.lang ? String(NS.Items.lang(r.r.i) || r.r.i).toLowerCase().indexOf(text) >= 0 : r.r.i.toLowerCase().indexOf(text) >= 0; }); });
      RB.setResults(c.pages, res, !!reset);
      c.avail = av;
      return res;
    };
    /** Tabs shown: search always; others only with a known recipe (hasKnownRecipes). */
    c.visibleTabs = function () {
      var book = (NS.Player && NS.Player.recipeBook) || new Set(), out = [];
      for (var t = 0; t < RB.TABS.length; t++) {
        if (t === 0) { out.push(t); continue; }
        var cs = c.cols[RB.TABS[t]], any = false;
        for (var i = 0; i < cs.length && !any; i++) for (var j = 0; j < cs[i].recipes.length; j++) {
          var id = cs[i].recipes[j].id; if (book.has(id.indexOf(':') < 0 ? 'minecraft:' + id : id) && RB.fits(cs[i].recipes[j], c.gw, c.gh)) { any = true; break; }
        }
        if (any) out.push(t);
      }
      return out;
    };
    c.toggle = function () { c.open = !c.open; c.ghost = null; };
    /** Which recipe sits in result button i: the collection's first craftable (else first fitting) recipe. */
    c.recipeOf = function (col) {
      var i, r; for (i = 0; i < col.recipes.length; i++) if (col.craftable[col.recipes[i].id]) return col.recipes[i];
      for (i = 0; i < col.recipes.length; i++) if (col.fitting[col.recipes[i].id]) return col.recipes[i];
      return col.recipes[0];
    };
    /** Slot highlight colour for a result button: 'green' craftable, 'red' not (RecipeButton uses the red/green slot sprites). */
    c.state = function (col) { return col.craftable[c.recipeOf(col).id] ? 'green' : 'red'; };
    /** mouseClicked(guiX, guiY, shift, inv, grid, guiW, guiH): returns true when the book consumed the click. */
    c.click = function (px, py, shift, inv, grid, guiW, guiH) {
      if (!c.open) return false;
      var L = RB.layout(guiW, guiH, c.bgW, c.narrow(guiW), true), items = RB.pageItems(c.pages), i;
      for (i = 0; i < items.length; i++) {
        var xy = RB.resultXY(L, i);
        if (RB.inRect([xy[0], xy[1], 25, 25], px, py)) {
          var rec = c.recipeOf(items[i]), craftable = !!items[i].craftable[rec.id];
          if (!craftable && c.ghost && c.ghost.rec === rec) return false;
          c.ghost = null;
          if (craftable) RB.fill(inv, grid, c.gw, c.gh, rec, shift);
          else c.showGhost(rec);
          if (c.narrow(guiW)) c.open = false;
          return true;
        }
      }
      if (RB.nextVisible(c.pages) && RB.inRect(L.next, px, py)) { RB.next(c.pages); return true; }
      if (RB.prevVisible(c.pages) && RB.inRect(L.prev, px, py)) { RB.prev(c.pages); return true; }
      if (RB.inRect(L.search, px, py)) { c.focus = true; return true; }
      if (RB.inRect(L.toggle, px, py)) { c.filter = !c.filter; c.refresh(inv, grid, false); return true; }
      var vis = c.visibleTabs();
      for (i = 0; i < vis.length; i++) if (RB.inRect([L.tabX, L.tabY + 27 * i, 35, 27], px, py)) {
        if (c.tab !== vis[i]) { c.tab = vis[i]; c.refresh(inv, grid, true); }
        return true;
      }
      c.focus = false;
      return false;
    };
    /** showGhostRecipe: the aligned ingredient list the grid draws faintly. */
    c.showGhost = function (rec) {
      var ings = RB.ingredients(rec), al = RB.alignRecipeToGrid(c.gw, c.gh, 0, rec, ings.map(function (x, ix) { return ix; }));
      c.ghost = { rec: rec, slots: al.filter(function (a) { return ings[a.ing] >= 0; }).map(function (a) { return { slot: a.slot, ing: ings[a.ing] }; }) };
    };
    /** Text field: printable chars append (max 50), Backspace deletes. */
    c.key = function (code, key, inv, grid) {
      if (!c.open || !c.focus) return false;
      if (code === 'Backspace') c.search = c.search.slice(0, -1);
      else if (code === 'Escape') { c.focus = false; return false; }
      else if (key && key.length === 1) c.search = RB.clampSearch(c.search + key);
      else return false;
      c.refresh(inv, grid, true);
      return true;
    };
    return c;
  };
})(MCL);
