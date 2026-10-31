#!/usr/bin/env node
// batposecheck.mjs — #1915: BatEntityModel.setAngles (roosting/flying) + BatEntityRenderer.setupTransforms via ER.setupAnimDelta.
import { loadEngine, initRegistry } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from './loadsrc.mjs';

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const ER = M.EntityRender;
const near = (a, b) => Math.abs(a - b) < 1e-4;
const D = (part, roosting, age = 10, yaw = 20, pitch = 30) =>
  ER.setupAnimDelta(part, 0, 0, yaw, pitch, false, null, { bat: { roosting }, ageInTicks: age });
const run = () => {
  const o = [], R = (p) => D(p, true), F = (p) => D(p, false), DEG = Math.PI / 180;
  o.push(near(R('body').rx, Math.PI) && near(R('head').rz, Math.PI) && near(R('head').ry, Math.PI - 20 * DEG) && near(R('head').dpy, -2 + 0.1 * 16 / 0.35));
  o.push(near(R('right_wing').dpx, -3) && near(R('left_wing').dpx, 3) && near(R('left_wing').dpz, 3) && near(R('right_wing').rx, -Math.PI / 20));
  o.push(near(R('right_wing').ry, -Math.PI * 2 / 5) && near(R('left_wing').ry, Math.PI * 2 / 5));
  o.push(near(R('right_wing_tip').ry, -1.7278761) && near(R('left_wing_tip').ry, 1.7278761));
  const wy = Math.cos(10 * 74.48451 * DEG) * Math.PI * 0.25;
  o.push(near(F('body').rx, Math.PI / 4 + Math.cos(1) * 0.15) && near(F('head').rz, 0) && near(F('head').ry, 20 * DEG));
  o.push(near(F('right_wing').ry, wy) && near(F('left_wing').ry, -wy) && near(F('right_wing_tip').ry, wy / 2) && near(F('left_wing_tip').ry, -wy / 2));
  o.push(near(F('body').dpy, -Math.cos(3) * 0.1 * 16 / 0.35) && !F('right_wing').dpx);
  o.push(ER.partParentOf('bat', 'left_wing_tip') === 'left_wing' && ER.partParentOf('bat', 'right_ear') === 'head');
  return o;
};
const fails = []; let breaks = 0;
run().forEach((v, i) => { if (!v) fails.push('assertion #' + i); });
const o = ER.setupAnimDelta;
const wrap = (label, f) => {
  ER.setupAnimDelta = (...a) => f(a[0], o(...a), a[7]);
  let bad; try { bad = !run().every(Boolean); } catch (e) { bad = true; }
  ER.setupAnimDelta = o;
  if (bad) { breaks++; console.log('   ✓ break caught: ' + label); } else fails.push('anti-vacuity: ' + label + ' went unnoticed');
};
wrap('roost body pitch', (n, r, c) => n === 'body' && c.bat.roosting ? { ...r, rx: 0 } : r);
wrap('flap dropped', (n, r, c) => n === 'right_wing' && !c.bat.roosting ? { ...r, ry: 0 } : r);
wrap('roost wing pivot', (n, r, c) => n === 'left_wing' && c.bat.roosting ? { ...r, dpx: 0 } : r);
wrap('bob dropped', (n, r, c) => n === 'body' ? { ...r, dpy: 0 } : r);
console.log('\n================ batposecheck ================');
console.log(` assertions passed .. ${8 - fails.filter((f) => f.startsWith('assertion')).length}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
