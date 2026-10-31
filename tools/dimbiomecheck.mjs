#!/usr/bin/env node
// dimbiomecheck.mjs — PLAN G27b: the Nether and End biome sources (src/04y_biome_dims.js).
//
// No real-1.18.2 Nether/End chunk goldens exist under the referee, so this is a PINNED-TABLE
// check: the Nether preset's five points are typed here from MultiNoiseBiomeSource.java, and
// the End's answers at fixed seeds/positions are pinned from a run whose algorithm was
// transcribed line-by-line from TheEndBiomeSource.getNoiseAt (float rounding, Java int `/` `%`).
// Anti-vacuity (D-30): the whole battery is rerun against deliberately broken sources.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02d_wgdata.js', '03b_noise.js'];
const dimsSrc = readFileSync(join(SRC, '04y_biome_dims.js'), 'utf8');

function load(mutate) {
  const NS = { CFG: {} };
  globalThis.MCL = NS;
  for (const f of FILES) new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
  new Function('MCL', mutate ? mutate(dimsSrc) : dimsSrc)(NS);
  return NS.BiomeDims;
}

const POS = [[0, 0], [600, 0], [1500, -1500], [-2000, 3000], [3000, 3001], [-4000, -4000], [1000, 1000], [-1000, -1000], [2400, 0], [-321, 2000]];
const PIN = {
  '0': 'the_end,end_highlands,small_end_islands,end_highlands,end_midlands,end_highlands,end_midlands,end_midlands,end_highlands,end_barrens',
  '1234567890123': 'the_end,end_midlands,end_midlands,small_end_islands,small_end_islands,small_end_islands,small_end_islands,small_end_islands,small_end_islands,end_midlands',
  '-5': 'the_end,end_highlands,end_midlands,small_end_islands,end_midlands,small_end_islands,small_end_islands,small_end_islands,end_highlands,end_barrens',
};
const COUNTS0 = 'end_barrens:113,end_highlands:180,end_midlands:285,small_end_islands:506,the_end:5';

function run(D) {
  const bad = [];
  const ck = (c, m) => { if (!c) bad.push(m); };
  // Nether: typed from Preset.NETHER (temperature, humidity, ..., offset).
  const pts = [['nether_wastes', 0, 0, 0], ['soul_sand_valley', 0, -0.5, 0], ['crimson_forest', 0.4, 0, 0],
               ['warped_forest', 0, 0.5, 0.375], ['basalt_deltas', -0.5, 0, 0.175]];
  for (const [n, t, h] of pts) ck(D.netherBiome(t, h, 0, 0, 0, 0) === n, 'nether point ' + n);
  const Q = [[0.05, 0.05, 'nether_wastes'], [0.3, 0.1, 'crimson_forest'], [-0.4, -0.1, 'basalt_deltas'],
             [0.0, -0.9, 'soul_sand_valley'], [0.0, 0.9, 'warped_forest'], [0.0, 0.25, 'nether_wastes'],
             [0.0, 0.3, 'nether_wastes'], [0.0, 0.4, 'warped_forest'], [0.2, 0, 'nether_wastes'], [0.20009, 0, 'nether_wastes'], [-0.3, 0.0, 'basalt_deltas'], [-0.3, -0.3, 'soul_sand_valley'],
             [0.9, 0.9, 'crimson_forest'], [1, -1, 'soul_sand_valley']];
  for (const [t, h, n] of Q) ck(D.netherBiome(t, h, 0, 0, 0, 0) === n, `nether (${t},${h}) -> ${n}, got ${D.netherBiome(t, h, 0, 0, 0, 0)}`);
  // End
  for (const seed of Object.keys(PIN)) {
    const s = D.endSource(BigInt(seed));
    ck(POS.map(([x, z]) => s.biomeAt(x, 0, z)).join(',') === PIN[seed], 'end pins seed ' + seed);
  }
  const s0 = D.endSource(0n), cnt = {};
  for (let x = -4000; x <= 4000; x += 250) for (let z = -4000; z <= 4000; z += 250) { const b = s0.biomeAt(x, 0, z); cnt[b] = (cnt[b] || 0) + 1; }
  ck(Object.keys(cnt).sort().map(k => k + ':' + cnt[k]).join(',') === COUNTS0, 'end census seed 0');
  // structure: centre island is exactly quart radius 64 (256 blocks)
  ck(s0.biomeAt(255, 0, 0) === 'the_end' && s0.biomeAt(0, 0, -256) === 'the_end', 'end centre edge inside');
  ck(s0.biomeAt(256, 0, 256) !== 'the_end', 'end centre corner outside');
  // noise is a pure function of (seed, x, z)
  ck(D.endSource(7n).biomeAt(900, 5, -900) === D.endSource(7n).biomeAt(900, 200, -900), 'end ignores y');
  return bad;
}

const base = run(load());
let breaks = 0, missed = [];
const MUT = [
  ['nether point moved', s => s.replace("'crimson_forest',    0.4,", "'crimson_forest',    0.3,")],
  ['nether tie order', s => s.replace('if (s < best)', 'if (s <= best)')],
  ['nether offset dropped', s => s.replace('s += p[6] * p[6];', '')],
  ['nether truncation->round', s => s.replace(/Math\.trunc\(fr\(f\) \* 10000\)/g, 'Math.round(fr(f) * 10000)')],
  ['end skip count', s => s.replace('consume(17292)', 'consume(17291)')],
  ['end radius', s => s.replace('ISLAND_RADIUS2 = 4096', 'ISLAND_RADIUS2 = 4095')],
  ['end java % as mod', s => s.replace('var rx = x % 2, rz = z % 2;', 'var rx = ((x % 2) + 2) % 2, rz = ((z % 2) + 2) % 2;')],
  ['end java / as floor', s => s.replace('Math.trunc(x / 2), cz = Math.trunc(z / 2)', 'Math.floor(x / 2), cz = Math.floor(z / 2)')],
  ['end threshold', s => s.replace('n > 40', 'n > 41')],
  ['end island size', s => s.replace('fr(m + 9)', 'fr(m + 10)')],
];
for (const [name, f] of MUT) {
  const m = f(dimsSrc);
  if (m === dimsSrc) { missed.push(name + ' (mutation did not apply)'); continue; }
  let bad;
  try { bad = run(load(f)); } catch (e) { bad = [String(e)]; }
  if (bad.length) breaks++; else missed.push(name);
}
if (base.length || missed.length) {
  for (const b of base) console.log('FAIL ' + b);
  for (const m of missed) console.log('NOT CAUGHT ' + m);
  process.exit(1);
}
console.log(`dimbiomecheck: nether preset + end source ok, ${breaks} breaks caught`);
