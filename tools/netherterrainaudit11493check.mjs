#!/usr/bin/env node
// netherterrainaudit11493check.mjs — #11493: drives 04yn_nether_terrain.js (+ 03b_noise.js) through the real path for the classes
// the audit map listed as unchecked: DoublePerlinNoiseSampler, OctavePerlinNoiseSampler, PerlinNoiseSampler (real-server noise
// golden, exact), NoiseParametersKeys (the packed noise parameters), RandomDeriver (fork golden), InterpolatedNoiseSampler
// (the legacy blended noise: range + determinism + the real Nether's solid mask), ChunkGeneratorSettings + GenerationShapeConfig
// (noise_settings/nether vs the constants the port uses), AquiferSampler (sea-level lava; the Nether has no aquifers),
// SurfaceBuilder + VanillaSurfaceRules (bedrock layers EXACT against nether-golden, per-biome surface blocks), BiomeAccess
// (the ruled quart-cell read). Anti-vacuity: every source break must fail its own probe.
import fs from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const GN = JSON.parse(fs.readFileSync(new URL('./golden/noise-golden-1.18.2.json', import.meta.url), 'utf8')).cases;
const GG = JSON.parse(fs.readFileSync(new URL('./golden/nether-golden-1.18.2.json', import.meta.url), 'utf8'));
const sgn = (v) => BigInt.asIntN(64, v);
function trial(patch) {
  const M = loadEngine(patch ? { patch } : {}), N = M.Noise, T = M.NetherTerrain, o = {};
  // DoublePerlinNoiseSampler / OctavePerlin / Perlin: the nether surface noises, bit-exact vs the real server
  let nb = 0, nn = 0;
  for (const nm of ['nether_state_selector', 'nether_wart', 'netherrack', 'patch', 'soul_sand_layer', 'gravel_layer', 'surface']) {
    const c = GN.find((x) => x.id === 'normal.' + nm + '.1337'); if (!c) { nb++; continue; }
    const n = N.fromParameters(BigInt(c.worldSeed), c.noiseId, { firstOctave: c.firstOctave, amplitudes: c.amplitudes });
    nn++; if (n.valueFactor !== c.valueFactor) nb++;
    c.points.forEach((p, i) => { if (n.get(p[0], p[1], p[2]) !== c.values[i]) nb++; });
  }
  o.doublePerlin = nb === 0 && nn === 7;
  const pc = GN.find((x) => x.id === 'perlin.surface.1337');
  const ps = new N.Perlin(N.Xoro.fromSeed(1337n).forkPositional().fromHashOf(pc.noiseId), pc.firstOctave, pc.amplitudes);
  o.octavePerlin = ps.inputFactor === pc.inputFactor && ps.valueFactor === pc.valueFactor && pc.points.every((p, i) => ps.get(p[0], p[1], p[2]) === pc.values[i]);
  const ic = GN.find((x) => x.id === 'improved.noise.legacy:1234'), imp = new N.Improved(new N.LegacyRandom(1234n));
  o.perlin = ic.points.every((p, i) => T._smear(imp, p[0], p[1], p[2], 0, 0) === ic.values[i]);
  // NoiseParametersKeys: the packed parameters are the ones the dump recorded
  o.paramKeys = ['nether_state_selector', 'patch', 'surface'].every((nm) => {
    const c = GN.find((x) => x.id === 'normal.' + nm + '.1337'), m = M.WG.get('noise', nm);
    return m && m.firstOctave === c.firstOctave && JSON.stringify([...m.amplitudes]) === JSON.stringify(c.amplitudes);
  });
  // RandomDeriver
  let fb = 0, fn = 0;
  for (const c of GN.filter((x) => (x.kind === 'fork.fromHashOf' || x.kind === 'fork.at') && x.seed === '1337')) {
    const f = N.Xoro.fromSeed(1337n).forkPositional();
    const s = c.kind === 'fork.at' ? f.at(c.pos[0], c.pos[1], c.pos[2]) : f.fromHashOf(c.name);
    fn++; if (sgn(s.lo) !== BigInt(c.values[0]) || sgn(s.hi) !== BigInt(c.values[1]) || sgn(s.next()) !== BigInt(c.values[2])) fb++;
  }
  o.deriver = fn > 40 && fb === 0;
  // ChunkGeneratorSettings + GenerationShapeConfig
  const ns = M.WG.get('noise_settings', 'nether');
  o.settings = ns.sea_level === 32 && ns.aquifers_enabled === false && ns.ore_veins_enabled === false && ns.noise.height === 128 && ns.noise.min_y === 0 &&
    ns.noise.size_horizontal === 1 && ns.noise.size_vertical === 2 && T.SEA === 32 && T.HEIGHT === 128;
  o.slides = ns.noise.top_slide.target === 0.9375 && ns.noise.bottom_slide.target === 2.5 &&
    Math.abs(T.slide(0, 16) - 0.9375) < 1e-12 && Math.abs(T.slide(0, -1) - 2.5) < 1e-12 && T.slide(0.123, 8) === 0.123;
  // the real Nether: InterpolatedNoiseSampler solid mask, bedrock exact, lava sea, surface blocks
  T.init(BigInt(GG.seed));
  const B = T.state().B, open = new Set(['air', 'cave_air', 'lava']), gb = new Array(128).fill(0), eb = new Array(128).fill(0);
  let agree = 0, tot = 0, lavaHi = 0, lava = 0; const topN = {}, allN = {};
  for (const k in GG.chunks) {
    const [cx, cz] = k.split(',').map(Number), g = T.generate(cx, cz), blocks = g.blocks, rle = GG.chunks[k]; let p = 0;
    for (let i = 0; i < rle.length; i += 2) for (let n = 0; n < rle[i + 1]; n++, p++) {
      const gn = GG.names[rle[i]]; if (gn === 'bedrock') gb[p >> 8]++; if (blocks[p] === B.bedrock) eb[p >> 8]++;
      tot++; if (!open.has(gn) === (blocks[p] !== 0 && blocks[p] !== B.lava)) agree++;
      if (blocks[p] === B.lava) { lava++; if ((p >> 8) >= 32) lavaHi++; }
    }
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y < 128; y++) (allN[g.biomes[z * 16 + x]] = allN[g.biomes[z * 16 + x]] || new Set()).add(blocks[T.IDX(x, y, z)]);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 126; y > 40; y--) {
      const s = blocks[T.IDX(x, y, z)], a = blocks[T.IDX(x, y + 1, z)];
      if (s !== 0 && a === 0) { const b = g.biomes[z * 16 + x]; (topN[b] = topN[b] || new Set()).add(s); break; }
    }
  }
  o.interpolated = agree / tot > 0.8 && eb.some((v) => v > 0);
  o.bedrock = gb.every((v, y) => v === eb[y]) && gb[0] > 0 && gb[127] > 0;
  o.aquifer = lava > 0 && lavaHi === 0;
  T.init(12345n); let found = 0;
  for (let cx = -60; cx <= 60 && found < 2; cx += 3) for (let cz = -60; cz <= 60 && found < 2; cz += 3) {
    if (T.biomeAt(cx * 16, cz * 16) !== 'soul_sand_valley' || T.biomeAt(cx * 16 + 15, cz * 16 + 15) !== 'soul_sand_valley') continue;
    found++; const g = T.generate(cx, cz), S2 = T.state().B;
    for (let i = 0; i < g.blocks.length; i++) (allN.soul_sand_valley = allN.soul_sand_valley || new Set()).add(g.blocks[i] === S2.soul_soil ? B.soul_soil : g.blocks[i] === S2.crimson_nylium ? B.crimson_nylium : g.blocks[i]);
  }
  const names = {}; for (const k in B) names[B[k]] = k;
  const tn = (b) => [...(topN[b] || [])].map((s) => names[s] || '?');
  o.surface = (topN.crimson_forest || new Set()).has(B.crimson_nylium) || (topN.warped_forest || new Set()).has(B.warped_nylium) || tn('soul_sand_valley').includes('soul_sand') || tn('basalt_deltas').includes('basalt');
  const an = (b) => [...(allN[b] || [])].map((s) => names[s] || '?');
  if (process.env.DBG) console.log(Object.keys(allN), an('soul_sand_valley'));
  o.surfaceRules = an('soul_sand_valley').includes('soul_soil') && !an('soul_sand_valley').includes('crimson_nylium') && !an('nether_wastes').includes('crimson_nylium');
  let ba = 0; for (let x = -400; x < 400; x += 13) for (let z = -400; z < 400; z += 17) if (T.biomeAt(x, z) !== T.biomeQuart(x >> 2, z >> 2) || T.biomeAt(x & ~3, z & ~3) !== T.biomeAt((x & ~3) + 3, (z & ~3) + 3)) ba++;
  o.biomeAccess = ba === 0;
  return o;
}
const LBL = { doublePerlin: 'DoublePerlinNoiseSampler vs real server', octavePerlin: 'OctavePerlinNoiseSampler vs real server', perlin: 'PerlinNoiseSampler vs real server',
  paramKeys: 'NoiseParametersKeys packed params', deriver: 'RandomDeriver fork vs real server', settings: 'ChunkGeneratorSettings nether', slides: 'GenerationShapeConfig slides',
  interpolated: 'InterpolatedNoiseSampler solid mask vs real Nether', bedrock: 'SurfaceBuilder bedrock layers exact', aquifer: 'AquiferSampler sea level lava',
  surface: 'VanillaSurfaceRules biome surfaces', surfaceRules: 'VanillaSurfaceRules per-biome palette', biomeAccess: 'BiomeAccess quart cell' };
