#!/usr/bin/env node
// createworld11616check.mjs — #11616 (AUDIT-MAP). 15mc_createworld.js: CreateWorldScreen (state, tweakDefaults, layout, apply/create),
// MoreOptionsDialog (more-options page, type cycling, Single Biome) and CustomizeBuffetLevelScreen (buffetBiomes list/filter).
// Entry points: Hud title view 'create' draws/keys CreateWorld, SelectWorld opens it. Each cut must be noticed.
import { readFileSync } from 'node:fs';
import { loadEngine, SRC } from './loadsrc.mjs';
let N = 0;
const hud = readFileSync(SRC + '/15_hud.js', 'utf8');
const sw = readFileSync(SRC + '/15mw_selectworld.js', 'utf8');
function run(patch) {
  const f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    const E = loadEngine({ extra: ['15mc_createworld.js'], ...(patch ? { patch: (fn, t) => (fn === '15mc_createworld.js' ? patch(t) : t) } : {}) });
    const C = E.CreateWorld;
    E.Hud = E.Hud || {}; E.Hud.hit = [];
    E.Save = {}; E.Input = { shift: false };
    let played = null; E.Main = { play: (o) => { played = o; } };
    let diff = null, hcSet = null; E.Diff = { hardcore: true, set: (d) => { diff = d; }, setHardcore: (v) => { hcSet = v; } };
    E.Worlds = {};
    E.Biomes = { names: ['minecraft:plains', 'minecraft:desert', 'minecraft:nether_wastes', 'minecraft:the_end', 'minecraft:snowy_plains', 'minecraft:the_void'] };
    E.GameRules = undefined; E.PackScreen = undefined;
    // CustomizeBuffetLevelScreen
    ok(C.buffetBiomes().join() === 'minecraft:desert,minecraft:plains,minecraft:snowy_plains', 'buffet list: overworld biomes, sorted');
    ok(C.buffetBiomes('snowy').join() === 'minecraft:snowy_plains' && C.buffetBiomes('snowy plains').length === 1, 'buffet search filter');
    // CreateWorldScreen
    C.open();
    ok(C.st.mode === 'survival' && C.st.difficulty === 'normal' && !C.st.cheats && C.st.structures && E.Hud.titleView === 'create' && E.Hud.titleSeed === '', 'fresh state');
    C.press('mode'); ok(C.st.mode === 'hardcore' && C.effDifficulty() === 'hard' && !C.effCheats(), 'hardcore forces hard, no cheats');
    C.press('mode'); ok(C.st.mode === 'creative' && C.st.cheats === true, 'creative turns cheats on');
    C.press('cheats'); ok(C.st.cheats === false && C.st.tweakedCheats, 'cheats toggle');
    C.press('mode'); C.press('mode'); C.press('mode'); ok(C.st.mode === 'creative' && C.st.cheats === false, 'tweaked cheats stick'); C.press('mode');
    let L = C.layout(400, 300), ids = L.buttons.map((b) => b.id);
    ok(['mode', 'difficulty', 'cheats', 'datapacks', 'rules', 'more', 'create', 'cancel'].every((i) => ids.includes(i)), 'main page buttons');
    const bm = L.buttons.find((b) => b.id === 'mode'), bd = L.buttons.find((b) => b.id === 'difficulty');
    ok(bm.x === 45 && bm.y === 100 && bd.x === 205 && L.field.y === 60 && L.field.x === 100, 'vanilla button geometry');
    ok(L.buttons.find((b) => b.id === 'create').y === 272, 'create at height-28');
    C.st.name = '  '; ok(!C.layout(400, 300).buttons.find((b) => b.id === 'create').active && C.create() === false, 'blank name blocks create');
    C.st.name = 'W'; C.key('x'); ok(C.st.name === 'Wx', 'typing in name'); C.key('Backspace'); ok(C.st.name === 'W', 'backspace name');
    // MoreOptionsDialog
    C.press('more'); L = C.layout(400, 300); ids = L.buttons.map((b) => b.id);
    ok(C.st.more && C.st.focus === 'seed' && ids.includes('structures') && ids.includes('type') && ids.includes('bonus') && ids.includes('moredone') && !ids.includes('mode'), 'more page');
    C.key('4'); C.key('2'); ok(E.Hud.titleSeed === '42', 'seed typed into Hud.titleSeed');
    C.press('structures'); ok(C.st.structures === false, 'structures toggle');
    ok(C.types().join() === 'default,large_biomes,amplified,single_biome' || C.types().includes('single_biome'), 'types include single biome');
    C.press('type'); ok(C.st.type === 'large_biomes', 'type cycles');
    C.st.type = 'single_biome'; ok(C.st.type === 'single_biome' && C.layout(400, 300).buttons.some((b) => b.id === 'customize'), 'single biome shows Customize');
    C.press('customize'); ok(C.st.biome === 'minecraft:plains' || C.st.biome === 'minecraft:snowy_plains', 'customize cycles biome');
    C.st.biome = 'minecraft:desert';
    C.press('bonus'); ok(C.st.bonus === true, 'bonus toggle');
    C.cancel(); ok(!C.st.more && C.st.focus === 'name', 'cancel closes more first');
    // apply / create
    C.st.tweakedCheats = false; C.setMode('creative'); C.st.name = ' My '; C.create();
    ok(played && played.seed === '42' && E.Save.newMode === 1 && E.Save.cheats === true && E.Save.structures === false && E.Save.bonusChest === true, 'create writes Save + plays');
    ok(E.Save.fixedBiome === 'minecraft:desert' && E.Save.worldType === 'default' && E.Worlds.pendingName === 'My' && diff === 'normal' && hcSet === null, 'single biome fixedBiome + name trimmed');
    C.st.mode = 'hardcore'; C.apply(); ok(hcSet === true && diff === 'hard' && E.Save.newMode === 0 && E.Save.bonusChest === false, 'hardcore apply');
    // entry points
    ok(/NS\.CreateWorld\.draw\(c, H\.w, H\.h, s\)/.test(hud) && /NS\.CreateWorld\.key\(key\)/.test(hud) && /CreateWorld\.back\(\)/.test(hud) && /CreateWorld\.open\(\)/.test(sw), 'Hud/SelectWorld reach the screen');
  } catch (e) { f.push('threw: ' + e.message); }
  return f;
}
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const muts = [
  ['buffet sort', (t) => t.replace('return out.sort();', 'return out;')],
  ['buffet nether filter', (t) => t.replace('nether_wastes|', '')],
  ['buffet search', (t) => t.replace("indexOf(f) >= 0", 'indexOf(f) >= -1')],
  ['hardcore difficulty', (t) => t.replace("CW.hardcore() ? 'hard'", "false ? 'hard'")],
  ['creative cheats', (t) => t.replace("s.cheats = (m === 'creative')", 's.cheats = false')],
  ['tweaked cheats', (t) => t.replace('if (!s.tweakedCheats) s.cheats', 'if (true) s.cheats')],
  ['mode cycle', (t) => t.replace("CW.MODES = ['survival', 'hardcore', 'creative']", "CW.MODES = ['survival', 'creative', 'hardcore']")],
  ['create geometry', (t) => t.replace("b('create', T.create, L, gh - 28", "b('create', T.create, L, gh - 30")],
  ['blank name', (t) => t.replace('s.name.trim().length > 0)', 'true)')],
  ['more focus', (t) => t.replace("s.focus = s.more ? 'seed' : 'name'", "s.focus = 'name'")],
  ['cancel closes more', (t) => t.replace('if (CW.st && CW.st.more) {', 'if (false) {')],
  ['seed typing', (t) => t.replace('h.titleSeed += key', 'h.titleSeed += ""')],
  ['single biome customize', (t) => t.replace("if (s.type === 'single_biome') b('customize'", "if (false) b('customize'")],
  ['fixed biome', (t) => t.replace("S.fixedBiome = s.type === 'single_biome' ?", "S.fixedBiome = false ?")],
  ['new mode', (t) => t.replace("s.mode === 'creative' ? 1 : 0", '0')],
  ['hardcore apply', (t) => t.replace('if (hc) D.setHardcore(true)', '')],
  ['bonus hardcore', (t) => t.replace('CW.st.bonus && !CW.hardcore()', 'CW.st.bonus')],
  ['name trim', (t) => t.replace('pendingName = s.name.trim()', 'pendingName = s.name')],
];
let caught = 0; const missed = [];
for (const [name, fn] of muts) {
  const probe = (t) => { const o = fn(t); if (o === t) throw new Error('mutant did not change source: ' + name); return o; };
  let f; try { f = run(probe); } catch (e) { if (/did not change/.test(e.message)) { console.log('FAIL ' + e.message); process.exit(1); } f = ['threw']; }
  if (f.length) { caught++; console.log('   ✓ cutting ' + name + ' fails: ' + f[0].slice(0, 70)); } else { missed.push(name); console.log('  FAIL cutting ' + name + ' went unnoticed'); }
}
console.log(` assertions passed .. ${N / (muts.length + 1) | 0}`);
console.log(` failures ........... ${missed.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(missed.length ? 1 : 0);
