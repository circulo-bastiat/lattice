#!/usr/bin/env node
// silverfishwigglecheck.mjs — #851: silverfish/endermite segments wiggle from age alone
// (Silverfish/EndermiteEntityModel.setAngles, .decomp), layers copy body[2]/[4]/[1].
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
  '10_gfx.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
const mm = JSON.parse(readFileSync(join(ASSETS, 'models.meta.json'), 'utf8'));
M.BEModel.init({ models: readFileSync(join(ASSETS, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
const BE = M.BEModel, ER = M.EntityRender;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-5;
const body = (i, age, Y, P) => { const ph = age * 0.9 + i * 0.15 * Math.PI, a = Math.abs(i - 2);
  return { yaw: Math.cos(ph) * Math.PI * Y * (1 + a), px: Math.sin(ph) * Math.PI * P * a }; };
function run(layerName, Y, P, layerMap, tag, o) {
  const L = BE.layer(layerName);
  o(!!L, tag + ' layer exists'); if (!L) return;
  o(ER.modelKindOf(layerName) === layerName, tag + ' kind is ' + layerName);
  for (const age of [0, 10, 37.5]) {
    const seen = {};
    for (const p of L.parts) {
      const d = ER.setupAnimDelta(p.n, 0, 0, 0, 0, false, ER.modelKindOf(layerName), { rest: p, ageInTicks: age });
      const i = +p.n.slice(3), lay = p.tu >= 20 && layerName === 'silverfish';
      const src = body(lay ? layerMap[i] : i, age, Y, P);
      o(!!d && near(d.ry, src.yaw), tag + ' ' + p.n + (lay ? ' layer' : '') + ' yaw @' + age);
      const wantPx = (lay && i === 0) ? 0 : src.px;
      o(!!d && near(d.dpx || 0, wantPx), tag + ' ' + p.n + (lay ? ' layer' : '') + ' pivotX @' + age);
      seen[p.n + p.tu] = d && d.ry;
    }
  }
  const a0 = ER.setupAnimDelta('seg0', 0, 0, 0, 0, false, layerName, { rest: L.parts[0], ageInTicks: 0 });
  const a1 = ER.setupAnimDelta('seg0', 0, 0, 0, 0, false, layerName, { rest: L.parts[0], ageInTicks: 10 });
  o(a0 && a1 && a0.ry !== a1.ry, tag + ' wiggles with age alone');
}
run('silverfish', 0.05, 0.2, [2, 4, 1], 'silverfish', ok);
run('endermite', 0.01, 0.1, null, 'endermite', ok);
// anti-vacuity: break the expected constants and require failures
let caught = 0;
for (const [Y, P] of [[0.06, 0.2], [0.05, 0.3]]) {
  const f = []; run('silverfish', Y, P, [2, 4, 1], 'x', (c, m) => { if (!c) f.push(m); }); if (f.length) caught++;
}
{ const f = []; run('silverfish', 0.05, 0.2, [1, 4, 2], 'x', (c, m) => { if (!c) f.push(m); }); if (f.length) caught++; }
ok(caught === 3, 'anti-vacuity: ' + caught + '/3 breaks caught');
if (fails.length) { console.log('FAIL ' + fails.length + '\n' + fails.slice(0, 10).join('\n')); process.exit(1); }
console.log('silverfishwigglecheck: ' + pass + ' ok, ' + caught + ' breaks caught');
