#!/usr/bin/env node
// biomeclasses11770check.mjs — #11770: src/02q_biomeclasses.js (BiomeCoords, SeedMixer, CheckerboardBiomeSource, MultiNoiseUtil).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const src = readFileSync(fileURLToPath(new URL('../src/02q_biomeclasses.js', import.meta.url)), 'utf8');
function load(code) { const M = {}; new Function('MCL', code)(M); return M.BiomeClasses; }
function scenario(B) {
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  const C = B.BiomeCoords;
  chk(C.fromBlock(-1) === -1 && C.fromBlock(17) === 4 && C.method_39920(-1) === 3 && C.toBlock(-3) === -12 && C.fromChunk(3) === 12 && C.toChunk(-5) === -2, 'BiomeCoords');
  // SeedMixer.mixSeed(a,b): a *= a*636..+144..; a+b (hand: a=1 -> 1*(6364136223846793005+1442695040888963407)=7806831264735756412)
  chk(B.SeedMixer.mixSeed(1n, 5n) === 7806831264735756417n, 'mixSeed 1');
  chk(B.SeedMixer.mixSeed(0n, 7n) === 7n, 'mixSeed 0');
  chk(B.SeedMixer.mixSeed(-1n, 0n) === BigInt.asIntN(64, (-1n) * (-6364136223846793005n + 1442695040888963407n)), 'mixSeed -1 wraps');
  const ck = new B.CheckerboardBiomeSource(['a', 'b', 'c'], 0); // gridSize 2
  chk(ck.getBiome(0, 0, 0) === 'a' && ck.getBiome(4, 0, 0) === 'b' && ck.getBiome(4, 0, 4) === 'c' && ck.getBiome(8, 0, 4) === 'a' && ck.getBiome(-4, 0, 0) === 'c', 'checkerboard floorMod');
  chk(ck.withSeed(5) === ck, 'checkerboard withSeed');
  const M = B.MultiNoiseUtil, PR = M.ParameterRange;
  chk(M.method_38665(0.5) === 5000 && M.method_38665(-0.5) === -5000 && M.method_38665(0.99999) === 9999, 'toLong');
  const r = PR.of(-0.2, 0.3);
  chk(r.getDistance(0) === 0 && r.getDistance(5000) === 2000 && r.getDistance(-3000) === 1000 && r.getDistance(PR.of(0.5, 0.6)) === 2000 && r.getDistance(PR.of(-0.9, -0.5)) === 3000, 'range distance');
  chk(r.combine(PR.of(0.4, 0.9)).max === 9000 && r.combine(null) === r && String(PR.of(0.1)) === '1000' && String(r) === '[-2000-3000]', 'combine/toString');
  let threw = false; try { PR.of(1, 0); } catch (e) { threw = true; } chk(threw, 'min>max throws');
  // search tree must agree with the linear scan on a >10 entry grid (forces branch building)
  const ents = []; let n = 0;
  for (let t = -1; t < 1; t += 0.4) for (let h = -1; h < 1; h += 0.4) for (let w = -1; w < 1; w += 0.7)
    ents.push([M.createNoiseHypercube(PR.of(t, t + 0.4), PR.of(h, h + 0.4), PR.of(-1, 1), PR.of(-1, 1), 0, PR.of(w, w + 0.7), (n % 3) * 0.1), 'e' + n++]);
  const E = new M.Entries(ents); let rs = 12345, bad = 0;
  const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff * 2 - 1; };
  for (let i = 0; i < 300; i++) {
    const p = M.createNoiseValuePoint(rnd(), rnd(), rnd(), rnd(), 0, rnd());
    const a = E.get(p), b = E.getLinear(p);
    if (M.getSquaredDistance(ents.find(e => e[1] === a)[0], p) !== M.getSquaredDistance(ents.find(e => e[1] === b)[0], p)) bad++;
  }
  chk(bad === 0, 'tree vs linear scan: ' + bad + ' disagree');
  chk(ents.length > 10, 'grid exceeds simple-tree size');
  // fittest position: sampler that is the same everywhere returns origin (distance term grows with radius)
  const zero = { sample: () => 0 };
  const s = new M.MultiNoiseSampler(zero, zero, zero, zero, zero, zero, [M.createNoiseHypercube(0, 0, 0, 0, 0, 0, 0)]);
  const sp = s.findBestSpawnPosition(); chk(sp.x === 0 && sp.z === 0, 'spawn origin');
  const hot = { sample: (x, y, z) => (Math.abs(x - 1536) < 300 && Math.abs(z) < 300) ? 0 : 1 };
  const s2 = new M.MultiNoiseSampler(hot, zero, zero, zero, zero, zero, [M.createNoiseHypercube(0, 0, 0, 0, 0, 0, 0)]);
  const sp2 = s2.findBestSpawnPosition(); chk(Math.abs(sp2.x - 1536) < 300 && Math.abs(sp2.z) < 300, 'spawn finds the matching region ' + JSON.stringify(sp2));
  chk(new M.MultiNoiseSampler(zero, zero, zero, zero, zero, zero, []).findBestSpawnPosition().x === 0, 'empty targets -> origin');
  return f;
}
const base = scenario(load(src));
let fail = base.length ? base : [];
const breaks = [
  ['return v >> 2; }, method_39920', 'return v >>> 2; }, method_39920'],
  ['6364136223846793005n + 1442695040888963407n', '6364136223846793005n + 1442695040888963406n'],
  ['(x >> this.gridSize) + (z >> this.gridSize)', '(x >> this.gridSize) - (z >> this.gridSize)'],
  ['var d1 = lo - this.max, d2 = this.min - hi;', 'var d1 = lo - this.max, d2 = hi - this.min;'],
  ['if (best > rd) { best = rd; bn = r; }', 'if (best < rd) { best = rd; bn = r; }'],
  ['sq(hc.offset)', '0'],
  ['Math.max(d2, 0)', 'Math.max(d2, 1)'],
  ['[[2048, 512], [512, 32]]', '[[512, 512], [512, 32]]'],
  ['return Math.trunc(Math.fround(Math.fround(f) * 10000))', 'return Math.round(Math.fround(f) * 10000)'],
];
let caught = 0;
for (const [a, b] of breaks) {
  if (!src.includes(a)) { console.log('FAIL break target missing: ' + a); process.exit(1); }
  let r; try { r = scenario(load(src.replace(a, b))); } catch (e) { r = ['threw']; }
  if (r.length) caught++; else fail.push('break not caught: ' + a);
}
if (fail.length) { console.log('FAIL', fail.join('; ')); process.exit(1); }
console.log('biomeclasses11770check: ok, ' + caught + ' breaks caught');
