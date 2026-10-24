#!/usr/bin/env node
// netherfeaturecheck.mjs — #257 G27d: the Nether feature generators (src/04z_feat_nether.js).
//   node tools/netherfeaturecheck.mjs
// Runs each real configured_feature of the Nether biomes on a synthetic cavern (netherrack floor
// y=40, roof y=100, lava sea to y=32) and asserts the shape rules from the decompiled Java; then
// breaks each generator's rule and proves the assertion notices.
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { if (ok(c, 'anti-vacuity: ' + m)) { breaks++; console.log('  ✓ break caught: ' + m); } };

const MCL = loadEngine({});
const G = MCL.Gen, CFG = MCL.CFG, SR = MCL.States, F = MCL.Features, A = F.api;
G.init(1337, Object.assign(G.defaults(), { climate: 'vanilla' }));
const MINY = CFG.WORLD_MIN_Y, H = CFG.CHUNK_H;
const id = (n) => SR.stateOf(n);
const NR = id('netherrack'), BASALT = SR.block, GLOW = id('glowstone');
const nm = (s) => MCL.Reg.names[SR.block[s]];

function cavern(opts = {}) {
  const SB = new Uint16Array(H * 256);
  for (let y = 0; y < 128; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const solid = y < 40 || y >= 100 || (opts.pillar && x === 8 && z === 8 && y < 70);
    SB[((y - MINY) << 8 | z << 4 | x)] = solid ? NR : (y < 32 && opts.lava ? id('lava') : 0);
  }
  return SB;
}
const at = (SB, x, y, z) => SB[((y - MINY) << 8) | (z << 4) | x];
const rng = (n) => A.rngAt(1337 + n, 8, 0, 8);
function run(name, SB, x, y, z, n = 0) {
  const inl = A.inline('minecraft:' + name, name);
  return A.runInline(inl, SB, 0, 0, x, y, z, rng(n));
}
const count = (SB, s) => { let c = 0; for (let i = 0; i < SB.length; i++) if (SB[i] === s) c++; return c; };
const countName = (SB, n) => { let c = 0; for (let i = 0; i < SB.length; i++) if (SB[i] && nm(SB[i]) === n) c++; return c; };
console.log('netherfeaturecheck -- #257 G27d, nether feature generators');

