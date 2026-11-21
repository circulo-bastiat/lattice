#!/usr/bin/env node
// singlebiomecheck.mjs — #11327: Single Biome world type (vanilla FixedBiomeSource over the overworld noise settings).
// Classes proved: net/minecraft/world/biome/source/FixedBiomeSource (fixedBiome) and MultiNoiseBiomeSource (the default world: several biomes, fixed source off again).
// Drives the REAL path (G.init params.fixedBiome -> G.genColumn): every column reports the one biome, while terrain height
// still comes from the climate noise (identical to the default world's, not flat). Anti-vacuity: 3 breaks.
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
console.log('singlebiomecheck -- #11327, FixedBiomeSource buffet through G.genColumn');
const COLS = [[0, 0], [7, 3], [-12, 9], [30, -25], [-60, -60], [101, 55]];
function audit(M) {
  const R = {};
  const run = (fixed) => { M.Gen.init(4242, fixed ? { fixedBiome: fixed } : {}); return COLS.map(([cx, cz]) => M.Gen.genColumn(cx, cz)); };
  const base = run(null);
  for (const name of ['minecraft:desert', 'minecraft:ocean']) {
    const idx = M.Biomes.indexOf[name];
    const cols = run(name);
    R['one biome ' + name] = cols.every((c) => c.biome.every((b) => b === idx));
    const hs = new Set(); cols.forEach((c) => c.hmap.forEach((h) => hs.add(h)));
    R['terrain not flat ' + name] = hs.size > 8;
    // hmap (offset by minY 64) is the surface AFTER water/features, so compare with the climate noise's own height (sea fills to 62, trees/cacti add a few)
    let near = 0, n = 0;
    cols.forEach((c, k) => { const [cx, cz] = COLS[k]; for (let i = 0; i < 256; i += 5) { const h = M.Column.height((cx << 4) + (i & 15), (cz << 4) + (i >> 4)); n++; if (Math.abs(c.hmap[i] - 64 - Math.max(h, 62)) <= 20) near++; } });
    R['terrain = climate height ' + name] = near / n > 0.9;
  }
  R['default world has several biomes'] = new Set(base.flatMap((c) => [...c.biome])).size > 2;
  M.Gen.init(4242, {});
  R['fixed source off again'] = M.Climate.fixedBiome === -1;
  return R;
}
const real = audit(loadEngine());
for (const [k, v] of Object.entries(real)) ok(v, 'real: ' + k);
const brk = (name, file, from, to, expect) => {
  let M2;
  try { M2 = loadEngine({ patch: (f, s) => { if (f !== file) return s; if (!s.includes(from)) throw new Error('break did not match: ' + name); return s.replace(from, to); } }); } catch (e) { ok(false, e.message); return; }
  let bad; try { bad = Object.entries(audit(M2)).filter(([, v]) => !v).map(([k]) => k); } catch (e) { bad = ['throws']; }
  if (ok(bad.length > 0 && bad.some((k) => k.includes(expect)), 'BREAK NOT CAUGHT: ' + name + ' ' + bad)) { breaks++; console.log('  ✓ break caught: ' + name + '  [' + bad[0] + ']'); }
};
brk('fixed source ignored', '04_worldgen.js', 'NS.Climate.fixedBiome = fb;', '0;', 'one biome');
brk('terrain flattened', '04_worldgen.js', 'cH[i] = NS.Column.heightAndClimate(wx0, wz0, _clim) | 0;', 'cH[i] = (NS.Column.heightAndClimate(wx0, wz0, _clim) * 0 + 70) | 0;', 'terrain');
brk('tint/volume from climate', '04e_climate.js', 'if (CL.fixedBiome >= 0) { for (var f = 0;', 'if (false) { for (var f = 0;', 'one biome');
console.log('singlebiomecheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('FAIL ' + f); process.exit(1); }
