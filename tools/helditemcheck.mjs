#!/usr/bin/env node
// helditemcheck.mjs — s134: a mob's held item is drawn (HeldItemFeatureRenderer, ER.heldItemsFor).
//
//   1. items.bin carries each item's thirdperson_righthand: a sword is item/handheld's
//      [0,-90,55] [0,4,0.5] x0.85, a sprite item item/generated's [0,0,0] [0,3,1] x0.55; ~every item has one.
//   2. a wither skeleton with its stone sword and a skeleton with its bow each draw ONE held item;
//      a cow draws none; an empty hand draws none.
//   2b. KW-33: the piglin family got arms back (extract-models.mjs now follows a MESH-returning
//      method's delegate to another MESH-returning method, not just LAYER's) — a piglin_brute's
//      golden axe, a piglin's crossbow/sword and a zombified_piglin's golden sword each sit on a
//      REAL right_arm part now, not the "no arm, nothing to draw" gap this file used to pin.
//   3. the item sits at the hand end of the arm (10 px down the arm from the shoulder), moves with the
//      arm's swing, and a left-handed mob holds it on the left.
//   4. anti-vacuity.
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
console.log('helditemcheck — s134: mob-held items (HeldItemFeatureRenderer)');
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
ER.itemLayers = (i) => { const r = realLayers(i); return r && r.length ? r : (IT.stateOf(i) > 0 || ER.beIndexOf(i) >= 0 ? [] : [1000 + i]); };
ER.spritePartOf = (t) => { const r = realPart ? realPart(t) : -1; return r >= 0 ? r : 7; };

// ── 1 ──
const tp = (n) => IT.thirdPersonTransform(IT.index[n]);
const eq = (a, b) => a && b.every((v, i) => near(a[i], v, 1e-4));
ok(eq(tp('golden_sword'), [0, -90, 55, 0, 4, 0.5, 0.85, 0.85, 0.85]), 'golden_sword: item/handheld thirdperson_righthand ' + JSON.stringify(tp('golden_sword')));
ok(eq(tp('gold_ingot'), [0, 0, 0, 0, 3, 1, 0.55, 0.55, 0.55]), 'gold_ingot: item/generated thirdperson_righthand ' + JSON.stringify(tp('gold_ingot')));
{ let n = 0; for (let i = 0; i < IT.count; i++) if (IT.thirdPersonTransform(i)) n++; ok(n > IT.count * 0.9, `${n}/${IT.count} items carry a third-person transform`); }

// ── 2 ──
const spawn = (t, rnd) => { const p = EL.random; if (rnd) EL.random = rnd; try { return EL.spawn(t, 0.5, 64, 0.5); } finally { EL.random = p; } };
const held = (e) => ER.heldItemsFor(e, ER.mobLayerFor(e.type), e.x, e.y, e.z, 1);
function sec2() {
  const r = [];
  const ws = spawn('wither_skeleton', () => 0.9); ws.yaw = ws.yawO = 0;
  r.push(held(ws).length === 1 || 'a wither skeleton draws its stone sword');
  const sk = spawn('skeleton', () => 0.9); r.push(held(sk).length === 1 || 'a skeleton not drawing its bow still holds it (the generic path)');
  // KW-33: the piglin family's model layer HAS arms now (piglincheck/hoglincheck's own
  // territory verifies the boxes themselves; this only checks the arm is there to hold on).
  const br = spawn('piglin_brute'); r.push(held(br).length === (M.BEModel.layer('piglin_brute').parts.some((p) => p.n === 'right_arm') ? 1 : 0) || 'a brute holds its axe exactly when its model has an arm');
  const cw = spawn('cow'); r.push(held(cw).length === 0 || 'a cow draws nothing');
  const z = spawn('zombie', () => 0.99); Eq.setEquipped(z, IT.MAINHAND, null);
  r.push(held(z).length === 0 || 'an empty-handed zombie draws nothing');
  EL.list.length = 0;
  return r.filter((x) => x !== true);
}
for (const f of sec2()) ok(false, f); ok(true, '§2');

