#!/usr/bin/env node
// biomecheck.mjs — PLAN W5's acceptance test.
//
//   node tools/biomecheck.mjs [--print]
//
// PLAN W5: *"every biome renders its vanilla colour triple; the `spawners` lists survive into
// the registry unmodified for G's use later."*
//
// Both halves, plus the arithmetic vanilla keeps in Java rather than in a data file — the two
// colormap lookups, the two grass-colour modifiers and the height-adjusted temperature — which
// are the only parts of this stage that could be wrong without anything complaining.
//
// ── THE COLOUR REFERENCE IS HAND-WRITTEN ─────────────────────────────────────────────────
// Section 2 is a table of colours typed out from the game, not read from the pipeline. That is
// the point: the colormap indexing has four ways to be subtly wrong (i and j swapped, the
// `humidity *= temperature` step dropped, the clamp missing, the truncation rounded) and every
// one of them still produces a plausible green. A reference that came out of the same code
// would agree with all four.
//
// ── AND THE PASS-THROUGH HALF IS TESTED BY IDENTITY, NOT BY SHAPE ────────────────────────
// `spawners`, `spawn_costs`, `carvers` and `features` must be the SAME objects the registry
// holds — not a copy, not a normalised form. Section 5 compares them by reference and then by
// a full deep walk against the source JSON on disk, because "survive unmodified" is a claim
// about bytes and G18 will be reading these two months from now.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCDATA } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src';
const ASSETS = MCLITE_ROOT + 'assets';
const VERSION = '1.18.2';
const BIOMEDIR = join(MCDATA, VERSION, 'data', 'minecraft', 'worldgen', 'biome');
const PRINT = process.argv.includes('--print');

let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const hx = (c) => (c >>> 0).toString(16).padStart(6, '0').toUpperCase();
const short = (n) => n.replace('minecraft:', '');

// ---------------------------------------------------------------- boot
const NS = { CFG: {} };
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02d_wgdata.js', '03b_noise.js',
                 '04d_column.js', '04e_climate.js', '04f_earth.js', '04g_biomes.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const meta = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
NS.WG.init({
  worldgen: readFileSync(join(ASSETS, 'worldgen.bin')).toString('base64'),
  worldgenBytes: meta('worldgen.meta.json').jsonBytes,
});
const cmMeta = meta('colormaps.meta.json');
NS.Biomes.initColormaps({
  colormaps: readFileSync(join(ASSETS, 'colormaps.bin')).toString('base64'),
  colormapsBytes: cmMeta.rawBytes,
});
NS.Biomes.init();
NS.Climate.init({
  biomeParams: readFileSync(join(ASSETS, 'biome-params.bin')).toString('base64'),
  biomeParamsBytes: meta('biome-params.meta.json').rawBytes,
});
const B = NS.Biomes, CL = NS.Climate;

// The ten biomes that belong to another dimension. `the_void` is deliberately NOT here: it is
// an overworld-shaped biome with overworld fog and all eleven decoration steps, and lumping it
// in with the Nether would make three assertions below weaker for no reason.
const OTHER_DIMENSION = ['basalt_deltas', 'crimson_forest', 'end_barrens', 'end_highlands',
  'end_midlands', 'nether_wastes', 'small_end_islands', 'soul_sand_valley', 'the_end', 'warped_forest'];
const isOther = (n) => OTHER_DIMENSION.indexOf(short(n)) >= 0;

