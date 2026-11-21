#!/usr/bin/env node
// terrainfeatwirecheck.mjs — #11476: 04n_feat_terrain.js is WIRED (classmap static false positive). Its generators attach by
// LakeFeature (net/minecraft/world/gen/feature/LakeFeature) is the lake kind: F.register lake in 04n, run by Gen.genColumn; cutting it fails this check (4 breaks caught).
// string key (F.register('lake', ...)) and are resolved from the overworld biomes' placed_feature JSON by type,
// then run by G.genColumn (overworld biomes -> decoration). The map cannot follow a string key.
//   1. generating real overworld columns through G.genColumn, each of the four features' run() is called AND places blocks
//   2. anti-vacuity: renaming a register key (or neutering the module) makes that feature stop running
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const KEYS = ['lake', 'geode', 'desert_well', 'root_system'];
const PLACES = new Set(['lake', 'geode', 'desert_well', 'root_system']);
const RAN = (H, k) => PLACES.has(k) ? !!(H[k] && H[k][1] > 0) : !!(H[k] && H[k][0] > 0);
const HOOK = "var __r0 = F.register; F.register = function (k, mk) { return __r0.call(F, k, function (c, n) { var o = mk(c, n); if (o && o.run) { var r = o.run; o.run = function () { var v = r.apply(this, arguments); var H = (NS.__hits = NS.__hits || {}); H[k] = H[k] || [0, 0]; H[k][0]++; if (v > 0) H[k][1]++; return v; }; } return o; }); };\n";
function trial(extra) {
  const M = loadEngine({ extra: ['07l_spawn.js'], dom: false, patch: (f, t) => {
    if (f !== '04n_feat_terrain.js') return t;
    t = t.replace('var F = NS.Features;', 'var F = NS.Features;\n' + HOOK);
    return extra ? extra(t) : t;
  } });
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
    const left = new Set(KEYS);
  for (let cz = -40; cz < 40; cz += 1) for (let cx = -40; cx < 40; cx += 1) {
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
