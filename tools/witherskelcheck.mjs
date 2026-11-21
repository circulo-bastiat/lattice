#!/usr/bin/env node
// witherskelcheck.mjs — D-673/D-674 (KW-32 remainder): the wither skeleton SPAWNS, and every mob is
// drawn at its renderer's own scale().
//
//   node tools/witherskelcheck.mjs [--verbose]
//
// Sections (every vanilla number cited from .decomp in src, never re-typed from memory here):
//   1. EL.canSpawn('wither_skeleton') and a live EL.spawn: stone sword in the main hand, no armour,
//      attackDamage 4 (WitherSkeletonEntity.initialize), NEVER enchanted even when every roll is 0
//      (its empty updateEnchantments), and it has a goal roster.
//   2. Cb.mobAttack: a landed hit gives the target Wither for 200 ticks; a skeleton's hit does not.
//   3. Cb.mobShoot: a wither skeleton's arrow is on fire (setOnFireFor(100)); a skeleton's is not.
//   4. ER.renderScaleOf / ER.mobScale / ER.slimeScale against the renderer literals, both directions
//      (a type with no scale() is exactly 1; a baby villager is half an adult).
//   5. The LIFT scales with the model: a 1.2x skeleton layer's lowest vertex stays on the floor
//      (unscaled lift, the pre-D-674 bug shape, puts the feet ~0.3 block underground).
//   6. anti-vacuity: each of the above is broken on purpose and the break is caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m) && !VERBOSE) console.log('   ✓ ' + m); };

console.log('witherskelcheck — D-673/D-674: wither skeleton spawns; renderer scale()');

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
  '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
if (initRegistry) initRegistry(M);
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
{ const mm = rdj('models.meta.json'); M.BEModel.init({ models: b64('models.bin'), modelsBytes: mm.rawBytes }); }
M.Entities.init(); M.EntityList.init(); M.Equip.init();
if (M.EnchHelper && M.EnchHelper.init) M.EnchHelper.init();
if (M.Effects && M.Effects.init) M.Effects.init();
M.Combat.init(); M.EntityRender.init();
const EL = M.EntityList, Eq = M.Equip, IT = M.Items, Cb = M.Combat, ER = M.EntityRender;

const ZERO = () => 0;
function spawn(type, rnd) {
  const prev = EL.random; if (rnd) EL.random = rnd;
  try { return EL.spawn(type, 0.5, 64, 0.5); } finally { EL.random = prev; }
}
const held = (e) => { const s = Eq.getEquipped(e, IT.MAINHAND); return s ? IT.nameOf(s.i) : null; };
const armour = (e) => [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD].map((s) => Eq.getEquipped(e, s)).filter(Boolean).length;
const enchanted = (e) => { const s = Eq.getEquipped(e, IT.MAINHAND); return !!(s && s.t && s.t.Enchantments && s.t.Enchantments.length); };

// ── 1 ──
ok(EL.canSpawn('wither_skeleton'), 'EL.canSpawn(wither_skeleton)');
ok(M.Spawn.canPlace('wither_skeleton') && typeof M.Spawn.RULES.wither_skeleton === 'function', '#1290: Spawn.canPlace(wither_skeleton) (natural spawn / fortress list)');
const ws = spawn('wither_skeleton');
ok(!!ws, 'EL.spawn(wither_skeleton) returns an entity');
if (ws) {
  ok(held(ws) === 'stone_sword', `main hand is stone_sword (got ${held(ws)})`);
  ok(armour(ws) === 0, 'no armour (WitherSkeletonEntity.initEquipment never calls super)');
  ok(ws.attackDamage === 4, `attackDamage 4 (got ${ws.attackDamage})`);
  ok(ws.maxHealth === 20, `max health 20 (got ${ws.maxHealth})`);
  // clamped local difficulty forced to 1 (its maximum) so the 25% x difficulty roll is as live as it gets
  const keepD = Eq.clampedLocalDifficulty; Eq.clampedLocalDifficulty = () => 1;
  let anyEnch = 0;
  for (let i = 0; i < 40; i++) { const w = spawn('wither_skeleton', i === 0 ? ZERO : undefined); if (w && enchanted(w)) anyEnch++; }
  const zs = spawn('zombified_piglin', ZERO);
  Eq.clampedLocalDifficulty = keepD;
  ok(!!zs && enchanted(zs), 'the same forced roll DOES enchant a zombified piglin\'s golden sword (the test can see an enchant)');
  ok(anyEnch === 0, `never enchanted (empty updateEnchantments): ${anyEnch}/40 were`);
  ok(!!(M.Ai && M.Ai.ROSTER && M.Ai.ROSTER.wither_skeleton), 'Ai.ROSTER.wither_skeleton exists');
}
const sk = spawn('skeleton');
ok(!!sk && held(sk) === 'bow', 'a plain skeleton still spawns with a bow (the other direction)');

