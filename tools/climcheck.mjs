#!/usr/bin/env node
// climcheck.mjs — PLAN W4's acceptance test, both halves.
//
//   node tools/climcheck.mjs [--print]
//
// PLAN W4: *"with the toggle off, biome placement must reproduce vanilla's climate-parameter
// dispatch; with it on, a pole-to-equator transect must show the Köppen-plausible band order,
// asserted as an ordering test, not eyeballed."*
//
// Both halves are here, and so is the thing that makes either of them mean anything: the
// anti-vacuity section (D-30) breaks the data and requires the break to be caught. The
// ordering test in particular is the kind of test that passes on anything if it is written
// loosely, so section 10 runs it against the VANILLA mode and requires it to FAIL — a climate
// that does not know which way is north must not be able to satisfy a latitude ordering.
//
// ── HOW "REPRODUCES VANILLA'S DISPATCH" IS TESTED ────────────────────────────────────────
// Not by comparing the engine to itself. Section 3 is a HAND-WRITTEN table — Mojang's
// `OverworldBiomeBuilder.MIDDLE_BIOMES`, `MIDDLE_BIOMES_VARIANT`, the plateau and badlands
// rows, the two ocean rows and the special bands — typed out from the Java it comes from, and
// the engine has to reproduce all 95 cells. That is the same method the mesh reference uses,
// and it is the only method under which a wrong packer and a wrong reader cannot agree with
// each other and both be called right.
//
// Section 1 is the other direction: the 7,578 packed entries against the 4.3 MB of JSON they
// were packed from, field by field.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { MCDATA } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src';
const ASSETS = MCLITE_ROOT + 'assets';
const VERSION = '1.18.2';
const DIM = join(MCDATA, VERSION, 'data', 'minecraft', 'dimension', 'overworld.json');
const PRINT = process.argv.includes('--print');

let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

// ---------------------------------------------------------------- boot
const NS = { CFG: {} };
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02d_wgdata.js', '03b_noise.js',
                 '04d_column.js', '04e_climate.js', '04f_earth.js', '04g_biomes.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const wgMeta = JSON.parse(readFileSync(join(ASSETS, 'worldgen.meta.json'), 'utf8'));
const bpMeta = JSON.parse(readFileSync(join(ASSETS, 'biome-params.meta.json'), 'utf8'));
const bpBin = readFileSync(join(ASSETS, 'biome-params.bin'));
NS.WG.init({
  worldgen: readFileSync(join(ASSETS, 'worldgen.bin')).toString('base64'),
  worldgenBytes: wgMeta.jsonBytes,
});
function initClimate(bin) {
  NS.Climate.init({ biomeParams: bin.toString('base64'), biomeParamsBytes: inflateRawSync(bin).length });
  if (NS.Biomes.ready) NS.Climate.bindBiomes(NS.Biomes);
}
// ⚠ The climate table and the biome registry must be BOUND into one index space before
// anything asks which biome is where — see the long note in 04e_climate.js. `Reg.init` does
// this in the engine; a check that boots the modules by hand has to do it too, and the first
// draft of this file did not, which is how the two spaces went unnoticed for an afternoon.
NS.Biomes.initColormaps({
  colormaps: readFileSync(join(ASSETS, 'colormaps.bin')).toString('base64'),
  colormapsBytes: JSON.parse(readFileSync(join(ASSETS, 'colormaps.meta.json'), 'utf8')).rawBytes,
});
NS.Biomes.init();
initClimate(bpBin);
const CL = NS.Climate, E = NS.Earth, C = NS.Column;
const SEED = 1337n;
C.init(SEED);
E.init({});
const short = (n) => n.replace('minecraft:', '');

// ─────────────────────────────────────────────── 1. the blob against its source
console.log('1. the packed table against dimension/overworld.json');
{
  ok(CL.ready, 'Climate.init did not run');
  ok(CL.entryCount === 7578, `${CL.entryCount} entries, expected 7,578`);
  ok(CL.tableBiomeNames.length === 50, `${CL.tableBiomeNames.length} biomes in the table, expected 50`);
  ok(CL.bound, 'the climate table was not bound to the biome registry');
  ok(CL.biomeNames.length === 61, `${CL.biomeNames.length} names after binding, expected the 61-biome registry`);
  ok(CL.nodeCount === bpMeta.nodes, `runtime read ${CL.nodeCount} R-tree nodes, meta says ${bpMeta.nodes}`);
  ok(CL.QUANTUM === 10000, `quantum is ${CL.QUANTUM}`);

  const haveSource = existsSync(DIM);
  ok(haveSource, `no dimension cache at ${DIM} — run tools/fetch-vanilla-data.mjs; this check cannot compare against anything`);
  if (haveSource) {
    const entries = JSON.parse(readFileSync(DIM, 'utf8')).generator.biome_source.biomes;
    ok(entries.length === CL.entryCount, `source has ${entries.length} entries, blob has ${CL.entryCount}`);
    const AX = ['temperature', 'humidity', 'continentalness', 'erosion', 'depth', 'weirdness', 'offset'];
    let bad = 0, cmp = 0;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (short(CL.biomeNames[CL.entryBiome(i)]) !== short(e.biome)) { bad++; if (bad < 4) fails.push(`entry ${i} biome ${CL.biomeNames[CL.entryBiome(i)]} != ${e.biome}`); continue; }
      for (let a = 0; a < 7; a++) {
        const v = e.parameters[AX[a]];
        const lo = Math.round((Array.isArray(v) ? v[0] : v) * 10000);
        const hi = Math.round((Array.isArray(v) ? v[1] : v) * 10000);
        const got = CL.entryRange(i, a);
        cmp += 2;
        if (got[0] !== lo || got[1] !== hi) { bad++; if (bad < 4) fails.push(`entry ${i} ${AX[a]}: ${got} != ${lo},${hi}`); }
      }
    }
    // Every one of the 106,092 numbers, not a sample: it is 40 ms and it is the only thing
    // standing between a packer bug and a world with the wrong biomes everywhere.
    pass += cmp - bad;
    ok(bad === 0, `${bad} packed fields disagree with the source JSON`);
    ok(cmp === 7578 * 14, `compared ${cmp} fields, expected ${7578 * 14}`);

    // and every biome the table names exists in the worldgen registry W5 will read
    let missingReg = 0;
    for (const n of CL.tableBiomeNames) { if (!NS.WG.get('biome', n)) missingReg++; else pass++; }
    ok(missingReg === 0, `${missingReg} biomes in the climate table are not in the worldgen/biome registry`);

    // The other direction, which is W5's whole shape: the registry has 61 biomes and this
    // table names 50. The eleven it does not name must be exactly the other dimensions' —
    // if a twelfth ever appears, an overworld biome has gone missing and W5 would inherit a
    // hole rather than a surprise.
    const named = new Set(CL.tableBiomeNames.map(short));
    const unnamed = NS.WG.names('biome').map(short).filter((b) => !named.has(b)).sort();
    const expectUnnamed = ['basalt_deltas', 'crimson_forest', 'end_barrens', 'end_highlands',
      'end_midlands', 'nether_wastes', 'small_end_islands', 'soul_sand_valley', 'the_end',
      'the_void', 'warped_forest'];
    ok(unnamed.length + named.size === 61, `${unnamed.length + named.size} biomes in the registry, expected 61`);
    ok(unnamed.join(' ') === expectUnnamed.join(' '),
       `the biomes the overworld table does not name are [${unnamed.join(' ')}], expected the five Nether, the five End and the_void`);
    pass += unnamed.length;
  }
}

