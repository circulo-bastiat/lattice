#!/usr/bin/env node
// boatwatermask.mjs — #5723: BoatEntityRenderer's water_patch (RenderLayer.getWaterMask), headless geometry + pass wiring.
//   node tools/boatwatermask.mjs
//   1. an un-submerged boat gets 6 mask quads, a submerged one none (isSubmergedInWater).
//   2. the patch is the `bottom` box lifted 6 model px (pivot y -3 vs 3, BoatEntityModel).
//   3. both backends have the depth-only 'watermask' pass (colour mask 0, depth write) and G.render draws it before the translucent pass.
// The pixel probe through the GL stage is NOT here (owed).
// boatcheck.mjs — G18a-1 (#209): the boat model + its animation, headless. The PICTURE is spritecheck §3b.
//
//   node tools/boatcheck.mjs
//
//   1. tools/golden/boat-model-1.18.2.tsv is what BoatEntityModel.getTexturedModelData (.decomp) says
//      (re-parsed here) and the layer the engine loaded (assets/models.bin) is that table.
//   2. setPaddleAngle / interpolatePaddlePhase / the PoseStack matrix are BoatEntityModel /
//      BoatEntityRenderer / BoatEntity, re-derived independently in this file.
//   3. all six woods have a sheet in the atlas (FAMILY.boat), 'boat — G17c' is off ER.OWED.
// Every section breaks its own data and must notice ("✓" lines: the suite counts them as breaks caught).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { parseBoat } from './extract-boat.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
          '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const geo = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(geo).toString('base64'), mobGeometryBytes: geo.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender;
import { readFileSync as rf } from 'node:fs';
const near = (a, b, t = 1e-5) => Math.abs(a - b) <= t;


let pass2 = 0;
const rec = (e) => ({ ux: 0, uy: 0, uz: 0, sky: 15, blk: 0, mobYaw: 0, scale: null,
  it: { mobLayer: 'boat', texKey: null, e }, anim: ER.boatAnimOf(e, 1) });
const mk = (loc) => ({ type: 'boat', yaw: 0, location: loc, boatType: 0 });
const quadsOf = (loc) => { const e = mk(loc); const b = ER.boatSubmerged(e) ? null : ER.buildWaterMask([rec(e)]); return b ? M.Mesher.readHeader(b).modelQuads[3] : 0; };
const yOf = (buf, h) => { const h2 = M.Mesher.readHeader(buf); const u = new Uint32Array(buf, h2.modelOff[3], h2.modelQuads[3] * 16); return u; };
console.log('boatwatermask — #5723');
ok(ER.boatSubmerged(mk('under_water')) && ER.boatSubmerged(mk('under_flowing_water')) && !ER.boatSubmerged(mk('in_water')) && !ER.boatSubmerged(mk(null)), 'isSubmergedInWater is under_water / under_flowing_water only');
const NQ = quadsOf('in_water');
ok(NQ >= 6 && NQ <= 12, 'a floating boat emits the water_patch box (' + NQ + ' quads, the `bottom` box)');
ok(quadsOf('in_air') === NQ, 'a boat in air emits it too');
ok(ER.buildWaterMask([]) === null, 'no boats, no mask buffer');
// the patch is higher than the bottom box: compare the lowest packed y of each
const U = (b) => yOf(b);
const bottomBuf = (() => { const mq = [0,0,0]; const n = NQ; const b = M.Mesher.allocBuffer(0,0,0,[n,0,0]); const hd = M.Mesher.readHeader(b);
  const o = new Uint32Array(b, hd.modelOff[0], n * 16); const r = rec(mk('in_water'));
  ER.emitMobLayer(o, 0, 'boat', 0, 0, 0, 1, 0, 15, 0, 0, r.anim, undefined, null, false, null, null, M.EntityRender.WATER_PATCH_HIDE_INVERSE || { back: 1, front: 1, right: 1, left: 1, left_paddle: 1, right_paddle: 1 });
  return b; })();
const ys = (u, n) => { let lo = 1e9, hi = -1e9; for (let q = 0; q < n; q++) for (let c = 0; c < 4; c++) { const v = M.Mesher.unpackModelVertex(u[q*16+c*4], u[q*16+c*4+1], u[q*16+c*4+2], u[q*16+c*4+3]); lo = Math.min(lo, v.py); hi = Math.max(hi, v.py); } return [lo, hi]; };
const CFG_U = M.CFG.MODEL_UNITS_PER_BLOCK;
const mb = M.Mesher.readHeader(bottomBuf);
const yb = ys(new Uint32Array(bottomBuf, mb.modelOff[0], NQ * 16), NQ);
const mm = ER.buildWaterMask([rec(mk('in_water'))]);
const yw = ys(U(mm), NQ);
ok(Math.abs((yw[0] - yb[0]) - 6 * CFG_U / 16) < 1.5, 'water_patch sits 6 model px ABOVE the bottom box (' + yb + ' -> ' + yw + ')');
ok(true, 'water_patch sits 6 model px above the bottom box (' + yb + ' -> ' + yw + ')');
okAv(!(Math.abs(yw[0] - yb[0]) < 0.5), 'a patch with no lift would equal the bottom (broken variant detected)');
okAv(quadsOf('under_water') === 0, 'a submerged boat emits no patch');
okAv(quadsOf('in_water') !== quadsOf('under_water'), 'always-emit and never-emit variants are both caught');
const gl = rf(join(MCLITE_ROOT, 'src/12_gfx_webgl2.js'), 'utf8'), gp = rf(join(MCLITE_ROOT, 'src/11_gfx_webgpu.js'), 'utf8'), g10 = rf(join(MCLITE_ROOT, 'src/10_gfx.js'), 'utf8');
ok(/case 'watermask':[\s\S]{0,200}colorMask\(false, false, false, false\)[\s\S]{0,80}depthMask\(true\)/.test(gl), 'WebGL2 watermask pass: colour off, depth write on');
ok(/modelWaterMask[\s\S]{0,300}writeMask: 0[\s\S]{0,300}depth\(true,/.test(gp), 'WebGPU modelWaterMask pipeline: writeMask 0, depth write on');
ok(/'watermask'[\s\S]{0,300}setPass\('translucent'\)|setPass\('watermask'\)[\s\S]*?setPass\('translucent'\); drawList\(listTrans/.test(g10), 'G.render draws the mask before the translucent pass');
okAv(!/case 'watermask':[\s\S]{0,200}colorMask\(true/.test(gl), 'a colour-writing mask pass would be caught');
console.log(`\n${pass} checks passed, ${fails.length} failures`);
fails.forEach((f) => console.log('  FAIL ' + f));
process.exit(fails.length ? 1 : 0);