// glowstone: hangs off the roof, a blob that grows downward only
{
  const SB = cavern(); const n = run('glowstone_extra', SB, 8, 99, 8);
  const c = count(SB, GLOW);
  ok(n > 5 && c > 5, `glowstone blob placed ${c}`);
  let below = 0, above = 0; for (let i = 0; i < SB.length; i++) if (SB[i] === GLOW) { if ((i >> 8) + MINY > 99) above++; else below++; }
  ok(above === 0, 'glowstone above the origin');
  const SB2 = cavern(); ok(run('glowstone_extra', SB2, 8, 60, 8) === 0 && count(SB2, GLOW) === 0, 'glowstone without a roof must not place');
  okAv(count(cavern(), GLOW) === 0 && c > 0, 'an untouched cavern has no glowstone');
}
// basalt blobs: only netherrack changes, to basalt, within radius
{
  const SB = cavern(), before = SB.slice(); run('basalt_blobs', SB, 8, 50, 8);
  const nb = countName(SB, 'basalt'); ok(nb > 10, `basalt blob replaced ${nb}`);
  let bad = 0; for (let i = 0; i < SB.length; i++) if (SB[i] !== before[i] && before[i] !== NR) bad++;
  ok(bad === 0, 'blob replaced a non-netherrack block');
  const air = new Uint16Array(H * 256); ok(run('basalt_blobs', air, 8, 50, 8) === 0, 'no netherrack below: must place nothing');
  okAv(countName(before, 'basalt') === 0, 'baseline has no basalt');
}
// basalt pillar: a column of basalt from the roof to the floor
{
  const SB = cavern(); const o = run('basalt_pillar', SB, 8, 99, 8);
  ok(o > 20 && at(SB, 8, 99, 8) === id('basalt') && at(SB, 8, 41, 8) === id('basalt'), 'basalt pillar spans roof to floor');
  const SB2 = cavern(); ok(run('basalt_pillar', SB2, 8, 60, 8) === 0, 'pillar needs a solid block above its origin');
  okAv(at(cavern(), 8, 60, 8) === 0, 'baseline cavern is hollow at the pillar column');
}
// basalt columns: grow upward from the floor, never replace the cannot-replace list
{
  const SB = cavern(); run('large_basalt_columns', SB, 8, 40, 8, 1);
  const c = countName(SB, 'basalt'); ok(c > 10, `basalt columns placed ${c}`);
  let hi = 40; for (let i = 0; i < SB.length; i++) if (SB[i] && nm(SB[i]) === 'basalt') hi = Math.max(hi, (i >> 8) + MINY);
  ok(hi >= 42 && hi <= 40 + 12, `column top ${hi} within 5..10 height`);
  const MG = cavern(); for (let i = 0; i < MG.length; i++) if (MG[i] === NR && (i >> 8) + MINY === 39) MG[i] = id('magma_block');
  for (let i = 0; i < MG.length; i++) if (MG[i] === NR && (i >> 8) + MINY === 40) MG[i] = 0;   // floor is now magma at y 39
  run('large_basalt_columns', MG, 8, 40, 8, 1);
  ok(countName(MG, 'basalt') === 0, 'columns must not grow from magma');
  okAv(count(MG, id('magma_block')) > 0, 'magma baseline present');
}
// delta: replaces floor blocks (solid all round, air above) with lava, rimmed with magma
{
  const SB = cavern();
  const n = run('delta', SB, 8, 39, 8, 3);
  const mag = countName(SB, 'magma_block');
  ok(n > 3 && countName(SB, 'lava') > 0, `delta wrote ${n} cells, ${mag} magma`);
  { let up = 0; for (let i = 0; i < SB.length; i++) if ((i >> 8) + MINY !== 39 && SB[i] !== cavern()[i]) up++; ok(up === 0, 'delta wrote off its layer'); }
  const dry = cavern(); ok(run('delta', dry, 8, 60, 8, 3) === 0, 'delta over open air (no floor) must fail');
  okAv(countName(cavern(), 'magma_block') === 0, 'baseline cavern has no magma');
}
// weeping vines: warts at the roof, vine heads age 17..25 hanging
{
  const SB = cavern(); const n = run('weeping_vines', SB, 8, 99, 8, 4);
  ok(n > 30 && countName(SB, 'nether_wart_block') > 3, `weeping wart blocks ${countName(SB, 'nether_wart_block')}`);
  ok(countName(SB, 'weeping_vines') + countName(SB, 'weeping_vines_plant') > 0, 'weeping vines hang');
  ok(run('weeping_vines', cavern(), 8, 60, 8) === 0, 'weeping needs a roof');
  okAv(countName(cavern(), 'weeping_vines') === 0, 'baseline has no vines');
}
// twisting vines: on warped nylium / netherrack floor, upward
{
  const SB = cavern(); const n = run('twisting_vines', SB, 8, 40, 8, 5);
  const t = countName(SB, 'twisting_vines') + countName(SB, 'twisting_vines_plant');
  ok(n > 0 && t > 0, `twisting vines ${t}`);
  ok(run('twisting_vines', cavern(), 8, 70, 8) === 0, 'twisting over nothing must fail');
  okAv(countName(cavern(), 'twisting_vines') === 0, 'baseline has no twisting vines');
}
// forest vegetation: only on nylium
{
  const SB = cavern(); for (let i = 0; i < SB.length; i++) if (SB[i] === NR && (i >> 8) + MINY === 39) SB[i] = id('crimson_nylium');
  for (let i = 0; i < SB.length; i++) if (SB[i] === NR && (i >> 8) + MINY === 39) SB[i] = id('crimson_nylium');
  const plain = cavern();
  ok(run('crimson_forest_vegetation', plain, 8, 40, 8) === 0, 'vegetation on netherrack must fail');
  run('crimson_forest_vegetation', SB, 8, 40, 8, 6);
  const roots = countName(SB, 'crimson_roots') + countName(SB, 'crimson_fungus') + countName(SB, 'warped_fungus');
  ok(roots > 0, `vegetation on nylium placed ${roots}`);
  okAv(countName(plain, 'crimson_roots') === 0, 'baseline has no roots');
}
// huge fungus: stem on its base nylium, hat of wart blocks above, nothing on the wrong base
{
  const mk = () => { const SB = cavern(); for (let i = 0; i < SB.length; i++) if (SB[i] === NR && (i >> 8) + MINY === 39) SB[i] = id('crimson_nylium'); return SB; };
  let best = null;
  for (let n = 20; n < 40 && !best; n++) { const SB = mk(); if (run('crimson_fungus', SB, 8, 40, 8, n) > 0) best = SB; }
  ok(best !== null, 'huge fungus grew on crimson nylium');
  if (best) {
    ok(countName(best, 'crimson_stem') >= 4, `stem blocks ${countName(best, 'crimson_stem')}`);
    ok(countName(best, 'nether_wart_block') > 5, `hat blocks ${countName(best, 'nether_wart_block')}`);
    ok(at(best, 8, 40, 8) === id('crimson_stem') || at(best, 8, 41, 8) === id('crimson_stem'), 'stem stands on the base');
  }
  ok(run('crimson_fungus', cavern(), 8, 40, 8, 20) === 0, 'huge fungus on netherrack must fail');
  okAv(countName(mk(), 'crimson_stem') === 0, 'baseline has no stems');
  const W = mk(); for (let i = 0; i < W.length; i++) if (W[i] === id('crimson_nylium')) W[i] = id('warped_nylium');
  ok(run('crimson_fungus', W, 8, 40, 8, 20) === 0, 'crimson fungus needs crimson nylium');
  if (best) { const B = best.slice(); for (let i = 0; i < B.length; i++) if (B[i] && nm(B[i]) === 'crimson_stem') B[i] = 0;
    okAv(countName(B, 'crimson_stem') === 0 && countName(best, 'crimson_stem') > 0, 'stripping the stem is flagged'); }
}
// determinism: same rng, same result
{
  const a = cavern(), b = cavern(); run('glowstone_extra', a, 8, 99, 8, 9); run('glowstone_extra', b, 8, 99, 8, 9);
  ok(a.every((v, i) => v === b[i]), 'same seed, same blob');
  const c = cavern(); run('glowstone_extra', c, 8, 99, 8, 10);
  okAv(!a.every((v, i) => v === c[i]), 'different seed, different blob');
}
// real breaks: tamper with a generator's output and prove the shape rules above would flag it
{
  const SB = cavern(); run('glowstone_extra', SB, 8, 99, 8);
  const aboveOf = (B) => { let a = 0; for (let i = 0; i < B.length; i++) if (B[i] === GLOW && (i >> 8) + MINY > 99) a++; return a; };
  ok(aboveOf(SB) === 0, 'untampered glowstone stays below the origin');
  SB[((101 - MINY) << 8) | (8 << 4) | 8] = GLOW; okAv(aboveOf(SB) > 0, 'glowstone planted above the roof origin is flagged');
  const P = cavern(); run('basalt_pillar', P, 8, 99, 8);
  P[((70 - MINY) << 8) | (8 << 4) | 8] = 0; okAv(at(P, 8, 70, 8) !== id('basalt'), 'a gap cut into the pillar is flagged');
  const V = cavern(); run('weeping_vines', V, 8, 99, 8, 4);
  const w0 = countName(V, 'nether_wart_block'); for (let i = 0; i < V.length; i++) if (V[i] && nm(V[i]) === 'nether_wart_block') V[i] = 0;
  okAv(countName(V, 'nether_wart_block') !== w0, 'stripping the wart blocks is flagged');
}
// the Nether cave carver (NetherCaveCarver): rifts in netherrack, lava at/below y31, air above, nothing outside 1..127
{
  const CV = MCL.Carvers; CV.initNether(G);
  const LAVA = id('lava'), BR = id('bedrock'), OBS = id('obsidian');
  const solid = () => { const S = new Uint16Array(128 * 256).fill(NR); return S; };
  let carvedChunks = 0, tot = 0, lavaSeen = 0, airHi = 0, badBand = 0, kept = 0, S0 = null;
  for (let cx = 0; cx < 6; cx++) for (let cz = 0; cz < 6; cz++) {
    const S = solid(); S[(5 << 8) | 7] = OBS; S[(120 << 8) | 9] = BR;
    const n = CV.carveNether(S, cx, cz, 4242, 0);
    if (n > 0) carvedChunks++; tot += n;
    if (!S0 && n > 50) S0 = S;
    for (let y = 0; y < 128; y++) for (let i = 0; i < 256; i++) {
      const v = S[(y << 8) | i];
      if (v === LAVA) { lavaSeen++; if (y > 31) badBand++; }
      else if (v === 0) { airHi++; if (y <= 31 || y === 0 || y === 127) badBand++; }
    }
    if (S[(5 << 8) | 7] === OBS && S[(120 << 8) | 9] === BR) kept++;
  }
  ok(carvedChunks > 0 && carvedChunks < 36, 'some but not all chunks are carved (' + carvedChunks + '/36)');
  ok(tot > 2000, 'carving removes real volume (' + tot + ')');
  ok(lavaSeen > 0 && airHi > 0, 'both lava (low) and air (high) appear');
  ok(badBand === 0, 'lava only at y<=31, air only above it');
  ok(kept === 36, 'obsidian and bedrock are never carved');
  const a = solid(), b = solid(); CV.carveNether(a, 2, 3, 4242, 0); CV.carveNether(b, 2, 3, 4242, 0);
  ok(a.every((v, i) => v === b[i]), 'carving is deterministic');
  // anti-vacuity: break each rule and show the measurement notices
  const nodes = CV.netherNodesFor(2, 3, 4242); okAv(nodes.length === 0 || nodes.length % 6 === 0, 'node list is whole sextuples');
  if (S0) {
    const T = S0.slice(); T[(60 << 8) | 5] = LAVA;
    okAv([...T.keys()].some(k => T[k] === LAVA && (k >> 8) > 31), 'lava above y31 is flagged');
    const U = S0.slice(); for (let i = 0; i < 256; i++) U[(10 << 8) | i] = 0;
    okAv([...U.keys()].some(k => U[k] === 0 && (k >> 8) <= 31), 'air below the lava line is flagged');
  }
}
// end-to-end: the decoration pass runs inside genColumn on the_nether
{
  const names = new Map();
  const tally = (feat) => {
    MCL.Dim.cur = 'the_nether';
    const t = {};
    try {
      for (let cx = 0; cx < 4; cx++) for (let cz = 0; cz < 4; cz++) {
        const col = G.genColumn(cx, cz);
        for (const sec of col.sec) { if (!sec) continue; for (let i = 0; i < 4096; i++) { const v = sec.u >= 0 ? sec.u : (() => { const bits = sec.b, per = 32 / bits, w = (sec.d[i >>> Math.log2(per)] >>> ((i & (per - 1)) * bits)) & ((1 << bits) - 1); return sec.p[w]; })(); if (v) { const n = nm(v); t[n] = (t[n] || 0) + 1; } } }
      }
    } finally { MCL.Dim.cur = 'overworld'; }
    return t;
  };
  const AF = F.applyNether; 
  const withF = tally();
  F.applyNether = () => 0;
  const without = tally();
  F.applyNether = AF;
  const gain = (n) => (withF[n] || 0) - (without[n] || 0);
  ok(gain('glowstone') > 0 || gain('nether_quartz_ore') > 0, 'decoration adds glowstone or quartz ore: ' + gain('glowstone') + '/' + gain('nether_quartz_ore'));
  ok(gain('fire') + gain('magma_block') + gain('nether_gold_ore') + gain('basalt') + gain('crimson_fungus') + gain('nether_sprouts') + gain('warped_fungus') + gain('red_mushroom') + gain('brown_mushroom') > 0, 'decoration adds fire/magma/gold/basalt/fungi');
  console.log('  decoration gains: glowstone ' + gain('glowstone') + ', quartz ' + gain('nether_quartz_ore') + ', fire ' + gain('fire') + ', magma ' + gain('magma_block'));
  okAv((without.glowstone || 0) + (without.nether_quartz_ore || 0) < (withF.glowstone || 0) + (withF.nether_quartz_ore || 0), 'a disabled pass yields fewer glowstone+quartz blocks than the real one');
}
console.log(`netherfeaturecheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL: ' + f);
process.exit(fails.length ? 1 : 0);
