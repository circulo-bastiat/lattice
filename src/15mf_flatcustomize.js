// 15mf_flatcustomize.js — #11325. CustomizeFlatLevelScreen + PresetsScreen (1.18.2), over the Create World screen.
// Facts: .decomp/net/minecraft/client/gui/screen/CustomizeFlatLevelScreen.java (title y=8; "Tile"/"Height" headers y=32 at cx-108 and
// right-aligned to cx-108+215; list y 43..h-60, 24px rows, layers shown TOP first; Remove Layer cx-155,h-52 | Presets cx+5,h-52;
// Done cx-155,h-28 | Cancel cx+5,h-28; 1.18.2 has NO Add Layer and no reorder) and PresetsScreen.java (field 50,40,w-100 x 20; "Share"
// label y=30, "List" label y=70; list y 80..h-37, 24px rows; Use Preset cx-155,h-28 | Cancel cx+5,h-28; the nine presets in vanilla order).
// A config is the vanilla legacy string "bottom-first layers;biome" (PresetsScreen.parsePresetString); engine side = Gen.parseFlatPreset.
// OWED: structure_overrides per preset (the engine's flat rule is villages+strongholds only), features/lakes flags.
(function (NS) {
  'use strict';
  var FC = NS.FlatCustomize = {};
  var H = function () { return NS.Hud; };
  FC.T = {
    title: 'Customize Superflat World', tile: 'Tile', height: 'Height', top: 'Layer %1 (top)', bottom: 'Layer %1 (bottom)', layer: 'Layer %1',
    remove: 'Remove Layer', presets: 'Presets', done: 'Done', cancel: 'Cancel', ptitle: 'Select a Preset', share: 'Enter a Preset Code', list: 'Or Choose a Preset',
    use: 'Use Preset'
  };
  // [name, icon item/block, biome, layers TOP-first as written in PresetsScreen's static block]
  FC.PRESETS = [
    ['Classic Flat', 'grass_block', 'plains', [[1, 'grass_block'], [2, 'dirt'], [1, 'bedrock']]],
    ["Tunnelers' Dream", 'stone', 'windswept_hills', [[1, 'grass_block'], [5, 'dirt'], [230, 'stone'], [1, 'bedrock']]],
    ['Water World', 'water_bucket', 'deep_ocean', [[90, 'water'], [5, 'gravel'], [5, 'dirt'], [5, 'stone'], [64, 'deepslate'], [1, 'bedrock']]],
    ['Overworld Survival Terrain', 'grass', 'plains', [[1, 'grass_block'], [3, 'dirt'], [59, 'stone'], [1, 'bedrock']]],
    ['Snowy Kingdom', 'snow', 'snowy_plains', [[1, 'snow'], [1, 'grass_block'], [3, 'dirt'], [59, 'stone'], [1, 'bedrock']]],
    ['Bottomless Pit', 'feather', 'plains', [[1, 'grass_block'], [3, 'dirt'], [2, 'cobblestone']]],
    ['Desert', 'sand', 'desert', [[8, 'sand'], [52, 'sandstone'], [3, 'stone'], [1, 'bedrock']]],
    ['Redstone Ready', 'redstone', 'desert', [[116, 'sandstone'], [3, 'stone'], [1, 'bedrock']]],
    ['The Void', 'barrier', 'the_void', [[1, 'air']]]
  ];
  /** getGeneratorConfigString: layers (bottom-first) joined by ',', "n*" only when n>1, then ';biome'. */
  FC.format = function (c) {
    return c.layers.map(function (l) { return (l[1] > 1 ? l[1] + '*' : '') + 'minecraft:' + l[0]; }).join(',') + ';minecraft:' + c.biome;
  };
  /** A preset's legacy string: addPreset adds the varargs reversed, so the string is bottom-first. */
  FC.presetString = function (p) {
    return FC.format({ layers: p[3].slice().reverse().map(function (l) { return [l[1], l[0]]; }), biome: p[2] });
  };
  /** Config object from a string via the engine parser (bad layer -> Classic Flat, bad biome -> plains). */
  FC.parse = function (str) {
    var f = NS.Gen.parseFlatPreset(str);
    return { layers: f.layers.map(function (l) { return [l[0], l[1]]; }), biome: f.biome.replace(/^minecraft:/, '') };
  };
  FC.st = null;
  /** view: 'customize' | 'presets'. */
  FC.open = function (preset) {
    FC.st = { view: 'customize', cfg: FC.parse(preset || NS.Gen.FLAT_DEFAULT), sel: -1, psel: -1, field: '' };
  };
  FC.string = function () { return FC.format(FC.st.cfg); };
  /** Display index i (0 = top) -> bottom-first layer index. */
  FC.layerAt = function (i) { var L = FC.st.cfg.layers; return L[L.length - i - 1]; };
  FC.layerLabel = function (i) {
    var n = FC.st.cfg.layers.length, t = i === 0 ? FC.T.top : i === n - 1 ? FC.T.bottom : FC.T.layer;
    return t.replace('%1', FC.layerAt(i)[1]);
  };
  FC.layerName = function (name) {
    if (name === 'air') return '';
    if (name === 'water') name = 'water_bucket';
    if (name === 'lava') name = 'lava_bucket';
    return name.split('_').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
  };
  FC.layout = function (gw, gh) {
    var cx = Math.floor(gw / 2), B = [], st = FC.st;
    function b(id, label, x, y, active) { B.push({ id: id, label: label, x: x, y: y, w: 150, active: active !== false }); }
    if (st.view === 'customize') {
      b('remove', FC.T.remove, cx - 155, gh - 52, st.sel >= 0);
      b('presets', FC.T.presets, cx + 5, gh - 52);
      b('done', FC.T.done, cx - 155, gh - 28);
      b('cancel', FC.T.cancel, cx + 5, gh - 28);
      return { buttons: B, list: { y0: 43, y1: gh - 60, row: 24 }, cx: cx };
    }
    b('use', FC.T.use, cx - 155, gh - 28, st.psel >= 0 || st.field.length > 1);
    b('pcancel', FC.T.cancel, cx + 5, gh - 28);
    return { buttons: B, list: { y0: 80, y1: gh - 37, row: 24 }, field: { x: 50, y: 40, w: gw - 100, h: 20 }, cx: cx };
  };
  /** CustomizeFlatLevelScreen remove: drop the selected (display index) layer; select the next one down, clamped. */
  FC.removeSel = function () {
    var st = FC.st, L = st.cfg.layers, i = st.sel; if (i < 0) return;
    L.splice(L.length - i - 1, 1);
    st.sel = L.length ? Math.min(i, L.length - 1) : -1;
  };
  FC.press = function (id) {
    var st = FC.st, CW = NS.CreateWorld;
    if (id === 'remove') FC.removeSel();
    else if (id === 'presets') { st.view = 'presets'; st.field = FC.string(); st.psel = -1; }
    else if (id === 'done') { CW.st.flatPreset = FC.string(); CW.st.flat = false; }
    else if (id === 'cancel') CW.st.flat = false;
    else if (id === 'use') { st.cfg = FC.parse(st.field); st.sel = -1; st.view = 'customize'; }
    else if (id === 'pcancel') st.view = 'customize';
    else if (id.indexOf('layer:') === 0) st.sel = +id.slice(6);
    else if (id.indexOf('preset:') === 0) { st.psel = +id.slice(7); st.field = FC.presetString(FC.PRESETS[st.psel]); }
  };
  FC.key = function (key) {
    var st = FC.st, CW = NS.CreateWorld;
    if (key === 'Escape') { if (st.view === 'presets') st.view = 'customize'; else CW.st.flat = false; return true; }
    if (st.view === 'presets') {
      if (key === 'Enter' && (st.psel >= 0 || st.field.length > 1)) FC.press('use');
      else if (key === 'Backspace') { st.field = st.field.slice(0, -1); st.psel = -1; }
      else if (key.length === 1 && st.field.length < 1230) { st.field += key; st.psel = -1; }
    }
    return true;
  };
  FC.draw = function (c, w, hh, s) {
    var g = NS.Gui, O = NS.Options, h = H(), st = FC.st, I = NS.Input, mx = I ? I.mx : -1e9, my = I ? I.my : -1e9;
    NS.Title.drawPanorama(c, w, hh);
    var gw = w / s, gh = hh / s, L = FC.layout(gw, gh), cx = L.cx;
    function text(str, x, y, col) { g.text(c, str, x * s, y * s, s, col, true); }
    function ctext(str, y) { text(str, cx - g.textWidth(str) / 2, y, 0xFFFFFF); }
    var ls = L.list, n = st.view === 'customize' ? st.cfg.layers.length : FC.PRESETS.length, i, BI = NS.BlockIcon;
    c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(0, ls.y0 * s, w, (ls.y1 - ls.y0) * s);
    for (i = 0; i < n; i++) {
      var y = ls.y0 + 2 + i * ls.row, x = cx - 108;
      if (y + ls.row < ls.y0 || y > ls.y1) continue;
      var sel = st.view === 'customize' ? st.sel === i : st.psel === i;
      if (sel) { c.strokeStyle = '#fff'; c.lineWidth = 1; c.strokeRect((x - 2) * s + .5, (y - 2) * s + .5, 219 * s, 22 * s); }
      var nm = st.view === 'customize' ? FC.layerAt(i)[0] : FC.PRESETS[i][1];
      if (BI && BI.stateCanvas && NS.States) {
        var cv = null; try { cv = BI.stateCanvas(NS.States.stateOf(nm), Math.round(16 * s)); } catch (e) { cv = null; }
        if (cv) c.drawImage(cv, (x + 2) * s, (y + 2) * s);
      }
      if (st.view === 'customize') {
        text(FC.layerName(nm), x + 23, y + 3, 0xFFFFFF);
        var lab = FC.layerLabel(i); text(lab, x + 215 - g.textWidth(lab), y + 3, 0xFFFFFF);
        h.hit.push({ x: x * s, y: y * s, w: 215 * s, h: 22 * s, fn: (function (id) { return function () { FC.press(id); }; })('layer:' + i), label: 'layer', id: 'layer:' + i });
      } else {
        text(FC.PRESETS[i][0], x + 23, y + 6, 0xFFFFFF);
        h.hit.push({ x: x * s, y: y * s, w: 215 * s, h: 22 * s, fn: (function (id) { return function () { FC.press(id); }; })('preset:' + i), label: FC.PRESETS[i][0], id: 'preset:' + i });
      }
    }
    if (st.view === 'customize') {
      ctext(FC.T.title, 8);
      text(FC.T.tile, cx - 108, 32, 0xFFFFFF);
      text(FC.T.height, cx - 108 + 2 + 213 - g.textWidth(FC.T.height), 32, 0xFFFFFF);
    } else {
      ctext(FC.T.ptitle, 8);
      text(FC.T.share, 50, 30, 0xA0A0A0); text(FC.T.list, 50, 70, 0xA0A0A0);
      var f = L.field; c.fillStyle = '#000'; c.fillRect(f.x * s, f.y * s, f.w * s, f.h * s);
      c.strokeStyle = '#fff'; c.lineWidth = 1; c.strokeRect(f.x * s + .5, f.y * s + .5, f.w * s - 1, f.h * s - 1);
      text(st.field + ((Date.now() / 500 | 0) % 2 === 0 ? '_' : ''), f.x + 4, f.y + 6, 0xE0E0E0);
    }
    L.buttons.forEach(function (b) {
      var hov = b.active && mx >= b.x * s && mx < (b.x + b.w) * s && my >= b.y * s && my < (b.y + 20) * s;
      O.drawButton(c, b.x, b.y, b.w, b.label, !b.active ? 'disabled' : hov ? 'hover' : 'normal', s, 0, 0);
      h.hit.push({ x: b.x * s, y: b.y * s, w: b.w * s, h: 20 * s, fn: b.active ? function () { FC.press(b.id); } : function () {}, label: b.label, id: b.id, disabled: !b.active });
    });
  };
})(MCL);