// ─────────────────────────────────────────────── 2. the R-tree finds the true nearest
console.log('2. the R-tree against a brute-force scan of all 7,578 entries');
let treeTies = 0;
{
  const q = new Int32Array(7);
  let mism = 0, worse = 0;
  // A fixed LCG rather than Math.random: a check that samples different points every run
  // is a check that fails intermittently on someone else's machine and passes on yours.
  let s = 0x2f6e2b1 >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const N = 12000;
  for (let i = 0; i < N; i++) {
    for (let a = 0; a < 6; a++) q[a] = Math.round((rnd() * 2.6 - 1.3) * 10000);
    q[6] = 0;
    const e1 = CL.searchEntry(q), e2 = CL.searchEntryLinear(q);
    const d1 = CL.entryDist(e1, q), d2 = CL.entryDist(e2, q);
    if (d1 > d2) { worse++; if (worse < 4) fails.push(`query ${i}: tree found distance ${d1}, brute force found ${d2}`); }
    else pass++;
    if (e1 !== e2) { mism++; if (d1 === d2) treeTies++; }
  }
  ok(worse === 0, `the R-tree returned a worse-than-nearest entry on ${worse} of ${N} queries`);
  ok(mism === treeTies, `${mism - treeTies} disagreements with brute force were not exact ties`);
  // Ties are expected — 7,578 overlapping boxes guarantee some — but if EVERY query tied,
  // the distance function would be constant and section 2 would be proving nothing.
  ok(treeTies < N / 10, `${treeTies} of ${N} queries tie; the distance metric looks degenerate`);
  ok(treeTies > 0, `no query tied at all in ${N} — the tie-handling path is untested`);
  if (PRINT) console.log(`   ${N} queries · ${treeTies} exact ties · 0 worse than nearest`);

  // the query used by the game is inside the table's own range; check that end too
  let inRange = 0;
  const M = 4000;
  for (let i = 0; i < M; i++) {
    for (let a = 0; a < 6; a++) q[a] = Math.round((rnd() * 2 - 1) * 10000);
    q[6] = 0;
    const t = CL.searchEntry(q), l = CL.searchEntryLinear(q);
    if (t === l || CL.entryDist(t, q) === CL.entryDist(l, q)) inRange++;
  }
  ok(inRange === M, `${M - inRange} in-range queries disagreed by distance`);
  pass += inRange;
}

// ─────────────────────────────────────────────── 2b. the column sweep is the same search (D-180)
//
// `Climate.columnBiomes` answers 80 queries down one quart column without touching the R-tree:
// the whole table uses only three distinct intervals on the depth axis, so the nearest entry at
// any depth is one of three — the closest entry of each depth group on the other six axes. That
// is a completely different computation from `searchEntry`, and the claim in 04e_climate.js is
// that it is not a different ANSWER, ties included. This is that claim, tested rather than
// asserted in a comment.
console.log('2b. the column sweep against the R-tree, query for query');
{
  const q = new Int32Array(7);
  let s = 0x51ed270b >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const COLS = 400, LEVELS = 80;
  let same = 0, n = 0, distinct = 0;
  for (let c = 0; c < COLS; c++) {
    for (let a = 0; a < 6; a++) q[a] = Math.round((rnd() * 2.4 - 1.2) * 10000);
    q[6] = 0;
    CL.foldColumn(q);
    let prev = -1;
    for (let j = 0; j < LEVELS; j++) {
      const qd = Math.round((rnd() * 2.6 - 1.3) * 10000);
      q[4] = qd;
      const tree = CL.searchEntry(q);
      const sweep = CL.sweepAt(qd);
      n++;
      if (tree === sweep) same++;
      if (sweep !== prev) { distinct++; prev = sweep; }
    }
  }
  ok(same === n, `the sweep disagreed with the R-tree on ${n - same} of ${n} queries`);
  // ⚠ and it must not be trivially right by always returning one entry: if every answer were
  // the same the comparison above would be satisfied by a constant.
  ok(distinct > COLS * 2, `only ${distinct} answer changes over ${n} queries — the sweep looks constant`);
  ok(CL.depthGroupCount >= 2 && CL.depthGroupCount <= 8,
     `${CL.depthGroupCount} distinct depth intervals; the sweep is only cheap while that is a handful`);
  if (PRINT) console.log(`   ${n} queries over ${COLS} columns · ${CL.depthGroupCount} depth groups · ${distinct} answer changes`);
  pass += same;
}