// ── 2 ──
function hitGivesWither(att) {
  const pig = spawn('pig');
  if (!pig || !att) return null;
  pig.x = att.x + 0.5; pig.invulnerableTime = 0;
  Cb.mobAttack(att, pig);
  return !!(pig.effects && pig.effects.wither && pig.effects.wither.duration === Cb.WITHER_SKELETON_HIT_TICKS);
}
ok(Cb.WITHER_SKELETON_HIT_TICKS === 200, 'Cb.WITHER_SKELETON_HIT_TICKS is 200');
ok(hitGivesWither(ws) === true, 'a wither skeleton hit gives Wither 200');
ok(hitGivesWither(sk) === false, 'a skeleton hit gives no Wither');

// ── 3 ──
function arrowFire(sh) {
  const tgt = { x: sh.x + 6, y: sh.y, z: sh.z, height: 1.8 };
  const a = Cb.mobShoot(sh, tgt, 1, () => 0.5);
  return a ? (a.remainingFireTicks || 0) : null;
}
const fireTicks = Cb.WITHER_SKELETON_ARROW_FIRE * Cb.FIRE_TICKS_PER_SECOND;
ok(arrowFire(ws) === fireTicks, `wither skeleton arrow burns ${fireTicks} ticks (got ${arrowFire(ws)})`);
ok(arrowFire(sk) === 0, 'a skeleton arrow is not on fire');

// ── 4 ──
const T = (t, extra) => Object.assign({ type: t }, extra || {});
const want = { wither_skeleton: 1.2, husk: 1.0625, cave_spider: 0.7, bat: 0.35, cat: 0.8, vex: 0.4,
  polar_bear: 1.2, witch: 0.9375, pillager: 0.9375, wandering_trader: 0.9375, horse: 1.1, donkey: 0.87,
  mule: 0.92, skeleton: 1, zombie: 1, cow: 1, creeper: 1 };
let bad = 0;
for (const [t, v] of Object.entries(want)) if (ER.renderScaleOf(T(t)) !== v) { bad++; ok(false, `${t} scale ${ER.renderScaleOf(T(t))} != ${v}`); }
ok(bad === 0, 'renderScaleOf matches every renderer literal (and is 1 for renderers with none)');
ok(ER.renderScaleOf(T('villager')) === 0.9375 && ER.renderScaleOf(T('villager', { isBaby: true })) === 0.9375 * 0.5,
  'villager 0.9375, baby villager half that');
const sl = ER.slimeScale(T('slime', { size: 4 }), 0);
ok(!!sl && Math.abs(sl.sxz - 3.996) < 1e-9 && Math.abs(sl.sy - 3.996) < 1e-9, 'size-4 slime at rest draws 0.999*4');
const mc = ER.slimeScale(T('magma_cube', { size: 2 }), 0);
ok(!!mc && mc.sxz === 2 && mc.sy === 2, 'size-2 magma cube draws 2');
ok(ER.mobScale(T('cow'), 0) === null, 'a scale-1 mob gets no scale object (byte-identical path)');
const big = ER.mobScale(T('slime', { size: 127 }), 0);
ok(big && big.sxz <= ER.MAX_MOB_SCALE && big.sy <= ER.MAX_MOB_SCALE, 'a Size-127 slime is clamped to the i16 ceiling');

