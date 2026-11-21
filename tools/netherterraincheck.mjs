#!/usr/bin/env node
// netherterraincheck.mjs — #256 (G27c): the Nether's terrain, lava sea, bedrock and surface rules
// (src/04yn_nether_terrain.js). The facts are read from the shipped noise_settings/nether.json and the decomp's
// createNetherSurfaceRule; the DENSITY values themselves have no real-server golden yet (see §6, a regression pin).
//   node tools/netherterraincheck.mjs
import { readFileSync } from 'node:fs';
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
console.log('netherterraincheck -- #256, Nether terrain + bedrock + surface');

const SEED = 12345n;
const PIN_HASH = 883784549;

function audit(M) {
  const T = M.NetherTerrain; T.init(SEED);
  const B = T.state().B, name = {}; for (const k in B) name[B[k]] = k;
  const R = {};
  // §1 the data this module claims to port
  const ns = M.WG.get('noise_settings', 'nether');
  R.data = ns.sea_level === 32 && ns.noise.size_horizontal === 1 && ns.noise.size_vertical === 2 && ns.noise.height === 128 &&
    ns.noise.min_y === 0 && ns.noise.top_slide.target === 0.9375 && ns.noise.top_slide.size === 3 && ns.noise.bottom_slide.target === 2.5 &&
    ns.noise.bottom_slide.size === 4 && ns.noise.bottom_slide.offset === -1 && ns.aquifers_enabled === false && ns.ore_veins_enabled === false &&
    T.SEA === ns.sea_level && T.HEIGHT === ns.noise.height;
  // one chunk per biome, found by scanning the biome source
  const want = ['nether_wastes', 'soul_sand_valley', 'crimson_forest', 'warped_forest', 'basalt_deltas'], at = {}, many = [];
  for (let cx = -80; cx <= 80; cx += 3)
    for (let cz = -80; cz <= 80; cz += 3) {
      const b = T.biomeAt(cx * 16 + 8, cz * 16 + 8);
      if (T.biomeAt(cx * 16, cz * 16) === b && T.biomeAt(cx * 16 + 15, cz * 16 + 15) === b && (at[b] = at[b] || []).length < 3) { at[b].push([cx, cz]); many.push([cx, cz]); }
    }
  R.biomes = want.every((b) => at[b]);
  const chunks = [[0, 0], [1, 0], [0, 1], [-1, -1]].concat(many);
  const gens = chunks.map(([cx, cz]) => T.generate(cx, cz));
  const IDX = T.IDX;
  let lavaAbove = 0, lava = 0, floorAir = 0, mid = 0, topSolid = 0, topN = 0;
  const fl = [0, 0, 0, 0, 0], rf = { 122: 0, 123: 0, 124: 0, 125: 0, 126: 0, 127: 0 }, cols = gens.length * 256;
  const tops = {}; for (const b of want) tops[b] = {};
  const ceil = {}; for (const b of want) ceil[b] = {};
  gens.forEach((g) => {
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const biome = g.biomes[z * 16 + x];
      for (let y = 0; y < 128; y++) {
        const s = g.blocks[IDX(x, y, z)];
        if (s === B.lava) { lava++; if (y >= 32) lavaAbove++; }
        if (y < 32 && s === 0) floorAir++;
        if (y <= 4 && s === B.bedrock) fl[y]++;
        if (y >= 122 && s === B.bedrock) rf[y]++;
        if (y > 4 && y < 123 && s === B.bedrock) mid++;
        if (y >= 121 && y <= 122) { topN++; if (s === B.netherrack || s === B.bedrock) topSolid++; }
        if (y > 4 && y < 120 && s !== 0 && s !== B.lava && s !== B.netherrack && s !== B.bedrock) {
          const up = g.blocks[IDX(x, y + 1, z)], dn = y > 0 ? g.blocks[IDX(x, y - 1, z)] : 1;
          if (up === 0 || up === B.lava) tops[biome][name[s]] = (tops[biome][name[s]] || 0) + 1;
          // a CEILING block: air below, and eight solid blocks above, so the floor rule (depth <= 1 + run, run <= 6) cannot be what placed it
          let thick = dn === 0 && y + 8 < 128;
          for (let u = 1; thick && u <= 8; u++) { const q = g.blocks[IDX(x, y + u, z)]; if (q === 0 || q === B.lava) thick = false; }
          if (thick) ceil[biome][name[s]] = (ceil[biome][name[s]] || 0) + 1;
        }
      }
    }
  });
  Object.assign(R, { lavaAbove, lava, floorAir, mid, fl, rf, cols, tops, ceil, topFrac: topSolid / topN });
  // determinism + seed sensitivity
  // the y-smear sampler at yScale 0 IS vanilla's ImprovedNoise.noise(x,y,z): the real server's values (noise-golden, improved.noise.legacy:1234)
  {
    const gc = JSON.parse(readFileSync(new URL('./golden/noise-golden-1.18.2.json', import.meta.url), 'utf8')).cases.find((c) => c.id === 'improved.noise.legacy:1234');
    const imp = new M.Noise.Improved(new M.Noise.LegacyRandom(1234n));
    R.goldenN = gc.points.length; R.goldenBad = 0;
    gc.points.forEach((p, i) => { if (T._smear(imp, p[0], p[1], p[2], 0, 0) !== gc.values[i]) R.goldenBad++; });
  }
  const again = T.generate(0, 0).blocks;
  R.deterministic = again.every((v, i) => v === gens[0].blocks[i]);
  let h = 2166136261; for (const v of gens[0].blocks) { h ^= v; h = Math.imul(h, 16777619) >>> 0; }
  R.hash = h;
  // the REAL server's Nether (tools/vg_pregen_nether.mjs): 81 chunks, Status full. The engine has no Nether carvers or
  // features yet, so the comparison is the part both sides have: the bedrock layers EXACTLY, solid-vs-open as a mask.
  const G = JSON.parse(readFileSync(new URL('./golden/nether-golden-1.18.2.json', import.meta.url), 'utf8'));
  T.init(BigInt(G.seed));
  const GB = T.state().B, open = new Set(['air', 'cave_air', 'lava']), gbed = new Array(128).fill(0), ebed = new Array(128).fill(0);
  let both = 0, gOnly = 0, eOnly = 0, none = 0;
  for (const k in G.chunks) {
    const [cx, cz] = k.split(',').map(Number), blocks = T.generate(cx, cz).blocks, rle = G.chunks[k]; let p = 0;
    for (let i = 0; i < rle.length; i += 2) for (let n = 0; n < rle[i + 1]; n++, p++) {
      const gn = G.names[rle[i]], gs = !open.has(gn), es = blocks[p] !== 0 && blocks[p] !== GB.lava;
      if (gn === 'bedrock') gbed[p >> 8]++;
      if (blocks[p] === GB.bedrock) ebed[p >> 8]++;
      if (gs && es) both++; else if (gs) gOnly++; else if (es) eOnly++; else none++;
    }
  }
  R.gold = { chunks: Object.keys(G.chunks).length, bedrockSame: gbed.every((v, y) => v === ebed[y]), bedrockN: gbed.reduce((a, b) => a + b), both, gOnly, eOnly, none };
  return R;
}

