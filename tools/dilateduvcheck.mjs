// dilateduvcheck.mjs — #633 (KW-49b): a dilated box (CubeDeformation) lays its texture out from the
// UN-grown size. models.bin stores the GROWN box (D-694) plus `g`; BE.faceRects must unwrap w-2g.
//
// Every dilated part in the shipped table (hat/overlay/outer layers, evoker, witch, armor, ...) must
// give integer rects whose unwrapped strip is 2*(w0+d0) wide and (d0+h0) tall inside the sheet, and the
// (A zero-width part, the tropical fish tail, legitimately overhangs the sheet edge by its empty strip.) The zombie hat's top/front must be the 8x8 rects of the un-grown 8x8x8 head layout. Two breaks: `g`
// dropped (the old grown-size layout) and the rect fed the grown size.
import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
console.log('dilateduvcheck — #633: dilated boxes unwrap their texture from the un-grown size');

const M = loadEngine({ extra: ['15h_bemodel.js'], dom: false });
initRegistry(M);
const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
const BE = M.BEModel;

function audit(faceRects) {
  let bad = 0, n = 0;
  for (const name of Object.keys(BE.layers || {})) {
    const L = BE.layers[name];
    for (const p of L.parts) {
      if (!p.g) continue;
      n++;
      const w0 = Math.round(p.w - 2 * p.g), h0 = Math.round(p.h - 2 * p.g), d0 = Math.round(p.d - 2 * p.g);
      const r = faceRects(p);
      const want = [[p.tu + d0 + w0, p.tv + d0, d0, h0], [p.tu, p.tv + d0, d0, h0], null, null,
                    [p.tu + d0 + w0 + d0, p.tv + d0, w0, h0], [p.tu + d0, p.tv + d0, w0, h0]];
      if (p.m) { const t = want[0]; want[0] = want[1]; want[1] = t; }
      for (const f of [0, 1, 4, 5]) if (r[f].join() !== want[f].join()) bad++;
      if (r[2][2] !== w0 || r[2][3] !== d0 || r[3][2] !== w0 || r[3][3] !== d0) bad++;
      if ((w0 && p.tu + 2 * (w0 + d0) > L.tw) || p.tv + d0 + h0 > L.th) bad++;
    }
  }
  return { bad, n };
}
ok(!!BE.layers, 'BEModel exposes its layers');
const real = audit(BE.faceRects);
ok(real.n > 100, `many dilated parts audited (${real.n})`);
ok(real.bad === 0, `every dilated part unwraps from w-2g (${real.bad} bad faces)`);

const z = BE.layers.zombie && BE.layers.zombie.parts.find((p) => p.n === 'hat');
ok(z && z.g === 0.5, 'zombie hat carries g=0.5');
if (z) {
  const r = BE.faceRects(z);
  ok(r[2].join() === '48,0,8,8' && r[3].join() === '40,0,8,8' && r[5].join() === '40,8,8,8', `zombie hat top/front are the 8x8x8 layout (${r[2]} | ${r[5]})`);
}

let caught = 0;
const brk = (label, fr) => { const a = audit(fr); if (ok(a.bad > 0, `anti-vacuity: ${label} — NOT caught`)) { caught++; console.log(`   ✓ break caught: ${label} (${a.bad} bad faces)`); } };
brk('g dropped (grown-size layout)', (p) => BE.faceRects(Object.assign({}, p, { g: 0 })));
brk('rect fed a wrongly signed grow', (p) => BE.faceRects(Object.assign({}, p, { g: -p.g })));

console.log(`\ndilateduvcheck: ${pass} assertions, ${fails.length} failed`);
for (const f of fails) console.log('   ✗ ' + f);
process.exit(fails.length ? 1 : 0);
