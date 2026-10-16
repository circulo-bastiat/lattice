#!/usr/bin/env node
// noisecheck.mjs — PLAN W2's acceptance test. The statistical referee.
//
//   node tools/noisecheck.mjs [--grid 64]
//
// PLAN W2 asks for *"a statistical referee: sample each of the 60 noise functions over a fixed
// grid and compare mean, variance, min, max and the histogram against published vanilla
// figures. Dan chose this verification method explicitly over golden files, because a golden
// file proves you match yourself."*
//
// ⚠ **§6 IS NOW A PARITY TEST, AND IT WAS NOT UNTIL SESSION 6** (D-229). Mojang publishes no
// moments for these fields, so §§1–5 below pin the implementation without a reference. That was
// the whole of this file for four sessions, and D-219 is what it cost: an octave list written
// from memory, wrong for five sessions, iceing over every frozen ocean, with 162 assertions
// passing beside it. §6 compares against **1,060 values taken out of Mojang's own 1.18.2
// bytecode** — `tools/golden/noise-golden-1.18.2.json`, 132 cases producing 1,593 exact
// comparisons once the octave origins and the input/value factors beside each value are
// counted. The dump was produced by reflection over the OFFICIAL Mojang server mappings on the
// machine that has the game (D-229); it is exact to the last bit, and this section skips with a
// printed reason if the dump is not in the tree.
//
// §§1–5 are still worth their run time: they hold when the dump is absent, they cover all sixty
// noises where the dump covers twelve, and they are what notices a field that is deterministic,
// bounded and correct in twelve places while being wrong everywhere else.
//
// The five kinds of check, in order:
//
//   1. EXACT parity on the two pieces that HAVE published reference values — MD5 (RFC 1321's
//      own test vectors) and Xoroshiro128++ (re-implemented independently inside this file
//      from the published algorithm, so agreement is between two implementations).
//   2. ANALYTIC bounds. Every octave stack has a computable maximum. No sample may exceed it,
//      and the observed extremes must come reasonably close to it, or octaves are missing.
//   3. The INVARIANT `NormalNoise` exists to provide: sixty noises with wildly different
//      octave counts and amplitudes must all come out with a comparable spread. That is what
//      the normalisation is FOR, and a wrong `valueFactor` — the 1.18.2 formula replaced by a
//      later one, say — breaks it immediately and visibly.
//   4. STRUCTURAL properties a Perlin field must have: mean zero within sampling error,
//      symmetry, a unimodal histogram, determinism, and sensitivity to both the world seed and
//      the noise's own name.
//
//   5. VANILLA PARITY against the golden vector: the raw Xoroshiro and legacy streams, the MD5
//      seeding path, `Mth.getSeed`, `ImprovedNoise`, the octave stacks with their per-octave
//      origins, `NormalNoise` on twelve of the real overworld parameter sets, and the three
//      fixed-seed `PerlinSimplexNoise` statics read off `Biome` itself.
//
// ⚠ WHAT IS NOT COMPARED, said plainly. Every column that IS compared is compared exactly —
// doubles bit-for-bit, 64-bit words as BigInt, no tolerance anywhere — because every one of
// these algorithms is deterministic integer or IEEE-754 arithmetic with no reordering. What
// the dump does NOT contain: the other forty-eight noise fields (only their parameters are
// checked, by §3's bounds), `nextGaussian` and `nextBoolean` (MC-Lite has neither), and the
// 3D simplex entry point (`Simplex.get2`, which throws by design — no caller reaches it).
// `Normal.analyticBound()` is not in the dump either: it is MC-Lite's own tighter bound and
// has no vanilla counterpart, and `Normal.maxValue()` — which does — is compared.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src';
const ASSETS = MCLITE_ROOT + 'assets';
const argv = process.argv.slice(2);
const GRID = +((argv.indexOf('--grid') >= 0 && argv[argv.indexOf('--grid') + 1]) || 48);

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); };

const NS = { CFG: {} };
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02d_wgdata.js', '03b_noise.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const meta = JSON.parse(readFileSync(join(ASSETS, 'worldgen.meta.json'), 'utf8'));
NS.WG.init({
  worldgen: readFileSync(join(ASSETS, 'worldgen.bin')).toString('base64'),
  worldgenBytes: meta.jsonBytes,
});
const N = NS.Noise, WG = NS.WG;

// ─────────────────────────────────────────────── 1. MD5, against RFC 1321's own vectors
console.log('1. MD5 — RFC 1321 test vectors, and the byte order Mojang reads them in');
{
  const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  const VECTORS = [
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
     'd174ab98d277d9f5a5611c2c9f419d9f'],
    ['12345678901234567890123456789012345678901234567890123456789012345678901234567890',
     '57edf4a22be3c955ac49da2e2107b67a'],
  ];
  for (const [input, want] of VECTORS) {
    ok(hex(N.md5(input)) === want, `md5(${JSON.stringify(input.slice(0, 20))}) = ${hex(N.md5(input))}, RFC says ${want}`);
  }
  // ⚠ the boundary that matters: Mojang reads the 16 bytes as two BIG-ENDIAN longs, while
  // MD5's own output words are little-endian. Getting this wrong gives a working,
  // deterministic, completely different world, so it is asserted against the digest directly.
  const d = N.md5('octave_-10');
  const [lo, hi] = N.md5Longs('octave_-10');
  let wantLo = 0n, wantHi = 0n;
  for (let i = 0; i < 8; i++) wantLo = (wantLo << 8n) | BigInt(d[i]);
  for (let i = 8; i < 16; i++) wantHi = (wantHi << 8n) | BigInt(d[i]);
  ok(lo === wantLo && hi === wantHi, 'md5Longs must read the digest big-endian, bytes 0..7 then 8..15');
  ok(lo !== hi, 'the two halves of a digest must differ');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 2. Xoroshiro128++, against a second implementation