// ─────────────────────────────────────────────── 3. the hand-written vanilla reference
console.log("3. Mojang's OverworldBiomeBuilder tables, typed out by hand");
{
  // Vanilla's five band centres on each axis. The band EDGES are -0.45/-0.15/0.2/0.55 for
  // temperature and -0.35/-0.1/0.1/0.3 for humidity; these are the middles.
  const TC = [-0.72, -0.30, 0.025, 0.375, 0.775];
  const HC = [-0.675, -0.225, 0.0, 0.2, 0.65];
  const q = new Int32Array(7);
  const at = (t, h, c, e, w, d) => {
    q[0] = Math.trunc(t * 10000); q[1] = Math.trunc(h * 10000); q[2] = Math.trunc(c * 10000);
    q[3] = Math.trunc(e * 10000); q[4] = Math.trunc(d * 10000); q[5] = Math.trunc(w * 10000); q[6] = 0;
    return short(CL.biomeNames[CL.entryBiome(CL.searchEntry(q))]);
  };

  // MIDDLE_BIOMES — inland, ordinary erosion, weirdness below zero. Rows are the five
  // temperature bands, columns the five humidity bands.
  const MIDDLE = [
    ['snowy_plains',     'snowy_plains', 'snowy_plains', 'snowy_taiga',             'taiga'],
    ['plains',           'plains',       'forest',       'taiga',                   'old_growth_spruce_taiga'],
    ['flower_forest',    'plains',       'forest',       'birch_forest',            'dark_forest'],
    ['savanna',          'savanna',      'forest',       'jungle',                  'jungle'],
    ['desert',           'desert',       'desert',       'desert',                  'desert'],
  ];
  // MIDDLE_BIOMES_VARIANT, the overlay vanilla applies when weirdness is above zero. Cells
  // with no variant fall through to MIDDLE, which is why several rows repeat it.
  const VARIANT = [
    ['ice_spikes',       'snowy_plains', 'snowy_taiga',  'snowy_taiga',             'taiga'],
    ['plains',           'plains',       'forest',       'taiga',                   'old_growth_pine_taiga'],
    ['sunflower_plains', 'plains',       'forest',       'old_growth_birch_forest', 'dark_forest'],
    ['savanna',          'savanna',      'plains',       'sparse_jungle',           'bamboo_jungle'],
    ['desert',           'desert',       'desert',       'desert',                  'desert'],
  ];
  // The plateau/slope band: continentalness far inland, erosion low enough to be high ground.
  // Its bottom two rows are the ones that matter here, because they are the only place the
  // badlands family lives — and `wooded_badlands` needs HUMIDITY BAND 3, which is the fact
  // 04f_earth.js's badlands-margin note is about.
  const HIGH = [
    ['snowy_slopes',     'snowy_slopes', 'grove',        'grove',                   'grove'],
    ['snowy_slopes',     'snowy_slopes', 'grove',        'grove',                   'grove'],
    ['snowy_slopes',     'snowy_slopes', 'grove',        'grove',                   'grove'],
    ['savanna_plateau',  'savanna_plateau', 'forest',    'forest',                  'jungle'],
    ['badlands',         'badlands',     'badlands',     'wooded_badlands',         'wooded_badlands'],
  ];
  // The peak band: erosion at its lowest, weirdness high.
  const PEAKS = [
    ['frozen_peaks',     'frozen_peaks', 'frozen_peaks', 'frozen_peaks',            'frozen_peaks'],
    ['frozen_peaks',     'frozen_peaks', 'frozen_peaks', 'frozen_peaks',            'frozen_peaks'],
    ['frozen_peaks',     'frozen_peaks', 'frozen_peaks', 'frozen_peaks',            'frozen_peaks'],
    ['stony_peaks',      'stony_peaks',  'stony_peaks',  'stony_peaks',             'stony_peaks'],
    ['badlands',         'badlands',     'badlands',     'wooded_badlands',         'wooded_badlands'],
  ];
  const grids = [
    ['MIDDLE_BIOMES',         MIDDLE,  0.4, 0.25, -0.5, 0],
    ['MIDDLE_BIOMES_VARIANT', VARIANT, 0.4, 0.25, 0.5, 0],
    ['plateau and slopes',    HIGH,    0.6, -0.6, -0.5, 0],
    ['peaks',                 PEAKS,   0.4, -0.9, 0.5, 0],
  ];
  for (const [label, grid, c, e, w, d] of grids) {
    for (let t = 0; t < 5; t++) {
      for (let h = 0; h < 5; h++) {
        const got = at(TC[t], HC[h], c, e, w, d);
        ok(got === grid[t][h], `${label} T${t}/H${h}: got ${got}, hand-written reference says ${grid[t][h]}`);
      }
    }
    if (PRINT) {
      console.log('   ' + label);
      for (let t = 0; t < 5; t++) console.log('     T' + t + ' ' + grid[t].map((s) => s.padEnd(24)).join(''));
    }
  }

  // The two ocean rows, indexed by temperature band alone — the fact 04f_earth.js's T_SEA
  // table exists to honour.
  const OCEAN = ['frozen_ocean', 'cold_ocean', 'ocean', 'lukewarm_ocean', 'warm_ocean'];
  const DEEP = ['deep_frozen_ocean', 'deep_cold_ocean', 'deep_ocean', 'deep_lukewarm_ocean', 'warm_ocean'];
  for (let t = 0; t < 5; t++) {
    ok(at(TC[t], HC[2], -0.3, 0.25, -0.5, 0) === OCEAN[t], `ocean T${t}: got ${at(TC[t], HC[2], -0.3, 0.25, -0.5, 0)}, expected ${OCEAN[t]}`);
    ok(at(TC[t], HC[2], -0.6, 0.25, -0.5, 0) === DEEP[t], `deep ocean T${t}: got ${at(TC[t], HC[2], -0.6, 0.25, -0.5, 0)}, expected ${DEEP[t]}`);
  }
  // And the bands that ignore temperature entirely.
  for (let t = 0; t < 5; t++) {
    ok(at(TC[t], HC[2], -1.1, 0.25, -0.5, 0) === 'mushroom_fields', `mushroom_fields band at T${t}`);
    ok(at(TC[t], HC[2], 0.4, 0.25, 0.0, 0.5) === 'dripstone_caves', `cave band at T${t}`);
  }
  ok(at(TC[2], HC[4], 0.4, 0.25, 0.0, 0.5) === 'lush_caves', 'the humid cave band is lush_caves');
  ok(at(TC[0], HC[2], 0.4, 0.25, 0.0, 0) === 'frozen_river', 'weirdness zero, frozen: frozen_river');
  ok(at(TC[2], HC[2], 0.4, 0.25, 0.0, 0) === 'river', 'weirdness zero, temperate: river');
}

