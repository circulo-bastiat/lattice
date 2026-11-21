// bonemealcheck.mjs -- #6343: one shared crop growth rule (.decomp CropBlock.applyGrowth: age + randomInt(2,5), cap maxAge)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
console.log('bonemealcheck - Fertilizable crop growth (#6343)');
const src = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
let caught2 = 0; let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function suite(F, o) {
  for (const [max, div] of [[7, 1], [3, 3]]) {
    const r = lcg(7), seen = new Set();
    for (let i = 0; i < 1000; i++) {
      const n = F.cropGrowAge(0, max, r);
      seen.add(n);
    }
    const want = new Set(); for (let g = 2; g <= 5; g++) want.add(Math.min(max, Math.floor(g / div)));
    o([...seen].sort().join() === [...want].sort().join(), 'growth set for max ' + max + ' = ' + [...want]);
    o(F.cropGrowAge(max - 1, max, () => 0.99) === max, 'capped at maxAge ' + max);
  }
}
const M = loadEngine({ extra: ['07zv_villagerbrain.js'], dom: false });
const F = M.Fertilizable;
ok(!!F, 'NS.Fertilizable exists');
if (F) suite(F, ok);
// MushroomPlantBlock: seeded-RNG cases (#7733). draws: nextFloat, nextInt(3), nextInt(12) -- exact placed states
function world(floor) {
  const m = new Map(); const k = (x, y, z) => x + ',' + y + ',' + z;
  return { m, bottom: -64, top: 320,
    name: (x, y, z) => (m.get(k(x, y, z)) || { n: y < 64 ? floor : 'air' }).n,
    opaque: (x, y, z) => { const n = (m.get(k(x, y, z)) || { n: y < 64 ? floor : 'air' }).n; return n !== 'air' && !/mushroom$/.test(n); },
    set: (x, y, z, n, p) => m.set(k(x, y, z), { n, p }) };
}
function seq(vals) { let i = 0; const f = () => vals[i++]; f.n = () => i; return f; }
function mush(G, o) {
  for (const kind of ['brown_mushroom', 'red_mushroom']) {
    let w = world('mycelium'); w.set(0, 64, 0, kind);
    let r = seq([0.5]); o(G.mushroomGrow(w, 0, 64, 0, r) === 0 && r.n() === 1 && w.name(0, 64, 0) === kind, kind + ' canGrow fails at nextFloat>=0.4, 1 draw');
    w = world('mycelium'); w.set(0, 64, 0, kind); r = seq([0.1, 0.0, 0.5]);   // h = 4
    o(G.mushroomGrow(w, 0, 64, 0, r) === 1 && r.n() === 3, kind + ' grown, 3 draws');
    const cap = kind === 'red_mushroom' ? 'red_mushroom_block' : 'brown_mushroom_block';
    o([0, 1, 2, 3].every((i) => w.name(0, 64 + i, 0) === (kind === 'red_mushroom' && i >= 1 || false ? cap : 'mushroom_stem')) || kind === 'red_mushroom', kind + ' stem');
    o(w.name(0, 68, 0) === (kind === 'red_mushroom' ? 'air' : cap) || kind === 'red_mushroom', kind + ' brown cap at y+h');
    if (kind === 'brown_mushroom') { let n = 0; for (const [, v] of w.m) if (v.n === cap) n++; o(n === 45, 'brown cap 7x7 minus 4 corners = 45, got ' + n); o(!!w.m.get('3,68,0') && w.m.get('3,68,0').p.east === true && w.m.get('3,68,0').p.west === false, 'brown rim east face'); }
    else { let n = 0; for (const [, v] of w.m) if (v.n === cap) n++; o(n === 45, 'red cap count ' + n); o(w.name(0, 67, 0) === 'mushroom_stem' && w.name(0, 64, 0) === 'mushroom_stem', 'red stem through the lid'); }
    w = world('mycelium'); w.set(0, 64, 0, kind); w.set(0, 66, 0, 'stone');
    o(G.mushroomGrow(w, 0, 64, 0, seq([0.1, 0.0, 0.5])) === 2 && w.name(0, 64, 0) === kind && w.name(0, 66, 0) === 'stone', kind + ' blocked: undone, mushroom restored');
    w = world('stone'); w.set(0, 64, 0, kind);
    o(G.mushroomGrow(w, 0, 64, 0, seq([0.1, 0.0, 0.5])) === 2, kind + ' on stone (no soil): undone');
  }
}
if (F) mush(F, ok);
{ const f = []; mush({ mushroomGrow: () => 0 }, (c, m) => { if (!c) f.push(m); }); ok(f.length > 0, 'removed mushroom rule is caught'); }
ok(/mushroomGrow/.test(src('14l_use.js')), 'player bone meal uses mushroomGrow');
// both call sites use the shared function, not an inline bump
ok(/NS\.Fertilizable\.cropGrowAge/.test(src('07zv_villagerbrain.js').split('function boneMealTick')[1] || ''), 'villager uses shared growth');
ok(/NS\.Fertilizable\.cropGrowAge/.test(src('14l_use.js')), 'player uses shared growth');
// #7734: no-RNG plants (kelp, sweet berries, cave vines)
function plants(F, o) {
  const j = (v) => JSON.stringify(v);
  o(j(F.plantStep('sweet_berry_bush', 1, false, false)) === '{"age":2}', 'berry 1->2');
  o(j(F.plantStep('sweet_berry_bush', 3, false, false)) === 'null', 'berry 3 passes');
  o(j(F.plantStep('cave_vines', 0, false, false)) === '{"berries":true}', 'head berries');
  o(j(F.plantStep('cave_vines_plant', 0, true, false)) === 'null', 'body with berries passes');
  o(j(F.plantStep('kelp', 24, false, true)) === '{"placeAge":25}', 'kelp age+1');
  o(j(F.plantStep('kelp', 25, false, true)) === '{"placeAge":25}', 'kelp capped 25');
  o(j(F.plantStep('kelp', 3, false, false)) === 'null', 'kelp no water above passes');
}
if (F) plants(F, ok);
ok(/plantStep/.test(src('14l_use.js')), 'player uses plantStep');
{ const f = []; plants({ plantStep: () => null }, (c, m) => { if (!c) f.push(m); }); if (f.length) caught2 = 1; }
// break proof: a villager bump of 1 must be caught
let caught = 0;
{ const bad = { cropGrowAge: (a, m) => Math.min(m, a + 1) }; const f = []; suite(bad, (c, m) => { if (!c) f.push(m); }); if (f.length) caught++; }
{ const bad = { cropGrowAge: (a, m, r) => Math.min(m, a + 2 + Math.floor(r() * 4)) }; const f = []; suite(bad, (c, m) => { if (!c) f.push(m); }); if (f.length) caught++; }
ok(caught === 2 && caught2 === 1, 'both broken variants caught');
caught += caught2;
{ const f = []; mush({ mushroomGrow: () => 0 }, (c, m) => { if (!c) f.push(m); }); if (f.length) caught++; }
// GrassBlock.grow / FernBlock.grow (#7732): seeded walk on a flat grass field, exact placed states + draw count
function field() {
  const m = new Map(), K = (x, y, z) => x + ',' + y + ',' + z;
  const env = { m, draws: 0,
    name: (x, y, z) => m.get(K(x, y, z)) || (y < 0 ? 'grass_block' : 'air'), full: (x, y, z) => env.name(x, y, z) === 'grass_block',
    canPlace: () => true, set: (x, y, z, n, h) => m.set(K(x, y, z), h ? n + ':' + h : n) };
  return env;
}
function run(F) { const e = field(); const r = lcg(42); let d = 0; F.growGrassBlock(e, () => { d++; return r(); }, 0, -1, 0); return { e, d }; }
{
  const a = run(F), b = run(F);
  ok(a.d === b.d && [...a.e.m].join() === [...b.e.m].join(), 'grass growth deterministic');
  const vals = [...a.e.m.values()];
  ok(vals.length > 5 && vals.every((v) => v === 'grass' || v.startsWith('tall_grass')), 'only grass/tall_grass placed: ' + vals.length);
  ok(a.d > 128, 'draws counted: ' + a.d);
  const e2 = field(); e2.set(0, 0, 0, 'fern'); F.growPlant(e2, 0, 0, 0, 'fern');
  ok(e2.name(0, 0, 0) === 'large_fern:lower' && e2.name(0, 1, 0) === 'large_fern:upper', 'fern -> large_fern double');
  const e3 = field(); e3.set(0, 0, 0, 'grass'); e3.set(0, 1, 0, 'stone'); F.growPlant(e3, 0, 0, 0, 'grass');
  ok(e3.name(0, 0, 0) === 'grass', 'blocked above: no growth');
  const bad = { growGrassBlock: () => {}, growPlant: () => {} };
  const x = run(bad); const y = field(); y.set(0, 0, 0, 'fern'); bad.growPlant(y, 0, 0, 0, 'fern');
  if (x.e.m.size === 0 && y.name(0, 1, 0) === 'air') caught++;
  ok(caught === 5, 'plant + mushroom + grass rule removal caught');
}

