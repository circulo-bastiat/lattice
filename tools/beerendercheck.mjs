#!/usr/bin/env node
// beerendercheck.mjs — #11572: BeeEntityRenderer.getTexture. ER.visible (the renderer's entity collector) must
// give a live bee the right one of the four sheets (bee / bee_angry / bee_nectar / bee_angry_nectar) through
// the chained `NS.Bee.skinKey` picker in 07j_entityrender.js. Cutting that chain line makes this FAIL.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07zo_bee.js',
          '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
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
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender;
const fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const keyFor = (over) => {
  M.EntityList.list = [Object.assign({ type: 'bee', x: 0, y: 5, z: 0, px: 0, py: 5, pz: 0, yaw: 0, pyaw: 0, age: 0, angerTime: 0, hasNectar: false }, over)];
  const m = ER.visible(0, 5, 0, 1).filter((it) => it.shape === 'mob');
  return m.length === 1 ? m[0].texKey : 'NOITEM:' + m.length;
};
const run = () => [
  keyFor({}) === 'bee', keyFor({ angerTime: 100 }) === 'bee_angry',
  keyFor({ hasNectar: true }) === 'bee_nectar', keyFor({ angerTime: 5, hasNectar: true }) === 'bee_angry_nectar'];
run().forEach((v, i) => ok(v, 'bee sheet #' + i));
const caught = (label, fn, restore) => {
  fn(); let bad; try { bad = !run().every(Boolean); } catch (e) { bad = true; }
  restore(); if (bad) { breaks++; console.log('   ✓ break caught: ' + label); } else fails.push('anti-vacuity: ' + label + ' unnoticed');
};
{ const o = M.Bee.skinKey; caught('picker returns nothing', () => { M.Bee.skinKey = () => null; }, () => { M.Bee.skinKey = o; });
  caught('anger sheet ignored', () => { M.Bee.skinKey = (e) => o(Object.assign({}, e, { angerTime: 0 })); }, () => { M.Bee.skinKey = o; });
  caught('nectar sheet ignored', () => { M.Bee.skinKey = (e) => o(Object.assign({}, e, { hasNectar: false })); }, () => { M.Bee.skinKey = o; }); }
console.log(` assertions passed ... ${pass}`);
fails.forEach((f) => console.log('  FAIL ' + f));
console.log(` failures ........... ${fails.length}\n breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
