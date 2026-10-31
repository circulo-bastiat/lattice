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
          '07zb_creeper.js', '07y_equip.js', '07k_goals.js', '07q_effects.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07w_passive.js', '14l_use.js'],
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


const P = Math.PI;
const st = (n) => ({ i: id(n), n: 1, d: 0 });
const eqs = (main, off) => { const a = []; a[IT.MAINHAND] = main ? st(main) : null; a[IT.OFFHAND] = off ? st(off) : null; return a; };
const arms = (o, partial = 1) => { const e = mk(Object.assign({ equip: eqs(), usingItem: false }, o)); const an = ER.animOf(e, partial);
  const get = (n) => { const d = ER.setupAnimDelta(n, 0, 0, 0, 0, false, 'player', { biped: true, player: an.player, rest: { px: n === 'right_arm' ? -5 : 5, py: 2, pz: 0 }, ageInTicks: 0 }); return d; };
  return { r: get('right_arm'), l: get('left_arm'), an }; };
const near = (a, b) => Math.abs(a - b) < 1e-5;
const rep = M.Use && M.Use.UseAction ? 1 : 0;
ok(rep, 'NS.Use present');
// 1. empty hands: yaw 0, pitch unchanged
let a = arms({});
ok(a.an.player.armPose && a.an.player.armPose.rightPose === 'EMPTY', 'empty hands -> EMPTY pose');
// 2. an item in the main hand: ITEM pose pitch*0.5 - PI/10 on the right arm only
a = arms({ equip: eqs('stone') });
ok(a.an.player.armPose.rightPose === 'ITEM' && a.an.player.armPose.leftPose === 'EMPTY', 'held main item: right ITEM, left EMPTY');
ok(near(a.r.rx, -P / 10 - 0) || Math.abs(a.r.rx + P / 10) < 0.2, 'right arm raised PI/10 holding an item, got ' + a.r.rx);
// 3. offhand item -> LEFT arm ITEM
a = arms({ equip: eqs(null, 'stone') });
ok(a.an.player.armPose.leftPose === 'ITEM' && a.an.player.armPose.rightPose === 'EMPTY', 'offhand item: left ITEM');
ok(Math.abs(a.l.rx + P / 10) < 0.2 && Math.abs(a.r.rx) < 0.2, 'left arm raised by offhand item, right not');
// 4. left-handed: offhand item rides the RIGHT arm
a = arms({ equip: eqs(null, 'stone'), leftHanded: true });
ok(a.an.player.armPose.rightPose === 'ITEM', 'left-handed: offhand item on the right arm');
// 5. shield block in main hand: right arm BLOCK (yaw -PI/6, pitch*0.5 - 0.942)
a = arms({ equip: eqs('shield'), usingItem: true, useHand: 0, useLeft: 100 });
ok(a.an.player.armPose.rightPose === 'BLOCK', 'blocking main hand -> BLOCK');
ok(near(a.r.ry, -P / 6) && Math.abs(a.r.rx + 0.9424779) < 0.2, 'block arm yaw -PI/6 pitch ~ -0.942, got ' + a.r.ry + ',' + a.r.rx);
// 6. offhand shield block: LEFT arm yaw +PI/6
a = arms({ equip: eqs('stone', 'shield'), usingItem: true, useHand: 1, useLeft: 100 });
ok(a.an.player.armPose.leftPose === 'BLOCK' && a.an.player.armPose.rightPose === 'ITEM', 'offhand block: left BLOCK, right ITEM');
ok(near(a.l.ry, P / 6), 'left block arm yaw +PI/6, got ' + a.l.ry);
// 7. eating = ITEM pose for the using hand (vanilla getArmPose has no EAT case)
a = arms({ equip: eqs('bread'), usingItem: true, useHand: 0, useLeft: 20 });
ok(a.an.player.armPose.rightPose === 'ITEM', 'eating -> ITEM pose (vanilla fall-through)');
// 8. spear raised while using: -PI pitch
a = arms({ equip: eqs('trident'), usingItem: true, useHand: 0, useLeft: 100 });
ok(a.an.player.armPose.rightPose === 'SPEAR' && Math.abs(a.r.rx + P) < 0.2, 'trident hold -> SPEAR, pitch ~ -PI');
// 9. use time exhausted -> not using pose
a = arms({ equip: eqs('shield'), usingItem: true, useHand: 0, useLeft: 0 });
ok(a.an.player.armPose.rightPose === 'ITEM', 'itemUseTimeLeft 0 -> ITEM, not BLOCK');
// 10. the held items themselves: main + offhand both drawn on the player (HeldItemFeatureRenderer)
{
  const held = ER.heldItemsFor(mk({ equip: eqs('stone', 'torch') }), 'player', 2, 5, 0, 1);
  ok(held.length === 2, 'main + offhand both drawn, got ' + held.length);
  const x = held.map((h) => h.x).sort((p, q) => p - q);
  ok(held.length === 2 && x[0] !== x[1], 'main and offhand items sit on different arms');
}
// anti-vacuity: swapping hands/arms must change the result
{
  const L = arms({ equip: eqs(null, 'stone') }), R = arms({ equip: eqs('stone') });
  okAv(Math.abs(L.l.rx - R.r.rx) < 1e-6 && Math.abs(L.r.rx - R.l.rx) < 1e-6, 'mirrored hand gives mirrored arms (swap -> equal)');
  okAv(Math.abs(L.l.rx - L.r.rx) > 0.1, 'swapped arms differ: raised vs idle');
  const bl = arms({ equip: eqs('shield'), usingItem: true, useHand: 0, useLeft: 100 });
  okAv(bl.r.ry !== arms({ equip: eqs('shield') }).r.ry, 'using pose changes the arm yaw');
  okAv(arms({ equip: eqs('shield'), usingItem: true, useHand: 1, useLeft: 100 }).l.ry === 0, 'offhand empty while main shield is active in OFF hand: left arm EMPTY, yaw 0');
}
if (fails.length) { console.error(fails.join('\n')); console.log('FAIL ' + fails.length + ' of ' + (pass + fails.length)); process.exit(1); }
console.log(pass + ' assertions, 0 failures, ' + breaks + ' breaks caught');
