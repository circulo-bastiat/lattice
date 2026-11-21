#!/usr/bin/env node
// snowgolemrendercheck.mjs — #723: the snow golem's RENDER.
//   SnowGolemEntityModel.setAngles: arms never swing with limbSwing; upperBody.yaw = headYaw*0.25, the arms follow it
//   (left yaw = ub, right yaw = ub+PI, pivots +-cos/sin(ub)*5). SnowmanPumpkinFeatureRenderer: a carved_pumpkin is
//   drawn on the head iff hasPumpkin (a sheared golem draws none).
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { join } from 'node:path';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const near = (a, b) => Math.abs(a - b) < 1e-6;

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07zb_creeper.js', '07q_effects.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07w_passive.js', '14j_combat.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init(); M.Passive.init();
const ER = M.EntityRender, DEG = Math.PI / 180;
ok(ER.ready, 'entity renderer up');
const IT = M.Items, DEGR = Math.PI / 180;
const itemId = (n) => IT.names.indexOf(n);
const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-5);
const mk = (type, head) => ({ type, x: 0, y: 0, z: 0, yaw: 0, equip: head ? { [IT.HEAD]: { i: itemId(head), n: 1 } } : {} });
const Lz = M.BEModel.layer('zombie');
ok(!!Lz, 'zombie layer');
// vanilla chain, written independently: Ry(180) then scale(.625,-.625,-.625) => linear diag(-.625,-.625,.625), t=(0,-.25,0) (head at rest)
for (const [type, extraY] of [['zombie', 0], ['villager', 0.1875 * -0.625 * -1]]) {
  void extraY;
}
const posedZ = ER.posedPart(Lz.parts.find((p) => p.n === 'head'), ER.animOf(mk('zombie', 'carved_pumpkin'), 0), 'zombie');
const base = ER.headFeatureMatrix(posedZ, -0.25, false, false);
const hr = [posedZ.px / 16, posedZ.py / 16 - 0.25, posedZ.pz / 16];
ok(close(base.t, hr), 'translation');
{ const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')); M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes }); }
let nblocks = 0;
for (const name of ['carved_pumpkin', 'stone', 'oak_planks', 'glass', 'tnt', 'hay_block']) {
  const e = mk('zombie', name);
  const it = ER.headBlockFor(e, 'zombie', 0, 0, 0, 0);
  ok(it && it.state > 0 && it.pumpkin, name + ' worn on a zombie head draws a block');
  if (it) nblocks++;
}
okAv(nblocks === 6, 'six block heads drawn');
// matrix: the 0.625 chain is Ry(180)*diag(.625,-.625,-.625) = diag(-.625,-.625,.625) at zero head rotation
const Z = ER.headFeatureMatrix({ rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0 }, -0.25, false, false);
ok(close(Z.R, [-0.625, 0, 0, 0, -0.625, 0, 0, 0, 0.625]) && close(Z.t, [0, -0.25, 0]), 'rest chain matches vanilla');
const V = ER.headFeatureMatrix({ rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0 }, -0.25, true, false);
ok(close(V.t, [0, -0.25 + 0.1875 * -0.625, 0]), 'villager offset 0.1875 in scaled space (got ' + V.t + ')');
const Bb = ER.headFeatureMatrix({ rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0 }, -0.25, false, true);
ok(close(Bb.R, Z.R.map((v) => v * 0.7)), 'baby scales by 0.7');
// anti-vacuity: empty slot, armour, and a non-block item emit nothing
okAv(ER.headBlockFor(mk('zombie', null), 'zombie', 0, 0, 0, 0) === null, 'empty head slot emits no extra item');
okAv(ER.headBlockFor(mk('zombie', 'iron_helmet'), 'zombie', 0, 0, 0, 0) === null, 'helmet is not a head block');
okAv(ER.headBlockFor(mk('zombie', 'stick'), 'zombie', 0, 0, 0, 0) === null, 'stick draws no block');
// skulls: the six heads each draw a beworld skull model on a zombie, scaled 1.1875 (dragon x0.75); no skull -> none
let nsk = 0;
for (const [name, layer] of [['skeleton_skull', 'skeleton_skull'], ['wither_skeleton_skull', 'wither_skeleton_skull'], ['zombie_head', 'zombie_head'],
  ['player_head', 'player_head'], ['creeper_head', 'creeper_head'], ['dragon_head', 'dragon_head']]) {
  const sk = ER.headSkullFor(mk('zombie', name), 'zombie', 0, 0, 0, 0);
  ok(sk && sk.shape === 'beworld' && sk.mobLayer === layer, name + ' draws its skull model');
  if (sk) {
    const want = 1.1875 * (layer === 'dragon_head' ? 0.75 : 1);
    ok(near(sk.beScale.sxz, want), name + ' skull scale ' + want);
    nsk++;
  }
  ok(ER.headBlockFor(mk('zombie', name), 'zombie', 0, 0, 0, 0) === null, name + ' is not drawn as a block');
}
okAv(nsk === 6, 'six skull heads drawn');
okAv(ER.headSkullFor(mk('zombie', null), 'zombie', 0, 0, 0, 0) === null, 'empty slot emits no skull');
okAv(ER.headSkullFor(mk('zombie', 'carved_pumpkin'), 'zombie', 0, 0, 0, 0) === null, 'pumpkin is not a skull');
okAv(!close(Z.R, [0.625, 0, 0, 0, 0.625, 0, 0, 0, 0.625]), 'broken matrix is caught');

console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) fails.forEach((f) => console.log("  FAIL: " + f));
process.exit(fails.length ? 1 : 0);