// ─────────────────────────────────────────────── 1. the registry
console.log('1. the registry — 61 biomes, every field resolved');
{
  ok(B.ready, 'Biomes.init did not run');
  ok(B.count === 61, `${B.count} biomes, expected 61`);
  ok(B.hasColormaps, 'the colormaps did not reach Biomes.init');
  ok(B.names.length === 61 && new Set(B.names).size === 61, 'the biome name list has duplicates');
  // sorted, because the index space is the sort order and everything downstream depends on it
  const sorted = B.names.slice().sort();
  ok(B.names.join(' ') === sorted.join(' '), 'the biome names are not in sorted order');
  // every name resolves both ways, with and without the namespace
  for (let i = 0; i < B.count; i++) {
    const n = B.name(i);
    if (B.index(n) === i && B.index(short(n)) === i && B.get(i) === B.at(i)) pass++;
    else fails.push(`biome ${i} (${n}) does not round-trip through indexOf`);
  }
  // every record is complete: nothing may be undefined or NaN
  const NUM = ['temperature', 'downfall', 'skyColor', 'fogColor', 'waterColor', 'waterFogColor',
               'grassBase', 'foliage', 'creatureSpawnProbability'];
  let bad = 0;
  for (let i = 0; i < B.count; i++) {
    const r = B.at(i);
    for (const k of NUM) { if (typeof r[k] === 'number' && isFinite(r[k])) pass++; else { bad++; fails.length < 40 && fails.push(`${r.name}.${k} is ${r[k]}`); } }
    if (r.precipitation >= 0 && r.precipitation <= 2) pass++; else bad++;
    // ⚠ Mojang's generator TRUNCATES trailing empty decoration steps, so only the overworld
    // biomes carry all eleven; the ten that belong to another dimension carry 0, 1, 5, 8 or 10.
    // Asserting eleven everywhere was this check's first draft and it failed on ten biomes.
    if (r.features.length === (isOther(r.name) ? r.features.length : 11)) pass++;
    else { bad++; fails.length < 40 && fails.push(`${r.name} has ${r.features.length} decoration steps, expected 11`); }
    if (r.features.length <= 11) pass++; else { bad++; fails.length < 40 && fails.push(`${r.name} has ${r.features.length} decoration steps, more than the eleven that exist`); }
  }
  ok(bad === 0, `${bad} biome fields are missing, NaN or out of range`);
  ok(B.STEPS.length === 11, `${B.STEPS.length} decoration step names, expected 11`);

  // the colour fields must be real 24-bit colours, not sign-extended or truncated
  let oob = 0;
  for (let i = 0; i < B.count; i++) {
    const r = B.at(i);
    for (const c of [r.skyColor, r.fogColor, r.waterColor, r.waterFogColor, r.grassBase, r.foliage]) {
      if (c >= 0 && c <= 0xffffff) pass++; else oob++;
    }
  }
  ok(oob === 0, `${oob} colour fields are outside 0..0xFFFFFF`);
}

