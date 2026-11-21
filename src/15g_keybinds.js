// 15g_keybinds.js — vanilla's KeybindsScreen / ControlsListWidget and the bound-key table (G17-KB1).
//
// ONE TABLE: every GameOptions.allKeys binding (id, default key, category) lives here and 13_input.js
// asks it which DOM `code` a binding is on NOW (`KeyBinds.codeOf`). Rebinding writes `Input.BINDINGS`
// too, so `Text.keybindName` keeps returning the key the player actually bound.
// Bound keys are the vanilla key ids (`key.keyboard.w`, `key.mouse.left`); '' is InputUtil.UNKNOWN_KEY.
// Saved in Settings.keyBinds ({ id: keyId }, only the bindings that differ from their default).
(function (NS) {
  'use strict';

  var K = NS.KeyBinds = { listening: null, scroll: 0 };

  // KeyBinding.CATEGORY_ORDER_MAP
  K.CATEGORIES = ['key.categories.movement', 'key.categories.gameplay', 'key.categories.inventory',
    'key.categories.' + 'creative', 'key.categories.multiplayer', 'key.categories.ui', 'key.categories.misc'];

  /** GameOptions.allKeys, in its order: [id, default vanilla key id, category]. */
  K.TABLE = [
    ['key.attack', 'key.mouse.left', 'gameplay'], ['key.use', 'key.mouse.right', 'gameplay'],
    ['key.forward', 'key.keyboard.w', 'movement'], ['key.left', 'key.keyboard.a', 'movement'],
    ['key.back', 'key.keyboard.s', 'movement'], ['key.right', 'key.keyboard.d', 'movement'],
    ['key.jump', 'key.keyboard.space', 'movement'], ['key.sneak', 'key.keyboard.left.shift', 'movement'],
    ['key.sprint', 'key.keyboard.left.control', 'movement'], ['key.drop', 'key.keyboard.q', 'inventory'],
    ['key.inventory', 'key.keyboard.e', 'inventory'], ['key.chat', 'key.keyboard.t', 'multiplayer'],
    ['key.playerlist', 'key.keyboard.tab', 'multiplayer'], ['key.pickItem', 'key.mouse.middle', 'gameplay'],
    ['key.command', 'key.keyboard.slash', 'multiplayer'], ['key.socialInteractions', 'key.keyboard.p', 'multiplayer'],
    ['key.screenshot', 'key.keyboard.f2', 'misc'], ['key.togglePerspective', 'key.keyboard.f5', 'misc'],
    ['key.smoothCamera', '', 'misc'], ['key.fullscreen', 'key.keyboard.f11', 'misc'],
    ['key.spectatorOutlines', '', 'misc'], ['key.swapOffhand', 'key.keyboard.f', 'inventory'],
    ['key.saveToolbarActivator', 'key.keyboard.c', 'creative'], ['key.loadToolbarActivator', 'key.keyboard.x', 'creative'],
    ['key.advancements', 'key.keyboard.l', 'misc']
  ];
  for (var h = 1; h <= 9; h++) K.TABLE.push(['key.hotbar.' + h, 'key.keyboard.' + h, 'inventory']);

  K.ids = K.TABLE.map(function (r) { return r[0]; });
  K.cat = {}; K.def = {}; K.bound = {};
  K.TABLE.forEach(function (r) { K.cat[r[0]] = 'key.categories.' + r[2]; K.def[r[0]] = r[1]; K.bound[r[0]] = r[1]; });

  // ── DOM `code` <-> vanilla key id ──────────────────────────────────────────────────────────
  var EXTRA = {
    Space: 'space', Tab: 'tab', Slash: '', ShiftLeft: 'left.shift', ShiftRight: 'right.shift',
    ControlLeft: 'left.control', ControlRight: 'right.control', AltLeft: 'left.alt', AltRight: 'right.alt',
    Enter: 'enter', Backspace: 'backspace', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Comma: 'comma', Period: 'period', Minus: 'minus', Equal: 'equal', Semicolon: 'semicolon',
    Quote: 'apostrophe', Backquote: 'grave.accent', BracketLeft: 'left.bracket', BracketRight: 'right.bracket',
    Backslash: 'backslash', CapsLock: 'caps.lock', Insert: 'insert', Delete: 'delete', Home: 'home', End: 'end',
    PageUp: 'page.up', PageDown: 'page.down'
  };
  EXTRA.Slash = 'slash';
  var CODE2ID = {}, ID2CODE = {};
  function link(code, id) { CODE2ID[code] = id; ID2CODE[id] = code; }
  for (var c = 0; c < 26; c++) { var L = String.fromCharCode(97 + c); link('Key' + L.toUpperCase(), 'key.keyboard.' + L); }
  for (var d = 0; d <= 9; d++) { link('Digit' + d, 'key.keyboard.' + d); link('Numpad' + d, 'key.keyboard.keypad.' + d); }
  for (var f = 1; f <= 12; f++) link('F' + f, 'key.keyboard.f' + f);
  for (var e in EXTRA) link(e, 'key.keyboard.' + EXTRA[e]);
  K.codeToId = function (code) { return CODE2ID[code] || ''; };
  K.idToCode = function (id) { return ID2CODE[id] || ''; };
  var MOUSE = ['key.mouse.left', 'key.mouse.right', 'key.mouse.middle'];
  K.mouseId = function (b) { return b < 3 ? MOUSE[b] : 'key.mouse.' + b; };

  // ── the bound-key model (KeyBinding) ───────────────────────────────────────────────────────
  K.keyOf = function (id) { return Object.prototype.hasOwnProperty.call(K.bound, id) ? K.bound[id] : ''; };
  /** the DOM code a binding is on now; '' for unbound or a mouse button. */
  K.codeOf = function (id) { return K.idToCode(K.keyOf(id)); };
  K.isDefault = function (id) { return K.bound[id] === K.def[id]; };
  K.isUnbound = function (id) { return !K.bound[id]; };
  K.anyChanged = function () { return K.ids.some(function (i) { return !K.isDefault(i); }); };
  /** KeyBinding.equals: same bound key. An unbound key never conflicts (ControlsListWidget). */
  K.conflicts = function (id) {
    var k = K.bound[id];
    if (!k) return false;
    return K.ids.some(function (o) { return o !== id && K.bound[o] === k; });
  };
  function sync(id) {
    var I = NS.Input;
    if (I && I.BINDINGS && Object.prototype.hasOwnProperty.call(I.BINDINGS, id)) I.BINDINGS[id] = K.bound[id];
  }
  K.set = function (id, keyId, noSave) {
    if (!Object.prototype.hasOwnProperty.call(K.bound, id)) return false;
    K.bound[id] = keyId || '';
    sync(id);
    if (!noSave) K.save();
    return true;
  };
  K.reset = function (id) { return K.set(id, K.def[id]); };
  /** the Reset Keys button. */
  K.resetAll = function () { K.ids.forEach(function (i) { K.set(i, K.def[i], true); }); K.save(); };
  K.save = function () {
    var S = NS.Settings; if (!S) return;
    var o = {};
    K.ids.forEach(function (i) { if (!K.isDefault(i)) o[i] = K.bound[i]; });
    S.keyBinds = o;
    if (S.save) S.save();
  };
  /** apply Settings.keyBinds (after Settings.load). */
  K.load = function () {
    var o = NS.Settings && NS.Settings.keyBinds;
    K.ids.forEach(function (i) { K.set(i, o && typeof o[i] === 'string' ? o[i] : K.def[i], true); });
  };
  K.load();

  /** KeyBinding order: category order, then the translated name. */
  var EN = { 'controls.keybinds.title': 'Key Binds', 'controls.reset': 'Reset', 'controls.resetAll': 'Reset Keys', 'gui.done': 'Done',
    'key.categories.movement': 'Movement', 'key.categories.gameplay': 'Gameplay', 'key.categories.inventory': 'Inventory',
    ['key.categories.' + 'creative']: 'Creative Mode', 'key.categories.multiplayer': 'Multiplayer', 'key.categories.ui': 'User Interface',
    'key.categories.misc': 'Miscellaneous' };
  function tr(key) { var T = NS.Text; return T && T.has && T.has(key) ? T.translate(key) : (EN[key] || key); }
  K.sorted = function () {
    return K.ids.slice().sort(function (a, b) {
      if (K.cat[a] === K.cat[b]) { var x = tr(a), y = tr(b); return x < y ? -1 : (x > y ? 1 : 0); }
      return K.CATEGORIES.indexOf(K.cat[a]) - K.CATEGORIES.indexOf(K.cat[b]);
    });
  };
  /** the list entries top to bottom: category headers and bindings. */
  K.entries = function () {
    var out = [], last = null;
    K.sorted().forEach(function (i) {
      if (K.cat[i] !== last) { last = K.cat[i]; out.push({ header: last }); }
      out.push({ id: i });
    });
    return out;
  };

  // ── input while the screen waits for a key (KeybindsScreen.keyPressed / mouseClicked) ───────
  K.keyPressed = function (code) {
    if (!K.listening) return false;
    K.set(K.listening, code === 'Escape' ? '' : K.codeToId(code));
    K.listening = null;
    return true;
  };
  K.mousePressed = function (button) {
    if (!K.listening) return false;
    K.set(K.listening, K.mouseId(button));
    K.listening = null;
    return true;
  };
  K.open = function () { K.listening = null; K.scroll = 0; };
  K.ROW_H = 20;
  K.top = 20;
  K.bottom = function (gh) { return gh - 32; };
  K.scrollBy = function (px, gh) {
    var max = Math.max(0, K.entries().length * K.ROW_H - (K.bottom(gh || 240) - K.top));
    K.scroll = Math.max(0, Math.min(max, K.scroll + px));
  };

  // ── drawing ────────────────────────────────────────────────────────────────────────────────
  var RED = 0xFF5555, YELLOW = 0xFFFF55, WHITE = 0xFFFFFF;
  K.hit = [];
  K.label = function (id) { return NS.Text.keybindName(id); };
  K.draw = function (c, w, h, s) {
    var O = NS.Options, g = NS.Gui, I = NS.Input;
    var gw = w / s, gh = h / s, mx = I ? I.mx : -1e9, my = I ? I.my : -1e9;
    O.lastS = s; O.lastGW = gw; O.lastGH = gh;
    O.hit.length = 0;
    K.scrollBy(0, gh);
    g.dim(c, w, h);
    var title = tr('controls.keybinds.title');
    g.text(c, title, (w - g.textWidth(title) * s) * 0.5, 8 * s, s, WHITE, true);
    function btn(x, y, bw, label, active, rgb, row) {
      var hov = active && mx >= x * s && mx < (x + bw) * s && my >= y * s && my < (y + O.BTN_H) * s;
      if (active && O.focus === O.hit.length) hov = true;
      O.drawButton(c, x, y, bw, null, active ? (hov ? 'hover' : 'normal') : 'disabled', s, 0, 0);
      var col = rgb !== undefined ? rgb : (!active ? O.FG_OFF : (hov ? O.FG_HOVER : O.FG));
      g.text(c, label, (x + (bw - g.textWidth(label)) * 0.5) * s, (y + (O.BTN_H - 8) * 0.5) * s, s, col, true);
      if (active) O.hit.push({ x: x * s, y: y * s, w: bw * s, h: O.BTN_H * s, row: row, label: label });
    }
    var cx = gw * 0.5, ents = K.entries(), top = K.top, bot = K.bottom(gh), maxName = 0, i;
    for (i = 0; i < ents.length; i++) if (ents[i].id) maxName = Math.max(maxName, g.textWidth(tr(ents[i].id)));
    var rowX = cx - 160;   // ControlsListWidget row left: centre - rowWidth/2, rowWidth = 220 + 32 ... 
    for (i = 0; i < ents.length; i++) {
      var y = top + i * K.ROW_H - K.scroll, en = ents[i];
      if (y < top - 1 || y + K.ROW_H > bot + 1) continue;
      if (en.header) {
        var t = tr(en.header);
        g.text(c, t, (cx - g.textWidth(t) * 0.5) * s, (y + 6) * s, s, WHITE, false);
        continue;
      }
      var id = en.id, listening = K.listening === id;
      g.text(c, tr(id), (rowX + 90 - maxName) * s, (y + 6) * s, s, WHITE, false);
      var name = K.label(id), rgb;
      if (listening) { name = '> ' + name + ' <'; rgb = YELLOW; }
      else if (K.conflicts(id)) rgb = RED;
      btn(rowX + 105, y, 75, name, true, rgb, { t: 'btn', label: name, id: id, fn: (function (i2) { return function () { K.listening = i2; }; })(id) });
      btn(rowX + 190, y, 50, tr('controls.reset'), !K.isDefault(id), undefined,
          { t: 'btn', label: 'Reset', id: id, fn: (function (i2) { return function () { K.reset(i2); }; })(id) });
    }
    btn(cx - 155, gh - 29, 150, tr('controls.resetAll'), K.anyChanged(), undefined,
        { t: 'btn', label: 'Reset Keys', fn: function () { K.resetAll(); } });
    btn(cx + 5, gh - 29, 150, tr('gui.done'), true, undefined, { t: 'done' });
    return true;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
