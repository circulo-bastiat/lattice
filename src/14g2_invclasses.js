// 14g2_invclasses.js — #11736: net.minecraft.inventory.{ContainerLock, CraftingInventory, CraftingResultInventory, DoubleInventory,
// InventoryChangedListener, SidedInventory}. Read off .decomp/net/minecraft/inventory. MAIN THREAD ONLY. After 14g_menu.js (needs Menu).
// An "inventory" here is the engine's container shape {get,set,removeAt,size} (Menu.container); stacks are {i,n,nbt}; empty = null.
// Entry points: DoubleInventory -> Menu.chestMenu (a double chest's 54 slots); ContainerLock -> Hud.openChest (be.lock);
// CraftingInventory/CraftingResultInventory -> Menu.playerMenu / Menu.craftingMenu grid + result; SidedInventory -> hopper/brewing
// (the stand's table lives in 07c; `Sided.make` wraps any container with the three vanilla methods).
(function (NS) {
  'use strict';
  var C = NS.InvClasses = {};
  var empty = function (s) { return !s || !(s.n > 0); };

  /** ContainerLock: key '' opens for everyone; else the held stack must carry a custom name equal to the key. */
  C.ContainerLock = function (key) { this.key = key || ''; };
  C.ContainerLock.EMPTY = new C.ContainerLock('');
  C.ContainerLock.prototype.canOpen = function (stack) {
    return this.key === '' || (!empty(stack) && !!(stack.nbt && stack.nbt.name) && this.key === String(stack.nbt.name));
  };
  C.ContainerLock.prototype.writeNbt = function (tag) { if (this.key !== '') tag.Lock = this.key; };
  C.ContainerLock.fromNbt = function (tag) { return (tag && typeof tag.Lock === 'string') ? new C.ContainerLock(tag.Lock) : C.ContainerLock.EMPTY; };

  /** InventoryChangedListener: a function (inventory) -> void. Returns a registry with add/remove/fire. */
  C.listeners = function () {
    var l = [];
    return { add: function (f) { l.push(f); }, remove: function (f) { var k = l.indexOf(f); if (k >= 0) l.splice(k, 1); },
      fire: function (inv) { for (var i = 0; i < l.length; i++) l[i](inv); }, count: function () { return l.length; } };
  };

  /** SidedInventory: wraps a container with getAvailableSlots(dir) / canInsert(slot,stack,dir) / canExtract(slot,stack,dir). */
  C.sided = function (container, availableSlots, canInsert, canExtract) {
    container.getAvailableSlots = availableSlots;
    container.canInsert = canInsert || function () { return true; };
    container.canExtract = canExtract || function () { return true; };
    return container;
  };

  // Inventories.splitStack / removeStack over a plain array.
  var split = function (a, k, n) {
    var s = a[k]; if (k < 0 || k >= a.length || empty(s) || n <= 0) return null;
    var I = NS.Inventory, out = I.split(s, n);
    if (s.n <= 0) a[k] = null;
    return out;
  };

  /** CraftingInventory(handler, w, h): setStack and a non-empty removeStack(slot,n) tell the handler (onContentChanged). */
  C.CraftingInventory = function (handler, w, h) { this.handler = handler; this.width = w; this.height = h; this.stacks = []; for (var i = 0; i < w * h; i++) this.stacks.push(null); };
  var CI = C.CraftingInventory.prototype;
  CI.size = function () { return this.stacks.length; };
  CI.isEmpty = function () { for (var i = 0; i < this.stacks.length; i++) if (!empty(this.stacks[i])) return false; return true; };
  CI.getStack = function (k) { return k >= this.size() ? null : (this.stacks[k] || null); };
  CI.removeStack = function (k, n) {
    if (n === undefined) { var s = this.stacks[k] || null; this.stacks[k] = null; return s; }   // Inventories.removeStack
    var out = split(this.stacks, k, n);
    if (!empty(out) && this.handler && this.handler.onContentChanged) this.handler.onContentChanged(this);
    return out;
  };
  CI.setStack = function (k, s) { this.stacks[k] = empty(s) ? null : s; if (this.handler && this.handler.onContentChanged) this.handler.onContentChanged(this); };
  CI.canPlayerUse = function () { return true; };
  CI.clear = function () { for (var i = 0; i < this.stacks.length; i++) this.stacks[i] = null; };
  CI.getWidth = function () { return this.width; };
  CI.getHeight = function () { return this.height; };
  /** The engine container shape over this inventory (Menu.container). */
  CI.asContainer = function () {
    var self = this;
    return NS.Menu.container(function (i) { return self.getStack(i); }, function (i, s) { self.setStack(i, s); },
      function (i, n) { return self.removeStack(i, n); }, self.size());
  };

  /** CraftingResultInventory: one slot; every index is slot 0; removeStack(_, _) removes the WHOLE stack; remembers lastRecipe. */
  C.CraftingResultInventory = function () { this.stacks = [null]; this.lastRecipe = null; };
  var RI = C.CraftingResultInventory.prototype;
  RI.size = function () { return 1; };
  RI.isEmpty = function () { return empty(this.stacks[0]); };
  RI.getStack = function () { return this.stacks[0]; };
  RI.removeStack = function () { var s = this.stacks[0]; this.stacks[0] = null; return s; };
  RI.setStack = function (k, s) { this.stacks[0] = empty(s) ? null : s; };
  RI.canPlayerUse = function () { return true; };
  RI.clear = function () { this.stacks[0] = null; };
  RI.setLastRecipe = function (r) { this.lastRecipe = r; };
  RI.getLastRecipe = function () { return this.lastRecipe; };
  RI.asContainer = function () {
    var self = this;
    return NS.Menu.container(function () { return self.getStack(0); }, function (i, s) { self.setStack(0, s); },
      function () { return self.removeStack(0); }, 1);
  };

  /** DoubleInventory(first, second): indexes >= first.size() go to second at (i - first.size()). Operates on containers. */
  C.DoubleInventory = function (first, second) { this.first = first; this.second = second; };
  var DI = C.DoubleInventory.prototype;
  DI.size = function () { return this.first.size + this.second.size; };
  DI.isPart = function (o) { return this.first === o || this.second === o; };
  DI.getStack = function (i) { var n = this.first.size; return i >= n ? this.second.get(i - n) : this.first.get(i); };
  DI.setStack = function (i, s) { var n = this.first.size; if (i >= n) this.second.set(i - n, s); else this.first.set(i, s); };
  DI.removeStack = function (i, count) { var n = this.first.size; return i >= n ? this.second.removeAt(i - n, count) : this.first.removeAt(i, count); };
  DI.isEmpty = function () { for (var i = 0; i < this.size(); i++) if (!empty(this.getStack(i))) return false; return true; };
  DI.clear = function () { for (var i = 0; i < this.size(); i++) this.setStack(i, null); };
  DI.asContainer = function () {
    var self = this;
    return NS.Menu.container(function (i) { return self.getStack(i) || null; }, function (i, s) { self.setStack(i, s); },
      function (i, n) { return self.removeStack(i, n); }, self.size());
  };
  /** A block entity's item array as a container (size fixed, empty = null). */
  C.bank = function (items, size) {
    var I = NS.Inventory;
    return NS.Menu.container(function (i) { return items[i] || null; },
      function (i, s) { items[i] = I.isEmpty(s) ? null : s; },
      function (i, count) { var s = items[i]; if (I.isEmpty(s)) return null; var out = I.split(s, count); if (s.n <= 0) items[i] = null; return out; }, size);
  };
})(MCL);
