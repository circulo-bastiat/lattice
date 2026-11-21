#!/usr/bin/env node
// vexcheck.mjs — #760: VexEntityRenderer.getTexture (vex_charging.png while isCharging) and
// VexEntityModel.setAngles (charging arm pitch, right_leg += pi/5, wing pivot/yaw/pitch/roll), read off .decomp.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '07j_entityrender.js', '07m_breed.js', '10_gfx.js', '15h_bemodel.js', '07k_goals.js', '07t_fly.js', '07zw_mobnbt.js', '07_world.js', '07b_behaviour.js'], dom: false });
initRegistry(M);
const ER = M.EntityRender;

const mdl = readFileSync(join(ROOT, '.decomp/net/minecraft/client/render/entity/model/VexEntityModel.java'), 'utf8');
const rnd = readFileSync(join(ROOT, '.decomp/net/minecraft/client/render/entity/VexEntityRenderer.java'), 'utf8');
ok(/vex_charging\.png/.test(rnd) && /3\.7699115F/.test(mdl) && /0\.47123894F/.test(mdl), '.decomp no longer says what this check encodes');

const skin = (e) => ER.vexSkinKey(e);
ok(skin({ type: 'vex', charging: true }) === 'vex_charging', 'a charging vex draws vex_charging');
ok(skin({ type: 'vex', charging: false }) === null, 'an idle vex keeps the plain texture');
ok(skin({ type: 'zombie', charging: true }) === null, 'only vex swaps');
const src = readFileSync(join(ROOT, 'tools/extract-mob-textures.mjs'), 'utf8');
ok(/vex_charging: P\('illager\/vex_charging\.png'\)/.test(src) && /'vex_charging'/.test(src), 'vex_charging is extracted');
ok(/vex_charging: 'vex'/.test(readFileSync(join(ROOT, 'tools/pack-mobtex.mjs'), 'utf8')), 'vex_charging draws the vex box list');

const rest = (o) => Object.assign({ px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }, o);
const arm = (name, vex, r) => ER.vexDelta(name, { rx: 0.3, ry: 0, rz: 0 }, vex, 0, r);
const ch = { charging: true, leftHanded: false };
ok(Math.abs(arm('right_arm', ch, rest()).rx - 3.7699115) < 1e-6, 'charging main (right) arm pitch = 3.7699115');
ok(Math.abs(arm('left_arm', ch, rest()).rx - 0.3) < 1e-6, 'charging: off arm keeps the biped pitch');
ok(Math.abs(arm('left_arm', { charging: true, leftHanded: true }, rest()).rx - 3.7699115) < 1e-6, 'left-handed vex charges with the left arm');
const em = { charging: true, leftHanded: false, mainEmpty: true };
ok(Math.abs(arm('right_arm', em, rest()).rx - 3 * Math.PI / 2) < 1e-6 && Math.abs(arm('left_arm', em, rest()).rx - 3 * Math.PI / 2) < 1e-6, 'empty-handed charging vex: both arms 3pi/2');
ok(Math.abs(arm('left_arm', { charging: false, mainEmpty: true }, rest()).rx - 0.3) < 1e-6, 'empty-handed idle vex: arm untouched');
ok(Math.abs(arm('right_arm', { charging: false }, rest()).rx - 0.3) < 1e-6, 'idle arm is not touched');
ok(Math.abs(ER.vexDelta('right_leg', { rx: 0.1, ry: 0, rz: 0 }, ch, 0, rest()).rx - (0.1 + Math.PI / 5)) < 1e-6, 'right_leg pitch += pi/5');
const rw = ER.vexDelta('right_wing', null, ch, 0, rest()), lw = ER.vexDelta('left_wing', null, ch, 0, rest());
ok(rw.dpy === 1 && rw.dpz === 2 && lw.dpy === 1 && lw.dpz === 2, 'wing pivotY 1, pivotZ 2');
ok(Math.abs(rw.ry - (0.47123894 + Math.PI * 0.05)) < 1e-6 && Math.abs(lw.ry + rw.ry) < 1e-9, 'wing yaw = 0.4712 + cos(0)*pi*0.05, left negated');
ok(Math.abs(rw.rx - 0.47123894) < 1e-6 && Math.abs(rw.rz - 0.47123894) < 1e-6 && Math.abs(lw.rz + 0.47123894) < 1e-6, 'wing pitch/roll');
// through the public entry the renderer uses
const via = ER.setupAnimDelta('right_arm', 0, 0, 0, 0, false, ER.modelKindOf('vex'), { vex: ch, rest: rest(), ageInTicks: 0 });
ok(via && Math.abs(via.rx - 3.7699115) < 1e-6, 'setupAnimDelta routes ctx.vex to the vex pose');

