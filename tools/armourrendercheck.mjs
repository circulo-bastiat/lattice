#!/usr/bin/env node
// armourrendercheck.mjs — #1835: ArmorFeatureRenderer. A mob wearing armour emits one extra mob pass per worn
// ArmorItem: the slot's own parts only (setVisible), LEGS on the inner layer `<mob>#b`, the rest on the outer `#c`.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { join } from 'node:path';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };

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
ok(ER.ready, 'entity renderer up');

const id = (n) => IT.names.indexOf(n);
const mk = (type, equip) => Object.assign({ type, x: 2, y: 5, z: 0, px: 2, py: 5, pz: 0, yaw: 0, pyaw: 0, age: 0, equip });
const armour = (e) => { M.EntityList.list = [e]; return ER.visible(0, 5, 0, 1).filter((it) => /#[bc](#\d)?$/.test(it.texKey || '')); };
const eq = (o) => { const a = []; for (const k in o) a[IT[k]] = { i: id(o[k]), n: 1, d: 0 }; return a; };

for (const n of ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']) ok(id(n) > 0, n + ' exists');
ok(armour(mk('zombie', null)).length === 0, 'an unarmoured zombie draws no armour pass');

const four = armour(mk('zombie', eq({ HEAD: 'iron_helmet', CHEST: 'iron_chestplate', LEGS: 'iron_leggings', FEET: 'iron_boots' })));
ok(four.length === 4, `four worn pieces -> four passes (got ${four.length})`);
const legs = four.filter((it) => it.texKey === 'zombie#b');
ok(legs.length === 1 && !legs[0].hideParts.body && !legs[0].hideParts.right_leg && legs[0].hideParts.head, 'leggings: inner layer #b, body + legs only');
const outer = four.filter((it) => it.texKey === 'zombie#c');
ok(outer.length === 3, 'helmet/chest/boots: outer layer #c');
ok(outer.some((it) => !it.hideParts.head && it.hideParts.body), 'helmet shows head/hat only');
ok(outer.some((it) => !it.hideParts.body && !it.hideParts.left_arm && it.hideParts.left_leg), 'chestplate shows body + arms only');
ok(outer.some((it) => !it.hideParts.left_leg && it.hideParts.body && it.hideParts.head), 'boots show legs only');
// the pass really emits dilated quads: the outer layer's boxes are bigger than the bare mob's
const box = (l) => ER.boxLayerFor('zombie', l).parts.find((p) => p.n === 'body');
ok(box('zombie#c').w > box('zombie').w && box('zombie#b').w > box('zombie').w && box('zombie#c').w > box('zombie#b').w,
   'body box grows 0.5 (inner) / 1.0 (outer) a side');
ok(ER.mobQuadCount('zombie', 'zombie#c') > 0, 'the armour pass has quads');
ok(armour(mk('skeleton', eq({ HEAD: 'iron_helmet' }))).length === 1 && armour(mk('husk', eq({ HEAD: 'iron_helmet' }))).length === 1, 'skeleton and husk are dressed too');
ok(armour(mk('zombie', eq({ HEAD: 'pumpkin' }))).length === 0 && armour(mk('zombie', eq({ CHEST: 'iron_helmet' }))).length === 0,
   'a non-armour item, or armour in the wrong slot, draws nothing');
ok(armour(mk('cow', eq({ HEAD: 'iron_helmet' }))).length === 0, 'a cow is not dressed');

// #2124: per-material sheets, leather tint + overlay, armor_stand
const key = (type, o) => armour(mk(type, eq(o))).map((it) => it.texKey).sort().join();
ok(key('zombie', { HEAD: 'diamond_helmet' }) === 'zombie#c#4' && key('zombie', { LEGS: 'golden_leggings' }) === 'zombie#b#3', 'diamond/gold pick their own sheet');
ok(key('zombie', { HEAD: 'chainmail_helmet' }) === 'zombie#c#2' && key('zombie', { CHEST: 'netherite_chestplate' }) === 'zombie#c#5' && key('zombie', { HEAD: 'turtle_helmet' }) === 'zombie#c#6', 'chain/netherite/turtle sheets');
const lea = armour(mk('zombie', eq({ CHEST: 'leather_chestplate' })));
ok(lea.length === 2 && lea[0].texKey === 'zombie#c#1' && lea[1].texKey === 'zombie#c#7' && lea[0].tintRGB && !lea[1].tintRGB, 'leather: tinted base + untinted overlay');
ok(Math.abs(lea[0].tintRGB[0] - 0xA0 / 255) < 1e-6, 'undyed leather tints 0xA06540');
{ const a = eq({ CHEST: 'leather_chestplate' }); a[IT.CHEST].t = { display: { color: 0xFF0000 } };
  const d = armour(mk('zombie', a)); ok(d[0].tintRGB[0] === 1 && d[0].tintRGB[1] === 0, 'dyed leather uses display.color'); }
ok(key('armor_stand', { HEAD: 'iron_helmet' }) === 'armor_stand#c', 'armor_stand is dressed');
ok(ER.mobGeomFor('zombie#c', 'zombie#c#4') && ER.mobGeomFor('zombie#c', 'zombie#c#7'), 'material sheets are baked');
okAv(key('zombie', { HEAD: 'diamond_helmet' }) !== key('zombie', { HEAD: 'iron_helmet' }), 'materials differ from iron');
okAv(armour(mk('zombie', eq({ HEAD: 'iron_helmet' }))).length === 1 && armour(mk('zombie', null)).length === 0, 'one piece draws, none does not');
okAv(!ER.ARMOUR_MOBS.cow && ER.ARMOUR_MOBS.zombie, 'the mob table separates zombie from cow');
okAv(legs[0].hideParts !== outer[0].hideParts, 'inner and outer passes hide different parts');
okAv(box('zombie#c').w !== box('zombie').w, 'an undilated armour layer would fail the growth assertion');

console.log(`assertions passed .. ${pass}\nfailures .. ${fails.length}`);
for (let i = 0; i < breaks; i++) console.log("✓ break caught");
console.log(`${breaks} breaks caught`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