const FILE = '04yn_nether_terrain.js';
const A0 = trial(null); if (process.env.DBG) console.log(A0); for (const [k, m] of Object.entries(LBL)) ok(A0[k], m);
const N3 = '03b_noise.js';
const BRK = [
  [N3, 'octavePerlin', /this\.inputFactor = Math\.pow\(2, firstOctave\);/, 'this.inputFactor = 1;'],
  [N3, 'doublePerlin', /this\.valueFactor = \(1 \/ 6\) \/ expectedDeviation\(max - min\);/, 'this.valueFactor = 1 / 6;'],
  [FILE, 'perlin', /var u = fade\(gx\), v = fade\(gy0\), w = fade\(gz\);/, 'var u = gx, v = gy0, w = gz;'],
  [FILE, 'slides', /return slideOne\(2\.5, 4, -1, v, cellY\);/, 'return slideOne(2.0, 4, -1, v, cellY);'],
  [FILE, 'aquifer', /\(y < T\.SEA \? B\.lava : B\.air\)/, '(y < T.SEA + 4 ? B.lava : B.air)'],
  [FILE, 'bedrock', /if \(gradientBelow\(S\.floorSeed, c\.x, y, c\.z, 0, 5\)\) return B\.bedrock;/, 'if (y === 0) return B.bedrock;'],
  [FILE, 'interpolated', /return clampedLerp\(lo \/ 512\.0, up \/ 512\.0, t\) \/ 128\.0;/, 'return clampedLerp(lo / 512.0, up / 512.0, t) / 128.0 + 0.2;'],
  [FILE, 'surface', /return nz\('nether_wart'\) >= 1\.17 \? B\.nether_wart : B\.crimson_nylium;/, 'return B.netherrack;'],
  [FILE, 'surfaceRules', /if \(ceilD\) return nz\('nether_state_selector'\) >= 0 \? B\.soul_sand : B\.soul_soil;/, 'if (ceilD) return B.crimson_nylium;'],
  [FILE, 'biomeAccess', /T\.biomeAt = function \(x, z\) \{ return T\.biomeQuart\(x >> 2, z >> 2\); \};/, 'T.biomeAt = function (x, z) { return T.biomeQuart((x + 1) >> 2, z >> 2); };'],
];
const srcs = {};
for (const f of [FILE, '03b_noise.js']) srcs[f] = fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
for (const [f, key, re, rep] of BRK) {
  if (!re.test(srcs[f])) { fails.push('pattern not found: ' + key); continue; }
  breaks++; let hit = false, B;
  try { B = trial((ff, s) => { const n = ff === f ? s.replace(re, rep) : s; if (n !== s) hit = true; return n; }); } catch (e) { B = {}; }
  ok(hit, 'break pattern matched: ' + key); ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
