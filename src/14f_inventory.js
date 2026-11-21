// 14f_inventory.js — PLAN G8, part one: the item stack and the player's inventory.
//
// MAIN THREAD ONLY, and no DOM: a stack is a plain object and the inventory is an array, so a
// whole session of picking things up runs inside `invcheck` without a browser.
//
// ⚠ WHAT IS HERE AND WHAT IS NOT. This is the STORAGE half of G8 — stacks, the 41-slot index
// space, and `Inventory.add`'s search order. The CLICK half (`AbstractContainerMenu.doClick`:
// pickup, quick-move, swap, clone, throw, and the quick-craft DRAG with its three types and
// three stages) is 777 instructions of vanilla and is deliberately not started here; its
// disassembly is in `tools/golden/javap.AbstractContainerMenu.txt` for the session that does it.
//
// ⚠ THE SEARCH ORDER IS BYTECODE-VERIFIED, NOT REMEMBERED (D-261). `Inventory.getSlotWithRemaining
// Space` asks, in this order: the SELECTED slot, then slot 40 — the OFFHAND — and only then does
// it scan 0..35. Getting that wrong is invisible in every count and obvious the moment you pick
// something up while holding a partial stack of it.

(function (NS) {
  'use strict';

  var Inv = NS.Inventory = {
    // vanilla's own index space, and the reason 40 appears by name in the search order
    MAIN: 36,            // 0..35, of which 0..8 are the hotbar
    HOTBAR: 9,
    ARMOR_START: 36,     // 36..39: feet, legs, chest, head
    OFFHAND: 40,
    SIZE: 41,
    MAX_STACK: 64,       // `Inventory.getMaxStackSize()` — the container's own cap
    EMPTY: null
  };

  /**
   * stack(name|index, count, damage, tag) — a stack, or EMPTY when the count runs out.
   *
   * ⚠ `tag` IS THE NBT (D-267), and it is a plain JSON-able object or null. G9's thirteen
   * `crafting_special_*` recipes are the reason it exists: dyed leather carries `display.color`,
   * a firework carries `Explosion`, a written book carries `generation`, a tipped arrow carries
   * `Potion`. Before this a stack was (item, count, damage) and none of them could be expressed.
   * ⚠ It is a VALUE, not a reference: `Inv.copy` deep-copies it and `Inv.split` gives the new
   * stack its own copy, because two stacks that share a tag object are one edit away from
   * silently changing each other — the classic NBT bug in every clone.
   */
  Inv.stack = function (item, count, damage, tag) {
    var IT = NS.Items;
    var i = (typeof item === 'string') ? (IT ? IT.of(item) : -1) : (item | 0);
    if (i < 0 || (count | 0) <= 0) return Inv.EMPTY;
    var s = { i: i, n: count | 0, d: damage | 0 };
    if (tag !== undefined && tag !== null) s.t = Inv.cloneTag(tag);
    return s;
  };

  /** A deep copy of a tag. Plain data only — objects, arrays, numbers, strings, booleans. */
  Inv.cloneTag = function (t) {
    if (t === null || typeof t !== 'object') return t;
    if (Array.isArray(t)) {
      var a = new Array(t.length);
      for (var k = 0; k < t.length; k++) a[k] = Inv.cloneTag(t[k]);
      return a;
    }
    var o = {}, keys = Object.keys(t);
    for (var j = 0; j < keys.length; j++) o[keys[j]] = Inv.cloneTag(t[keys[j]]);
    return o;
  };

  /**
   * Tag equality, and it must be ORDER-INSENSITIVE over object keys: vanilla compares CompoundTags
   * by content, and two stacks built by different code paths will not agree about key order.
   * Arrays ARE order-sensitive — a banner's pattern list is a sequence, not a set.
   */
  Inv.tagsEqual = function (a, b) {
    if (a === b) return true;
    if (a === null || a === undefined) return b === null || b === undefined;
    if (b === null || b === undefined) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return a === b;
    var aArr = Array.isArray(a), bArr = Array.isArray(b);
    if (aArr !== bArr) return false;
    if (aArr) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!Inv.tagsEqual(a[i], b[i])) return false;
      return true;
    }
    var ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    for (var k = 0; k < ka.length; k++) {
      if (ka[k] !== kb[k]) return false;
      if (!Inv.tagsEqual(a[ka[k]], b[ka[k]])) return false;
    }
    return true;
  };

  /** The tag of a stack, or null. Empty stacks have none. */
  Inv.tagOf = function (s) { return (!s || s.t === undefined) ? null : s.t; };
  Inv.hasTag = function (s) { return !!(s && s.t !== undefined && s.t !== null); };
  /** Return a COPY of `s` carrying `tag` — never mutates the original. */
  Inv.withTag = function (s, tag) {
    if (Inv.isEmpty(s)) return Inv.EMPTY;
    var o = { i: s.i, n: s.n, d: s.d };
    if (tag !== undefined && tag !== null) o.t = Inv.cloneTag(tag);
    return o;
  };

  Inv.isEmpty = function (s) { return !s || s.n <= 0; };
  Inv.itemName = function (s) { return Inv.isEmpty(s) ? 'air' : NS.Items.nameOf(s.i); };

  /**
   * `ItemStack.isSameItemSameTags` — the same item and the same tags. MC-Lite has no NBT yet, so
   * the tag half is the DAMAGE, which is the only per-stack state that exists. ⚠ When NBT
   * arrives this is the one function that must learn about it; everything else asks it.
   */
  Inv.isSameItemSameTags = function (a, b) {
    if (Inv.isEmpty(a) || Inv.isEmpty(b)) return false;
    // ⚠ D-267: the tag is now part of the answer. Two dyed leather caps of different colours are
    // the same ITEM and do not stack, and getting this wrong merges them into one.
    return a.i === b.i && a.d === b.d && Inv.tagsEqual(Inv.tagOf(a), Inv.tagOf(b));
  };
  /** `ItemStack.isSameItem` — the item alone, tags and damage ignored. */
  Inv.isSameItem = function (a, b) {
    if (Inv.isEmpty(a) || Inv.isEmpty(b)) return false;
    return a.i === b.i;
  };

  /**
   * ⚠ THE ITEM'S SIZE, NOT THE CONTAINER'S, AND EVEN AT COUNT ZERO. `ItemStack.getMaxStackSize`
   * reads `getItem().getMaxStackSize()` and never asks whether the stack is empty — which
   * matters, because `addResource` makes a ZERO-COUNT stack of the incoming item and then asks
   * how much fits. Answering 64 there put twenty ender pearls in one slot.
   */
  Inv.maxStackSize = function (s) {
    if (!s || s.i === undefined) return Inv.MAX_STACK;
    return NS.Items.maxStack(s.i);
  };

  /** `ItemStack.isStackable`: more than one fits, and it is not a damaged tool. */
  Inv.isStackable = function (s) {
    if (Inv.isEmpty(s)) return false;
    return Inv.maxStackSize(s) > 1 && (!NS.Items.durability[s.i] || s.d === 0);
  };

  Inv.copy = function (s) {
    if (Inv.isEmpty(s)) return Inv.EMPTY;
    var o = { i: s.i, n: s.n, d: s.d };
    if (s.t !== undefined && s.t !== null) o.t = Inv.cloneTag(s.t);
    return o;
  };

  /** `ItemStack.split(n)` — take up to n off this stack and return them as a new one. */
  Inv.split = function (s, n) {
    if (Inv.isEmpty(s) || n <= 0) return Inv.EMPTY;
    var take = Math.min(n, s.n);
    s.n -= take;
    var o = { i: s.i, n: take, d: s.d };
    if (s.t !== undefined && s.t !== null) o.t = Inv.cloneTag(s.t);   // its OWN copy (D-267)
    return o;
  };

  Inv.grow = function (s, n) { if (!Inv.isEmpty(s)) s.n += n; return s; };
  Inv.shrink = function (s, n) { if (!Inv.isEmpty(s)) s.n -= n; return s; };

  // ── the inventory itself ──────────────────────────────────────────────────────────────────
  Inv.create = function () {
    var inv = { slots: new Array(Inv.SIZE), selected: 0 };
    for (var i = 0; i < Inv.SIZE; i++) inv.slots[i] = Inv.EMPTY;
    return inv;
  };

  Inv.getItem = function (inv, i) { return (i < 0 || i >= Inv.SIZE) ? Inv.EMPTY : inv.slots[i]; };
  Inv.setItem = function (inv, i, s) { if (i >= 0 && i < Inv.SIZE) inv.slots[i] = Inv.isEmpty(s) ? Inv.EMPTY : s; };
  Inv.selectedItem = function (inv) { return inv.slots[inv.selected]; };
  Inv.isHotbarSlot = function (i) { return i >= 0 && i < Inv.HOTBAR; };

  /** `Inventory.hasRemainingSpaceForItem(existing, incoming)`, exactly. */
  Inv.hasRemainingSpaceForItem = function (existing, incoming) {
    return !Inv.isEmpty(existing)
        && Inv.isSameItemSameTags(existing, incoming)
        && Inv.isStackable(existing)
        && existing.n < Inv.maxStackSize(existing)
        && existing.n < Inv.MAX_STACK;
  };

  /**
   * `Inventory.getSlotWithRemainingSpace` — ⚠ THE ORDER IS THE POINT: the selected slot, then the
   * OFFHAND at 40, then a scan of 0..35. Read out of the 1.18.2 bytecode (D-261), because it is a
   * rule no count can see: it decides which of two identical slots grows when you walk over a
   * dropped item, and every clone that guesses it gets "the wrong stack filled up" reports.
   */
  Inv.getSlotWithRemainingSpace = function (inv, s) {
    if (Inv.hasRemainingSpaceForItem(Inv.getItem(inv, inv.selected), s)) return inv.selected;
    if (Inv.hasRemainingSpaceForItem(Inv.getItem(inv, Inv.OFFHAND), s)) return Inv.OFFHAND;
    for (var i = 0; i < Inv.MAIN; i++) if (Inv.hasRemainingSpaceForItem(inv.slots[i], s)) return i;
    return -1;
  };

  /** `Inventory.getFreeSlot` — the first empty MAIN slot; armour and offhand are not free space. */
  Inv.getFreeSlot = function (inv) {
    for (var i = 0; i < Inv.MAIN; i++) if (Inv.isEmpty(inv.slots[i])) return i;
    return -1;
  };

  /**
   * `Inventory.addResource(slot, stack)` — move what fits into that slot, return how many moved.
   * The cap is the smaller of the ITEM's stack size and the INVENTORY's, both minus what is there.
   */
  Inv.addResource = function (inv, slot, s) {
    var existing = Inv.getItem(inv, slot);
    if (Inv.isEmpty(existing)) {
      // ⚠ VANILLA MAKES THE EMPTY STACK FIRST — `new ItemStack(stack.getItem(), 0)` — and the
      // reason is not style: `maxStackSize` of an EMPTY stack is the container's 64, while of a
      // zero-count stack OF THAT ITEM it is the item's own 16 for an ender pearl. Writing it
      // through `setItem` would also drop it, because a zero-count stack IS empty by definition;
      // it goes into the slot array directly and is filled in the same breath.
      existing = { i: s.i, n: 0, d: s.d };
      if (s.t !== undefined && s.t !== null) existing.t = Inv.cloneTag(s.t);
      inv.slots[slot] = existing;
    }
    var room = Math.min(s.n, Inv.maxStackSize(existing) - existing.n, Inv.MAX_STACK - existing.n);
    if (room <= 0) {
      if (existing.n === 0) inv.slots[slot] = Inv.EMPTY;   // put the slot back as we found it
      return 0;
    }
    existing.n += room;
    s.n -= room;
    return room;
  };

  /**
   * add(inv, stack) — pick this up. Returns what is LEFT OVER, which is what a dropped item does
   * with the remainder. Vanilla loops: fill a partial stack, else take a free slot, else give up.
   */
  Inv.add = function (inv, s) {
    if (Inv.isEmpty(s)) return 0;
    var guard = 0;
    while (s.n > 0 && guard++ < Inv.SIZE * 64) {
      var slot = Inv.getSlotWithRemainingSpace(inv, s);
      if (slot === -1) slot = Inv.getFreeSlot(inv);
      if (slot === -1) break;
      if (Inv.addResource(inv, slot, s) === 0) break;
    }
    return s.n;
  };

  /** `Inventory.removeItem(slot, count)` — take up to `count` out and hand them back. */
  Inv.removeItem = function (inv, slot, count) {
    var s = Inv.getItem(inv, slot);
    if (Inv.isEmpty(s)) return Inv.EMPTY;
    var out = Inv.split(s, count);
    if (s.n <= 0) Inv.setItem(inv, slot, Inv.EMPTY);
    return out;
  };

  /** How many of this item the inventory holds, over every slot. */
  Inv.countOf = function (inv, item) {
    var IT = NS.Items;
    var idx = (typeof item === 'string') ? IT.of(item) : (item | 0);
    var n = 0;
    for (var i = 0; i < Inv.SIZE; i++) {
      var s = inv.slots[i];
      if (!Inv.isEmpty(s) && s.i === idx) n += s.n;
    }
    return n;
  };

  /** The first slot holding this item, or −1 — what "do I have one of these" asks. */
  Inv.findSlot = function (inv, item) {
    var IT = NS.Items;
    var idx = (typeof item === 'string') ? IT.of(item) : (item | 0);
    for (var i = 0; i < Inv.SIZE; i++) {
      var s = inv.slots[i];
      if (!Inv.isEmpty(s) && s.i === idx) return i;
    }
    return -1;
  };

  // ── persistence (PLAN G14, D-288) ─────────────────────────────────────────────────────────
  //
  // ⚠ A STACK IS SAVED BY ITEM NAME, NEVER BY ITEM ID, for exactly the reason `16b_save.js`
  // saves a block by name and local state: `NS.Items` is GENERATED from the jar, so `s.i` is an
  // index into a table that the next build can reorder or grow. A save keyed by that number is
  // a save that silently turns your diamond pickaxe into whatever now holds index 704. The block
  // registry learned this in session 2 (D-107); the item registry is the same argument one
  // registry over, and `savecheck` now shuffles BOTH between save and load.
  //
  // ⚠ The wire form is an OBJECT with omitted defaults, not a positional array:
  //     { n: 'diamond_pickaxe' }                  one, undamaged, no NBT
  //     { n: 'cobblestone', c: 64 }
  //     { n: 'diamond_pickaxe', d: 137 }
  //     { n: 'firework_rocket', c: 3, t: {...} }
  // An empty slot is `null`. A positional array would be two bytes smaller a slot and would need
  // a rule about arity that a future field can break; 41 slots of this cost about a kilobyte of
  // a five-megabyte budget, and a human looking at a broken save can read it.

  /** One stack -> plain JSON, or null. */
  Inv.stackToJSON = function (s) {
    var IT = NS.Items;
    if (Inv.isEmpty(s) || !IT || !IT.ready) return null;
    var name = IT.nameOf(s.i);
    if (!name) return null;                       // an id with no name cannot be written honestly
    var o = { n: name };
    if (s.n !== 1) o.c = s.n | 0;
    if (s.d) o.d = s.d | 0;
    if (s.t !== undefined && s.t !== null) o.t = Inv.cloneTag(s.t);
    return o;
  };

  /**
   * Plain JSON -> one stack, or EMPTY.
   * ⚠ AN ITEM THIS BUILD NO LONGER HAS IS DROPPED, NOT GUESSED. `Inv.stack` returns EMPTY for an
   * unknown name, which is the honest outcome: the alternative is inventing a substitute, and a
   * chest that quietly refills itself with the wrong thing is the failure this whole format
   * exists to prevent.
   */
  Inv.stackFromJSON = function (o) {
    if (!o || typeof o !== 'object' || typeof o.n !== 'string') return Inv.EMPTY;
    var count = (o.c === undefined) ? 1 : (o.c | 0);
    if (count <= 0) return Inv.EMPTY;
    return Inv.stack(o.n, count, (o.d | 0), (o.t === undefined ? null : o.t));
  };

  /** The whole 41-slot inventory -> plain JSON. */
  Inv.toJSON = function (inv) {
    if (!inv || !inv.slots) return null;
    var out = new Array(Inv.SIZE);
    for (var i = 0; i < Inv.SIZE; i++) out[i] = Inv.stackToJSON(inv.slots[i]);
    return { size: Inv.SIZE, selected: inv.selected | 0, slots: out };
  };

  /**
   * Plain JSON -> into an existing inventory. Returns true when it read something.
   * ⚠ IT READS BY POSITION AND CLAMPS THE LENGTH. A save written when SIZE was 41 must still
   * load if SIZE later grows — extra slots stay empty — and a save claiming 900 slots must not
   * write past the end of the array. Neither is hypothetical: the offhand was slot 40 only
   * because vanilla's index space put it there, and a future stage adding slots is ordinary.
   */
  Inv.fromJSON = function (inv, o) {
    if (!inv || !inv.slots || !o || !o.slots || !o.slots.length) return false;
    var n = Math.min(o.slots.length, Inv.SIZE);
    for (var i = 0; i < Inv.SIZE; i++) inv.slots[i] = Inv.EMPTY;
    for (var j = 0; j < n; j++) inv.slots[j] = Inv.stackFromJSON(o.slots[j]);
    var sel = o.selected | 0;
    inv.selected = (sel >= 0 && sel < Inv.HOTBAR) ? sel : 0;
    return true;
  };

  /**
   * A v3 save's nine-entry hotbar -> stacks. Returns how many slots it filled.
   *
   * ⚠ IT INVENTS NOTHING, and that is the whole reason a v3 save is MIGRATED where a v2 save was
   * REFUSED. A v3 entry is `[blockName, localState]`: a name, which still means what it meant.
   * What v3 never recorded is the COUNT, so each slot becomes exactly ONE of that block's item —
   * the smallest number the old save actually implies — and a block with no item at all (water,
   * fire, a wall torch) becomes an EMPTY slot rather than a guess. A v2 entry was a number into
   * a table that no longer exists, and there is no honest reading of it.
   *
   * ⚠ It lives here, not in `14_player.js`, for the same reason `toJSON` does: this module has no
   * DOM, no world and no renderer, so the migration can be asserted by `savecheck` in fifty
   * milliseconds. A migration that only runs inside a module too heavy to load in a check is a
   * migration nothing tests — and it runs exactly once per player, on the save they care about.
   */
  Inv.fromHotbarV3 = function (inv, hotbar) {
    var IT = NS.Items;
    if (!inv || !inv.slots || !hotbar || !hotbar.length || !IT) return 0;
    var filled = 0;
    for (var i = 0; i < Inv.HOTBAR && i < hotbar.length; i++) {
      var v = hotbar[i];
      if (!v || typeof v !== 'object' || typeof v[0] !== 'string') continue;
      var item = IT.of(v[0]);
      if (item < 0) continue;                  // a block with no item — an empty slot, not a guess
      var st = Inv.stack(item, 1);
      if (st) { inv.slots[i] = st; filled++; }
    }
    return filled;
  };
})(MCL);