function judge(R, tag, expectBreak) {
  const c = [];
  const add = (cond, msg) => c.push([cond, msg]);
  add(R.data, 'noise_settings/nether matches the constants the module ports');
  add(R.biomes, 'all five Nether biomes occur in the scan');
  add(R.floorAir === 0, 'nothing below y 32 is air (solid or lava)');
  add(R.lavaAbove === 0, 'no lava at or above sea level 32');
  add(R.lava > 0, 'the lava sea exists');
  add(R.fl[0] === R.cols, 'bedrock floor: y 0 is all bedrock');
  add(R.fl[1] > R.fl[2] && R.fl[2] > R.fl[3] && R.fl[3] > R.fl[4] && R.fl[4] > R.cols * 0.1, 'bedrock floor thins out over y 1..4 (p = 1 - y/5)');
  add(R.mid === 0, 'no bedrock between the layers');
  add(R.rf[122] === 0 && R.rf[123] > R.cols * 0.1 && R.rf[123] < R.rf[124] && R.rf[124] < R.rf[125] && R.rf[125] < R.rf[126] && R.rf[126] < R.rf[127] && R.rf[127] === R.cols, 'bedrock roof thickens over y 123..127, solid at 127 (the real server\'s layers)');
  add(R.topFrac > 0.99, 'ceiling is solid (top slide 0.9375)');
  const t = R.tops, any = (o, ks) => ks.some((k) => o[k]);
  const only = (b, ok2) => Object.keys(t[b]).every((k) => ok2.includes(k));
  add(only('nether_wastes', ['soul_sand', 'gravel']), 'nether_wastes floors: soul sand / gravel only');
  add(only('soul_sand_valley', ['soul_sand', 'soul_soil', 'gravel']) && any(t.soul_sand_valley, ['soul_soil', 'soul_sand']), 'soul_sand_valley floors: soul soil / sand');
  add(only('basalt_deltas', ['basalt', 'blackstone', 'gravel']) && any(t.basalt_deltas, ['basalt', 'blackstone']), 'basalt_deltas floors: basalt / blackstone');
  add(only('warped_forest', ['warped_nylium', 'warped_wart']) && t.warped_forest.warped_nylium > 0, 'warped_forest floors: warped nylium (+ wart block)');
  add(only('crimson_forest', ['crimson_nylium', 'nether_wart']) && t.crimson_forest.crimson_nylium > 0, 'crimson_forest floors: crimson nylium (+ wart block)');
  add(R.ceil.basalt_deltas.basalt > 0 && !R.ceil.nether_wastes.basalt, 'basalt_deltas ceilings are basalt');
  add(R.ceil.soul_sand_valley.soul_soil > 0 || R.ceil.soul_sand_valley.soul_sand > 0, 'soul_sand_valley ceilings are soul soil / sand');
  add(R.goldenN > 20 && R.goldenBad === 0, 'y-smear sampler (yScale 0) reproduces the real server\'s ImprovedNoise values, ' + R.goldenN + ' points');
  add(R.gold.chunks >= 81 && R.gold.bedrockN > 100000 && R.gold.bedrockSame, 'bedrock floor+roof: per-layer counts equal the real server\'s over ' + R.gold.chunks + ' chunks (' + R.gold.bedrockN + ' blocks)');
  add(R.gold.gOnly / (R.gold.both + R.gold.gOnly) < 0.01, 'terrain mask: under 1% of the real Nether\'s solid blocks are open in the engine (' + R.gold.gOnly + ' of ' + (R.gold.both + R.gold.gOnly) + '; the rest are its features)');
  add(R.gold.eOnly / (R.gold.both + R.gold.eOnly) < 0.15 && R.gold.none / (R.gold.none + R.gold.eOnly) > 0.7, 'terrain mask: engine solids the server has open stay under 15% (carvers are not ported): ' + R.gold.eOnly);
  add(R.deterministic, 'same seed, same chunk');
  add(R.hash === PIN_HASH, 'chunk (0,0) at seed 12345 matches the pinned regression hash (' + R.hash + ')');
  if (expectBreak) return c.filter(([cond]) => !cond).map(([, m]) => m);
  for (const [cond, m] of c) ok(cond, m);
  return [];
}

