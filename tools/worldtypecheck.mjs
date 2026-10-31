#!/usr/bin/env node
// worldtypecheck.mjs — #10623: the 'large_biomes' and 'amplified' world types, on their own stage.
//
//   node tools/worldtypecheck.mjs
//
// Expected values are rebuilt independently from vanilla 1.18.2's source arithmetic
// (VanillaTerrainParameters amplifier, DensityFunctions.method_41209 large noises) and compared
// with Column.init(seed, worldType); four deliberate breaks must each be caught (D-30).
// The same section also runs inside colcheck §6; this is the stand-alone stage.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src';
const ASSETS = MCLITE_ROOT + 'assets';

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
C.init(SEED);

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

console.log('');
console.log('================ worldtypecheck =================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
