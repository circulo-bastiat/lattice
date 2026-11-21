#!/usr/bin/env node
// feataudit11486check.mjs — #11486: drives 04j_features.js through Features.api for the classes the audit listed unchecked:
// IntProvider (constant/uniform/clamped/biased_to_bottom/weighted_list), HeightProvider (uniform/trapezoid/very_biased_to_bottom),
// BlockPredicate (matching_blocks/tag_match/solid), PlacementModifier (compiled chains), ConfiguredFeature + GenerationSettings
// (F.configured / F.byBiome), OreFeature, DiskFeature, SimpleBlockFeature, BlockColumnFeature (prioritize_tip truncation),
// MushroomBlock.canSurvive (featureSurvives). Anti-vacuity: each source break must fail its own probe.
import fs from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine(patch ? { patch } : {});
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla', features: true }));
  const F = M.Features, A = F.api, SR = M.States, o = {};
  const H = A.H, MINY = A.MINY, sb = () => new Uint16Array(H * 256);
  const st = (n) => SR.stateOf(n);
  const draw = (f, n, seed) => { const r = A.rngAt(seed || 7, 1, 2, 3); const a = []; for (let i = 0; i < n; i++) a.push(f(r)); return a; };
  // IntProvider
  o.intConst = draw(A.intProvider(5, 't'), 20).every(v => v === 5);
  const u = draw(A.intProvider({ type: 'minecraft:uniform', value: { min_inclusive: 3, max_inclusive: 6 } }, 't'), 400);
  o.intUniform = u.every(v => v >= 3 && v <= 6) && u.includes(3) && u.includes(6);
  const cl = draw(A.intProvider({ type: 'minecraft:clamped', value: { min_inclusive: 4, max_inclusive: 5, source: { type: 'minecraft:uniform', value: { min_inclusive: 0, max_inclusive: 9 } } } }, 't'), 300);
  o.intClamped = cl.every(v => v === 4 || v === 5) && cl.includes(4) && cl.includes(5);
  const bb = draw(A.intProvider({ type: 'minecraft:biased_to_bottom', value: { min_inclusive: 0, max_inclusive: 9 } }, 't'), 2000);
  o.intBiased = bb.every(v => v >= 0 && v <= 9) && bb.reduce((a, b) => a + b, 0) / 2000 < 3 && bb.includes(0);
  const wl = draw(A.intProvider({ type: 'minecraft:weighted_list', distribution: [{ weight: 19, data: 0 }, { weight: 1, data: 1 }] }, 't'), 4000);
  const ones = wl.filter(v => v === 1).length; o.intWeighted = ones > 100 && ones < 320 && wl.every(v => v === 0 || v === 1);
  // HeightProvider
  const hp = (t, extra) => A.heightProvider(Object.assign({ type: 'minecraft:' + t, min_inclusive: { absolute: 10 }, max_inclusive: { absolute: 30 } }, extra || {}), 't');
  const hu = draw(hp('uniform'), 600); o.hUniform = hu.every(v => v >= 10 && v <= 30) && hu.includes(10) && hu.includes(30);
  const ht = draw(hp('trapezoid'), 4000), mid = ht.filter(v => v >= 17 && v <= 23).length;
  o.hTrap = ht.every(v => v >= 10 && v <= 30) && mid > 4000 * 0.5;
  const hv = draw(hp('very_biased_to_bottom'), 3000); o.hBias = hv.every(v => v >= 10 && v <= 30) && hv.reduce((a, b) => a + b, 0) / 3000 < 15;
  o.hAnchor = A.heightProvider({ type: 'minecraft:uniform', min_inclusive: { above_bottom: 0 }, max_inclusive: { above_bottom: 0 } }, 't')(A.rngAt(1, 0, 0, 0)) === MINY;
  // BlockPredicate
  const mb = A.predicate({ predicate_type: 'minecraft:matching_blocks', blocks: ['minecraft:sand', 'minecraft:gravel'] });
  o.predMatch = mb(st('sand')) && mb(st('gravel')) && !mb(st('stone'));
  const tg = A.predicate({ predicate_type: 'minecraft:tag_match', tag: 'minecraft:stone_ore_replaceables' });
  o.predTag = tg(st('stone')) && tg(st('tuff')) && !tg(st('deepslate')) && !tg(st('dirt'));
  const so = A.predicate({ predicate_type: 'minecraft:solid' }); o.predSolid = so(st('stone')) === true && so(0) === false;
  // ore through the real inline path
  const oreJ = { feature: { type: 'minecraft:ore', config: { size: 9, discard_chance_on_air_exposure: 0, targets: [{ target: { predicate_type: 'minecraft:tag_match', tag: 'minecraft:stone_ore_replaceables' }, state: { Name: 'minecraft:coal_ore' } }] } }, placement: [] };
  const oreInl = A.inline(oreJ, 'ore'), S = st('stone'), COAL = st('coal_ore');
  const B = sb(); B.fill(S); const y0 = 40;
  const wrote = A.runInline(oreInl, B, 0, 0, 8, y0, 8, A.rngAt(99, 8, y0, 8));
  let nc = 0, other = 0; for (let i = 0; i < B.length; i++) { if (B[i] === COAL) nc++; else if (B[i] !== S) other++; }
  o.oreBlob = wrote === nc && nc >= 3 && nc <= 9 && other === 0;
  const B2 = sb(); B2.fill(st('dirt')); o.oreTarget = A.runInline(oreInl, B2, 0, 0, 8, y0, 8, A.rngAt(99, 8, y0, 8)) === 0;
  // disk (below sea level, replaces only targets, half_height thick)
  const diskJ = { feature: { type: 'minecraft:disk', config: { state: { Name: 'minecraft:sand' }, radius: 3, half_height: 1, targets: [{ Name: 'minecraft:dirt' }] } }, placement: [] };
  const dInl = A.inline(diskJ, 'disk'), Bd = sb(); Bd.fill(st('stone'));
  const ly = (y) => (y - MINY) << 8;
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 58; y <= 62; y++) Bd[ly(y) | (z << 4) | x] = st('dirt');
  const nd = A.runInline(dInl, Bd, 0, 0, 8, 60, 8, A.rngAt(5, 8, 60, 8));
  let sandN = 0, off = 0; for (let y = MINY; y < MINY + H; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    if (Bd[ly(y) | (z << 4) | x] === st('sand')) { sandN++; const dx = x - 8, dz = z - 8; if (dx * dx + dz * dz > 9 || y < 59 || y > 61) off++; } }
  o.diskShape = nd === sandN && sandN >= 20 && off === 0;
  const Bs = sb(); Bs.fill(S); o.diskTarget = A.runInline(dInl, Bs, 0, 0, 8, 60, 8, A.rngAt(5, 8, 60, 8)) === 0;
  const Ba = sb(); Ba.fill(st('dirt')); o.diskAbove = A.runInline(dInl, Ba, 0, 0, 8, F.G.params.seaLevel + 5, 8, A.rngAt(5, 8, 70, 8)) === 0;
  // simple_block
  const sbJ = { feature: { type: 'minecraft:simple_block', config: { to_place: { type: 'minecraft:simple_state_provider', state: { Name: 'minecraft:stone' } } } }, placement: [] };
  const sInl = A.inline(sbJ, 'sb'), Bq = sb();
  o.simple = A.runInline(sInl, Bq, 0, 0, 4, 70, 4, A.rngAt(1, 4, 70, 4)) === 1 && A.getBlock(Bq, 0, 0, 4, 70, 4) === S;
  o.simpleOcc = A.runInline(sInl, Bq, 0, 0, 4, 70, 4, A.rngAt(1, 4, 70, 4)) === 0;
  // block_column prioritize_tip
  const colJ = (tip) => ({ feature: { type: 'minecraft:block_column', config: { direction: 'up', prioritize_tip: tip, allowed_placement: { predicate_type: 'minecraft:matching_blocks', blocks: ['minecraft:air'] },
    layers: [{ height: 3, provider: { type: 'minecraft:simple_state_provider', state: { Name: 'minecraft:dirt' } } }, { height: 1, provider: { type: 'minecraft:simple_state_provider', state: { Name: 'minecraft:stone' } } }] } }, placement: [] });
  for (const tip of [false, true]) {
    const Bc = sb(); A.setBlock(Bc, 0, 0, 2, 73, 2, S); // ceiling: 3 free cells (70..72)
    const n = A.runInline(A.inline(colJ(tip), 'col'), Bc, 0, 0, 2, 70, 2, A.rngAt(2, 2, 70, 2));
    const col = [70, 71, 72].map(y => A.getBlock(Bc, 0, 0, 2, y, 2));
    if (!tip) o.colTrunc = n === 3 && col.every(v => v === st('dirt'));
    else o.colTip = n === 3 && col[0] === st('dirt') && col[1] === st('dirt') && col[2] === S;
  }
  // MushroomBlock.canSurvive
  const bm = st('brown_mushroom'), Bm = sb(), hy = 200;
  A.setBlock(Bm, 0, 0, 3, hy - 1, 3, st('mycelium'));
  o.mushMycelium = F.featureSurvives(Bm, 0, 0, 3, hy, 3, bm) === true;
  A.setBlock(Bm, 0, 0, 5, hy - 1, 5, st('grass_block'));
  o.mushLit = F.featureSurvives(Bm, 0, 0, 5, hy, 5, bm) === false;
  A.setBlock(Bm, 0, 0, 5, hy + 2, 5, S); o.mushShade = F.featureSurvives(Bm, 0, 0, 5, hy, 5, bm) === true;
  // PlacementModifier / ConfiguredFeature / GenerationSettings through the compiled registries
  const pid = F.placedIds.ore_diamond, pc = pid >= 0 ? F.placedList[pid] : null, kinds = pc ? pc.chain.map(m => m.kind).join() : '';
  o.chainKinds = kinds.startsWith('count') && /height/.test(kinds) && /biome/.test(kinds) && /in_square/.test(kinds);
  o.chainCount = !!pc && pc.chain[0].kind === 'count' && draw(pc.chain[0].n, 50).every(v => v === 7);
  const cf = pc && pc.gen;
  o.configured = !!cf && cf.kind === 'ore' && cf.size > 0 && cf.targets.length >= 1 && F.configured.ore_diamond_small === cf;
  o.genSettings = F.byBiome.length === M.Biomes.count && F.byBiome.every(l => Array.isArray(l)) && F.byBiome.some(l => l.length >= 9 && l.some(s => s.length > 0));
  return o;
}
const LBL = { intConst: 'IntProvider constant', intUniform: 'IntProvider uniform inclusive', intClamped: 'IntProvider clamped', intBiased: 'IntProvider biased_to_bottom', intWeighted: 'IntProvider weighted_list 19:1',
  hUniform: 'HeightProvider uniform', hTrap: 'HeightProvider trapezoid peaks mid', hBias: 'HeightProvider very_biased_to_bottom', hAnchor: 'HeightProvider above_bottom anchor',
  predMatch: 'BlockPredicate matching_blocks', predTag: 'BlockPredicate tag_match', predSolid: 'BlockPredicate solid',
  oreBlob: 'OreFeature blob only replaces stone', oreTarget: 'OreFeature respects targets', diskShape: 'DiskFeature radius/half_height', diskTarget: 'DiskFeature targets', diskAbove: 'DiskFeature sea level cap',
  simple: 'SimpleBlockFeature places', simpleOcc: 'SimpleBlockFeature refuses occupied', colTrunc: 'BlockColumnFeature truncates far end', colTip: 'BlockColumnFeature prioritize_tip',
  mushMycelium: 'MushroomBlock mycelium', mushLit: 'MushroomBlock lit grass', mushShade: 'MushroomBlock shaded',
  chainKinds: 'PlacementModifier chain', chainCount: 'PlacementModifier count', configured: 'ConfiguredFeature registry', genSettings: 'GenerationSettings per-biome steps' };