// §0 the java.util.Random facts everything seeds from
{
  const M0 = loadEngine({ initReg: false });
  const r = new M0.Noise.LegacyRandom(0n);
  ok(r.next(32) === -1155484576, 'java.util.Random(0).nextInt() = -1155484576');
  ok(M0.NetherTerrain.javaHash('hello') === 99162322 && M0.NetherTerrain.javaHash('a') === 97, 'String.hashCode');
}

const M = loadEngine();
const R = judge(audit(M), 'real', false);
if (process.argv.includes('--print')) { const A = audit(M); console.log('hash', A.hash, JSON.stringify({ tops: A.tops, ceil: A.ceil, fl: A.fl, rf: A.rf, cols: A.cols, mid: A.mid, topFrac: A.topFrac, lava: A.lava })); }

// §6b dispatch: Gen.genColumn on the_nether yields the nether column (netherrack/lava inside y 0..127, nothing above, no skylight)
{
  M.Gen.init(12345, {});
  M.Dim.cur = 'the_nether';
  let col; try { col = M.Gen.genColumn(0, 0); } finally { M.Dim.cur = 'overworld'; }
  const get = (wy) => { const s = col.sec[(wy + 64) >> 4], i = ((wy + 64) & 15) << 8; return s.u >= 0 ? s.u : (() => { const bits = s.b, per = 32 / bits, v = (s.d[i >>> Math.log2(per)] >>> ((i & (per - 1)) * bits)) & ((1 << bits) - 1); return s.p[v]; })(); };
  const nr = M.NetherTerrain.state().B;
  ok(get(0) === nr.bedrock && get(127) === nr.bedrock, 'genColumn(the_nether): bedrock at y 0 and y 127');
  ok(get(200) === 0 && get(-30) === 0, 'genColumn(the_nether): air outside the Nether range');
}

