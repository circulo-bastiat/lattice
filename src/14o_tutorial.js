// 14o_tutorial.js — #11729: net.minecraft.client.tutorial.* (TutorialManager, TutorialStep, TutorialStepHandler,
// NoneTutorialStepHandler, MovementTutorialStepHandler, FindTreeTutorialStepHandler, PunchTreeTutorialStepHandler,
// OpenInventoryTutorialStepHandler, CraftPlanksTutorialStepHandler, BundleTutorial). Read off .decomp/net/minecraft/client/tutorial.
// Runs on: MAIN THREAD ONLY. Toasts are records on Tutorial.toasts {type,title,desc,progress,visible}; the HUD may draw them.
// The host (`Tutorial.host`) answers what vanilla reads off MinecraftClient: inSurvival, hasWorld, hasItemIn(tag), hasBrokenTree, hasCrafted.
// Entry points: tick (17_main.js fixed tick), onMovement (14_player.js cmd), onUpdateMouse (13_input.js applyLook),
// onBlockBreaking (14_player.js break progress), onInventoryOpened (15_hud.js H.open('inventory')).
(function (NS) {
  'use strict';
  var T = NS.Tutorial = {};
  T.STEPS = ['movement', 'find_tree', 'punch_tree', 'open_inventory', 'craft_planks', 'none'];   // TutorialStep order
  T.step = 'movement';          // options.tutorialStep (default MOVEMENT)
  T.hideBundleTutorial = false; // options.hideBundleTutorial
  T.handler = null; T.entries = []; T.toasts = [];
  T.byName = function (n) { return T.STEPS.indexOf(n) >= 0 ? n : 'none'; };
  // FindTreeTutorialStepHandler.TREE_BLOCKS (26): logs, wood, stems/hyphae, leaves, azalea leaves — Blocks fields in .decomp order
  T.TREE_BLOCKS = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'crimson_stem', 'warped_stem',
    'oak_wood', 'spruce_wood', 'birch_wood', 'jungle_wood', 'acacia_wood', 'dark_oak_wood', 'crimson_hyphae', 'warped_hyphae',
    'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'nether_wart_block',
    'warped_wart_block', 'azalea_leaves', 'flowering_azalea_leaves'];
  T.host = {
    inSurvival: function () { return !!(NS.Player && NS.Gamemode && NS.Gamemode.isSurvival(NS.Player)); },
    hasWorld: function () { return !!NS.World && !!NS.Player; },
    hasTreeItem: function () { var P = NS.Player; return !!(P && P.inv && NS.Inventory && T.TREE_BLOCKS.some(function (b) { return NS.Inventory.countOf(P.inv, b) > 0; })); },
    hasBrokenTree: function () { return !!(NS.Stats && T.TREE_BLOCKS.some(function (b) { return NS.Stats.get(NS.Stats.statName('mined', b)) > 0; })); },
    hasLogItem: function () { return hasTagItem('logs'); },
    hasPlanksItem: function () { return hasTagItem('planks'); },
    hasCraftedPlanks: function () { var m = NS.Tags && NS.Tags.items('planks'); return !!(m && NS.Stats && Array.prototype.some.call(m, function (i) { return NS.Stats.get(NS.Stats.statName('crafted', i)) > 0; })); },
    isLogBlock: function (name) { return T.TREE_BLOCKS.indexOf(name) >= 0 && /_(log|stem|wood|hyphae)$/.test(name); },
    writeOptions: function () { try { if (NS.Settings && NS.Settings.save) NS.Settings.save(); } catch (e) {} }
  };
  function hasTagItem(tag) {
    var P = NS.Player, m = NS.Tags && NS.Tags.items(tag);
    if (!P || !P.inv || !m || !NS.Inventory) return false;
    return Array.prototype.some.call(m, function (i) { return NS.Inventory.countOf(P.inv, i) > 0; });
  }
  // ── toasts (TutorialToast.Type: MOVEMENT_KEYS, MOUSE, TREE, RECIPE_BOOK, WOODEN_PLANKS, BUNDLE) ──
  function mk(type, title, desc, hasProgress) { return { type: type, title: title, desc: desc, hasProgress: hasProgress, progress: 0, visible: true }; }
  function show(t) { T.toasts.push(t); return t; }
  function hide(t) { t.visible = false; var i = T.toasts.indexOf(t); if (i >= 0) T.toasts.splice(i, 1); }
  T.hideToast = hide;
  T.keyToText = function (k) { return '{key.' + k + '}'; };
  // ── TutorialManager ──
  var H = {};   // step handlers: {tick,destroy,onMovement,onMouseUpdate,onTarget,onBlockBreaking,onInventoryOpened,onSlotUpdate}
  T.createStepHandler = function (name) { return (H[T.byName(name)] || H.none)(); };
  T.setStep = function (name) {
    T.step = name; T.host.writeOptions();
    if (T.handler) { T.handler.destroy(); T.handler = T.createStepHandler(name); }
  };
  T.createHandler = function () { if (T.handler) T.destroyHandler(); T.handler = T.createStepHandler(T.step); };
  T.destroyHandler = function () { if (T.handler) { T.handler.destroy(); T.handler = null; } };
  T.add = function (toast, expiry) { T.entries.push({ toast: toast, expiry: expiry, age: 0 }); show(toast); };
  T.remove = function (toast) { T.entries = T.entries.filter(function (e) { return e.toast !== toast; }); hide(toast); };
  T.tick = function () {
    T.entries = T.entries.filter(function (e) {   // Entry.tick
      e.toast.progress = Math.min(++e.age / e.expiry, 1);
      if (e.age > e.expiry) { hide(e.toast); return false; }
      return true;
    });
    if (T.handler) { if (T.host.hasWorld()) T.handler.tick(); else T.destroyHandler(); }
    else if (T.host.hasWorld()) T.createHandler();
  };
  T.onMovement = function (cmd) { if (T.handler) T.handler.onMovement(cmd); };
  T.onUpdateMouse = function (dx, dy) { if (T.handler) T.handler.onMouseUpdate(dx, dy); };
  T.onTarget = function (blockName) { if (T.handler) T.handler.onTarget(blockName); };
  T.onBlockBreaking = function (blockName, progress, isLog) { if (T.handler) T.handler.onBlockBreaking(blockName, progress, isLog); };
  T.onInventoryOpened = function () { if (T.handler) T.handler.onInventoryOpened(); };
  T.onSlotUpdate = function () { if (T.handler) T.handler.onSlotUpdate(); };
  function base() { return { destroy: function () {}, tick: function () {}, onMovement: function () {}, onMouseUpdate: function () {},
    onTarget: function () {}, onBlockBreaking: function () {}, onInventoryOpened: function () {}, onSlotUpdate: function () {} }; }
  // ── NoneTutorialStepHandler ──
  H.none = function () { return base(); };
  function withToastDestroy(h) { h.destroy = function () { if (h.toast) { hide(h.toast); h.toast = null; } }; return h; }
  // ── MovementTutorialStepHandler ──
  H.movement = function () {
    var h = base(), ticks = 0, moved = 0, looked = 0, movedLast = false, lookedLast = false, moveDone = -1, lookDone = -1;
    h.moveToast = null; h.lookToast = null;
    h.tick = function () {
      ticks++;
      if (movedLast) { moved++; movedLast = false; }
      if (lookedLast) { looked++; lookedLast = false; }
      if (moveDone === -1 && moved > 40) { if (h.moveToast) { hide(h.moveToast); h.moveToast = null; } moveDone = ticks; }
      if (lookDone === -1 && looked > 40) { if (h.lookToast) { hide(h.lookToast); h.lookToast = null; } lookDone = ticks; }
      if (moveDone !== -1 && lookDone !== -1) T.setStep(T.host.inSurvival() ? 'find_tree' : 'none');
      if (h.moveToast) h.moveToast.progress = moved / 40;
      if (h.lookToast) h.lookToast.progress = looked / 40;
      if (ticks >= 100) {
        if (moveDone === -1 && !h.moveToast) h.moveToast = show(mk('movement_keys', 'tutorial.move.title', 'tutorial.move.description', true));
        else if (moveDone !== -1 && ticks - moveDone >= 20 && lookDone === -1 && !h.lookToast) h.lookToast = show(mk('mouse', 'tutorial.look.title', 'tutorial.look.description', true));
      }
    };
    h.destroy = function () { if (h.moveToast) { hide(h.moveToast); h.moveToast = null; } if (h.lookToast) { hide(h.lookToast); h.lookToast = null; } };
    h.onMovement = function (c) { if (c && (c.fwd || c.strafe || c.jump)) movedLast = true; };
    h.onMouseUpdate = function (dx, dy) { if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) lookedLast = true; };
    return h;
  };
  // ── FindTreeTutorialStepHandler ──
  H.find_tree = function () {
    var h = withToastDestroy(base()), ticks = 0; h.toast = null;
    h.tick = function () {
      ticks++;
      if (!T.host.inSurvival()) { T.setStep('none'); return; }
      if (ticks === 1) {
        if (T.host.hasTreeItem() || T.host.hasBrokenTree()) { T.setStep('craft_planks'); return; }
      }
      if (ticks >= 6000 && !h.toast) h.toast = show(mk('tree', 'tutorial.find_tree.title', 'tutorial.find_tree.description', false));
    };
    h.onTarget = function (blockName) { if (blockName && T.TREE_BLOCKS.indexOf(blockName) >= 0) T.setStep('punch_tree'); };
    h.onSlotUpdate = function () { if (T.host.hasTreeItem()) T.setStep('craft_planks'); };
    return h;
  };
  // ── PunchTreeTutorialStepHandler ──
  H.punch_tree = function () {
    var h = withToastDestroy(base()), ticks = 0, punches = 0; h.toast = null;
    h.tick = function () {
      ticks++;
      if (!T.host.inSurvival()) { T.setStep('none'); return; }
      if (ticks === 1 && (T.host.hasLogItem() || T.host.hasBrokenTree())) { T.setStep('craft_planks'); return; }
      if ((ticks >= 600 || punches > 3) && !h.toast) h.toast = show(mk('tree', 'tutorial.punch_tree.title', 'tutorial.punch_tree.description', true));
    };
    h.onBlockBreaking = function (name, progress, isLog) {   // isLog: state.isIn(BlockTags.LOGS)
      if (isLog && progress > 0) { if (h.toast) h.toast.progress = progress; if (progress >= 1) T.setStep('open_inventory'); }
      else if (h.toast) h.toast.progress = 0;
      else if (isLog) punches++;
    };
    h.onSlotUpdate = function () { if (T.host.hasLogItem()) T.setStep('craft_planks'); };
    return h;
  };
  // ── OpenInventoryTutorialStepHandler ──
  H.open_inventory = function () {
    var h = withToastDestroy(base()), ticks = 0; h.toast = null;
    h.tick = function () {
      ticks++;
      if (!T.host.inSurvival()) { T.setStep('none'); return; }
      if (ticks >= 600 && !h.toast) h.toast = show(mk('recipe_book', 'tutorial.open_inventory.title', 'tutorial.open_inventory.description', false));
    };
    h.onInventoryOpened = function () { T.setStep('craft_planks'); };
    return h;
  };
  // ── CraftPlanksTutorialStepHandler ──
  H.craft_planks = function () {
    var h = withToastDestroy(base()), ticks = 0; h.toast = null;
    h.tick = function () {
      ticks++;
      if (!T.host.inSurvival()) { T.setStep('none'); return; }
      if (ticks === 1 && (T.host.hasPlanksItem() || T.host.hasCraftedPlanks())) { T.setStep('none'); return; }
      if (ticks >= 1200 && !h.toast) h.toast = show(mk('wooden_planks', 'tutorial.craft_planks.title', 'tutorial.craft_planks.description', false));
    };
    h.onSlotUpdate = function () { if (T.host.hasPlanksItem()) T.setStep('none'); };
    return h;
  };
  // ── BundleTutorial (items: bundle id; click: 'left' | 'right') ──
  T.bundle = { toast: null };
  function bStart() { if (T.bundle.toast) T.remove(T.bundle.toast); T.bundle.toast = mk('bundle', 'tutorial.bundleInsert.title', 'tutorial.bundleInsert.description', true); T.add(T.bundle.toast, 160); }
  function bEnd() {
    if (T.bundle.toast) { T.remove(T.bundle.toast); T.bundle.toast = null; }
    if (!T.hideBundleTutorial) { T.hideBundleTutorial = true; T.host.writeOptions(); }
  }
  /** onPickupSlotClick(cursorEmpty?, ...): cursor/slot are item-name strings or '' for empty. */
  T.onPickupSlotClick = function (cursor, slot, click) {
    if (T.hideBundleTutorial) return;
    if (cursor && slot === 'bundle') { if (click === 'left') bStart(); else if (click === 'right') bEnd(); }
    else if (cursor === 'bundle' && slot && click === 'right') bEnd();
  };
})(MCL);
