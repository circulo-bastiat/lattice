// 14g_menu.js — PLAN G8, part two: the CLICK half. `AbstractContainerMenu.doClick`.
//
// MAIN THREAD ONLY, and no DOM. A menu is slots over containers and a carried stack, so a whole
// session of clicking runs inside `invcheck` without a browser — the same argument 14f makes.
//
// ⚠ WHY THIS IS A SEPARATE FILE FROM 14f. `14f_inventory.js` is STORAGE: what a stack is, where
// the 41 slots are, and what happens when you walk over a dropped item. This is the STATE
// MACHINE: what a click does. They are different in kind, and vanilla splits them the same way
// (`Inventory` vs `AbstractContainerMenu`). Sharing a file would mean `invcheck` could not fail
// one without touching the other.
//
// ⚠ EVERY RULE BELOW IS OFF THE 1.18.2 BYTECODE, NOT OFF MEMORY (D-265).
// `tools/golden/javap.AbstractContainerMenu.txt` is the dump; the class is obfuscated, so the
// method is identified by SHAPE: `private void b(int, int, bqy, boj)` — 777 instructions, the
// only private method taking (int, int, <7-constant enum>, <Player>) — and `bqy` is `ClickType`,
// whose seven constants are in declaration order PICKUP, QUICK_MOVE, SWAP, CLONE, THROW,
// QUICK_CRAFT, PICKUP_ALL. Bytecode offsets are cited in the comments below so the next reader
// can check a rule against the dump without re-deriving which method it is.
//
// ⚠ THE FIDDLY HALF IS QUICK_CRAFT — the DRAG — and it is where every clone is subtly wrong:
// THREE TYPES (left = split evenly, right = one each, middle = a full stack each, creative only)
// by THREE STAGES (begin, add a slot, end), encoded in the `button` int as `header << 2 | type`.
// The stages are a state machine with a reset on ANY out-of-order message, and the split is
// computed against the stack as it was when the drag STARTED, not as it is mid-drag.

