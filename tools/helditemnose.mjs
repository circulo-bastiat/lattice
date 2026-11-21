#!/usr/bin/env node
// helditemnose.mjs — #5724: VillagerHeldItemFeatureRenderer (villager, wandering_trader; witch super) held-item matrix.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m)) console.log('   ✓ ' + m); };
console.log('helditemnose — #5724');
const src = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/client/render/entity/feature/VillagerHeldItemFeatureRenderer.java'), 'utf8');
ok(/translate\(0\.0, 0\.4F, -0\.4F\)/.test(src) && /getDegreesQuaternion\(180\.0F\)/.test(src), 'decomp constants');
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
ER.itemLayers = () => [1000]; ER.spritePartOf = () => 7;
const held = (e) => ER.heldItemsFor(e, ER.mobLayerFor(e.type), e.x, e.y, e.z, 1);
// expected: model (x,y,z)=(0,0.4,-0.4) then rotX 180 then GROUND ty, through the entity's yaw-0 flip map
function sec() {
  const r = [];
  for (const [type, baby] of [['villager', false], ['wandering_trader', false], ['villager', true], ['witch', false]]) {
    const e = EL.spawn(type, 0.5, 64, 0.5); e.yaw = e.yawO = 0; e.age = 0; if (baby) e.baby = true;
    Eq.setEquipped(e, IT.MAINHAND, { i: IT.index.apple, n: 1 });
    const h = held(e);
    if (h.length !== 1) { r.push(type + ' draws ' + h.length); continue; }
    const G = ER.GROUND_SPRITE, bp = ER.basePoseFor(ER.mobLayerFor(type)), bs = bp.flip ? -1 : 1;
    const sc = ER.renderScaleOf(e) || 1;
    const U = M.CFG.MODEL_UNITS_PER_BLOCK;
    // rotX 180: y,z negate; combined with ty after rotation => t = (0, 0.4 - ... ) computed directly
    const ex = 0.5, ey = 64 + (bp.yOffsetFixed || 0) / U * sc + bs * sc * (0.4 - G.ty), ez = 0.5 + 0 * -0.4;
    // z: B = diag(bs*sc, bs*sc, sc) at yaw 0, model z offset -0.4 -> world -0.4*sc
    const ez2 = 0.5 - 0.4 * sc;
    const m = h[0].m, near = (a, b) => Math.abs(a - b) < 1e-4;
    if (!(near(h[0].x, ex) && near(h[0].y, ey) && near(h[0].z, ez2))) r.push(`${type}${baby ? ' baby' : ''} offset ${h[0].x},${h[0].y},${h[0].z} want ${ex},${ey},${ez2}`);
    if (!(near(m[4], -bs * sc * G.scale) && near(m[8], -sc * G.scale) && near(m[0], bs * sc * G.scale))) r.push(`${type}${baby ? ' baby' : ''} rotX180 diag ${m[0]},${m[4]},${m[8]}`);
  }
  EL.list.length = 0;
  return r;
}
for (const f of sec()) ok(false, f); ok(true, 'sec');
{
  const k = ER.witchHeldItems; ER.witchHeldItems = (...a) => k(...a).map((o) => (o.y += 0.1, o));
  okAv(sec().length > 0, 'a shifted item is caught');
  ER.witchHeldItems = () => [];
  okAv(sec().length > 0, 'a villager drawing nothing is caught');
  ER.witchHeldItems = k;
  ER.witchHeldItems = (...a) => k(...a).map((o) => (o.z += 0.1, o));
  okAv(sec().length > 0, 'a shifted nose-side z is caught'); ER.witchHeldItems = k;
}
if (fails.length) { console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const f of fails) console.log('  ✗ ' + f); console.log('FAIL helditemnose'); process.exit(1); }
console.log(`PASS helditemnose: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