// ─────────────────────────────────────────────── 4. the depth axis
console.log('4. the depth axis, and the algebra that lets W3 keep its own height curve');
{
  // The claim in 04e_climate.js: vanilla's `y_clamped_gradient(y) + offset` and MC-Lite's
  // `(surfaceY - y) / 128` are the SAME FUNCTION whenever vanilla's own surface rule
  // `surfaceY = 128 * (1 + offset)` holds. If that is not true the port is not a port.
  let worst = 0;
  for (let oi = 0; oi <= 60; oi++) {
    const offset = -0.8 + oi * 0.055;
    const surfaceY = 128 * (1 + offset);
    for (let y = -64; y <= 320; y += 7) {
      const vanilla = CL.depthGradient(y) + offset;
      const mclite = CL.depthAt(surfaceY, y);
      const d = Math.abs(vanilla - mclite);
      if (d > worst) worst = d;
      if (d < 1e-12) pass++;
    }
  }
  ok(worst < 1e-12, `the two depth forms differ by up to ${worst}`);
  // the clamp, at both ends
  ok(CL.depthGradient(-64) === 1.5, `depthGradient(-64) = ${CL.depthGradient(-64)}`);
  ok(CL.depthGradient(320) === -1.5, `depthGradient(320) = ${CL.depthGradient(320)}`);
  ok(CL.depthGradient(-200) === 1.5, 'depthGradient clamps below the world');
  ok(CL.depthGradient(400) === -1.5, 'depthGradient clamps above the world');
  ok(Math.abs(CL.depthGradient(64) - 0.5) < 1e-12, 'depthGradient(64) = 0.5, i.e. 1 - y/128');
  // depth is zero at the surface and grows downward at vanilla's rate
  ok(CL.depthAt(64, 64) === 0, 'depth is zero at the surface');
  ok(Math.abs(CL.depthAt(64, 64 - 128) - 1) < 1e-12, 'depth is 1 a hundred and twenty-eight blocks down');
  ok(CL.depthAt(64, 30) > 0 && CL.depthAt(64, 100) < 0, 'depth grows downward');
  // and the surface really does select surface biomes, which is what the first version got
  // wrong: `1 - y/128 + offset` under W3's height curve put lush and dripstone caves on top.
  CL.setMode(CL.MODE_VANILLA);
  let caves = 0, n = 0;
  for (let i = 0; i < 1500; i++) {
    const x = ((i * 977) % 6000) - 3000, z = ((i * 613) % 6000) - 3000;
    const b = short(CL.biomeNames[CL.surfaceBiomeAt(x, z)]);
    n++;
    if (b === 'lush_caves' || b === 'dripstone_caves') caves++; else pass++;
  }
  ok(caves === 0, `${caves} of ${n} surface columns selected a CAVE biome — the depth axis is wrong`);
  // ... and the cave biomes must still be reachable underground, or the axis is merely broken
  // the other way
  let foundCave = 0;
  for (let i = 0; i < 3000 && foundCave < 2; i++) {
    const x = ((i * 977) % 20000) - 10000, z = ((i * 613) % 20000) - 10000;
    const b = short(CL.biomeNameAt(x, C.height(x, z) - 70, z));
    if (b === 'lush_caves' || b === 'dripstone_caves') foundCave++;
  }
  ok(foundCave >= 2, 'no cave biome anywhere 70 blocks below the surface');
}

// ─────────────────────────────────────────────── 5. purity and quart snapping
console.log('5. purity, quart snapping, and the two modes side by side');
{
  for (const mode of [CL.MODE_VANILLA, CL.MODE_EARTH]) {
    CL.setMode(mode);
    const label = CL.MODE_NAMES[mode];
    const pts = [];
    for (let i = 0; i < 200; i++) pts.push([((i * 7919) % 9000) - 4500, ((i * 3571) % 300) - 100, ((i * 104729) % 9000) - 4500]);
    const fwd = pts.map(([x, y, z]) => CL.biomeAt(x, y, z));
    const rev = [];
    for (let i = pts.length - 1; i >= 0; i--) rev[i] = CL.biomeAt(pts[i][0], pts[i][1], pts[i][2]);
    const shuffled = pts.map((_, i) => i).sort((a, b) => ((a * 2654435761) % 997) - ((b * 2654435761) % 997));
    const sh = [];
    for (const i of shuffled) sh[i] = CL.biomeAt(pts[i][0], pts[i][1], pts[i][2]);
    let diff = 0;
    for (let i = 0; i < pts.length; i++) { if (fwd[i] === rev[i] && fwd[i] === sh[i]) pass++; else diff++; }
    ok(diff === 0, `${label}: ${diff} of ${pts.length} points changed biome when sampled in a different order`);

    // quart snapping: all 64 blocks of a 4x4x4 cell must agree
    let unsnapped = 0;
    for (let i = 0; i < 40; i++) {
      const bx = (((i * 8191) % 4000) - 2000) & ~3, by = ((i * 37) % 200) & ~3, bz = (((i * 6151) % 4000) - 2000) & ~3;
      const want = CL.biomeAt(bx, by, bz);
      for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 4; dy++) for (let dz = 0; dz < 4; dz++) {
        if (CL.biomeAt(bx + dx, by + dy, bz + dz) === want) pass++; else unsnapped++;
      }
    }
    ok(unsnapped === 0, `${label}: ${unsnapped} blocks inside a 4x4x4 cell disagreed with the cell`);

    // negative coordinates must snap the same way — `>> 2 << 2` floors, `/4|0` would not
    ok(CL.biomeAt(-1, 64, -1) === CL.biomeAt(-4, 64, -4), `${label}: the quart snap does not floor for negative coordinates`);
    ok(CL.biomeAt(-5, 64, -5) === CL.biomeAt(-8, 64, -8), `${label}: the quart snap is off by one below zero`);
  }

  // The two modes must differ in exactly two axes and agree in the other four: Earth mode is
  // allowed to move a biome, never to move a mountain.
  const a = new Float64Array(6), b = new Float64Array(6);
  let moved = 0, differed = 0;
  for (let i = 0; i < 400; i++) {
    const x = ((i * 7919) % 12000) - 6000, z = ((i * 104729) % 12000) - 6000, y = 40 + (i % 90);
    CL.setMode(CL.MODE_VANILLA); CL.targetInto(x, y, z, a);
    CL.setMode(CL.MODE_EARTH); CL.targetInto(x, y, z, b);
    for (const ax of [2, 3, 4, 5]) { if (a[ax] === b[ax]) pass++; else moved++; }
    if (a[0] !== b[0] || a[1] !== b[1]) differed++;
  }
  ok(moved === 0, `${moved} terrain-shape axis values changed between the two climate modes`);
  ok(differed > 380, `only ${differed} of 400 points had a different climate in Earth mode — the toggle barely does anything`);
}

