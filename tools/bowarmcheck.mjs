#!/usr/bin/env node
// bowarmcheck.mjs — #5314: the skeleton's bow is chained through the posed right-arm bone (HeldItemFeatureRenderer),
// with BipedEntityModel BOW_AND_ARROW arm angles; hand-end position checked at 3 head pitches.
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
console.log('bowarmcheck — #5314: the skeleton\'s bow rides the posed right-arm bone (BOW_AND_ARROW)');
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


M.DATA.itemTileMap = () => ({ 'item/bow': 1000, 'item/bow_pulling_0': 1001, 'item/bow_pulling_1': 1002, 'item/bow_pulling_2': 1003 });
const spawn = (t) => { const p = EL.random; EL.random = () => 0.9; try { return EL.spawn(t, 0.5, 64, 0.5); } finally { EL.random = p; } };
const handEnd = (sk, partial) => {
  // independent chain: rest arm, arm angles from BipedEntityModel BOW_AND_ARROW written out here, hand end 10px down
  const arm = M.BEModel.layer('skeleton').parts.find((p) => p.n === 'right_arm');
  const hp = (sk.xHeadRot || 0), age = (sk.age || 0) + partial;
  const posed = Object.assign({}, arm, { rx: -Math.PI / 2 + hp, ry: -0.1, rz: Math.cos(age * 0.09) * 0.05 + 0.05 });
  posed.rx += Math.sin(age * 0.067) * 0.05;
  const out = new Float64Array(3); M.BEModel.poseAxis(posed, -1, 10, -2, out);
  const mx = (posed.px + out[0]) / 16, my = (posed.py + out[1]) / 16, mz = (posed.pz + out[2]) / 16;
  return [sk.x - mx, sk.y + 1.501 - my, sk.z + mz];
};
function run() {
  const r = [], pos = [];
  const sk = spawn('skeleton'); sk.yaw = sk.yawO = 0; sk.yHeadRot = sk.yHeadRotO = 0; sk.age = 0;
  sk.animPos = 0; sk.animSpeed = sk.animSpeedO = 0; sk.attacking = true; sk.bowDrawing = true; sk.bowCharge = 0.95;
  for (const hp of [-0.5, 0, 0.5]) {
    sk.xHeadRot = sk.xHeadRotO = hp;
    const b = ER.bowSpritesFor(sk, sk.x, sk.y, sk.z, 1);
    if (!b) { r.push('a drawing skeleton draws its bow'); continue; }
    const h = handEnd(sk, 1), d = Math.hypot(b.x - h[0], b.y - h[1], b.z - h[2]);
    r.push(d < 0.45 || `head pitch ${hp}: the bow is ${d.toFixed(3)} blocks from the posed right-hand bone`);
    pos.push([b.x, b.y, b.z]);
  }
  if (pos.length === 3) r.push(Math.hypot(pos[0][1] - pos[2][1], pos[0][2] - pos[2][2]) > 0.05 || 'the bow moves with the head pitch (the arm is raised by it)');
  EL.list.length = 0;
  return r.filter((x) => x !== true);
}
for (const f of run()) ok(false, f); ok(true, 'bow on posed arm');
// anti-vacuity: the pre-#5314 fixed offset (arm unposed) must fail the same check
{
  const real = ER.skeletonBowArmDelta;
  ER.skeletonBowArmDelta = () => ({ rx: 0, ry: 0, rz: 0 });
  const f = run();
  ER.skeletonBowArmDelta = real;
  okAv(f.length > 0, 'with the BOW_AND_ARROW arm pose replaced by an unposed arm the check fails (' + f.length + ' complaints)');
}
console.log(`\nbowarmcheck: ${pass} assertions, ${fails.length} failed, ${breaks} breaks caught`);
for (const f of fails) console.log('FAIL ' + f);
process.exit(fails.length ? 1 : 0);
