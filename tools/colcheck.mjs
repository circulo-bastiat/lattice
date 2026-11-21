#!/usr/bin/env node
// colcheck.mjs — PLAN W3's acceptance test for the column function.
//
//   node tools/colcheck.mjs [--print]
//
// PLAN W3: *"Acceptance: ASCII cross-sections, reviewable without a GPU; height is
// byte-identical when sampled in three different orders."*
//
// Both of those are here, and the second is the one that matters most. `height(x, z)` is the
// invariant PLAN W0 says survives deviation #1 and in fact gets STRONGER — every later stage
// leans on it, and §7's structure placement leans on it hard: a village decides where to sit by
// asking the height at four corners, from a different chunk, on a different thread, possibly
// hours apart. If that answer ever depends on what was sampled before it, structures move and
// worlds stop being reproducible.
//
// Three orders are checked — row-major, column-major and a shuffled walk — and the results must
// be bit-identical, not merely close.
//
// The cross-sections are the other half. A worldgen bug is usually obvious in a picture and
// invisible in a number, and a picture that needs a GPU is a picture nobody looks at during a
// headless run. `--print` shows them; the check asserts their SHAPE either way.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src';
const ASSETS = MCLITE_ROOT + 'assets';
const PRINT = process.argv.includes('--print');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

const NS = { CFG: {} };
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02d_wgdata.js', '03b_noise.js', '04d_column.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const meta = JSON.parse(readFileSync(join(ASSETS, 'worldgen.meta.json'), 'utf8'));
NS.WG.init({
  worldgen: readFileSync(join(ASSETS, 'worldgen.bin')).toString('base64'),
  worldgenBytes: meta.jsonBytes,
});
const C = NS.Column, WG = NS.WG;
const SEED = 1337n;
const t0 = Date.now();
C.init(SEED);
const initMs = Date.now() - t0;

let jaggedCellFaults;      // #328, built in §1 and broken in §5