// ── 5 ──
function minY(layer, sc) {
  const n = ER.mobQuadCount(layer);
  const out = new Uint32Array(n * 16);
  ER.emitMobLayer(out, 0, layer, 0, 0, 0, 1, 0, 15, 0, 3, null, undefined, null, false, null, sc || null);
  let lo = Infinity;
  for (let q = 0; q < n; q++) for (let c = 0; c < 4; c++) {
    const o = q * 16 + c * 4;
    const vt = M.Mesher.unpackModelVertex(out[o], out[o + 1], out[o + 2], out[o + 3]);
    if (vt.py < lo) lo = vt.py;
  }
  return lo;
}
const U = M.CFG.MODEL_UNITS_PER_BLOCK;
const y1 = minY('wither_skeleton'), y12 = minY('wither_skeleton', { sxz: 1.2, sy: 1.2 });
ok(Math.abs(y1) <= U / 64, `unscaled feet on the floor (${y1} units)`);
ok(Math.abs(y12) <= U / 64, `1.2x feet still on the floor (${y12} units) — the lift scales with the model`);

// ── 5a phantom (s133): PhantomEntityRenderer.scale — 1 + 0.15*size, then translate(0, 1.3125, 0.1875) ──
function spanY(layer) {
  const n = ER.mobQuadCount(layer); const out = new Uint32Array(n * 16);
  ER.emitMobLayer(out, 0, layer, 0, 0, 0, 1, 0, 15, 0, 3, null, undefined, null, false, null, null);
  let lo = Infinity, hi = -Infinity, zs = 0, k = 0;
  for (let q = 0; q < n; q++) for (let c = 0; c < 4; c++) {
    const o = q * 16 + c * 4; const vt = M.Mesher.unpackModelVertex(out[o], out[o + 1], out[o + 2], out[o + 3]);
    lo = Math.min(lo, vt.py); hi = Math.max(hi, vt.py); zs += vt.pz; k++;
  }
  return { lo: lo / U, hi: hi / U, zc: zs / k / U };
}
{
  ok(ER.renderScaleOf(T('phantom')) === 1 && Math.abs(ER.renderScaleOf(T('phantom', { phantomSize: 2 })) - 1.3) < 1e-9,
    'phantom scale 1 + 0.15 * size (size 0 -> 1, size 2 -> 1.3)');
  const bp = ER.basePoseFor('phantom');
  ok(Math.abs(bp.yOffsetFixed - (1.501 - 1.3125) * U) < 1e-6 && Math.abs(bp.zOffsetFixed - 0.1875 * U) < 1e-6,
    'phantom base pose = the 1.501 lift minus 1.3125, plus 0.1875 along +z');
  const sp = spanY('phantom');
  if (VERBOSE) console.log('   phantom y', sp.lo.toFixed(3), '..', sp.hi.toFixed(3), 'z centre', sp.zc.toFixed(3));
  ok(sp.lo > -0.5 && sp.hi < 1.0, `the phantom model sits on its 0.5-tall hitbox (${sp.lo.toFixed(3)}..${sp.hi.toFixed(3)} blocks)`);
  const keep = ER.RENDER_TRANSLATE.phantom; delete ER.RENDER_TRANSLATE.phantom;
  const sp0 = spanY('phantom'); ER.RENDER_TRANSLATE.phantom = keep;
  okAv(!(sp0.lo > -0.5 && sp0.hi < 1.0), `without the translate the phantom floats (${sp0.lo.toFixed(3)}..${sp0.hi.toFixed(3)})`);
}

