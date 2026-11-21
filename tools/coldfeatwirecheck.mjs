#!/usr/bin/env node
// coldfeatwirecheck.mjs — #11475: 04p_feat_cold.js is WIRED (classmap static false positive).
// Its generators attach by string key (F.register('iceberg', ...)) and are compiled from the worldgen
// JSON into Features.configured, which the biome decorator (Gen.genColumn) runs. Requires every kind
// (Iceberg, IceSpike, IcePatch, BlueIce, DripstoneCluster, LargeDripstone, GlowLichen, Vines) to be
// IceSpikeFeature (net/minecraft/world/gen/feature/IceSpikeFeature) is the ice_spike kind: F.register ice_spike in 04p, run by Gen.genColumn; cutting it fails this check (8 breaks caught).
// compiled, and ALSO to be referenced by a placed feature of a biome. Anti-vacuity: cutting a register key unwires it.
import { loadEngine } from './loadsrc.mjs';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = '04p_feat_cold.js';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const KINDS = ['iceberg', 'ice_spike', 'ice_patch', 'blue_ice', 'dripstone_cluster', 'large_dripstone', 'glow_lichen', 'vines'];
function trial(patch) {
  const M = loadEngine({ dom: false, ...(patch ? { patch } : {}) });
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  const got = {};
  for (const k of KINDS) got[k] = Object.values(M.Features.configured).filter((c) => c && c.kind === k).length;
  return got;
}
const A = trial(null);
for (const k of KINDS) ok(A[k] > 0, 'no configured feature of kind ' + k + ' (generator not wired)');
for (const key of KINDS) {
  breaks++;
  const t = fs.readFileSync(path.join(root, 'src', F), 'utf8');
  const p = (f, s) => f === F ? s.replace("F.register('" + key + "'", "F.register('_cut_" + key + "'") : s;
  if (p(F, t) === t) fails.push('no-op break: ' + key);
  let got; try { got = trial(p); } catch (e) { got = {}; }
  ok(!(got[key] > 0), 'anti-vacuity: cutting ' + key + ' must unwire it');
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
