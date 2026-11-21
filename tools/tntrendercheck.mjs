#!/usr/bin/env node
// tntrendercheck.mjs -- #5086: TntEntityRenderer per-frame scale + white flash vs the vanilla functions.
import { loadEngine } from './loadsrc.mjs';
console.log('tntrendercheck -- #5086');
const vs = (fuse, pt) => { const f = fuse - pt + 1; if (f >= 10) return 1; let s = Math.min(1, Math.max(0, 1 - f / 10)); s = s * s; s = s * s; return 1 + s * 0.3; };
const vw = (fuse) => (Math.trunc(fuse / 5) % 2 === 0 ? 1 : 0);
function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c && fails.length < 6) fails.push(m); };
  const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07zb_creeper.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07w_passive.js', '07zzj_strider.js'], dom: false, patch });
  const ER = M.EntityRender || M.ER;
  for (let fuse = 80; fuse >= 0; fuse--) for (const pt of [0, 0.25, 0.5, 0.99]) {
    const r = ER.tntRender({ type: 'tnt', fuse }, pt);
    ok(Math.abs(r.scale - vs(fuse, pt)) < 1e-12, `scale fuse ${fuse} pt ${pt}`);
    ok(r.white === vw(fuse), `white fuse ${fuse}`);
    if (fuse - pt + 1 >= 10) ok(r.scale === 1, `scale 1 fuse ${fuse}`);
  }
  for (let fuse = 80; fuse > 0; fuse--) ok((ER.tntRender({ fuse }, 0).white !== ER.tntRender({ fuse: fuse - 1 }, 0).white) === (fuse % 5 === 0), `toggle every 5 at ${fuse}`);
  return { fails, n };
}
const real = scenarios(); const fails = real.fails.slice(); let breaks = 0;
for (const [label, a, b] of [
  ['no +1 offset', 'var f = fu - partial + 1;', 'var f = fu - partial;'],
  ['no ^4', 's = s * s; s = s * s;\n      sc =', 's = s * s;\n      sc ='],
  ['white from partial value', '((fu / 5) | 0) % 2', '((f / 5) | 0) % 2'],
]) {
  let matched = false;
  const patch = (f, src) => { if (f !== '07j_entityrender.js') return src; if (src.includes(a)) matched = true; return src.split(a).join(b); };
  let r; try { r = scenarios(patch); } catch (err) { r = { fails: ['threw'] }; }
  if (!matched) fails.push('edit matched nothing: ' + label);
  else if (r.fails.length) { breaks++; console.log('   ✓ break caught: ' + label); } else fails.push('unnoticed break: ' + label);
}
if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log(`tntrendercheck: ${real.n} assertions, 0 failures, ${breaks} breaks caught`);
