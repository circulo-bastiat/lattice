#!/usr/bin/env node
// armourglintcheck.mjs — #8079: ArmorFeatureRenderer foil pass. An enchanted armour piece emits a second (glint) layer; a plain one does not.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { join } from 'node:path';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07zb_creeper.js', '07q_effects.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07w_passive.js'],
  dom: false
});
initRegistry(M);
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const raw = readFileSync(join(ASSETS, 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init(); M.Passive.init();
const ER = M.EntityRender, IT = M.Items;
const id = (n) => IT.names.indexOf(n);
const run = (t) => {
  const eq = []; eq[IT.CHEST] = { i: id('iron_chestplate'), n: 1, d: 0, t };
  M.EntityList.list = [{ type: 'zombie', x: 2, y: 5, z: 0, px: 2, py: 5, pz: 0, yaw: 0, pyaw: 0, age: 0, equip: eq }];
  return ER.visible(0, 5, 0, 1).filter((it) => /#[bc](#\d)?$/.test(it.texKey || ''));
};
const plain = run(null), ench = run({ Enchantments: [{ id: 'minecraft:protection', lvl: 1 }] });
ok(plain.length === 1 && !plain[0].glint, 'a plain chestplate emits one layer, no glint');
ok(ench.length === 2 && ench.filter((i) => i.glint === 'armor').length === 1, 'an enchanted chestplate emits a second glint layer');
ok(ench.length === 2 && ench[1].texKey === ench[0].texKey && ench[1].hideParts === ench[0].hideParts, 'the glint layer reuses the piece geometry');
// anti-vacuity: ignoring hasGlint must be caught
const orig = ER.stackHasGlint; ER.stackHasGlint = () => false;
breaks++; ok(run({ Enchantments: [{ id: 'minecraft:protection', lvl: 1 }] }).length === 1, 'anti-vacuity: hasGlint ignored -> no glint layer');
ER.stackHasGlint = orig;
console.log(`assertions passed .. ${pass}\nfailures .. ${fails.length}`);
for (let i = 0; i < breaks; i++) console.log("✓ break caught");
console.log(`${breaks} breaks caught`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