// Written here from the published algorithm rather than by calling src/, so agreement is
// between two implementations rather than one implementation with itself.
console.log('2. Xoroshiro128++ — a second, independent implementation must agree');
{
  const M = (1n << 64n) - 1n;
  const rot = (v, k) => ((v << k) | (v >> (64n - k))) & M;
  function ref(lo, hi) {
    return {
      lo, hi,
      next() {
        const s0 = this.lo; let s1 = this.hi;
        const r = (rot((s0 + s1) & M, 17n) + s0) & M;
        s1 ^= s0;
        this.lo = rot(s0, 49n) ^ s1 ^ ((s1 << 21n) & M);
        this.hi = rot(s1, 28n);
        return r;
      },
    };
  }
  // the seed upgrade, also written out again
  const stafford = (v) => {
    v = ((v ^ (v >> 30n)) * BigInt.asUintN(64, -4658895280553007687n)) & M;
    v = ((v ^ (v >> 27n)) * BigInt.asUintN(64, -7723592293110705685n)) & M;
    return (v ^ (v >> 31n)) & M;
  };
  for (const seed of [0n, 1n, 1337n, -1n, 0x5DEECE66Dn, 123456789012345n]) {
    const lo0 = BigInt.asUintN(64, seed) ^ 7640891576956012809n;
    const hi0 = (lo0 + BigInt.asUintN(64, -7046029254386353131n)) & M;
    const want = [stafford(lo0), stafford(hi0)];
    const got = N.upgradeSeed(seed);
    ok(got[0] === want[0] && got[1] === want[1], `upgradeSeed(${seed}) disagrees`);

    const a = ref(want[0], want[1]);
    const b = N.Xoro.fromSeed(seed);
    let same = true;
    for (let i = 0; i < 200; i++) if (a.next() !== b.next()) { same = false; break; }
    ok(same, `the two Xoroshiro implementations diverge within 200 draws for seed ${seed}`);
  }

  // nextDouble must land in [0,1) and use the top 53 bits
  const r = N.Xoro.fromSeed(1337n);
  let lo = 1, hi = 0, sum = 0, n = 20000;
  for (let i = 0; i < n; i++) { const v = r.nextDouble(); if (v < lo) lo = v; if (v > hi) hi = v; sum += v; }
  ok(lo >= 0 && hi < 1, `nextDouble produced ${lo} .. ${hi}, expected [0,1)`);
  ok(Math.abs(sum / n - 0.5) < 0.01, `nextDouble mean is ${(sum / n).toFixed(4)}, expected 0.5`);

  // nextInt(bound) must be uniform and in range — this is the draw the permutation shuffle
  // uses 256 times per octave, so a bias here bends every noise field in the game
  const r2 = N.Xoro.fromSeed(99n);
  const buckets = new Int32Array(7);
  for (let i = 0; i < 70000; i++) { const v = r2.nextInt(7); if (v < 0 || v > 6) { buckets[0] = -1e9; break; } buckets[v]++; }
  ok(buckets[0] > 0, 'nextInt(7) produced a value outside 0..6');
  let worst = 0;
  for (let i = 0; i < 7; i++) worst = Math.max(worst, Math.abs(buckets[i] / 10000 - 1));
  ok(worst < 0.06, `nextInt(7) is ${(worst * 100).toFixed(1)}% off uniform, expected under 6%`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 3. the sixty noises, sampled
console.log(`3. all ${WG.count('noise')} noise fields over a ${GRID}x${GRID} grid`);
const SEED = 1337n;
const t0 = Date.now();
const all = N.all(SEED);
const buildMs = Date.now() - t0;
const results = [];
{
  ok(!!all && Object.keys(all).length === 60, `built ${all ? Object.keys(all).length : 0} noises, expected 60`);
  ok(buildMs < 3000, `building all sixty took ${buildMs} ms and happens once per thread`);

  const names = WG.names('noise');
  for (const name of names) {
    const noise = all[name];
    const params = WG.get('noise', name);
    // ⚠ Sample at a step tied to the noise's OWN lowest frequency, so every field is measured
    // over the same number of its own periods rather than over the same number of blocks. A
    // fixed block step would sample `temperature` (period ~1024) eight times inside one hump
    // and `cave_cheese` (period ~2) thousands of times across many, and their statistics would
    // not be comparable — which is the comparison this whole section rests on.
    const period = Math.pow(2, -params.firstOctave);
    const step = Math.max(period / 8, 0.25);
    let s = 0, s2 = 0, s3 = 0, min = Infinity, max = -Infinity;
    const HB = 41, hist = new Int32Array(HB);
    // ⚠ `analyticBound()`, not `maxValue()`. Vanilla's `maxValue()` is `edgeValue(2)` and is
    // twice as loose; this section needs the tight bound to notice a missing octave (D-229).
    const bound = noise.analyticBound();
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const v = noise.get(i * step, 0, j * step);
        s += v; s2 += v * v; s3 += v * v * v;
        if (v < min) min = v;
        if (v > max) max = v;
        let b = Math.floor(((v / bound) * 0.5 + 0.5) * HB);
        if (b < 0) b = 0; else if (b >= HB) b = HB - 1;
        hist[b]++;
      }
    }
    const n = GRID * GRID;
    const mean = s / n;
    const variance = s2 / n - mean * mean;
    const sd = Math.sqrt(Math.max(variance, 0));
    const skew = sd > 0 ? (s3 / n - 3 * mean * variance - mean * mean * mean) / (sd * sd * sd) : 0;
    results.push({ name, params, mean, sd, min, max, bound, skew, hist });

    // --- hard: nothing may exceed the analytic bound -------------------------------------
    ok(max <= bound + 1e-9 && min >= -bound - 1e-9,
       `${name}: sampled ${min.toFixed(4)}..${max.toFixed(4)} outside its analytic bound ±${bound.toFixed(4)}`);
    // --- and the bound must not be absurdly loose: a stack that reaches under a tenth of its
    //     own maximum over eight periods has octaves that are not contributing --------------
    ok(Math.max(Math.abs(min), Math.abs(max)) > bound * 0.08,
       `${name}: never got within 8% of its bound (${Math.max(Math.abs(min), Math.abs(max)).toFixed(4)} of ${bound.toFixed(4)}) — are all its octaves present?`);
  }
}
console.log(`   ${pass} ok   (built in ${buildMs} ms)`);

