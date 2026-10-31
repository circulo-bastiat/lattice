#!/usr/bin/env node
// pandahelditemcheck.mjs — #1136: PandaHeldItemFeatureRenderer (mainhand bamboo/cake in the mouth).
//   decomp constants; sitting-only; unscared; eating bob; anti-vacuity breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m)) console.log('   ✓ ' + m); };
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;
console.log('pandahelditemcheck — #1136');
const feat = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/client/render/entity/feature/PandaHeldItemFeatureRenderer.java'), 'utf8');
ok(/-0\.6F/.test(feat) && /1\.4F/.test(feat) && /0\.2F \* MathHelper\.sin\(\$\$7 \* 0\.6F\) \+ 0\.2F/.test(feat) && /0\.09F/.test(feat) && /translate\(0\.1F/.test(feat) && /field_4318/.test(feat) && /isSitting\(\) && !\$\$3\.isScaredByThunderstorm/.test(feat), 'decomp constants');

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
  '07m_breed.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
  '07zzf_piglin.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
if (initRegistry) initRegistry(M);
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
{ const mm = rdj('models.meta.json'); M.BEModel.init({ models: b64('models.bin'), modelsBytes: mm.rawBytes }); }
M.Entities.init(); M.EntityList.init(); M.Equip.init();
if (M.Effects && M.Effects.init) M.Effects.init();
M.Combat.init(); M.EntityRender.init();
const EL = M.EntityList, IT = M.Items, Eq = M.Equip, ER = M.EntityRender;
const realLayers = ER.itemLayers, realPart = ER.spritePartOf;
ER.itemLayers = (i) => { const r = realLayers && realLayers(i); return r && r.length ? r : [1000 + i]; };
ER.spritePartOf = (t) => { const r = realPart ? realPart(t) : -1; return r >= 0 ? r : 7; };

function sec() {
  const r = [];
  const held = (e) => ER.heldItemsFor(e, ER.mobLayerFor(e.type), e.x, e.y, e.z, 1);
  const p = EL.spawn('panda', 0.5, 64, 0.5); p.yaw = p.yawO = 0; p.age = 0;
  Eq.setEquipped(p, IT.MAINHAND, { i: IT.index.bamboo, n: 1 });
  p.sitting = false; r.push(held(p).length === 0 || 'standing panda draws nothing');
  p.sitting = true;
  let h = held(p);
  r.push(h.length === 1 || 'sitting panda with bamboo draws one item');
  const U = M.CFG.MODEL_UNITS_PER_BLOCK, bp = ER.basePoseFor('panda');
  const y0 = 64 + (bp.yOffsetFixed || 0) / U - (1.4 + 2 / 16);
  h = h[0];
  r.push((h && near(h.y, y0) && near(h.z, 0.5 - 0.6) && near(h.x, 0.5 - 0.1)) || 'mouth position ' + (h && [h.x, h.y, h.z]));
  p.scaredByThunderstorm = true; r.push(held(p).length === 0 || 'scared by thunder draws nothing'); p.scaredByThunderstorm = false;
  p.eating = true; p.age = 0;
  h = held(p)[0];
  const sn = Math.sin(0.6);
  r.push((h && near(h.z, 0.5 - (0.6 + 0.2 * sn + 0.2)) && near(h.y, y0 + 0.09 * sn)) || 'eating bob ' + (h && [h.y, h.z]));
  p.eating = false;
  Eq.setEquipped(p, IT.MAINHAND, null); r.push(held(p).length === 0 || 'empty mouth draws nothing');
  EL.list.length = 0;
  return r.filter((x) => x !== true);
}
for (const f of sec()) ok(false, f); ok(true, 'sec');
{
  const k = ER.pandaHeldItems; ER.pandaHeldItems = () => [];
  okAv(sec().length > 0, 'a panda that draws no item is caught');
  ER.pandaHeldItems = k;
  const g = ER.GROUND_SPRITE; const ty = g.ty; g.ty = 0;
  okAv(sec().length > 0, 'a wrong ground lift is caught');
  g.ty = ty;
}
if (fails.length) { console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const f of fails) console.log('  ✗ ' + f); console.log('FAIL pandahelditemcheck'); process.exit(1); }
console.log(`PASS pandahelditemcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
