#!/usr/bin/env node
// mooshroomshroomcheck.mjs — #671: MooshroomMushroomFeatureRenderer (.decomp, read whole).
//   node tools/mooshroomshroomcheck.mjs
// An adult, visible mooshroom draws its type's mushroom BLOCK three times (two on the body, one
// on the head); a baby or an invisible one draws none. The pose is re-derived here by hand.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) console.log('   ✓ ' + m); else fails.push('anti-vacuity: ' + m); };
console.log('mooshroomshroomcheck — #671, mushroom blocks on the mooshroom');

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '07i_entitylist.js', '07zn_mooshroom.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
  const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
  M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length });
}
M.EntityRender.init();
const ER = M.EntityRender;
const mk = (o) => Object.assign({ type: 'mooshroom', x: 10.5, y: 20, z: 10.5, px: 10.5, py: 20, pz: 10.5,
  yaw: 0, pyaw: 0, age: 0 }, o || {});
const shrooms = (e) => { M.EntityList.ready = true; M.EntityList.list = [e]; return ER.visible(10, 20, 10, 1).filter((it) => it.shape === 'mushroom'); };

const red = shrooms(mk());
ok(red.length === 3, 'adult red mooshroom: 3 mushroom entries (got ' + red.length + ')');
ok(red.every((s) => s.state === M.States.stateOf('red_mushroom')), 'red type draws red_mushroom');
ok(shrooms(mk({ mooshroomType: 'brown' })).every((s) => s.state === M.States.stateOf('brown_mushroom')), 'brown type draws brown_mushroom');
ok(shrooms(mk({ isBaby: true })).length === 0, 'baby draws none');

// pose, yaw 0: world = diag(-1,-1,1) * (f - (0,1.501,0)); f1 = (0.2,-0.35,0.5)
const near = (a, b) => Math.abs(a - b) < 1e-6;
const c1 = red[0] && red[0].mush.c;
ok(c1 && near(c1[0], -0.2) && near(c1[1], 1.851) && near(c1[2], 0.5), 'mushroom 1 centre at (-0.2,1.851,0.5) from the feet (got ' + c1 + ')');
const r42 = 42 * Math.PI / 180;
const t2 = [0.1 * Math.cos(r42) + -0.6 * Math.sin(r42), -(0.1 * Math.sin(r42)) + -0.6 * Math.cos(r42)];
const c2 = red[1] && red[1].mush.c;
ok(c2 && near(c2[0], -(0.2 + t2[0])) && near(c2[2], 0.5 + t2[1]), 'mushroom 2 centre follows Ry(42) * (0.1,0,-0.6)');
// the two body mushrooms differ by 6 degrees of yaw; the linear part is orthonormal
const m = red[0] && red[0].mush.m;
ok(m && near(m[0] * m[0] + m[3] * m[3] + m[6] * m[6], 1), 'linear part has unit columns');
ok(m && near(m[4], 1), 'the block stands upright (scale(-1,-1,1) cancels the living flip)');
// yaw carries the whole feature around the feet
const yawed = shrooms(mk({ yaw: Math.PI / 2, pyaw: Math.PI / 2 }));
const cy = yawed[0] && yawed[0].mush.c;
ok(cy && near(Math.hypot(cy[0], cy[2]), Math.hypot(-0.2, 0.5)) && near(cy[1], 1.851), 'yaw rotates the centre about the vertical, height kept');
ok(cy && !near(cy[0], -0.2), 'yaw actually moved it');
// ER.build reaches the buffer
const list = (e) => { M.EntityList.ready = true; M.EntityList.list = [e]; return ER.build(0, 0, 0, 10, 20, 10, 1); };
const withM = list(mk()), noM = list(mk({ isBaby: true }));
const q = (b) => b ? b.quads[0] + b.quads[1] + b.quads[2] : 0;
ok(q(withM) > q(noM), 'ER.build draws more quads for an adult (' + q(withM) + ') than a baby (' + q(noM) + ')');

// ── anti-vacuity: break the code three ways, the assertions above must notice
const src = ER.mooshroomMushrooms;
ER.mooshroomMushrooms = () => [];
okAv(shrooms(mk()).length !== 3, 'a layer that emits nothing fails the 3-entry assertion');
ER.mooshroomMushrooms = (e, p) => src(e, p).slice(0, 2);
okAv(shrooms(mk()).length !== 3, 'a layer that emits only 2 fails it');
ER.mooshroomMushrooms = (e, p) => src(Object.assign({}, e, { isBaby: false }), p);
okAv(shrooms(mk({ isBaby: true })).length !== 0, 'a layer that ignores isBaby fails the baby assertion');
ER.mooshroomMushrooms = src;

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