// ── 5c animateArms (s133): BipedEntityModel's main-arm chop + body twist ──
{
  const rest = (n) => ({ px: n === 'right_arm' ? -5 : 5, py: 2, pz: 0, rx: 0, ry: 0, rz: 0 });
  const D = (n, t, lh, zarm) => ER.setupAnimDelta(n, 0, 0, 0, 0, false, 'humanoid', { biped: true, attackTime: t, leftHanded: lh, rest: rest(n), zarm: zarm || null });
  ok(ER.animateArmsDelta('right_arm', 0, false, 0, rest('right_arm'), true) === null, 'no swing (t = 0): no delta');
  const rm = D('right_arm', 0.5, false), lm = D('left_arm', 0.5, false);
  const t = 0.5, by = Math.sin(Math.sqrt(t) * Math.PI * 2) * 0.2, f = 1 - Math.pow(1 - t, 4);
  const want = by - (Math.sin(f * Math.PI) * 1.2 + Math.sin(t * Math.PI) * 0.7 * 0.75);
  ok(Math.abs(rm.rx - 0) < 10 && Math.abs(rm.ry - by * 3) < 1e-9 && Math.abs(rm.rz + 0.4) < 1e-9, `right-handed: the right arm chops (yaw 3x twist ${rm.ry.toFixed(3)}, roll -0.4)`);
  ok(Math.abs(rm.rx - (want - by)) < 1e-9, `main-arm pitch = -(1.2 sin(f PI) + h) — got ${rm.rx.toFixed(4)}`);
  ok(Math.abs(lm.rx - by) < 1e-9 && Math.abs(lm.ry - by) < 1e-9 && lm.rz === 0, 'the off (left) arm only takes the twist as yaw and pitch');
  ok(Math.abs(D('body', 0.5, false).ry - by) < 1e-9 && Math.abs(D('body', 0.5, true).ry + by) < 1e-9, 'the body twists, mirrored for a left-handed mob');
  const ll = D('left_arm', 0.5, true);
  ok(Math.abs(ll.rz + 0.4) < 1e-9, 'left-handed: the LEFT arm chops');
  ok(Math.abs(rm.dpx - (-Math.cos(by) * 5 + 5)) < 1e-9 && Math.abs(rm.dpz - Math.sin(by) * 5) < 1e-9, 'the right arm pivot swings round with the body (x -cos*5, z sin*5)');
  const zr = ER.animateArmsDelta('right_arm', 0.5, false, 0, rest('right_arm'), false);
  ok(zr.rx === 0 && zr.ry === 0 && zr.rz === 0 && zr.dpz !== 0, 'a zombie (animateZombieArms reassigns the angles) keeps only the pivot swing');
  ok(!!ER.BIPED_SWING.wither_skeleton && !!ER.BIPED_SWING.piglin && !ER.BIPED_SWING.vindicator && !ER.BIPED_SWING.villager,
    'BIPED_SWING: biped-model mobs in, illagers/villagers (models of their own) out');
  // emitted: a wither skeleton mid-swing draws differently from one at rest
  const emit = (at) => { const n = ER.mobQuadCount('wither_skeleton'); const out = new Uint32Array(n * 16);
    ER.emitMobLayer(out, 0, 'wither_skeleton', 0, 0, 0, 1, 0, 15, 0, 3, { limbSwing: 0, limbSwingAmount: 0, netHeadYaw: 0, headPitch: 0, attackTime: at, leftHanded: false }, undefined, null, false, null, null);
    return out.join(','); };
  ok(emit(0.5) !== emit(0), 'a mid-swing wither skeleton is drawn with its arm moved');
  const keep = ER.BIPED_SWING.wither_skeleton; delete ER.BIPED_SWING.wither_skeleton;
  okAv(emit(0.5) === emit(0), 'dropping wither_skeleton from BIPED_SWING freezes its arm again');
  ER.BIPED_SWING.wither_skeleton = keep;
}

