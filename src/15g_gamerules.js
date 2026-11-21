// 15g_gamerules.js — #11246. 1.18.2 `GameRules` registry (names, types, defaults, categories) + `EditGameRulesScreen`.
// Facts: .decomp/net/minecraft/world/GameRules.java (register(...) calls, Category enum) and
// .decomp/net/minecraft/client/gui/screen/world/EditGameRulesScreen.java (layout: list 43..height-32, 24px rows,
// toggle 44x20 at row right-45, int field 42x20 at right-44, name wrap 175, Done/Cancel at height-29, title y=20).
// ⚠ ONE STORE: `Commands.ruleValues` (what /gamerule writes) — `GR.get/GR.set` ARE `C.ruleGet/ruleSet`. `C.ruleSet` also
// writes the live value into `NS.DATA.gameRules[name].d`, which is what every engine reader (`r.d`) reads; the jar default
// lives on in `GR.DEFAULTS`. So editing a rule in the screen changes the game AND /gamerule's answer.
// ⚠ Lang strings (gamerule.<name>, gamerule.category.*) are the 1.18.2 en_us values; the jar's lang file is not in the tree,
// so they are typed here (owed: extract). Rule descriptions (tooltip body) are owed for the same reason.
(function (NS) {
  'use strict';
  var GR = NS.GameRules = {};
  var CAT = ['player', 'mobs', 'spawning', 'drops', 'updates', 'chat', 'misc'];   // Category enum order = list order
  GR.CATEGORY_NAMES = { player: 'Player', mobs: 'Mobs', spawning: 'Spawning', drops: 'Drops', updates: 'World Updates', chat: 'Chat', misc: 'Miscellaneous' };
  // name -> [category, en_us label]
  GR.INFO = {
    doFireTick: ['updates', 'Update elements of fire'], mobGriefing: ['mobs', 'Mob griefing'], keepInventory: ['player', 'Keep inventory after death'],
    doMobSpawning: ['spawning', 'Spawn mobs'], doMobLoot: ['drops', 'Drop mob loot'], doTileDrops: ['drops', 'Drop block loot'],
    doEntityDrops: ['drops', 'Drop entity loot'], commandBlockOutput: ['chat', 'Broadcast command block output'],
    naturalRegeneration: ['player', 'Regenerate health naturally'], doDaylightCycle: ['updates', 'Advance time of day'],
    logAdminCommands: ['chat', 'Log admin commands'], showDeathMessages: ['chat', 'Show death messages'],
    randomTickSpeed: ['updates', 'Random tick speed rate'], sendCommandFeedback: ['chat', 'Send command feedback'],
    reducedDebugInfo: ['misc', 'Reduce debug info'], spectatorsGenerateChunks: ['player', 'Allow spectators to generate terrain'],
    spawnRadius: ['player', 'Respawn radius'], disableElytraMovementCheck: ['player', 'Disable elytra movement check'],
    maxEntityCramming: ['mobs', 'Entity cramming threshold'], doWeatherCycle: ['updates', 'Update weather'],
    doLimitedCrafting: ['player', 'Limit crafting to recipes'], maxCommandChainLength: ['misc', 'Command chain size limit'],
    announceAdvancements: ['chat', 'Announce advancements'], disableRaids: ['mobs', 'Disable raids'], doInsomnia: ['spawning', 'Phantoms spawn'],
    doImmediateRespawn: ['player', 'Enable immediate respawn'], drowningDamage: ['player', 'Deal drowning damage'],
    fallDamage: ['player', 'Deal fall damage'], fireDamage: ['player', 'Deal fire damage'], freezeDamage: ['player', 'Deal freeze damage'],
    doPatrolSpawning: ['spawning', 'Spawn pillager patrols'], doTraderSpawning: ['spawning', 'Spawn wandering traders'],
    forgiveDeadPlayers: ['mobs', 'Forgive dead players'], universalAnger: ['mobs', 'Universal anger'],
    playersSleepingPercentage: ['player', 'Sleeping percentage']
  };
  var tbl = (NS.DATA && NS.DATA.gameRules) || {};
  GR.DEFAULTS = {};
  Object.keys(tbl).forEach(function (k) { GR.DEFAULTS[k] = tbl[k].d; });
  /** The registry, in screen order: categories by enum, rules by name (String compare, as Comparator.comparing(Key::getName)). */
  GR.registry = function () {
    var out = [];
    CAT.forEach(function (cat) {
      var names = Object.keys(GR.INFO).filter(function (n) { return GR.INFO[n][0] === cat && tbl[n]; })
        .sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
      out.push({ cat: cat, title: GR.CATEGORY_NAMES[cat], rules: names.map(function (n) {
        return { name: n, label: GR.INFO[n][1], type: tbl[n].t === 'i' ? 'int' : 'bool', def: GR.DEFAULTS[n] };
      }) });
    });
    return out;
  };
  // The ONE store: `Commands.ruleValues`, created here if the (lazily built) command tree has not made it yet.
  var C = NS.Commands || (NS.Commands = {});
  C.ruleValues = C.ruleValues || Object.create(null);
  GR.get = function (n) { if (C.ruleValues[n] !== undefined) return C.ruleValues[n]; return tbl[n] ? GR.DEFAULTS[n] : null; };
  GR.set = function (n, v) {
    v = String(v); C.ruleValues[n] = v;
    if (tbl[n]) tbl[n].d = v;   // every engine `r.d` reader sees the live value; the jar default stays in GR.DEFAULTS
    if (n === 'doDaylightCycle' && NS.Sky) NS.Sky.daylightCycle = (v === 'true');
    if (n === 'doWeatherCycle' && NS.Sky) NS.Sky.weatherCycle = (v === 'true');
    return v;
  };
  GR.getBoolean = function (n) { return GR.get(n) === 'true'; };
  GR.getInt = function (n) { var v = parseInt(GR.get(n), 10); return isNaN(v) ? 0 : v; };
  /** IntRule.validate: Integer.parseInt succeeds. */
  GR.validInt = function (s) { return /^[+-]?\d+$/.test(s) && +s >= -2147483648 && +s <= 2147483647; };

  // ── the screen ──
  var S = GR.state = null;
  GR.open = function () {
    var O = NS.Options, H = NS.Hud;
    var draft = {};
    GR.registry().forEach(function (c) { c.rules.forEach(function (r) { draft[r.name] = { text: GR.get(r.name), r: r }; }); });
    GR.state = S = { draft: draft, scroll: 0, focus: null, hit: [], gw: 0, gh: 0 };
    if (H && H.mode === 'title') { H.titleView = 'options'; O.open('gamerules'); return; }   // #11230: from Create New World
    if (H && H.screen !== 'pause') { H.open('pause'); }
    if (O) { if (!O.screen) O.open('pause'); O.go('gamerules'); }
  };
  GR.invalid = function () {
    return Object.keys(S.draft).filter(function (n) { var d = S.draft[n]; return d.r.type === 'int' && !GR.validInt(d.text); });
  };
  GR.done = function () {
    if (GR.invalid().length) return false;
    Object.keys(S.draft).forEach(function (n) { var d = S.draft[n]; if (d.text !== GR.get(n)) GR.set(n, d.r.type === 'int' ? String(parseInt(d.text, 10)) : d.text); });
    NS.Options.back(); return true;
  };
  GR.cancel = function () { NS.Options.back(); return true; };
  GR.entries = function () {   // [{kind:'cat',title}|{kind:'rule',rule,lines}] — wrap names at 175 like textRenderer.wrapLines
    var es = [];
    GR.registry().forEach(function (c) {
      if (!c.rules.length) return;
      es.push({ kind: 'cat', title: c.title });
      c.rules.forEach(function (r) { es.push({ kind: 'rule', rule: r, lines: wrap(r.label, 175) }); });
    });
    return es;
  };
  function wrap(str, w) {
    var g = NS.Gui, words = str.split(' '), lines = [], cur = '';
    words.forEach(function (wd) {
      var t = cur ? cur + ' ' + wd : wd;
      if (cur && g.textWidth(t) > w) { lines.push(cur); cur = wd; } else cur = t;
    });
    lines.push(cur); return lines;
  }
  GR.layout = function (gw, gh) {
    var left = Math.round(gw / 2) - 110 + 2, rowW = 220, top = 43, bot = gh - 32, y = top - S.scroll, es = GR.entries(), out = [];
    es.forEach(function (e) { out.push({ e: e, x: left, y: y, w: rowW }); y += 24; });
    var total = es.length * 24, view = bot - top;
    S.maxScroll = Math.max(0, total - view);
    S.scroll = Math.max(0, Math.min(S.maxScroll, S.scroll));
    return { rows: out, top: top, bot: bot,
      done: { x: gw / 2 - 155, y: gh - 29, w: 150 }, cancel: { x: gw / 2 - 155 + 160, y: gh - 29, w: 150 } };
  };
  GR.draw = function (c, w, h, s) {
    var O = NS.Options, g = NS.Gui; if (!S) return false;
    var gw = w / s, gh = h / s; S.gw = gw; S.gh = gh;
    var L = GR.layout(gw, gh), I = NS.Input, mx = I ? I.mx / s : -1e9, my = I ? I.my / s : -1e9;
    g.dim(c, w, h);
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, L.top * s, w, (L.bot - L.top) * s);
    var t = 'Edit Game Rules'; g.text(c, t, (w - g.textWidth(t) * s) / 2, 20 * s, s, 0xFFFFFF, true);
    S.hit.length = 0;
    c.save(); c.beginPath(); c.rect(0, L.top * s, w, (L.bot - L.top) * s); c.clip();
    var tip = null;
    // #11262: a row half scrolled out of the list band is only clickable where it is visible (vanilla clips the list); its full
    // 20-px rectangle used to reach under the Done/Cancel row.
    function clipHit(q) {
      var y0 = Math.max(q.y, L.top), y1 = Math.min(q.y + q.h, L.bot);
      if (y1 <= y0) return;
      q.y = y0; q.h = y1 - y0; S.hit.push(q);
    }
    L.rows.forEach(function (r) {
      if (r.y + 24 < L.top || r.y > L.bot) return;
      if (r.e.kind === 'cat') { var ct = r.e.title; g.text(c, ct, (r.x + r.w / 2 - g.textWidth(ct) / 2) * s, (r.y + 5) * s, s, 0xFFFF55, true); return; }
      var ru = r.e.rule, d = S.draft[ru.name], ln = r.e.lines;
      if (ln.length === 1) g.text(c, ln[0], r.x * s, (r.y + 5) * s, s, 0xFFFFFF, true);
      else { g.text(c, ln[0], r.x * s, r.y * s, s, 0xFFFFFF, true); g.text(c, ln[1], r.x * s, (r.y + 10) * s, s, 0xFFFFFF, true); }
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + 24 && my >= L.top && my < L.bot) tip = ru;
      if (ru.type === 'bool') {
        var bx = r.x + r.w - 45, on = d.text === 'true';
        O.drawButton(c, bx, r.y, 44, on ? 'ON' : 'OFF', mx >= bx && mx < bx + 44 && my >= r.y && my < r.y + 20 ? 'hover' : 'normal', s, 0, 0);
        clipHit({ x: bx, y: r.y, w: 44, h: 20, kind: 'bool', name: ru.name });
      } else {
        var fx = r.x + r.w - 44, bad = !GR.validInt(d.text), foc = S.focus === ru.name;
        c.fillStyle = foc ? '#ffffff' : '#a0a0a0'; c.fillRect(fx * s, r.y * s, 42 * s, 20 * s);
        c.fillStyle = '#000'; c.fillRect((fx + 1) * s, (r.y + 1) * s, 40 * s, 18 * s);
        g.text(c, d.text + (foc ? '_' : ''), (fx + 4) * s, (r.y + 6) * s, s, bad ? 0xFF0000 : 0xE0E0E0, true);
        clipHit({ x: fx, y: r.y, w: 42, h: 20, kind: 'int', name: ru.name });
      }
    });
    c.restore();
    var bad = GR.invalid().length > 0;
    O.drawButton(c, L.done.x, L.done.y, L.done.w, 'Done', bad ? 'disabled' : (mx >= L.done.x && mx < L.done.x + 150 && my >= L.done.y && my < L.done.y + 20 ? 'hover' : 'normal'), s, 0, 0);
    O.drawButton(c, L.cancel.x, L.cancel.y, L.cancel.w, 'Cancel', mx >= L.cancel.x && mx < L.cancel.x + 150 && my >= L.cancel.y && my < L.cancel.y + 20 ? 'hover' : 'normal', s, 0, 0);
    S.hit.push({ x: L.done.x, y: L.done.y, w: 150, h: 20, kind: 'done' }, { x: L.cancel.x, y: L.cancel.y, w: 150, h: 20, kind: 'cancel' });
    if (tip) {   // name (yellow) + "Default: x" (grey); descriptions owed with the lang extract
      var l1 = tip.name, l2 = 'Default: ' + tip.def, tw = Math.max(g.textWidth(l1), g.textWidth(l2)), tx = mx + 12, ty = my - 12;
      c.fillStyle = 'rgba(16,0,16,0.94)'; c.fillRect((tx - 3) * s, (ty - 3) * s, (tw + 6) * s, 26 * s);
      g.text(c, l1, tx * s, ty * s, s, 0xFFFF55, true); g.text(c, l2, tx * s, (ty + 10) * s, s, 0xAAAAAA, true);
    }
    return true;
  };
  GR.click = function (mx, my, button) {   // gui px
    if (!S) return false;
    for (var i = S.hit.length - 1; i >= 0; i--) {
      var h = S.hit[i];
      if (mx < h.x || mx >= h.x + h.w || my < h.y || my >= h.y + h.h) continue;
      if (h.kind === 'done') return GR.done() || true;
      if (h.kind === 'cancel') return GR.cancel();
      if (h.kind === 'bool') { var d = S.draft[h.name]; d.text = d.text === 'true' ? 'false' : 'true'; S.focus = null; return true; }
      if (h.kind === 'int') { S.focus = h.name; return true; }
    }
    S.focus = null; return false;
  };
  GR.key = function (code) {
    if (!S) return false;
    if (code === 'PageDown' || code === 'ArrowDown') { S.scroll += code === 'PageDown' ? 100 : 24; return true; }
    if (code === 'PageUp' || code === 'ArrowUp') { S.scroll -= code === 'PageUp' ? 100 : 24; return true; }
    if (!S.focus) return false;
    var d = S.draft[S.focus], m = /^(?:Digit|Numpad)(\d)$/.exec(code);
    if (m) { if (d.text.length < 32) d.text += m[1]; return true; }
    if (code === 'Minus' || code === 'NumpadSubtract') { if (d.text.length < 32) d.text += '-'; return true; }
    if (code === 'Backspace') { d.text = d.text.slice(0, -1); return true; }
    if (code === 'Enter' || code === 'NumpadEnter') { S.focus = null; return true; }
    return false;
  };
  GR.wheel = function (dy) { if (S) S.scroll += dy > 0 ? 20 : -20; };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
