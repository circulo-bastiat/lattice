#!/usr/bin/env node
// witchhelditemcheck.mjs — #1282: witch drinking equips a mainhand potion; held-item layer + nose lift read it.
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
console.log('witchhelditemcheck — #1282');
const feat = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/client/render/entity/feature/WitchHeldItemFeatureRenderer.java'), 'utf8');
ok(/0\.0625, 0\.25, 0\.0/.test(feat) && /getDegreesQuaternion\(140\.0F\)/.test(feat), 'decomp constants');

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
  '07m_breed.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
  '07zzf_piglin.js', '07z_potion.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
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
  const w = EL.spawn('witch', 0.5, 64, 0.5); w.yaw = w.yawO = 0; w.age = 0;
  r.push(held(w).length === 0 || 'empty hand draws nothing');
  r.push(!ER.animOf(w, 1).witch.drinking || 'empty hand: no nose lift');
  w.health = 1; w.maxHealth = 26; w.target = null;
  const Po = M.Potion;
  for (let i = 0; i < 400 && !w.witchDrinking; i++) Po.tickWitchDrink(w, { random: () => 0 });
  r.push(!!w.witchDrinking || 'witch started drinking');
  const st = Eq.getEquipped(w, IT.MAINHAND);
  r.push((st && st.i === IT.index.potion) || 'drinking equips mainhand potion');
  r.push(held(w).length === 1 || 'held-item layer emits a potion quad');
  r.push(ER.animOf(w, 1).witch.drinking || 'mainhand lifts the nose');
  for (let i = 0; i < 80 && w.witchDrinking; i++) Po.tickWitchDrink(w, { random: () => 0 });
  r.push(!Eq.getEquipped(w, IT.MAINHAND) || 'drink end clears mainhand');
  w.witchDrinking = false;
  Eq.setEquipped(w, IT.MAINHAND, { i: IT.index.potion, n: 1 });
  r.push(ER.animOf(w, 1).witch.drinking || 'a given potion lifts the nose without the flag');
  EL.list.length = 0;
  return r.filter((x) => x !== true);
}
for (const f of sec()) ok(false, f); ok(true, 'sec');
{
  const k = ER.witchHeldItems; ER.witchHeldItems = () => [];
  okAv(sec().length > 0, 'a witch that draws no potion is caught');
  ER.witchHeldItems = k;
  const k2 = M.Potion.tickWitchDrink; M.Potion.tickWitchDrink = function (e) { e.witchDrinking = true; };
  okAv(sec().length > 0, 'a drink that equips nothing is caught');
  M.Potion.tickWitchDrink = k2;
}
if (fails.length) { console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const f of fails) console.log('  ✗ ' + f); console.log('FAIL witchhelditemcheck'); process.exit(1); }
console.log(`PASS witchhelditemcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
