/* 15fp_packs.js — #11247. PackScreen + PackListWidget + ResourcePackOrganizer (.decomp gui/screen/pack/*), for the
   Resource Packs screen (Options > Resource Packs...) and the Data Packs screen (Create New World > Data Packs, #11230).
   Rulings in docs/decisions/11247-packs-screen.md. Pack profiles are the built-in ones only. */
(function (NS) {
  'use strict';
  var O = NS.Options;
  if (!O) return;
  var P = NS.PackScreen = {};

  // lang strings (1.18.2 en_us)
  P.STR = { available: 'Available', selected: 'Selected', dropInfo: 'Drag and drop files into this window to add packs',
    openFolder: 'Open Pack Folder', done: 'Done', builtin: 'Built-in' };
  P.KINDS = {
    resource: { screen: 'packs', title: 'Resource Packs', key: 'resourcePacks' },
    data: { screen: 'datapacks', title: 'Select Data Packs', key: 'dataPacks' }
  };
  // The built-in profiles (ResourcePackManager.getProfiles()): the vanilla pack is pinned + always enabled, BOTTOM.
  P.BUILTIN = {
    resource: [{ name: 'vanilla', title: 'Default', desc: 'The default look and feel of Minecraft', pinned: true, always: true, pos: 'bottom' }],
    data: [{ name: 'vanilla', title: 'Default', desc: 'The default data for Minecraft', pinned: true, always: true, pos: 'bottom' }]
  };
  P.org = null;

  /** ResourcePackOrganizer: enabled list is displayed top = highest priority; both lists hold profiles. */
  P.makeOrganizer = function (kind, extra) {
    var all = P.BUILTIN[kind].concat(extra || []);
    var saved = (NS.Settings && NS.Settings[P.KINDS[kind].key]) || null;   // names, lowest priority first
    var enabled = [];
    (saved ? saved.slice().reverse() : []).forEach(function (n) { all.forEach(function (p) { if (p.name === n && enabled.indexOf(p) < 0) enabled.push(p); }); });
    all.forEach(function (p) { if (p.always && enabled.indexOf(p) < 0) P.insert(enabled, p); });   // a required pack is always on
    var o = { kind: kind, all: all, enabled: enabled, disabled: all.filter(function (p) { return enabled.indexOf(p) < 0; }), applied: null };
    return o;
  };
  /** InsertionPosition.insert(list, p, identity, inverted=true): skip pinned entries of the same position at that end. */
  P.insert = function (list, p) {
    // InsertionPosition.insert(.., inverted=true): TOP.inverse() takes the 'start' branch (the list is displayed flipped)
    var i;
    if (p.pos === 'top') { for (i = 0; i < list.length; i++) if (!list[i].pinned || list[i].pos !== p.pos) break; list.splice(i, 0, p); }
    else { for (i = list.length - 1; i >= 0; i--) if (!list[i].pinned || list[i].pos !== p.pos) break; list.splice(i + 1, 0, p); }
  };
  P.isEnabled = function (p) { return P.org.enabled.indexOf(p) >= 0; };
  P.canBeEnabled = function (p) { return !P.isEnabled(p); };
  P.canBeDisabled = function (p) { return P.isEnabled(p) && !p.always; };
  P.listOf = function (p) { return P.isEnabled(p) ? P.org.enabled : P.org.disabled; };
  P.canMoveStart = function (p) { if (!P.isEnabled(p)) return false; var l = P.org.enabled, i = l.indexOf(p); return i > 0 && !l[i - 1].pinned; };
  P.canMoveEnd = function (p) { if (!P.isEnabled(p)) return false; var l = P.org.enabled, i = l.indexOf(p); return i >= 0 && i < l.length - 1 && !l[i + 1].pinned; };
  P.enable = function (p) { if (!P.canBeEnabled(p)) return false; P.org.disabled.splice(P.org.disabled.indexOf(p), 1); P.insert(P.org.enabled, p); return true; };
  P.disable = function (p) { if (!P.canBeDisabled(p)) return false; P.org.enabled.splice(P.org.enabled.indexOf(p), 1); P.insert(P.org.disabled, p); return true; };
  P.move = function (p, d) {
    var l = P.org.enabled, i = l.indexOf(p);
    if (d < 0 ? !P.canMoveStart(p) : !P.canMoveEnd(p)) return false;
    l.splice(i, 1); l.splice(i + d, 0, p); return true;
  };
  P.doneActive = function () { return !!P.org && P.org.enabled.length > 0; };
  /** apply(): setEnabledProfiles(reverse(enabled) names) then the applier (Settings persist). */
  P.apply = function () {
    if (!P.org) return;
    var names = P.org.enabled.slice().reverse().map(function (p) { return p.name; });
    P.org.applied = names;
    var S = NS.Settings; if (S) { S[P.KINDS[P.org.kind].key] = names; if (S.save) S.save(); }
  };
  P.open = function (kind, extra) {
    P.org = P.makeOrganizer(kind, extra);
    O.go(P.KINDS[kind].screen);
  };
  P.activeKind = function () { return O.screen === 'packs' ? 'resource' : (O.screen === 'datapacks' ? 'data' : null); };
  P.ensure = function () { var k = P.activeKind(); if (k && (!P.org || P.org.kind !== k)) P.org = P.makeOrganizer(k); };

  // layout (PackScreen.init + PackListWidget): lists 200 wide, top 32, bottom h-51, rows 36 tall, header 13
  P.TOP = 32; P.ROW = 36; P.HEAD = 13;
  P.listLeft = function (gw, selected) { return selected ? gw / 2 + 4 : gw / 2 - 4 - 200; };
  P.rowY = function (i) { return P.TOP + 4 + P.HEAD + i * P.ROW; };
  /** Which entry/zone is under a GUI-space point: {p, zone:'enable'|'disable'|'up'|'down'|null} */
  P.entryAt = function (gx, gy, gw, gh) {
    if (!P.org) return null;
    for (var side = 0; side < 2; side++) {
      var list = side ? P.org.enabled : P.org.disabled, left = P.listLeft(gw, side === 1) + 2;
      if (gx < left - 2 || gx >= left + 198 || gy < P.TOP || gy > gh - 51) continue;
      for (var i = 0; i < list.length; i++) {
        var y = P.rowY(i);
        if (gy >= y - 1 && gy < y + 35) {
          var p = list[i], dx = gx - left, dy = gy - y, zone = null;
          if (!(p.pinned && p.always) && dx <= 32) {
            if (P.canBeEnabled(p)) zone = 'enable';
            else if (dx < 16 && P.canBeDisabled(p)) zone = 'disable';
            else if (dx > 16 && dy < 16 && P.canMoveStart(p)) zone = 'up';
            else if (dx > 16 && dy > 16 && P.canMoveEnd(p)) zone = 'down';
          }
          return { p: p, zone: zone, side: side, index: i };
        }
      }
    }
    return null;
  };
  P.clickGui = function (gx, gy, gw, gh) {
    var e = P.entryAt(gx, gy, gw, gh);
    if (!e || !e.zone) return false;
    if (e.zone === 'enable') return P.enable(e.p);
    if (e.zone === 'disable') return P.disable(e.p);
    return P.move(e.p, e.zone === 'up' ? -1 : 1);
  };

  P.draw = function (c, w, h, s) {
    var g = NS.Gui, k = P.activeKind(); P.ensure();
    var gw = w / s, gh = h / s;
    O.lastS = s; O.lastGW = gw; O.lastGH = gh; O.hit.length = 0;
    g.dim(c, w, h);
    var I = NS.Input, mx = I ? I.mx : -1e9, my = I ? I.my : -1e9, gx = mx / s, gy = my / s;
    var t = function (str, x, y, col) { g.text(c, str, x * s, y * s, s, col, true); };
    var tc = function (str, y) { t(str, gw / 2 - g.textWidth(str) / 2, y, 0xFFFFFF); };
    for (var side = 0; side < 2; side++) {
      var list = side ? P.org.enabled : P.org.disabled, left = P.listLeft(gw, side === 1);
      c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(left * s, P.TOP * s, 200 * s, (gh - 51 - P.TOP) * s);
      c.save(); c.beginPath(); c.rect(left * s, P.TOP * s, 200 * s, (gh - 51 - P.TOP) * s); c.clip();
      var head = side ? P.STR.selected : P.STR.available;
      g.text(c, head, (left + 100 - g.textWidth(head) / 2) * s, (P.TOP + 3) * s, s, 0xFFFFFF, false);
      var hov = P.entryAt(gx, gy, gw, gh);
      for (var i = 0; i < list.length; i++) {
        var p = list[i], x = left + 2, y = P.rowY(i);
        c.fillStyle = 'rgb(128,128,128)'; c.fillRect(x * s, y * s, 32 * s, 32 * s);       // the unknown_pack icon stand-in
        c.fillStyle = 'rgb(40,40,40)'; c.fillRect((x + 1) * s, (y + 1) * s, 30 * s, 30 * s);
        var mine = hov && hov.p === p;
        if (mine && !(p.pinned && p.always)) {
          c.fillStyle = 'rgba(' + 0xA0 + ',' + 0xA0 + ',' + 0xA0 + ',0.62)'; c.fillRect(x * s, y * s, 32 * s, 32 * s);
          var arrow = function (lab, ax, ay, on) { t(lab, ax, ay, on ? 0xFFFF55 : 0xFFFFFF); };
          if (P.canBeEnabled(p)) arrow('>', x + 12, y + 12, gx - x < 32);
          else {
            if (P.canBeDisabled(p)) arrow('<', x + 4, y + 12, gx - x < 16);
            if (P.canMoveStart(p)) arrow('^', x + 22, y + 3, gx - x > 16 && gx - x < 32 && gy - y < 16);
            if (P.canMoveEnd(p)) arrow('v', x + 22, y + 21, gx - x > 16 && gx - x < 32 && gy - y > 16);
          }
        }
        t(p.title, x + 34, y + 1, 0xFFFFFF);
        t(p.desc, x + 34, y + 12, 0x808080);
        t(P.STR.builtin, x + 34, y + 22, 0x808080);
      }
      c.restore();
    }
    var title = P.KINDS[k].title;
    tc(title, 8); t(P.STR.dropInfo, gw / 2 - g.textWidth(P.STR.dropInfo) / 2, 20, 0xAAAAAA);
    O.drawButton(c, Math.round(gw / 2 - 154), gh - 48, 150, P.STR.openFolder, 'disabled', s, 0, 0);
    var dx = Math.round(gw / 2 + 4), dy = gh - 48, on = P.doneActive();
    var dh = on && gx >= dx && gx < dx + 150 && gy >= dy && gy < dy + 20;
    O.drawButton(c, dx, dy, 150, P.STR.done, !on ? 'disabled' : (dh || O.focus === 0) ? 'hover' : 'normal', s, 0, 0);
    if (on) O.hit.push({ x: dx * s, y: dy * s, w: 150 * s, h: 20 * s, row: { t: 'done' }, label: 'Done' });
    return true;
  };

  // hook into the Options screen: draw, click, back (Done AND Esc both close() = apply, as PackScreen.close does)
  var draw0 = O.draw, click0 = O.click, back0 = O.back;
  O.draw = function (c, w, h, s) {
    if (O.screen === 'packs' || O.screen === 'datapacks') { var g = NS.Gui; if (!g || !g.ready) return false; return P.draw(c, w, h, s); }
    return draw0.apply(this, arguments);
  };
  O.click = function (mx, my, button) {
    if ((O.screen === 'packs' || O.screen === 'datapacks') && O.lastS) {
      if (P.clickGui(mx / O.lastS, my / O.lastS, O.lastGW, O.lastGH)) return true;
    }
    return click0.apply(this, arguments);
  };
  O.back = function () {
    if (O.screen === 'packs' || O.screen === 'datapacks') { P.ensure(); if (!P.doneActive()) return; P.apply(); }
    return back0.apply(this, arguments);
  };
  O.ROWS.packs = function () { return []; };
  O.ROWS.datapacks = function () { return []; };
  O.TITLES.packs = P.KINDS.resource.title; O.TITLES.datapacks = P.KINDS.data.title;
  // enable the hub row (was owed)
  var orows = O.optionsRows;
  O.optionsRows = function () {
    return orows().map(function (r) { return r.label === 'Resource Packs...' ? { t: 'btn', label: r.label, fn: function () { P.open('resource'); } } : r; });
  };
  O.ROWS.options = O.optionsRows;
  delete O.OWED['Resource Packs...'];
  O.OWED['Open Pack Folder'] = 'a browser has no file system folder to open (docs/decisions/11247-packs-screen.md)';
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
