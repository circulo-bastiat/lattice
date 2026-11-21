#!/usr/bin/env node
// phantomanimcheck.mjs — #1540: PhantomEntityModel.setAngles (method_33686): wing roll +-cos(t)*16deg, tail pitch -(5+cos(2t)*5)deg.
import { loadEngine, initRegistry } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '07j_entityrender.js', '07m_breed.js', '10_gfx.js', '15h_bemodel.js', '07k_goals.js', '07t_fly.js', '07zw_mobnbt.js', '07_world.js', '07b_behaviour.js'], dom: false });
initRegistry(M);
const ER = M.EntityRender, D = Math.PI / 180;
const wing = { rz: 0.1 }, tail = { rx: 0 };
for (const [id, age] of [[0, 0], [0, 7], [5, 3.5], [12, 40]]) {
  const t = (id * 3 + age) * 7.448451 * D, c = { ageInTicks: age, phantomId: id };
  for (const n of ['left_wing_base', 'left_wing_tip', 'right_wing_base', 'right_wing_tip']) {
    const s = n[0] === 'l' ? 1 : -1, d = ER.phantomDelta(n, Object.assign({ rest: wing }, c));
    ok(Math.abs(d.rz + 0.1 - s * Math.cos(t) * 16 * D) < 1e-9, `${n} roll id ${id} age ${age}`);
  }
  for (const n of ['tail_base', 'tail_tip'])
    ok(Math.abs(ER.phantomDelta(n, Object.assign({ rest: tail }, c)).rx + (5 + Math.cos(2 * t) * 5) * D) < 1e-9, `${n} pitch id ${id} age ${age}`);
}
const a = ER.phantomDelta('left_wing_base', { ageInTicks: 0, phantomId: 0, rest: wing }).rz, b = ER.phantomDelta('left_wing_base', { ageInTicks: 12, phantomId: 0, rest: wing }).rz;
ok(Math.abs(a - b) > 0.05, 'wing flaps over time');
ok(ER.phantomDelta('body', {}) === null, 'body untouched');
okAv(!(Math.abs(ER.phantomDelta('left_wing_base', { ageInTicks: 12, phantomId: 0, rest: wing }).rz - a) < 1e-9), 'a frozen wing would be caught');
okAv(!(ER.phantomDelta('right_wing_base', { ageInTicks: 0, phantomId: 0, rest: wing }).rz === ER.phantomDelta('left_wing_base', { ageInTicks: 0, phantomId: 0, rest: wing }).rz), 'an un-negated right wing would be caught');
okAv(!(Math.abs(ER.phantomDelta('tail_base', { ageInTicks: 0, phantomId: 0, rest: tail }).rx) < 1e-9), 'a missing tail pitch would be caught');
okAv(!(ER.phantomDelta('left_wing_base', { ageInTicks: 3, phantomId: 0, rest: wing }).rz === ER.phantomDelta('left_wing_base', { ageInTicks: 3, phantomId: 4, rest: wing }).rz), 'ignoring the entity id would be caught');
console.log(`phantomanimcheck (#1540)\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}`);
if (fails.length) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