// ─────────────────────────────────────────────── 6. the Earth model's own arithmetic
console.log('6. latitude, the zonal tables, the lapse rate and the wind');
{
  ok(E.ready, 'Earth.init did not run');
  ok(E.scale === 12000, `default world scale is ${E.scale}, PLAN says 12,000`);
  ok(Math.abs(E.latitudeAt(0)) < 1e-9, `the equator is not at z = 0 (${E.latitudeAt(0)})`);
  ok(Math.abs(E.latitudeAt(-12000) - 90) < 1e-9, 'the north pole is not at z = -scale');
  ok(Math.abs(E.latitudeAt(12000) + 90) < 1e-9, 'the south pole is not at z = +scale');
  // the fold: past the pole is the far side, not more pole
  ok(Math.abs(E.latitudeAt(-24000)) < 1e-9, 'walking past the north pole does not come back to the equator');
  ok(Math.abs(E.latitudeAt(-13000) - E.latitudeAt(-11000)) < 1e-9, 'the fold at the pole is not symmetric');
  ok(Math.abs(E.latitudeAt(-36000) + 90) < 1e-9, 'the far south pole is not where the fold says');
  // continuity and range, everywhere
  let outOfRange = 0, jump = 0, prev = E.latitudeAt(-60000);
  for (let z = -60000; z <= 60000; z += 37) {
    const l = E.latitudeAt(z);
    if (l < -90.0000001 || l > 90.0000001) outOfRange++; else pass++;
    if (Math.abs(l - prev) > 1) jump++;
    prev = l;
  }
  ok(outOfRange === 0, `${outOfRange} latitudes fell outside -90..90`);
  ok(jump === 0, `the latitude function jumps ${jump} times — it must be continuous`);
  // period
  let periodic = 0;
  for (let z = -5000; z < 5000; z += 61) if (Math.abs(E.latitudeAt(z) - E.latitudeAt(z + 48000)) < 1e-9) periodic++;
  ok(periodic === Math.ceil(10000 / 61), 'the latitude function is not periodic with period 4 x scale');
  pass += periodic;
  for (const d of [-90, -45, 0, 45, 90]) ok(Math.abs(E.latitudeAt(E.zOfLatitude(d)) - d) < 1e-9, `zOfLatitude round trip failed at ${d}`);

  // the zonal tables: monotone temperature, and precipitation with the double hump
  let monoT = true;
  for (let a = 0; a < 90; a++) if (E.zonalTemp(a + 1) > E.zonalTemp(a) + 1e-12) monoT = false; else pass++;
  ok(monoT, 'the zonal temperature table is not monotonically decreasing away from the equator');
  ok(E.zonalTemp(0) > 25 && E.zonalTemp(90) < -20, 'the zonal temperature range is not Earth-like');
  ok(E.zonalPrecip(25) < E.zonalPrecip(0), 'the subtropical high is not drier than the ITCZ');
  ok(E.zonalPrecip(25) < E.zonalPrecip(45), 'the subtropical high is not drier than the storm track');
  ok(E.zonalPrecip(90) < E.zonalPrecip(45), 'the pole is not drier than the storm track');
  ok(E.zonalPrecip(0) > 1500, 'the ITCZ is not wet');
  // symmetry
  for (let a = 0; a <= 90; a += 5) {
    ok(E.zonalTemp(a) === E.zonalTemp(-a), `zonal temperature is not symmetric at ${a}`);
    ok(E.zonalPrecip(a) === E.zonalPrecip(-a), `zonal precipitation is not symmetric at ${a}`);
  }

  // the lapse rate really is applied, and in the right direction
  ok(E.LAPSE_PER_BLOCK > 0.006 && E.LAPSE_PER_BLOCK < 0.007, `lapse rate ${E.LAPSE_PER_BLOCK} is not 6.5 C/km`);
  // the wind: three cells, mirrored across the equator, always a unit vector
  let unit = 0;
  for (let l = -90; l <= 90; l += 3) {
    const [we, ws] = E.windAt(l);
    if (Math.abs(we * we + ws * ws - 1) < 1e-12) unit++;
    const [me, ms] = E.windAt(-l);
    ok(Math.abs(we - me) < 1e-12, `the wind's east component is not mirrored at ${l}`);
    ok(Math.abs(ws + ms) < 1e-12 || l === 0, `the wind's meridional component is not mirrored at ${l}`);
  }
  ok(unit === 61, `${61 - unit} wind vectors are not unit length`);
  pass += unit;
  ok(E.windAt(15)[0] < 0, 'the trade winds do not blow toward the west');
  ok(E.windAt(45)[0] > 0, 'the westerlies do not blow toward the east');
  ok(E.windAt(75)[0] < 0, 'the polar easterlies do not blow toward the west');
  ok(E.windAt(15)[1] > 0, 'the northern trades do not blow toward the equator');
  ok(E.windAt(45)[1] < 0, 'the northern westerlies do not blow toward the pole');

  // PET, and the Whittaker table's shape
  ok(E.PET(25) > E.PET(5), 'evapotranspiration does not rise with temperature');
  ok(E.PET(-30) >= 150, 'the PET floor is missing — polar deserts would read as rainforest');
  let monoH = true, monoAxisT = true;
  for (let t = -35; t <= 32; t += 1) {
    let prevH = -2;
    for (let la = -1.4; la <= 0.5; la += 0.05) {
      E.whittaker(t, Math.pow(10, la));
      if (E.axisH < prevH - 1e-9) monoH = false; else pass++;
      prevH = E.axisH;
    }
  }
  ok(monoH, 'the Whittaker humidity axis is not monotone in aridity — wetter must never mean drier');
  for (let la = -1.4; la <= 0.5; la += 0.05) {
    let prevT = -2;
    for (let t = -35; t <= 32; t += 1) {
      E.whittaker(t, Math.pow(10, la));
      if (E.axisT < prevT - 1e-9) monoAxisT = false; else pass++;
      prevT = E.axisT;
    }
  }
  ok(monoAxisT, 'the Whittaker temperature axis is not monotone in temperature at fixed aridity');
  // the corner that is the whole reason the table is 2D
  E.whittaker(27, 2.0); const wet = E.axisT;
  E.whittaker(27, 0.08); const dry = E.axisT;
  ok(dry > 0.55 && wet < 0.55,
     `at 27 C the arid corner must reach vanilla's desert band and the humid corner must not: got dry ${dry.toFixed(3)}, wet ${wet.toFixed(3)}`);
}

