// MC-Lite — #11229: SELECT WORLD, EDIT WORLD and the delete ConfirmScreen of the title screen (1.18.2 SelectWorldScreen,
// WorldListWidget, EditWorldScreen; layout numbers from .decomp). Data: NS.Worlds (16c_worlds.js, docs/decisions/11229-worlds.md).
// Views (Hud.titleView): 'worlds' | 'editworld' | 'confirmdelete'; Create New World opens the existing 'create' panel.
// Browser rulings: "Open World Folder"/"Open Backup Folder"/"Optimize World" have no folder to act on (disabled); Make Backup = Worlds.duplicate.
// Playing a world = Worlds.open(id) + a page reload that auto-presses Play (sessionStorage 'mclite.autoplay'), since a built world cannot be unbuilt.
(function (NS) {
  'use strict';
  var SW = NS.SelectWorld = { list: [], sel: -1, search: '', scroll: 0, edit: null, confirm: null, note: '', busy: false };
  var T = {
    title: 'Select World', search: 'Search for a world...', play: 'Play Selected World', create: 'Create New World',
    edit: 'Edit', del: 'Delete', recreate: 'Re-Create', cancel: 'Cancel', editTitle: 'Edit World', enterName: 'Enter World Name',
    save: 'Save', backup: 'Make Backup', openFolder: 'Open World Folder', backupFolder: 'Open Backup Folder', optimize: 'Optimize World',
    resetIcon: 'Reset Icon', export: 'Export Worldgen Settings', sure: 'Are you sure you want to delete this world?', del2: 'Delete'
  };
  SW.T = T;
  function H() { return NS.Hud; }

  SW.open = function () {
    var h = H(); h.titleView = 'worlds'; SW.search = ''; SW.scroll = 0; SW.sel = -1; SW.note = '';
    return SW.refresh();
  };
  SW.refresh = function () {
    if (!NS.Worlds) return Promise.resolve([]);
    return NS.Worlds.init().then(function () { return NS.Worlds.list(); }).then(function (l) { SW.all = l; SW.apply(); return l; }, function () { SW.all = []; SW.apply(); return []; });
  };
  /** WorldListWidget filter: case-insensitive substring of the name or the id. */
  SW.apply = function () {
    var q = SW.search.toLowerCase(), a = SW.all || [];
    SW.list = a.filter(function (r) { return !q || r.name.toLowerCase().indexOf(q) >= 0 || r.id.toLowerCase().indexOf(q) >= 0; });
    if (SW.sel >= SW.list.length) SW.sel = SW.list.length - 1;
  };
  SW.selected = function () { return SW.sel >= 0 ? SW.list[SW.sel] : null; };
  SW.modeName = function (m) { if (typeof m === 'number') m = ['survival', 'creative', 'adventure', 'spectator'][m]; m = m || 'survival'; return m.charAt(0).toUpperCase() + m.slice(1) + ' Mode'; };
  SW.date = function (t) {
    var d = new Date(t), p = function (n) { return n < 10 ? '0' + n : '' + n; }, hr = d.getHours();
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(2) + ' ' + ((hr % 12) || 12) + ':' + p(d.getMinutes()) + ' ' + (hr < 12 ? 'AM' : 'PM');
  };
  SW.uniqueName = function (base) {
    var names = {}; (SW.all || []).forEach(function (r) { names[r.name] = 1; });
    if (!names[base]) return base;
    for (var i = 2; ; i++) if (!names[base + ' (' + i + ')']) return base + ' (' + i + ')';
  };

  /** Make `id` the current world and come back through the title with Play pressed. */
  SW.play = function (id) {
    if (SW.busy || !NS.Worlds) return Promise.resolve();
    SW.busy = true;
    return NS.Worlds.open(id).then(function () {
      try { sessionStorage.setItem('mclite.autoplay', '1'); } catch (e) {}
      SW.reload();
    }, function (e) { SW.busy = false; SW.note = String(e); });
  };
  SW.reload = function () { try { location.reload(); } catch (e) {} };
  SW.createNew = function () {
    var h = H();
    NS.Worlds.pendingName = SW.uniqueName('New World');
    NS.Save.reset();   // detaches: the old world's payload is already in its record (Save.save mirrors it)
    h.titleHasSave = false; h.titleSeed = ''; h.titleSeedFocus = false; h.titleView = 'create';
    if (NS.CreateWorld) NS.CreateWorld.open();
  };
  SW.recreate = function (r) {
    if (SW.busy) return;
    SW.busy = true;
    NS.Worlds.create({ name: r.name, seed: r.seed, gameMode: r.gameMode, difficulty: r.difficulty }).then(function (id) {
      SW.busy = false; return SW.play(id);
    }, function (e) { SW.busy = false; SW.note = String(e); });
  };
  SW.doDelete = function (id) {
    return NS.Worlds.remove(id).then(function () { SW.confirm = null; H().titleView = 'worlds'; SW.sel = -1; return SW.refresh(); });
  };
  SW.doSave = function () {
    var e = SW.edit, nm = e.name.trim();
    if (!nm) return;
    return NS.Worlds.rename(e.id, nm).then(function () { SW.edit = null; H().titleView = 'worlds'; return SW.refresh(); });
  };
  SW.doBackup = function () {
    return NS.Worlds.duplicate(SW.edit.id).then(function () { SW.note = 'Backup created'; return SW.refresh(); });
  };

  // ── layout (GUI px) ────────────────────────────────────────────────────────────────────
  SW.layout = function (gw, gh) {
    var cx = Math.floor(gw / 2), has = !!SW.selected(), b = 52, b2 = 28;
    return {
      search: { x: cx - 100, y: 22, w: 200, h: 20 },
      list: { top: 48, bottom: gh - 64, rowH: 36, x: cx - 110, w: 220 },
      buttons: [
        { id: 'play', label: T.play, x: cx - 154, y: gh - b, w: 150, active: has },
        { id: 'create', label: T.create, x: cx + 4, y: gh - b, w: 150, active: true },
        { id: 'edit', label: T.edit, x: cx - 154, y: gh - b2, w: 72, active: has },
        { id: 'delete', label: T.del, x: cx - 76, y: gh - b2, w: 72, active: has },
        { id: 'recreate', label: T.recreate, x: cx + 4, y: gh - b2, w: 72, active: has },
        { id: 'cancel', label: T.cancel, x: cx + 82, y: gh - b2, w: 72, active: true }
      ]
    };
  };
  SW.editLayout = function (gw, gh) {
    var cx = Math.floor(gw / 2), y = Math.floor(gh / 4);
    return {
      field: { x: cx - 100, y: 38, w: 200, h: 20 },
      buttons: [
        { id: 'resetIcon', label: T.resetIcon, x: cx - 100, y: y + 5, w: 200, active: false },
        { id: 'openFolder', label: T.openFolder, x: cx - 100, y: y + 29, w: 200, active: false },
        { id: 'backup', label: T.backup, x: cx - 100, y: y + 53, w: 200, active: true },
        { id: 'backupFolder', label: T.backupFolder, x: cx - 100, y: y + 77, w: 200, active: false },
        { id: 'optimize', label: T.optimize, x: cx - 100, y: y + 101, w: 200, active: false },
        { id: 'export', label: T.export, x: cx - 100, y: y + 125, w: 200, active: false },
        { id: 'save', label: T.save, x: cx - 100, y: y + 149, w: 98, active: true },
        { id: 'ecancel', label: T.cancel, x: cx + 2, y: y + 149, w: 98, active: true }
      ]
    };
  };
  SW.confirmLayout = function (gw, gh) {
    var cx = Math.floor(gw / 2), y = Math.floor(gh / 6) + 96;
    return [{ id: 'yes', label: T.del2, x: cx - 155, y: y, w: 150, active: true }, { id: 'no', label: T.cancel, x: cx + 5, y: y, w: 150, active: true }];
  };

  SW.press = function (id) {
    var r = SW.selected(), h = H();
    if (id === 'play' && r) SW.play(r.id);
    else if (id === 'create') SW.createNew();
    else if (id === 'edit' && r) { SW.edit = { id: r.id, name: r.name }; h.titleView = 'editworld'; }
    else if (id === 'delete' && r) { SW.confirm = { id: r.id, name: r.name }; h.titleView = 'confirmdelete'; }
    else if (id === 'recreate' && r) SW.recreate(r);
    else if (id === 'cancel') h.titleView = 'main';
    else if (id === 'backup') SW.doBackup();
    else if (id === 'save') SW.doSave();
    else if (id === 'ecancel') { SW.edit = null; h.titleView = 'worlds'; }
    else if (id === 'yes') SW.doDelete(SW.confirm.id);
    else if (id === 'no') { SW.confirm = null; h.titleView = 'worlds'; }
  };

  SW.key = function (key) {
    var h = H(), v = h.titleView;
    if (v === 'worlds') {
      if (key === 'Escape') { h.titleView = 'main'; return true; }
      if (key === 'Enter') { var r = SW.selected(); if (r) SW.play(r.id); return true; }
      if (key === 'ArrowDown') { SW.sel = Math.min(SW.list.length - 1, SW.sel + 1); return true; }
      if (key === 'ArrowUp') { SW.sel = Math.max(0, SW.sel - 1); return true; }
      if (key === 'Backspace') { SW.search = SW.search.slice(0, -1); SW.apply(); return true; }
      if (key.length === 1 && SW.search.length < 64) { SW.search += key; SW.apply(); return true; }
      return true;
    }
    if (v === 'editworld') {
      if (key === 'Escape') { SW.edit = null; h.titleView = 'worlds'; return true; }
      if (key === 'Enter') { SW.doSave(); return true; }
      if (key === 'Backspace') { SW.edit.name = SW.edit.name.slice(0, -1); return true; }
      if (key.length === 1 && SW.edit.name.length < 32) SW.edit.name += key;
      return true;
    }
    if (v === 'confirmdelete') { if (key === 'Escape') { SW.confirm = null; h.titleView = 'worlds'; } return true; }
    return false;
  };

  SW.draw = function (c, w, hh, s) {
    var g = NS.Gui, O = NS.Options, h = H(), T0 = NS.Title, v = h.titleView;
    var gw = w / s, gh = hh / s, I = NS.Input, mx = I ? I.mx : -1e9, my = I ? I.my : -1e9;
    T0.drawPanorama(c, w, hh);
    var cxp = Math.floor(gw / 2) * s;
    function ctext(str, y, col) { g.text(c, str, cxp - g.textWidth(str) * s / 2, y * s, s, col, true); }
    function hit(x, y, bw, bh, fn, label, id) { h.hit.push({ x: x * s, y: y * s, w: bw * s, h: bh * s, fn: fn, label: label, id: id }); }
    function buttons(arr) {
      arr.forEach(function (b) {
        var hov = b.active && mx >= b.x * s && mx < (b.x + b.w) * s && my >= b.y * s && my < (b.y + 20) * s;
        O.drawButton(c, b.x, b.y, b.w, b.label, !b.active ? 'disabled' : hov ? 'hover' : 'normal', s, 0, 0);
        if (b.active) hit(b.x, b.y, b.w, 20, function () { SW.press(b.id); }, b.label, b.id);
        else h.hit.push({ x: b.x * s, y: b.y * s, w: b.w * s, h: 20 * s, fn: function () {}, label: b.label, id: b.id, disabled: true });
      });
    }
    function field(f, text, ph) {
      c.fillStyle = '#000'; c.fillRect(f.x * s, f.y * s, f.w * s, f.h * s);
      c.strokeStyle = '#fff'; c.lineWidth = 1; c.strokeRect(f.x * s + .5, f.y * s + .5, f.w * s - 1, f.h * s - 1);
      var blink = (Date.now() / 500 | 0) % 2 === 0;
      if (text) g.text(c, text + (blink ? '_' : ''), (f.x + 4) * s, (f.y + 6) * s, s, 0xE0E0E0, true);
      else { g.text(c, ph, (f.x + 4) * s, (f.y + 6) * s, s, 0x808080, true); }
    }
    if (v === 'worlds') {
      var L = SW.layout(gw, gh);
      c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, L.list.top * s, w, (L.list.bottom - L.list.top) * s);
      ctext(T.title, 8, 0xFFFFFF);
      field(L.search, SW.search, T.search);
      hit(L.search.x, L.search.y, L.search.w, L.search.h, function () {}, 'search', 'search');
      var rows = Math.max(1, Math.floor((L.list.bottom - L.list.top) / L.list.rowH));
      if (SW.sel >= 0) { if (SW.sel < SW.scroll) SW.scroll = SW.sel; if (SW.sel >= SW.scroll + rows) SW.scroll = SW.sel - rows + 1; }
      SW.scroll = Math.max(0, Math.min(SW.scroll, Math.max(0, SW.list.length - rows)));
      for (var i = SW.scroll; i < Math.min(SW.list.length, SW.scroll + rows); i++) {
        var r = SW.list[i], y = L.list.top + (i - SW.scroll) * L.list.rowH, x = L.list.x;
        if (i === SW.sel) { c.fillStyle = '#fff'; c.fillRect((x - 2) * s, (y - 2) * s, (L.list.w + 4) * s, 34 * s); c.fillStyle = '#000'; c.fillRect((x - 1) * s, (y - 1) * s, (L.list.w + 2) * s, 32 * s); }
        g.text(c, r.name + ' (' + SW.date(r.lastPlayed) + ')', (x + 2) * s, (y + 1) * s, s, 0xFFFFFF, true);
        g.text(c, r.id, (x + 2) * s, (y + 12) * s, s, 0x808080, true);
        g.text(c, SW.modeName(r.gameMode) + ', Version: ' + r.version + ', Seed: ' + r.seed, (x + 2) * s, (y + 22) * s, s, 0x808080, true);
        (function (idx, rr) { hit(x, y, L.list.w, 36, function () { SW.sel = idx; }, 'world:' + rr.name, 'world'); })(i, r);
      }
      if (!SW.list.length) ctext(SW.search ? 'No worlds match' : 'No worlds yet', L.list.top + 12, 0x808080);
      buttons(L.buttons);
      if (SW.note) ctext(SW.note, gh - 64 + 4, 0xFFAA00);
    } else if (v === 'editworld') {
      var E = SW.editLayout(gw, gh);
      ctext(T.editTitle, 15, 0xFFFFFF);
      g.text(c, T.enterName, (Math.floor(gw / 2) - 100) * s, 24 * s, s, 0xA0A0A0, true);
      field(E.field, SW.edit ? SW.edit.name : '', '');
      hit(E.field.x, E.field.y, E.field.w, E.field.h, function () {}, 'name', 'name');
      buttons(E.buttons);
      if (SW.note) ctext(SW.note, 66, 0xFFAA00);
    } else if (v === 'confirmdelete') {
      var y0 = Math.floor(gh / 6);
      ctext(T.sure, 70 > y0 ? 70 : y0, 0xFFFFFF);
      ctext("'" + (SW.confirm ? SW.confirm.name : '') + "' will be lost forever! (A long time!)", 82, 0xFFFFFF);
      buttons(SW.confirmLayout(gw, gh));
    }
  };
})(MCL);