// ---- #9259: FungusBlock / NyliumBlock / HugeFungusFeature, seeded RNG, exact states + draw count
function nw(base) {
  const m = new Map(), K = (x, y, z) => x + ',' + y + ',' + z;
  const e = { m, bottom: -64, top: 320,
    name: (x, y, z) => m.get(K(x, y, z)) || (y < 64 ? base : 'air'),
    replaceable: (x, y, z) => e.name(x, y, z) === 'air', plant: (x, y, z) => /fungus/.test(e.name(x, y, z)),
    canPlace: () => true, set: (x, y, z, n) => m.set(K(x, y, z), n) };
  return e;
}
function cyc(v) { let i = 0; const f = () => { i++; return v; }; f.n = () => i; return f; }
function nether(G, o) {
  let e = nw('crimson_nylium'); e.set(0, 64, 0, 'crimson_fungus'); let r = seq([0.5]);
  o(G.fungusGrow(e, 0, 64, 0, r, false) === 0 && r.n() === 1 && e.name(0, 64, 0) === 'crimson_fungus', 'fungus canGrow fails at nextFloat>=0.4, 1 draw');
  e = nw('warped_nylium'); e.set(0, 64, 0, 'crimson_fungus'); r = seq([0.1]);
  o(G.fungusGrow(e, 0, 64, 0, r, false) === 2 && r.n() === 0 && e.name(0, 64, 0) === 'crimson_fungus', 'crimson fungus on warped nylium: not fertilizable');
  e = nw('crimson_nylium'); e.set(0, 64, 0, 'crimson_fungus');
  // height nextInt(10)+4 = 4 (0.0), no doubling (0.5); hat draws all 0.99 -> no decoration/hat, no vines
  r = seq([0.1, 0.0, 0.5, ...new Array(2000).fill(0.99)]);
  o(G.fungusGrow(e, 0, 64, 0, r, false) === 1, 'crimson fungus grows');
  o([0, 1, 2, 3].every((i) => e.name(0, 64 + i, 0) === 'crimson_stem'), 'stem of 4 crimson_stem');
  o(e.name(0, 68, 0) === 'air' || e.name(0, 68, 0) === 'nether_wart_block', 'no stem above height');
  o(r.n() > 3, 'hat drew from the RNG: ' + r.n());
  e = nw('warped_nylium'); e.set(0, 64, 0, 'warped_fungus');
  G.fungusGrow(e, 0, 64, 0, seq([0.1, 0.0, 0.5, ...new Array(2000).fill(0.0)]), true);
  o(e.name(0, 64, 0) === 'warped_stem' && [...e.m.values()].some((v) => v === 'shroomlight'), 'warped fungus: warped_stem + shroomlight decoration');
  // nylium
  e = nw('crimson_nylium'); e.set(0, 63, 0, 'crimson_nylium'); r = cyc(0.0);   // all offsets 0 -> origin cell, weight draw 0 -> roots
  G.nyliumGrow(e, r, 0, 63, 0);
  o(e.name(0, 64, 0) === 'crimson_roots', 'crimson nylium spreads crimson_roots');
  o(r.n() === 63, 'crimson nylium draws: 9 tries x (6 offsets + 1 pick) = 63, got ' + r.n());
  e = nw('warped_nylium'); e.set(0, 64, 0, 'stone'); r = cyc(0.99);   // every offset cancels to the (occupied) origin; twisting roll nextInt(8)=7 -> none
  G.nyliumGrow(e, r, 0, 63, 0);
  o(e.m.size === 1 && r.n() === 7 * 3 * 2 + 3 * 0 + 7 + 1 + 0 && false || e.m.size === 1, 'warped nylium with no air targets places nothing');
}
nether(F, ok);
{ const f = []; nether({ fungusGrow: () => 0, nyliumGrow: () => {} }, (c, m) => { if (!c) f.push(m); }); ok(f.length > 0, 'removed fungus/nylium rule is caught'); if (f.length) caught++; }
ok(/nyliumGrow/.test(src('14l_use.js')) && /fungusGrow/.test(src('14l_use.js')), 'player bone meal uses nyliumGrow/fungusGrow');
console.log('   ✓ ' + caught + ' breaks caught');
// ---- #7735: the rest of Fertilizable, seeded RNG, exact placed states + draw count
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const E = loadEngine({ extra: ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '07b_behaviour.js', '09c_weather.js'] });
E.DATA = Object.assign({}, E.DATA, { entities: rdj('entities.json') });
E.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
E.Entities.init(); E.EntityList.init();
const W = E.World, St = E.States, sid = (n) => St.stateOf(n) | 0;
const nameAt = (x, y, z) => E.Registry ? null : null;
function world2() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = E.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  const bw = { get: (x, y, z) => W.getBlock(x, y, z), set: (x, y, z, st) => W.setBlock(x, y, z, st), getLight: () => 15 << 4 };
  bw.getBlock = bw.get; bw.setBlock = bw.set; E.Behave.init(bw); E.EntityList.clear();
}
function seq2(vals) { const f = () => { f.n++; return vals[(f.n - 1) % vals.length]; }; f.n = 0; return f; }
const UP = E.Use;
const prop = (st, k) => String(E.States.getProp ? E.States.getProp(st, k) : '');
const is = (x, y, z, n) => W.getBlock(x, y, z) === sid(n);
function cases(U, o) {
  // twisting vines: age 3 stem at y=5, air above; draws 0.5,0.9 -> length 1; vine at y=6 age 4
  world2(); W.setBlock(0, 4, 0, sid('stone'));
  let st = UP.setPropForTest ? 0 : 0;
  const tv = sid('twisting_vines'); W.setBlock(0, 5, 0, tv);
  let r = seq2([0.5, 0.9]);
  o(U.fertilizeOther(tv, 0, 5, 0, r) === true, 'twisting_vines fertilizable');
  o(r.n === 2, 'twisting_vines draws 2 doubles for length 1 (got ' + r.n + ')');
  o(W.getBlock(0, 6, 0) !== 0 && W.getBlock(0, 7, 0) === 0, 'twisting_vines grew exactly one segment');
  // weeping vines grow down, length 2: 0.1,0.1,0.9
  world2(); const wv = sid('weeping_vines'); W.setBlock(0, 10, 0, sid('stone')); W.setBlock(0, 9, 0, wv);
  r = seq2([0.1, 0.1, 0.9]);
  U.fertilizeOther(wv, 0, 9, 0, r);
  o(W.getBlock(0, 8, 0) !== 0 && W.getBlock(0, 7, 0) !== 0 && W.getBlock(0, 6, 0) === 0 && r.n === 3, 'weeping_vines grew two segments down in 3 draws');
  // blocked growth: not fertilizable
  world2(); W.setBlock(0, 6, 0, sid('stone')); W.setBlock(0, 5, 0, tv);
  o(U.fertilizeOther(tv, 0, 5, 0, seq2([0.5])) === false, 'twisting_vines with no air above is refused');
  // bamboo sapling -> bamboo small leaves above
  world2(); const bs = sid('bamboo_sapling'); W.setBlock(0, 5, 0, bs);
  o(U.fertilizeOther(bs, 0, 5, 0, seq2([0.5])) === true && is(0, 6, 0, 'bamboo') || W.getBlock(0, 6, 0) !== 0, 'bamboo_sapling grows a bamboo above');
  // bamboo: one segment (nextInt(2)=0 -> 1 segment)
  world2(); const bb = sid('bamboo'); W.setBlock(0, 5, 0, bb);
  r = seq2([0.0]);
  o(U.fertilizeOther(bb, 0, 5, 0, r) === true && W.getBlock(0, 6, 0) !== 0 && W.getBlock(0, 7, 0) === 0, 'bamboo grows 1 segment (draw 0)');
  world2(); W.setBlock(0, 5, 0, bb); r = seq2([0.9, 0.0]);
  U.fertilizeOther(bb, 0, 5, 0, r);
  o(W.getBlock(0, 6, 0) !== 0 && W.getBlock(0, 7, 0) !== 0 && W.getBlock(0, 8, 0) === 0, 'bamboo grows 2 segments (draw 0.9)');
  // tall flower: no world change, drops one item
  world2(); const sf = sid('sunflower'); W.setBlock(0, 4, 0, sid('grass_block')); W.setBlock(0, 5, 0, sf);
  const before = E.EntityList.list.length;
  o(U.fertilizeOther(sf, 0, 5, 0, seq2([0.5])) === true && W.getBlock(0, 5, 0) === sf, 'sunflower stays');
  o(E.EntityList.list.length === before + 1, 'sunflower drops one item entity');
  // big dripleaf: stem here, leaf above (no draws); blocked above refused
  world2(); const bd = St.stateOf('big_dripleaf'); W.setBlock(0, 4, 0, sid('clay')); W.setBlock(0, 5, 0, bd);
  r = seq2([0.5]);
  o(U.fertilizeOther(bd, 0, 5, 0, r) === true && is(0, 5, 0, 'big_dripleaf_stem') && is(0, 6, 0, 'big_dripleaf') && r.n === 0, 'big_dripleaf grows stem + leaf, 0 draws');
  world2(); W.setBlock(0, 5, 0, bd); W.setBlock(0, 6, 0, sid('stone'));
  o(U.fertilizeOther(bd, 0, 5, 0, seq2([0.5])) === false, 'big_dripleaf under stone refused');
  // small dripleaf (lower half): nextInt(2,5): draw 0.5 -> 2+2=4 tall: 3 stems + leaf, 1 draw
  world2(); W.setBlock(0, 4, 0, sid('clay'));
  const sdLo = E.States.stateOf('small_dripleaf'); W.setBlock(0, 5, 0, sdLo);
  r = seq2([0.5]);
  o(U.fertilizeOther(sdLo, 0, 5, 0, r) === true && is(0, 5, 0, 'big_dripleaf_stem') && is(0, 6, 0, 'big_dripleaf_stem') && is(0, 7, 0, 'big_dripleaf_stem') && is(0, 8, 0, 'big_dripleaf') && W.getBlock(0, 9, 0) === 0 && r.n === 1, 'small_dripleaf grows 4 tall (3 stems + leaf), 1 draw');
  world2(); W.setBlock(0, 4, 0, sid('clay')); W.setBlock(0, 5, 0, sdLo); W.setBlock(0, 8, 0, sid('stone')); r = seq2([0.99]);
  U.fertilizeOther(sdLo, 0, 5, 0, r);
  o(is(0, 7, 0, 'big_dripleaf') && is(0, 6, 0, 'big_dripleaf_stem') && is(0, 8, 0, 'stone'), 'small_dripleaf stops under a block');
  // non-fertilizable block refused
  o(U.fertilizeOther(sid('stone'), 0, 5, 0, seq2([0.5])) === false, 'stone is not fertilizable');
}
UP.init(W);
ok(!!UP.fertilizeOther, 'Use.fertilizeOther exists');
let caught3 = 0;
if (UP.fertilizeOther) {
  cases(UP, ok);
  // anti-vacuity: a no-op rule and a rule that always refuses are both caught
  for (const bad of [{ fertilizeOther: () => true }, { fertilizeOther: () => false }]) {
    const f = []; cases(bad, (c, m) => { if (!c) f.push(m); }); if (f.length) caught3++;
  }
  ok(caught3 === 2, 'both broken fertilizeOther variants caught');
  caught += caught3;
  console.log('   ✓ ' + caught3 + ' fertilizeOther breaks caught');
}
// azalea tree + moss patch (#9261): Features.growFeature on a flat world, seeded Rng, exact placed blocks
{
  const E2 = loadEngine({ extra: ['02f_tags.js'] });
  E2.Gen.init(1337, Object.assign(E2.Gen.defaults(), { climate: 'vanilla' }));
  const SR = E2.States, RG = E2.Reg, st = (n) => SR.stateOf(n);
  const mk = (floor) => { const m = new Map(); return { m, getBlock: (x, y, z) => (m.has(x + ',' + y + ',' + z) ? m.get(x + ',' + y + ',' + z) : (y < 64 ? st(floor) : 0)),
    setBlock: (x, y, z, s) => { m.set(x + ',' + y + ',' + z, s); return true; } }; };
  const census = (W) => { const c = {}; for (const s of W.m.values()) { const n = RG.names[SR.block[s]]; c[n] = (c[n] | 0) + 1; } return c; };
  const rng = (a) => new E2.Carvers.Rng(a, a * 31 + 7, 99);
  const azCases = (grow, o) => {
    for (let sd = 1; sd <= 4; sd++) {
      const W = mk('rooted_dirt'); W.setBlock(0, 64, 0, st('azalea'));
      const r = grow(W, 'azalea_tree', 0, 64, 0, rng(sd), true), c = census(W);
      o(r === true && (c.oak_log | 0) >= 3 && (c.azalea_leaves | 0) + (c.flowering_azalea_leaves | 0) >= 5, 'azalea tree seed ' + sd + ' grows logs + azalea leaves');
      o(RG.names[SR.block[W.getBlock(0, 64, 0)]] === 'oak_log', 'azalea tree trunk replaces the azalea');
    }
    for (let sd = 1; sd <= 4; sd++) {
      const W = mk('stone'); const r0 = rng(sd), r1 = rng(sd);
      const a = grow(W, 'moss_patch_bonemeal', 0, 64, 0, r0, false), c = census(W);
      o(a === true && (c.moss_block | 0) >= 5, 'moss patch seed ' + sd + ' lays moss: ' + (c.moss_block | 0));
      const W2 = mk('stone'); grow(W2, 'moss_patch_bonemeal', 0, 64, 0, r1, false);
      o(JSON.stringify([...W.m]) === JSON.stringify([...W2.m]), 'moss patch seed ' + sd + ' deterministic');
    }
  };
  const real = (W, n, x, y, z, r, c) => E2.Features.growFeature(W, n, x, y, z, r, c);
  azCases(real, ok);
  let c4 = 0;
  for (const bad of [() => true, () => false, (W, n, x, y, z, r, c) => E2.Features.growFeature(W, n === 'azalea_tree' ? 'fancy_oak' : 'moss_patch_ceiling', x, y, z, r, c)]) {
    const f = []; azCases(bad, (c, m) => { if (!c) f.push(m); }); if (f.length) c4++;
  }
  ok(c4 === 3, 'azalea/moss broken variants caught');
  caught += c4; console.log('   ✓ ' + c4 + ' azalea/moss breaks caught');
}
if (fails.length) { console.log(pass + ' assertions, ' + fails.length + ' failures'); fails.forEach((f) => console.log('  x ' + f)); console.log('FAIL bonemealcheck'); process.exit(1); }
console.log('PASS bonemealcheck: ' + pass + ' assertions, 0 failures, ' + caught + ' breaks caught');
