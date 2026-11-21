#!/usr/bin/env node
// playerrendercheck.mjs — #2628: a remote/third-person player (type 'player') draws via ER.visible:
// Steve/Alex model, biped pose, and ArmorFeatureRenderer passes.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { join } from 'node:path';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07zb_creeper.js', '07y_equip.js', '07k_goals.js', '07q_effects.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07w_passive.js'],
  dom: false
});
initRegistry(M);
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const raw = readFileSync(join(ASSETS, 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init(); M.Passive.init();
const ER = M.EntityRender, IT = M.Items;
const id = (n) => IT.names.indexOf(n);
const mk = (o) => Object.assign({ type: 'player', x: 2, y: 5, z: 0, px: 2, py: 5, pz: 0, yaw: 0, pyaw: 0, age: 0, maxHealth: 20 }, o);
const vis = (e) => { M.EntityList.list = [e]; return ER.visible(0, 5, 0, 1); };
const eq = (o) => { const a = []; for (const k in o) a[IT[k]] = { i: id(o[k]), n: 1, d: 0 }; return a; };

const steve = vis(mk());
ok(steve.length === 1 && steve[0].shape === 'mob' && steve[0].mobLayer === 'player', 'Steve draws one mob item on layer player');
const alex = vis(mk({ slim: true }));
ok(alex.length === 1 && alex[0].mobLayer === 'player_slim', 'slim player draws on layer player_slim');
ok(ER.mobQuadCount('player', 'player') > 0, 'player layer has quads');
ok(ER.animOf(mk({ animSpeed: 1, animSpeedO: 1 }), 1) !== null, 'a player has a walk pose');

const worn = (o) => vis(mk(o)).filter((it) => /#[bc]$/.test(it.texKey || '')).map((it) => it.texKey).sort().join();
const gear = eq({ HEAD: 'iron_helmet', LEGS: 'iron_leggings' });
ok(worn({ equip: gear }) === 'player#b,player#c', 'Steve armour: #b legs + #c helmet, got ' + worn({ equip: gear }));
ok(worn({ equip: gear, slim: true }) === 'player_slim#b,player_slim#c', 'Alex armour on player_slim sheets');
ok(worn({}) === '', 'unarmoured player draws no armour');

{
  const pose = (o, t) => ER.sleepPoseOf(mk(o), t === undefined ? 1 : t);
  const up = (R) => Math.abs(R[4]);   // Y-axis y-component: 1 upright, ~0 lying flat
  ok(pose({}) === null, 'standing player has no lean pose');
  const sw = pose({ swimming: true, inWater: true, swimAmount: 1, lastSwimAmount: 1, xHeadRot: 0 });
  ok(sw && up(sw.R) < 1e-6, 'swimming player (amount 1) lies horizontal');
  ok(sw && Math.hypot(sw.dx, sw.dy, sw.dz) > 0.9, 'swimming pose translates (0,-1,0.3)');
  const half = pose({ swimming: true, inWater: true, swimAmount: 0.5, lastSwimAmount: 0.5 });
  ok(half && Math.abs(half.R[4] - Math.cos(Math.PI / 4)) < 1e-6, 'swimAmount 0.5 leans 45 degrees');
  const gl = pose({ fallFlying: true, fallFlyTicks: 20, xHeadRot: 0, yaw: 0, vx: 0, vz: -1 });
  ok(gl && up(gl.R) < 1e-6, 'gliding player (roll>=10) lies horizontal');
  const gl0 = pose({ fallFlying: true, fallFlyTicks: 0, xHeadRot: 0 }, 0);
  ok(gl0 && up(gl0.R) > 0.999, 'glide lean starts upright (roll 0)');
  okAv(!pose({ swimming: true, inWater: true, swimAmount: 0, lastSwimAmount: 0 }), 'zeroed swimAmount drops the lean (check can fail)');
}
okAv(worn({ type: 'cow', equip: gear }) === '', 'a cow is not dressed (check can fail)');
okAv(vis(mk({ slim: true }))[0].mobLayer !== 'player', 'slim differs from Steve (check can fail)');

// #6734: HeldItemFeatureRenderer + handSwingProgress for the player model.
{
  const L = M.BEModel.layer('player'), arm = L.parts.find((p) => p.n === 'right_arm');
  const sword = eq({ MAINHAND: 'iron_sword' });
  const rx = (o, partial = 1) => ER.posedPart(arm, ER.animOf(mk(o), partial), 'player').rx;
  const t = 0.5, f = 1 - (1 - t) ** 4;
  // BipedEntityModel.setAngles ends the arm with CrossbowPosing.swingArm (#7795): pitch += sin(age * 0.067) * 0.05
  const bob = Math.sin(ER.animOf(mk({ equip: sword }), 1).ageInTicks * 0.067) * 0.05;
  const want = arm.rx - (Math.sin(f * Math.PI) * 1.2 + Math.sin(t * Math.PI) * -(0 - 0.7) * 0.75) + bob - Math.PI / 10;   // #10752: the held sword puts the arm in the ITEM pose (pitch*0.5 - PI/10) before animateArms
  const swung = rx({ equip: sword, handSwingProgress: t, lastHandSwingProgress: t });
  ok(Math.abs(swung - want) < 1e-6, 'mid-swing right arm pitch is the vanilla animateArms value, got ' + swung + ' want ' + want);
  okAv(Math.abs(rx({ equip: sword, handSwingProgress: 0, lastHandSwingProgress: 0 }) - want) > 1e-3, 'swingProgress 0 does not give the swing pitch');
  const held = (o) => ER.heldItemsFor(mk(o), 'player', 2, 5, 0, 1, false).length;
  ok(held({ equip: sword }) === 1, 'a player holding a sword draws a held item');
  okAv(held({}) === 0, 'an empty-handed player draws none');
  const bow = eq({ MAINHAND: 'bow' });
  M.DATA.itemTileMap = () => ({ 'item/bow': 0, 'item/bow_pulling_0': 0, 'item/bow_pulling_1': 0, 'item/bow_pulling_2': 0 });
  const bowE = { equip: bow, attacking: true, bowDrawing: true, bowCharge: 1 };
  const br = rx(bowE);
  ok(Math.abs(br - (-Math.PI / 2 - arm.rx)) < 0.06 + 1e-6 && Math.abs(br - (-Math.PI / 2 - arm.rx)) > 0 , 'drawn bow raises the arm to -PI/2 (+sway), got ' + br);
  okAv(Math.abs(rx({ equip: bow }) - (-Math.PI / 2 - arm.rx)) > 0.5, 'a bow not being drawn leaves the arm down');
  ok(ER.heldItemsFor(mk(bowE), 'player', 2, 5, 0, 1, true).length === 1, 'the drawn bow is drawn through the arm chain');
}
// #6736: ElytraFeatureRenderer + ElytraEntityModel.setAngles.
{
  const K = 0.2617994, elytra = eq({ CHEST: 'elytra' });
  const items = (o) => vis(mk(o)).filter((i) => i.elytra);
  const wing = (o, n) => { const e = mk(o), L = M.BEModel.layer('elytra'), p = L.parts.find((q) => q.n === n);
    const a = ER.elytraAnim(e, 1), d = a.deltaFor(n); return { rx: p.rx + d.rx, ry: p.ry + d.ry, rz: p.rz + d.rz, py: p.py + d.dpy, pz: p.pz + d.dpz }; };
  ok(items({ equip: elytra }).length === 1 && items({ equip: elytra })[0].mobLayer === 'elytra' && items({ equip: elytra })[0].texKey === 'elytra', 'a worn elytra adds one elytra item');
  okAv(items({}).length === 0 && items({ equip: eq({ CHEST: 'iron_chestplate' }) }).length === 0, 'empty chest or other chestplate emits no elytra');
  ok(ER.mobQuadCount('elytra', 'elytra') >= 12, 'two wings, at least 12 faces, got ' + ER.mobQuadCount('elytra', 'elytra'));
  const zb = vis(mk({ type: 'zombie', equip: elytra })).filter((i) => i.elytra);
  ok(zb.length === 1, 'a zombie with an elytra draws it');
  const idle = wing({ equip: elytra, type: 'zombie' }, 'left_wing'), idleR = wing({ equip: elytra, type: 'zombie' }, 'right_wing');
  ok(Math.abs(idle.rx - K) < 1e-6 && Math.abs(idle.rz + K) < 1e-6 && idle.ry === 0 && idle.pz === 2, 'idle fold pi/12, translate z 0.125');
  ok(Math.abs(idleR.rz - K) < 1e-6 && Math.abs(idleR.rx - K) < 1e-6, 'right wing mirrors roll');
  okAv(Math.abs(idle.rx - 0) > 0.2, 'a zero fold angle is not the idle fold');
  const sn = wing({ equip: elytra, type: 'zombie', crouching: true }, 'left_wing');
  ok(Math.abs(sn.rx - 0.6981317) < 1e-6 && Math.abs(sn.rz + 0.7853982) < 1e-6 && sn.py === 3 && Math.abs(sn.ry - 0.08726646) < 1e-6, 'sneak branch');
  const gl = wing({ equip: elytra, type: 'zombie', fallFlying: true, vx: 0, vy: -1, vz: 0 }, 'left_wing');
  ok(Math.abs(gl.rx - K) < 1e-6 && Math.abs(gl.rz + K) < 1e-6, 'straight-down glide f = 0 keeps the fold');
  const lv = wing({ equip: elytra, type: 'zombie', fallFlying: true, vx: 1, vy: 0, vz: 0 }, 'left_wing');
  ok(Math.abs(lv.rx - 0.34906584) < 1e-6 && Math.abs(lv.rz + Math.PI / 2) < 1e-6, 'level glide f = 1 is pi/9, -pi/2');
  const pl = mk({ equip: elytra, sneaking: true }); ER.elytraAnim(pl, 1);
  ok(Math.abs(pl.elytraPitch - 0.1 * 0.6981317) < 1e-6, 'a player eases pitch 0.1 per frame from 0');
}
{ // #6737 riptide spin + aura passes
  const R0 = (o, t) => ER.playerPoseOf(mk(Object.assign({ xHeadRot: 30 }, o)), t);
  const a0 = R0({ riptideTicks: 5, age: 4 }, 0), a1 = R0({ riptideTicks: 5, age: 4 }, 0.5), a2 = R0({ riptideTicks: 5, age: 5 }, 0);
  ok(a0 && a1 && a2, 'riptiding player has a pose');
  const d = (A, B) => A.R.reduce((s, v, i) => s + Math.abs(v - B.R[i]), 0);
  ok(d(a0, a1) > 0.1 && d(a0, a2) > 0.1, 'spin advances with partial tick and age');
  ok(Math.abs(a0.R[4] - Math.cos((90 + 30) * Math.PI / 180)) < 1e-6, 'body lies on its back: Rx(-90 - pitch) column');
  okAv(R0({ riptideTicks: 0, age: 4 }, 0) === null, 'riptideTicks 0 gives no spin pose');
  ok(ER.riptidePasses(mk({ riptideTicks: 3 }), 0).length === 3, 'three riptide aura passes');
  okAv(ER.riptidePasses(mk({ riptideTicks: 0 }), 0).length === 0, 'riptideTicks 0 emits no riptide layer');
}
console.log(`assertions passed .. ${pass}\nfailures .. ${fails.length}`);
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
console.log(`${breaks} breaks caught`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
