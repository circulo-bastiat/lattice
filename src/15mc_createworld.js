// 15mc_createworld.js — #11230. CreateWorldScreen + MoreOptionsDialog (1.18.2), over the title's 'create' view.
// Facts: .decomp/net/minecraft/client/gui/screen/world/CreateWorldScreen.java (init(): name field cx-100,60,200,20; buttons 150x20 at
// cx-155 / cx+5, rows y=100 (Game Mode | Difficulty), 151 (Allow Cheats | Data Packs), 185 (Game Rules | More World Options...),
// Create/Cancel at height-28; render(): title y=20, labels y=47/85, mode description y=122/134, cheats info y=172) and
// MoreOptionsDialog.java (seed field 60; Generate Structures | World Type at 100, Bonus Chest 151, Customize 120, Done in the 185 slot).
// tweakDefaultsTo: Hardcore turns cheats off + inactive, bonus chest off, difficulty HARD + inactive; creative turns cheats on until the user
// touches the cheats button (tweakedCheats). The seed field IS Hud.titleSeed (what titlecheck/selectworldcheck type into).
// Sub-screens: Game Rules = NS.GameRules (#11246), Data Packs = NS.PackScreen (#11247), both over the Options stack with titleView 'options'.
// Lang strings (selectWorld.*, generator.*, difficulty names) are the 1.18.2 en_us values typed here (the jar lang file is not in the tree).
// #11327: Single Biome = params.fixedBiome (Climate.fixedBiome); Customize cycles the biome list. OWED: the CustomizeBuffetLevelScreen drawing (search box), Import Settings, the Bonus Chest block.
(function (NS) {
  'use strict';
  var CW = NS.CreateWorld = {};
  var H = function () { return NS.Hud; };
  var T = {
    title: 'Create New World', enterName: 'World Name', saved: 'Will be saved in:', gameMode: 'Game Mode', difficulty: 'Difficulty',
    cheats: 'Allow Cheats', cheatsInfo: 'Commands like /gamemode, /experience', dataPacks: 'Data Packs', gameRules: 'Game Rules',
    more: 'More World Options...', done: 'Done', create: 'Create New World', cancel: 'Cancel', enterSeed: 'Seed for the World Generator',
    seedInfo: 'Leave blank for a random seed', structures: 'Generate Structures', structuresInfo: 'Whether structures like Villages and Strongholds will be generated in the world',
    mapType: 'World Type', bonus: 'Bonus Chest', customize: 'Customize', importSettings: 'Import Settings', on: 'ON', off: 'OFF',
    amplifiedInfo: 'Note: Just for fun! Requires a beefy computer.'
  };
  CW.T = T;
  CW.MODES = ['survival', 'hardcore', 'creative'];
  CW.MODE_NAMES = { survival: 'Survival', hardcore: 'Hardcore', creative: 'Creative' };
  CW.MODE_LINES = {
    survival: ['Search for resources, crafting, gain', 'levels, health and hunger'],
    hardcore: ['Same as Survival Mode, locked at', 'hardest difficulty, and one life only'],
    creative: ['Unlimited resources, free flying and', 'destroy blocks instantly']
  };
  CW.DIFFS = ['peaceful', 'easy', 'normal', 'hard'];
  CW.DIFF_NAMES = { peaceful: 'Peaceful', easy: 'Easy', normal: 'Normal', hard: 'Hard' };
  CW.TYPE_NAMES = { 'default': 'Default', large_biomes: 'Large Biomes', amplified: 'AMPLIFIED', flat: 'Superflat', debug: 'Debug Mode', single_biome: 'Single Biome' };
  // #11326: vanilla's GeneratorType.DEBUG is only offered while Shift is held (MoreOptionsDialog)
  CW.types = function () {
    var C = NS.Column, shift = !!(NS.Input && NS.Input.shift);
    return ((shift && C && C.ALL_WORLD_TYPES) || (C && C.WORLD_TYPES) || ['default', 'large_biomes', 'amplified']).concat(['single_biome']);
  };
  // #11327 CustomizeBuffetLevelScreen's list: every overworld biome the registry has, sorted by name; the search box filters it.
  // Vanilla's buffet default is minecraft:plains (WorldPresets / CreateWorldScreen.getBiomeKey fallback).
  CW.buffetBiomes = function (filter) {
    var B = NS.Biomes, out = [], f = (filter || '').toLowerCase();
    if (!B || !B.names) return out;
    for (var i = 0; i < B.names.length; i++) {
      var n = B.names[i];
      if (/^minecraft:(nether_wastes|soul_sand_valley|crimson_forest|warped_forest|basalt_deltas|the_end|small_end_islands|end_midlands|end_highlands|end_barrens|the_void)$/.test(n)) continue;
      if (!f || n.slice(10).replace(/_/g, ' ').indexOf(f) >= 0) out.push(n);
    }
    return out.sort();
  };

  CW.SCALES = [3000, 6000, 12000, 24000, 60000];
  CW.st = null;
  /** Fresh screen state (a new CreateWorldScreen): Survival, Normal, cheats off, structures on, Default type, bonus chest off. */
  CW.open = function () {
    var h = H();
    var name = (NS.Worlds && NS.Worlds.pendingName) || (NS.SelectWorld ? NS.SelectWorld.uniqueName('New World') : 'New World');
    CW.st = { name: name, mode: 'survival', difficulty: 'normal', cheats: false, tweakedCheats: false, structures: true, bonus: false,
      type: 'default', more: false, focus: 'name', sub: false };
    var GR = NS.GameRules;   // a new world starts from the jar defaults
    if (GR) GR.registry().forEach(function (c) { c.rules.forEach(function (r) { if (GR.get(r.name) !== r.def) GR.set(r.name, r.def); }); });
    if (NS.PackScreen) NS.PackScreen.org = null;
    h.titleSeed = ''; h.titleSeedFocus = false; h.titleView = 'create';
  };
  CW.hardcore = function () { return CW.st.mode === 'hardcore'; };
  /** CreateWorldScreen.tweakDefaultsTo(mode). */
  CW.setMode = function (m) {
    var s = CW.st;
    if (!s.tweakedCheats) s.cheats = (m === 'creative');
    if (m === 'hardcore') { s.cheats = false; s.bonus = false; }
    s.mode = m;
  };
  CW.effDifficulty = function () { return CW.hardcore() ? 'hard' : CW.st.difficulty; };
  CW.effCheats = function () { return CW.st.cheats && !CW.hardcore(); };
  CW.effBonus = function () { return CW.st.bonus && !CW.hardcore(); };
  CW.folder = function () {
    var n = CW.st.name.trim() || 'World';
    return n;
  };
  function cycle(list, cur, back) { var i = list.indexOf(cur); return list[(i + (back ? list.length - 1 : 1)) % list.length]; }
  function back() { return !!(NS.Input && NS.Input.shift); }

  CW.layout = function (gw, gh) {
    var cx = Math.floor(gw / 2), L = cx - 155, R = cx + 5, s = CW.st, hc = CW.hardcore(), B = [];
    function b(id, label, x, y, active, w) { B.push({ id: id, label: label, x: x, y: y, w: w || 150, active: active !== false }); }
    var onoff = function (v) { return v ? T.on : T.off; };
    var tight = gh - 28 < 232;
    function climate(cy) {
      var earth = NS.Save.climate === 'earth';
      b('vanilla', 'Vanilla', L, cy, earth, 73);
      b('earth', 'Earth', L + 77, cy, !earth, 73);
      if (earth) CW.SCALES.forEach(function (v, i) {
        b('scale:' + v, v >= 1000 ? (v / 1000) + 'k' : String(v), R + i * 30, cy, NS.Save.worldScale !== v, 30);
      });
    }
    if (!s.more) {
      b('mode', T.gameMode + ': ' + CW.MODE_NAMES[s.mode], L, 100);
      b('difficulty', T.difficulty + ': ' + CW.DIFF_NAMES[CW.effDifficulty()], R, 100, !hc);
      b('cheats', T.cheats + ': ' + onoff(CW.effCheats()), L, 151, !hc);
      b('datapacks', T.dataPacks, R, 151);
      b('rules', T.gameRules, L, 185);
      b('more', T.more, R, 185);
      // MC-Lite's own climate model (D-182; not in vanilla): one row under the six vanilla buttons, above Create/Cancel.
      // #11262: only when it fits (Create/Cancel sit at gh-28); in a short window the row moves to More World Options.
      if (!tight) climate(210);
    } else {
      b('structures', T.structures + ': ' + onoff(s.structures), L, 100);
      b('type', T.mapType + ': ' + CW.TYPE_NAMES[s.type], R, 100);
      b('bonus', T.bonus + ': ' + onoff(CW.effBonus()), L, 151, !hc);
      if (s.type === 'single_biome') b('customize', T.customize, R, 120);
      if (s.type === 'flat') b('customize', T.customize, R, 120);   // MoreOptionsDialog.customizeTypeButton (flat only)
      b('import', T.importSettings, L, 185, false);
      b('moredone', T.done, R, 185);
      if (tight) climate(124);
    }
    b('create', T.create, L, gh - 28, s.name.trim().length > 0);
    b('cancel', T.cancel, R, gh - 28);
    return { buttons: B, field: { x: cx - 100, y: 60, w: 200, h: 20 }, cx: cx };
  };

  CW.press = function (id) {
    var s = CW.st, h = H(), t;
    if (id === 'mode') CW.setMode(cycle(CW.MODES, s.mode, back()));
    else if (id === 'difficulty') s.difficulty = cycle(CW.DIFFS, s.difficulty, back());
    else if (id === 'cheats') { s.tweakedCheats = true; s.cheats = !CW.effCheats(); }
    else if (id === 'datapacks') { s.sub = true; h.titleView = 'options'; NS.Options.stack.length = 0; NS.Options.screen = null; NS.PackScreen.open('data'); }
    else if (id === 'rules') { s.sub = true; NS.GameRules.open(); }
    else if (id === 'more' || id === 'moredone') { s.more = !s.more; s.focus = s.more ? 'seed' : 'name'; }
    else if (id === 'structures') s.structures = !s.structures;
    else if (id === 'type') s.type = cycle(CW.types(), s.type, back());
    else if (id === 'customize' && s.type === 'single_biome') { var bl = CW.buffetBiomes(); var bi = bl.indexOf(s.biome || 'minecraft:plains'); s.biome = bl[(bi + (back() ? bl.length - 1 : 1)) % bl.length]; }
    else if (id === 'customize' && s.type === 'flat') { NS.FlatCustomize.open(s.flatPreset); s.flat = true; }
    else if (id === 'bonus') s.bonus = !CW.effBonus();
    else if (id === 'vanilla') NS.Save.climate = 'vanilla';
    else if (id === 'earth') NS.Save.climate = 'earth';
    else if (id.indexOf('scale:') === 0) NS.Save.worldScale = +id.slice(6);
    else if (id === 'create') CW.create();
    else if (id === 'cancel') CW.cancel();
  };
  /** Cancel / Escape: More options closes first (close()), else the Select World list. */
  CW.cancel = function () {
    var h = H();
    if (CW.st && CW.st.flat) { NS.FlatCustomize.key('Escape'); return; }
    if (CW.st && CW.st.more) { CW.st.more = false; CW.st.focus = 'name'; return; }
    if (NS.Worlds) NS.Worlds.pendingName = null;
    if (NS.SelectWorld) { h.titleView = 'worlds'; NS.SelectWorld.refresh(); } else h.titleView = 'main';
  };
  /** Options/Packs/Rules sub-screens end in H.titleBack: come back here instead of the title. */
  CW.back = function () {
    if (!CW.st || !CW.st.sub) return false;
    CW.st.sub = false; H().titleView = 'create'; return true;
  };
  /** The settings the engine reads, written where it reads them. Returns the options handed to Main.play. */
  CW.apply = function () {
    var s = CW.st, S = NS.Save, D = NS.Diff, hc = CW.hardcore();
    S.cheats = CW.effCheats();
    S.structures = !!s.structures;
    S.bonusChest = CW.effBonus();
    S.worldType = s.type === 'single_biome' ? 'default' : s.type;
    S.fixedBiome = s.type === 'single_biome' ? (s.biome || 'minecraft:plains') : undefined;   // #11327
    S.flatPreset = s.type === 'flat' ? (s.flatPreset || '') : '';
    S.newMode = hc ? 0 : (s.mode === 'creative' ? 1 : 0);
    if (D) { D.hardcore = false; D.set(CW.effDifficulty()); if (hc) D.setHardcore(true); }
    if (NS.Worlds) NS.Worlds.pendingName = s.name.trim();
    return { seed: H().titleSeed };
  };
  CW.create = function () {
    var s = CW.st; if (!s || !s.name.trim().length) return false;
    var o = CW.apply();
    if (NS.Main && NS.Main.play) NS.Main.play(o);
    return true;
  };

  CW.key = function (key) {
    var s = CW.st, h = H();
    if (s.flat) return NS.FlatCustomize.key(key);
    if (key === 'Escape') { CW.cancel(); return true; }
    if (key === 'Enter') { CW.create(); return true; }
    if (s.focus === 'seed') {
      if (key === 'Backspace') h.titleSeed = h.titleSeed.slice(0, -1);
      else if (key.length === 1 && h.titleSeed.length < 32) h.titleSeed += key;
    } else {
      if (key === 'Backspace') s.name = s.name.slice(0, -1);
      else if (key.length === 1 && s.name.length < 32) s.name += key;
    }
    return true;
  };

  CW.draw = function (c, w, hh, s) {
    var g = NS.Gui, O = NS.Options, h = H(), st = CW.st; if (!st) CW.open(), st = CW.st;
    if (st.flat) return NS.FlatCustomize.draw(c, w, hh, s);
    var gw = w / s, gh = hh / s, I = NS.Input, mx = I ? I.mx : -1e9, my = I ? I.my : -1e9;
    NS.Title.drawPanorama(c, w, hh);
    var L = CW.layout(gw, gh), cx = L.cx;
    function ctext(str, y, col) { g.text(c, str, (cx - g.textWidth(str) / 2) * s, y * s, s, col, true); }
    function ltext(str, x, y, col) { g.text(c, str, x * s, y * s, s, col, true); }
    function field(f, text, ph, focus) {
      c.fillStyle = '#000'; c.fillRect(f.x * s, f.y * s, f.w * s, f.h * s);
      c.strokeStyle = focus ? '#fff' : '#a0a0a0'; c.lineWidth = 1; c.strokeRect(f.x * s + .5, f.y * s + .5, f.w * s - 1, f.h * s - 1);
      var blink = focus && (Date.now() / 500 | 0) % 2 === 0;
      if (text) g.text(c, text + (blink ? '_' : ''), (f.x + 4) * s, (f.y + 6) * s, s, 0xE0E0E0, true);
      else g.text(c, (blink ? '_' : '') + ph, (f.x + 4) * s, (f.y + 6) * s, s, 0x808080, true);
    }
    var GREY = 0xA0A0A0;
    ctext(T.title, 20, 0xFFFFFF);
    if (st.more) {
      ltext(T.enterSeed, cx - 100, 47, GREY); ltext(T.seedInfo, cx - 100, 85, GREY);
      field(L.field, h.titleSeed, '', st.focus === 'seed');
      h.hit.push({ x: L.field.x * s, y: L.field.y * s, w: L.field.w * s, h: L.field.h * s, fn: function () { st.focus = 'seed'; }, label: 'seed', id: 'seed' });
    } else {
      ltext(T.enterName, cx - 100, 47, GREY); ltext(T.saved + ' ' + CW.folder(), cx - 100, 85, GREY);
      field(L.field, st.name, '', st.focus === 'name');
      h.hit.push({ x: L.field.x * s, y: L.field.y * s, w: L.field.w * s, h: L.field.h * s, fn: function () { st.focus = 'name'; }, label: 'name', id: 'name' });
      var ln = CW.MODE_LINES[st.mode];
      ltext(ln[0], cx - 150, 122, GREY); ltext(ln[1], cx - 150, 134, GREY);
      ltext(T.cheatsInfo, cx - 150, 172, GREY);
    }
    L.buttons.forEach(function (b) {
      var hov = b.active && mx >= b.x * s && mx < (b.x + b.w) * s && my >= b.y * s && my < (b.y + 20) * s;
      O.drawButton(c, b.x, b.y, b.w, b.label, !b.active ? 'disabled' : hov ? 'hover' : 'normal', s, 0, 0);
      h.hit.push({ x: b.x * s, y: b.y * s, w: b.w * s, h: 20 * s, fn: b.active ? function () { CW.press(b.id); } : function () {}, label: b.label, id: b.id, disabled: !b.active });
    });
  };
})(MCL);