// #1251: BoundX/Y/Z + LifeTicks round-trip through MobNbt and the reloaded vex still starves
{
  const EL = M.EntityList, Mb = M.MobNbt;
  const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
  M.Items.init({ items: readFileSync(join(ROOT, 'assets/items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
  M.World.init(1); EL.init();
  const mk = () => { EL.clear(); const v = EL.spawn('vex', 1, 70, 2, {}); v.vexAlive = true; v.vexLifeTicks = 40; v.bounds = { x: 5, y: 71, z: 9 }; return v; };
  const roundTrip = () => { const recs = JSON.parse(JSON.stringify(Mb.serializeAll())); EL.clear(); Mb.restoreAll(recs); return EL.list.find((e) => e && e.type === 'vex'); };
  mk();
  const r = roundTrip();
  ok(r && r.vexAlive === true && r.vexLifeTicks === 40 && r.bounds && r.bounds.x === 5 && r.bounds.y === 71 && r.bounds.z === 9, 'vex vexAlive/vexLifeTicks/bounds round-trip');
  let hurts = 0, t = 0;
  if (r) for (; t < 100 && hurts === 0; t++) M.Fly.tickVexLife(r, { hurt: () => { hurts++; } });
  ok(hurts === 1 && t === 40, 'reloaded vex starves after its 40 life ticks (t=' + t + ')');
  // break: a vex whose fields are not persisted would be immortal
  mk(); const rec = JSON.parse(JSON.stringify(Mb.serializeAll())); delete rec[0].vexAlive; EL.clear(); Mb.restoreAll(rec);
  const dead = EL.list.find((e) => e && e.type === 'vex');
  okAv(!(dead && dead.vexAlive === true), 'a record without vexAlive restores an immortal vex (the bug) and is caught');
}
// #1758: ChargeTargetGoal.tick only calls tryAttack (MobEntity.tryAttack never swings) -> no hand swing
{
  const strike = (swing) => {
    const v = { type: 'vex', x: 0, y: 0, z: 0, width: 0.4, height: 0.8, charging: true, flyMove: { isMoving: () => true, moveTo() {} } };
    v.target = { x: 0, y: 0, z: 0, width: 0.6, height: 1.8, health: 20 };
    const g = new M.Ai.ChargeTargetGoal(v, { random: () => 0 });
    const Cb = M.Combat; const orig = Cb && Cb.mobAttack; if (Cb) Cb.mobAttack = () => {};
    if (swing) ER.swingHand(v);
    g.tick();
    if (Cb) Cb.mobAttack = orig;
    return v;
  };
  const hit = strike(false);
  ok(hit.charging === false && !hit.handSwinging, 'a vex strike does not swing the main hand (handSwinging=' + hit.handSwinging + ')');
  okAv(!!strike(true).handSwinging, 'a swingHand call on a vex strike would be caught');
}
// anti-vacuity: break the rules and the same asserts must fail
okAv(!(skin({ type: 'vex', charging: false }) === 'vex_charging'), 'a texture that ignores charging would be caught');
okAv(!(Math.abs(arm('right_arm', { charging: false }, rest()).rx - 3.7699115) < 1e-6), 'an arm pose that ignores charging would be caught');
okAv(!(Math.abs(arm('left_arm', ch, rest()).rx - 3 * Math.PI / 2) < 1e-6), 'sworded vex off arm is not 3pi/2');
okAv(!(Math.abs(arm('left_arm', { charging: true, mainEmpty: false }, rest()).rx - 3 * Math.PI / 2) < 1e-6), 'dropping mainEmpty would be caught');
okAv(!(Math.abs(arm('left_arm', ch, rest()).rx - 3.7699115) < 1e-6), 'charging the wrong arm would be caught');
okAv(!(Math.abs(ER.vexDelta('right_leg', { rx: 0.1, ry: 0, rz: 0 }, ch, 0, rest()).rx - 0.1) < 1e-6), 'a missing leg pitch would be caught');

console.log(`vexcheck (#760, the charging vex)\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}`);
if (fails.length) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
