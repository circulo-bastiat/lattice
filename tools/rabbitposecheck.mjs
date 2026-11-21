#!/usr/bin/env node
// rabbitposecheck.mjs — #4629: RabbitEntityModel.setAngles (.decomp method_17117) via ER.setupAnimDelta.
// Expected values written out from the .decomp formulas, with rest angles from tools/golden/models-1.18.2.tsv.
import { loadEngine, initRegistry } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const near = (a, b) => Math.abs(a - b) < 1e-5;
const D = Math.PI / 180;

const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07w_passive.js'], dom: false });
initRegistry(M);
const ER = M.EntityRender;

const REST = { head: [0, 0], nose: [0, 0], left_ear: [0, 0.2617994], right_ear: [0, -0.2617994],
  left_haunch: [-0.34906584, 0], right_haunch: [-0.34906584, 0], left_hind_foot: [0, 0], right_hind_foot: [0, 0],
  left_front_leg: [-0.17453292, 0], right_front_leg: [-0.17453292, 0] };
const ang = (part, jump, yaw = 0, pitch = 0) => {
  const r = { rx: REST[part][0], ry: REST[part][1], rz: 0 };
  const d = ER.setupAnimDelta(part, 0, 0, yaw, pitch, false, 'quadruped', { rabbit: { jump }, rest: r });
  return { rx: r.rx + d.rx, ry: r.ry + d.ry };
};
for (const [j, jp] of [[0, 0], [0.5, 1], [0.25, Math.sin(Math.PI / 4)]]) {
  for (const s of ['left', 'right']) {
    ok(near(ang(s + '_haunch', j).rx, (jp * 50 - 21) * D), `${s} haunch jump ${j}`);
    ok(near(ang(s + '_hind_foot', j).rx, jp * 50 * D), `${s} hind foot jump ${j}`);
    ok(near(ang(s + '_front_leg', j).rx, (jp * -40 - 11) * D), `${s} front leg jump ${j}`);
  }
}
ok(near(ang('left_ear', 0, 30, 10).ry, 30 * D + Math.PI / 12) && near(ang('right_ear', 0, 30, 10).ry, 30 * D - Math.PI / 12), 'ears yaw = head yaw +- pi/12');
ok(near(ang('left_ear', 0, 30, 10).rx, 10 * D) && near(ang('nose', 0, 30, 10).ry, 30 * D) && near(ang('head', 0, 30, 10).rx, 10 * D), 'head/nose/ear pitch+yaw');
const e = { type: 'rabbit', maxHealth: 3, rabbitJumpTicks: 4, rabbitJumpDuration: 10 };
ok(near(ER.animOf(e, 0.5).rabbit.jump, 0.45) && ER.animOf({ type: 'cow', maxHealth: 10 }, 0).rabbit === null, 'animOf jump progress only for rabbits');
ok(ER.animOf({ type: 'rabbit', maxHealth: 3, rabbitJumpDuration: 0 }, 0.5).rabbit.jump === 0, 'jumpDuration 0 -> progress 0');
okAv(!near(ang('left_haunch', 0.5).rx, -21 * D), 'a haunch that ignores the jump is caught');
okAv(!near(ang('left_ear', 0, 30).ry, 30 * D), 'ears without the pi/12 splay are caught');
okAv(!near(ang('left_front_leg', 0.5).rx, -11 * D), 'a front leg stuck at rest is caught');
console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL: ' + f);
if (fails.length) process.exit(1);
