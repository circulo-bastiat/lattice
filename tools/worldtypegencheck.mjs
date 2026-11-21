#!/usr/bin/env node
// worldtypegencheck.mjs — #11392: amplified / large_biomes through the REAL path (Gen.init -> G.genColumn,
// the world type taken from Save.worldType the way 17_main.js hands it over), not Column.init alone.
// Soft parity (worldgen is V): asserts the data-driven settings and the terrain envelope, not blocks.
// There is no vanilla-server golden for these two types (the referee's pregen is level-type normal), so the
// expectations are the .decomp-derived worldgen data (noise_settings/amplified, *_large noises) and the
// default world generated in the same run. Four+ deliberate breaks must each be caught (D-30).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = (f) => readFileSync(ROOT + 'src/' + f, 'utf8');
const SEED = 1337n;
const COLS = [[0, 0], [5, -3], [-8, 7], [20, 20], [-25, 11], [40, -33], [60, 5], [-50, -50]];

function run(patch) {
  const fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
  const M = loadEngine({ patch });
  // Save round trip: the choice from the Create World screen survives save -> load
  const store = {};
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const SN = {}; for (const s of [rd('00_ns.js'), rd('01_util.js'), patch ? patch('16b_save.js', rd('16b_save.js')) : rd('16b_save.js')]) new Function('MCL', s)(SN);
  SN.Save.init(); SN.Player = { toJSON: () => ({}) }; SN.Hud = { say() {} };
  const wt = {};
  for (const t of ['default', 'large_biomes', 'amplified']) {
    SN.Save.reset(); SN.Save.worldType = t; SN.Save.seed = 1337; SN.Save.seed64 = SEED; SN.Save.save(false);
    SN.Save.worldType = 'default'; SN.Save.load();
    ok(SN.Save.worldType === t, 'save/load kept world type ' + t + ' (got ' + SN.Save.worldType + ')');
    // generate through the real path with the params 17_main.js builds
    const p = Object.assign(M.Gen.defaults(), { climate: 'vanilla' }); p.worldType = SN.Save.worldType || p.worldType;
    M.Gen.init(SEED, p);
    ok(M.Column.worldType === t, t + ': Gen.init reached Column.init with the type (got ' + M.Column.worldType + ')');
    const hs = [], bs = [];
    for (const [cx, cz] of COLS) { const c = M.Gen.genColumn(cx, cz); for (let i = 0; i < 256; i += 17) { hs.push(c.hmap[i]); bs.push(c.biome[i]); } }
    let ch = 0; for (let i = 1; i < bs.length; i++) if (bs[i] !== bs[i - 1]) ch++;
    wt[t] = { hs, ch, max: Math.max(...hs), mean: hs.reduce((a, b) => a + b, 0) / hs.length, ids: Object.assign({}, M.Column.noiseIds), sn: M.Column.settingsName };
  }
  // settings from the worldgen data (.decomp)
  ok(wt.default.sn === 'overworld' && wt.large_biomes.sn === 'large_biomes' && wt.amplified.sn === 'amplified', 'noise_settings names');
  ok(wt.large_biomes.ids.continentalness === 'continentalness_large' && wt.large_biomes.ids.erosion === 'erosion_large'
    && wt.large_biomes.ids.temperature === 'temperature_large' && wt.large_biomes.ids.vegetation === 'vegetation_large', 'large_biomes swaps the four noises');
  ok(wt.default.ids.continentalness === 'continentalness' && wt.amplified.ids.continentalness === 'continentalness', 'default/amplified keep the normal noises');
  for (const n of ['overworld', 'large_biomes', 'amplified']) ok(!!M.WG.get('noise_settings', n), 'worldgen data has noise_settings/' + n);
  // terrain envelope
  ok(wt.amplified.max > wt.default.max, 'amplified peaks higher than default (' + wt.amplified.max + ' vs ' + wt.default.max + ')');
  ok(wt.amplified.mean > wt.default.mean, 'amplified mean surface above default');
  ok(wt.amplified.hs.some((h, i) => h !== wt.default.hs[i]), 'amplified heights differ from default');
  ok(wt.large_biomes.hs.some((h, i) => h !== wt.default.hs[i]), 'large_biomes heights differ from default');
  ok(wt.large_biomes.ch < wt.default.ch, 'large_biomes has fewer biome changes along the samples (' + wt.large_biomes.ch + ' vs ' + wt.default.ch + ')');
  ok(wt.amplified.max <= 320 && Math.min(...wt.amplified.hs) >= 0, 'amplified heights inside the world range');
  return { fails, wt };
}
const good = run(null);
good.fails.forEach((m) => console.log('FAIL ' + m));
const breaks = [
  (f, s) => f === '04d_column.js' ? s.replace("SETTINGS = { debug: 'overworld', 'default': 'overworld', large_biomes: 'large_biomes', amplified: 'amplified'", "SETTINGS = { debug: 'overworld', 'default': 'overworld', large_biomes: 'large_biomes', amplified: 'overworld'") : s,
  (f, s) => f === '04d_column.js' ? s.replace("(worldType === 'large_biomes' && LARGE[need[i]])", "(false && LARGE[need[i]])") : s,
  (f, s) => f === '04_worldgen.js' ? s.replace("G.params.worldType || 'default'", "'default'") : s,
  (f, s) => f === '16b_save.js' ? s.replace("o.worldType === 'amplified' ||", '') : s,
  (f, s) => f === '16b_save.js' ? s.replace("worldType: S.worldType,", '') : s,
];
let caught = 0;
for (const b of breaks) { let r; try { r = run(b); } catch (e) { r = { fails: ['threw'] }; } if (r.fails.length) caught++; }
console.log((14 + 3 * 3 - good.fails.length) + ' assertions, ' + good.fails.length + ' failures · ' + caught + ' breaks caught · amp max ' + good.wt.amplified.max + ' default max ' + good.wt.default.max);
process.exit(good.fails.length || caught !== breaks.length ? 1 : 0);