// ─────────────────────────────────────────────── 7. the ordering test
console.log('7. the pole-to-equator ordering test');

// Köppen-ish zone per biome, hand-assigned. Only the biomes whose placement is a CLIMATE fact
// get a zone; the ones placed by erosion, altitude or continentalness alone (peaks, beaches,
// rivers, mushroom fields, caves, the windswept family) are deliberately unzoned, because
// including them would let altitude noise decide whether the test passes.
const ZONE = {
  snowy_plains: 0, ice_spikes: 0, snowy_beach: 0, frozen_river: 0, snowy_taiga: 0,
  frozen_ocean: 0, deep_frozen_ocean: 0,
  taiga: 1, old_growth_spruce_taiga: 1, old_growth_pine_taiga: 1, cold_ocean: 1, deep_cold_ocean: 1,
  forest: 2, birch_forest: 2, old_growth_birch_forest: 2, dark_forest: 2, plains: 2,
  sunflower_plains: 2, flower_forest: 2, meadow: 2, ocean: 2, deep_ocean: 2,
  savanna: 3, savanna_plateau: 3, desert: 3, badlands: 3, eroded_badlands: 3,
  wooded_badlands: 3, lukewarm_ocean: 3, deep_lukewarm_ocean: 3,
  jungle: 4, sparse_jungle: 4, bamboo_jungle: 4, warm_ocean: 4,
};

/**
 * The test itself, as a function, because section 10 has to be able to run it against a mode
 * that must NOT pass it. Returns the median zone per 5-degree band from the pole to the
 * equator, plus where the deserts and jungles ended up.
 */
function transect(mode) {
  CL.setMode(mode);
  const bands = [];
  for (let i = 0; i < 18; i++) bands.push([]);
  const desertLat = [], jungleLat = [], oceanZone = [];
  for (let i = 0; i < 18; i++) { oceanZone.push([]); }
  for (let li = 0; li < 18; li++) {
    const centre = li * 5 + 2.5;
    for (const sign of [1, -1]) {
      for (let k = 0; k < 90; k++) {
        const z = Math.round(E.zOfLatitude(sign * (centre + ((k % 9) - 4) * 0.5)));
        const x = ((k * 3137) % 24000) - 12000;
        const name = short(CL.biomeNames[CL.surfaceBiomeAt(x, z)]);
        const zn = ZONE[name];
        if (zn !== undefined) bands[li].push(zn);
        if (name.includes('ocean')) oceanZone[li].push(zn);
        if (name === 'desert' || name.startsWith('badlands') || name === 'eroded_badlands') desertLat.push(centre);
        if (name.includes('jungle')) jungleLat.push(centre);
      }
    }
  }
  const median = bands.map((b) => { if (!b.length) return null; const s = b.slice().sort((p, r) => p - r); return s[s.length >> 1]; });
  return { median, desertLat, jungleLat, oceanZone, counts: bands.map((b) => b.length) };
}

let earthOrdered;
{
  const t = transect(CL.MODE_EARTH);
  ok(t.counts.every((c) => c > 20), `a latitude band had too few zoned columns to judge: ${t.counts.join(' ')}`);
  // THE ORDERING TEST. Bands run pole (index 17) to equator (index 0); the median zone must
  // never step backwards as latitude falls.
  let steps = 0, back = 0;
  for (let i = 17; i > 0; i--) {
    if (t.median[i] === null || t.median[i - 1] === null) continue;
    steps++;
    if (t.median[i - 1] < t.median[i]) { back++; if (back < 4) fails.push(`band ${(i - 1) * 5}-${i * 5} is zone ${t.median[i - 1]} but the colder band ${i * 5}-${i * 5 + 5} is zone ${t.median[i]}`); }
    else pass++;
  }
  earthOrdered = back === 0;
  ok(earthOrdered, `${back} of ${steps} latitude steps run the wrong way — the band order is not Köppen-plausible`);
  // and it must actually SPAN the zones, not sit flat
  ok(t.median[0] >= 3, `the tropics came out zone ${t.median[0]}`);
  ok(t.median[17] === 0, `the pole came out zone ${t.median[17]}`);
  ok(new Set(t.median.filter((m) => m !== null)).size >= 4, 'the transect covers fewer than four climate zones');

  // the subtropical desert belt: the reason the P_ZONAL table has a minimum at 25 degrees
  const inBelt = t.desertLat.filter((l) => l >= 12.5 && l <= 37.5).length;
  ok(t.desertLat.length > 20, `only ${t.desertLat.length} desert/badlands columns in the whole transect`);
  ok(inBelt / t.desertLat.length > 0.75,
     `only ${(100 * inBelt / t.desertLat.length).toFixed(0)}% of desert columns are between 12.5 and 37.5 degrees`);
  // the tropics own the jungle
  const inTropics = t.jungleLat.filter((l) => l <= 27.5).length;
  ok(t.jungleLat.length > 20, `only ${t.jungleLat.length} jungle columns in the whole transect`);
  ok(inTropics / t.jungleLat.length > 0.85,
     `only ${(100 * inTropics / t.jungleLat.length).toFixed(0)}% of jungle columns are within 27.5 degrees of the equator`);
  // the sea warms toward the equator too, which is what T_SEA is for
  const oceanMed = t.oceanZone.map((b) => { const s = b.filter((v) => v !== undefined).sort((p, r) => p - r); return s.length ? s[s.length >> 1] : null; });
  let oBack = 0;
  for (let i = 17; i > 0; i--) if (oceanMed[i] !== null && oceanMed[i - 1] !== null && oceanMed[i - 1] < oceanMed[i]) oBack++; else pass++;
  ok(oBack === 0, `the ocean temperature runs backwards at ${oBack} latitude steps`);
  if (PRINT) {
    console.log('   |lat|  ' + t.median.map((m, i) => String(i * 5).padStart(4)).join(''));
    console.log('   zone   ' + t.median.map((m) => String(m === null ? '-' : m).padStart(4)).join(''));
  }
}

