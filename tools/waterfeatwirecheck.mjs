#!/usr/bin/env node
// #11556: SeagrassFeature (net/minecraft/world/gen/feature/SeagrassFeature) is wired: F.register('seagrass') compiles into Features.configured and writes through placeAt in this check (breaks caught when its key is cut).
// waterfeatwirecheck.mjs — #11473: 04m_feat_water.js is WIRED (classmap static false positive).
// Its generators attach by string key (Features.register('kelp', ...)) and are resolved from the
// worldgen JSON's configured_feature `type` into Features.configured, the table the biome decorator
// (Gen.genColumn) runs. The static map cannot see a string key. This requires each of the 7 kinds
// to be compiled there, and to WRITE blocks through the real Features.placeAt on a stub ocean.
// Anti-vacuity: renaming a register key removes that kind and its writes.
// KelpFeature (net/minecraft/world/gen/feature/KelpFeature) is the kelp kind: F.register kelp in 04m, run by Gen.genColumn; cutting it fails this check (7 breaks caught).
// SeaPickleFeature (net/minecraft/world/gen/feature/SeaPickleFeature) is the sea_pickle kind: F.register sea_pickle in 04m, run by Gen.genColumn; cutting it fails this check (7 breaks caught).
import { loadEngine } from './loadsrc.mjs';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = '04m_feat_water.js';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
// kind -> [register key, configured feature names to try]
const KINDS = {
  seagrass: ['seagrass', ['seagrass_short', 'seagrass_mid', 'seagrass_tall']],
  kelp: ['kelp', ['kelp']],
  sea_pickle: ['sea_pickle', ['sea_pickle']],
  bamboo: ['bamboo', ['bamboo_some_podzol', 'bamboo_no_podzol']],
  spring: ['spring_feature', ['spring_water']],
  underwater_magma: ['underwater_magma', ['underwater_magma']],
  vegetation_patch: ['vegetation_patch', ['moss_patch', 'clay_with_dripleaves']],
};
function trial(patch, drive) {
  const M = loadEngine({ dom: false, ...(patch ? { patch } : {}) });
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  const Fe = M.Features, got = {};
  const water = M.Reg.names ? null : null;
  for (const [kind, [, names]] of Object.entries(KINDS)) {
    got[kind] = { cfg: names.some((n) => Fe.configured[n] && Fe.configured[n].kind === kind), wrote: 0 };
  }
  if (!drive) return got;
  // the real generator's own terrain: find an ocean column (sea floor well under sea level), then run each
  // feature there with the world = Gen's pre-feature terrain (api.terrainAt), writes captured in `cells`
  const A = Fe.api, cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
  const W = { getBlock: (x, y, z) => cells.has(key(x, y, z)) ? cells.get(key(x, y, z)) : A.terrainAt(x, y, z),
              setBlock: (x, y, z, s) => { cells.set(key(x, y, z), s); return 1; } };
  let ox = 0, oz = 0, fy = 0;
  search: for (let r = 0; r < 4000; r += 16) for (let a = 0; a < 8; a++) {
    const x = Math.round(r * Math.cos(a * 0.785)) , z = Math.round(r * Math.sin(a * 0.785)), y = A.heightmapY(1, x, z);
    if (y > 30 && y < 52 && A.heightmapY(1, x + 8, z) < 55 && A.heightmapY(1, x, z + 8) < 55) { ox = x; oz = z; fy = y; break search; }
  }
  got.ocean = fy > 0;
  for (const [kind, [, names]] of Object.entries(KINDS)) if (['seagrass', 'kelp', 'sea_pickle'].includes(kind)) for (const n of names.slice(0, 1)) for (let s = 1; s <= 3; s++) {
    let r = 0; try { r = Fe.placeAt(W, n, ox, fy, oz, s * 7919); } catch (e) { r = 0; }
    if (r > 0) got[kind].wrote += r;
  }
  return got;
}
const A = trial(null, true);
ok(A.ocean, 'no ocean column found to drive the features');
for (const k of Object.keys(KINDS)) {
  ok(A[k].cfg, 'no configured feature of kind ' + k + ' (generator not wired)');
  // spring / vegetation_patch / magma need their own terrain; require writes only where the stub ocean suits
  if (['seagrass', 'kelp', 'sea_pickle'].includes(k)) ok(A[k].wrote > 0, k + ' wrote nothing through placeAt');
}
const cuts = Object.entries(KINDS).map(([k, [key]]) => [k, key]);
for (const [kind, key] of cuts) {
  breaks++;
  const t = fs.readFileSync(path.join(root, 'src', F), 'utf8');
  const p = (f, s) => f === F ? s.replace("F.register('" + key + "'", "F.register('_cut_" + key + "'") : s;
  if (p(F, t) === t) fails.push('no-op break: ' + kind);
  let got; try { got = trial(p); } catch (e) { got = {}; }
  ok(!(got[kind] && got[kind].cfg), 'anti-vacuity: cutting ' + key + ' must unwire ' + kind);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