// §7 anti-vacuity: each break patches the SHIPPED SOURCE and a check must notice
const brk = (name, from, to) => {
  const M2 = loadEngine({ patch: (f, s) => { if (f !== '04yn_nether_terrain.js') return s; if (!s.includes(from)) throw new Error('break did not match: ' + name); return s.replace(from, to); } });
  const bad = judge(audit(M2), name, true);
  if (ok(bad.length > 0, 'BREAK NOT CAUGHT: ' + name)) { breaks++; console.log('  ✓ break caught: ' + name + '  [' + bad[0] + ']'); }
};
brk('sea level 32 -> 36', 'T.SEA = 32', 'T.SEA = 36');
brk('top slide target dropped', 'slideOne(0.9375, 3, 0, v', 'slideOne(0, 3, 0, v');
brk('bedrock roof removed', 'if (!gradientBelow(S.roofSeed, c.x, y, c.z, 122, 127)) return B.bedrock;', '');
brk('bedrock roof off by one (the old 123..128)', 'c.z, 122, 127)) return B.bedrock;', 'c.z, 123, 128)) return B.bedrock;');
brk('bedrock floor 5 -> 3 layers', 'gradientBelow(S.floorSeed, c.x, y, c.z, 0, 5)', 'gradientBelow(S.floorSeed, c.x, y, c.z, 0, 3)');
brk('warped nylium swapped for crimson', "warped_nylium: st('warped_nylium')", "warped_nylium: st('crimson_nylium')");
brk('soul sand valley ceiling rule dropped', "if (ceilD) return nz('nether_state_selector') >= 0 ? B.soul_sand : B.soul_soil;", '');
brk('basalt ceiling rule dropped', 'if (ceilD) return B.basalt;', '');
brk('lava lake level 32 -> 30 (fluid picker)', 'y < T.SEA ? B.lava', 'y < 30 ? B.lava');
brk('perlin fade polynomial wrong', 't * t * t * (t * (t * 6 - 15) + 10)', 't * t * t * (t * (t * 6 - 14) + 10)');
brk('blended noise y_factor 60 -> 50', 'this.y / 60.0', 'this.y / 50.0');

for (const f of fails) console.log('  ✗ ' + f);
console.log(`netherterraincheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