// ─────────────────────────────────────────────── 8. every biome still exists
console.log('8. every one of the 50 biomes is reachable in both modes');
{
  for (const mode of [CL.MODE_VANILLA, CL.MODE_EARTH]) {
    CL.setMode(mode);
    // ⚠ The STRIDE matters more than the column count. Three of the fifty biomes need a
    // combination that is rare on every axis at once — `wooded_badlands` wants the hot band,
    // humidity band 3, erosion below -0.375 and weirdness below -0.9333 simultaneously — so a
    // tight grid of 45,000 columns over 14 km misses it while a coarse grid of 26,741 over
    // 73 km finds it. Sample the parameter space, not the neighbourhood.
    const seen = Object.create(null);
    for (let zi = -110; zi <= 110; zi++) {
      for (let xi = -60; xi <= 60; xi++) {
        const z = zi * 331, x = xi * 733;
        seen[CL.biomeNames[CL.surfaceBiomeAt(x, z)]] = 1;
        if (((xi + zi) & 3) === 0) {
          const y = C.height(x, z);
          seen[CL.biomeNames[CL.biomeAt(x, y - 60, z)]] = 1;
          seen[CL.biomeNames[CL.biomeAt(x, y - 100, z)]] = 1;
          seen[CL.biomeNames[CL.biomeAt(x, y - 150, z)]] = 1;
        }
      }
    }
    // ⚠ The 50 the TABLE dispatches to, not the 61 in the registry. The other eleven belong to
    // the Nether, the End and the void, and no overworld climate can reach them — asserting
    // over `biomeNames` (which is the registry after binding) fails on all eleven and says
    // nothing about the mode.
    const missing = CL.tableBiomeNames.filter((b) => !seen[b]);
    for (const b of CL.tableBiomeNames) if (seen[b]) pass++;
    ok(missing.length === 0,
       `${CL.MODE_NAMES[mode]} mode never places: ${missing.map(short).join(' ')} — a mode that deletes a biome deletes its features, mobs and loot with it`);
    if (PRINT) console.log(`   ${CL.MODE_NAMES[mode]}: ${50 - missing.length}/50`);
  }
}

// ─────────────────────────────────────────────── 9. speed
console.log('9. cost');
{
  CL.setMode(CL.MODE_VANILLA);
  const q = new Int32Array(7);
  let t0 = Date.now();
  for (let i = 0; i < 200000; i++) { q[0] = (i * 7919) % 20000 - 10000; CL.searchEntry(q); }
  const treeUs = (Date.now() - t0) * 1000 / 200000;
  t0 = Date.now();
  for (let i = 0; i < 3000; i++) { q[0] = (i * 7919) % 20000 - 10000; CL.searchEntryLinear(q); }
  const linUs = (Date.now() - t0) * 1000 / 3000;
  ok(treeUs < linUs / 4, `the R-tree (${treeUs.toFixed(2)} us) is not meaningfully faster than a linear scan (${linUs.toFixed(2)} us)`);
  // Scaled by the linear scan's own slowdown (~35 us on an idle box): a flat 12 us went red at 31 us under load (#1932).
  const LIN_REF = 35;
  ok(treeUs < 12 * Math.max(1, linUs / LIN_REF), `a biome lookup costs ${treeUs.toFixed(2)} us; a chunk asks 1,536 times`);
  const t1 = Date.now();
  initClimate(bpBin);
  const initMs = Date.now() - t1;
  // ⚠⚠ **A WALL-CLOCK BUDGET IS A MEASUREMENT OF THE HOST, NOT OF THE PROGRAM.** This was a flat
  // `< 120` and it went red at **175 ms** on a build that had not touched Climate: forty leaked
  // Chromium processes from earlier browser stages had the two-core box at load average ten
  // (D-322). The budget is a real one — `Climate.init` runs on the main thread AND in every
  // worker — but 120 ms is 120 ms *on a quiet machine of a particular speed*, and this check has
  // no way to know it is on one.
  //
  // ⚠ SO IT IS SCALED BY A SPEED THIS RUN MEASURED ITSELF. `treeUs` is the per-lookup cost of the
  // R-tree, timed twenty lines above over 200,000 queries in this same process; on a quiet box it
  // is about `TREE_REF` and under load it rises in step with everything else. The budget keeps its
  // 120 ms meaning on a reference-speed host and stretches on a slow one, which is what a
  // portable performance gate looks like.
  const TREE_REF = 2.0;                       // us/lookup on an idle two-core cloud container
  const slow = Math.max(1, treeUs / TREE_REF);
  const budget = Math.round(120 * slow);
  console.log(`   init ${initMs} ms against a ${budget} ms budget (host measured ${slow.toFixed(2)}x the reference)`);
  ok(initMs < budget,
     `Climate.init took ${initMs} ms against a ${budget} ms budget — it runs on the main thread ` +
     `and in every worker (this host measured ${slow.toFixed(2)}x the reference speed)`);
  console.log(`   tree ${treeUs.toFixed(2)} us · linear ${linUs.toFixed(2)} us · init ${CL.decodeMs} ms · ${(bpMeta.packedBytes / 1024).toFixed(1)} KB deflated`);
}