// ── 2b ── KW-33: the whole piglin family now has arms (piglin/piglin_brute/zombified_piglin
// all reach BipedEntityModel through PlayerEntityModel), so each one's default weapon draws
// on a real right_arm rather than being silently skipped for lack of anywhere to put it.
function sec2b() {
  const r = [];
  // crossbow (rnd() < CROSSBOW_CHANCE after clearing the baby roll)
  const pgCb = spawn('piglin', () => 0.4);
  r.push(IT.nameOf(Eq.getEquipped(pgCb, IT.MAINHAND).i) === 'crossbow' || 'a piglin spawned with rnd()=0.4 carries a crossbow');
  r.push(held(pgCb).length === 1 || 'a piglin holding a crossbow draws it on its arm');
  // golden_sword (the other half of the roll)
  const pgSw = spawn('piglin', () => 0.9);
  r.push(IT.nameOf(Eq.getEquipped(pgSw, IT.MAINHAND).i) === 'golden_sword' || 'a piglin spawned with rnd()=0.9 carries a golden sword');
  r.push(held(pgSw).length === 1 || 'a piglin holding a golden sword draws it on its arm');
  // piglin_brute: always a golden axe, and at the hand end of ITS arm (not the zombie's, D-415 —
  // a piglin_brute's right_arm is Biped's own, wider than a zombie's own texOffs but same pivot).
  const br = spawn('piglin_brute'); br.yaw = br.yawO = 0; br.x = 0.5; br.z = 0.5;
  r.push(IT.nameOf(Eq.getEquipped(br, IT.MAINHAND).i) === 'golden_axe' || 'a piglin_brute always carries a golden axe');
  const brHeld = held(br)[0];
  if (!brHeld) r.push('a piglin_brute with its golden axe draws it');
  else {
    const L = M.BEModel.layer('piglin_brute'), arm = L.parts.find((p) => p.n === 'right_arm');
    r.push(!!arm || 'piglin_brute has a right_arm part to hold the axe on');
    if (arm) {
      const posed = ER.posedPart(arm, ER.animOf(br, 1), 'piglin_brute');
      const out = new Float64Array(3); M.BEModel.poseAxis(posed, -1, 10, -2, out);
      const mx = (posed.px + out[0]) / 16, my = (posed.py + out[1]) / 16, mz = (posed.pz + out[2]) / 16;
      const wx = br.x - mx, wy = br.y + 1.501 - my, wz = br.z + mz;
      const d = Math.hypot(brHeld.x - wx, brHeld.y - wy, brHeld.z - wz);
      r.push(d < 0.45 || `the axe is at the hand end of the piglin_brute's arm (${d.toFixed(3)} blocks off)`);
    }
  }
  // zombified_piglin: initEquipment's default mainhand weapon map (07y_equip.js) says golden_sword
  const zp = spawn('zombified_piglin');
  r.push(IT.nameOf(Eq.getEquipped(zp, IT.MAINHAND).i) === 'golden_sword' || 'a zombified_piglin carries a golden sword by default');
  r.push(held(zp).length === 1 || 'a zombified_piglin holding a golden sword draws it on its arm');
  EL.list.length = 0;
  return r.filter((x) => x !== true);
}
for (const f of sec2b()) ok(false, f); ok(true, '§2b');

// ── 3 ──
function sec3() {
  const r = [];
  const z = spawn('zombie', () => 0.99); z.yaw = z.yawO = 0; z.x = 0.5; z.z = 0.5;
  Eq.setEquipped(z, IT.MAINHAND, Eq.stackOf('iron_shovel'));
  z.animPos = 0; z.walkAnimSpeed = 0; z.aggressive = false;
  const it = held(z)[0];
  if (!it) return ['a zombie with a shovel draws it'];
  // the hand end, independently: the arm's own pivot, 10 px down its (posed) local -> model -> world
  const L = M.BEModel.layer('zombie'), arm = L.parts.find((p) => p.n === 'right_arm');
  const posed = ER.posedPart(arm, ER.animOf(z, 1), 'zombie');
  const out = new Float64Array(3); M.BEModel.poseAxis(posed, -1, 10, -2, out);
  const mx = (posed.px + out[0]) / 16, my = (posed.py + out[1]) / 16, mz = (posed.pz + out[2]) / 16;
  const wx = z.x - mx, wy = z.y + 1.501 - my, wz = z.z + mz;   // flip x/y, yaw 0, the 1.501 lift
  const d = Math.hypot(it.x - wx, it.y - wy, it.z - wz);
  r.push(d < 0.45 || `the shovel is at the hand end of the arm (${d.toFixed(3)} blocks off)`);
  z.swingTime = 3; z.handSwinging = true;
  const it2 = held(z)[0];
  const moved = it2 && Math.hypot(it2.x - it.x, it2.y - it.y, it2.z - it.z);
  const zs = ER.animOf(z, 1).attackTime;
  if (zs > 0) r.push(moved > 0.01 || `the item follows the arm's swing (moved ${moved})`);
  z.swingTime = 0; z.handSwinging = false;
  z.leftHanded = true;
  const it3 = held(z)[0];
  r.push((it3 && (it3.x - z.x) * (it.x - z.x) < -0.01) || `a left-handed mob holds it on the other side (${it.x} vs ${it3 && it3.x})`);
  EL.list.length = 0;
  return r.filter((x) => x !== true);
}
for (const f of sec3()) ok(false, f); ok(true, '§3');

