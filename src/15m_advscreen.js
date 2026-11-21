// MC-Lite — G26e: the Advancements screen. Port of AdvancementsScreen / AdvancementTab / AdvancementTabType /
// AdvancementWidget geometry (gui/screen/advancement). Layout is pure (no DOM) so advscreencheck can compare it with vanilla.
(function (NS) {
  'use strict';
  var AS = NS.AdvScreen = {};
  AS.W = 252; AS.H = 140;                       // window.png
  AS.PX = 9; AS.PY = 18; AS.PW = 234; AS.PH = 113;   // the pannable area
  // AdvancementTabType: u, v, width, height, tabCount - top, bottom, left, right
  AS.TYPES = [
    { name: 'ABOVE', u: 0, v: 0, w: 28, h: 32, n: 8 },
    { name: 'BELOW', u: 84, v: 0, w: 28, h: 32, n: 8 },
    { name: 'LEFT', u: 0, v: 64, w: 32, h: 28, n: 5 },
    { name: 'RIGHT', u: 96, v: 64, w: 32, h: 28, n: 5 }
  ];
  AS.tabX = function (t, i) { return t.name === 'LEFT' ? -t.w + 4 : t.name === 'RIGHT' ? 248 : (t.w + 4) * i; };
  AS.tabY = function (t, i) { return t.name === 'ABOVE' ? -t.h + 4 : t.name === 'BELOW' ? 136 : t.h * i; };
  /** AdvancementTab.create: the i-th root takes the first type with room; null past 26 tabs. */
  AS.tabType = function (i) {
    for (var k = 0; k < AS.TYPES.length; k++) { if (i < AS.TYPES[k].n) return { type: AS.TYPES[k], index: i }; i -= AS.TYPES[k].n; }
    return null;
  };
  /** AdvancementTabType.drawBackground's texture u/v for tab `index` of its type. */
  AS.tabUV = function (t, index, selected) {
    var u = t.u; if (index > 0) u += t.w; if (index === t.n - 1) u += t.w;
    return { u: u, v: selected ? t.v + t.h : t.v };
  };
  AS.isClickOnTab = function (t, index, wx, wy, mx, my) {
    var x = wx + AS.tabX(t, index), y = wy + AS.tabY(t, index);
    return mx > x && mx < x + t.w && my > y && my < y + t.h;
  };
  AS.origin = function (gw, gh) { return { x: Math.floor((gw - AS.W) / 2), y: Math.floor((gh - AS.H) / 2) }; };

  /** One tab per displayed root, widgets at floor(x*28), floor(y*27); the pan bounds as in addWidget. */
  AS.build = function (manager) {
    var tabs = [];
    (manager ? manager.roots : []).forEach(function (root) {
      if (!root.display) return;
      var tt = AS.tabType(tabs.length); if (!tt) return;
      var tab = { root: root, type: tt.type, index: tt.index, widgets: [], originX: 0, originY: 0, init: false,
                  minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 };
      var walk = function (a) {
        if (!a.display) return;
        var w = { adv: a, x: Math.floor(a.display.x * 28), y: Math.floor(a.display.y * 27) };
        tab.widgets.push(w);
        tab.minX = Math.min(tab.minX, w.x); tab.maxX = Math.max(tab.maxX, w.x + 28);
        tab.minY = Math.min(tab.minY, w.y); tab.maxY = Math.max(tab.maxY, w.y + 27);
        a.children.forEach(walk);
      };
      walk(root);
      tabs.push(tab);
    });
    return { tabs: tabs, selected: tabs.length ? tabs[0] : null };
  };
  /** AdvancementTab.render's first-frame centring. */
  AS.initTab = function (tab) {
    if (tab.init) return;
    tab.originX = 117 - Math.floor((tab.maxX + tab.minX) / 2);
    tab.originY = 56 - Math.floor((tab.maxY + tab.minY) / 2);
    tab.init = true;
  };
  /** AdvancementTab.move */
  AS.move = function (tab, dx, dy) {
    if (tab.maxX - tab.minX > AS.PW) tab.originX = Math.min(0, Math.max(-(tab.maxX - AS.PW), tab.originX + dx));
    if (tab.maxY - tab.minY > AS.PH) tab.originY = Math.min(0, Math.max(-(tab.maxY - AS.PH), tab.originY + dy));
  };
  /** Screen position (inside the pan area) of each widget's 26x26 frame, for the selected tab. */
  AS.layout = function (st, gw, gh, progress) {
    var o = AS.origin(gw, gh), t = st.selected, out = { win: o, tabs: [], widgets: [] };
    st.tabs.forEach(function (tb) { out.tabs.push({ tab: tb, x: o.x + AS.tabX(tb.type, tb.index), y: o.y + AS.tabY(tb.type, tb.index), w: tb.type.w, h: tb.type.h, selected: tb === t }); });
    if (!t) return out;
    AS.initTab(t);
    var ox = Math.floor(t.originX), oy = Math.floor(t.originY);
    t.widgets.forEach(function (w) {
      var p = progress && progress(w.adv), hidden = w.adv.display.hidden && !(p && p.isDone());
      if (!hidden) out.widgets.push({ adv: w.adv, x: o.x + AS.PX + ox + w.x, y: o.y + AS.PY + oy + w.y });
    });
    return out;
  };
  AS.state = null;
  AS.open = function () { AS.state = AS.build(NS.Adv && NS.Adv.manager); };
  AS.selectAt = function (gw, gh, mx, my) {
    var o = AS.origin(gw, gh), st = AS.state; if (!st || st.tabs.length < 2) return false;
    for (var i = 0; i < st.tabs.length; i++) if (AS.isClickOnTab(st.tabs[i].type, st.tabs[i].index, o.x, o.y, mx, my)) { st.selected = st.tabs[i]; return true; }
    return false;
  };
  AS.progressOf = function (a) {
    var pl = NS.player || (NS.Main && NS.Main.player);
    return pl && pl.advancements ? pl.advancements.getProgress(a) : null;
  };
  AS.draw = function (c, w, h, s) {
    var g = NS.Gui; if (!AS.state) AS.open();
    var gw = w / s, gh = h / s, L = AS.layout(AS.state, gw, gh, AS.progressOf), o = L.win;
    g.dim(c, w, h);
    c.fillStyle = '#c6c6c6'; c.fillRect(o.x * s, o.y * s, AS.W * s, AS.H * s);
    c.fillStyle = '#000'; c.fillRect((o.x + AS.PX) * s, (o.y + AS.PY) * s, AS.PW * s, AS.PH * s);
    L.tabs.forEach(function (t) { if (L.tabs.length > 1) { c.fillStyle = t.selected ? '#e0e0e0' : '#808080'; c.fillRect(t.x * s, t.y * s, t.w * s, t.h * s); } });
    var ax = (o.x + AS.PX) * s, ay = (o.y + AS.PY) * s;
    L.widgets.forEach(function (wd) {
      var p = AS.progressOf(wd.adv), done = p && p.isDone();
      var x = wd.x, y = wd.y; if (x < o.x + AS.PX - 26 || x > o.x + AS.PX + AS.PW || y < o.y + AS.PY - 26 || y > o.y + AS.PY + AS.PH) return;
      c.fillStyle = done ? '#d8b034' : '#505050'; c.fillRect((x + 3) * s, (y + 3) * s, 20 * s, 20 * s);
    });
    g.text(c, 'Advancements', (o.x + 8) * s, (o.y + 6) * s, s, 0x404040, false);
    if (!AS.state.selected) {
      g.text(c, 'Advancements', ax, ay, s, 0xFFFFFF, true);
    }
    return true;
  };
})(MCL);