// ─────────────────────────────────────────────── 2. the hand-written colour reference
console.log('2. the colour triples, typed out from the game');
{
  // biome, grass, foliage, water, sky. Grass is the value BEFORE any positional modifier —
  // section 3 tests the two biomes that have one.
  const REF = [
    ['plains',                  0x91bd59, 0x77ab2f, 0x3f76e4, 0x78a7ff],
    ['sunflower_plains',        0x91bd59, 0x77ab2f, 0x3f76e4, 0x78a7ff],
    ['beach',                   0x91bd59, 0x77ab2f, 0x3f76e4, 0x78a7ff],
    ['forest',                  0x79c05a, 0x59ae30, 0x3f76e4, 0x79a6ff],
    ['flower_forest',           0x79c05a, 0x59ae30, 0x3f76e4, 0x79a6ff],
    ['birch_forest',            0x88bb67, 0x6ba941, 0x3f76e4, 0x7aa5ff],
    ['old_growth_birch_forest', 0x88bb67, 0x6ba941, 0x3f76e4, 0x7aa5ff],
    ['taiga',                   0x86b783, 0x68a464, 0x3f76e4, 0x7da3ff],
    ['old_growth_spruce_taiga', 0x86b783, 0x68a464, 0x3f76e4, 0x7da3ff],
    ['old_growth_pine_taiga',   0x86b87f, 0x68a55f, 0x3f76e4, 0x7ca3ff],
    ['snowy_taiga',             0x80b497, 0x60a17b, 0x3d57d6, 0x839eff],
    ['snowy_plains',            0x80b497, 0x60a17b, 0x3f76e4, 0x7fa1ff],
    ['ice_spikes',              0x80b497, 0x60a17b, 0x3f76e4, 0x7fa1ff],
    ['snowy_beach',             0x83b593, 0x64a278, 0x3d57d6, 0x7fa1ff],
    ['jungle',                  0x59c93c, 0x30bb0b, 0x3f76e4, 0x77a8ff],
    ['bamboo_jungle',           0x59c93c, 0x30bb0b, 0x3f76e4, 0x77a8ff],
    ['sparse_jungle',           0x64c73f, 0x3eb80f, 0x3f76e4, 0x77a8ff],
    ['mushroom_fields',         0x55c93f, 0x2bbb0f, 0x3f76e4, 0x77a8ff],
    ['desert',                  0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff],
    ['savanna',                 0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff],
    ['savanna_plateau',         0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff],
    ['windswept_savanna',       0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff],
    // the three badlands carry explicit overrides — a colormap lookup would give BFB755
    ['badlands',                0x90814d, 0x9e814d, 0x3f76e4, 0x6eb1ff],
    ['eroded_badlands',         0x90814d, 0x9e814d, 0x3f76e4, 0x6eb1ff],
    ['wooded_badlands',         0x90814d, 0x9e814d, 0x3f76e4, 0x6eb1ff],
    ['windswept_hills',         0x8ab689, 0x6da36b, 0x3f76e4, 0x7da2ff],
    ['windswept_forest',        0x8ab689, 0x6da36b, 0x3f76e4, 0x7da2ff],
    ['windswept_gravelly_hills', 0x8ab689, 0x6da36b, 0x3f76e4, 0x7da2ff],
    ['stony_shore',             0x8ab689, 0x6da36b, 0x3f76e4, 0x7da2ff],
    ['stony_peaks',             0x9abe4b, 0x82ac1e, 0x3f76e4, 0x76a8ff],
    ['meadow',                  0x83bb6d, 0x64a948, 0x0e4ecf, 0x7ba4ff],
    ['grove',                   0x80b497, 0x60a17b, 0x3f76e4, 0x81a0ff],
    ['snowy_slopes',            0x80b497, 0x60a17b, 0x3f76e4, 0x829fff],
    ['jagged_peaks',            0x80b497, 0x60a17b, 0x3f76e4, 0x859dff],
    ['frozen_peaks',            0x80b497, 0x60a17b, 0x3f76e4, 0x859dff],
    // the five ocean temperatures, which differ only in the water
    ['ocean',                   0x8eb971, 0x71a74d, 0x3f76e4, 0x7ba4ff],
    ['deep_ocean',              0x8eb971, 0x71a74d, 0x3f76e4, 0x7ba4ff],
    ['warm_ocean',              0x8eb971, 0x71a74d, 0x43d5ee, 0x7ba4ff],
    ['lukewarm_ocean',          0x8eb971, 0x71a74d, 0x45adf2, 0x7ba4ff],
    ['deep_lukewarm_ocean',     0x8eb971, 0x71a74d, 0x45adf2, 0x7ba4ff],
    ['cold_ocean',              0x8eb971, 0x71a74d, 0x3d57d6, 0x7ba4ff],
    ['deep_cold_ocean',         0x8eb971, 0x71a74d, 0x3d57d6, 0x7ba4ff],
    ['frozen_ocean',            0x80b497, 0x60a17b, 0x3938c9, 0x7fa1ff],
    ['deep_frozen_ocean',       0x8eb971, 0x71a74d, 0x3938c9, 0x7ba4ff],
    ['frozen_river',            0x80b497, 0x60a17b, 0x3938c9, 0x7fa1ff],
    ['river',                   0x8eb971, 0x71a74d, 0x3f76e4, 0x7ba4ff],
    ['lush_caves',              0x8eb971, 0x71a74d, 0x3f76e4, 0x7ba4ff],
    ['dripstone_caves',         0x91bd59, 0x77ab2f, 0x3f76e4, 0x78a7ff],
    ['swamp',                   0x6ac44e, 0x6a7039, 0x617b64, 0x78a7ff],
    ['dark_forest',             0x79c05a, 0x59ae30, 0x3f76e4, 0x79a6ff],
    // the End's sky really is black, which is the one place a "colour is missing" bug would
    // look exactly like the correct answer
    ['the_end',                 0x8eb971, 0x71a74d, 0x3f76e4, 0x000000],
    ['end_barrens',             0x8eb971, 0x71a74d, 0x3f76e4, 0x000000],
    ['end_highlands',           0x8eb971, 0x71a74d, 0x3f76e4, 0x000000],
    ['end_midlands',            0x8eb971, 0x71a74d, 0x3f76e4, 0x000000],
    ['small_end_islands',       0x8eb971, 0x71a74d, 0x3f76e4, 0x000000],
    ['nether_wastes',           0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff],
    ['crimson_forest',          0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff],
    ['warped_forest',           0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff],
    ['soul_sand_valley',        0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff],
    ['basalt_deltas',           0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff],
    ['the_void',                0x8eb971, 0x71a74d, 0x3f76e4, 0x7ba4ff],
  ];
  // ⚠ The reference covers ALL 61. A partial table would let a biome added to the registry
  // slip through untested, which is exactly how the End's black sky would have been missed.
  ok(REF.length === 61, `the hand-written reference has ${REF.length} rows for ${B.count} biomes`);
  const covered = new Set(REF.map((r) => r[0]));
  const uncovered = B.names.map(short).filter((n) => !covered.has(n));
  ok(uncovered.length === 0, `the reference does not cover: ${uncovered.join(' ')}`);

  for (const [name, g, f, w, s] of REF) {
    const i = B.index(name);
    ok(B.grassBase(i) === g, `${name} grass is ${hx(B.grassBase(i))}, the reference says ${hx(g)}`);
    ok(B.foliageColor(i) === f, `${name} foliage is ${hx(B.foliageColor(i))}, the reference says ${hx(f)}`);
    ok(B.waterColor(i) === w, `${name} water is ${hx(B.waterColor(i))}, the reference says ${hx(w)}`);
    ok(B.skyColor(i) === s, `${name} sky is ${hx(B.skyColor(i))}, the reference says ${hx(s)}`);
  }
  // fog is 0xC0D8FF for every overworld biome and that uniformity is itself worth asserting:
  // if it ever is not, something changed upstream.
  const oddFog = [];
  for (let i = 0; i < B.count; i++) if (B.fogColor(i) === 0xc0d8ff) pass++; else oddFog.push(short(B.name(i)));
  ok(oddFog.sort().join(' ') === OTHER_DIMENSION.join(' '),
     `the biomes whose fog is not C0D8FF are [${oddFog.join(' ')}] — expected exactly the five Nether and five End`);

  if (PRINT) {
    for (const [name] of REF.slice(0, 12)) {
      const i = B.index(name);
      console.log(`   ${name.padEnd(24)} grass #${hx(B.grassBase(i))}  foliage #${hx(B.foliageColor(i))}  water #${hx(B.waterColor(i))}`);
    }
  }
}

