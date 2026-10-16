#!/usr/bin/env node
// standrendercheck -- #4497: the armor_stand renderer reads Pose / ShowArms / NoBasePlate / Invisible / Small.
import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

console.log('standrendercheck -- #4497, armor_stand renderer state');

function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  const M = loadEngine({
    extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07zzt_armorstand.js',
            '07j_entityrender.js', '10_gfx.js', '11_gfx_webgpu.js', '12_gfx_webgl2.js', '15h_bemodel.js'],
    dom: false, patch });
  initRegistry(M);
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(MCLITE_ROOT + 'assets/entities.json', 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
  const ER = M.EntityRender;
  const e = { type: 'armor_stand', maxHealth: 20, health: 20, x: 0, y: 0, z: 0, yaw: 0, age: 0 };
  const rest = { n: 'head', x: 0, y: 0, z: 0, w: 1, h: 1, d: 1, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };
  const pose = (n, o) => ER.posedPart(Object.assign({}, rest, { n }), ER.animOf(e, 0), 'armor_stand', o);
  const D = Math.PI / 180;

  let h = pose('head'), la = pose('left_arm');
  ok(Math.abs(h.rx) < 1e-9 && Math.abs(la.rx + 10 * D) < 1e-6 && Math.abs(la.rz + 10 * D) < 1e-6, 'default pose: head 0, LeftArm [-10,0,-10]');
  e.asPose = { Head: [30, 0, 0] };
  ok(Math.abs(pose('head').rx - 30 * D) < 1e-6 && Math.abs(pose('hat').rx - 30 * D) < 1e-6, 'Pose.Head [30,0,0] turns head and hat');
  ok(!ER.animOf(e, 0).baby, 'not small: adult model');
  e.small = true; ok(ER.animOf(e, 0).baby === true, 'Small: baby model');
  ok(JSON.stringify(ER.standHide(e)) === '{"left_arm":1,"right_arm":1}', 'no ShowArms: arms hidden, plate drawn');
  e.showArms = true; e.noBasePlate = true;
  ok(JSON.stringify(ER.standHide(e)) === '{"base_plate":1}', 'ShowArms+NoBasePlate: arms drawn, plate hidden');
  ok(!ER.invisibleMob(e), 'visible stand'); e.invisible = true; ok(ER.invisibleMob(e), 'Invisible stand: body not drawn');
  return { fails, n };
}

const base = scenarios();
for (const f of base.fails) console.log('FAIL', f);
let caught = 0;
const R = (a, z) => (f, t) => f === '07j_entityrender.js' ? t.replace(a, z) : t;
const breaks = [
  ['pose', "an.deltaFor = function", "an.deltaForX = function"],
  ['small', "an.baby = !!e.small;", "an.baby = false;"],
  ['arms', "if (!e.showArms) {", "if (false) {"],
  ['plate', "if (e.noBasePlate) h.base_plate", "if (false) h.base_plate"],
  ['invisible', "e.type === 'armor_stand' && e.invisible", "e.type === 'armor_stand' && false"],
];
for (const [label, a, z] of breaks) if (scenarios(R(a, z)).fails.length) { caught++; console.log('   ✓ break caught: ' + label); }
console.log(`standrendercheck: ${base.n} assertions, ${base.fails.length} failures, ${caught} breaks caught`);
process.exit(base.fails.length || caught < breaks.length ? 1 : 0);
