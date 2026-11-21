#!/usr/bin/env node
// entityculldistcheck.mjs — #5624: Entity.shouldRender(distanceSq) culls by the box's average side * 64 * multiplier.
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('entityculldistcheck — #5624, EntityRenderer.shouldRender');

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
  const im = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/items.meta.json', 'utf8'));
  M.Items.init({ items: readFileSync(MCLITE_ROOT + 'assets/items.bin').toString('base64'), itemsBytes: im.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(MCLITE_ROOT + 'assets/entities.json', 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const EL = M.EntityList, ER = M.EntityRender;

const cow = EL.spawn('cow', 0, 70, 0), giant = EL.spawn('giant', 0, 70, 0), item = EL.spawn('item', 0, 70, 0, {});
const at = (e, d) => ER.shouldRender(e, d * d);
const avg = (e) => (2 * e.width + e.height) / 3;
okAv(at(cow, 63), 'cow at 63 is drawn');
okAv(!at(cow, 70), 'cow at 70 is not');
okAv(at(giant, 64 * avg(giant) - 1) && !at(giant, 64 * avg(giant) + 1), 'giant culls at 64*avgSide');
okAv(item && at(item, 15) && !at(item, 17), 'item entity: drawn at 15, not at 17');
ER.renderDistanceMultiplier = 2;
okAv(at(cow, 70), 'multiplier 2 draws the cow at 70');
ER.renderDistanceMultiplier = 1;
console.log(fails.length ? fails.join('\n') : 'all ok');
console.log(`entityculldistcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