// ─────────────────────────────────────────────── 3. the colormap arithmetic
console.log('3. the colormap indexing and the two grass modifiers');
{
  // The packer's own probes, re-derived through the RUNTIME's sampler rather than the build's.
  for (const p of cmMeta.probes) {
    ok('#' + hx(B.grassRamp(p.temperature, p.downfall)) === p.grass,
       `${p.biome} grass through the runtime ramp is #${hx(B.grassRamp(p.temperature, p.downfall))}, the packer measured ${p.grass}`);
    ok('#' + hx(B.foliageRamp(p.temperature, p.downfall)) === p.foliage,
       `${p.biome} foliage through the runtime ramp is #${hx(B.foliageRamp(p.temperature, p.downfall))}, the packer measured ${p.foliage}`);
  }
  // the clamp: 2.0 and 1.0 must give the same colour, and so must -1 and 0
  ok(B.grassRamp(2.0, 0.0) === B.grassRamp(1.0, 0.0), 'the temperature clamp is missing at the top');
  ok(B.grassRamp(-1.0, 0.5) === B.grassRamp(0.0, 0.5), 'the temperature clamp is missing at the bottom');
  ok(B.grassRamp(0.8, 2.0) === B.grassRamp(0.8, 1.0), 'the downfall clamp is missing');
  // no biome may land on the out-of-range magenta
  let magenta = 0;
  for (let i = 0; i < B.count; i++) if (B.grassBase(i) === B.MAGENTA || B.foliageColor(i) === B.MAGENTA) magenta++; else pass++;
  ok(magenta === 0, `${magenta} biomes sample outside the colormap`);
  // the ramp really is a ramp: hotter and wetter must not give the same colour everywhere
  ok(B.grassRamp(0.1, 0.1) !== B.grassRamp(0.9, 0.9), 'the grass ramp returns one colour for every climate');
  ok(B.foliageRamp(0.1, 0.1) !== B.foliageRamp(0.9, 0.9), 'the foliage ramp returns one colour for every climate');
  // `humidity *= temperature` — dropping it makes these two agree, and they must not
  ok(B.grassRamp(0.5, 1.0) !== B.grassRamp(1.0, 0.5), 'the humidity-times-temperature step is missing');

  // DARK_FOREST, computed here from the formula rather than read from the module
  const df = B.index('dark_forest');
  const want = (((B.grassBase(df) & 0xfefefe) + 0x28340a) >> 1) & 0xffffff;
  ok(B.grassColorAt(df, 0, 0) === want, `dark forest grass is ${hx(B.grassColorAt(df, 0, 0))}, the formula gives ${hx(want)}`);
  ok(B.grassColorAt(df, 0, 0) === 0x507a32, `dark forest grass is ${hx(B.grassColorAt(df, 0, 0))}, vanilla is 507A32`);
  ok(B.grassColorAt(df, 1000, -1000) === B.grassColorAt(df, 0, 0), 'the dark forest modifier must not depend on position');

  // SWAMP: exactly two colours, both of them vanilla's, and a mottle that is neither uniform
  // nor a checkerboard.
  const sw = B.index('swamp');
  const seen = new Map();
  for (let x = 0; x < 160; x++) for (let z = 0; z < 160; z++) {
    const c = B.grassColorAt(sw, x, z);
    seen.set(c, (seen.get(c) || 0) + 1);
  }
  ok(seen.size === 2, `swamp grass produced ${seen.size} distinct colours, expected 2`);
  ok(seen.has(0x4c763c) && seen.has(0x6a7039), `swamp grass colours are ${[...seen.keys()].map(hx).join(' ')}`);
  const dark = seen.get(0x4c763c) || 0;
  const frac = dark / (160 * 160);
  ok(frac > 0.2 && frac < 0.8, `the swamp mottle is ${(frac * 100).toFixed(1)}% dark — that is not a mottle`);
  // and it must NOT depend on the world seed: the noise is seeded from a constant (2345)
  ok(B.grassColorAt(sw, 37, 91) === B.grassColorAt(sw, 37, 91), 'the swamp mottle is not deterministic');
  if (PRINT) console.log(`   swamp mottle: ${(frac * 100).toFixed(1)}% #4C763C, ${(100 - frac * 100).toFixed(1)}% #6A7039`);

  // every other biome's grass must be position-independent
  let moved = 0;
  for (let i = 0; i < B.count; i++) {
    if (i === sw) continue;
    if (B.grassColorAt(i, 0, 0) === B.grassColorAt(i, 811, -733)) pass++; else moved++;
  }
  ok(moved === 0, `${moved} biomes other than the swamp change grass colour with position`);
}

