#!/usr/bin/env node
// dolphinrendercheck.mjs — #720: DolphinEntityModel.setAngles + DolphinHeldItemFeatureRenderer.
//   1. constants read out of .decomp (0.05, 0.1, 0.2, 0.3, 1.0E-7, 60, 0.5/0.8/0.2) and the engine's
//      per-part deltas equal the formulas: body takes head pitch/yaw always; while moving the
//      body/tail/tail_fin swing; standing still they stay at rest.
//   2. the held item: main hand (off hand when left-handed), none when empty, at the
//      translate(0, 1∓.., -1±..) mouth position, moving with pitch; nothing for a cow.
//   3. anti-vacuity: break the delta and the item translate, and both are caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m)) console.log('   ✓ ' + m); };
const near = (a, b, e = 1e-5) => Math.abs(a - b) <= e;
console.log('dolphinrendercheck — #720: dolphin setAngles + held item');
const src = (f) => readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/client/render/entity', f), 'utf8');
const model = src('model/DolphinEntityModel.java'), feat = src('feature/DolphinHeldItemFeatureRenderer.java');
ok(/1\.0E-7/.test(model) && /-0\.05F - 0\.05F \* MathHelper\.cos\(\$\$3 \* 0\.3F\)/.test(model), 'decomp body swing');
ok(/tail\.pitch = -0\.1F \* MathHelper\.cos/.test(model) && /tailFin\.pitch = -0\.2F \* MathHelper\.cos/.test(model), 'decomp tail swing');
ok(/1\.0F - \$\$13 \* 0\.5F/.test(feat) && /1\.0F \+ \$\$13 \* 0\.8F/.test(feat) && /-1\.0F \+ \$\$13 \* 0\.2F/.test(feat) && /field_4318/.test(feat), 'decomp held translate');

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

const D2R = 0.017453292;
function sec1() {
  const r = [], L = M.BEModel.layer('dolphin');
  const rest = (n) => L.parts.find((p) => p.n === n);
  const d = (n, mv, age, pitch, yaw) => ER.setupAnimDelta(n, 0, 0, yaw, pitch, false, null, { dolphin: { moving: mv }, ageInTicks: age, rest: rest(n) });
  const c = Math.cos(10 * 0.3);
  let b = d('body', true, 10, 20, 30);
  r.push((b && near(b.rx, 20 * D2R - 0.05 - 0.05 * c) && near(b.ry, 30 * D2R)) || 'moving body pitch/yaw ' + JSON.stringify(b));
  b = d('body', false, 10, 20, 30);
  r.push((b && near(b.rx, 20 * D2R) && near(b.ry, 30 * D2R)) || 'still body = head angles ' + JSON.stringify(b));
  const t = d('tail', true, 10, 0, 0), tf = d('tail_fin', true, 10, 0, 0);
  r.push((t && near(rest('tail').rx + t.rx, -0.1 * c)) || 'tail pitch assigned -0.1cos');
  r.push((tf && near(rest('tail_fin').rx + tf.rx, -0.2 * c)) || 'tail_fin pitch assigned -0.2cos');
  r.push((d('tail', false, 10, 0, 0).rx === 0 && d('tail_fin', false, 10, 0, 0).rx === 0) || 'still: tail at rest');
  r.push(d('head', true, 10, 40, 40) === null || 'the head takes nothing of its own');
  r.push(ER.partParentOf('dolphin', 'tail_fin') === 'tail' && ER.partParentOf('dolphin', 'tail') === 'body' || 'dolphin part parents');
  // animOf reads the horizontal speed
  const dol = EL.spawn('dolphin', 0.5, 64, 0.5);
  dol.vx = 0.001; dol.vz = 0; r.push(ER.animOf(dol, 1).dolphin.moving || 'animOf: v^2 1e-6 > 1e-7 moves');
  dol.vx = 0.0003; r.push(!ER.animOf(dol, 1).dolphin.moving || 'animOf: v^2 9e-8 is still');
  EL.list.length = 0;
  return r.filter((x) => x !== true);
}
for (const f of sec1()) ok(false, f); ok(true, '§1');

function sec2() {
  const r = [];
  const held = (e) => ER.heldItemsFor(e, ER.mobLayerFor(e.type), e.x, e.y, e.z, 1);
  const dol = EL.spawn('dolphin', 0.5, 64, 0.5); dol.yaw = dol.yawO = 0;
  Eq.setEquipped(dol, IT.MAINHAND, null); Eq.setEquipped(dol, IT.OFFHAND, null);
  r.push(held(dol).length === 0 || 'empty mouth draws nothing');
  Eq.setEquipped(dol, IT.MAINHAND, { i: IT.index.cod, n: 1 });
  let h = held(dol);
  r.push(h.length === 1 || 'main hand item drawn');
  dol.xHeadRot = dol.xHeadRotO = 0;
  h = held(dol)[0];
  const U = M.CFG.MODEL_UNITS_PER_BLOCK, bp = ER.basePoseFor('dolphin');
  const y0 = 64 + (bp.yOffsetFixed || 0) / U - (1 + 2 / 16);
  r.push((h && near(h.y, y0, 1e-4) && near(h.z, 0.5 - 1, 1e-4) && near(h.x, 0.5, 1e-4)) || 'level mouth position ' + (h && [h.x, h.y, h.z]));
  dol.xHeadRot = dol.xHeadRotO = 30 * D2R;   // 30 deg down: a = .5 -> (1.4, -0.9)
  h = held(dol)[0];
  r.push((h && near(h.y, y0 - 0.4, 1e-3) && near(h.z, 0.5 - 0.9, 1e-3)) || 'pitched-down mouth position ' + (h && [h.y, h.z]));
  dol.xHeadRot = dol.xHeadRotO = -30 * D2R;  // up: (0.75, -0.75)
  h = held(dol)[0];
  r.push((h && near(h.y, y0 + 0.25, 1e-3) && near(h.z, 0.5 - 0.75, 1e-3)) || 'pitched-up mouth position ' + (h && [h.y, h.z]));
  dol.leftHanded = true; r.push(held(dol).length === 0 || 'left-handed reads the off hand (empty)');
  dol.leftHanded = false;
  const cw = EL.spawn('cow', 3.5, 64, 3.5); r.push(held(cw).length === 0 || 'a cow draws nothing');
  EL.list.length = 0;
  return r.filter((x) => x !== true);
}
for (const f of sec2()) ok(false, f); ok(true, '§2');

{
  const k = ER.setupAnimDelta;
  ER.setupAnimDelta = (...a) => (a[0] === 'body' || a[0] === 'tail' ? { rx: 0, ry: 0, rz: 0 } : k(...a));
  okAv(sec1().length > 0, 'a dolphin whose body/tail never swing is caught');
  ER.setupAnimDelta = k;
  const k2 = ER.dolphinHeldItems;
  ER.dolphinHeldItems = () => [];
  okAv(sec2().length > 0, 'a dolphin that draws no item is caught');
  ER.dolphinHeldItems = k2;
  const g = ER.GROUND_SPRITE; const ty = g.ty; g.ty = 0;
  okAv(sec2().length > 0, 'a wrong ground lift is caught');
  g.ty = ty;
}
if (fails.length) { console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const f of fails) console.log('  ✗ ' + f); console.log('FAIL dolphinrendercheck'); process.exit(1); }
console.log(`PASS dolphinrendercheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