// ─────────────────────────────────────────────── 4. what NormalNoise is FOR
console.log('4. the normalisation invariant — sixty different fields, one comparable spread');
{
  const sds = results.map((r) => r.sd);
  const lo = Math.min(...sds), hi = Math.max(...sds);
  // ⚠ THE ASSERTION THAT CATCHES A WRONG `valueFactor`. NormalNoise's entire job is to make
  // fields with wildly different octave counts and amplitudes — from `temperature`'s six
  // octaves with two non-zero to `cave_entrance`'s dense stack — come out with comparable
  // spread, because every spline table and climate parameter downstream is written against a
  // normalised field. Swap 1.18.2's `(1/6)/expectedDeviation(o)` for a later version's
  // variance-based formula and this band blows open immediately.
  ok(lo > 0.05, `the flattest noise has sd ${lo.toFixed(4)} — a normalised field is not that flat`);
  ok(hi < 0.60, `the widest noise has sd ${hi.toFixed(4)} — the normalisation is not normalising`);
  ok(hi / lo < 6, `the spread of spreads is ${(hi / lo).toFixed(2)}x; a normalised family should be within about 6x`);

  // mean zero, within sampling error. A Perlin field's samples are far from independent, so
  // the effective sample count is the number of LOWEST-OCTAVE cells covered, not the grid.
  let offCentre = 0;
  for (const r of results) {
    const periodsCovered = GRID / 8;                 // the grid spans GRID/8 periods per axis
    const nEff = Math.max(periodsCovered * periodsCovered, 4);
    const se = r.sd / Math.sqrt(nEff);
    if (Math.abs(r.mean) > 4 * se + 0.02) offCentre++;
  }
  ok(offCentre === 0, `${offCentre} of 60 noises have a mean more than 4 standard errors from zero`);

  // symmetry: an improved-Perlin field is symmetric about zero by construction
  const skewed = results.filter((r) => Math.abs(r.skew) > 1.0);
  ok(skewed.length === 0,
     `${skewed.length} noises are strongly skewed: ${skewed.slice(0, 4).map((r) => r.name + ' ' + r.skew.toFixed(2)).join(' · ')}`);

  // unimodal: the histogram must not be bimodal, which is what a stack summed at the wrong
  // frequencies produces
  // ⚠ SMOOTHED FIRST, and that is not softening the test. 2,304 samples in 41 bins is about
  // fifty per bin, so neighbouring counts wobble by ±15% from sampling alone and an unsmoothed
  // peak count measures that wobble rather than the distribution's shape. A 3-bin moving
  // average removes the wobble and leaves any real second mode standing — which is what this
  // is looking for, because a stack summed at the wrong frequencies is genuinely bimodal.
  let multimodal = 0;
  const worst = [];
  for (const r of results) {
    const h = r.hist, sm = new Float64Array(h.length);
    for (let i = 0; i < h.length; i++) {
      sm[i] = (h[Math.max(i - 1, 0)] + h[i] + h[Math.min(i + 1, h.length - 1)]) / 3;
    }
    let peaks = 0;
    const top = Math.max(...sm);
    for (let i = 1; i < sm.length - 1; i++) {
      if (sm[i] > sm[i - 1] && sm[i] >= sm[i + 1] && sm[i] > top * 0.5) peaks++;
    }
    if (peaks > 1) { multimodal++; worst.push(r.name + '(' + peaks + ')'); }
  }
  ok(multimodal <= 6,
     `${multimodal} of 60 smoothed histograms are multimodal: ${worst.slice(0, 6).join(' ')}`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 5. determinism and sensitivity
console.log('5. determinism, and sensitivity to both seeds');
{
  const a = N.all(SEED), b = N.all(SEED), c = N.all(SEED + 1n);
  const P = [[0, 0, 0], [12.5, 0, -7.25], [1000, 40, -1000], [-33333, 0, 22222]];
  let identical = 0, differsBySeed = 0;
  for (const name of WG.names('noise')) {
    let same = true, diff = false;
    for (const [x, y, z] of P) {
      if (a[name].get(x, y, z) !== b[name].get(x, y, z)) same = false;
      if (a[name].get(x, y, z) !== c[name].get(x, y, z)) diff = true;
    }
    if (same) identical++;
    if (diff) differsBySeed++;
  }
  ok(identical === 60, `${60 - identical} noises are not deterministic for one seed`);
  ok(differsBySeed === 60, `${60 - differsBySeed} noises did NOT change when the world seed did`);

  // and the noise's own NAME must matter, or every field would be the same field
  const temp = WG.get('noise', 'temperature');
  const asTemp = N.fromParameters(SEED, 'temperature', temp);
  const asVeg = N.fromParameters(SEED, 'vegetation', temp);   // same parameters, different name
  let differsByName = false;
  for (const [x, y, z] of P) if (asTemp.get(x, y, z) !== asVeg.get(x, y, z)) differsByName = true;
  ok(differsByName, 'two noises with the same parameters and different names produced the same field');

  // the namespace must be part of the hash, not stripped
  const bare = N.fromParameters(SEED, 'minecraft:temperature', temp);
  let sameAsNamespaced = true;
  for (const [x, y, z] of P) if (bare.get(x, y, z) !== asTemp.get(x, y, z)) sameAsNamespaced = false;
  ok(sameAsNamespaced, '`temperature` and `minecraft:temperature` must seed identically');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 6. VANILLA PARITY — the golden vector (D-229)
// The section this file waited four sessions for. Every number checked here came out of
// Mojang's own 1.18.2 bytecode, by reflection, on a machine that had the game; nothing below
// was derived from src/03b_noise.js, so agreement is parity and not self-consistency.
console.log('6. vanilla parity — the golden vector, out of the real 1.18.2 bytecode');
const GOLDEN_PATH = join(MCLITE_ROOT, 'tools', 'golden', 'noise-golden-1.18.2.json');
// The jar the dump was taken from — the same one `vanillacheck`'s golden world came off (D-199).
const GOLDEN_JAR_SHA1 = 'c8f83c5655308435b3dcf03c06d9fe8740a77469';
const GOLDEN_MAPPINGS_SHA1 = 'e562f588fea155d96291267465dc3323bfe1551b';

let golden = null, goldenWhy = '';
try { golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')); }
catch (e) { goldenWhy = e.code === 'ENOENT' ? 'the dump is not in the tree' : e.message; }

// ── the comparator. One case in, a list of disagreements out. Used twice: once in §6 against
//    the dump as it stands, and once in §7 against a dump that has been deliberately broken.
const KINDS_SEEN = new Set();
function sourceFor(spec) {
  let m = /^xoro:(-?\d+)\/forkPositional\/fromHashOf\((.*)\)$/.exec(spec);
  if (m) return N.Xoro.fromSeed(BigInt(m[1])).forkPositional().fromHashOf(m[2]);
  m = /^legacy:(-?\d+)$/.exec(spec);
  if (m) return new N.LegacyRandom(BigInt(m[1]));
  throw new Error('the dump names a random source this check cannot build: ' + spec);
}
const sgn = (u) => BigInt.asIntN(64, u);      // MC-Lite carries the 64-bit words unsigned

function checkCase(c) {
  const bad = [], id = c.id, v = c.values;
  let vals = 0, n = 0;                     // vals: entries of `values`; n: every comparison made
  const eqv = (got, want, what) => { vals++; n++; if (got !== want) bad.push(id + ' ' + what + ': got ' + got + ', vanilla says ' + want); };
  const eqx = (got, want, what) => { n++; if (got !== want) bad.push(id + ' ' + what + ': got ' + got + ', vanilla says ' + want); };
  KINDS_SEEN.add(c.kind);
  switch (c.kind) {
    case 'xoro.seedWords': {
      const w = N.upgradeSeed(BigInt(c.seed));
      eqv(sgn(w[0]), BigInt(v[0]), 'seedLo'); eqv(sgn(w[1]), BigInt(v[1]), 'seedHi'); break;
    }
    case 'xoro.stream': {
      const r = N.Xoro.fromSeed(BigInt(c.seed));
      for (let i = 0; i < v.length; i++) {
        if (c.op === 'nextLong') eqv(sgn(r.next()), BigInt(v[i]), 'nextLong[' + i + ']');
        else if (c.op === 'nextDouble') eqv(r.nextDouble(), v[i], 'nextDouble[' + i + ']');
        else eqv(r.nextFloat(), v[i], 'nextFloat[' + i + ']');
      }
      break;
    }
    case 'xoro.streamInt': {
      const r = N.Xoro.fromSeed(BigInt(c.seed));
      for (let i = 0; i < v.length; i++) eqv(r.nextInt(), v[i], 'nextInt[' + i + ']');
      break;
    }
    case 'xoro.nextIntBounded': {
      const r = N.Xoro.fromSeed(BigInt(c.seed));
      for (let i = 0; i < v.length; i++) eqv(r.nextInt(c.bounds[i]), v[i], 'nextInt(' + c.bounds[i] + ')');
      break;
    }
    case 'fork.fromHashOf': case 'fork.at': {
      const f = N.Xoro.fromSeed(BigInt(c.seed)).forkPositional();
      const s = c.kind === 'fork.at' ? f.at(c.pos[0], c.pos[1], c.pos[2]) : f.fromHashOf(c.name);
      eqv(sgn(s.lo), BigInt(v[0]), 'seedLo'); eqv(sgn(s.hi), BigInt(v[1]), 'seedHi');
      eqv(sgn(s.next()), BigInt(v[2]), 'nextLong[0]'); eqv(sgn(s.next()), BigInt(v[3]), 'nextLong[1]');
      break;
    }
    case 'mth.getSeed':
      for (let i = 0; i < v.length; i++) {
        const p = c.points[i];
        eqv(N.positionSeed(p[0], p[1], p[2]), BigInt(v[i]), 'getSeed(' + p + ')');
      }
      break;
    case 'legacy.scrambledSeed':
      eqv(new N.LegacyRandom(BigInt(c.seed)).seed, BigInt(v[0]), 'the scrambled 48-bit seed'); break;
    case 'legacy.streamInt': {
      const r = new N.LegacyRandom(BigInt(c.seed));
      for (let i = 0; i < v.length; i++) eqv(r.nextInt(), v[i], 'nextInt[' + i + ']');
      break;
    }
    case 'legacy.nextIntBounded': {
      const r = new N.LegacyRandom(BigInt(c.seed));
      for (let i = 0; i < v.length; i++) eqv(r.nextInt(c.bounds[i]), v[i], 'nextInt(' + c.bounds[i] + ')');
      break;
    }
    case 'legacy.stream': {
      const r = new N.LegacyRandom(BigInt(c.seed));
      for (let i = 0; i < v.length; i++) eqv(r.nextDouble(), v[i], 'nextDouble[' + i + ']');
      break;
    }
    // ⚠ D-235 — THE REJECTION BRANCH, WHICH NO ORDINARY SEED REACHES. Both bounded draws in this
    // stack reject once in millions of draws, so every `nextIntBounded` case above takes the
    // fast path and D-229's "the rejection loop agreed" was a statement about untaken code.
    // These seeds are constructed to land in the window. `drawsConsumed` is vanilla's own
    // measured draw count and is asserted here, so a regenerated dump that quietly stopped
    // rejecting would fail rather than turn into an ordinary bounded draw.
    case 'legacy.nextIntReject': {
      eqx(c.drawsConsumed > 1, true,
        'the dump says this seed consumed ' + c.drawsConsumed + ' draw(s), so it never entered the rejection loop and fences nothing');
      const r = new N.LegacyRandom(BigInt(c.seed));
      eqv(BigInt(r.nextInt(c.bound)), BigInt(v[0]), 'nextInt(' + c.bound + ') across the rejection');
      // the STATE matters as much as the value: a port that never rejects also never consumes
      // the rejected draw, and everything it draws afterwards is off by one
      eqv(r.seed, BigInt(v[1]), 'the 48-bit seed afterwards');
      break;
    }
    case 'xoro.nextIntReject': {
      eqx(c.drawsConsumed > 1, true,
        'the dump says this seed consumed ' + c.drawsConsumed + ' draw(s), so it never entered Lemire\'s rejection loop and fences nothing');
      const r = N.Xoro.fromSeed(BigInt(c.seed));
      eqv(BigInt(r.nextInt(c.bound)), BigInt(v[0]), 'nextInt(' + c.bound + ') across the rejection');
      eqv(sgn(r.lo), BigInt(v[1]), 'seedLo afterwards');
      eqv(sgn(r.hi), BigInt(v[2]), 'seedHi afterwards');
      break;
    }
    case 'improved.origins': {
      const n = new N.Improved(sourceFor(c.source));
      eqv(n.xo, v[0], 'xo'); eqv(n.yo, v[1], 'yo'); eqv(n.zo, v[2], 'zo'); break;
    }
    case 'improved.noise': {
      const n = new N.Improved(sourceFor(c.source));
      for (let i = 0; i < v.length; i++) {
        const p = c.points[i];
        eqv(n.noise(p[0], p[1], p[2]), v[i], 'noise(' + p + ')');
      }
      break;
    }
    case 'perlin.stack': {
      const rnd = N.Xoro.fromSeed(BigInt(c.worldSeed)).forkPositional().fromHashOf(c.noiseId);
      const st = new N.Perlin(rnd, c.firstOctave, c.amplitudes);
      eqx(st.inputFactor, c.inputFactor, 'inputFactor');
      eqx(st.valueFactor, c.valueFactor, 'valueFactor');
      eqx(st.levels.length, c.octaveOrigins.length, 'octave count');
      for (let i = 0; i < c.octaveOrigins.length; i++) {
        const o = c.octaveOrigins[i], lv = st.levels[i];
        // ⚠ a null here is the WHOLE point: a zero amplitude means the octave was never built
        if (o === null) eqx(lv, null, 'octave ' + i + ' exists and vanilla never built it');
        else if (!lv) bad.push(id + ' octave ' + i + ' is missing and vanilla has one');
        else { eqx(lv.xo, o[0], 'octave ' + i + ' xo'); eqx(lv.yo, o[1], 'octave ' + i + ' yo'); eqx(lv.zo, o[2], 'octave ' + i + ' zo'); }
      }
      for (let i = 0; i < v.length; i++) {
        const p = c.points[i];
        eqv(st.get(p[0], p[1], p[2]), v[i], 'getValue(' + p + ')');
      }
      break;
    }
    case 'normal.noise': {
      // ⚠ the PARAMETERS are checked too, and they are the ones vanilla's own registry holds.
      // MC-Lite's copy comes through `pack-worldgen.mjs`; if the two ever diverge, the values
      // below would still agree, because both sides would be using the dump's copy.
      const short = c.noiseId.replace(/^minecraft:/, '');
      const mine = WG.get('noise', short);
      if (!mine) bad.push(id + ': MC-Lite has no parameters for ' + short);
      else {
        eqx(mine.firstOctave, c.firstOctave, 'packed firstOctave');
        eqx(JSON.stringify([...mine.amplitudes]), JSON.stringify(c.amplitudes), 'packed amplitudes');
      }
      const n = N.fromParameters(BigInt(c.worldSeed), c.noiseId,
        { firstOctave: c.firstOctave, amplitudes: c.amplitudes });
      eqx(n.valueFactor, c.valueFactor, 'valueFactor');
      if (c.maxValue !== null) eqx(n.maxValue(), c.maxValue, 'maxValue');
      for (const [key, stack] of [['firstStackOrigins', n.first], ['secondStackOrigins', n.second]]) {
        if (!c[key]) continue;
        for (let i = 0; i < c[key].length; i++) {
          const o = c[key][i], lv = stack.levels[i];
          if (o === null) eqx(lv, null, key + ' ' + i + ' exists and vanilla never built it');
          else if (!lv) bad.push(id + ' ' + key + ' ' + i + ' is missing');
          else { eqx(lv.xo, o[0], key + ' ' + i + ' xo'); eqx(lv.zo, o[2], key + ' ' + i + ' zo'); }
        }
      }
      for (let i = 0; i < v.length; i++) {
        const p = c.points[i];
        eqv(n.get(p[0], p[1], p[2]), v[i], 'getValue(' + p + ')');
      }
      break;
    }
    case 'perlinSimplex': {
      // ⚠ THE NEGATIVE CONTROL. One case in the dump is the octave list D-219 found MC-Lite
      // using by mistake, computed by the real game. MC-Lite must NOT reproduce it.
      if (/wrongOctaves/.test(id)) {
        const ps = N.frozenTemperatureNoise();
        let same = true;
        for (let i = 0; i < v.length; i++) {
          const p = c.points[i];
          vals++;
          if (ps.get(p[0], p[1], p[2]) !== v[i]) same = false;
        }
        if (same) bad.push(id + ': MC-Lite reproduces the PRE-D-219 field — the octave list is [-3,-2,-1] again');
        break;
      }
      let ps;
      if (/biomeStatic\.BIOME_INFO/.test(id)) ps = N.biomeInfoNoise();
      else if (/biomeStatic\.TEMPERATURE/.test(id)) ps = N.temperatureNoise();
      else if (/biomeStatic\.FROZEN/.test(id)) ps = N.frozenTemperatureNoise();
      else ps = new N.PerlinSimplex(new N.LegacyRandom(BigInt(c.legacySeed)), c.octaves);
      eqx(ps.levels.length, c.levelCount, 'level count');
      eqx(ps.inputFactor, c.inputFactor, 'inputFactor');
      eqx(ps.valueFactor, c.valueFactor, 'valueFactor');
      for (let i = 0; i < c.levelOrigins.length; i++) {
        const o = c.levelOrigins[i], lv = ps.levels[i];
        if (o === null) eqx(lv == null, true, 'level ' + i + ' exists and vanilla never built it');
        else if (!lv) bad.push(id + ' level ' + i + ' is missing and vanilla has one');
        else { eqx(lv.xo, o[0], 'level ' + i + ' xo'); eqx(lv.yo, o[1], 'level ' + i + ' yo'); eqx(lv.zo, o[2], 'level ' + i + ' zo'); }
      }
      for (let i = 0; i < v.length; i++) {
        const p = c.points[i];
        eqv(ps.get(p[0], p[1], p[2]), v[i], 'getValue(' + p[0] + ',' + p[1] + ',' + p[2] + ')');
      }
      break;
    }
    default:
      bad.push(id + ': this check does not know the case kind "' + c.kind + '" and silently ignored ' + v.length + ' values');
      break;
  }
  return { bad, vals, n };
}

let goldenValues = 0;
if (!golden) {
  // ⚠ SKIP, LOUDLY. The dump is generated data taken on a machine that has the game; a tree
  // without it is a legitimate state, and a check that pretended to pass would be worse.
  console.log('   SKIPPED — ' + goldenWhy);
  console.log('   expected at ' + GOLDEN_PATH);
  console.log('   regenerate with _scratch/mclite/ng_dump.js on a machine with the 1.18.2 jars (D-229).');
} else {
  ok(golden.schema === 'mclite-noise-golden/1', `the dump's schema is "${golden.schema}", expected mclite-noise-golden/1`);
  const pv = golden.provenance || {};
  ok(pv.minecraftVersion === '1.18.2', `the dump says it is ${pv.minecraftVersion}, and the version target is 1.18.2 (D-2)`);
  ok(pv.serverJarSha1 === GOLDEN_JAR_SHA1, `the dump's jar SHA-1 is ${pv.serverJarSha1}, expected ${GOLDEN_JAR_SHA1}`);
  ok(pv.mappingsSha1 === GOLDEN_MAPPINGS_SHA1, `the dump's mappings SHA-1 is ${pv.mappingsSha1}, expected ${GOLDEN_MAPPINGS_SHA1}`);
  ok(typeof pv.java === 'string' && pv.java.length > 0, 'the dump does not record which JVM produced it');
  ok(pv.obfuscatedNames && Object.keys(pv.obfuscatedNames).length >= 15,
     'the dump does not record which obfuscated classes it read, so nothing can be re-derived from it');

  const cases = golden.cases || [];
  for (const c of cases) goldenValues += (c.values || []).length;
  // --- the anti-vacuity floor: a truncated or emptied dump must not pass ------------------
  ok(cases.length >= 220, `the dump carries ${cases.length} cases, and a real one has at least 220`);
  ok(goldenValues >= 2000, `the dump carries ${goldenValues} values, and a real one has at least 2,000`);

  let compared = 0, comparisons = 0;
  const mismatches = [];
  for (const c of cases) {
    const r = checkCase(c);
    compared += r.vals; comparisons += r.n;
    for (const m of r.bad) mismatches.push(m);
  }
  // one assertion per comparison, so the count in the summary is the number of things that
  // were actually asked of the engine rather than the number of cases they were grouped into
  for (let i = mismatches.length; i < comparisons; i++) pass++;
  for (const m of mismatches) ok(false, m);
  ok(comparisons > goldenValues, `only ${comparisons} comparisons for ${goldenValues} values — the factors and octave origins beside them are not being checked`);
  // --- and every value in the file must have been LOOKED at ------------------------------
  ok(compared === goldenValues,
     `${compared} of the dump's ${goldenValues} values were compared — the rest were silently skipped`);

  const WANT_KINDS = ['xoro.seedWords', 'xoro.stream', 'xoro.streamInt', 'xoro.nextIntBounded',
    'fork.fromHashOf', 'fork.at', 'mth.getSeed', 'legacy.scrambledSeed', 'legacy.streamInt',
    'legacy.nextIntBounded', 'legacy.stream', 'legacy.nextIntReject', 'xoro.nextIntReject',
    'improved.origins', 'improved.noise',
    'perlin.stack', 'normal.noise', 'perlinSimplex'];
  for (const k of WANT_KINDS) ok(KINDS_SEEN.has(k), `the dump has no "${k}" case — that whole family is unreferenced`);
  ok(cases.some((c) => /wrongOctaves/.test(c.id)),
     'the dump has lost its negative control (the pre-D-219 octave list) and can no longer prove D-219');

  // ── D-235: THE DUMP'S OWN COVERAGE, ASSERTED ───────────────────────────────────────────
  // D-229 was invisible for six sessions because every positional seed anyone had ever checked
  // sat inside |x| < 687, and the bug starts at 687. A golden vector that drifted back to the
  // origin would be exactly as blind, and nothing above would notice — every value in it would
  // still agree. So the SPREAD of the sample points is asserted too, and it is asserted about
  // the file rather than about the engine.
  const seedPts = [];
  for (const c of cases) {
    if (c.kind === 'mth.getSeed') for (const p of c.points) seedPts.push(p);
    else if (c.kind === 'fork.at') seedPts.push(c.pos);
  }
  ok(seedPts.length >= 60, `only ${seedPts.length} positional-seed points in the dump`);
  const spans = (f) => seedPts.some(f);
  ok(spans((p) => Math.abs(p[0]) >= 687 && Math.abs(p[0]) <= 4096),
     'no positional-seed point sits just past x = ±687, which is where D-229 first disagreed');
  ok(spans((p) => Math.abs(p[0]) >= (1 << 20)), 'no positional-seed point past ±2^20');
  ok(spans((p) => Math.abs(p[0]) >= (1 << 24)), 'no positional-seed point past ±2^24');
  ok(spans((p) => Math.abs(p[0]) >= 1000000 && Math.abs(p[2]) >= 1000000),
     'no positional-seed point a million blocks out in BOTH x and z — the distance soakcheck flies to (D-148)');
  ok(spans((p) => p[0] === 2147483647) && spans((p) => p[0] === -2147483648),
     'no positional-seed point at the int extremes, where a 32-bit wrap and a 64-bit one differ most');
  ok(spans((p) => p[1] === -64) && spans((p) => p[1] >= 320),
     'the positional-seed points do not span the world in y (−64 to 320)');
  ok(spans((p) => p[0] < 0 && p[2] > 0) && spans((p) => p[0] > 0 && p[2] < 0),
     'the positional-seed points never mix the signs of x and z');

  // and the noise field itself must be sampled far out, not only near the origin
  ok(cases.some((c) => (c.kind === 'normal.noise' || c.kind === 'perlin.stack') &&
       (c.points || []).some((p) => Math.abs(p[0]) >= 1000000)),
     'no noise stack is sampled a million blocks from the origin');

  // ── and EVERY noise must have real values behind it, not just parameters (the residual D-229)
  const covered = new Set(cases.filter((c) => c.kind === 'normal.noise').map((c) => c.noiseId));
  const allNoises = WG.names('noise');
  const uncovered = allNoises.filter((n) => !covered.has(n.indexOf(':') < 0 ? 'minecraft:' + n : n));
  ok(uncovered.length === 0,
     `${uncovered.length} of MC-Lite's ${allNoises.length} noises have no golden value at all: ` + uncovered.slice(0, 10).join(' '));
  const deep = new Set(cases.filter((c) => c.kind === 'perlin.stack').map((c) => c.noiseId));
  ok(deep.size >= 12, `only ${deep.size} noises are sampled deeply (raw Perlin stack and per-octave origins)`);
  // the rejection branch must be present on BOTH random sources
  ok(cases.some((c) => c.kind === 'legacy.nextIntReject') && cases.some((c) => c.kind === 'xoro.nextIntReject'),
     'the dump has no forced-rejection case for one of the two random sources');


  console.log(`   ${cases.length} cases · ${goldenValues} golden values · ${comparisons} exact comparisons · ${mismatches.length} disagreements`);
  for (const m of mismatches.slice(0, 10)) console.log('   ✗ ' + m);
  console.log('   every column is compared EXACTLY: doubles bit-for-bit, 64-bit words as BigInt.');
  console.log('   ' + (pv.notes || []).length + ' provenance notes · jar ' + (pv.serverJarSha1 || '?').slice(0, 12));
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 7. anti-vacuity (D-30)
console.log('7. anti-vacuity: break it, and it must be caught');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('a zero amplitude treated as an octave that contributes nothing', () => {
    // ⚠ The subtlest thing in the whole port. An amplitude of 0 means the octave is NOT
    // CREATED, so it draws no randomness, so every octave after it gets different numbers.
    // Building it and multiplying by zero gives a different world that looks perfectly fine.
    // temperature's amplitudes are [1.5, 0, 1, 0, 0, 0] — four of its six do not exist.
    const p = WG.get('noise', 'temperature');
    const real = N.fromParameters(SEED, 'temperature', p);
    const naive = N.fromParameters(SEED, 'temperature',
      { firstOctave: p.firstOctave, amplitudes: p.amplitudes.map((a) => (a === 0 ? 1e-300 : a)) });
    // a non-zero amplitude, however tiny, creates the octave and shifts every later seed
    if (real.get(100, 0, 100) !== naive.get(100, 0, 100)) throw 0;
  });

  check('the octave name built from the index instead of the absolute octave', () => {
    // `"octave_" + (firstOctave + k)`, not `"octave_" + k`. temperature's first octave is
    // seeded from `octave_-10`.
    const p = WG.get('noise', 'temperature');
    const rndA = N.Xoro.fromSeed(SEED).forkPositional().fromHashOf('minecraft:temperature');
    const right = new N.Perlin(rndA, p.firstOctave, p.amplitudes);
    const rndB = N.Xoro.fromSeed(SEED).forkPositional().fromHashOf('minecraft:temperature');
    const wrong = new N.Perlin(rndB, 0, p.amplitudes);        // octave names become octave_0..
    if (right.get(50, 0, 50) !== wrong.get(50, 0, 50)) throw 0;
  });

  check('the gradient table read without the & 15 mask', () => {
    // The table has 16 entries and the last four repeat earlier ones on purpose; a 4-bit hash
    // is what indexes it. Reading with a wider index would run off the end.
    if (N.GRAD.length !== 48) throw 0;
    if (N.gradDot(255, 1, 1, 1) !== N.gradDot(15, 1, 1, 1)) throw 0;
    if (N.gradDot(16, 1, 1, 1) !== N.gradDot(0, 1, 1, 1)) throw 0;
    throw 0;
  });

  check('the 1.18.2 normalisation replaced by a later one', () => {
    // 1.18.2: (1/6) / (0.1 * (1 + 1/(o+1))). A later version computes it from the measured
    // Perlin standard deviation instead. The two differ, and every spline threshold moves.
    const mine = (o) => (1 / 6) / N.expectedDeviation(o);
    const later = (o) => (1 * (1 / 3)) / (0.2702247831245211 * Math.sqrt(o + 1) * Math.SQRT2);
    if (Math.abs(mine(2) - later(2)) < 1e-6) throw 0;    // they must NOT coincide
    if (Math.abs(mine(2) - 1.25) > 1e-9) throw 0;        // and mine must be the 1.18.2 number
    throw 0;
  });

  check('the second Perlin stack sampled at the same coordinate as the first', () => {
    // The 1.0181268882175227 factor is what stops the two stacks lining up. Without it they
    // would correlate and the field would be a scaled single stack.
    if (Math.abs(N.INPUT_FACTOR - 1.0181268882175227) > 1e-15) throw 0;
    const p = WG.get('noise', 'ridge');
    const n = N.fromParameters(SEED, 'ridge', p);
    // first and second are independent stacks: their values at the same point must differ
    if (n.first.get(31, 0, 17) === n.second.get(31, 0, 17)) throw 0;
    throw 0;
  });

  // ── and the same again for the GOLDEN VECTOR (D-229). A stored answer key is only worth
  //    having if a wrong answer fails, so every family in the dump gets a deliberate break.
  if (golden) {
    const clone = (c) => JSON.parse(JSON.stringify(c));
    const pick = (re) => { const c = golden.cases.find((x) => re.test(x.id)); if (!c) throw new Error('no case matches ' + re); return clone(c); };
    const nextUp = (x) => {                       // the next representable double, whatever x is
      const b = new DataView(new ArrayBuffer(8));
      b.setFloat64(0, x);
      let hi = b.getUint32(0), lo = b.getUint32(4);
      if (lo === 0xFFFFFFFF) { hi = (hi + 1) >>> 0; lo = 0; } else lo = (lo + 1) >>> 0;
      b.setUint32(0, hi); b.setUint32(4, lo);
      return b.getFloat64(0);
    };
    const notices = (c) => { if (checkCase(c).bad.length) throw 0; };

    check('golden: one Xoroshiro nextLong off by one', () => {
      const c = pick(/^xoro\.nextLong\.1337$/);
      c.values[5] = (BigInt(c.values[5]) + 1n).toString();
      notices(c);
    });
    check('golden: one forkPositional.at seed word off by one', () => {
      // the family that hid the `Mth.getSeed` 32-bit multiply for six sessions
      const c = pick(/^fork\.at\.1337\.1000_64_-1000$/);
      c.values[0] = (BigInt(c.values[0]) + 1n).toString();
      notices(c);
    });
    check('golden: one Mth.getSeed value off by one', () => {
      const c = pick(/^mth\.getSeed$/);
      c.values[3] = (BigInt(c.values[3]) + 1n).toString();
      notices(c);
    });
    check('golden: one LegacyRandomSource nextDouble moved one ulp', () => {
      const c = pick(/^legacy\.nextDouble\.2345$/);
      c.values[2] = nextUp(c.values[2]);
      notices(c);
    });
    check('golden: one ImprovedNoise sample moved one ulp', () => {
      const c = pick(/^improved\.noise\.legacy:1234$/);
      c.values[7] = nextUp(c.values[7]);
      notices(c);
    });
    check('golden: an octave vanilla DID build declared absent', () => {
      const c = pick(/^perlin\.temperature\./);
      const i = c.octaveOrigins.findIndex((o) => o !== null);
      c.octaveOrigins[i] = null;
      notices(c);
    });
    check('golden: a packed amplitude that no longer matches vanilla\'s registry', () => {
      const c = pick(/^normal\.continentalness\.1337$/);
      c.amplitudes = c.amplitudes.slice();
      c.amplitudes[0] = c.amplitudes[0] + 0.5;
      notices(c);
    });
    check('golden: a NormalNoise valueFactor doubled', () => {
      const c = pick(/^normal\.temperature\.1337$/);
      c.valueFactor = c.valueFactor * 2;
      notices(c);
    });
    check('golden: a PerlinSimplexNoise level origin moved one ulp', () => {
      const c = pick(/^perlinSimplex\.biomeStatic\.FROZEN/);
      c.levelOrigins[1][0] = nextUp(c.levelOrigins[1][0]);
      notices(c);
    });
    check('golden: the negative control replaced by the RIGHT answer', () => {
      // if the pre-D-219 case ever held the real frozen field, MC-Lite would match it and the
      // control would silently stop controlling anything
      const c = pick(/wrongOctaves/);
      c.values = clone(golden.cases.find((x) => /biomeStatic\.FROZEN/.test(x.id))).values;
      notices(c);
    });
    check('golden: a forced rejection turned back into an ordinary draw', () => {
      // ⚠ THE BREAK THAT MATTERS FOR D-235. If the dump ever came back with a seed that does
      // not enter the rejection loop, every value in the case would still agree and the branch
      // would be unfenced again — silently, exactly as it was before this section existed.
      const c = pick(/^legacy\.nextIntReject\.100$/);
      c.drawsConsumed = 1;
      notices(c);
    });
    check('golden: a LegacyRandomSource rejection answering the first candidate', () => {
      // what MC-Lite itself answered until D-235: the double-valued `bits - val + bound - 1`
      // never goes negative, so the loop never rejects and the FIRST candidate is returned
      const c = pick(/^legacy\.nextIntReject\.253$/);
      const r = new N.LegacyRandom(BigInt(c.seed));
      const bits = r.next(31);
      c.values = [String(bits % c.bound), c.values[1]];
      notices(c);
    });
    check('golden: a rejection case whose post-draw state forgot the rejected draw', () => {
      const c = pick(/^legacy\.nextIntReject\.1000$/);
      c.values[1] = (BigInt(c.values[1]) + 1n).toString();
      notices(c);
    });
    check('golden: a Xoroshiro rejection whose seed words afterwards are one draw short', () => {
      const c = pick(/^xoro\.nextIntReject\.1431655766$/);
      c.values[1] = (BigInt(c.values[1]) + 1n).toString();
      notices(c);
    });
    check('golden: a getSeed value PAST x = 687 off by one', () => {
      // near the origin the 32-bit and 64-bit forms agree, so a break there proves nothing
      // about the width; this one is at a position where they cannot agree
      const c = pick(/^mth\.getSeed$/);
      const i = c.points.findIndex((p) => Math.abs(p[0]) >= 1000000);
      if (i < 0) throw new Error('the dump has no getSeed point a million blocks out');
      c.values[i] = (BigInt(c.values[i]) + 1n).toString();
      notices(c);
    });
    check('golden: one of the 48 shallow noises moved one ulp', () => {
      // the residual D-229: these had parameters and bounds but no values until D-235
      const c = golden.cases.find((x) => x.kind === 'normal.noise' && !x.firstStackOrigins);
      if (!c) throw new Error('the dump has no shallow normal.noise case');
      const d = clone(c);
      d.values[4] = nextUp(d.values[4]);
      notices(d);
    });
    check('golden: a case kind this check does not know is not silently skipped', () => {
      const c = pick(/^normal\.temperature\.1337$/);
      c.kind = 'normal.noise.v2';
      notices(c);
    });
  }

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

// ─────────────────────────────────────────────── report
const show = ['temperature', 'vegetation', 'continentalness', 'erosion', 'ridge',
              'offset', 'jagged', 'cave_cheese', 'ore_veininess'];
console.log('');
console.log('  noise             octaves  firstOct     mean       sd      min      max    bound');
for (const name of show) {
  const r = results.find((x) => x.name === name);
  if (!r) continue;
  const nz = r.params.amplitudes.filter((a) => a !== 0).length;
  console.log('  ' + name.padEnd(18) +
    String(nz + '/' + r.params.amplitudes.length).padStart(7) +
    String(r.params.firstOctave).padStart(10) +
    r.mean.toFixed(4).padStart(9) + r.sd.toFixed(4).padStart(9) +
    r.min.toFixed(3).padStart(9) + r.max.toFixed(3).padStart(9) + r.bound.toFixed(3).padStart(9));
}

console.log('');
console.log('================ noisecheck ===============');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
if (fails.length > 20) console.log(`   ... and ${fails.length - 20} more`);
console.log('');
console.log(golden
  ? ` vanilla parity ..... ${goldenValues} golden values from the real 1.18.2 jar, compared exactly`
  : ' vanilla parity ..... SKIPPED, no golden dump in tools/golden/');
console.log(` 60 noises · ${GRID}x${GRID} samples each · sd ` +
  Math.min(...results.map((r) => r.sd)).toFixed(3) + ' .. ' +
  Math.max(...results.map((r) => r.sd)).toFixed(3));
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