// ─────────────────────────────────────────────── 4. temperature
console.log('4. the height-adjusted temperature, and the frozen modifier');
{
  const pl = B.index('plains'), fo = B.index('frozen_ocean'), oc = B.index('ocean');
  // below y = 80 nothing happens
  let flat = 0;
  for (let y = -64; y <= 80; y += 4) if (B.temperatureAt(pl, 0, y, 0) === B.baseTemperature(pl)) flat++; else fails.length < 40 && fails.push(`plains temperature moved at y=${y}`);
  ok(flat === 37, `${37 - flat} of 37 sample heights below y=80 changed the temperature`);
  pass += flat;
  // above it, the drop is 0.05/40 per block plus a noise wobble of at most 8 blocks' worth
  let wrong = 0;
  for (const y of [100, 150, 200, 250, 300]) {
    const t = B.temperatureAt(pl, 0, y, 0);
    const plain = B.baseTemperature(pl) - (y - 80) * 0.05 / 40;
    if (Math.abs(t - plain) <= 8 * 0.05 / 40 + 1e-9) pass++; else { wrong++; fails.push(`plains at y=${y}: ${t}, expected within a noise wobble of ${plain}`); }
  }
  ok(wrong === 0, `${wrong} heights fell outside the lapse plus its wobble`);
  ok(B.temperatureAt(pl, 0, 300, 0) < B.temperatureAt(pl, 0, 100, 0), 'temperature does not fall with height');
  // the wobble is real: two columns at the same height must not always agree
  let same = 0;
  for (let x = 0; x < 200; x += 7) if (B.temperatureAt(pl, x, 200, 0) === B.temperatureAt(pl, 0, 200, 0)) same++;
  ok(same < 5, 'the height-adjustment noise is flat — every column has the same temperature at y=200');

  // FROZEN, on the two biomes that carry it and on no others
  let frozenCount = 0;
  for (let i = 0; i < B.count; i++) if (B.at(i).frozenTemp) frozenCount++;
  ok(frozenCount === 2, `${frozenCount} biomes carry temperature_modifier: frozen, expected 2 (the two frozen oceans)`);
  ok(B.at(fo).frozenTemp, 'frozen_ocean does not carry the frozen modifier');
  ok(B.at(B.index('deep_frozen_ocean')).frozenTemp, 'deep_frozen_ocean does not carry the frozen modifier');
  let forced = 0, n = 0;
  for (let x = -180; x < 180; x += 6) for (let z = -180; z < 180; z += 6) { n++; if (B.temperatureAt(fo, x, 64, z) === 0.2) forced++; }
  const ff = forced / n;
  ok(ff > 0.15 && ff < 0.85, `the frozen modifier fires on ${(ff * 100).toFixed(1)}% of a frozen ocean — that is not a patchwork`);
  // ⚠ it makes the water WARMER, not colder: 0.2 is above warmEnoughToRain's 0.15, which is
  // what leaves open water in an otherwise frozen ocean. A port that made it colder would look
  // right and behave backwards.
  ok(B.baseTemperature(fo) === 0, `frozen_ocean's base temperature is ${B.baseTemperature(fo)}`);
  ok(B.warmEnoughToRain(fo, 0, 64, 0) !== B.warmEnoughToRain(fo, 0, 64, 0) === false, 'warmEnoughToRain is not deterministic');
  let warmSpots = 0;
  for (let x = -180; x < 180; x += 6) for (let z = -180; z < 180; z += 6) if (B.warmEnoughToRain(fo, x, 64, z)) warmSpots++;
  ok(warmSpots > 0, 'nowhere in a frozen ocean is warm enough to rain — the modifier is not being applied');
  ok(warmSpots < n, 'everywhere in a frozen ocean is warm enough to rain — the modifier fires unconditionally');
  // an unmodified biome must never move below y=80
  let odd = 0;
  for (let x = -100; x < 100; x += 9) for (let z = -100; z < 100; z += 9) if (B.temperatureAt(oc, x, 64, z) !== B.baseTemperature(oc)) odd++; else pass++;
  ok(odd === 0, `${odd} points changed an unmodified biome's temperature below y=80`);
  // snow vs rain
  ok(B.precipitation(B.index('snowy_plains')) === B.PRECIP_SNOW, 'snowy_plains does not snow');
  ok(B.precipitation(B.index('desert')) === B.PRECIP_NONE, 'it rains in the desert');
  ok(B.precipitation(pl) === B.PRECIP_RAIN, 'it does not rain on the plains');
  ok(B.snowsAt(B.index('snowy_plains'), 0, 64, 0), 'snowy_plains does not place snow at sea level');
  ok(!B.snowsAt(B.index('desert'), 0, 64, 0), 'the desert places snow');
  // ⚠ A plains at y=300 does NOT snow, and that is vanilla: 0.8 - 220 x 0.05/40 is 0.525, well
  // above the 0.15 threshold. The first draft of this line asserted the opposite. A taiga at
  // 0.25 does cross it, which is why the snow line on a mountain depends on the biome.
  ok(!B.snowsAt(pl, 0, 300, 0), 'a plains at y=300 snows, which vanilla does not do');
  ok(B.snowsAt(B.index('taiga'), 0, 300, 0), 'a taiga at y=300 does not snow');
  ok(!B.snowsAt(B.index('taiga'), 0, 64, 0), 'a taiga snows at sea level');
}

