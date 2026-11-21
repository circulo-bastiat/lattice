#!/usr/bin/env node
// elderguardiandrawcheck — #8078: the elder guardian apparition's MODEL draw (22 boxes x 6 faces, world space, alpha ramp, camera placement).
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07zx_particle.js'], dom: false });
initRegistry(M);
const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
const ER = M.EntityRender, Px = M.Particle;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const brk = (c, m) => { breaks++; if (!c) fails.push('anti-vacuity: ' + m); else { pass++; console.log('  ✓ break caught: ' + m); } };
const cam = { x: 10, y: 70, z: -5, right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, 1] };

Px.list.length = 0;
const p = Px.spawnElderGuardian(10, 70, -5);
const draw = (age, pt) => { p.age = age; return Px.elderGuardianDraws(cam, pt || 0)[0]; };
const bbox = (qs) => { const b = [[1e9, 1e9, 1e9], [-1e9, -1e9, -1e9]]; for (const q of qs) for (const v of q.p) for (let i = 0; i < 3; i++) { b[0][i] = Math.min(b[0][i], v[i]); b[1][i] = Math.max(b[1][i], v[i]); } return b; };
const run = () => {
  const d0 = draw(0), d15 = draw(15), d29 = draw(29);
  const q15 = ER.elderGuardianQuads(d15);
  ok(q15.length === 22 * 6, 'one quad per face of the 22 boxes (got ' + q15.length + ')');
  ok(q15.every(q => Math.abs(q.rgba[3] - Px.elderGuardianAlpha(15)) < 1e-6), 'every quad carries alpha(15)');
  ok(Math.abs(ER.elderGuardianQuads(d0)[0].rgba[3] - 0.05) < 1e-6, 'alpha(0) = 0.05');
  ok(ER.elderGuardianQuads(d29)[0].rgba[3] < 0.11, 'alpha(29) < 0.11');
  // placement: the head (12x12x16 px) lies 1.5 blocks in front of the camera along fwd at age 15 -> pitch 15
  const b = bbox(q15), cz = (b[0][2] + b[1][2]) / 2;
  ok(Math.abs(b[0][0] - 10) < 2 && Math.abs(b[1][0] - 10) < 2, 'x centred on the camera');
  ok(cz > cam.z && cz < cam.z + 4, 'in front of the camera (z ' + cz.toFixed(2) + ')');
  // the quads follow the camera: a camera yawed 90 deg (fwd = +x) puts the model in front along +x
  const cam2 = { x: 0, y: 0, z: 0, right: [0, 0, -1], up: [0, 1, 0], fwd: [1, 0, 0] };
  p.age = 15; const q2 = ER.elderGuardianQuads(Px.elderGuardianDraws(cam2, 0)[0]), b2 = bbox(q2);
  ok((b2[0][0] + b2[1][0]) / 2 > 0.3, 'camera-relative: yawed camera moves the model to +x');
  // vertices go out through the beam pass: 4 verts x 7 floats per quad
  const v = ER.buildCrystalBeamVerts(cam, 0);
  ok(v.length === 22 * 6 * 4 * ER.CRYSTAL_BEAM_VERTEX_FLOATS, 'buildCrystalBeamVerts emits the apparition (' + v.length + ')');
  return q15;
};
p.age = 15; run();
// anti-vacuity
{ const o = Px.elderGuardianAlpha; Px.elderGuardianAlpha = () => 0.9; const q = ER.elderGuardianQuads(draw(15)); Px.elderGuardianAlpha = o;
  brk(!(Math.abs(q[0].rgba[3] - o(15)) < 1e-6), 'a wrong alpha curve is seen'); }
{ const o = ER.partParentOf; ER.partParentOf = () => null; const q = ER.elderGuardianQuads(draw(15)); ER.partParentOf = o;
  const a = JSON.stringify(bbox(q)), g = JSON.stringify(bbox(ER.elderGuardianQuads(draw(15))));
  brk(a !== g, 'dropping the part parents moves the tail'); }
{ const o = Px.elderGuardianLocal; Px.elderGuardianLocal = () => ({ x: 0, y: 0, z: -3 }); const d = draw(15); Px.elderGuardianLocal = o;
  const b = bbox(ER.elderGuardianQuads(d)); brk(!((b[0][2] + b[1][2]) / 2 > cam.z), 'a model behind the camera is seen'); }
{ Px.list.length = 0; ER.elderGuardianQuads = ((f) => (d) => f(d).slice(1))(ER.elderGuardianQuads); const v = ER.buildCrystalBeamVerts(cam, 0); brk(v.length === 0, 'no particle -> no apparition'); }
console.log('elderguardiandrawcheck: ' + pass + ' passed, ' + breaks + ' breaks caught');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
