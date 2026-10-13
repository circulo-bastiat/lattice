#!/usr/bin/env node
// illagerposecheck.mjs — #1198: IllagerEntityModel.setAngles states + CrossbowPosing (.decomp), per state.
//   pillager: CHARGE / HOLD / ATTACKING / CROSSED; vindicator: CROSSED / ATTACKING / CELEBRATING; arms-part visibility.
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };

const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js'], dom: false });
const ER = M.EntityRender, P = Math.PI;
// A stub equipment so the crossbow lookup is observable without the whole item system.
let held = 'crossbow';
M.Items = { MAINHAND: 0, OFFHAND: 1, nameOf: () => held };
M.Equip = { getEquipped: (e, slot) => (slot === 0 && held ? { i: 1 } : null) };
M.Spell = { isSpellcasting: () => false };
const near = (a, b) => Math.abs(a - b) < 1e-4;
const D = (name, state, over) => ER.illagerArmDelta(name, 0, 0, 20, 10, false,
  Object.assign({ state, ageInTicks: 0, attackTime: 0, leftHanded: false, mainEmpty: false, charge: 0, rest: { rx: 0, ry: 0, rz: 0 } }, over || {}));
const hy = 20 * 0.017453292, hp = 10 * 0.017453292;

// state selection
const pil = (o) => Object.assign({ type: 'pillager' }, o);
ok(ER.illagerStateOf(pil({ crossbowCharging: true })) === 'CROSSBOW_CHARGE', 'charging pillager -> CROSSBOW_CHARGE');
ok(ER.illagerStateOf(pil({})) === 'CROSSBOW_HOLD', 'a pillager holding a crossbow always holds it up');
held = null;
ok(ER.illagerStateOf(pil({ attacking: true })) === 'ATTACKING', 'crossbow-less attacking pillager -> ATTACKING');
ok(ER.illagerStateOf(pil({})) === 'CROSSED', 'idle empty pillager -> CROSSED');
held = 'crossbow';
ok(ER.illagerStateOf({ type: 'vindicator' }) === 'CROSSED', 'idle vindicator crossed');
ok(ER.illagerStateOf({ type: 'vindicator', attacking: true }) === 'ATTACKING', 'attacking vindicator');
ok(ER.illagerStateOf({ type: 'vindicator', celebrating: true }) === 'CELEBRATING', 'celebrating vindicator');
ok(ER.illagerStateOf({ type: 'zombie' }) === null, 'non-illager has no state');

// arm visibility: arms part only when CROSSED
const hid = ER.illagerArmHide('vindicator', 'CROSSED');
ok(hid && hid.left_arm && hid.right_arm && !hid.arms, 'CROSSED hides left_arm/right_arm');
const hid2 = ER.illagerArmHide('pillager', 'CROSSBOW_HOLD');
ok(hid2 && hid2.arms && !hid2.left_arm, 'HOLD hides the crossed arms part');
ok(ER.illagerArmHide('cow', 'CROSSED') === null, 'non-illager untouched');

// CrossbowPosing.hold
ok(near(D('right_arm', 'CROSSBOW_HOLD').ry, -0.3 + hy) && near(D('right_arm', 'CROSSBOW_HOLD').rx, -P / 2 + hp + 0.1), 'hold: right arm');
ok(near(D('left_arm', 'CROSSBOW_HOLD').ry, 0.6 + hy) && near(D('left_arm', 'CROSSBOW_HOLD').rx, -1.5 + hp), 'hold: left arm');
// CrossbowPosing.charge
ok(near(D('right_arm', 'CROSSBOW_CHARGE').ry, -0.8) && near(D('right_arm', 'CROSSBOW_CHARGE').rx, -0.97079635), 'charge: right arm');
ok(near(D('left_arm', 'CROSSBOW_CHARGE', { charge: 0 }).ry, 0.4) && near(D('left_arm', 'CROSSBOW_CHARGE', { charge: 0 }).rx, -0.97079635), 'charge 0: left arm');
ok(near(D('left_arm', 'CROSSBOW_CHARGE', { charge: 1 }).ry, 0.85) && near(D('left_arm', 'CROSSBOW_CHARGE', { charge: 1 }).rx, -P / 2), 'charge 1: left arm');
// meleeAttack (main hand not empty), age 0 swing 0: right = -1.8849558+0.15, left = 0.5; yaw pi/20; swingArms roll +-0.1
const ra = D('right_arm', 'ATTACKING'), la = D('left_arm', 'ATTACKING');
ok(near(ra.rx, -1.8849558 + 0.15) && near(la.rx, 0.5) && near(ra.ry, P / 20) && near(la.ry, -P / 20), 'melee attack: arm pitches/yaws');
ok(near(ra.rz, 0.1) && near(la.rz, -0.1), 'melee attack: swingArms roll');
const ea = D('right_arm', 'ATTACKING', { mainEmpty: true });
ok(near(ea.rx, -P / 1.5) && near(ea.ry, -0.1), 'melee attack, empty hand overload');
// celebrating
ok(near(D('right_arm', 'CELEBRATING').rz, 2.670354) && near(D('left_arm', 'CELEBRATING').rz, -P * 3 / 4), 'celebrating roll');
// ctx plumbing: setupAnimDelta reaches the illager branch and drops the zombie-arm layer for it
const via = ER.setupAnimDelta('right_arm', 0, 0, 20, 10, false, ER.modelKindOf('pillager'),
  { zarm: { yawBase: 1 }, rest: { rx: 0, ry: 0, rz: 0 }, illager: { state: 'CROSSBOW_HOLD', rest: { rx: 0, ry: 0, rz: 0 } } });
ok(via && near(via.rx, -P / 2 + hp + 0.1), 'setupAnimDelta routes illager ctx (not the zombie arm)');

// anti-vacuity: break the pose and watch the assertions fail
okAv(!near(ER.illagerArmDelta('right_arm', 0, 0, 20, 10, false, { state: 'CROSSED', rest: {} }).rx, D('right_arm', 'CROSSBOW_HOLD').rx), 'CROSSED arm differs from HOLD arm');
okAv(!near(D('right_arm', 'CROSSBOW_HOLD').rx, D('right_arm', 'CROSSBOW_HOLD', { rest: { rx: 0.5, ry: 0, rz: 0 } }).rx), 'rest offset changes the delta');
held = null;
okAv(ER.illagerStateOf(pil({})) !== 'CROSSBOW_HOLD', 'a pillager without a crossbow does not hold one');
okAv(!near(D('left_arm', 'CROSSBOW_CHARGE', { charge: 0 }).ry, D('left_arm', 'CROSSBOW_CHARGE', { charge: 1 }).ry), 'charge fraction moves the left arm');

console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