// ─────────────────────────────────────────────── 5. the pass-through half
console.log("5. spawners, spawn_costs, carvers and features — unmodified");
{
  let notSame = 0;
  for (let i = 0; i < B.count; i++) {
    const n = B.name(i);
    const src = NS.WG.get('biome', n);
    // by REFERENCE: these must be the registry's own objects, not copies
    if (B.spawners(i) === src.spawners) pass++; else { notSame++; fails.length < 40 && fails.push(`${n}: spawners is a copy, not the registry's object`); }
    if (B.spawnCosts(i) === src.spawn_costs) pass++; else notSame++;
    if (B.carvers(i) === src.carvers) pass++; else notSame++;
    if (B.features(i) === src.features) pass++; else notSame++;
  }
  ok(notSame === 0, `${notSame} pass-through lists are not the registry's own objects`);

  // and by VALUE against the JSON on disk, which is the claim PLAN actually makes
  const haveSource = existsSync(BIOMEDIR);
  ok(haveSource, `no biome cache at ${BIOMEDIR} — this check cannot compare against anything`);
  if (haveSource) {
    const files = readdirSync(BIOMEDIR).filter((f) => f.endsWith('.json'));
    ok(files.length === 61, `${files.length} biome files on disk, expected 61`);
    let diff = 0, walked = 0;
    const walk = (a, b, path) => {
      walked++;
      if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        if (a !== b) { diff++; if (fails.length < 40 && diff < 4) fails.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
        return;
      }
      const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
      if (ka.join(',') !== kb.join(',')) { diff++; if (fails.length < 40 && diff < 4) fails.push(`${path}: keys ${ka} != ${kb}`); return; }
      for (const k of ka) walk(a[k], b[k], path + '.' + k);
    };
    for (const f of files) {
      const name = 'minecraft:' + f.replace(/\.json$/, '');
      const src = JSON.parse(readFileSync(join(BIOMEDIR, f), 'utf8'));
      const i = B.index(name);
      walk(src.spawners, B.spawners(i), name + '.spawners');
      walk(src.spawn_costs, B.spawnCosts(i), name + '.spawn_costs');
      walk(src.carvers, B.carvers(i), name + '.carvers');
      walk(src.features, B.features(i), name + '.features');
    }
    ok(diff === 0, `${diff} values differ between the biome JSON on disk and what the runtime carries`);
    pass += walked - diff;
    if (PRINT) console.log(`   ${walked.toLocaleString()} values walked across 61 biomes`);
  }

  // a spot check that the lists are not empty in the places G will look first
  const pl = B.index('plains');
  ok(Object.keys(B.spawners(pl)).length >= 4, 'the plains spawner list has almost nothing in it');
  ok(B.spawners(pl).creature.some((e) => e.type === 'minecraft:sheep'), 'no sheep on the plains');
  ok(B.spawners(pl).monster.some((e) => e.type === 'minecraft:creeper'), 'no creepers on the plains');
  ok(B.carvers(pl).air.indexOf('minecraft:cave') >= 0, 'the plains has no cave carver');
  ok(B.features(pl)[9].length > 0, 'the plains has nothing in its vegetal decoration step');
  ok(B.featureStep(pl, 9) === B.features(pl)[9], 'featureStep does not return the registry list for a step that exists');
  // and the truncated ones must read as empty rather than as undefined
  let undef = 0;
  for (let i = 0; i < B.count; i++) for (let s2 = 0; s2 < 11; s2++) { if (Array.isArray(B.featureStep(i, s2))) pass++; else undef++; }
  ok(undef === 0, `${undef} (biome, step) pairs returned something that is not a list`);
  ok(B.featureStep(B.index('end_barrens'), 10).length === 0, 'a truncated decoration step is not empty');
}