(function (NS) {
  'use strict';

  var Menu = NS.Menu = {};

  // `ClickType`, in the enum's own declaration order (bqy.a … bqy.g).
  Menu.PICKUP = 0;
  Menu.QUICK_MOVE = 1;
  Menu.SWAP = 2;
  Menu.CLONE = 3;
  Menu.THROW = 4;
  Menu.QUICK_CRAFT = 5;
  Menu.PICKUP_ALL = 6;

  // `ClickAction` — which mouse button, once the int has been read.
  Menu.PRIMARY = 0;     // left
  Menu.SECONDARY = 1;   // right

  // vanilla's sentinel for "outside the window"
  Menu.OUTSIDE = -999;

  var Inv = null;
  function inv() { return Inv || (Inv = NS.Inventory); }

  // ── the quick-craft button encoding ──────────────────────────────────────────────────────
  // ⚠ THE TWO HALVES ARE THE OTHER WAY ROUND FROM WHAT THE MASK SUGGESTS, and writing them the
  // "obvious" way is a bug that only shows up as "drags do nothing". From the dump:
  //     public static int c(int)   ->  iload_0; iconst_2; ishr; iconst_3; iand   ==  i >> 2 & 3
  //     public static int d(int)   ->  iload_0; iconst_3; iand                   ==  i & 3
  //     public static int b(int,int) -> header & 3 | (type & 3) << 2
  // and doClick stores `d(button)` into the STATUS field (offset 20) and `c(button)` into the
  // TYPE field (offset 82). So the HEADER is the low two bits and the TYPE the next two —
  // even though the mask builder reads as if it were the reverse.
  /** `getQuickcraftType(i)` — 0 split evenly, 1 one each, 2 a full stack each (creative). */
  Menu.quickCraftType = function (i) { return (i >> 2) & 3; };
  /** `getQuickcraftHeader(i)` — 0 begin, 1 add a slot, 2 end. */
  Menu.quickCraftHeader = function (i) { return i & 3; };
  /** `getQuickcraftMask(header, type)` — what a client sends. */
  Menu.quickCraftMask = function (header, type) { return (header & 3) | ((type & 3) << 2); };
  /** `isValidQuickcraftType` — the middle-button drag is creative-only. */
  Menu.isValidQuickCraftType = function (type, player) {
    if (type === 0) return true;
    if (type === 1) return true;
    // ⚠ THE ABILITY, NOT A BOOLEAN. G6 (D-253) replaced `player.creative` with vanilla's
    // Abilities, and the one this asks for is `instabuild` — spectator may fly and may not build,
    // a combination the old boolean could not express.
    return type === 2 && !!(player && player.instabuild);
  };

  // ── containers ───────────────────────────────────────────────────────────────────────────
  /**
   * A container is three functions. The player's inventory is one; a chest will be another; the
   * crafting grid and its result are two more. Nothing here knows which.
   */
  Menu.container = function (get, set, removeAt, size) {
    return { get: get, set: set, removeAt: removeAt, size: size };
  };

  /** A plain array container — the crafting grid, the result, and every test fixture. */
  Menu.arrayContainer = function (n) {
    var a = new Array(n);
    for (var i = 0; i < n; i++) a[i] = null;
    var I = inv();
    return Menu.container(
      function (i) { return a[i] || null; },
      function (i, s) { a[i] = I.isEmpty(s) ? null : s; },
      function (i, count) {
        var s = a[i];
        if (I.isEmpty(s)) return null;
        var out = I.split(s, count);
        if (s.n <= 0) a[i] = null;
        return out;
      }, n);
  };

  /** The player's own 41 slots, as a container. */
  Menu.inventoryContainer = function (inventory) {
    var I = inv();
    return Menu.container(
      function (i) { return I.getItem(inventory, i); },
      function (i, s) { I.setItem(inventory, i, s); },
      function (i, count) { return I.removeItem(inventory, i, count); },
      I.SIZE);
  };

  // ── slots ────────────────────────────────────────────────────────────────────────────────
  /**
   * `Slot`. `mayPlace`, `mayPickup` and `getMaxStackSize` are the three hooks every container
   * screen overrides, so they are options rather than subclasses.
   *
   * ⚠ `getMaxStackSize(stack)` is `Math.min(slot cap, stack's ITEM cap)` and NOT the container's
   * 64 — the same trap D-261 recorded one file down, and the reason a furnace fuel slot cannot
   * hold 64 ender pearls.
   */
  Menu.slot = function (container, index, opts) {
    opts = opts || {};
    var s = {
      container: container,
      index: index,
      cap: opts.cap === undefined ? 64 : opts.cap,
      capFn: opts.capFn || null,            // `getMaxStackSize(stack)` when it depends on the stack (a bucket in a fuel slot)
      placeFn: opts.mayPlace || null,
      pickupFn: opts.mayPickup || null,
      noDrag: !!opts.noDrag,
      menuIndex: -1,                        // filled by Menu.create — see the note in doClick
      onTakeFn: opts.onTake || null,
      onQuickCraftFn: opts.onQuickCraft || null,
      changedFn: opts.onChanged || null
    };
    return s;
  };

  Menu.slotGet = function (sl) { return sl.container.get(sl.index); };
  Menu.slotSet = function (sl, st) {
    sl.container.set(sl.index, st);
    if (sl.changedFn) sl.changedFn(sl, st);
  };
  Menu.slotHas = function (sl) { return !inv().isEmpty(Menu.slotGet(sl)); };
  Menu.slotMayPlace = function (sl, st) { return sl.placeFn ? !!sl.placeFn(st) : true; };
  Menu.slotMayPickup = function (sl, player) { return sl.pickupFn ? !!sl.pickupFn(player) : true; };
  Menu.slotMaxStack = function (sl, st) {
    var I = inv();
    var cap = (sl.capFn && !I.isEmpty(st)) ? sl.capFn(st) : sl.cap;
    return Math.min(cap, I.isEmpty(st) ? cap : I.maxStackSize(st));
  };
  function slotChanged(sl) { if (sl.changedFn) sl.changedFn(sl, Menu.slotGet(sl)); }
  function onTake(sl, player, st) { if (sl.onTakeFn) sl.onTakeFn(player, st); }

  /**
   * `Slot.safeInsert(stack, count)` — put up to `count` of `stack` in, return what is left of it.
   * ⚠ The cap is `getMaxStackSize(stack) - whatIsThere`, so a slot that is already part full
   * takes less, and a slot whose cap is 1 (armour) takes one however many you are holding.
   */
  Menu.safeInsert = function (sl, st, count) {
    var I = inv();
    if (I.isEmpty(st) || !Menu.slotMayPlace(sl, st)) return st;
    var here = Menu.slotGet(sl);
    var n = Math.min(Math.min(count, st.n), Menu.slotMaxStack(sl, st) - (I.isEmpty(here) ? 0 : here.n));
    if (n <= 0) return st;
    if (I.isEmpty(here)) Menu.slotSet(sl, I.split(st, n));
    else if (I.isSameItemSameTags(here, st)) { st.n -= n; here.n += n; Menu.slotSet(sl, here); }
    return st;
  };

  /** `Slot.allowModification` — may this player both take from and put back into this slot? */
  function allowModification(sl, player) {
    return Menu.slotMayPickup(sl, player) && Menu.slotMayPlace(sl, Menu.slotGet(sl));
  }

  /**
   * `Slot.tryRemove(count, decrement, player)` -> a stack, or null for "nothing happened".
   * ⚠ The `decrement` gate is the rule that stops you taking HALF a crafting result: a slot you
   * may not modify gives you all of it or none of it.
   */
  Menu.tryRemove = function (sl, count, decrement, player) {
    var I = inv();
    if (!Menu.slotMayPickup(sl, player)) return null;
    var here = Menu.slotGet(sl);
    if (!allowModification(sl, player) && decrement < (I.isEmpty(here) ? 0 : here.n)) return null;
    count = Math.min(count, decrement);
    var out = sl.container.removeAt(sl.index, count);
    if (I.isEmpty(out)) return null;
    if (I.isEmpty(Menu.slotGet(sl))) Menu.slotSet(sl, null);
    return out;
  };

  /** `Slot.safeTake` — `tryRemove` plus the take hook. */
  Menu.safeTake = function (sl, count, decrement, player) {
    var got = Menu.tryRemove(sl, count, decrement, player);
    if (got) onTake(sl, player, got);
    return got || null;
  };

  // ── the menu ─────────────────────────────────────────────────────────────────────────────
  Menu.create = function (slots, opts) {
    opts = opts || {};
    // vanilla's `addSlot` stamps each slot with its position in the MENU; the one-slot quick-craft
    // branch reads it back to re-enter `doClick`.
    for (var i = 0; i < slots.length; i++) slots[i].menuIndex = i;
    return {
      slots: slots,
      carried: null,
      // the quick-craft state machine: 0 idle, 1 dragging, 2 ending
      qcStatus: 0,
      qcType: 0,
      qcSlots: [],
      quickMove: opts.quickMove || null,     // the menu's own shift-click rule
      drops: [],                             // what a headless run would have thrown on the floor
      player: opts.player || null
    };
  };

  Menu.getCarried = function (m) { return m.carried; };
  Menu.setCarried = function (m, st) { m.carried = inv().isEmpty(st) ? null : st; };

  function drop(m, st, player) {
    if (inv().isEmpty(st)) return;
    m.drops.push(st);
    if (player && typeof player.dropStack === 'function') player.dropStack(st);
  }

  // ⚠ EXPORTED so `Hud`'s crafting-table close handler (PASS 17 JOB 1) can return unfinished
  // grid contents through the SAME path a slot-drop already uses, rather than a second copy of
  // "try the inventory, else throw it".
  Menu.drop = drop;

  /**
   * `Item.getRecipeRemainder` / `Recipe.getRemainder` (.decomp `Items.java`): the five items
   * registered with a `.recipeRemainder(...)` on their `Item.Settings` (water/lava/milk bucket
   * -> `bucket`, dragon_breath/honey_bottle -> `glass_bottle`; a plain `potion` has none, so it
   * is simply consumed like any other ingredient — that matches vanilla, which never set one).
   * KW-5 / D-361's own `Use.OWED` line named this table; nothing else in the game reads it, so
   * it lives here rather than in `07_items` proper.
   */
  var CRAFTING_REMAINDER = {
    water_bucket: 'bucket', lava_bucket: 'bucket', milk_bucket: 'bucket',
    dragon_breath: 'glass_bottle', honey_bottle: 'glass_bottle'
  };

  /**
   * `ResultSlot.onTake` — session 44 found this had NEVER been wired: `Menu.playerMenu`'s own
   * 2x2 result slot had no `onTake` at all, so taking a crafted item consumed NOTHING — every
   * survival recipe was infinite through the player's own inventory screen, silently, since
   * G9 shipped. (`m.grid` was set on the menu object and never read again outside
   * `Hud.refreshCraftResult`.) D-405 names the fix; KW-5 closes its own remaining gap: a grid
   * cell whose item is in `CRAFTING_REMAINDER` above is left holding ONE of the remainder item
   * (a water bucket becomes an empty bucket) instead of going empty, matching vanilla's
   * `Recipe.getRemainder` for every real recipe that uses one of these five items — none of
   * them is ever stacked past 1 per grid cell in a vanilla recipe, so the slot the ingredient
   * vacated always has room for its own remainder and vanilla's inventory-or-drop fallback for
   * an OVERFLOWING remainder (`CraftingResultSlot.onCraftMatch`) never triggers and is not
   * built here.
   */
  function craftingTaken(gridContainer, n) {
    var I = inv();
    var IT = NS.Items;
    for (var i = 0; i < n; i++) {
      var s = gridContainer.get(i);
      if (!s || I.isEmpty(s)) continue;
      var remainder = IT ? CRAFTING_REMAINDER[IT.nameOf(s.i)] : undefined;
      gridContainer.removeAt(i, 1);
      if (remainder) gridContainer.set(i, I.stack(remainder, 1));
    }
  }

  function resetQuickCraft(m) { m.qcStatus = 0; m.qcSlots.length = 0; }

  /**
   * `canItemQuickReplace(slot, stack, stackSizeMatters)` — may the drag write into this slot?
   * ⚠ The `stackSizeMatters` argument is inverted from what its name suggests: when it is TRUE
   * the incoming count is NOT added before the comparison, which is what lets a drag pass over a
   * slot it will only partly fill.
   */
  Menu.canItemQuickReplace = function (sl, st, stackSizeMatters) {
    var I = inv();
    var empty = !sl || !Menu.slotHas(sl);
    if (!empty && I.isSameItemSameTags(st, Menu.slotGet(sl))) {
      return Menu.slotGet(sl).n + (stackSizeMatters ? 0 : st.n) <= I.maxStackSize(st);
    }
    return empty;
  };

  /**
   * `getQuickCraftSlotCount(slots, type, stack, slotStackSize)` — how many each dragged-over slot
   * gets. ⚠ IT MUTATES `stack`, and the `+ slotStackSize` at the end is what makes a drag over a
   * slot that already holds some of the item TOP IT UP rather than overwrite it.
   */
  Menu.quickCraftSlotCount = function (slotCount, type, st, slotStackSize) {
    var I = inv();
    if (type === 0) st.n = Math.floor(st.n / slotCount);
    else if (type === 1) st.n = 1;
    else if (type === 2) st.n = I.maxStackSize(st);
    st.n += slotStackSize;
  };

  /** `AbstractContainerMenu.canDragTo` — the default is yes; a result slot says no. */
  Menu.canDragTo = function (m, sl) { return !sl.noDrag; };

  /**
   * `moveItemStackTo(stack, start, end, reverse)` — shift-click's transport. Returns whether
   * anything moved. ⚠ TWO PASSES: stackable items first merge into partial stacks over the whole
   * range, and only then does the second pass take empty slots. One pass is how a clone ends up
   * scattering a stack across empty slots while a half stack of the same thing sits next to it.
   */
  Menu.moveItemStackTo = function (m, st, start, end, reverse) {
    var I = inv();
    var moved = false;
    var i = reverse ? end - 1 : start;
    var sl, here;

    if (I.isStackable(st)) {
      while (!I.isEmpty(st) && (reverse ? i >= start : i < end)) {
        sl = m.slots[i];
        here = Menu.slotGet(sl);
        if (!I.isEmpty(here) && I.isSameItemSameTags(st, here)) {
          var total = here.n + st.n;
          var cap = Menu.slotMaxStack(sl, st);
          if (total <= cap) {
            st.n = 0;
            here.n = total;
            Menu.slotSet(sl, here);
            moved = true;
          } else if (here.n < cap) {
            st.n -= cap - here.n;
            here.n = cap;
            Menu.slotSet(sl, here);
            moved = true;
          }
        }
        i += reverse ? -1 : 1;
      }
    }

    if (!I.isEmpty(st)) {
      i = reverse ? end - 1 : start;
      while (reverse ? i >= start : i < end) {
        sl = m.slots[i];
        here = Menu.slotGet(sl);
        if (I.isEmpty(here) && Menu.slotMayPlace(sl, st)) {
          var cap2 = Menu.slotMaxStack(sl, st);
          if (st.n > cap2) Menu.slotSet(sl, I.split(st, cap2));
          else Menu.slotSet(sl, I.split(st, st.n));
          moved = true;
          break;
        }
        i += reverse ? -1 : 1;
      }
    }
    return moved;
  };

  // ── doClick ──────────────────────────────────────────────────────────────────────────────
  /**
   * doClick(menu, slotId, button, clickType, player)
   *
   * The whole of vanilla's `AbstractContainerMenu.doClick`, branch for branch, with the bytecode
   * offsets of the dump in the comments. `player` needs only `{ creative, inventory }`; anything
   * it would have dropped on the floor is pushed to `menu.drops` as well, so a headless check can
   * assert on it.
   */
  Menu.doClick = function (m, slotId, button, clickType, player) {
    var I = inv();
    player = player || m.player || {};
    var inventory = player.inventory || null;

    // ── QUICK_CRAFT (offsets 7..540) ───────────────────────────────────────────────────────
    if (clickType === Menu.QUICK_CRAFT) {
      var prev = m.qcStatus;
      m.qcStatus = Menu.quickCraftHeader(button);
      // ⚠ THE GUARD IS VANILLA'S, CHARACTER FOR CHARACTER (offsets 28..55):
      //   if ((i != 1 || status != 2) && i != status) reset
      // i.e. any change of stage resets EXCEPT the one legal advance, 1 -> 2. Reaching for the
      // obvious "status must be prev or prev+1" is what lets a dropped packet leave a menu
      // permanently mid-drag.
      if ((prev !== 1 || m.qcStatus !== 2) && prev !== m.qcStatus) { resetQuickCraft(m); return; }
      if (I.isEmpty(Menu.getCarried(m))) { resetQuickCraft(m); return; }

      if (m.qcStatus === 0) {                                     // begin (offsets 75..126)
        m.qcType = Menu.quickCraftType(button);
        if (Menu.isValidQuickCraftType(m.qcType, player)) { m.qcStatus = 1; m.qcSlots.length = 0; }
        else resetQuickCraft(m);
        return;
      }

      if (m.qcStatus === 1) {                                     // add a slot (offsets 126..223)
        var sl1 = m.slots[slotId];
        var held = Menu.getCarried(m);
        if (sl1 && Menu.canItemQuickReplace(sl1, held, true) && Menu.slotMayPlace(sl1, held)
            && (m.qcType === 2 || held.n > m.qcSlots.length) && Menu.canDragTo(m, sl1)) {
          if (m.qcSlots.indexOf(sl1) < 0) m.qcSlots.push(sl1);
        }
        return;
      }

      if (m.qcStatus === 2) {                                     // end (offsets 223..536)
        if (m.qcSlots.length) {
          if (m.qcSlots.length === 1) {
            // ⚠ A ONE-SLOT DRAG IS A CLICK. Vanilla re-enters doClick as PICKUP with the drag's
            // TYPE as the button, so a right-drag over one slot drops exactly one item — the
            // behaviour every clone loses by treating a 1-slot drag as a tiny split.
            // ⚠ `Slot.index` in vanilla is the slot's index IN THE MENU — `addSlot` overwrites
            // it with `slots.size()` — not its index in the container it wraps. Using the
            // container index here would re-click a different slot.
            var onlyIdx = m.qcSlots[0].menuIndex;
            resetQuickCraft(m);
            Menu.doClick(m, onlyIdx, m.qcType, Menu.PICKUP, player);
            return;
          }
          var template = I.copy(Menu.getCarried(m));
          var remaining = Menu.getCarried(m).n;
          for (var qi = 0; qi < m.qcSlots.length; qi++) {
            var sl2 = m.qcSlots[qi];
            var carried2 = Menu.getCarried(m);
            if (!sl2 || I.isEmpty(carried2)) continue;
            if (!Menu.canItemQuickReplace(sl2, carried2, true)) continue;
            if (!Menu.slotMayPlace(sl2, carried2)) continue;
            if (!(m.qcType === 2 || carried2.n >= m.qcSlots.length)) continue;
            if (!Menu.canDragTo(m, sl2)) continue;
            var give = I.copy(template);
            var there = Menu.slotHas(sl2) ? Menu.slotGet(sl2).n : 0;
            Menu.quickCraftSlotCount(m.qcSlots.length, m.qcType, give, there);
            var cap3 = Math.min(I.maxStackSize(give), Menu.slotMaxStack(sl2, give));
            if (give.n > cap3) give.n = cap3;
            remaining -= give.n - there;
            Menu.slotSet(sl2, give);
          }
          template.n = remaining;
          Menu.setCarried(m, template.n > 0 ? template : null);
        }
        resetQuickCraft(m);
        return;
      }
      resetQuickCraft(m);
      return;
    }

    // ⚠ ANY other click while a drag is live cancels the drag and does nothing else (543..557).
    if (m.qcStatus !== 0) { resetQuickCraft(m); return; }

    // ── PICKUP and QUICK_MOVE (offsets 557..1091) ──────────────────────────────────────────
    if (clickType === Menu.PICKUP || clickType === Menu.QUICK_MOVE) {
      if (button !== 0 && button !== 1) return;
      var action = button === 0 ? Menu.PRIMARY : Menu.SECONDARY;

      if (slotId === Menu.OUTSIDE) {                              // drop what you are holding
        if (!I.isEmpty(Menu.getCarried(m))) {
          if (action === Menu.PRIMARY) { drop(m, Menu.getCarried(m), player); Menu.setCarried(m, null); }
          else drop(m, I.split(Menu.getCarried(m), 1), player);
        }
        return;
      }

      if (clickType === Menu.QUICK_MOVE) {                        // shift-click (659..740)
        if (slotId < 0) return;
        var qsl = m.slots[slotId];
        if (!qsl || !Menu.slotMayPickup(qsl, player)) return;
        // ⚠ IT LOOPS. One shift-click moves the WHOLE stack, and vanilla keeps calling
        // `quickMoveStack` until it comes back empty or stops returning the same item.
        var guard = 0;
        var out = Menu.quickMoveStack(m, player, slotId);
        while (!I.isEmpty(out) && I.isSameItemSameTags(Menu.slotGet(qsl), out) && guard++ < 256) {
          out = Menu.quickMoveStack(m, player, slotId);
        }
        return;
      }

      if (slotId < 0) return;
      var sl = m.slots[slotId];
      if (!sl) return;
      var there = Menu.slotGet(sl);
      var carried = Menu.getCarried(m);

      if (I.isEmpty(there)) {                                     // empty slot (819..870)
        if (!I.isEmpty(carried)) {
          var n1 = action === Menu.PRIMARY ? carried.n : 1;
          Menu.setCarried(m, Menu.safeInsert(sl, carried, n1));
        }
      } else if (Menu.slotMayPickup(sl, player)) {
        if (I.isEmpty(carried)) {                                 // take (880..946)
          // ⚠ RIGHT-CLICK TAKES THE LARGER HALF: `(n + 1) / 2`, integer division. Five becomes
          // three in your hand and two in the slot, not two and three.
          var n2 = action === Menu.PRIMARY ? there.n : ((there.n + 1) / 2) | 0;
          var got = Menu.tryRemove(sl, n2, 2147483647, player);
          if (got) { Menu.setCarried(m, got); onTake(sl, player, got); }
        } else if (Menu.slotMayPlace(sl, carried)) {              // put (946..1032)
          if (I.isSameItemSameTags(there, carried)) {
            var n3 = action === Menu.PRIMARY ? carried.n : 1;
            Menu.setCarried(m, Menu.safeInsert(sl, carried, n3));
          } else if (carried.n <= Menu.slotMaxStack(sl, carried)) {
            // the SWAP: what was in the slot comes into your hand and vice versa
            Menu.slotSet(sl, carried);
            Menu.setCarried(m, there);
          }
        } else if (I.isSameItemSameTags(there, carried)) {        // top up a slot you may not fill (1032..1083)
          var room = I.maxStackSize(carried) - carried.n;
          var got2 = Menu.tryRemove(sl, there.n, room, player);
          if (got2) { carried.n += got2.n; onTake(sl, player, got2); }
        }
      }
      slotChanged(sl);
      return;
    }

    // ── SWAP — the number keys and F (offsets 1091..1381) ──────────────────────────────────
    if (clickType === Menu.SWAP) {
      if (slotId < 0 || !inventory) return;
      var ssl = m.slots[slotId];
      if (!ssl) return;
      var hot = I.getItem(inventory, button);                     // 0..8, or 40 for the offhand
      var cur = Menu.slotGet(ssl);
      if (I.isEmpty(hot) && I.isEmpty(cur)) return;

      if (I.isEmpty(hot)) {
        if (Menu.slotMayPickup(ssl, player)) {
          I.setItem(inventory, button, cur);
          if (ssl.onQuickCraftFn) ssl.onQuickCraftFn(cur.n);
          Menu.slotSet(ssl, null);
          onTake(ssl, player, cur);
        }
      } else if (I.isEmpty(cur)) {
        if (Menu.slotMayPlace(ssl, hot)) {
          var capA = Menu.slotMaxStack(ssl, hot);
          if (hot.n > capA) Menu.slotSet(ssl, I.split(hot, capA));
          else { I.setItem(inventory, button, null); Menu.slotSet(ssl, hot); }
        }
      } else if (Menu.slotMayPickup(ssl, player) && Menu.slotMayPlace(ssl, hot)) {
        var capB = Menu.slotMaxStack(ssl, hot);
        if (hot.n > capB) {
          // ⚠ THE OVERFLOW CASE: too many to swap, so the slot takes a full stack and what was
          // there goes to the inventory — and on the floor if the inventory is full.
          Menu.slotSet(ssl, I.split(hot, capB));
          onTake(ssl, player, cur);
          if (I.add(inventory, cur) > 0) drop(m, cur, player);
        } else {
          I.setItem(inventory, button, cur);
          Menu.slotSet(ssl, hot);
          onTake(ssl, player, cur);
        }
      }
      return;
    }

    // ── CLONE — middle-click in creative (offsets 1381..1463) ──────────────────────────────
    if (clickType === Menu.CLONE) {
      if (!player.instabuild || !I.isEmpty(Menu.getCarried(m)) || slotId < 0) return;
      var csl = m.slots[slotId];
      if (!csl || !Menu.slotHas(csl)) return;
      var copy = I.copy(Menu.slotGet(csl));
      copy.n = I.maxStackSize(copy);
      Menu.setCarried(m, copy);
      return;
    }

    // ── THROW — Q and ctrl-Q (offsets 1463..1540) ──────────────────────────────────────────
    if (clickType === Menu.THROW) {
      if (!I.isEmpty(Menu.getCarried(m)) || slotId < 0) return;
      var tsl = m.slots[slotId];
      if (!tsl) return;
      var n4 = button === 0 ? 1 : (Menu.slotHas(tsl) ? Menu.slotGet(tsl).n : 0);
      var thrown = Menu.safeTake(tsl, n4, 2147483647, player);
      if (thrown) drop(m, thrown, player);
      return;
    }

    // ── PICKUP_ALL — double-click (offsets 1540..1802) ─────────────────────────────────────
    if (clickType === Menu.PICKUP_ALL) {
      if (slotId < 0) return;
      var dsl = m.slots[slotId];
      var held2 = Menu.getCarried(m);
      if (I.isEmpty(held2)) return;
      if (dsl && Menu.slotHas(dsl) && Menu.slotMayPickup(dsl, player)) return;
      // ⚠ TWO PASSES, AND THE FIRST ONE SKIPS FULL STACKS. Without that, a double-click empties
      // the first full stack it meets and leaves every partial one behind — the opposite of what
      // the gesture is for. Direction is the button: left sweeps up, right sweeps down.
      var from = button === 0 ? 0 : m.slots.length - 1;
      var step = button === 0 ? 1 : -1;
      for (var pass = 0; pass < 2; pass++) {
        for (var k = from; k >= 0 && k < m.slots.length; k += step) {
          if (held2.n >= I.maxStackSize(held2)) break;
          var psl = m.slots[k];
          if (!psl || !Menu.slotHas(psl)) continue;
          if (!Menu.canItemQuickReplace(psl, held2, true)) continue;
          if (!Menu.slotMayPickup(psl, player)) continue;
          if (!Menu.canDragTo(m, psl)) continue;
          var pst = Menu.slotGet(psl);
          if (pass === 0 && pst.n === I.maxStackSize(pst)) continue;
          var taken = Menu.safeTake(psl, pst.n, I.maxStackSize(held2) - held2.n, player);
          if (taken) held2.n += taken.n;
        }
      }
    }
  };

  /**
   * The menu's own shift-click rule. `InventoryMenu.quickMoveStack`, with its slot bands:
   * 0 result · 1..4 the crafting grid · 5..8 armour · 9..35 the backpack · 36..44 the hotbar ·
   * 45 the offhand. ⚠ The backpack sends to the HOTBAR and the hotbar sends to the BACKPACK —
   * they are not one range, which is the whole reason shift-clicking feels the way it does.
   */
  Menu.quickMoveStack = function (m, player, index) {
    if (m.quickMove) return m.quickMove(m, player, index);
    var I = inv();
    var sl = m.slots[index];
    if (!sl || !Menu.slotHas(sl)) return null;
    var live = Menu.slotGet(sl);
    var before = I.copy(live);
    var moved;

    // ⚠ THE TWO EQUIPMENT BRANCHES COME FIRST, and they are why shift-clicking a helmet puts it
    // on your head instead of shuffling it between the backpack and the hotbar (D-266). Vanilla
    // asks `Mob.getEquipmentSlotForItem`, which is compiled Java; `Items.equipSlot` is that
    // answer, read out of the jar by `tools/extract-equipment.mjs` — NOT a name suffix, because
    // `turtle_helmet`, `elytra`, `carved_pumpkin` and the six skulls are all worn and none of
    // them is named the way a suffix rule would want.
    // ⚠ The armour band is REVERSED against the slot numbering, hence `10 - slot`: head is
    // EquipmentSlot 5 and menu slot 5, feet is 2 and menu slot 8. Vanilla writes the same thing
    // as `8 - equipmentslot.getIndex()`.
    var IT = NS.Items;
    var eq = (IT && IT.equipSlot) ? IT.equipSlot(live.i) : 0;
    var armourTarget = (eq >= 2 && eq <= 5) ? (10 - eq) : -1;

    if (index === 0) moved = Menu.moveItemStackTo(m, live, 9, 45, true);
    else if (index >= 1 && index < 9) moved = Menu.moveItemStackTo(m, live, 9, 45, false);
    else if (armourTarget >= 0 && !Menu.slotHas(m.slots[armourTarget])) {
      moved = Menu.moveItemStackTo(m, live, armourTarget, armourTarget + 1, false);
    } else if (eq === 1 && !Menu.slotHas(m.slots[45])) {
      moved = Menu.moveItemStackTo(m, live, 45, 46, false);
    }
    else if (index >= 9 && index < 36) moved = Menu.moveItemStackTo(m, live, 36, 45, false);
    else if (index >= 36 && index < 45) moved = Menu.moveItemStackTo(m, live, 9, 36, false);
    else moved = Menu.moveItemStackTo(m, live, 9, 45, false);
    if (!moved) return null;

    if (I.isEmpty(live)) Menu.slotSet(sl, null);
    else Menu.slotSet(sl, live);
    if (!I.isEmpty(live) && live.n === before.n) return null;
    onTake(sl, player, live);
    return before;
  };

  /**
   * The player's own screen: 46 slots over the 41-slot inventory plus a 2x2 grid and its result.
   * ⚠ The armour band is REVERSED — menu slot 5 is the head and lives at inventory index 39 —
   * because vanilla numbers armour feet-first in storage and head-first on screen.
   * ⚠ THE RESULT SLOT CONSUMES THE GRID (session 44, D-405) — it did not, from G9 until now:
   * `craftingTaken` (declared above, shared with `Menu.craftingMenu` below) removes one item
   * from every occupied grid cell when the result is taken. See D-405 for the one gap that fix
   * still leaves open (vanilla's crafting-remainder items, e.g. a bucket).
   */
  Menu.playerMenu = function (inventory, player) {
    var invC = Menu.inventoryContainer(inventory);
    var grid = Menu.arrayContainer(4);
    var result = Menu.arrayContainer(1);
    var slots = [];
    var never = function () { return false; };

    slots.push(Menu.slot(result, 0, { mayPlace: never, noDrag: true, cap: 64,
      onTake: function () { craftingTaken(grid, 4); } }));
    for (var g = 0; g < 4; g++) slots.push(Menu.slot(grid, g));
    for (var a = 0; a < 4; a++) {
      // menu 5..8 -> inventory 39,38,37,36 (head, chest, legs, feet)
      slots.push(Menu.slot(invC, 39 - a, { cap: 1 }));
    }
    for (var i = 9; i < 36; i++) slots.push(Menu.slot(invC, i));
    for (var h = 0; h < 9; h++) slots.push(Menu.slot(invC, h));
    slots.push(Menu.slot(invC, 40));                      // the offhand

    var m = Menu.create(slots, { player: player });
    m.grid = grid;
    m.result = result;
    m.inventory = inventory;
    return m;
  };

  /**
   * `ChestMenu` — PASS 17 JOB 1 (G19b), first slice: a plain chest's own screen.
   * ⚠ Transcribed from public 1.18.2 mapped decompiles of `ChestMenu`'s constructor and
   * `ChestScreen`'s own layout (`imageWidth`/`imageHeight`), the same interim standing D-394's
   * reach formula had before it was walked against this project's own bytecode — NOT yet
   * re-derived from `ChestMenu.<init>`'s bytecode the way `extract-guigeom.mjs` already did for
   * the hotbar (D-329's own warning about a memorised number applies here until that extractor
   * exists). What is verified: `rows*9` chest slots is the real `Container`'s own size, and the
   * player-inventory/hotbar slot indices below are the SAME ones `Menu.playerMenu` already uses
   * for the same inventory object, so a stack does not change identity crossing between them.
   * ⚠ Only `rows === 3` is wired to a block: a plain single chest, trapped chest, the barrel
   * (D-403 — `Use.blockUse`/`Hud.openChest`; vanilla's SAME `generic_54.png` chest artwork, so
   * it is this exact menu over a differently-typed block entity, not a new one), and — D-404 —
   * the ender chest, which is this SAME menu again over `be.items` REBOUND by `Hud.openChest` to
   * the player's own shared 27-slot inventory rather than to that block entity's own array; this
   * function itself stays type-blind and does not know the difference (proven in `chestcheck`
   * §6's own anti-vacuity case, which already runs an untyped `be` through it). Double chest's
   * own MERGED two-block container; every other G19b screen is still owed, named on `Use.OWED`.
   * `noNest` (added for the shulker box, D-406) is the one behavioural difference a "chest-shaped"
   * screen can have: vanilla's own `ShulkerBoxSlot.mayPlace` refuses any stack whose item IS a
   * shulker box (`BlockItem` wrapping a `ShulkerBoxBlock`, any of the 17 colours or the
   * uncoloured one) — "no shulker in a shulker" — while every other slot in the SAME menu (the
   * player's own backpack and hotbar band, slots n..n+36) is unaffected; a shulker box sitting in
   * your own inventory is completely ordinary. Passing `true` wraps just the container's own `n`
   * slots with that one extra `mayPlace` clause; every other caller (chest/barrel/ender chest)
   * passes nothing and gets today's unrestricted slot, proven type-blind by `chestcheck` §6.
   */
  function isShulkerBoxStack(st) {
    if (inv().isEmpty(st)) return false;
    var n = NS.Items && NS.Items.nameOf ? NS.Items.nameOf(st.i) : '';
    return n === 'shulker_box' || (n.length > 12 && n.slice(-12) === '_shulker_box');
  }
  /**
   * ⚠ D-413 — A DOUBLE CHEST IS ONE 54-SLOT CONTAINER OVER TWO BLOCK ENTITIES' ARRAYS. Vanilla's
   * `ChestBlock.combine` hands back `CompoundContainer(first, second)`, whose slot `i` is
   * `first` below `first.getContainerSize()` and `second` above it. `be2`, the fifth argument, is
   * that second half: the menu then reads and writes slots 0..26 through `be.items` and 27..53
   * through `be2.items` — the LIVE arrays, never a merged copy, so a stack put in the bottom
   * three rows is in `be2` and breaking either chest leaves the other with exactly its own 27.
   * WHICH block entity is `be` is the caller's (`Hud.openChest`), because it is a fact about the
   * block state (`type=right` is FIRST), not about a menu.
   */
  Menu.chestMenu = function (be, inventory, rows, noNest, be2) {
    rows = rows || 3;
    var I = inv();
    var n = rows * 9;
    var bankOf = function (i) { return (be2 && i >= 27) ? be2.items : be.items; };
    var offOf = function (i) { return (be2 && i >= 27) ? i - 27 : i; };
    var chestC = Menu.container(
      function (i) { return bankOf(i)[offOf(i)] || null; },
      function (i, s) { bankOf(i)[offOf(i)] = I.isEmpty(s) ? null : s; },
      function (i, count) {
        var bank = bankOf(i), k = offOf(i);
        var s = bank[k];
        if (I.isEmpty(s)) return null;
        var out = I.split(s, count);
        if (s.n <= 0) bank[k] = null;
        return out;
      }, n);
    var invC = Menu.inventoryContainer(inventory);
    var noShulker = function (st) { return !isShulkerBoxStack(st); };
    var slots = [];
    for (var i = 0; i < n; i++) slots.push(Menu.slot(chestC, i, noNest ? { mayPlace: noShulker } : null));
    for (var p = 9; p < 36; p++) slots.push(Menu.slot(invC, p));
    for (var h = 0; h < 9; h++) slots.push(Menu.slot(invC, h));

    var m = Menu.create(slots, {
      // `ChestMenu.quickMoveStack` — vanilla's own two-region rule: shift-clicking a chest slot
      // moves the stack into the player's own slots (backpack first, then hotbar, D-266's own
      // `moveItemStackTo` doing the walk); shift-clicking a player slot moves it INTO the chest.
      quickMove: function (mm, player, index) {
        var sl = mm.slots[index];
        if (!sl || !Menu.slotHas(sl)) return null;
        var live = Menu.slotGet(sl);
        var before = I.copy(live);
        var moved = (index < n)
          ? Menu.moveItemStackTo(mm, live, n, n + 36, true)
          : Menu.moveItemStackTo(mm, live, 0, n, false);
        if (!moved) return null;
        if (I.isEmpty(live)) Menu.slotSet(sl, null); else Menu.slotSet(sl, live);
        if (!I.isEmpty(live) && live.n === before.n) return null;
        onTakeAlias(sl, player, live);
        return before;
      }
    });
    m.be = be;
    m.be2 = be2 || null;
    m.rows = rows;
    m.inventory = inventory;
    return m;
  };
  // `onTake` is private to this closure (declared above `Menu.slotGet`); the chest quickMove
  // needs the same hook `Menu.doClick`'s own QUICK_MOVE branch already calls for every other
  // slot, so it is reached through this one-line alias rather than duplicated.
  function onTakeAlias(sl, player, st) { if (sl.onTakeFn) sl.onTakeFn(player, st); }

  /**
   * `CraftingMenu` — PASS 17 JOB 1 (G19b), session 44: the crafting table's own screen, the last
   * of the three units named on `NEXT.md` as carrying genuinely new logic (double chest merges
   * two block entities' storage; shulker box needs its own nesting refusal; this one is the only
   * screen whose result slot actually HAS to consume something, which is what exposed D-405 —
   * `Menu.playerMenu`'s own 2x2 result slot had gone since G9 with no `onTake` at all).
   * ⚠ Vanilla's own layout, `CraftingMenu`'s constructor: slot 0 the result, 1..9 the 3x3 grid
   * (row-major, matching `Recipes.craft`'s own `w*h` convention), 10..36 the 27-slot backpack,
   * 37..45 the hotbar. UNLIKE `Menu.playerMenu` there is no armour band and no offhand slot —
   * `CraftingScreen`'s own image has neither, and clicking where they would be on the player's
   * own screen is not reachable here at all.
   * ⚠ A crafting table itself carries no block entity and no per-position state (unlike a chest):
   * vanilla's own `CraftingTableBlock.use` just opens a FRESH `CraftingMenu` over the player's
   * inventory every time, so this does too. `Hud.openCraftingTable` is the only caller.
   */
  Menu.craftingMenu = function (inventory, player) {
    var I = inv();
    var grid = Menu.arrayContainer(9);
    var result = Menu.arrayContainer(1);
    var invC = Menu.inventoryContainer(inventory);
    var never = function () { return false; };
    var slots = [];
    slots.push(Menu.slot(result, 0, { mayPlace: never, noDrag: true, cap: 64,
      onTake: function () { craftingTaken(grid, 9); } }));
    for (var g = 0; g < 9; g++) slots.push(Menu.slot(grid, g));
    for (var p = 9; p < 36; p++) slots.push(Menu.slot(invC, p));
    for (var h = 0; h < 9; h++) slots.push(Menu.slot(invC, h));

    var m = Menu.create(slots, {
      // `CraftingMenu.quickMoveStack` — vanilla's own two-region rule, the SAME shape
      // `Menu.chestMenu`'s own quickMove already uses: shift-clicking the result or the grid
      // moves into the player's own slots (backpack first, then hotbar); shift-clicking a player
      // slot moves it OUT to the same backpack/hotbar span, never INTO the grid — vanilla does
      // not auto-fill a crafting grid from a shift-click either.
      quickMove: function (mm, pl, index) {
        var sl = mm.slots[index];
        if (!sl || !Menu.slotHas(sl)) return null;
        var live = Menu.slotGet(sl);
        var before = I.copy(live);
        var moved = (index < 10)
          ? Menu.moveItemStackTo(mm, live, 10, 46, true)
          : Menu.moveItemStackTo(mm, live, (index < 37) ? 37 : 10, (index < 37) ? 46 : 37, false);
        if (!moved) return null;
        if (index === 0) craftingTaken(grid, 9);
        if (I.isEmpty(live)) Menu.slotSet(sl, null); else Menu.slotSet(sl, live);
        if (!I.isEmpty(live) && live.n === before.n) return null;
        onTakeAlias(sl, pl, live);
        return before;
      }
    });
    m.grid = grid;
    m.result = result;
    m.inventory = inventory;
    return m;
  };

  // ── the furnace family ───────────────────────────────────────────────────────────────────
  /**
   * `AbstractFurnaceMenu` — PASS 17 JOB 1 (G19b), D-414: the furnace, the blast furnace and the
   * smoker. ONE menu over three block entities, because vanilla's three classes differ only in
   * which recipe type they ask (`SMELTING`, `BLASTING`, `SMOKING`) and which sheet they draw.
   * ⚠ Transcribed from the public 1.18.2 `AbstractFurnaceMenu`, `FurnaceFuelSlot` and
   * `FurnaceResultSlot` (no javap on the machines this runs on — the same standing `chestMenu`
   * names for itself), so the layout below is a reading, not a referee: slot 0 the ingredient,
   * 1 the fuel, 2 the result, 3..29 the backpack, 30..38 the hotbar.
   * ⚠ THE MENU HOLDS NO STATE OF ITS OWN. Its three slots are `be.items[0..2]` and the arrows
   * are read off `be.burnTime`/`burnDuration`/`cookTime`/`cookTimeTotal` on every draw — vanilla's
   * `ContainerData` — so a furnace that keeps smelting while its screen is open moves the arrow
   * with no message between them, and closing and reopening cannot lose anything.
   * ⚠ THE FUEL SLOT takes fuel, or a BUCKET (`FurnaceFuelSlot.mayPlace`), and holds one bucket at
   * most (`getMaxStackSize`): the bucket is what a wet sponge is dried into, and what a lava
   * bucket leaves behind.
   * ⚠ THE RESULT SLOT takes nothing in, and taking from it pays out the banked experience
   * (`FurnaceResultSlot.checkTakeAchievements` -> `awardUsedRecipesAndPopExperience`).
   */
  var FURN_KIND = { furnace: 'SMELTING', blast_furnace: 'BLASTING', smoker: 'SMOKING' };
  Menu.furnaceCookType = function (type) {
    var R = NS.Recipes;
    return (R && FURN_KIND[type]) ? R[FURN_KIND[type]] : -1;
  };
  function isBucketStack(st) {
    return !inv().isEmpty(st) && NS.Items.nameOf(st.i) === 'bucket';
  }
  /**
   * `AbstractFurnaceBlockEntity.setItem` — putting a DIFFERENT item in the ingredient slot restarts
   * the cook and re-reads its length from the new item (200 when it has no recipe at all).
   * Exported because a furnace's hopper feed goes through the same door as the screen.
   */
  Menu.furnaceSetItem = function (be, index, st) {
    var I = inv(), R = NS.Recipes;
    var old = be.items[index];
    var same = !I.isEmpty(st) && !I.isEmpty(old) && I.isSameItemSameTags(st, old);
    be.items[index] = I.isEmpty(st) ? null : st;
    if (index === 0 && !same) {
      var rec = (R && R.ready && !I.isEmpty(st)) ? R.cookingFor(st, Menu.furnaceCookType(be.type)) : null;
      be.cookTimeTotal = (rec && rec.time) ? rec.time : 200;
      be.cookTime = 0;
    }
  };
  /** `AbstractFurnaceMenu.isLit` */
  Menu.furnaceIsLit = function (be) { return be.burnTime > 0; };
  /** `getLitProgress` — the flame's height in pixels, 0..13. ⚠ `litDuration` of 0 reads as 200. */
  Menu.furnaceLitProgress = function (be) {
    var d = be.burnDuration | 0;
    if (d === 0) d = 200;
    return ((be.burnTime | 0) * 13 / d) | 0;
  };
  /** `getBurnProgress` — the arrow's length in pixels, 0..24. Zero unless BOTH counters are non-zero. */
  Menu.furnaceBurnProgress = function (be) {
    var c = be.cookTime | 0, t = be.cookTimeTotal | 0;
    return (t !== 0 && c !== 0) ? ((c * 24 / t) | 0) : 0;
  };
  /**
   * `AbstractFurnaceBlockEntity.awardUsedRecipesAndPopExperience` — every recipe smelted since the
   * last take pays `floor(count * xp)` points plus one more with probability `frac(count * xp)`,
   * then the ledger is cleared. The points are ORBS spawned at the player's position
   * (`ExperienceOrbEntity.spawn`), which the player then absorbs — so Mending repairs from them. Only
   * where the orb system is not up (headless unit contexts) do the points go straight to the bar.
   */
  Menu.furnaceAwardXp = function (be, player, rnd) {
    var used = be.recipesUsed, total = 0;
    if (used) {
      for (var id in used) {
        // ⚠ FLOAT, not double: `count * xp` and `Mth.frac` are 32-bit in vanilla, so ten iron ingots
        // are exactly 7.0 there and would be 7.000000000000001 (with a phantom fraction) here.
        var v = Math.fround(used[id].n * Math.fround(used[id].xp));
        var whole = Math.floor(v), frac = Math.fround(v - whole);
        if (frac !== 0 && (rnd ? rnd() : Math.random()) < frac) whole++;
        total += whole;
      }
    }
    be.recipesUsed = {};
    if (total > 0 && player) {
      var X = NS.Xp;
      if (X && X.ready && typeof player.x === 'number' && typeof player.z === 'number') X.spawn(player.x, player.y, player.z, total, rnd);
      else if (NS.Survival && NS.Survival.addXp) NS.Survival.addXp(player, total);
    }
    return total;
  };

  Menu.furnaceMenu = function (be, inventory) {
    var I = inv(), R = NS.Recipes;
    var type = Menu.furnaceCookType(be.type);
    var canSmelt = function (st) { return !!(R && R.ready && R.cookingFor(st, type)); };
    var isFuel = function (st) { return !!(R && R.ready && R.isFuel(st)); };
    var fc = Menu.container(
      function (i) { return be.items[i] || null; },
      function (i, s) { Menu.furnaceSetItem(be, i, s); },
      function (i, count) {
        var s = be.items[i];
        if (I.isEmpty(s)) return null;
        var out = I.split(s, count);
        if (s.n <= 0) be.items[i] = null;
        return out;
      }, 3);
    var invC = Menu.inventoryContainer(inventory);
    var slots = [];
    slots.push(Menu.slot(fc, 0));
    slots.push(Menu.slot(fc, 1, {
      mayPlace: function (st) { return isFuel(st) || isBucketStack(st); },
      capFn: function (st) { return isBucketStack(st) ? 1 : 64; }
    }));
    slots.push(Menu.slot(fc, 2, {
      mayPlace: function () { return false; },
      onTake: function (pl) { Menu.furnaceAwardXp(be, pl); }
    }));
    for (var p = 9; p < 36; p++) slots.push(Menu.slot(invC, p));
    for (var h = 0; h < 9; h++) slots.push(Menu.slot(invC, h));

    var m = Menu.create(slots, {
      // `AbstractFurnaceMenu.quickMoveStack` — the result goes to the player (hotbar first); a
      // player slot goes to the INGREDIENT slot if it smelts in THIS furnace, else to the FUEL slot
      // if it burns, else across between backpack and hotbar; slots 0 and 1 go to the player.
      // ⚠ The chain is on WHAT THE STACK IS, not on whether the move worked: a stack that smelts
      // and finds the ingredient slot full stops there — it is not then offered to the fuel slot.
      quickMove: function (mm, pl, index) {
        var sl = mm.slots[index];
        if (!sl || !Menu.slotHas(sl)) return null;
        var live = Menu.slotGet(sl);
        var before = I.copy(live);
        var moved;
        if (index === 2) moved = Menu.moveItemStackTo(mm, live, 3, 39, true);
        else if (index > 2) {
          if (canSmelt(live)) moved = Menu.moveItemStackTo(mm, live, 0, 1, false);
          else if (isFuel(live)) moved = Menu.moveItemStackTo(mm, live, 1, 2, false);
          else if (index < 30) moved = Menu.moveItemStackTo(mm, live, 30, 39, false);
          else moved = Menu.moveItemStackTo(mm, live, 3, 30, false);
        } else moved = Menu.moveItemStackTo(mm, live, 3, 39, false);
        if (!moved) return null;
        if (I.isEmpty(live)) Menu.slotSet(sl, null); else Menu.slotSet(sl, live);
        if (!I.isEmpty(live) && live.n === before.n) return null;
        onTakeAlias(sl, pl, live);
        return before;
      }
    });
    m.be = be;
    m.inventory = inventory;
    return m;
  };

  // ── the hopper ───────────────────────────────────────────────────────────────────────────
  /**
   * `HopperMenu` — PASS 17 JOB 1 (G19b), D-419. Five slots in a row and then the player's own
   * inventory, on a screen only 133 pixels tall because there is nothing else on it.
   * ⚠ Transcribed from the public 1.18.2 `HopperMenu` (the same standing `chestMenu` and
   * `furnaceMenu` name for themselves — no javap on the machines this runs on), and every one of
   * the eleven slot ORIGINS it names is asserted against `hopper.png`'s own pixels by
   * `guicheck` §4g, which is what turns a transcription into a reading with a referee behind it.
   * ⚠ THE MENU HOLDS NO STATE. Its five slots are `be.items[0..4]`, so a hopper that keeps
   * pulling and pushing under an open screen moves items in front of you, and closing and
   * reopening cannot lose anything.
   * ⚠ NO `mayPlace` ANYWHERE. A hopper takes any item in any of its five slots — unlike the
   * furnace, whose fuel slot is picky — so the plain slot is the whole of it, and writing a
   * permissive `mayPlace` that always returns true would be a rule that cannot fail (D-305).
   */
  Menu.HOPPER_SIZE = 5;
  Menu.hopperMenu = function (be, inventory) {
    var I = inv();
    var hc = Menu.container(
      function (i) { return be.items[i] || null; },
      function (i, st) { be.items[i] = I.isEmpty(st) ? null : st; },
      function (i, count) {
        var st = be.items[i];
        if (I.isEmpty(st)) return null;
        var out = I.split(st, count);
        if (st.n <= 0) be.items[i] = null;
        return out;
      }, Menu.HOPPER_SIZE);
    var invC = Menu.inventoryContainer(inventory);
    var slots = [], i;
    for (i = 0; i < Menu.HOPPER_SIZE; i++) slots.push(Menu.slot(hc, i));
    for (var pB = 9; pB < 36; pB++) slots.push(Menu.slot(invC, pB));
    for (var h = 0; h < 9; h++) slots.push(Menu.slot(invC, h));

    var m = Menu.create(slots, {
      // `HopperMenu.quickMoveStack`, which is the short one: out of the hopper into the player
      // (hotbar first, `true`), or out of the player into the hopper. There is no third case and
      // no backpack/hotbar shuffle — vanilla does not give the hopper screen one.
      quickMove: function (mm, pl, index) {
        var sl = mm.slots[index];
        if (!sl || !Menu.slotHas(sl)) return null;
        var live = Menu.slotGet(sl);
        var before = I.copy(live);
        var moved = (index < Menu.HOPPER_SIZE)
          ? Menu.moveItemStackTo(mm, live, Menu.HOPPER_SIZE, mm.slots.length, true)
          : Menu.moveItemStackTo(mm, live, 0, Menu.HOPPER_SIZE, false);
        if (!moved) return null;
        if (I.isEmpty(live)) Menu.slotSet(sl, null); else Menu.slotSet(sl, live);
        if (!I.isEmpty(live) && live.n === before.n) return null;
        onTakeAlias(sl, pl, live);
        return before;
      }
    });
    m.be = be;
    m.inventory = inventory;
    return m;
  };


  /**
   * `AnvilScreenHandler` (G22d): slots 0,1 the inputs, 2 the output, 3..29 the backpack, 30..38
   * the hotbar. The rules are `NS.Anvil` (07zzp_anvil.js); this is the slot plumbing.
   * `ctx`: `{blockName(), onBlock(block)}` — the block under the screen and what to do when using
   * it chips or breaks it. `m.name` is the rename field's text, `m.update()` is `updateResult`.
   */
  Menu.anvilMenu = function (inventory, player, ctx) {
    var I = inv(), An = NS.Anvil;
    var inC = Menu.arrayContainer(2), outC = Menu.arrayContainer(1);
    var invC = Menu.inventoryContainer(inventory);
    var m;
    var slots = [];
    slots.push(Menu.slot(inC, 0, { onChanged: function (sl, st) {
      // `AnvilScreen.onSlotUpdate`: the field shows the new input's name (custom, else its own).
      if (m) { m.name = I.isEmpty(st) ? '' : (An.nameOf(st) !== null ? An.nameOf(st) : m.defaultName(st)); m.update(); }
    } }));
    slots.push(Menu.slot(inC, 1, { onChanged: function () { if (m) m.update(); } }));
    slots.push(Menu.slot(outC, 0, {
      mayPlace: function () { return false; }, noDrag: true,
      mayPickup: function (pl) {
        pl = pl || player;
        return !!(m.r && m.r.output && An.canTake(m.r.cost, pl.xpLevel | 0, !!pl.instabuild));
      },
      onTake: function (pl) {
        pl = pl || player;
        var r = m.r; if (!r) return;
        var st = { a: inC.get(0), b: inC.get(1) };
        var res = An.take(st, r, ctx && ctx.blockName ? ctx.blockName() : '', !!pl.instabuild, Math.random);
        inC.set(0, null); inC.set(1, I.isEmpty(st.b) ? null : st.b);
        if (res.levels > 0 && NS.Survival) {
          var lv = Math.max(0, (pl.xpLevel | 0) - res.levels), Sv = NS.Survival;
          pl.xpTotal = Sv.totalXpFor(lv) + Math.round((pl.xpProgress || 0) * Sv.xpNeeded(lv));
          Sv.syncXp(pl);
        }
        m.r = null;
        if (ctx && ctx.onBlock) ctx.onBlock(res.block);
        m.update();
      }
    }));
    for (var p = 9; p < 36; p++) slots.push(Menu.slot(invC, p));
    for (var h = 0; h < 9; h++) slots.push(Menu.slot(invC, h));
    m = Menu.create(slots, {
      // `ForgingScreenHandler.transferSlot`: output/inputs out to the player (3..38), a player
      // slot into the two inputs; there is no backpack/hotbar shuffle.
      quickMove: function (mm, pl, index) {
        var sl = mm.slots[index];
        if (!sl || !Menu.slotHas(sl)) return null;
        if (index === 2 && !Menu.slotMayPickup(sl, pl)) return null;
        var live = Menu.slotGet(sl), before = I.copy(live), moved;
        if (index < 3) moved = Menu.moveItemStackTo(mm, live, 3, 39, index === 2);
        else moved = Menu.moveItemStackTo(mm, live, 0, 2, false);
        if (!moved) return null;
        if (I.isEmpty(live)) Menu.slotSet(sl, null); else Menu.slotSet(sl, live);
        if (!I.isEmpty(live) && live.n === before.n) return null;
        onTakeAlias(sl, pl, live);
        return before;
      }
    });
    m.defaultName = function (s) { return NS.Hud && NS.Hud.displayName ? NS.Hud.displayName(NS.Items.nameOf(s.i), false) : NS.Items.nameOf(s.i); };
    m.inC = inC; m.outC = outC; m.inventory = inventory; m.name = ''; m.r = null;
    /** `updateResult`: recompute the output slot from the inputs and the name field. */
    m.update = function () {
      var pl = player || {};
      var r = An.compute(inC.get(0), inC.get(1), m.name, { instabuild: !!pl.instabuild, defaultName: m.defaultName });
      m.r = r;
      outC.set(0, r.output || null);
    };
    return m;
  };

  // ── the dispenser and the dropper ────────────────────────────────────────────────────────
  /**
   * `DispenserMenu` — PASS 17 JOB 1 (G19b), D-420. Nine slots in a 3x3 and then the player's own
   * inventory. ONE menu over two block entities: vanilla's `DropperScreen` is `DispenserScreen`
   * with a different title, and there is no `dropper.png` in the jar at all — `guicheck` §4h
   * asserts that rather than assuming it.
   * ⚠ Transcribed from the public 1.18.2 `DispenserMenu`; all 45 slot ORIGINS are asserted
   * against `dispenser.png`'s own pixels by `guicheck` §4h.
   * ⚠ THE GRID IS NOT A CRAFTING GRID. It has no result slot, no recipe and no ordering rule —
   * the nine are a plain container and `getRandomSlot` picks one uniformly when the block fires.
   */
  Menu.DISPENSER_SIZE = 9;
  Menu.dispenserMenu = function (be, inventory) {
    var I = inv();
    var dc = Menu.container(
      function (i) { return be.items[i] || null; },
      function (i, st) { be.items[i] = I.isEmpty(st) ? null : st; },
      function (i, count) {
        var st = be.items[i];
        if (I.isEmpty(st)) return null;
        var out = I.split(st, count);
        if (st.n <= 0) be.items[i] = null;
        return out;
      }, Menu.DISPENSER_SIZE);
    var invC = Menu.inventoryContainer(inventory);
    var slots = [], i;
    for (i = 0; i < Menu.DISPENSER_SIZE; i++) slots.push(Menu.slot(dc, i));
    for (var pB = 9; pB < 36; pB++) slots.push(Menu.slot(invC, pB));
    for (var h = 0; h < 9; h++) slots.push(Menu.slot(invC, h));

    var m = Menu.create(slots, {
      // `DispenserMenu.quickMoveStack` — the same two cases the hopper's has, over nine slots.
      quickMove: function (mm, pl, index) {
        var sl = mm.slots[index];
        if (!sl || !Menu.slotHas(sl)) return null;
        var live = Menu.slotGet(sl);
        var before = I.copy(live);
        var moved = (index < Menu.DISPENSER_SIZE)
          ? Menu.moveItemStackTo(mm, live, Menu.DISPENSER_SIZE, mm.slots.length, true)
          : Menu.moveItemStackTo(mm, live, 0, Menu.DISPENSER_SIZE, false);
        if (!moved) return null;
        if (I.isEmpty(live)) Menu.slotSet(sl, null); else Menu.slotSet(sl, live);
        if (!I.isEmpty(live) && live.n === before.n) return null;
        onTakeAlias(sl, pl, live);
        return before;
      }
    });
    m.be = be;
    m.inventory = inventory;
    return m;
  };

  // ── the enchanting table ─────────────────────────────────────────────────────────────────
  /**
   * `EnchantmentScreenHandler` — PLAN G22. Slot 0 the item (one only, anything), slot 1 the lapis, 2..28
   * the backpack, 29..37 the hotbar. Transcribed from `.decomp/net/minecraft/screen/
   * EnchantmentScreenHandler.java`; slot origins (15,47) and (35,47) are `guicheck`-style asserted by
   * `enchscreen`. UNLIKE the furnace this menu OWNS its two slots (vanilla's own `SimpleInventory(2)`), so
   * closing has to hand them back — `Hud.close` does, through `Menu.enchantClose`.
   * `ctx` = `{ x, y, z, blockAt(x,y,z) -> name }`, the table's cell and a way to read the shelves round it.
   * ⚠ THE OFFERS ARE A FUNCTION OF (seed, shelves, item), recomputed on every change of slot 0, exactly
   * `onContentChanged`. `m.offers = { power[3], id[3], level[3] }` is what the screen draws and the tooltips
   * name; pressing a button re-rolls from `seed + button` (`ET.rollFor`), which is why the clue holds.
   */
  var LAPIS = 'lapis_lazuli';
  Menu.enchantMenu = function (ctx, inventory, player) {
    var I = inv(), ET = NS.EnchTable;
    var ec = Menu.arrayContainer(2);
    var invC = Menu.inventoryContainer(inventory);
    var isLapis = function (st) { return !I.isEmpty(st) && NS.Items.nameOf(st.i) === LAPIS; };
    var slots = [];
    var m;
    var changed = function () { Menu.enchantRefresh(m); };
    slots.push(Menu.slot(ec, 0, { cap: 1, onChanged: changed }));
    slots.push(Menu.slot(ec, 1, { mayPlace: isLapis, onChanged: changed }));
    for (var p = 9; p < 36; p++) slots.push(Menu.slot(invC, p));
    for (var h = 0; h < 9; h++) slots.push(Menu.slot(invC, h));

    m = Menu.create(slots, {
      // `EnchantmentScreenHandler.transferSlot`: the two table slots go to the player (hotbar first);
      // lapis from the player goes to the lapis slot; anything else puts ONE of the stack into an empty
      // item slot and nothing more — the rest stays where it was.
      quickMove: function (mm, pl, index) {
        var sl = mm.slots[index];
        if (!sl || !Menu.slotHas(sl)) return null;
        var live = Menu.slotGet(sl);
        var before = I.copy(live);
        if (index === 0 || index === 1) {
          if (!Menu.moveItemStackTo(mm, live, 2, 38, true)) return null;
        } else if (isLapis(live)) {
          if (!Menu.moveItemStackTo(mm, live, 1, 2, true)) return null;
        } else {
          if (Menu.slotHas(mm.slots[0])) return null;
          var one = I.copy(live);
          one.n = 1;
          live.n -= 1;
          Menu.slotSet(mm.slots[0], one);
        }
        if (I.isEmpty(live)) Menu.slotSet(sl, null); else Menu.slotSet(sl, live);
        if (!I.isEmpty(live) && live.n === before.n) return null;
        onTakeAlias(sl, pl, live);
        return before;
      }
    });
    m.ctx = ctx;
    m.inventory = inventory;
    m.player = player || null;
    m.table = ec;
    if (player) {
      if (player.enchantSeed === undefined) player.enchantSeed = ET.newSeed();
      m.seed = player.enchantSeed | 0;
    } else m.seed = ET.newSeed();
    m.offers = { power: [0, 0, 0], id: [null, null, null], level: [-1, -1, -1] };
    m.shelves = 0;
    Menu.enchantRefresh(m);
    return m;
  };

  /** `onContentChanged`: recount the shelves and re-derive the three offers from slot 0. */
  Menu.enchantRefresh = function (m) {
    var ET = NS.EnchTable, st = m.table.get(0);
    var c = m.ctx;
    m.shelves = (c && c.blockAt) ? ET.countBookshelves(c.blockAt, c.x, c.y, c.z) : (c && c.shelves) | 0;
    m.offers = ET.offers(m.seed, m.shelves, st);
  };

  Menu.enchantLapis = function (m) {
    var st = m.table.get(1);
    return inv().isEmpty(st) ? 0 : st.n;
  };

  /**
   * `onButtonClick(player, i)` — true when an enchant happened. Costs: `i+1` lapis AND `i+1` levels minimum,
   * and the button's own required level; creative pays nothing. The new seed is drawn AFTER the roll so
   * the next offers are different, which is what stops one click farming the same table.
   */
  Menu.enchantClick = function (m, player, i) {
    var I = inv(), ET = NS.EnchTable;
    if (!(i >= 0 && i < 3)) return false;
    var item = m.table.get(0), lapis = m.table.get(1), cost = i + 1;
    var creative = !!(player && player.instabuild);
    if ((I.isEmpty(lapis) || lapis.n < cost) && !creative) return false;
    var lvl = player ? (player.xpLevel | 0) : 0, pow = m.offers.power[i];
    if (pow <= 0 || I.isEmpty(item) || ((lvl < cost || lvl < pow) && !creative)) return false;
    var info = ET.info(NS.Items.nameOf(item.i));
    var list = ET.rollFor(m.seed, i, info, pow);
    if (!list.length) return false;
    // `applyEnchantmentCosts`
    if (!creative) Menu.enchantPayLevels(player, cost);
    var target = item, book = info.book;
    if (book) {
      target = I.stack('enchanted_book', 1, 0, item.t);
      m.table.set(0, target);
    }
    for (var k = 0; k < list.length; k++) ET.addEnchantment(target, list[k].id, list[k].level, book);
    if (!creative) {
      lapis.n -= cost;
      m.table.set(1, lapis.n <= 0 ? null : lapis);
    }
    if (player) player.enchantSeed = ET.newSeed();
    m.seed = player && player.enchantSeed !== undefined ? player.enchantSeed | 0 : ET.newSeed();
    if (player && NS.Adv && NS.Adv.trigger) {
      var en = {}, sen = {}, tl = target.t || {};
      (tl.Enchantments || []).forEach(function (e) { en[e.id] = e.lvl; });
      (tl.StoredEnchantments || []).forEach(function (e) { sen[e.id] = e.lvl; });
      NS.Adv.trigger(player, 'minecraft:enchanted_item', { levels: cost, item: { id: 'minecraft:' + NS.Items.nameOf(target.i),
        count: target.n, nbt: target.t, enchants: en, storedEnchants: sen } });
    }
    Menu.enchantRefresh(m);
    var c = m.ctx;
    if (c && NS.Sound && NS.Sound.play) {
      NS.Sound.play('block.enchantment_table.use', { x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5, source: 'block',
        volume: 1, pitch: Math.random() * 0.1 + 0.9 });
    }
    return true;
  };

  /** `PlayerEntity.applyEnchantmentCosts`: `experienceLevel -= n`, floored at zero with the bar emptied. */
  Menu.enchantPayLevels = function (player, n) {
    var Sv = NS.Survival, lvl = (player.xpLevel | 0) - n;
    if (!Sv) { player.xpLevel = Math.max(0, lvl); return; }
    Sv.setLevelKeepBar(player, lvl);
  };

  /** `close` -> `dropInventory`: both table slots go back to the player, or onto the floor. */
  Menu.enchantClose = function (m, player) {
    var I = inv();
    for (var i = 0; i < 2; i++) {
      var st = m.table.get(i);
      if (!I.isEmpty(st)) {
        m.table.set(i, null);
        if (I.add(m.inventory, st) > 0) Menu.drop(m, st, player || m.player);
      }
    }
  };

  // ── the brewing stand ────────────────────────────────────────────────────────────────────
  /**
   * `BrewingStandScreenHandler` — PASS 17 JOB 1 (G19b). Five slots and then the player's own
   * inventory: 0..2 the bottles, 3 the ingredient, 4 the blaze powder, 5..31 the backpack, 32..40
   * the hotbar. Transcribed from `.decomp/net/minecraft/screen/BrewingStandScreenHandler.java`;
   * every slot ORIGIN is asserted against `brewing_stand.png`'s own pixels by `guicheck` §4k.
   * ⚠ THE MENU HOLDS NO STATE: the five slots are `be.items[0..4]`, and the two numbers the
   * screen draws (`brewTime`, `fuel`) are read straight off `be`.
   * ⚠ THE BREWING ITSELF IS NOT HERE. The tick that turns bottles into potions is G23's; until
   * it lands `be.brewTime` stays 0 and nothing moves. The ingredient slot's `mayPlace` IS
   * `BrewingRecipeRegistry.isValidIngredient` (07zzq_brewing.js, G23), read at call time —
   * this file loads first. `BREW_INGREDIENTS` is that registry's distinct ingredient list.
   */
  Menu.BREWING_SIZE = 5;
  Object.defineProperty(Menu, 'BREW_INGREDIENTS', { enumerable: true, get: function () { return NS.Brewing.ingredients(); } });
  var BREW_BOTTLES = ['potion', 'splash_potion', 'lingering_potion', 'glass_bottle'];
  function itemNamed(st, list) {
    if (inv().isEmpty(st)) return false;
    return list.indexOf(NS.Items.nameOf(st.i)) >= 0;
  }
  /** `PotionSlot.matches` */
  Menu.brewingIsBottle = function (st) { return itemNamed(st, BREW_BOTTLES); };
  /** `FuelSlot.matches` */
  Menu.brewingIsFuel = function (st) { return itemNamed(st, ['blaze_powder']); };
  /** `BrewingRecipeRegistry.isValidIngredient` */
  Menu.brewingIsIngredient = function (st) { return !inv().isEmpty(st) && NS.Brewing.isValidIngredient(st); };
  /** `BrewingStandScreen.drawBackground`'s fuel gauge width, 0..18. */
  Menu.brewingFuelWidth = function (be) {
    var w = ((18 * (be.fuel | 0) + 19) / 20) | 0;
    return w < 0 ? 0 : (w > 18 ? 18 : w);
  };
  /** The down-arrow's height, 0..28 — zero while nothing is brewing. */
  Menu.brewingArrowHeight = function (be) {
    var t = be.brewTime | 0;
    return t > 0 ? Math.trunc(Math.fround(28 * Math.fround(1 - Math.fround(t / 400)))) : 0;
  };
  Menu.BREW_BUBBLES = [29, 24, 20, 16, 11, 6, 0];
  /** The bubbles' height, 0..29 — they cycle every 14 ticks while brewing. */
  Menu.brewingBubbleHeight = function (be) {
    var t = be.brewTime | 0;
    return t > 0 ? Menu.BREW_BUBBLES[((t / 2) | 0) % 7] : 0;
  };
  Menu.brewingMenu = function (be, inventory) {
    var I = inv();
    var bc = Menu.container(
      function (i) { return be.items[i] || null; },
      function (i, st) { be.items[i] = I.isEmpty(st) ? null : st; },
      function (i, count) {
        var st = be.items[i];
        if (I.isEmpty(st)) return null;
        var out = I.split(st, count);
        if (st.n <= 0) be.items[i] = null;
        return out;
      }, Menu.BREWING_SIZE);
    var invC = Menu.inventoryContainer(inventory);
    var slots = [], i;
    for (i = 0; i < 3; i++) slots.push(Menu.slot(bc, i, { cap: 1, mayPlace: Menu.brewingIsBottle,
      // `BrewingStandScreenHandler.PotionSlot.onTakeItem` -> Criteria.BREWED_POTION.trigger(player, potion)
      onTake: function (pl, st) {
        if (pl && NS.Adv && NS.Adv.trigger) NS.Adv.trigger(pl, 'minecraft:brewed_potion', { player: pl, potion: NS.Brewing.potionOf(st) });
      } }));
    slots.push(Menu.slot(bc, 3, { mayPlace: Menu.brewingIsIngredient }));
    slots.push(Menu.slot(bc, 4, { mayPlace: Menu.brewingIsFuel }));
    for (var pB = 9; pB < 36; pB++) slots.push(Menu.slot(invC, pB));
    for (var h = 0; h < 9; h++) slots.push(Menu.slot(invC, h));

    var m = Menu.create(slots, {
      // `BrewingStandScreenHandler.transferSlot`. ⚠ THE FUEL BRANCH IS VANILLA'S OWN ODDITY and is
      // kept: blaze powder tries the fuel slot, and a SUCCESSFUL move there returns EMPTY (the
      // `||` short-circuits into the `return`), which stops the shift-click repeat loop; only
      // when the fuel slot took nothing does it fall to the ingredient slot, and if THAT also
      // refuses (or the powder is not an ingredient at all) the branch ends with the stack
      // untouched and the count unchanged, so the same EMPTY comes back.
      quickMove: function (mm, pl, index) {
        var sl = mm.slots[index];
        if (!sl || !Menu.slotHas(sl)) return null;
        var live = Menu.slotGet(sl);
        var before = I.copy(live);
        var moved;
        if (index <= 4) {
          moved = Menu.moveItemStackTo(mm, live, 5, 41, true);
          if (!moved) return null;
        } else if (Menu.brewingIsFuel(before)) {
          if (Menu.moveItemStackTo(mm, live, 4, 5, false) ||
              (Menu.brewingIsIngredient(live) && !Menu.moveItemStackTo(mm, live, 3, 4, false))) {
            if (I.isEmpty(live)) Menu.slotSet(sl, null); else Menu.slotSet(sl, live);
            return null;
          }
        } else if (Menu.brewingIsIngredient(live)) {
          if (!Menu.moveItemStackTo(mm, live, 3, 4, false)) return null;
        } else if (Menu.brewingIsBottle(before) && before.n === 1) {
          if (!Menu.moveItemStackTo(mm, live, 0, 3, false)) return null;
        } else if (index < 32) {
          if (!Menu.moveItemStackTo(mm, live, 32, 41, false)) return null;
        } else if (index < 41) {
          if (!Menu.moveItemStackTo(mm, live, 5, 32, false)) return null;
        } else if (!Menu.moveItemStackTo(mm, live, 5, 41, false)) return null;
        if (I.isEmpty(live)) Menu.slotSet(sl, null); else Menu.slotSet(sl, live);
        if (!I.isEmpty(live) && live.n === before.n) return null;
        onTakeAlias(sl, pl, live);
        return before;
      }
    });
    m.be = be;
    m.inventory = inventory;
    return m;
  };

  // ── the grindstone ───────────────────────────────────────────────────────────────────────
  /**
   * `GrindstoneScreenHandler` — G22e (#197). Slots 0/1 the inputs, 2 the result, 3..29 the
   * backpack, 30..38 the hotbar. The result is `NS.Grind.result` of the two inputs, refreshed by
   * `m.refresh()` (every input change, and the HUD before each click and draw); taking it runs
   * `NS.Grind.experience`, spawns the XP orbs at `pos` and empties both inputs. Inputs are the
   * menu's own, so closing hands them back (`Hud.close`).
   */
  Menu.grindMenu = function (inventory, pos) {
    var I = inv(), G = NS.Grind;
    var input = Menu.arrayContainer(2), result = Menu.arrayContainer(1);
    var invC = Menu.inventoryContainer(inventory);
    var never = function () { return false; };
    var m;
    function refresh() {
      var r = G.result(input.get(0), input.get(1));
      result.set(0, r && !I.isEmpty(r) ? r : null);
    }
    var inOpts = { mayPlace: G.canInsert, onChanged: refresh };
    var slots = [Menu.slot(input, 0, inOpts), Menu.slot(input, 1, inOpts)];
    slots.push(Menu.slot(result, 0, { mayPlace: never, noDrag: true,
      onTake: function () {
        var xp = G.experience(input.get(0), input.get(1));
        if (xp > 0 && pos && NS.Xp && NS.Xp.spawn) NS.Xp.spawn(pos.x, pos.y, pos.z, xp);
        input.set(0, null); input.set(1, null);
        refresh();
      } }));
    for (var p = 9; p < 36; p++) slots.push(Menu.slot(invC, p));
    for (var h = 0; h < 9; h++) slots.push(Menu.slot(invC, h));

    m = Menu.create(slots, {
      // `GrindstoneScreenHandler.transferSlot`
      quickMove: function (mm, pl, index) {
        var sl = mm.slots[index];
        if (!sl || !Menu.slotHas(sl)) return null;
        var live = Menu.slotGet(sl);
        var before = I.copy(live);
        var in0 = input.get(0), in1 = input.get(1);
        if (index === 2) {
          if (!Menu.moveItemStackTo(mm, live, 3, 39, true)) return null;
        } else if (index > 1) {
          if (!I.isEmpty(in0) && !I.isEmpty(in1)) {
            if (index < 30) { if (!Menu.moveItemStackTo(mm, live, 30, 39, false)) return null; }
            else if (!Menu.moveItemStackTo(mm, live, 3, 30, false)) return null;
          } else if (!Menu.moveItemStackTo(mm, live, 0, 2, false)) return null;
        } else if (!Menu.moveItemStackTo(mm, live, 3, 39, false)) return null;
        if (I.isEmpty(live)) Menu.slotSet(sl, null); else Menu.slotSet(sl, live);
        if (!I.isEmpty(live) && live.n === before.n) return null;
        onTakeAlias(sl, pl, live);
        return before;
      }
    });
    m.input = input;
    m.result = result;
    m.inventory = inventory;
    m.refresh = refresh;
    return m;
  };

  // ── the stonecutter ──────────────────────────────────────────────────────────────────────
  /**
   * `StonecutterScreenHandler`. Slots 0 the input, 1 the output, 2..28 the backpack, 29..37 the
   * hotbar. `m.recipes` is `availableRecipes` (every STONECUTTING recipe whose ingredient matches
   * the input), `m.selected` the `selectedRecipe` property (-1 = none). `m.onButtonClick(i)` picks
   * a recipe; the output holds that recipe's result and taking it spends ONE input item.
   * ⚠ `updateInput` only runs when the input's ITEM changes (`isOf`), not its count.
   */
  Menu.stonecutterMenu = function (inventory, pos) {
    var I = inv(), R = NS.Recipes;
    var input = Menu.arrayContainer(1), output = Menu.arrayContainer(1);
    var invC = Menu.inventoryContainer(inventory);
    var never = function () { return false; };
    var m, lastItem = -1;
    function inBounds(i) { return i >= 0 && i < m.recipes.length; }
    function populateResult() {
      if (m.recipes.length && inBounds(m.selected)) {
        var r = m.recipes[m.selected].result;
        output.set(0, I.copy(r));
      } else output.set(0, null);
    }
    function onContentChanged() {
      var st = input.get(0), it = st && !I.isEmpty(st) ? st.i : -1;
      if (it !== lastItem) {
        lastItem = it;
        m.recipes = []; m.selected = -1; output.set(0, null);
        if (it !== -1) m.recipes = R.stonecuttingFor(st);
      }
    }
    var slots = [
      Menu.slot(input, 0, { onChanged: onContentChanged }),
      Menu.slot(output, 0, { mayPlace: never, noDrag: true,
        onTake: function () {
          var st = input.get(0);
          if (st && !I.isEmpty(st)) {
            var one = I.split(st, 1);
            if (st.n <= 0) input.set(0, null);
            if (one && !I.isEmpty(one)) { onContentChanged(); populateResult(); }
          }
          onContentChanged();
        } })
    ];
    for (var p = 9; p < 36; p++) slots.push(Menu.slot(invC, p));
    for (var h = 0; h < 9; h++) slots.push(Menu.slot(invC, h));

    m = Menu.create(slots, {
      // `StonecutterScreenHandler.transferSlot`
      quickMove: function (mm, pl, index) {
        var sl = mm.slots[index];
        if (!sl || !Menu.slotHas(sl)) return null;
        var live = Menu.slotGet(sl);
        var before = I.copy(live);
        if (index === 1) {
          if (!Menu.moveItemStackTo(mm, live, 2, 38, true)) return null;
        } else if (index === 0) {
          if (!Menu.moveItemStackTo(mm, live, 2, 38, false)) return null;
        } else if (R.stonecuttingFor(live).length) {
          if (!Menu.moveItemStackTo(mm, live, 0, 1, false)) return null;
        } else if (index >= 2 && index < 29) {
          if (!Menu.moveItemStackTo(mm, live, 29, 38, false)) return null;
        } else if (index >= 29 && index < 38 && !Menu.moveItemStackTo(mm, live, 2, 29, false)) return null;
        if (I.isEmpty(live)) Menu.slotSet(sl, null); else Menu.slotSet(sl, live);
        if (!I.isEmpty(live) && live.n === before.n) return null;
        onTakeAlias(sl, pl, live);
        return before;
      }
    });
    m.input = input;
    m.output = output;
    m.inventory = inventory;
    m.pos = pos || null;
    m.recipes = [];
    m.selected = -1;
    m.refresh = onContentChanged;
    m.canCraft = function () { return !!(input.get(0) && m.recipes.length); };
    m.onButtonClick = function (i) {
      if (inBounds(i)) { m.selected = i; populateResult(); }
      return true;
    };
    return m;
  };

  // ── the loom ─────────────────────────────────────────────────────────────────────────────
  /**
   * `LoomScreenHandler` — G19e-loom. Slots 0 banner · 1 dye · 2 pattern item · 3 output · 4..30
   * backpack · 31..39 hotbar. `m.selected` is the handler's `selectedPattern` Property; the output
   * is `NS.Loom.result`. `m.button(n)` is `onButtonClick`. Inputs are the menu's own (`Hud.close`).
   */
  Menu.loomMenu = function (inventory) {
    var I = inv(), L = NS.Loom;
    var input = Menu.arrayContainer(3), output = Menu.arrayContainer(1);
    var invC = Menu.inventoryContainer(inventory);
    var never = function () { return false; };
    var m;
    function update() {
      if (m.selected > 0) {
        var r = L.result(input.get(0), input.get(1), m.selected);
        var cur = output.get(0);
        if (!(r === null && !cur) && JSON.stringify(r) !== JSON.stringify(cur)) output.set(0, r);
      }
    }
    // `onContentChanged`
    function changed() {
      var banner = input.get(0), dye = input.get(1), pat = input.get(2), out = output.get(0);
      if (!out || (!I.isEmpty(banner) && !I.isEmpty(dye) && m.selected > 0 &&
          (m.selected < L.COUNT - L.HAS_PATTERN_ITEM_COUNT || !I.isEmpty(pat)))) {
        m.selected = L.reselect(banner, pat, m.selected);
      } else {
        output.set(0, null);
        m.selected = 0;
      }
      update();
    }
    var slots = [
      Menu.slot(input, 0, { mayPlace: L.isBanner, onChanged: changed }),
      Menu.slot(input, 1, { mayPlace: L.isDye, onChanged: changed }),
      Menu.slot(input, 2, { mayPlace: L.isPatternItem, onChanged: changed }),
      Menu.slot(output, 0, { mayPlace: never, noDrag: true,
        onTake: function () {                      // `outputSlot.onTakeItem`
          var b = input.get(0), d = input.get(1);
          if (b) { b.n--; input.set(0, b.n > 0 ? b : null); }
          if (d) { d.n--; input.set(1, d.n > 0 ? d : null); }
          if (!input.get(0) || !input.get(1)) m.selected = 0;
          changed();
        } })
    ];
    for (var p = 9; p < 36; p++) slots.push(Menu.slot(invC, p));
    for (var h = 0; h < 9; h++) slots.push(Menu.slot(invC, h));
    m = Menu.create(slots, {
      // `LoomScreenHandler.transferSlot`
      quickMove: function (mm, pl, index) {
        var sl = mm.slots[index];
        if (!sl || !Menu.slotHas(sl)) return null;
        var live = Menu.slotGet(sl), before = I.copy(live);
        if (index === 3) {
          if (!Menu.moveItemStackTo(mm, live, 4, 40, true)) return null;
        } else if (index > 2) {
          if (L.isBanner(live)) { if (!Menu.moveItemStackTo(mm, live, 0, 1, false)) return null; }
          else if (L.isDye(live)) { if (!Menu.moveItemStackTo(mm, live, 1, 2, false)) return null; }
          else if (L.isPatternItem(live)) { if (!Menu.moveItemStackTo(mm, live, 2, 3, false)) return null; }
          else if (index >= 4 && index < 31) { if (!Menu.moveItemStackTo(mm, live, 31, 40, false)) return null; }
          else if (index >= 31 && index < 40 && !Menu.moveItemStackTo(mm, live, 4, 31, false)) return null;
        } else if (!Menu.moveItemStackTo(mm, live, 4, 40, false)) return null;
        if (I.isEmpty(live)) Menu.slotSet(sl, null); else Menu.slotSet(sl, live);
        if (!I.isEmpty(live) && live.n === before.n) return null;
        onTakeAlias(sl, pl, live);
        return before;
      }
    });
    m.selected = 0;
    m.input = input;
    m.output = output;
    m.inventory = inventory;
    /** `onButtonClick` */
    m.button = function (n) {
      if (!L.validButton(n)) return false;
      m.selected = n;
      update();
      return true;
    };
    return m;
  };

  // ── the cartography table ────────────────────────────────────────────────────────────────
  /**
   * `CartographyTableScreenHandler.updateResult` as a pure function: the result stack for a map
   * and a material, or null. Paper zooms (not locked, scale < 4: tag `map_scale_direction` 1),
   * a glass pane locks (not locked: `map_to_lock`), an empty map clones (count 2). The map's
   * scale and lock are its tag's `scale` / `locked`.
   */
  Menu.cartographyResult = function (map, material) {
    var I = inv(), It = NS.Items;
    if (I.isEmpty(map) || I.isEmpty(material)) return null;
    if (map.i !== It.of('filled_map')) return null;
    var tag = I.tagOf(map) || {}, scale = tag.scale | 0, locked = !!tag.locked;
    var mat = It.nameOf(material.i), out;
    if (mat === 'paper' && !locked && scale < 4) {
      out = I.copy(map); out.n = 1;
      out = I.withTag(out, Object.assign(I.cloneTag(tag), { map_scale_direction: 1 }));
    } else if (mat === 'glass_pane' && !locked) {
      out = I.copy(map); out.n = 1;
      out = I.withTag(out, Object.assign(I.cloneTag(tag), { map_to_lock: true }));
    } else if (mat === 'map') {
      out = I.copy(map); out.n = 2;
    } else return null;
    return out;
  };

  /**
   * `CartographyTableScreenHandler` — slots 0 map, 1 material, 2 result, 3..29 backpack, 30..38
   * hotbar. Taking the result takes one of each input. Inputs are the menu's own (`Hud.close`
   * hands them back).
   */
  Menu.cartographyMenu = function (inventory) {
    var I = inv(), It = NS.Items;
    var input = Menu.arrayContainer(2), result = Menu.arrayContainer(1);
    var invC = Menu.inventoryContainer(inventory);
    var never = function () { return false; };
    var m;
    function refresh() { result.set(0, Menu.cartographyResult(input.get(0), input.get(1))); }
    function takeOne(i) {
      var s = input.get(i);
      if (I.isEmpty(s)) return;
      s.n--; input.set(i, s.n > 0 ? s : null);
    }
    var slots = [
      Menu.slot(input, 0, { mayPlace: function (s) { return s.i === It.of('filled_map'); }, onChanged: refresh }),
      Menu.slot(input, 1, { mayPlace: function (s) {
        var n = It.nameOf(s.i); return n === 'paper' || n === 'map' || n === 'glass_pane'; }, onChanged: refresh }),
      Menu.slot(result, 0, { mayPlace: never, noDrag: true,
        onTake: function () { takeOne(0); takeOne(1); refresh(); } })
    ];
    for (var p = 9; p < 36; p++) slots.push(Menu.slot(invC, p));
    for (var h = 0; h < 9; h++) slots.push(Menu.slot(invC, h));
    m = Menu.create(slots, {
      // `CartographyTableScreenHandler.transferSlot`
      quickMove: function (mm, pl, index) {
        var sl = mm.slots[index];
        if (!sl || !Menu.slotHas(sl)) return null;
        var live = Menu.slotGet(sl), before = I.copy(live), nm = It.nameOf(live.i);
        if (index === 2) { if (!Menu.moveItemStackTo(mm, live, 3, 39, true)) return null; }
        else if (index > 1) {
          if (nm === 'filled_map') { if (!Menu.moveItemStackTo(mm, live, 0, 1, false)) return null; }
          else if (nm === 'paper' || nm === 'map' || nm === 'glass_pane') { if (!Menu.moveItemStackTo(mm, live, 1, 2, false)) return null; }
          else if (index < 30) { if (!Menu.moveItemStackTo(mm, live, 30, 39, false)) return null; }
          else if (!Menu.moveItemStackTo(mm, live, 3, 30, false)) return null;
        } else if (!Menu.moveItemStackTo(mm, live, 3, 39, false)) return null;
        if (I.isEmpty(live)) Menu.slotSet(sl, null); else Menu.slotSet(sl, live);
        if (!I.isEmpty(live) && live.n === before.n) return null;
        onTakeAlias(sl, pl, live);
        return before;
      }
    });
    m.input = input; m.result = result; m.inventory = inventory; m.refresh = refresh;
    return m;
  };

})(MCL);
