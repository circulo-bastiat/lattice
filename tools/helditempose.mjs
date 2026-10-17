#!/usr/bin/env node
// helditempose.mjs — #5725: a held item rides the body pose (Dinnerbone flip, sleeping rotation).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m)) console.log('   ✓ ' + m); };
const near = (a, b, e) => Math.abs(a - b) <= e;
console.log('helditempose — #5725');
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
// the sprite lookup needs the item tile map + parts, which live in the browser build; a stand-in
// part id per tile keeps the POSE maths under test (the picture is mobdrawcheck's)
ER.itemLayers = ER.itemLayers || (() => []);
const realLayers = ER.itemLayers, realPart = ER.spritePartOf;
ER.itemLayers = (i) => { const r = realLayers(i); return r && r.length ? r : (IT.stateOf(i) > 0 ? [] : [1000 + i]); };
ER.spritePartOf = (t) => { const r = realPart ? realPart(t) : -1; return r >= 0 ? r : 7; };


const spawn = (t, rnd) => { const p = EL.random; if (rnd) EL.random = rnd; try { return EL.spawn(t, 0.5, 64, 0.5); } finally { EL.random = p; } };
const held = (e) => ER.heldItemsFor(e, ER.mobLayerFor(e.type), e.x, e.y, e.z, 1)[0];
const mk = (t) => { const e = spawn(t, () => 0.9); e.yaw = e.yawO = 0; e.animPos = 0; e.walkAnimSpeed = 0; e.aggressive = false; e.leftHanded = false;
  Eq.setEquipped(e, IT.MAINHAND, Eq.stackOf('iron_shovel')); return e; };
const same = (a, b) => a.every((v, i) => near(v, b[i], 1e-6));

// Dinnerbone: Z180 about height+0.1 -- relative to the feet, x' = -x, y' = h+0.1-y, z' = z; the item matrix gains the same Z180
function dinner() {
  const r = [];
  for (const t of ['skeleton', 'zombie', 'piglin']) {
    const up = mk(t), a = held(up); const dn = mk(t); dn.customName = 'Dinnerbone'; const b = held(dn);
    if (!a || !b) { r.push(t + ' draws its item upright and flipped'); continue; }
    const h = dn.height;
    r.push((near(b.x - dn.x, -(a.x - up.x), 1e-4) && near(b.y - dn.y, h + 0.1 - (a.y - up.y), 1e-4) && near(b.z - dn.z, a.z - up.z, 1e-4)) || `${t}: flipped hand position is the Z180 mirror about height+0.1 (${b.x},${b.y},${b.z} vs ${a.x},${a.y},${a.z})`);
    r.push(!same(a.m, b.m) || `${t}: flipped item matrix differs from upright`);
  }
  EL.list.length = 0;
  return r.filter((x) => x !== true);
}
// sleeping: sleepPose.R + the pillow offset replace the yaw
function sleep() {
  const r = [];
  for (const t of ['zombie', 'piglin']) {
    const up = mk(t), a = held(up);
    const e = mk(t); e.vbSleeping = true; e.vbSleepFacing = M.Reg.PVAL.east;
    const sp = ER.sleepPoseOf(e, 1), b = held(e);
    if (!a || !b || !sp) { r.push(t + ' draws its item upright and asleep'); continue; }
    const Ar = ER.heldItemAffine(ER.posedPart(M.BEModel.layer(ER.mobLayerFor(t)).parts.find((p) => p.n === 'right_arm'), ER.animOf(e, 1), ER.mobLayerFor(t)), false, IT.thirdPersonTransform(Eq.getEquipped(e, IT.MAINHAND).i), false);
    r.push(!same(a.m, b.m) || `${t}: lying item matrix differs from upright`);
    const R = sp.R, bs = -1, D = [bs, 0, 0, 0, bs, 0, 0, 0, 1];
    const mm = (A, B) => { const C = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C.push(A[i*3]*B[j] + A[i*3+1]*B[3+j] + A[i*3+2]*B[6+j]); return C; };
    const sc = ER.renderScaleOf(e) || 1;
    r.push(same(b.m, mm(mm(D, R), Ar.R).map((v) => v * sc)) || `${t}: lying item matrix = body-pose * hand attachment`);
    r.push((Math.abs((b.x - e.x) - (a.x - up.x)) > 0.1) || `${t}: lying item position moved`);
  }
  EL.list.length = 0;
  return r.filter((x) => x !== true);
}
for (const f of dinner()) ok(false, f); ok(true, 'dinnerbone');
for (const f of sleep()) ok(false, f); ok(true, 'sleep');
{
  const k = ER.shouldFlipUpsideDown; ER.shouldFlipUpsideDown = () => false;
  okAv(dinner().length > 0, 'skipping the Dinnerbone flip is caught');
  ER.shouldFlipUpsideDown = k;
  const s = ER.sleepPoseOf; ER.sleepPoseOf = () => null;
  okAv(sleep().length > 0, 'skipping the sleep rotation is caught');
  ER.sleepPoseOf = s;
}
if (fails.length) { console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const f of fails) console.log('  ✗ ' + f); console.log('FAIL helditempose'); process.exit(1); }
console.log(`PASS helditempose: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
