// 15e_creative.js — PLAN G11b: THE CREATIVE INVENTORY.
// Runs on: MAIN THREAD ONLY. Draws through NS.Gui, on vanilla's own four sheets.
//
// ⚠⚠ **WHY THIS IS URGENT AND NOT A NICETY.** D-312 removed the nine pre-filled hotbar slots —
// 64 each of grass, dirt, stone, cobblestone, planks, log, sand, glass and a torch — because
// Minecraft does not hand you a starter kit. That removal is only correct if there is another way
// to get a block, and in creative there is exactly one: this screen. Deleting the scaffolding and
// not building the thing it stood in for would leave a creative world with no blocks in it at
// all, which is a worse game than the one with the placeholder (D-139, from the other side).
//
// ⚠⚠ **NOTHING IN THIS FILE CLASSIFIES AN ITEM, AND THE FIRST DRAFT DID.** That draft had eight
// ordered regular expressions typed from memory, and it was wrong before it ran: eleven tabs in
// an invented order, no `hotbar` tab at all, `search` first instead of sixth, and `materials`
// missing entirely. The tabs and the per-item assignment now come out of the 1.18.2 BYTECODE
// (`tools/extract-creative.mjs`, D-313) and ride in `items.bin` beside the item they describe —
// so this file draws a table it did not invent, and `creativecheck` holds that table closed.
//
// ⚠ **EVERY NUMBER BELOW WAS MEASURED OFF THE TEXTURE, NOT REMEMBERED** (D-277's rule). The slot
// pitch, the grid origin, the hotbar row and the scrollbar track were read out of `tab_items.png`
// by finding its 0x8B8B8B slot interiors; `guicheck` asserts them against the same pixels, in
// both directions, so a coordinate that drifts is a failed check and not a screen that looks
// nearly right.

