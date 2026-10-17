// sheepfleececheck -- #1165: the fleece pass (SheepWoolFeatureRenderer -> SheepWoolEntityModel) must draw
// the WOOL model's boxes (head 6x6x6 at z-4, legs 6 tall, all dilated), not the bare sheep's (head 6x6x8,
// legs 12 tall). Class of bug: an overlay pass whose texKey layer has its own geometry drawn with the base
// layer's boxes. Every box of fur#null is compared with the golden table, then the check breaks itself.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07zb_creeper.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07w_passive.js'],
  dom: false
});
initRegistry(M);
const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init(); M.Passive.init();
const ER = M.EntityRender;

const gold = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'models-1.18.2.tsv'), 'utf8').split('\n')
  .filter((l) => l.startsWith('fur#null\t')).map((l) => l.split('\t'));
ok(gold.length === 6, `golden has 6 fur#null boxes (got ${gold.length})`);

function compare(pick) {
  const L = pick('sheep', 'fur#null'); let bad = 0;
  for (const g of gold) {
    const p = L.parts.find((q) => q.n === g[1]);
    const w = [+g[4], +g[5], +g[6], +g[7], +g[8], +g[9]];
    if (!p || [p.x, p.y, p.z, p.w, p.h, p.d].some((v, i) => Math.abs(v - w[i]) > 1e-4)) bad++;
  }
  return bad;
}
ok(compare(ER.boxLayerFor) === 0, 'the fleece pass draws every wool-model box (head 6x6x6 z-4 +0.6, legs 6 tall +0.5, body +1.75)');
ok(M.BEModel.layer('sheep').parts.find((q) => q.n === 'head').d === 8, 'the bare sheep head is 8 deep (so the two models really differ)');
ok(ER.boxLayerFor('sheep').parts.find((q) => q.n === 'head').d === 8, 'the body pass still draws the bare sheep boxes');
ok(ER.boxLayerFor('sheep', 'sheep') === M.BEModel.layer('sheep'), 'same texKey is the base layer');
okAv(compare((l) => M.BEModel.layer(l)) > 0, 'drawing the fleece with the bare sheep boxes (the old behaviour) fails the comparison');

console.log(`${pass} checks passed, ${fails.length} failed`);
console.log(` breaks caught ...... ${breaks}`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
