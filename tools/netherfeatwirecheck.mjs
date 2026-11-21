#!/usr/bin/env node
// #11553: ReplaceBlobsFeature (net/minecraft/world/gen/feature/ReplaceBlobsFeature) is wired: F.register('netherrack_replace_blobs') runs and places blocks via G.genColumn in this check (breaks caught when its key is cut).
// #11530: BasaltColumnsFeature (net/minecraft/world/gen/feature/BasaltColumnsFeature) is wired: F.register('basalt_columns') is run by G.genColumn in this check (breaks caught when its key is cut).
// netherfeatwirecheck.mjs — #11474: 04z_feat_nether.js is WIRED (classmap static false positive). Its generators attach by
// string key (F.register('basalt_pillar', ...)) and are resolved from the Nether biomes' placed_feature JSON by type,
// then run by G.genColumn (Dim 'the_nether' -> genNetherColumn -> decoration). The map cannot follow a string key.
//   1. generating real Nether columns through G.genColumn, each of the six features' run() is called AND places blocks
//   ⚠ FINDING: basalt_columns and delta_feature are CALLED but place nothing in a real column — their placed features use
//   `count_on_every_layer`, which 04j passes through unapplied (origin y=0). Tracked in a separate issue; here they are
//   only required to RUN (the wiring), the other four to place blocks.
//   2. anti-vacuity: renaming a register key (or neutering the module) makes that feature stop running
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const KEYS = ['basalt_pillar', 'basalt_columns', 'delta_feature', 'netherrack_replace_blobs', 'glowstone_blob', 'weeping_vines'];
const PLACES = new Set(['basalt_pillar', 'netherrack_replace_blobs', 'glowstone_blob', 'weeping_vines']);
const RAN = (H, k) => PLACES.has(k) ? !!(H[k] && H[k][1] > 0) : !!(H[k] && H[k][0] > 0);
const HOOK = "var __r0 = F.register; F.register = function (k, mk) { return __r0.call(F, k, function (c, n) { var o = mk(c, n); if (o && o.run) { var r = o.run; o.run = function () { var v = r.apply(this, arguments); var H = (NS.__hits = NS.__hits || {}); H[k] = H[k] || [0, 0]; H[k][0]++; if (v > 0) H[k][1]++; return v; }; } return o; }); };\n";
function trial(extra) {
  const M = loadEngine({ extra: ['07l_spawn.js'], dom: false, patch: (f, t) => {
    if (f !== '04z_feat_nether.js') return t;
    t = t.replace('var A = F.api;', 'var A = F.api;\n' + HOOK);
    return extra ? extra(t) : t;
  } });
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  M.Dim.cur = 'the_nether';
  const left = new Set(KEYS);
  for (let cz = -24; cz < 24; cz += 2) for (let cx = -24; cx < 24; cx += 2) {
    M.Gen.genColumn(cx, cz);
    const H = M.__hits || {};
    for (const k of KEYS) if (H[k] && (PLACES.has(k) ? H[k][1] > 0 : H[k][0] > 0)) left.delete(k);
    if (!left.size) break;
  }
  M.Dim.cur = 'overworld';
  return { H: M.__hits || {}, left };
}
const A = trial();
for (const k of KEYS) ok(RAN(A.H, k), `${k}: run through G.genColumn${PLACES.has(k) ? ' and placed blocks' : ''} (${JSON.stringify(A.H[k])})`);
for (const k of KEYS) {
  breaks++;
  let g;
  try { g = trial((t) => { const a = "F.register('" + k + "'"; if (!t.includes(a)) throw new Error('cut not found: ' + a); return t.replace(a, "void ('" + k + "'"); }); }
  catch (e) { if (/cut not found/.test(e.message)) { fails.push(e.message); continue; } g = { H: {} }; }
  ok(!RAN(g.H, k), `anti-vacuity: cutting register('${k}') must stop it running`);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