// ─────────────────────────────────────────────── 10. anti-vacuity
console.log('10. anti-vacuity — every check above must be able to fail');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('a corrupted R-tree bounding box', () => {
    // Shrink every internal node's box by a hair. The tree still searches, but the prune is
    // now wrong: subtrees that hold the true nearest get skipped. If section 2 cannot see
    // that, section 2 is not testing the tree at all.
    const good = inflateRawSync(bpBin);
    const bad = Buffer.from(good);
    const n = bad.readUInt32LE(8), nb = bad.readUInt32LE(12), nodes = bad.readUInt32LE(16);
    let head = 24 + nb; if (head & 1) head++;
    const nspOff = head + n * 14 * 2;
    for (let i = 0; i < nodes * 14; i += 2) {
      bad.writeInt16LE(bad.readInt16LE(nspOff + i * 2) + 700, nspOff + i * 2);
      bad.writeInt16LE(bad.readInt16LE(nspOff + i * 2 + 2) - 700, nspOff + i * 2 + 2);
    }
    initClimate(deflateRawSync(bad, { level: 1 }));
    const q = new Int32Array(7);
    let worse = 0;
    let s = 0x2f6e2b1 >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 4000; i++) {
      for (let a = 0; a < 6; a++) q[a] = Math.round((rnd() * 2.6 - 1.3) * 10000);
      q[6] = 0;
      if (CL.entryDist(CL.searchEntry(q), q) > CL.entryDist(CL.searchEntryLinear(q), q)) worse++;
    }
    initClimate(bpBin);
    if (worse === 0) return;      // NOT caught — section 2 would have missed this
    throw 0;
  });

  check('a truncated blob', () => {
    const good = inflateRawSync(bpBin);
    const bad = good.subarray(0, good.length - 8);
    try { initClimate(deflateRawSync(bad, { level: 1 })); } finally { initClimate(bpBin); }
    // reaching here means a short blob decoded happily, which the header arithmetic must reject
  });

  check('the depth axis back on vanilla\'s literal formula', () => {
    // W3's own surface, put through `1 - y/128 + offset` instead of `(surfaceY - y)/128`.
    // This is exactly the bug section 4 exists to catch, reproduced.
    CL.setMode(CL.MODE_VANILLA);
    const t = new Float64Array(6), scratch = new Float64Array(6);
    let caves = 0;
    for (let i = 0; i < 600; i++) {
      const x = ((i * 977) % 6000) - 3000, z = ((i * 613) % 6000) - 3000;
      C.climateInto(x, z, scratch);
      const y = C.height(x, z);
      t[0] = scratch[4]; t[1] = scratch[5]; t[2] = scratch[0]; t[3] = scratch[1];
      t[4] = CL.depthGradient(y) + C.offsetAt(scratch);           // the wrong one
      t[5] = scratch[2];
      const b = short(CL.biomeNames[CL.biomeOfTarget(t)]);
      if (b === 'lush_caves' || b === 'dripstone_caves') caves++;
    }
    if (caves === 0) return;       // NOT caught: section 4's cave assertion proves nothing
    throw 0;
  });

  check('the ordering test run against the vanilla mode', () => {
    // The most important one. Vanilla's climate has no idea which way is north, so if the
    // ordering test can pass on it, the ordering test is measuring nothing.
    const t = transect(CL.MODE_VANILLA);
    let back = 0;
    for (let i = 17; i > 0; i--) if (t.median[i] !== null && t.median[i - 1] !== null && t.median[i - 1] < t.median[i]) back++;
    if (back === 0) return;        // NOT caught
    throw 0;
  });

  check('a flattened zonal temperature table', () => {
    const saved = E.T_ZONAL.map((r) => r.slice());
    for (const r of E.T_ZONAL) r[1] = 15;
    let back = 0;
    try {
      const t = transect(CL.MODE_EARTH);
      for (let i = 17; i > 0; i--) if (t.median[i] !== null && t.median[i - 1] !== null && t.median[i - 1] < t.median[i]) back++;
      // a world at a uniform 15 C should also lose its poles entirely
      if (t.median[17] === 0 && back === 0) return;   // NOT caught
    } finally {
      for (let i = 0; i < saved.length; i++) E.T_ZONAL[i][1] = saved[i][1];
    }
    throw 0;
  });

  check('a flattened zonal precipitation table', () => {
    const saved = E.P_ZONAL.map((r) => r.slice());
    for (const r of E.P_ZONAL) r[1] = 900;
    try {
      const t = transect(CL.MODE_EARTH);
      const inBelt = t.desertLat.filter((l) => l >= 12.5 && l <= 37.5).length;
      if (t.desertLat.length > 20 && inBelt / t.desertLat.length > 0.75) return;   // NOT caught
    } finally {
      for (let i = 0; i < saved.length; i++) E.P_ZONAL[i][1] = saved[i][1];
    }
    throw 0;
  });

  check('the lapse rate switched off', () => {
    // Without it, nothing is colder for being higher, which is the one thing Earth mode can do
    // that vanilla structurally cannot.
    CL.setMode(CL.MODE_EARTH);
    const z = Math.round(E.zOfLatitude(45));
    let differed = 0;
    for (let i = 0; i < 400; i++) {
      const x = i * 313 - 60000;
      const r = E.report(x, z);
      if (r.surfaceY > 120 && Math.abs(r.tempC - E.zonalTemp(r.latitude)) > 0.3) differed++;
    }
    if (differed === 0) return;    // NOT caught: no high ground was ever colder
    throw 0;
  });

  check('the sea temperature map removed', () => {
    // warm_ocean is reachable in Earth mode only because of T_SEA. Prove that dependence.
    const saved = E.T_SEA.map((r) => r.slice());
    for (const r of E.T_SEA) r[1] = 0.0;
    try {
      CL.setMode(CL.MODE_EARTH);
      let warm = 0;
      for (let i = 0; i < 4000; i++) {
        const z = Math.round(E.zOfLatitude(((i % 21) - 10) * 1.2));
        const x = ((i * 3137) % 40000) - 20000;
        if (short(CL.biomeNames[CL.surfaceBiomeAt(x, z)]) === 'warm_ocean') warm++;
      }
      if (warm > 0) return;        // NOT caught
    } finally {
      for (let i = 0; i < saved.length; i++) E.T_SEA[i][1] = saved[i][1];
    }
    throw 0;
  });

  check('a world scale outside its bounds', () => { E.init({ scale: 10 }); });
  check('an unknown climate mode', () => { CL.setMode(7); });

  check('the hand-written reference disagreeing with the table', () => {
    // If section 3's comparison were somehow vacuous — comparing a value to itself — this
    // deliberate wrong answer would pass. It must not.
    const q = new Int32Array(7);
    q[0] = 7750; q[1] = 0; q[2] = 4000; q[3] = 2500; q[4] = 0; q[5] = -5000; q[6] = 0;
    const got = short(CL.biomeNames[CL.entryBiome(CL.searchEntry(q))]);
    if (got === 'jungle') return;  // NOT caught — the hot/arid cell is desert, not jungle
    throw 0;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

CL.setMode(CL.MODE_VANILLA);
console.log('');
console.log('================ climcheck ================');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
