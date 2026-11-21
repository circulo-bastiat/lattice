#!/usr/bin/env node
// #11722 classmap: exercises JigsawBlockEntity (net/minecraft/block/entity)
// jigsawclassescheck.mjs -- #11705: proves 04t_jigsaw.js's RuinedPortalStructurePiece (nether processors),
// LegacySinglePoolElement (writeAir false; plain single true), BlackstoneReplacementStructureProcessor
// (rpNether map + property copy) and Pool (weights/total/fallback, drawn through real village starts).
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07l_spawn.js'], dom: false });
M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
const JG = M.Jigsaw, S = M.States, st = (n) => S.stateOf(n), ST = M.Structures;
const origMap = Object.assign({}, JG.rpNetherMap);
const origRp = JG.rpNether, origPool = JG.poolOf;

function suite() {
  const bad = []; const chk = (c, m) => { if (!c) bad.push(m); };
  JG.rpNetherReset();
  // BlackstoneReplacementStructureProcessor
  const rp = JG.rpNether;
  chk(rp(st('cobblestone'), 5, 1, 1, 1) === st('blackstone'), 'cobblestone->blackstone');
  chk(rp(st('stone_bricks'), 5, 1, 1, 1) === st('polished_blackstone_bricks'), 'stone_bricks->polished bricks');
  chk(rp(st('iron_bars'), 5, 1, 1, 1) === st('chain'), 'iron_bars->chain');
  chk(rp(st('oak_planks'), 5, 1, 1, 1) === st('oak_planks'), 'unmapped untouched');
  const P = M.Reg.PROP;
  let s0 = st('stone_brick_stairs');
  s0 = S.withProp(s0, P.facing, 3); s0 = S.withProp(s0, P.half, 1);
  const r0 = rp(s0, 5, 1, 1, 1);
  chk(S.block[r0] === S.block[st('polished_blackstone_brick_stairs')] && S.propValue(r0, P.facing) === 3 && S.propValue(r0, P.half) === S.propValue(s0, P.half), 'stairs copy facing/half');
  let sl = S.withProp(st('cobblestone_slab'), P.type, 2);
  const r1 = rp(sl, 5, 1, 1, 1);
  chk(S.block[r1] === S.block[st('blackstone_slab')] && S.propValue(r1, P.type) === S.propValue(sl, P.type), 'slab copies type');
  // RuinedPortalStructurePiece nether: gold/lava/netherrack rates
  let gAir = 0, lMag = 0, nMag = 0; const N = 4000;
  for (let i = 0; i < N; i++) {
    if (rp(st('gold_block'), 9, i, 40, 7) === 0) gAir++;
    if (rp(st('lava'), 9, i, 40, 7) === st('magma_block')) lMag++;
    if (rp(st('netherrack'), 9, i, 40, 7) === st('magma_block')) nMag++;
  }
  chk(Math.abs(gAir / N - 0.3) < 0.04, 'gold->air ~0.3 got ' + gAir / N);
  chk(Math.abs(lMag / N - 0.2) < 0.04, 'lava->magma ~0.2 got ' + lMag / N);
  chk(Math.abs(nMag / N - 0.07) < 0.03, 'netherrack->magma ~0.07 got ' + nMag / N);
  // Pool
  const pl = JG.poolOf('village/plains/houses');
  chk(pl.elements.length > 5 && pl.total === pl.elements.reduce((a, e) => a + e.weight, 0), 'pool total = sum of weights');
  chk(pl.elements.some((e) => e.weight !== 1), 'pool keeps non-1 weights');
  chk(JG.poolOf('minecraft:village/plains/houses') === pl, 'pool cached by stripped id');
  chk(JG.poolOf('village/plains/terminators').fallback === null || typeof JG.poolOf('village/plains/terminators').fallback === 'string', 'pool fallback shape');
  chk(JG.poolOf('village/plains/streets').fallback === 'village/plains/terminators', 'streets fallback terminators');
  // LegacySinglePoolElement: village streets (legacy) drop air; bastion (plain) writes it
  chk(JG.poolOf('village/plains/streets').elements.every((e) => e.el.kind !== 'single' || e.el.writeAir === false), 'legacy writes no air');
  chk(JG.poolOf('bastion/mobs/piglin').elements.some((e) => e.el.kind === 'single' && e.el.writeAir === true), 'plain single writes air');
  // real entry: a village start is assembled through poolOf/draw with legacy pieces
  let vill = 0, legacyPieces = 0;
  for (let cz = -80; cz <= 80 && !vill; cz += 4) for (let cx = -80; cx <= 80 && !vill; cx += 4)
    for (const s of ST.startsNear(cx, cz)) if (/village/.test(s.def.name) && s.pieces.length > 3) { vill++; legacyPieces = s.pieces.filter((p) => p.writeAir === false).length; break; }
  chk(vill > 0 && legacyPieces > 0, 'village assembled with legacy (no-air) pieces');
  return bad;
}
const base = suite();
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const restore = () => { for (const k in JG.rpNetherMap) delete JG.rpNetherMap[k]; Object.assign(JG.rpNetherMap, origMap); JG.rpNetherReset(); JG.rpNether = origRp; JG.poolOf = origPool; };
const muts = {
  'map drops cobblestone': () => { delete JG.rpNetherMap.cobblestone; },
  'map wrong bricks': () => { JG.rpNetherMap.stone_bricks = 'blackstone'; },
  'map drops bars': () => { delete JG.rpNetherMap.iron_bars; },
  'no property copy': () => { JG.rpNether = (s, ...a) => { const r = origRp(s, ...a); return M.States.block[r] === M.States.block[s] ? r : M.States.stateOf(M.States.name(r)); }; },
  'gold never air': () => { JG.rpNether = (s, ...a) => s === st('gold_block') ? s : origRp(s, ...a); },
  'lava never magma': () => { JG.rpNether = (s, ...a) => s === st('lava') ? s : origRp(s, ...a); },
  'netherrack always magma': () => { JG.rpNether = (s, ...a) => s === st('netherrack') ? st('magma_block') : origRp(s, ...a); },
  'pool weights flattened': () => { JG.poolOf = (id) => { const p = origPool(id); return Object.assign({}, p, { elements: p.elements.map((e) => ({ el: e.el, weight: 1 })) }); }; },
  'pool total wrong': () => { JG.poolOf = (id) => Object.assign({}, origPool(id), { total: 1 }); },
  'pool fallback lost': () => { JG.poolOf = (id) => Object.assign({}, origPool(id), { fallback: null }); },
  'legacy writes air': () => { JG.poolOf = (id) => { const p = origPool(id); return Object.assign({}, p, { elements: p.elements.map((e) => ({ el: Object.assign({}, e.el, { writeAir: e.el.kind === 'single' }), weight: e.weight })) }); }; },
};
let caught = 0;
for (const [n, f] of Object.entries(muts)) {
  restore(); f(); let r; try { r = suite(); } catch (e) { r = ['threw']; } restore();
  if (r.length) caught++; else console.log('x break not caught: ' + n);
}
console.log(caught + ' breaks caught');
process.exit(caught === Object.keys(muts).length ? 0 : 1);
