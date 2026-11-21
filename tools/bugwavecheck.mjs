#!/usr/bin/env node
// bugwavecheck.mjs — #903: silverfish/endermite segments wave (SilverfishEntityModel / EndermiteEntityModel.setAngles).
//
//
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
  '10_gfx.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(ASSETS, 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(ASSETS, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const BE = M.BEModel, ER = M.EntityRender;


// Expected values computed here from the .java formulas (.decomp Silverfish/EndermiteEntityModel.setAngles).
const wave = (i, age, k1, k2) => { const a = age * 0.9 + i * 0.15 * Math.PI, d = Math.abs(i - 2);
  return { ry: Math.cos(a) * Math.PI * k1 * (1 + d), px: Math.sin(a) * Math.PI * k2 * d }; };
const AGES = [0, 3.25, 11, 40.5];
function run(mob, o, kindFn, dl) {
  const L = BE.layer(mob);
  if (!o(!!L, mob + ' layer exists')) return;
  const sf = mob === 'silverfish', n = sf ? 7 : 4;
  o(kindFn(mob) === mob, 'modelKindOf(' + mob + ') is ' + mob);
  for (const p of L.parts) {
    let i = +p.n.slice(3);
    if (sf && p.tu === 20) i = [2, 4, 1][i];
    for (const age of AGES) {
      const d = dl(p.n, age, p), e = wave(i, age, sf ? 0.05 : 0.01, sf ? 0.2 : 0.1);
      o(!!d && Math.abs(d.ry - e.ry) < 1e-9 && Math.abs((d.dpx || 0) - e.px) < 1e-9,
        mob + ' ' + p.n + (p.tu === 20 ? '(layer)' : '') + ' age ' + age + ' yaw/pivotX');
    }
  }
  o(L.parts.length === (sf ? 10 : 4), mob + ' part count ' + L.parts.length);
}
const good = (n, age, p) => ER.setupAnimDelta(n, 0, 0, 0, 0, false, ER.modelKindOf(p.mob || 'x'), { ageInTicks: age, rest: p });
const dl = (mob) => (n, age, p) => ER.setupAnimDelta(n, 0, 0, 0, 0, false, ER.modelKindOf(mob), { ageInTicks: age, rest: p });
for (const mob of ['silverfish', 'endermite']) run(mob, ok, ER.modelKindOf, dl(mob));
const passMain = pass;
let caught = 0, breaks = 0;
const attempt = (name, kindFn, dlf) => {
  breaks++; const f = []; run('silverfish', (c, m) => { if (!c) f.push(m); return c; }, kindFn, dlf);
  if (f.length) caught++; else fails.push('break not caught: ' + name);
};
attempt('no kind', () => null, dl('silverfish'));
attempt('no delta', ER.modelKindOf, () => null);
attempt('layers not remapped', ER.modelKindOf, (n, age, p) => ER.setupAnimDelta(n, 0, 0, 0, 0, false, 'silverfish', { ageInTicks: age, rest: { tu: 0 } }));
attempt('wrong amplitude', ER.modelKindOf, (n, age, p) => { const d = dl('silverfish')(n, age, p); return d && { ry: d.ry * 0.2, dpx: d.dpx * 0.5 }; });
console.log(passMain + ' assertions, ' + fails.length + ' failures, ' + caught + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
process.exit(caught === breaks ? 0 : 1);