const A0 = trial(null);
for (const [k, m] of Object.entries(LBL)) ok(A0[k], m);
const FILE = '04j_features.js';
const BR = [
  ['intUniform', /return lo \+ r\.nextInt\(hi - lo \+ 1\);/, 'return lo + r.nextInt(hi - lo);'],
  ['intClamped', /return x < cl \? cl : \(x > ch \? ch : x\);/, 'return x;'],
  ['intBiased', /return bl \+ r\.nextInt\(x - bl \+ 1\);/, 'return x;'],
  ['intWeighted', /var x = r\.nextInt\(total\);/, 'var x = r.nextInt(total) % 2;'],
  ['hTrap', /return lo \+ r\.nextInt\(total\) \+ r\.nextInt\(edge \+ 1\);/, 'return lo + r.nextInt(span + 1);'],
  ['hBias', /var b = lo \+ inner \+ r\.nextInt\(a - lo \+ 1\);/, 'var b = a;'],
  ['hAnchor', /if \(a\.above_bottom !== undefined\) return MINY \+ \(a\.above_bottom \| 0\);/, 'if (a.above_bottom !== undefined) return MINY + 1;'],
  ['predMatch', /return function \(st\) \{ return set2\[st\] === 1; \};/, 'return function (st) { return true; };'],
  ['predSolid', /if \(t === 'solid'\) return function \(st\) \{ return NS\.States\.solid\[st\] === 1; \};/, "if (t === 'solid') return function (st) { return true; };"],
  ['oreTarget', /return \{ match: compilePredicate\(t\.target\), state: st \};/, 'return { match: function () { return true; }, state: st };'],
  ['diskShape', /if \(dx \* dx \+ dz \* dz > rad \* rad\) continue;/, ''],
  ['diskAbove', /if \(y > F\.G\.params\.seaLevel\) return 0;/, ''],
  ['simpleOcc', /if \(cur !== 0\) return 0;\n        var st0/, 'var st0'],
  ['colTip', /var from = gen\.tip \? 0 : gen\.layers\.length - 1/, 'var from = gen.layers.length - 1'],
  ['colTrunc', /var cut = hs\[L\] < over \? hs\[L\] : over;/, 'var cut = 0;'],
  ['mushMycelium', /if \(b > 0 && fsvGrow\[b\] === 1\) return true;/, ''],
  ['mushShade', /return skyBlocked\(SB, cx, cz, x, y, z\);\n  \}/, 'return false;\n  }'],
];
const src = fs.readFileSync(new URL('../src/' + FILE, import.meta.url), 'utf8');
for (const [key, re, rep] of BR) {
  if (!re.test(src)) { fails.push('pattern not found: ' + key); continue; }
  breaks++; let hit = false, B;
  try { B = trial((f, s) => { const n = f === FILE ? s.replace(re, rep) : s; if (n !== s) hit = true; return n; }); } catch (e) { B = {}; }
  ok(hit, 'break pattern matched: ' + key); ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