(function (NS) {
  'use strict';

  var C = NS.Creative = {
    ready: false,
    tab: 0,               // the COLUMN of the open tab, 0..11 — vanilla's own cell number
    scroll: 0,            // in rows
    query: '',
    searching: false,     // is the search box taking keys
    pages: null,
    tabs: null
  };

  // ── the panel, in GUI pixels, measured off tab_items.png ───────────────────────────────────
  C.W = 195;
  C.H = 136;
  C.COLS = 9;
  C.ROWS = 5;
  C.PER_PAGE = 45;
  C.SLOT = 18;
  C.GRID = [9, 18];       // the 9x5 picker's top-left slot
  C.HOTBAR = [9, 112];    // the player's hotbar row, the only inventory row an item tab shows
  C.SCROLL = [175, 18, 12, 112];          // the scrollbar TRACK
  C.SCROLLER = [232, 0, 12, 15];          // its handle, in `creative_tabs`
  C.SCROLLER_OFF = [244, 0, 12, 15];      // ...greyed, when there is nothing to scroll
  C.TITLE = [8, 6];
  C.SEARCH = [82, 6, 80, 9];              // vanilla's `EditBox(font, x+82, y+6, 80, 9)`
  // ⚠ THE TAB STRIP IS 6 WIDE AND 2 DEEP and the column is `col % 6`, the row `col < 6`. The
  // texture has FOUR rows of cells — top/bottom crossed with selected/not — and the selected
  // sprite is 32 rows lower than its own unselected one, never a fixed offset from the top.
  C.TAB_W = 28;
  C.TAB_H = 32;
  C.TAB_PER_ROW = 6;

  // The three tabs that are a VIEW rather than a home. `extract-creative` asserts that no item
  // claims any of them, so an item appearing here would be a table that had drifted.
  C.SEARCH_COL = 5;
  C.INVENTORY_COL = 11;
  C.HOTBAR_COL = 4;

  /**
   * ⚠ OWED, NAMED (the charter's rule, not a silent gap): vanilla's HOTBAR tab holds NINE SAVED
   * TOOLBARS, loaded with ctrl+number and saved with ctrl+X+number, persisted in options.txt.
   * MC-Lite has no options file and no toolbar store, so the tab draws and is empty. It is listed
   * here rather than hidden because a tab quietly missing from a twelve-tab strip is the kind of
   * difference that reads as "not quite Minecraft" and has nothing pointing at it.
   */
  C.OWED = [
    'hotbar: the nine saved toolbars (ctrl+number to load, ctrl+X+number to save)',
    // ⚠⚠ SIXTY ITEMS DRAW NOTHING, AND THIS IS WHY. Chests, ender chests, trapped chests, all
    // seventeen shulker boxes, all sixteen beds, all sixteen banners, the six heads, the conduit
    // and the shield are `builtin/entity` items in vanilla: they have NO item sprite and NO block
    // model, and the game draws each one by running its BLOCK-ENTITY RENDERER into the slot. That
    // renderer is G17e — NOT G17c, which is the entity renderer and is complete (AUDIT §2.7).
    // Until it exists those sixty slots are blank — including the Survival
    // Inventory TAB's own chest icon, which is why that tab looks empty. `creativecheck` holds
    // the set closed at sixty, in both directions, so it cannot quietly grow.
    'the 60 builtin/entity items — chests, shulker boxes, beds, banners, heads, conduit, shield '
      + '— have no sprite and no model and need the block-entity renderer (G17e)'
  ];

  /**
   * The items vanilla draws with a block-entity renderer, which is the complete list of items
   * this game cannot draw at all. Named here rather than discovered at a glance, so that a
   * SIXTY-FIRST blank slot is a failing check rather than something somebody notices in a
   * screenshot six sessions later.
   */
  C.NO_ICON = [
    'chest', 'ender_chest', 'trapped_chest', 'conduit', 'shield', 'shulker_box',
    'white_shulker_box', 'orange_shulker_box', 'magenta_shulker_box', 'light_blue_shulker_box',
    'yellow_shulker_box', 'lime_shulker_box', 'pink_shulker_box', 'gray_shulker_box',
    'light_gray_shulker_box', 'cyan_shulker_box', 'purple_shulker_box', 'blue_shulker_box',
    'brown_shulker_box', 'green_shulker_box', 'red_shulker_box', 'black_shulker_box',
    'white_bed', 'orange_bed', 'magenta_bed', 'light_blue_bed', 'yellow_bed', 'lime_bed',
    'pink_bed', 'gray_bed', 'light_gray_bed', 'cyan_bed', 'purple_bed', 'blue_bed',
    'brown_bed', 'green_bed', 'red_bed', 'black_bed',
    'white_banner', 'orange_banner', 'magenta_banner', 'light_blue_banner', 'yellow_banner',
    'lime_banner', 'pink_banner', 'gray_banner', 'light_gray_banner', 'cyan_banner',
    'purple_banner', 'blue_banner', 'brown_banner', 'green_banner', 'red_banner', 'black_banner',
    'skeleton_skull', 'wither_skeleton_skull', 'player_head', 'zombie_head', 'creeper_head',
    'dragon_head'
  ];

  /** Which sheet backs a tab: the search box, the survival panel, or the plain item grid. */
  C.sheetFor = function (col) {
    if (col === C.SEARCH_COL) return 'creative_search';
    if (col === C.INVENTORY_COL) return 'creative_inv';
    return 'creative_items';
  };

  /**
   * Build every tab's contents once, out of the ITEM TABLE's own per-item tab byte.
   * ⚠ ORDERED BY THE ITEM REGISTRY'S OWN ORDER, which is vanilla's, so Building Blocks opens on
   * stone rather than on whatever a sort happened to put first.
   */
  C.build = function () {
    var IT = NS.Items;
    if (!IT || !IT.ready || !IT.count || !IT.tabs) { C.ready = false; return C; }
    C.tabs = IT.tabs.slice().sort(function (a, b) { return a.col - b.col; });
    C.pages = Object.create(null);
    C.tagPages = Object.create(null);   // parallel to `pages`: the NBT tag of each entry, or null
    var t, col;
    for (t = 0; t < C.tabs.length; t++) { C.pages[C.tabs[t].col] = []; C.tagPages[C.tabs[t].col] = []; }
    var all = [], allTags = [];
    function put(c, item, tag) {
      if (C.pages[c]) { C.pages[c].push(item); C.tagPages[c].push(tag); }
    }
    var tabCol = function (lang) {
      for (var k = 0; k < C.tabs.length; k++) if (C.tabs[k].lang === lang) return C.tabs[k].col;
      return -1;
    };
    var toolsCol = tabCol('itemGroup.tools'), combatCol = tabCol('itemGroup.combat');
    var Po = NS.Potion && NS.Potion.POTIONS, En = NS.Trade && NS.Trade.ENCH;
    var potionIds = Po ? Object.keys(Po) : [];
    var bookIx = IT.index ? IT.index['enchanted_book'] : undefined;
    for (var i = 0; i < IT.count; i++) {
      var name = IT.names[i], k;
      // ⚠ Item.appendStacks OVERRIDES, in registry order: PotionItem (every Registry.POTION but
      // `empty`), TippedArrowItem (only the ones with effects) and EnchantedBookItem (SEARCH: one
      // book per level min..max per enchantment; TOOLS/COMBAT: the max-level book per enchantment
      // whose target the tab lists). Everything else is one plain stack.
      if (name === 'enchanted_book' && En) {
        var ids = Object.keys(En), tag;
        for (k = 0; k < ids.length; k++) {
          for (var lv = 1; lv <= En[ids[k]].maxLevel; lv++) {
            tag = { StoredEnchantments: [{ id: 'minecraft:' + ids[k], lvl: lv }] };
            all.push(i); allTags.push(tag);
          }
        }
        for (var g = 0; g < 2; g++) {
          var gc = g ? combatCol : toolsCol, tg = g ? C.COMBAT_TARGETS : C.TOOLS_TARGETS;
          for (k = 0; k < ids.length; k++) {
            if (tg.indexOf(En[ids[k]].target) < 0) continue;
            put(gc, i, { StoredEnchantments: [{ id: 'minecraft:' + ids[k], lvl: En[ids[k]].maxLevel }] });
          }
        }
        continue;
      }
      col = IT.tabOf(i);
      if (col < 0) continue;
      if (Po && (name === 'potion' || name === 'splash_potion' || name === 'lingering_potion' ||
                 name === 'tipped_arrow')) {
        for (k = 0; k < potionIds.length; k++) {
          if (potionIds[k] === 'empty') continue;
          if (name === 'tipped_arrow' && !Po[potionIds[k]].effects.length) continue;
          var ptag = { Potion: 'minecraft:' + potionIds[k] };
          put(col, i, ptag); all.push(i); allTags.push(ptag);
        }
        continue;
      }
      put(col, i, null);
      all.push(i); allTags.push(null);
    }
    // ⚠ SEARCH IS EVERY PLACED ITEM, which is what vanilla's search tab holds before you type —
    // and it is NOT every item: the eighteen with no tab are not in the game's search either.
    C.pages[C.SEARCH_COL] = all;
    C.tagPages[C.SEARCH_COL] = allTags;
    C.total = all.length;
    if (C.tab === undefined || !C.pages[C.tab]) C.tab = 0;
    C.ready = true;
    return C;
  };

  /** `ItemGroup.TOOLS` / `COMBAT` `.setEnchantments(...)`, as the roster's own `target` names
   *  (07p_trade.js ENCH): VANISHABLE and BREAKABLE fold into `breakable`, both tabs list it. */
  C.TOOLS_TARGETS = ['breakable', 'digger', 'fishing_rod'];
  C.COMBAT_TARGETS = ['breakable', 'armor', 'armor_feet', 'armor_head', 'armor_legs', 'armor_chest',
    'bow', 'weapon', 'wearable', 'trident', 'crossbow'];
  C.MAX_QUERY = 50;   // EditBox.setMaxLength(50)

  /** The open tab's entries as `{ i: item index, t: tag|null }`, search-filtered like `items()`. */
  C.stacks = function () {
    if (!C.ready) return [];
    var list = C.pages[C.tab] || [], tags = C.tagPages[C.tab] || [];
    var IT = NS.Items, out = [], i;
    if (C.tab !== C.SEARCH_COL || !C.query) {
      for (i = 0; i < list.length; i++) out.push({ i: list[i], t: tags[i] || null });
      return out;
    }
    var q = C.query.toLowerCase();
    // ⚠ vanilla's search(): a leading '#' is SearchManager.ITEM_TAG (tag ids containing the rest,
    // members shown); anything else is ITEM_TOOLTIP - the localized display name, plus the id.
    if (q.charAt(0) === '#') {
      var T = NS.Tags, tq = q.slice(1).replace(/^minecraft:/, ''), hit = Object.create(null);
      if (T && T.ready) {
        var tn = T.names('items');
        for (i = 0; i < tn.length; i++) {
          if (tn[i].replace(/^minecraft:/, '').indexOf(tq) < 0) continue;
          var mem = T.items(tn[i]) || [];
          for (var m = 0; m < mem.length; m++) hit[String(mem[m]).replace(/^minecraft:/, '')] = true;
        }
      }
      for (i = 0; i < list.length; i++) if (hit[IT.names[list[i]]]) out.push({ i: list[i], t: tags[i] || null });
      return out;
    }
    var X = NS.Text, idq = q.replace(/^minecraft:/, '');
    for (i = 0; i < list.length; i++) {
      var id = String(IT.names[list[i]]);
      if (id.indexOf(idq) >= 0 || (X && X.ready && String(X.itemName(id)).toLowerCase().indexOf(q) >= 0))
        out.push({ i: list[i], t: tags[i] || null });
    }
    return out;
  };

  /** The items on the open tab (one per entry, variants repeat their item), search-filtered. */
  C.items = function () {
    var st = C.stacks(), out = new Array(st.length);
    for (var i = 0; i < st.length; i++) out[i] = st[i].i;
    return out;
  };

  /** The deepest row the grid can start on. Vanilla scrolls only when there is a second page. */
  C.maxScroll = function () {
    var n = C.stacks().length;
    return Math.max(0, Math.ceil(n / C.COLS) - C.ROWS);
  };
  C.canScroll = function () { return C.maxScroll() > 0; };

  C.clampScroll = function () {
    var m = C.maxScroll();
    if (C.scroll > m) C.scroll = m;
    if (C.scroll < 0) C.scroll = 0;
  };

  C.setTab = function (col) {
    if (!C.pages || !C.pages[col]) return false;
    C.tab = col;
    C.scroll = 0;
    C.searching = (col === C.SEARCH_COL);
    return true;
  };

  C.label = function (col) {
    var t = null;
    for (var i = 0; C.tabs && i < C.tabs.length; i++) if (C.tabs[i].col === col) t = C.tabs[i];
    if (!t) return '';
    return (NS.Text && NS.Text.has && NS.Text.has(t.lang)) ? NS.Text.translate(t.lang) : t.lang;
  };

  /** The item vanilla draws on tab `col`, as an index into the item table, or -1. */
  C.iconOf = function (col) {
    for (var i = 0; C.tabs && i < C.tabs.length; i++) {
      if (C.tabs[i].col === col) return C.tabs[i].item;
    }
    return -1;
  };

  // ── geometry ──────────────────────────────────────────────────────────────────────────────
  /** Where picker cell `k` (0..44) sits inside the panel, in GUI pixels. */
  C.cellXY = function (k) {
    return [C.GRID[0] + (k % C.COLS) * C.SLOT, C.GRID[1] + ((k / C.COLS) | 0) * C.SLOT];
  };
  /** Where hotbar slot `k` (0..8) sits. */
  C.hotXY = function (k) { return [C.HOTBAR[0] + k * C.SLOT, C.HOTBAR[1]]; };

  /**
   * Where tab `col`'s BUTTON sits, relative to the panel's top-left, and which 28x32 cell of
   * `creative_tabs` draws it. `[x, y, sx, sy]`, all in GUI pixels.
   *
   * ⚠ THE LAST COLUMN IS PINNED TO THE RIGHT EDGE and the middle four are pushed out by one
   * pixel each. Six 28-wide buttons are 168 pixels and the panel is 195, so an even `col * 28`
   * leaves a 27-pixel gap on the right and the strip stops looking like the game's.
   */
  C.tabRect = function (col) {
    var i = col % C.TAB_PER_ROW, top = col < C.TAB_PER_ROW;
    var x = i * C.TAB_W;
    if (i === C.TAB_PER_ROW - 1) x = C.W - C.TAB_W;
    else if (i > 0) x += i;
    var y = top ? -C.TAB_W : (C.H - 4);
    var sy = (top ? 0 : 64) + (col === C.tab ? 32 : 0);
    return [x, y, i * C.TAB_W, sy];
  };

  /** Which tab a point inside the strip is over, or -1. The inverse of `tabRect`, by search. */
  C.tabAt = function (px, py) {
    for (var t = 0; C.tabs && t < C.tabs.length; t++) {
      var col = C.tabs[t].col, r = C.tabRect(col);
      if (px >= r[0] && px < r[0] + C.TAB_W && py >= r[1] && py < r[1] + C.TAB_H) return col;
    }
    return -1;
  };

  /**
   * What a point inside the panel is over.
   *   { kind: 'cell', item }   one of the 45 picker cells that has an item in it
   *   { kind: 'hotbar', slot } one of the nine real inventory slots
   *   { kind: 'scroll', frac } the scrollbar track
   *   null                     anything else
   */
  C.hitAt = function (px, py) {
    var k, p;
    if (C.tab === C.INVENTORY_COL) {
      // the survival tab re-seats the player menu's own slots (CreativeInventoryScreen ctor)
      var sl = C.menuSlotAt(px, py);
      if (sl >= 0) return { kind: 'slot', slot: sl };
    }
    if (C.tab === C.INVENTORY_COL) k = C.PER_PAGE;   // the picker grid is not there
    else k = 0;
    for (; k < C.PER_PAGE; k++) {
      p = C.cellXY(k);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) {
        var list = C.stacks();
        var idx = (C.scroll * C.COLS) + k;
        if (idx >= list.length) return null;
        return { kind: 'cell', item: list[idx].i, tag: list[idx].t, cell: k };
      }
    }
    for (k = 0; k < 9; k++) {
      p = C.hotXY(k);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) {
        return { kind: 'hotbar', slot: k };
      }
    }
    // vanilla's `deleteItemSlot` (173,112) exists on the survival tab only
    if (C.tab === C.INVENTORY_COL && px >= C.DELETE[0] && px < C.DELETE[0] + 16 &&
        py >= C.DELETE[1] && py < C.DELETE[1] + 16) return { kind: 'delete' };
    var S = C.SCROLL;
    if (px >= S[0] && px < S[0] + S[2] && py >= S[1] && py < S[1] + S[3]) {
      return { kind: 'scroll', frac: C.trackFrac(py) };
    }
    return null;
  };

  C.DELETE = [173, 112];
  /** The player preview window on the survival tab: `drawEntity(x+88, y+45, 20)`, scissored to 73,6..105,49. */
  C.PREVIEW = { cx: 88, feet: 45, unit: 20 / 16, box: [73, 6, 32, 43] };

  /** Where the player menu's slot `i` sits on the survival tab (the ctor's re-seating), or null. */
  C.menuSlotXY = function (i) {
    if (i >= 5 && i < 9) return [54 + (((i - 5) / 2) | 0) * 54, 6 + ((i - 5) % 2) * 27];
    if (i === 45) return [35, 20];
    if (i >= 9 && i < 36) return [9 + ((i - 9) % 9) * 18, 54 + (((i - 9) / 9) | 0) * 18];
    return null;
  };
  C.menuSlotAt = function (px, py) {
    var list = [5, 6, 7, 8, 45], i, p;
    for (i = 9; i < 36; i++) list.push(i);
    for (i = 0; i < list.length; i++) {
      p = C.menuSlotXY(list[i]);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return list[i];
    }
    return -1;
  };

  /** The survival tab's trash slot: a click clears the cursor, a shift-click clears every slot
   * of the player menu (`CreativeInventoryScreen.onMouseClick`, QUICK_MOVE branch). */
  C.clickDelete = function (shift, player) {
    var M = NS.Menu;
    if (!M || !player || !player.menu) return false;
    var menu = player.menu, i;
    if (shift) { for (i = 0; i < menu.slots.length; i++) M.slotSet(menu.slots[i], null); }
    else M.setCarried(menu, null);
    return true;
  };

  /** CreativeInventoryScreen.mouseDragged: (y - top - 7.5) / (112 - 15), the handle centred on the pointer. */
  C.trackFrac = function (py) {
    return (py - C.SCROLL[1] - 7.5) / (C.SCROLL[3] - 15);
  };

  /** A drag or click on the track, as a row offset: (int)(pos * (rows - 5) + 0.5) with pos clamped 0..1. */
  C.scrollTo = function (frac) {
    var m = C.maxScroll();
    frac = Math.max(0, Math.min(1, frac));
    C.scroll = Math.max(0, Math.min(m, Math.floor(frac * m + 0.5)));
  };

  /** True while a press that began in the track is still held (vanilla `scrolling`). */
  C.dragging = false;

  /**
   * CreativeInventoryScreen.onMouseClick, the item-list branch. List entries hold ONE item, so a plain
   * click puts 1 on the cursor and shift puts a full stack on the CURSOR (never the inventory).
   * Carrying the same item: left +1 (shift: full), right -1. Anything else: left clears the cursor
   * (so the picker is also the bin), right takes 1 off. button: 0 left, 1 middle (CLONE), 2 right.
   */
  function sameTag(a, b) { return JSON.stringify(a || null) === JSON.stringify(b || null); }

  C.clickCell = function (item, shift, player, button, tag) {
    var Iv = NS.Inventory, IT = NS.Items, M = NS.Menu;
    if (!Iv || !IT || !player || !M) return false;
    var menu = player.menu;
    if (!M || !menu) return false;
    var carried = M.getCarried(menu);
    var has = !!(carried && !Iv.isEmpty(carried));
    var cellOk = item !== undefined && item >= 0;
    var max = cellOk ? IT.maxStack(item) : 0;
    if (button === 1) {                       // CLONE: a full stack, only onto an empty cursor
      if (!has && cellOk) M.setCarried(menu, Iv.stack(item, max, 0, tag || undefined));
      return true;
    }
    var right = button === 2;
    if (has && cellOk && carried.i === item && sameTag(carried.t, tag)) {
      var n = carried.n;
      if (!right) n = shift ? max : Math.min(n + 1, max);
      else n -= 1;
      M.setCarried(menu, n > 0 ? Iv.stack(item, n, 0, tag || undefined) : null);
      return true;
    }
    if (!has && cellOk) { M.setCarried(menu, Iv.stack(item, shift ? max : 1, 0, tag || undefined)); return true; }
    if (!right) { M.setCarried(menu, null); return true; }
    var m = carried.n - 1;
    M.setCarried(menu, m > 0 ? Iv.stack(carried.i, m, 0, carried.t) : null);
    return true;
  };

  /** SWAP (number key over a cell): that hotbar slot becomes a full stack of the cell's item. */
  C.swapCell = function (item, slot, player, tag) {
    var Iv = NS.Inventory, IT = NS.Items;
    if (!Iv || !IT || !player || item === undefined || item < 0) return false;
    Iv.setItem(player.inventory, slot, Iv.stack(item, IT.maxStack(item), 0, tag || undefined));
    return true;
  };

  /** A click on one of the nine hotbar slots, through G8's own machine. */
  C.clickHotbar = function (slot, button, shift, player) {
    var M = NS.Menu;
    if (!M || !player || !player.menu) return false;
    // ⚠ the creative panel shows the hotbar, and the hotbar is `playerMenu` slots 36..44 —
    // NOT 0..8. Getting this band wrong puts a block in the crafting grid.
    M.doClick(player.menu, 36 + slot, button === 2 ? 1 : 0, shift ? M.QUICK_MOVE : M.PICKUP, player);
    return true;
  };

  /** HandledScreen.handleHotbarKeyPressed over the slot under the pointer (`hit` from hitAt); false when there is none. */
  C.hotbarKey = function (n, hit, player) {
    var M = NS.Menu;
    if (!hit || !M || !player || !player.menu || M.getCarried(player.menu)) return false;
    if (hit.kind === 'cell') return C.swapCell(hit.item, n, player, hit.tag);
    var slot = hit.kind === 'hotbar' ? 36 + hit.slot : hit.kind === 'slot' ? hit.slot : -1;
    if (slot < 0) return false;
    M.doClick(player.menu, slot, n, M.SWAP, player);
    return true;
  };

  /** Typing into the search box. Returns true when the key was consumed. */
  C.key = function (code, ch) {
    if (C.tab !== C.SEARCH_COL) return false;
    if (code === 'Backspace') { C.query = C.query.slice(0, -1); C.scroll = 0; return true; }
    if (ch && ch.length === 1 && ch >= ' ' && ch <= '~') {
      if (C.query.length < C.MAX_QUERY) C.query += ch.toLowerCase();
      C.scroll = 0; return true;
    }
    return false;
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