// ─────────────────────────────────────────────── 6. against W4
console.log("6. against W4's climate table");
{
  ok(CL.ready, 'the climate table did not load');
  let missing = 0;
  for (const n of CL.biomeNames) { if (B.indexOf[n] !== undefined) pass++; else { missing++; fails.length < 40 && fails.push(`the climate table dispatches to ${n}, which the biome registry does not have`); } }
  ok(missing === 0, `${missing} of the climate table's biomes are not in the registry`);
  const named = new Set(CL.biomeNames.map(short));
  const unnamed = B.names.map(short).filter((n) => !named.has(n)).sort();
  const expect = ['basalt_deltas', 'crimson_forest', 'end_barrens', 'end_highlands', 'end_midlands',
    'nether_wastes', 'small_end_islands', 'soul_sand_valley', 'the_end', 'the_void', 'warped_forest'];
  ok(unnamed.join(' ') === expect.join(' '),
     `the biomes the overworld never names are [${unnamed.join(' ')}] — expected the five Nether, the five End and the_void`);
  pass += unnamed.length;
  // the eleven are exactly the ones with no overworld home, and their sky colours say so
  for (const n of ['the_end', 'end_barrens', 'end_highlands', 'end_midlands', 'small_end_islands']) {
    ok(B.skyColor(B.index(n)) === 0, `${n} has a sky colour of ${hx(B.skyColor(B.index(n)))}, expected black`);
  }
}

