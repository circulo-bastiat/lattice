// 02q is net/minecraft/screen (#11750): ScreenHandlerType, SlotActionType, PropertyDelegate/ArrayPropertyDelegate,
// ScreenHandlerContext, ScreenHandlerListener, ScreenHandlerSyncHandler, NamedScreenHandlerFactory,
// SimpleNamedScreenHandlerFactory, and the slot layouts + data counts of the Furnace/BlastFurnace/Smoker (via
// AbstractFurnace), Crafting, Generic3x3, Beacon and Player handlers (AbstractRecipeScreenHandler's shared shape).
// The live menus are 14g_menu.js's Menu.*; Screen.attach(Menu) stamps each with its ScreenHandlerType and
// Screen.click runs a SlotActionType through Menu.doClick. Main only.
(function (NS) {
  'use strict';
  var S = NS.Screen = NS.Screen || {};

  // SlotActionType, in declaration order (the ordinal is Menu's click-type number).
  S.SlotActionType = ['PICKUP', 'QUICK_MOVE', 'SWAP', 'CLONE', 'THROW', 'QUICK_CRAFT', 'PICKUP_ALL'];
  S.ordinal = function (name) { var i = S.SlotActionType.indexOf(name); if (i < 0) throw new Error('no SlotActionType ' + name); return i; };

  // ScreenHandlerType registry (Registry.SCREEN_HANDLER), registration order = raw id.
  S.typeIds = ['generic_9x1', 'generic_9x2', 'generic_9x3', 'generic_9x4', 'generic_9x5', 'generic_9x6', 'generic_3x3', 'anvil',
    'beacon', 'blast_furnace', 'brewing_stand', 'crafting', 'enchantment', 'furnace', 'grindstone', 'hopper', 'lectern', 'loom',
    'merchant', 'shulker_box', 'smithing', 'smoker', 'cartography_table', 'stonecutter'];
  function ScreenHandlerType(id, factory) { this.id = id; this.rawId = S.typeIds.indexOf(id); this.factory = factory || null; }
  ScreenHandlerType.prototype.create = function (syncId, inventory) {
    if (!this.factory) throw new Error('no factory for ' + this.id);
    return this.factory(syncId, inventory);
  };
  S.ScreenHandlerType = ScreenHandlerType;
  S.types = {};
  S.typeIds.forEach(function (id) { S.types[id] = new ScreenHandlerType(id); });

  // PropertyDelegate / ArrayPropertyDelegate
  function ArrayPropertyDelegate(n) { this.data = new Array(n); for (var i = 0; i < n; i++) this.data[i] = 0; }
  ArrayPropertyDelegate.prototype.get = function (i) { return this.data[i]; };
  ArrayPropertyDelegate.prototype.set = function (i, v) { if (i < 0 || i >= this.data.length) throw new RangeError('index ' + i); this.data[i] = v | 0; };
  ArrayPropertyDelegate.prototype.size = function () { return this.data.length; };
  S.ArrayPropertyDelegate = ArrayPropertyDelegate;
  S.checkDataCount = function (pd, expected) {
    if (pd.size() < expected) throw new Error('Container data count ' + pd.size() + ' is smaller than expected ' + expected);
  };

  // ScreenHandlerContext: EMPTY yields nothing; create(world,pos) applies the function to them.
  S.ScreenHandlerContext = {
    EMPTY: { get: function () { return null; }, getOr: function (fn, d) { return d; }, run: function () {} },
    create: function (world, pos) {
      return {
        get: function (fn) { return { value: fn(world, pos) }; },
        getOr: function (fn) { return fn(world, pos); },
        run: function (fn) { fn(world, pos); }
      };
    }
  };

  // Listener / sync-handler interfaces: a table of required methods, checked on implement().
  S.interfaces = {
    ScreenHandlerListener: ['onSlotUpdate', 'onPropertyUpdate'],
    ScreenHandlerSyncHandler: ['updateState', 'updateSlot', 'updateCursorStack', 'updateProperty']
  };
  S.implement = function (iface, obj) {
    var need = S.interfaces[iface];
    if (!need) throw new Error('no interface ' + iface);
    need.forEach(function (m) { if (typeof obj[m] !== 'function') throw new Error(iface + ' needs ' + m); });
    return obj;
  };

  // NamedScreenHandlerFactory / SimpleNamedScreenHandlerFactory
  S.SimpleNamedScreenHandlerFactory = function (baseFactory, name) {
    return { getDisplayName: function () { return name; },
      createMenu: function (syncId, inv, player) { return baseFactory(syncId, inv, player); } };
  };

  // Slot layouts: [kind, containerIndex, x, y]. 'inv' = player inventory index.
  function playerRows(out, x0, y0, hotY) {
    var r, c;
    for (r = 0; r < 3; r++) for (c = 0; c < 9; c++) out.push(['inv', c + r * 9 + 9, x0 + c * 18, y0 + r * 18]);
    for (c = 0; c < 9; c++) out.push(['inv', c, x0 + c * 18, hotY]);
    return out;
  }
  function furnace() {
    return playerRows([['input', 0, 56, 17], ['fuel', 1, 56, 53], ['output', 2, 116, 35]], 8, 84, 142);
  }
  S.handlers = {
    furnace: { type: 'furnace', recipeType: 'smelting', book: 'FURNACE', data: 4, size: 3, slots: furnace() },
    blast_furnace: { type: 'blast_furnace', recipeType: 'blasting', book: 'BLAST_FURNACE', data: 4, size: 3, slots: furnace() },
    smoker: { type: 'smoker', recipeType: 'smoking', book: 'SMOKER', data: 4, size: 3, slots: furnace() },
    crafting: { type: 'crafting', data: 0, size: 9, slots: (function () {
      var o = [['result', 0, 124, 35]], r, c;
      for (r = 0; r < 3; r++) for (c = 0; c < 3; c++) o.push(['grid', c + r * 3, 30 + c * 18, 17 + r * 18]);
      return playerRows(o, 8, 84, 142); })() },
    generic_3x3: { type: 'generic_3x3', data: 0, size: 9, slots: (function () {
      var o = [], r, c;
      for (r = 0; r < 3; r++) for (c = 0; c < 3; c++) o.push(['grid', c + r * 3, 62 + c * 18, 17 + r * 18]);
      return playerRows(o, 8, 84, 142); })() },
    beacon: { type: 'beacon', data: 3, size: 1, slots: playerRows([['payment', 0, 136, 110]], 36, 137, 195) },
    player: { type: null, data: 0, size: 5, slots: (function () {
      var o = [['result', 0, 154, 28]], r, c, i;
      for (r = 0; r < 2; r++) for (c = 0; c < 2; c++) o.push(['grid', c + r * 2, 98 + c * 18, 18 + r * 18]);
      for (i = 0; i < 4; i++) o.push(['armor', 39 - i, 8, 8 + i * 18]);
      for (r = 0; r < 3; r++) for (c = 0; c < 9; c++) o.push(['inv', c + (r + 1) * 9, 8 + c * 18, 84 + r * 18]);
      for (c = 0; c < 9; c++) o.push(['inv', c, 8 + c * 18, 142]);
      o.push(['offhand', 40, 77, 62]);
      return o; })() }
  };
  // AbstractRecipeScreenHandler.getCraftingResultSlotIndex / width / height
  S.craftingShape = { crafting: { result: 0, width: 3, height: 3, slots: 10 }, player: { result: 0, width: 2, height: 2, slots: 5 } };

  // The live Menu -> handler type; Screen.click is the packet-side entry (a SlotActionType name).
  S.attach = function (Menu) {
    S.Menu = Menu;
    [['furnaceMenu', function (m, a) { return S.handlers[a[0].type] ? a[0].type : 'furnace'; }],
      ['craftingMenu', function () { return 'crafting'; }],
      ['dispenserMenu', function () { return 'generic_3x3'; }],
      ['beaconMenu', function () { return 'beacon'; }]].forEach(function (p) {
      var orig = Menu[p[0]]; if (typeof orig !== 'function' || orig.screenWrapped) return;
      var w = function () { var m = orig.apply(this, arguments); if (m) m.handlerType = S.types[p[1](m, arguments)]; return m; };
      w.screenWrapped = true; Menu[p[0]] = w;
    });
    Menu.playerMenuType = null;
  };
  S.click = function (m, slotId, button, action, player) {
    return S.Menu.doClick(m, slotId, button, typeof action === 'string' ? S.ordinal(action) : action, player);
  };
})(MCL);