// ─────────────────────────────────────────────── 1. the pieces that are ported
console.log('1. the ported pieces, against the files they came from');
{
  ok(C.ready, 'Column.init did not run');
  ok(initMs < 500, `init took ${initMs} ms`);
  ok(C.seaLevel === 63, `sea level is ${C.seaLevel}`);
  ok(C.minY === -64 && C.maxY === 320, `world column is ${C.minY}..${C.maxY}`);
  // ⚠ D-117. Two different numbers, and conflating them cost a mountain top. `minY`/`maxY` are what
  // vanilla's noise settings DECLARE (-64..320); `worldTop` is the world MC-Lite actually has
  // (D-19: -64..256, 20 sections). `height` must clamp to the second.
  ok(C.worldTop === 256, `Column.worldTop is ${C.worldTop}, D-19 says the world stops at 256`);
  ok(C.worldTop < C.maxY, 'worldTop and the noise settings\' declared top are the same number — one of them is wrong');
  {
    let above = 0, below = 0, top = -9999, n = 0;
    for (let zi = -120; zi <= 120; zi++) {
      for (let xi = -120; xi <= 120; xi++) {
        const h = C.height(xi * 97, zi * 89);
        n++;
        if (h >= C.worldTop) above++; else if (h < C.minY) below++; else pass++;
        if (h > top) top = h;
      }
    }
    ok(above === 0, `${above} of ${n} columns returned a height at or above the world's top (${C.worldTop})`);
    ok(below === 0, `${below} of ${n} columns returned a height below ${C.minY}`);
    ok(top === C.worldTop - 1 || top < C.worldTop, `the tallest column is y=${top}`);
  }

  // peaksAndValleys, Mojang's own formula, at the four points where its shape is decided
  const pv = C.peaksAndValleys;
  ok(Math.abs(pv(0) - -1) < 1e-6, `peaksAndValleys(0) = ${pv(0)}, expected -1`);
  ok(Math.abs(pv(2 / 3) - 1) < 1e-5, `peaksAndValleys(2/3) = ${pv(2 / 3)}, expected 1`);
  ok(Math.abs(pv(-2 / 3) - 1) < 1e-5, `peaksAndValleys(-2/3) = ${pv(-2 / 3)}, expected 1`);
  ok(Math.abs(pv(1)) < 1e-5 && Math.abs(pv(-1)) < 1e-5, 'peaksAndValleys(±1) must be 0');
  // and it must be even in weirdness — a river is a river from either side
  for (const w of [0.1, 0.35, 0.8, 0.95]) {
    ok(Math.abs(pv(w) - pv(-w)) < 1e-9, `peaksAndValleys is not even at ${w}`);
  }

  // the spline evaluator, against points typed out of noise_settings/overworld by hand.
  // The offset spline's first five continents points are flat plateaus and exact values, so
  // they can be asserted directly without any interpolation being involved.
  const at = (cont, ero, w, ridges) => C.splineAt(WG.overworld().noise.terrain_shaper.offset,
                                                  [cont, ero, w, ridges]);
  ok(Math.abs(at(-0.8, 0, 0, 0) - -0.2222) < 1e-6,
     `offset spline at continents -0.8 is ${at(-0.8, 0, 0, 0)}, the file says the -1.02..-0.51 plateau is -0.2222`);
  ok(Math.abs(at(-0.3, 0, 0, 0) - -0.12) < 1e-6,
     `offset spline at continents -0.3 is ${at(-0.3, 0, 0, 0)}, the file says the -0.44..-0.18 plateau is -0.12`);
  // between two equal-valued points with zero derivatives the Hermite blend must be FLAT
  ok(Math.abs(at(-0.7, 0, 0, 0) - at(-0.6, 0, 0, 0)) < 1e-9,
     'a plateau between two equal points with zero derivatives must be exactly flat');
  // ⚠ Outside its end points the evaluator EXTRAPOLATES along the end derivative rather than
  // clamping. The offset spline cannot demonstrate that — both its ends have derivative 0, so
  // extrapolating and clamping give the same answer there, which is exactly why a check written
  // against real data alone would pass either way. So the mechanism is asserted on a synthetic
  // node with a non-zero end derivative.
  const ramp = { coordinate: 'continents', points: [
    { location: 0, value: 0, derivative: 1 }, { location: 1, value: 1, derivative: 1 }] };
  ok(Math.abs(C.splineAt(ramp, [2, 0, 0, 0]) - 2) < 1e-9,
     `extrapolating past the last point gave ${C.splineAt(ramp, [2, 0, 0, 0])}, expected 2`);
  ok(Math.abs(C.splineAt(ramp, [-1, 0, 0, 0]) - -1) < 1e-9,
     `extrapolating before the first point gave ${C.splineAt(ramp, [-1, 0, 0, 0])}, expected -1`);
  ok(Math.abs(C.splineAt(ramp, [0.5, 0, 0, 0]) - 0.5) < 1e-9,
     'a straight ramp with matching derivatives must interpolate linearly');

  // the clamps, straight off the terrain_shaper_spline nodes in density_function/overworld
  const wild = [-5, -5, -5, -5], wildHi = [5, 5, 5, 5];
  for (const c of [wild, wildHi]) {
    ok(C.offsetAt(c) >= -0.81 && C.offsetAt(c) <= 2.5, `offset ${C.offsetAt(c)} escaped its -0.81..2.5 clamp`);
    ok(C.factorAt(c) >= 0 && C.factorAt(c) <= 8, `factor ${C.factorAt(c)} escaped its 0..8 clamp`);
    ok(C.jaggednessAt(c) >= 0 && C.jaggednessAt(c) <= 1.28, `jaggedness ${C.jaggednessAt(c)} escaped its 0..1.28 clamp`);
  }

  // half_negative, out of sloped_cheese.json
  ok(C.halfNegative(2) === 2 && C.halfNegative(-2) === -1, 'half_negative must halve only negatives');

  // #328: `jagged` read only at 4-block cell corners and lerped. Vanilla wraps sloped_cheese in
  // `interpolated` (DensityFunctions.method_41207) and ChunkNoiseSampler evaluates it only at
  // the corners of a horizontalBlockSize() = BiomeCoords.toBlock(size_horizontal 1) = 4 block
  // cell. The expected value is built from an INDEPENDENT jagged noise (own seed, own sampling),
  // so the engine's corner cache and cell arithmetic are both on trial. A different seed is
  // initialised first, so a corner cache that survives `init` shows up as a wrong height.
  const hn = (v) => (v > 0 ? v : v * 0.5);
  const jagRef = NS.Noise.fromParameters(SEED, 'jagged', WG.get('noise', 'jagged'));
  const jagCells = [];
  {
    const a = new Float64Array(6);
    for (let zi = -150; zi <= 150 && jagCells.length < 40; zi++) {
      for (let xi = -150; xi <= 150 && jagCells.length < 40; xi++) {
        const x = (xi * 613 + zi * 29) & ~3, z = (zi * 587) & ~3;
        C.climateInto(x + 1, z + 2, a);
        if (C.jaggednessAt(a) > 0.2) jagCells.push([x, z]);
      }
    }
  }
  jaggedCellFaults = (hfc) => {
    const out = [];
    const a = new Float64Array(6);
    const corner = (x, z) => hn(jagRef.get(x * 1500, 0, z * 1500));
    for (const [x0, z0] of jagCells) {
      const v00 = corner(x0, z0), v10 = corner(x0 + 4, z0), v01 = corner(x0, z0 + 4), v11 = corner(x0 + 4, z0 + 4);
      for (let dz = 0; dz < 4; dz++) for (let dx = 0; dx < 4; dx++) {
        const x = x0 + dx, z = z0 + dz, tx = dx / 4, tz = dz / 4;
        const lerp = (1 - tz) * ((1 - tx) * v00 + tx * v10) + tz * ((1 - tx) * v01 + tx * v11);
        C.climateInto(x, z, a);
        const jag = C.jaggednessAt(a);
        const want = C.terrace(C.offsetToY(C.offsetAt(a) + (jag > 0 ? jag * lerp : 0)), a[1]);
        const got = hfc(a, x, z);
        if (!(Math.abs(got - want) < 1e-9)) out.push(`(${x},${z}) height ${got}, the cell lerp of the corner jagged samples gives ${want}`);
      }
    }
    return out;
  };
  C.ready = false; C.init(SEED + 1n);
  for (const [x, z] of jagCells) for (let d = 0; d < 16; d++) C.height(x + (d & 3), z + (d >> 2));
  C.ready = false; C.init(SEED);
  ok(jagCells.length >= 20, `only ${jagCells.length} jagged cells found to test the corner sampling on`);
  const jf = jaggedCellFaults(C.heightFromClimate);
  ok(jf.length === 0, `jagged is not sampled at 4-block cell corners and lerped (${jf.length} of ${jagCells.length * 16}): ` + jf.slice(0, 3).join(' | '));
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 2. PURITY — the invariant everything leans on
console.log('2. height is byte-identical in three different sampling orders');
{
  const X0 = -512, Z0 = -512, N = 64, STEP = 13;   // 13 so the grid is not aligned to anything
  const coords = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) coords.push([X0 + i * STEP, Z0 + j * STEP]);

  // order 1: row-major
  const rowMajor = new Int32Array(N * N);
  for (let k = 0; k < coords.length; k++) rowMajor[k] = C.height(coords[k][0], coords[k][1]);

  // order 2: column-major — same points, transposed traversal
  const colMajor = new Int32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = i * N + j;
      colMajor[k] = C.height(coords[k][0], coords[k][1]);
    }
  }

  // order 3: a deterministic shuffle, with unrelated samples interleaved between them —
  // this is the one that catches a cache keyed on the wrong thing
  const shuffled = new Int32Array(N * N);
  let s = 12345;
  const order = [...coords.keys()];
  for (let i = order.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  for (const k of order) {
    C.height(999999 - k, 424242 + k);            // an unrelated column, to disturb any cache
    shuffled[k] = C.height(coords[k][0], coords[k][1]);
  }

  let diff1 = 0, diff2 = 0;
  for (let k = 0; k < N * N; k++) {
    if (rowMajor[k] !== colMajor[k]) diff1++;
    if (rowMajor[k] !== shuffled[k]) diff2++;
  }
  ok(diff1 === 0, `${diff1} of ${N * N} heights differ between row-major and column-major order`);
  ok(diff2 === 0, `${diff2} of ${N * N} heights differ when sampled shuffled and interleaved`);

  // and across a fresh init of the same seed
  C.ready = false;
  C.init(SEED);
  let diff3 = 0;
  for (let k = 0; k < N * N; k++) if (C.height(coords[k][0], coords[k][1]) !== rowMajor[k]) diff3++;
  ok(diff3 === 0, `${diff3} heights changed after re-initialising with the same seed`);

  // climate must be pure too — W5 will key biomes on it
  const a = new Float64Array(6), b = new Float64Array(6);
  let climDiff = 0;
  for (let k = 0; k < 500; k++) {
    C.climateInto(coords[k][0], coords[k][1], a);
    C.height(-77777, 88888);
    C.climateInto(coords[k][0], coords[k][1], b);
    for (let i = 0; i < 6; i++) if (a[i] !== b[i]) climDiff++;
  }
  ok(climDiff === 0, `${climDiff} climate values were not reproducible`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 3. the world it makes
console.log('3. the shape of the world, over 14,641 columns');
const stats = (() => {
  const hs = [], cont = [], ero = [];
  const a = new Float64Array(6);
  for (let x = -60000; x <= 60000; x += 997) {
    for (let z = -60000; z <= 60000; z += 997) {
      C.climateInto(x, z, a);
      cont.push(a[0]); ero.push(a[1]);
      hs.push(C.height(x, z));
    }
  }
  const q = (arr, p) => { const s = arr.slice().sort((m, n) => m - n); return s[Math.floor(p * (s.length - 1))]; };
  return { hs, cont, ero, q, n: hs.length };
})();
{
  const { hs, cont, q, n } = stats;
  const ocean = hs.filter((h) => h < C.seaLevel).length / n;
  const deep = hs.filter((h) => h < 45).length / n;
  const high = hs.filter((h) => h > 150).length / n;

  // ⚠ These bounds are the point of the calibration in src/04d_column.js and they are what a
  // future session would re-check after replacing the height curve with a measured one. They
  // are deliberately wide: the claim is "this is a Minecraft-shaped world", not "these are
  // vanilla's exact percentiles", which nothing offline can establish.
  ok(ocean > 0.30 && ocean < 0.55, `${(ocean * 100).toFixed(1)}% of the world is below sea level; a Minecraft overworld is roughly 30-55%`);
  ok(deep > 0.05, `only ${(deep * 100).toFixed(1)}% of columns are deep ocean floor (< y 45)`);
  ok(high > 0.002 && high < 0.15, `${(high * 100).toFixed(2)}% of the world is above y 150; mountains should be rare but present`);
  ok(q(hs, 0.5) > 55 && q(hs, 0.5) < 90, `the median surface is y ${q(hs, 0.5)}, expected somewhere near sea level`);
  ok(Math.max(...hs) > 180, `the highest column found was y ${Math.max(...hs)}; there are no mountains`);
  ok(Math.min(...hs) < 50, `the lowest column found was y ${Math.min(...hs)}; there is no deep ocean`);
  ok(Math.max(...hs) < C.maxY && Math.min(...hs) >= C.minY, 'a height escaped the world column');

  // the continentalness field itself must span the range vanilla's biome table is written for
  ok(q(cont, 0.01) < -0.6 && q(cont, 0.99) > 0.6,
     `continentalness only spans ${q(cont, 0.01).toFixed(2)}..${q(cont, 0.99).toFixed(2)}; the biome table needs about ±1`);

  // ocean must correlate with continentalness, or the splines are not being read
  // ⚠ Not 100%, and it should not be. A column with slightly positive continentalness and
  // very high erosion is flat, low-lying land, and some of it sits under sea level — which is
  // what a swamp or a shallow lagoon IS. The claim is that the two are strongly related, not
  // that continentalness alone decides it.
  let oceanAndLowCont = 0, oceanColumns = 0, contOcean = 0, contLand = 0, landColumns = 0;
  for (let i = 0; i < n; i++) {
    if (hs[i] < C.seaLevel) { oceanColumns++; contOcean += stats.cont[i]; if (stats.cont[i] < 0) oceanAndLowCont++; }
    else { landColumns++; contLand += stats.cont[i]; }
  }
  ok(oceanAndLowCont / oceanColumns > 0.75,
     `only ${((oceanAndLowCont / oceanColumns) * 100).toFixed(0)}% of below-sea columns have negative continentalness`);
  ok(contOcean / oceanColumns < contLand / landColumns - 0.3,
     `mean continentalness is ${(contOcean / oceanColumns).toFixed(2)} under the sea and ` +
     `${(contLand / landColumns).toFixed(2)} on land — the two are barely distinguishable`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 3b. the terrain has no preferred cliff height
console.log('3b. the step between adjacent columns has no QUANTUM (D-161)');
{
  // ⚠ THE MEASUREMENT THAT FOUND D-161 (and D-164 is why it is here as a CHECK), kept because the bug was invisible to every other
  // number in this file. Terracing (D-59) pulls heights toward multiples of eight, and its
  // strength curve landed on 0.375 for a world whose erosion is a Gaussian centred on zero —
  // so `8 * 0.375 = 3` was the jump for **95% of columns**, and the whole world was ledged in
  // identical 3-block steps. Dan reported it from play as "3 block high steps that really don't
  // happen in vanilla". The height PERCENTILES in §3 were unchanged by it: a quantum moves the
  // texture of the land, not its distribution.
  //
  // The shape of a terrain field's step distribution is monotone decay — most pairs are flat,
  // fewer differ by one, fewer still by two, and so on down. A value that BREAKS that decay is a
  // preferred cliff height, and a preferred cliff height is a machine, not a landscape. Before:
  // 0.64% at step 2 and then **1.61% back up at step 3**. After: 1.72, 0.79, 0.39, 0.21.
  const counts = new Float64Array(16);
  let pairs = 0;
  for (const [ox, oz] of [[0, 0], [12000, -9000], [-30000, 21000], [4000, 4000]]) {
    for (let x = -80; x < 80; x++) {
      let prev = null;
      for (let z = -80; z < 80; z++) {
        const h = C.height(x + ox, z + oz);
        if (prev !== null) { counts[Math.min(15, Math.abs(h - prev))]++; pairs++; }
        prev = h;
      }
    }
  }
  const pct = (d) => 100 * counts[d] / pairs;
  ok(pairs > 90000, `only ${pairs} adjacent pairs sampled`);
  ok(pct(0) > 60 && pct(0) < 95, `${pct(0).toFixed(1)}% of adjacent columns are level — that is not terrain`);
  ok(pct(1) > 3, `only ${pct(1).toFixed(2)}% of pairs step by one block — the surface is a plateau`);

  // the decay itself, from step 2 up: no value may exceed the one below it. Step 1 is exempt
  // because a slope legitimately spends most of its length at one block per column.
  let worst = null;
  for (let d = 3; d <= 8; d++) {
    if (counts[d] > counts[d - 1] && counts[d] > pairs * 0.002 && !worst) {
      worst = `${d}: ${pct(d).toFixed(2)}% against ${pct(d - 1).toFixed(2)}% at ${d - 1}`;
    }
  }
  ok(!worst, `the height-step distribution stops decaying — a preferred cliff height at step ${worst} (D-161)`);

  // and the terracing must still DO something, or the fix has thrown D-59 away rather than
  // shaping it: some of the world has to be steep.
  let steep = 0;
  for (let d = 3; d < 16; d++) steep += counts[d];
  ok(steep > pairs * 0.001, `only ${(100 * steep / pairs).toFixed(3)}% of pairs step 3 or more — nothing in this world is a cliff`);
  ok(C.terraceStrength(-1) > 0.5, 'uneroded land is not terraced at all — D-59 has been removed, not shaped');
  ok(C.terraceStrength(0) < 0.05,
     `ordinary land (erosion 0) is terraced at strength ${C.terraceStrength(0).toFixed(3)}, which is a ${(8 * C.terraceStrength(0)).toFixed(1)}-block ledge across half the world (D-161)`);
  if (PRINT) {
    console.log('   step %  ' + [0, 1, 2, 3, 4, 5, 6, 7].map((d) => d + ':' + pct(d).toFixed(2)).join('  '));
    console.log(`   terrace strength: erosion 0 -> ${C.terraceStrength(0).toFixed(3)} · -0.5 -> ${C.terraceStrength(-0.5).toFixed(3)} · -1 -> ${C.terraceStrength(-1).toFixed(3)}`);
  }
}

// ─────────────────────────────────── 3c. the height map, against VANILLA'S OWN arithmetic
console.log("3c. our surface height vs the one vanilla's shipped density function implies (D-172)");
{
  // ⚠ THE GROUND TRUTH IS IN THE REPO. `density_function/overworld/depth.json` is
  //     depth = y_clamped_gradient(-64..320, 1.5..-1.5) + terrain_shaper_spline("offset")
  // and the mean surface is where depth crosses zero, so vanilla's own offset-to-height map is
  //     y = -64 + 384 * (1.5 + offset) / 3        ( = 128 + 128 * offset )
  // That is not a guess and not a calibration: it is arithmetic on a file this project ships.
  // W3 replaced this map with a hand-fitted eight-anchor curve because deviation #1 drops
  // `base_3d_noise`, and the header of `04d_column.js` records the reason. What NOBODY had
  // checked is what the two maps actually differ BY, which is what this section measures and
  // pins so it cannot drift unnoticed.
  const vanillaY = (o) => -64 + 384 * (1.5 + o) / 3;
  const TSHAPER_OFFSET = 0.50375;         // vanilla's TerrainShaper.offset() subtracts this

  // the density function still says what this section claims it says
  const depth = MCL.WG.get('density_function', 'overworld/depth');
  ok(!!depth && depth.argument1 && depth.argument1.type === 'minecraft:y_clamped_gradient',
     'overworld/depth is no longer a y_clamped_gradient plus a spline — 3c is asserting a fiction');
  const gr = depth.argument1;
  ok(gr.from_y === -64 && gr.to_y === 320 && gr.from_value === 1.5 && gr.to_value === -1.5,
     `the depth gradient is ${gr.from_value}@${gr.from_y}..${gr.to_value}@${gr.to_y}, not vanilla's 1.5@-64..-1.5@320`);

  const probe = (cont, ero, ridge) => {
    const c = new Float64Array(6);
    c[0] = cont; c[1] = ero; c[2] = ridge; c[3] = ridge; c[4] = 0.3; c[5] = 0.5;
    return C.offsetAt(c);
  };
  // ⚠ vanilla's `TerrainShaper.offset` is `spline(p) - 0.50375`, and that subtraction lives in
  // JAVA, not in the JSON — so a port that reads the spline out of the data and stops has it
  // missing. Ours does. With the constant restored, vanilla's linear map lands on the real
  // game's heights at every landform, which is the evidence that it is a true OMISSION and not
  // part of deviation #1: ocean floor 35, deep ocean 46, plains 66, plateau 108, peaks 182.
  const sites = [['deep ocean', -1.05, 0.0, 40, 55], ['ocean', -0.8, 0.0, 28, 45],
                 ['plains', 0.3, 0.0, 60, 75], ['plateau', 0.3, -0.5, 95, 120],
                 ['mountains', 0.8, -1.0, 160, 200]];
  let worstOurs = 0;
  for (const [name, c, e, lo, hi] of sites) {
    const raw = probe(c, e, 0);
    const y = vanillaY(raw - TSHAPER_OFFSET);
    ok(y >= lo && y <= hi,
       `with vanilla's own arithmetic ${name} lands at y ${y.toFixed(0)}, outside the real game's ${lo}..${hi} — the -0.50375 story is wrong`);
    const gap = Math.abs(C.offsetToY(raw) - y);
    if (gap > worstOurs) worstOurs = gap;
    if (PRINT) console.log(`   ${name.padEnd(10)} vanilla ${y.toFixed(0).padStart(4)}   ours ${C.offsetToY(raw).toFixed(0).padStart(4)}   gap ${(C.offsetToY(raw) - y).toFixed(0).padStart(5)}`);
  }
  // ⚠ PINNED, NOT TOLERATED. This is not a fence around a bug — the deviation is deliberate and
  // documented — it is a statement of ITS SIZE, so that a change to `HEIGHT_CURVE` that quietly
  // doubles our mountains fails here. Today the two maps agree within a few blocks at sea level
  // and ours is ~37 blocks taller at the peaks. If this number moves, someone changed the
  // world's vertical scale, and that is Dan's decision to make and not a side effect.
  ok(worstOurs < 45,
     `our height map now differs from vanilla's own by up to ${worstOurs.toFixed(0)} blocks (was 37) — the calibration has drifted (D-172)`);
  ok(worstOurs > 5,
     `our height map now matches vanilla's arithmetic to within ${worstOurs.toFixed(0)} blocks — if the -0.50375 has been adopted, update this section and PLAN §18`);
  if (PRINT) console.log(`   worst disagreement ${worstOurs.toFixed(0)} blocks (pinned under 45)`);
}

// ─────────────────────────────────────────────── 4. the ASCII cross-sections
// PLAN W3's other acceptance criterion: "reviewable without a GPU".
console.log('4. ASCII cross-sections');
const sections = [];
{
  const WIDTH = 100, STEP = 24, ROWS = 24, Y0 = 20, YSTEP = 12;
  for (const [label, z] of [['z = 0', 0], ['z = 4096', 4096], ['z = -20000', -20000]]) {
    const heights = [];
    for (let i = 0; i < WIDTH; i++) heights.push(C.height((i - WIDTH / 2) * STEP, z));
    const rows = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      const yLo = Y0 + r * YSTEP, yHi = yLo + YSTEP;
      let line = '';
      for (let i = 0; i < WIDTH; i++) {
        const h = heights[i];
        if (h >= yHi) line += '#';
        else if (h >= yLo) line += '+';
        else if (C.seaLevel >= yLo && C.seaLevel < yHi) line += '~';
        else if (C.seaLevel >= yHi) line += '~';
        else line += ' ';
      }
      rows.push(String(yLo).padStart(4) + ' |' + line);
    }
    sections.push({ label, rows, heights });
  }

  for (const s of sections) {
    // a cross-section that is all one character is a cross-section of a bug
    const chars = new Set(s.rows.join('').replace(/[0-9| ]/g, '').split(''));
    ok(chars.has('#') || chars.has('+'), `${s.label}: the cross-section has no land at all`);
    ok(chars.has('~'), `${s.label}: the cross-section has no water at all`);
    const range = Math.max(...s.heights) - Math.min(...s.heights);
    ok(range > 25, `${s.label}: the whole 2.4 km line varies by only ${range} blocks`);
  }
  if (PRINT) {
    for (const s of sections) {
      console.log('');
      console.log('   ' + s.label + '   (2,400 blocks wide, one column per 24 blocks)');
      for (const r of s.rows) console.log('   ' + r);
    }
    console.log('');
  }
}
console.log(`   ${pass} ok   (run with --print to see them)`);

// ─────────────────────────────────────────────── 5. anti-vacuity (D-30)
console.log('5. anti-vacuity: break it, and it must be caught');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('shift_b sampled with the same argument order as shift_a', () => {
    // `shift_a` is offset.get(x/4, 0, z/4) and `shift_b` is offset.get(z/4, x/4, 0). Give both
    // the same argument order and the two displacements become the same number, which makes the
    // whole field symmetric under swapping x and z — every continent stretched along one
    // diagonal. So the field must NOT be symmetric, at several points, or the order is wrong.
    let asymmetric = 0, tested = 0;
    for (const [x, z] of [[1000, 3000], [-512, 7777], [64, -4096], [20000, 137]]) {
      tested++;
      if (C.climate(x, z).continents !== C.climate(z, x).continents) asymmetric++;
    }
    if (asymmetric === tested) throw 0;
  });

  check('the nested spline evaluated at its parent coordinate', () => {
    // A nested `erosion` spline inside a `continents` spline must be asked about EROSION. If it
    // were asked about continents, changing erosion alone would not change the answer.
    const base = [0.4, -0.6, 0, 0];
    const other = [0.4, 0.5, 0, 0];
    if (C.offsetAt(base) === C.offsetAt(other)) throw 0;
    // and changing ridges alone must matter too, three levels down
    if (C.offsetAt([0.4, -0.6, 0, -1]) === C.offsetAt([0.4, -0.6, 0, 1])) throw 0;
    throw 0;
  });

  check('the jaggedness term dropped', () => {
    // jaggedness is what makes peaks spiky. Find a column where the spline says jaggedness is
    // non-zero and require the jagged noise to actually move the height there.
    const a = new Float64Array(6);
    let found = false;
    for (let x = 0; x < 40000 && !found; x += 311) {
      C.climateInto(x, 0, a);
      if (C.jaggednessAt(a) > 0.2) {
        const withJag = C.heightFromClimate(a, x, 0);
        const noJag = C.terrace(C.offsetToY(C.offsetAt(a)), a[1]);
        if (Math.abs(withJag - noJag) > 0.5) found = true;
      }
    }
    if (found) throw 0;
  });

  check('terracing that does nothing', () => {
    // D-59's whole point. At erosion -1 the pull must be strong and at +1 absent.
    if (C.terraceStrength(-1) < 0.5) throw 0;
    if (C.terraceStrength(1) > 1e-9) throw 0;
    if (C.terrace(100.4, -1) === 100.4) throw 0;      // it must move a height
    if (C.terrace(100.4, 1) !== 100.4) throw 0;       // and leave eroded land alone
    throw 0;
  });

  check('a height clamped to the data file instead of to the world', () => {
    // The bug this file's worldTop assertion exists for, reproduced: clamping to `maxY` — the
    // 320 vanilla's noise settings declare — instead of to the 256 MC-Lite's world actually
    // has. Two columns in 160,801 come out above 255 on seed 1337, so a check that samples a
    // small neighbourhood would never see it.
    let above = 0;
    for (let zi = -200; zi <= 200; zi++) {
      for (let xi = -200; xi <= 200; xi++) {
        const a = new Float64Array(6);
        C.climateInto(xi * 97, zi * 89, a);
        let y = Math.floor(C.heightFromClimate(a, xi * 97, zi * 89));
        y = y < C.minY ? C.minY : (y >= C.maxY ? C.maxY - 1 : y);     // the WRONG clamp
        if (y >= C.worldTop) above++;
      }
    }
    if (above === 0) return;      // NOT caught — the sample is too small to prove anything
    throw 0;
  });

  check('the height curve made flat', () => {
    // If the offset-to-height map lost its slope, every column would come out the same and
    // section 3's percentiles would collapse. Assert the map is strictly increasing across its
    // whole domain, which is the property section 3 depends on.
    let increasing = true;
    for (let o = -1; o < 2.6; o += 0.05) if (C.offsetToY(o + 0.05) <= C.offsetToY(o)) increasing = false;
    if (!increasing) throw 0;
    if (C.offsetToY(-0.222) >= C.seaLevel) throw 0;   // deep ocean is below sea level
    if (C.offsetToY(0.5) <= 120) throw 0;             // and mountains are mountains
    throw 0;
  });

  // #328: the bug as it was — jagged read at every block — and a cell of the wrong size
  const hn = (v) => (v > 0 ? v : v * 0.5);
  const jagRef = NS.Noise.fromParameters(SEED, 'jagged', WG.get('noise', 'jagged'));
  const withJagged = (term) => (a, x, z) => {
    const jag = C.jaggednessAt(a);
    return C.terrace(C.offsetToY(C.offsetAt(a) + (jag > 0 ? jag * term(x, z) : 0)), a[1]);
  };
  check('jagged sampled at every block (#328)', () => {
    if (jaggedCellFaults(withJagged((x, z) => hn(jagRef.get(x * 1500, 0, z * 1500)))).length) throw 0;
  });
  check('jagged lerped across an 8-block cell instead of 4 (#328)', () => {
    const corner = (x, z) => hn(jagRef.get(x * 1500, 0, z * 1500));
    if (jaggedCellFaults(withJagged((x, z) => {
      const x0 = Math.floor(x / 8) * 8, z0 = Math.floor(z / 8) * 8, tx = (x - x0) / 8, tz = (z - z0) / 8;
      return (1 - tz) * ((1 - tx) * corner(x0, z0) + tx * corner(x0 + 8, z0)) + tz * ((1 - tx) * corner(x0, z0 + 8) + tx * corner(x0 + 8, z0 + 8));
    })).length) throw 0;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

// ─────────────────────────────────────── 6. the world types (#329, vanilla GeneratorType)
// `GeneratorType.LARGE_BIOMES` / `AMPLIFIED` are `ChunkGeneratorSettings.LARGE_BIOMES` /
// `AMPLIFIED`: the same generator reading other data. Proven here against the SOURCE, not
// against `amplified.json`, so the data file and the selection are both on trial:
//   * amplified. `VanillaTerrainParameters.createSurfaceParameters(true)` hands each
//     `Spline.builder` an amplifier and `Builder.add(loc, float, deriv)` applies it to the
//     CONSTANT — per spline point, not to the finished value (so `offsetAt` is not simply 2x the
//     default wherever it is positive: a point interpolated between a negative and a positive
//     constant is not). The expected tree is the DEFAULT tree with every leaf put through
//     `method_39534` (offset: v<0 ? v : 2v), `method_39536` (jaggedness: 2v) and `method_39535`
//     (factor: 1.25 - 6.25/(v+5)) — except the factor spline's first two continents points
//     (-0.19 -> 3.95 and -0.15 -> buildErosionFactorSpline(6.25, true, IDENTITY)), which are
//     built with `field_35673`, the identity (VanillaTerrainParameters lines 80-82).
//   * large biomes. `DensityFunctions.method_41209(shape, true)` swaps continents, erosion,
//     temperature and vegetation to `continentalness_large` / `erosion_large` /
//     `temperature_large` / `vegetation_large` (NoiseParametersKeys lines 15-18), each seeded by
//     its own id; the ridge (weirdness) noise and the shift are unchanged.
console.log('6. world types: amplified and large biomes (#329)');
{
  const f32 = Math.fround;
  const AMP = {
    offset: (v) => (v < 0 ? v : f32(v * 2)),
    factor: (v) => f32(1.25 - f32(6.25 / f32(v + 5))),
    jaggedness: (v) => f32(v * 2),
  };
  const amplify = (node, fn) => (typeof node === 'number' ? fn(node) : {
    coordinate: node.coordinate,
    points: node.points.map((p) => ({ location: p.location, derivative: p.derivative, value: amplify(p.value, fn) })),
  });
  const ow = WG.get('noise_settings', 'overworld').noise.terrain_shaper;
  const expectShaper = {
    offset: amplify(ow.offset, AMP.offset),
    jaggedness: amplify(ow.jaggedness, AMP.jaggedness),
    factor: { coordinate: ow.factor.coordinate, points: ow.factor.points.map((p, i) => (
      { location: p.location, derivative: p.derivative, value: i < 2 ? p.value : amplify(p.value, AMP.factor) })) },
  };
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const LIMITS = { offset: [-0.81, 2.5], factor: [0, 8], jaggedness: [0, 1.28] };
  const expectAt = (k, tree, c) => clamp(C.splineAt(tree[k], c), LIMITS[k][0], LIMITS[k][1]);

  // one fixed set of climate vectors, sampled from the DEFAULT world, reused for every type
  C.init(SEED);
  const vecs = [];
  for (let i = 0; i < 1500; i++) {
    const a = new Float64Array(6);
    C.climateInto((i % 39) * 1543 - 30000, ((i / 39) | 0) * 1601 - 30000, a);
    vecs.push(a);
  }
  const defaultClim = vecs.map((a) => Array.from(a));

  // an independent sampler for large biomes: the shift from `offset`, the field from the named noise
  const N = NS.Noise;
  const noiseOf = (id) => N.fromParameters(SEED, id, WG.get('noise', id));
  const offN = noiseOf('offset');
  const fieldAt = (n, x, z) => {
    const sx = offN.get(x * 0.25, 0, z * 0.25) * 4, sz = offN.get(z * 0.25, x * 0.25, 0) * 4;
    return n.get(x * 0.25 + sx, 0, z * 0.25 + sz);
  };
  const LARGE = { 0: noiseOf('continentalness_large'), 1: noiseOf('erosion_large'),
                  4: noiseOf('temperature_large'), 5: noiseOf('vegetation_large') };

  /** every world-type property; returns the list of what is wrong (empty = right) */
  function worldTypeFaults() {
    const bad = [];
    const TOL = 1e-6;
    // default: an absent type is 'default', which is `noise_settings/overworld` untouched
    C.init(SEED);
    if (C.worldType !== 'default' || C.settingsName !== 'overworld') bad.push(`init(seed) chose ${C.worldType}/${C.settingsName}`);
    for (let i = 0; i < vecs.length; i += 7) {
      if (Math.abs(C.offsetAt(vecs[i]) - expectAt('offset', ow, vecs[i])) > TOL) { bad.push('default offset is not the overworld spline'); break; }
    }

    // amplified
    C.init(SEED, 'amplified');
    if (C.worldType !== 'amplified' || C.settingsName !== 'amplified') bad.push(`init(seed, 'amplified') chose ${C.worldType}/${C.settingsName}`);
    const n = { offset: 0, factor: 0, jaggedness: 0 };
    let doubled = 0, posLeafCols = 0, negSame = 0, negCols = 0;
    for (const c of vecs) {
      for (const k of ['offset', 'factor', 'jaggedness']) {
        const got = C[k + 'At'](c), want = expectAt(k, expectShaper, c);
        if (Math.abs(got - want) > TOL) { if (n[k]++ < 2) bad.push(`amplified ${k} ${got} != source ${want}`); }
      }
    }
    // the issue's own reading, where it IS exact: a climate whose continents sit ON a top-level
    // spline point with a positive constant gives 2x, a negative one is unchanged
    for (const p of ow.offset.points) {
      if (typeof p.value !== 'number') continue;
      const c = [p.location, 0, 0, 0];
      const d = clamp(p.value, -0.81, 2.5), a = C.offsetAt(c);
      if (p.value > 0) { posLeafCols++; if (Math.abs(a - clamp(2 * p.value, -0.81, 2.5)) < TOL) doubled++; }
      else { negCols++; if (Math.abs(a - d) < TOL) negSame++; }
    }
    if (posLeafCols === 0 || doubled !== posLeafCols) bad.push(`amplified offset doubled ${doubled}/${posLeafCols} positive spline constants`);
    if (negCols === 0 || negSame !== negCols) bad.push(`amplified offset changed ${negCols - negSame}/${negCols} negative spline constants`);
    const hs = { d: 0, a: 0 };
    C.init(SEED);
    for (let i = 0; i < 400; i++) hs.d = Math.max(hs.d, C.height((i % 20) * 900, ((i / 20) | 0) * 900));
    C.init(SEED, 'amplified');
    for (let i = 0; i < 400; i++) hs.a = Math.max(hs.a, C.height((i % 20) * 900, ((i / 20) | 0) * 900));
    if (!(hs.a > hs.d)) bad.push(`amplified's highest column ${hs.a} is not above the default's ${hs.d}`);

    // large biomes
    C.init(SEED, 'large_biomes');
    if (C.worldType !== 'large_biomes' || C.settingsName !== 'large_biomes') bad.push(`init(seed, 'large_biomes') chose ${C.worldType}/${C.settingsName}`);
    const a = new Float64Array(6);
    let wrong = 0, sameAsDefault = 0, ridgeMoved = 0;
    for (let i = 0; i < 300; i++) {
      const x = (i % 39) * 1543 - 30000, z = ((i / 39) | 0) * 1601 - 30000;
      C.climateInto(x, z, a);
      for (const k of [0, 1, 4, 5]) {
        if (Math.abs(a[k] - fieldAt(LARGE[k], x, z)) > 1e-12) wrong++;
        if (a[k] === defaultClim[i][k]) sameAsDefault++;
      }
      if (a[2] !== defaultClim[i][2]) ridgeMoved++;
    }
    if (wrong) bad.push(`large biomes: ${wrong} climate values are not the _large noises`);
    if (sameAsDefault > 10) bad.push(`large biomes: ${sameAsDefault} climate values equal the default world's`);
    if (ridgeMoved) bad.push(`large biomes moved the ridge noise at ${ridgeMoved} columns (vanilla keeps it)`);
    for (const k of ['offset', 'factor', 'jaggedness']) {
      if (Math.abs(C[k + 'At'](vecs[3]) - expectAt(k, ow, vecs[3])) > TOL) bad.push(`large biomes ${k} is not the overworld spline`);
    }
    let threw = false;
    try { C.init(SEED, 'superflat'); } catch { threw = true; }
    if (!threw) bad.push('an unknown world type was accepted');
    C.init(SEED);
    return bad;
  }

  const faults = worldTypeFaults();
  ok(faults.length === 0, 'world types: ' + faults.slice(0, 4).join(' | '));
  for (const f of faults.slice(0, 8)) console.log('   ✗ ' + f);

  // anti-vacuity: break each half the way the bug looked, and the list must not come back empty
  const brk = [];
  const breakWith = (label, install, uninstall) => {
    install();
    let f;
    try { C.ready = false; f = worldTypeFaults(); } catch (e) { f = ['threw ' + (e && e.message)]; }
    uninstall(); C.ready = false; C.init(SEED);
    brk.push([label, f.length > 0]);
  };
  const realGet = WG.get, realFrom = N.fromParameters;
  breakWith('amplifier not applied (amplified reads noise_settings/overworld)',
    () => { WG.get = (r, n) => realGet(r, r === 'noise_settings' && n === 'amplified' ? 'overworld' : n); },
    () => { WG.get = realGet; });
  breakWith('factor amplifier also applied to the identity-built points (-0.19, -0.15)',
    () => { WG.get = (r, n) => { const v = realGet(r, n); if (!(r === 'noise_settings' && n === 'amplified')) return v;
      const o = JSON.parse(JSON.stringify(v));
      o.noise.terrain_shaper.factor = amplify(ow.factor, AMP.factor);
      return o; }; },
    () => { WG.get = realGet; });
  breakWith('large biomes samples the default continentalness/erosion/temperature/vegetation',
    () => { N.fromParameters = (s, id, p) => { const d = id.replace(/_large$/, ''); return realFrom(s, d, realGet('noise', d)); }; },
    () => { N.fromParameters = realFrom; });
  breakWith('large noises seeded by the default id',
    () => { N.fromParameters = (s, id, p) => realFrom(s, id.replace(/_large$/, ''), p); },
    () => { N.fromParameters = realFrom; });
  for (const [label, caught] of brk) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

const { hs, q } = stats;
console.log('');
console.log('  surface height over 14,641 columns spanning 120 km:');
console.log('    p1 ' + q(hs, 0.01) + '   p10 ' + q(hs, 0.1) + '   p25 ' + q(hs, 0.25) +
            '   p50 ' + q(hs, 0.5) + '   p75 ' + q(hs, 0.75) + '   p90 ' + q(hs, 0.9) +
            '   p99 ' + q(hs, 0.99) + '   max ' + Math.max(...hs));
console.log('    below sea level: ' + (100 * hs.filter((h) => h < C.seaLevel).length / hs.length).toFixed(1) + '%');

console.log('');
console.log('================ colcheck =================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
