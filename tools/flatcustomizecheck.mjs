// tools/flatcustomizecheck.mjs — #11325: CustomizeFlatLevelScreen + PresetsScreen (src/15mf_flatcustomize.js).
// Rows: (1) the preset table against PresetsScreen.java (.decomp: names of icon/biome/blocks/thickness, order), (2) every preset string
// parses to its layer stack and round-trips, and a flat column built from it has those blocks, (3) button layout against the Java
// coordinates, (4) Remove Layer semantics, (5) engine parser rules (bad layer -> Classic Flat, n clamped).
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const D = MCLITE_ROOT + '/.decomp/net/minecraft/';
const rd = (f) => readFileSync(D + f, 'utf8');
const BL = rd('block/Blocks.java'), IT = rd('item/Items.java'), BK = rd('world/biome/BiomeKeys.java');
const nameOf = (t, f) => { const i = t.indexOf(f + ' = '); const m = /(?:register|of|method_\d+)\(\s*"([a-z_]+)"/.exec(t.slice(i, i + 200)); if (!m) throw new Error('no name for ' + f); return m[1]; };
const psrc = rd('client/gui/screen/PresetsScreen.java'), csrc = rd('client/gui/screen/CustomizeFlatLevelScreen.java');
function decompPresets() {
  const body = psrc.slice(psrc.indexOf('static {'), psrc.indexOf('static class SuperflatPreset'));
  const out = [];
  for (const m of body.matchAll(/addPreset\(([\s\S]*?)\n        \);/g)) {
    const t = m[1];
    const key = /"createWorld\.customize\.preset\.([a-z_]+)"/.exec(t)[1];
    const icon = /(Blocks|Items)\.(field_\d+)/.exec(t);
    const biome = nameOf(BK, /BiomeKeys\.(field_\d+)/.exec(t)[1]);
    const layers = [...t.matchAll(/FlatChunkGeneratorLayer\((\d+), Blocks\.(field_\d+)\)/g)].map((x) => [+x[1], nameOf(BL, x[2])]);
    out.push({ key, icon: nameOf(icon[1] === 'Blocks' ? BL : IT, icon[2]), biome, layers });
  }
  return out;
}
const KEYS = { classic_flat: 'Classic Flat', tunnelers_dream: "Tunnelers' Dream", water_world: 'Water World', overworld: 'Overworld Survival Terrain',
  snowy_kingdom: 'Snowy Kingdom', bottomless_pit: 'Bottomless Pit', desert: 'Desert', redstone_ready: 'Redstone Ready', the_void: 'The Void' };
function eng(mut) {
  const M = loadEngine({ extra: ['07_world.js', '08_lighting.js', '15mf_flatcustomize.js'] });
  if (mut) mut(M);
  return M;
}
function coords() {   // button rects read out of the Java init(): [x-expr, y-expr]
  const find = (src, label) => { const i = src.indexOf(label); const seg = src.slice(Math.max(0, i - 300), i); const ms = [...seg.matchAll(/new ButtonWidget\(this\.width \/ 2 ([-+]) (\d+), this\.height - (\d+)/g)]; const m = ms[ms.length - 1]; return [m[1] === '-' ? -+m[2] : +m[2], +m[3]]; };
  return { remove: find(csrc, 'removeLayer"'), presets: find(csrc, 'customize.presets"'), done: find(csrc, 'ScreenTexts.DONE'), cancel: find(csrc, 'ScreenTexts.CANCEL'),
    use: find(psrc, 'presets.select"'), pcancel: find(psrc, 'ScreenTexts.CANCEL') };
}
function run(mut) {
  const M = eng(mut), FC = M.FlatCustomize, bad = [];
  const dp = decompPresets();
  if (dp.length !== 9) bad.push('decomp presets ' + dp.length);
  if (FC.PRESETS.length !== dp.length) bad.push('preset count ' + FC.PRESETS.length + ' vs ' + dp.length);
  dp.forEach((d, i) => {
    const p = FC.PRESETS[i]; if (!p) return;
    if (p[0] !== KEYS[d.key]) bad.push(`preset ${i} name ${p[0]} vs ${KEYS[d.key]}`);
    if (p[1] !== d.icon) bad.push(`${d.key} icon ${p[1]} vs ${d.icon}`);
    if (p[2] !== d.biome) bad.push(`${d.key} biome ${p[2]} vs ${d.biome}`);
    if (JSON.stringify(p[3]) !== JSON.stringify(d.layers)) bad.push(`${d.key} layers ${JSON.stringify(p[3])} vs ${JSON.stringify(d.layers)}`);
    // string -> parse -> same stack bottom-first, round trip, generated column
    const str = FC.presetString(p), cfg = FC.parse(str);
    const want = d.layers.slice().reverse().map(([n, k]) => [k, n]);
    if (JSON.stringify(cfg.layers) !== JSON.stringify(want)) bad.push(`${d.key} parse ${JSON.stringify(cfg.layers)} vs ${JSON.stringify(want)}`);
    if (cfg.biome !== d.biome) bad.push(`${d.key} parsed biome ${cfg.biome}`);
    if (FC.format(cfg) !== str) bad.push(`${d.key} round trip ${FC.format(cfg)} vs ${str}`);
    M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla', worldType: 'flat', structures: false, flatPreset: str }));
    const col = M.Gen.genColumn(2, 3);
    let y = -64;
    for (const [name, k] of want) for (let j = 0; j < k && y < 256; j++, y++) {
      const g = M.Section.getXYZ(col.sec[(y + 64) >> 4], 5, (y + 64) & 15, 9);
      const e = M.States.stateOf(name);
      if (g !== e) { bad.push(`${d.key} y=${y}: ${g} want ${e} (${name})`); break; }
    }
    if (y < 256 && M.Section.getXYZ(col.sec[(y + 64) >> 4], 5, (y + 64) & 15, 9) !== 0) bad.push(`${d.key} not air above the stack at y=${y}`);
    if (col.biome[0] !== M.Biomes.indexOf['minecraft:' + d.biome]) bad.push(`${d.key} column biome`);
  });
  // layout vs the Java init()
  const gw = 400, gh = 240, cx = 200, cj = coords();
  FC.open(); let L = FC.layout(gw, gh); const at = (id) => L.buttons.find((b) => b.id === id);
  const chk = (id, ex) => { const b = at(id); if (!b) return bad.push('no button ' + id); if (b.x !== cx + ex[0] || b.y !== gh - ex[1] || b.w !== 150) bad.push(`${id} at ${b.x},${b.y} want ${cx + ex[0]},${gh - ex[1]}`); };
  for (const id of ['remove', 'presets', 'done', 'cancel']) chk(id, cj[id]);
  if (at('remove').active) bad.push('Remove Layer active with no selection');
  FC.st.sel = 0; if (!FC.layout(gw, gh).buttons.find((b) => b.id === 'remove').active) bad.push('Remove Layer inactive with a selection');
  // Remove: selected display row 1 of Classic Flat (dirt) -> bottom-first [bedrock,1],[dirt,1]... top row index 0 = grass
  FC.open(); FC.st.sel = 0; FC.removeSel();
  if (JSON.stringify(FC.st.cfg.layers) !== '[["bedrock",1],["dirt",2]]' || FC.st.sel !== 0) bad.push('remove top layer: ' + JSON.stringify(FC.st.cfg.layers) + ' sel ' + FC.st.sel);
  FC.removeSel(); FC.removeSel(); FC.removeSel();
  if (FC.st.cfg.layers.length || FC.st.sel !== -1) bad.push('remove all leaves ' + FC.st.cfg.layers.length + ' sel ' + FC.st.sel);
  FC.open(); if (FC.layerLabel(0) !== 'Layer 1 (top)') bad.push('top label ' + FC.layerLabel(0));
  if (FC.layerLabel(2) !== 'Layer 1 (bottom)') bad.push('bottom label ' + FC.layerLabel(2));
  if (FC.layerLabel(1) !== 'Layer 2') bad.push('mid label ' + FC.layerLabel(1));
  FC.st.view = 'presets'; FC.st.field = ''; FC.st.psel = -1; L = FC.layout(gw, gh);
  chk('use', cj.use); chk('pcancel', cj.pcancel);
  if (L.buttons.find((b) => b.id === 'use').active) bad.push('Use Preset active with empty field and no selection');
  FC.st.field = 'ab'; if (!FC.layout(gw, gh).buttons.find((b) => b.id === 'use').active) bad.push('Use Preset inactive with text');
  // parser rules (PresetsScreen.parseLayerString/parsePresetString)
  const P = (s) => JSON.stringify(M.Gen.parseFlatPreset(s).layers.map((l) => [l[0], l[1]]));
  if (P('minecraft:stone,minecraft:bogus') !== P('')) bad.push('a bad block must fall back to Classic Flat');
  if (P('0*minecraft:stone,minecraft:dirt') !== '[["stone",0],["dirt",1]]') bad.push('0* layer: ' + P('0*minecraft:stone,minecraft:dirt'));
  if (P('400*minecraft:stone') !== '[["stone",320]]') bad.push('height clamp: ' + P('400*minecraft:stone'));
  if (M.Gen.parseFlatPreset('minecraft:stone;minecraft:nonesuch').biome !== 'minecraft:plains') bad.push('bad biome must be plains');
  return bad;
}
const base = run();
if (base.length) console.log('FAIL baseline: ' + base.slice(0, 8).join('; '));
const breaks = [
  (M) => { M.FlatCustomize.PRESETS.splice(4, 1); },   // dropped preset
  (M) => { const p = M.FlatCustomize.PRESETS[1][3]; [p[1], p[2]] = [p[2], p[1]]; },   // swapped layer
  (M) => { M.FlatCustomize.PRESETS[2][2] = 'ocean'; },
  (M) => { M.FlatCustomize.PRESETS[6][1] = 'stone'; },
  (M) => { M.FlatCustomize.PRESETS[0][0] = 'Flat Classic'; },
  (M) => { const f = M.FlatCustomize.format; M.FlatCustomize.format = (c) => f({ layers: c.layers.slice().reverse(), biome: c.biome }); },
  (M) => { const f = M.FlatCustomize.layout; M.FlatCustomize.layout = (w, h) => { const r = f(w, h); r.buttons.forEach((b) => { if (b.id === 'done') b.y += 4; }); return r; }; },
  (M) => { M.FlatCustomize.removeSel = function () { const st = M.FlatCustomize.st; if (st.sel >= 0) st.cfg.layers.splice(st.sel, 1); }; },
  (M) => { const f = M.Gen.parseFlatPreset; M.Gen.parseFlatPreset = (s) => { const r = f(s); r.layers.reverse(); return r; }; },
  (M) => { const f = M.Gen.parseFlatPreset; M.Gen.parseFlatPreset = (s) => { const r = f(s); r.biome = 'minecraft:plains'; return r; }; },
];
let caught = 0;
for (const b of breaks) if (run(b).length) caught++;
console.log(`${caught} breaks caught (of ${breaks.length}); presets/parse/round-trip/layout/remove ${base.length ? 'FAIL' : 'ok'}`);
process.exit(base.length || caught < breaks.length ? 1 : 0);