// ── 5b left-handed (D-675): the main-hand arm is the mirrored pivot ──
ok(ER.mainArmPivotX({ leftHanded: false }) === -5 / 16 && ER.mainArmPivotX({ leftHanded: true }) === 5 / 16,
  'right-handed holds at right_arm px -5/16, left-handed at left_arm px +5/16 (models-1.18.2.tsv)');
{
  const keep = ER.mainArmPivotX; ER.mainArmPivotX = () => ER.SKELETON_ARM_PIVOT[0];
  okAv(ER.mainArmPivotX({ leftHanded: true }) !== 5 / 16, 'a left-handed mob drawn right-handed is caught');
  ER.mainArmPivotX = keep;
}

// ── 6 anti-vacuity ──
{
  const keep = M.Spawn.RULES.wither_skeleton; delete M.Spawn.RULES.wither_skeleton;
  okAv(!M.Spawn.canPlace('wither_skeleton'), '#1290: deleting the wither_skeleton rule makes canPlace false');
  M.Spawn.RULES.wither_skeleton = keep;
}
{
  const keep = M.Equip.NO_ENCHANT.wither_skeleton; delete M.Equip.NO_ENCHANT.wither_skeleton;
  const keepD = Eq.clampedLocalDifficulty; Eq.clampedLocalDifficulty = () => 1;
  let n = 0; for (let i = 0; i < 400; i++) { const w = spawn('wither_skeleton'); if (w && enchanted(w)) n++; }
  const w0 = spawn('wither_skeleton', () => 0); if (w0 && enchanted(w0)) n++;
  M.Equip.NO_ENCHANT.wither_skeleton = keep; Eq.clampedLocalDifficulty = keepD;
  okAv(n > 0, `dropping NO_ENCHANT.wither_skeleton lets swords enchant (${n})`);
}
{
  const keep = Cb.WITHER_SKELETON_HIT_TICKS; Cb.WITHER_SKELETON_HIT_TICKS = 199;
  const r = hitGivesWither(spawn('wither_skeleton'));
  Cb.WITHER_SKELETON_HIT_TICKS = keep;
  // the pig's duration is the constant it was given — compare against the TRUE literal instead
  const pig = spawn('pig'); Cb.WITHER_SKELETON_HIT_TICKS = 199; Cb.mobAttack(spawn('wither_skeleton'), pig); Cb.WITHER_SKELETON_HIT_TICKS = keep;
  okAv(!!(pig.effects && pig.effects.wither && pig.effects.wither.duration !== 200) || r === false,
    'a 199-tick wither is told apart from 200');
}
{
  const keep = ER.RENDER_SCALE.wither_skeleton; ER.RENDER_SCALE.wither_skeleton = 1;
  okAv(ER.renderScaleOf(T('wither_skeleton')) !== want.wither_skeleton, 'an unscaled wither skeleton is caught');
  ER.RENDER_SCALE.wither_skeleton = keep;
}
{
  // the pre-D-674 shape: model scaled, lift NOT — simulate by scaling only the model's own vertices
  const n = ER.mobQuadCount('wither_skeleton');
  const lift = ER.basePoseFor('wither_skeleton').yOffsetFixed;
  const yBug = 1.2 * (y1 - lift) + lift;   // what an unscaled lift gives for the same model
  okAv(Math.abs(yBug) > U / 64, `an unscaled lift sinks the feet (${Math.round(yBug)} units) and the ±${U / 64} test would catch it`);
  void n;
}
{
  const keep = EL.WITHER_SKELETON_ATTACK; EL.WITHER_SKELETON_ATTACK = 2;
  const w = spawn('wither_skeleton'); EL.WITHER_SKELETON_ATTACK = keep;
  okAv(!!w && w.attackDamage !== 4, 'the builder 2.0 attack damage is told apart from 4');
}

if (fails.length) {
  console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const f of fails) console.log('  ✗ ' + f); console.log('FAIL witherskelcheck'); process.exit(1); }
console.log(`PASS witherskelcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