// ── 3b ── a held BLOCK item is a block-model entry at the hand affine
function sec3b() {
  const r = [];
  const z = spawn('zombie', () => 0.99); z.yaw = z.yawO = 0;
  Eq.setEquipped(z, IT.MAINHAND, Eq.stackOf('cobblestone'));
  const h = held(z);
  r.push((h.length === 1 && h[0].heldBlock && h[0].state === IT.stateOf(IT.index.cobblestone) && !h[0].flatSprite) || 'a zombie holding cobblestone emits a block-model entry');
  Eq.setEquipped(z, IT.MAINHAND, Eq.stackOf('iron_shovel'));
  const s = held(z);
  r.push((s.length === 1 && s[0].flatSprite && !s[0].heldBlock) || 'a sprite item still emits the extruded sprite');
  EL.list.length = 0;
  return r.filter((x) => x !== true);
}
for (const f of sec3b()) ok(false, f); ok(true, '§3b');

// ── 3c ── #5915: a held block-ENTITY item is the baked in-world BE part at the hand affine
const BE_HELD = ['chest', 'ender_chest', 'trapped_chest', 'red_shulker_box', 'white_banner', 'red_bed', 'skeleton_skull'];
function sec3c() {
  const r = [];
  const z = spawn('zombie', () => 0.99); z.yaw = z.yawO = 0;
  for (const n of BE_HELD) {
    Eq.setEquipped(z, IT.MAINHAND, Eq.stackOf(n));
    const h = held(z), want = ER.bePartOf(ER.beIndexOf(IT.index[n]));
    r.push((want >= 0 && h.length === 1 && h[0].heldBE && h[0].sprites.length === 1 && h[0].sprites[0] === want && h[0].m && !h[0].flatSprite) || `a zombie holding ${n} draws its block-entity part (${want})`);
  }
  EL.list.length = 0;
  return r.filter((x) => x !== true);
}
for (const f of sec3c()) ok(false, f); ok(true, '§3c');

// ── 4 ──
{
  const kb = ER.bePartOf; ER.bePartOf = () => -1;
  okAv(sec3c().length > 0, 'a skipped block-entity held item is caught');
  ER.bePartOf = kb;
}
{
  const ks = IT.stateOf; IT.stateOf = () => -1;
  okAv(sec3b().length > 0, 'a stubbed-out block branch is caught');
  IT.stateOf = ks;
  const keep = ER.BIPED_SWING.wither_skeleton; delete ER.BIPED_SWING.wither_skeleton;
  okAv(sec2().length > 0, 'a mob outside the biped set draws no item — the count is read');
  // D-6xx (KW-33): break the piglin family's OWN model layer's right_arm and confirm a
  // caught model without one is exactly the state the fix above erased — not a check that
  // would pass just as well against the pre-fix, armless piglin.
  const pgArm = M.BEModel.layer('piglin').parts;
  const idx = pgArm.findIndex((p) => p.n === 'right_arm');
  const saved = pgArm.splice(idx, 1)[0];
  okAv(sec2b().length > 0, "a piglin with no right_arm cannot hold anything on it");
  pgArm.splice(idx, 0, saved);
  ER.BIPED_SWING.wither_skeleton = keep;
  const k2 = ER.heldItemAffine;
  ER.heldItemAffine = (a, l, x, b) => ({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] });
  okAv(sec3().length > 0, 'an item not posed on the arm is caught');
  ER.heldItemAffine = k2;
}
if (fails.length) { console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const f of fails) console.log('  ✗ ' + f); console.log('FAIL helditemcheck'); process.exit(1); }
console.log(`PASS helditemcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