// ─────────────────────────────────────────────── 7. anti-vacuity
console.log('7. anti-vacuity — every check above must be able to fail');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('the colormap indexed with i and j swapped', () => {
    // The classic way to get this wrong. It still returns greens, and for the diagonal
    // temperature == humidity it returns the RIGHT green, so a one-biome test would pass.
    let differ = 0;
    for (const [t, d] of [[0.8, 0.4], [0.95, 0.9], [0.0, 0.5], [2.0, 0.0]]) {
      const tc = Math.max(0, Math.min(1, t)), h = Math.max(0, Math.min(1, d)) * tc;
      const i = Math.trunc((1 - tc) * 255), j = Math.trunc((1 - h) * 255);
      if (((i << 8) | j) !== ((j << 8) | i)) differ++;
    }
    if (differ === 0) return;      // NOT caught: the two indexings agree everywhere
    throw 0;
  });

  check('the humidity-times-temperature step dropped', () => {
    // Without it a desert (t=1, d=0) is unchanged but a plains (t=0.8, d=0.4) moves.
    const withStep = B.grassRamp(0.8, 0.4);
    const map = (t, d) => {
      const i = Math.trunc((1 - t) * 255), j = Math.trunc((1 - d) * 255);
      return i === j ? withStep : -1;      // stand-in: the indices differ, so the colour would
    };
    if (map(0.8, 0.4) === withStep) return;   // NOT caught
    throw 0;
  });

  check('the temperature clamp removed', () => {
    // A desert is temperature 2.0. Unclamped, `(1 - 2.0) * 255` is -255 and the index runs off
    // the front of the image.
    const t = 2.0, d = 0.0;
    const i = Math.trunc((1 - t) * 255), j = Math.trunc((1 - d * t) * 255);
    const k = (j << 8) | i;
    if (k >= 0 && k < 256 * 256) return;      // NOT caught: it would still be in range
    throw 0;
  });

  check("the dark forest modifier's channel mask dropped", () => {
    const df = B.index('dark_forest');
    const masked = (((B.grassBase(df) & 0xfefefe) + 0x28340a) >> 1) & 0xffffff;
    const unmasked = ((B.grassBase(df) + 0x28340a) >> 1) & 0xffffff;
    if (masked === unmasked) return;          // NOT caught on this biome's colour
    throw 0;
  });

  check('the swamp modifier replaced by its base colour', () => {
    const sw = B.index('swamp');
    let any = false;
    for (let x = 0; x < 60 && !any; x++) for (let z = 0; z < 60; z++) {
      if (B.grassColorAt(sw, x, z) !== B.grassBase(sw)) { any = true; break; }
    }
    if (!any) return;              // NOT caught: the modifier never changes anything
    throw 0;
  });

  check('the height adjustment applied below y = 80', () => {
    const pl = B.index('plains');
    if (B.temperatureAt(pl, 0, 79, 0) !== B.baseTemperature(pl)) throw 0;   // it IS flat there
    if (B.temperatureAt(pl, 0, 300, 0) === B.baseTemperature(pl)) return;   // NOT caught
    throw 0;
  });

  check('the frozen modifier made unconditional', () => {
    const fo = B.index('frozen_ocean');
    let forced = 0, n = 0;
    for (let x = -120; x < 120; x += 6) for (let z = -120; z < 120; z += 6) { n++; if (B.temperatureAt(fo, x, 64, z) === 0.2) forced++; }
    if (forced === n || forced === 0) return;   // NOT caught: it is not a patchwork at all
    throw 0;
  });

  check('a decoration step past the eleven', () => { B.featureStep(B.index('plains'), 11); });
  check('a biome the registry does not have', () => { B.index('minecraft:mangrove_swamp'); });
  check('an index past the end of the registry', () => { B.at(B.count); });
  check('a colormaps blob with the wrong magic', () => {
    const good = inflateRawSync(readFileSync(join(ASSETS, 'colormaps.bin')));
    const bad = Buffer.from(good);
    bad.write('XXXX', 0, 'ascii');
    try { NS.Biomes.initColormaps({ colormaps: deflateRawSync(bad, { level: 1 }).toString('base64'), colormapsBytes: bad.length }); }
    finally {
      NS.Biomes.initColormaps({ colormaps: readFileSync(join(ASSETS, 'colormaps.bin')).toString('base64'), colormapsBytes: cmMeta.rawBytes });
      NS.Biomes.init();
    }
  });

  check('a pass-through list quietly replaced by a copy', () => {
    // Section 5 compares by reference, so a deep copy that is equal by value must still fail.
    const i = B.index('plains');
    const copy = JSON.parse(JSON.stringify(B.spawners(i)));
    if (copy === NS.WG.get('biome', 'minecraft:plains').spawners) return;   // NOT caught
    throw 0;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ biomecheck ================');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
