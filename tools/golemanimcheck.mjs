#!/usr/bin/env node
// golemanimcheck.mjs — #730: IronGolemEntityModel.setAngles/animateModel (.decomp) vs ER.setupAnimDelta.
// Not the humanoid walk: legs -/+1.5*wrap(l,13)*a, arms (-0.2 -/+ 1.5*wrap)*a, attack -2+1.5*wrap(t-pd,10).
import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07j_entityrender.js', '10_gfx.js', '11_gfx_webgpu.js', '12_gfx_webgl2.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(MCLITE_ROOT + 'assets/entities.json', 'utf8')) });
M.Entities.init(); M.EntityRender.init();
const ER = M.EntityRender;
const wrap = (x, p) => (Math.abs(x % p - p * 0.5) - p * 0.25) / (p * 0.25);
const kind = ER.modelKindOf('iron_golem');
let fails = 0, caught = 0;
const near = (a, b) => Math.abs(a - b) < 1e-5;
function run(mutate) {
  const bad = [];
  const G = (attack, look) => ({ attack, look, partial: 0.25 });  // #733's ctx keys (#1397)
  for (const [l, a] of [[0.7, 0.6], [5, 1], [9.3, 0.4], [14, 0.8], [30.1, 0.5]]) {
    const d = (p, g) => ER.setupAnimDelta(p, l, a, 0, 0, false, kind, { golem: g, rest: {} });
    const exp = { right_leg: -1.5 * wrap(l, 13) * a, left_leg: 1.5 * wrap(l, 13) * a,
                  right_arm: (-0.2 + 1.5 * wrap(l, 13)) * a, left_arm: (-0.2 - 1.5 * wrap(l, 13)) * a };
    for (const p in exp) { const v = d(p, G(0, 0)); if (!v || !near(v.rx, mutate(exp[p]))) bad.push(p + '@' + l); }
    for (const p of ['right_arm', 'left_arm']) {
      const v = d(p, G(7, 0)); if (!v || !near(v.rx, mutate(-2 + 1.5 * wrap(7 - 0.25, 10)))) bad.push('atk ' + p);
    }
    const r = d('right_arm', G(0, 40)), q = d('left_arm', G(0, 40));
    if (!r || !near(r.rx, mutate(-0.8 + 0.025 * wrap(40, 70))) || !q || !near(q.rx, mutate(0))) bad.push('look');
  }
  return bad;
}
if (kind !== 'humanoid') console.log('note: kind=' + kind);
const bad = run(x => x);
if (bad.length) { fails++; console.log('FAIL: ' + bad.slice(0, 5).join(', ')); }
for (const m of [x => x + 0.1, x => -x, x => x * 1.4]) if (run(m).length) { caught++; console.log('   ✓ break caught'); }
if (caught < 3) { fails++; console.log('anti-vacuity: only ' + caught + '/3 breaks caught'); }
console.log(`golemanimcheck: ${fails ? 0 : 1} checks passed, ${fails} failures, ${caught} breaks caught`);
process.exit(fails ? 1 : 0);
