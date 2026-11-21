#!/usr/bin/env node
// foxposecheck.mjs -- #1284: FoxEntityModel.method_18330/method_18332 poses (sneak/sleep/sit/walk, head roll)
// as ER.setupAnimDelta deltas; asserts the absolute part pivots/rotations (rest + delta) equal the vanilla numbers.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0;
const fails = [];
const near = (a, b) => Math.abs(a - b) < 1e-5;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('  ✓ anti-vacuity: ' + m); } else fails.push('anti-vacuity: ' + m); };

console.log('foxposecheck -- #1284: FoxEntityModel poses');
const M = loadEngine({ extra: ['07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js', '07j_entityrender.js'] });
const ER = M.EntityRender || M.ER;

// rest table straight from the golden (what the renderer starts from)
const REST = {};
for (const l of readFileSync(join(ROOT, 'tools/golden/models-1.18.2.tsv'), 'utf8').split('\n')) {
  const c = l.split('\t');
  if (c[0] === 'fox') REST[c[1]] = { px: +c[10], py: +c[11], pz: +c[12], rx: +c[13], ry: +c[14], rz: +c[15] };
}
const PI = Math.PI;
// absolute pose of a part under the fox ctx
function pose(fox, name, o = {}) {
  const f = Object.assign({ sleeping: false, sitting: false, sneaking: false, walking: false, headRoll: 0, bodyOff: 0, leg: 0, age: 0 }, fox);
  const r = REST[name];
  const d = ER.setupAnimDelta(name, o.l || 0, o.a || 0, o.yaw || 0, o.pitch || 0, false, null, { fox: f, baby: !!o.baby, rest: r });
  const z = d || { rx: 0, ry: 0, rz: 0 };
  return { px: r.px + (z.dpx || 0), py: r.py + (z.dpy || 0), pz: r.pz + (z.dpz || 0), rx: r.rx + z.rx, ry: r.ry + z.ry, rz: r.rz + z.rz };
}
const eq = (p, w, m) => ok(Object.keys(w).every((k) => near(p[k], w[k])), m + ' ' + JSON.stringify(p) + ' vs ' + JSON.stringify(w));

ok(!!ER.foxAnim && ER.PART_PARENT.fox && ER.PART_PARENT.fox.tail === 'body', 'fox anim + parents exist');
// sleeping
let p = pose({ sleeping: true, age: 10 }, 'body'); eq(p, { px: 0, py: 21, pz: -6, rx: PI / 2, rz: -PI / 2 }, 'sleep body');
eq(pose({ sleeping: true }, 'body', { baby: true }), { py: 21, pz: -2 }, 'sleep baby body');
eq(pose({ sleeping: true }, 'tail'), { rx: -PI * 5 / 6 }, 'sleep tail');
eq(pose({ sleeping: true }, 'tail', { baby: true }), { rx: -2.1816616 }, 'sleep baby tail');
eq(pose({ sleeping: true, age: 10 }, 'head', { yaw: 50, pitch: 20 }), { px: 1, py: 19.49, pz: -3, rx: 0, ry: -PI * 2 / 3, rz: Math.cos(10 * 0.027) / 22 }, 'sleep head');
// sitting
eq(pose({ sitting: true }, 'body'), { py: 9, pz: -3, rx: PI / 6 }, 'sit body');
eq(pose({ sitting: true }, 'tail'), { px: -4, py: 15, pz: -2, rx: PI / 4 }, 'sit tail');
eq(pose({ sitting: true, headRoll: 0.3 }, 'head', { yaw: 50 }), { px: -1, py: 10, pz: -0.25, rx: 0, ry: 50 * Math.PI / 180, rz: 0.3 }, 'sit head (method_18332 aims it: not sleeping/walking/sneaking)');
eq(pose({ sitting: true }, 'head', { baby: true }), { py: 13, pz: -3.75 }, 'sit baby head');
eq(pose({ sitting: true }, 'right_hind_leg'), { px: -5, py: 21.5, pz: 6.75, rx: -PI * 5 / 12 }, 'sit hind leg');
eq(pose({ sitting: true }, 'left_front_leg'), { rx: -PI / 12 }, 'sit front leg');
// sneaking
eq(pose({ sneaking: true, bodyOff: 2, age: 3 }, 'body'), { py: 18, pz: -6, rx: 1.6755161, ry: Math.cos(3) * 0.01 }, 'crouch body');
eq(pose({ sneaking: true, bodyOff: 2 }, 'head', { yaw: 40 }), { py: 18.5, ry: 0, rx: 0 }, 'crouch head');
eq(pose({ sneaking: true, age: 3 }, 'right_front_leg'), { rz: Math.cos(3) * 0.005 }, 'crouch front leg roll');
eq(pose({ sneaking: true, age: 3 }, 'left_hind_leg'), { rz: Math.cos(3) * 0.01 }, 'crouch hind leg roll');
// standing / walking
eq(pose({ headRoll: 0.2 }, 'head', { yaw: 30, pitch: 10 }), { rx: 10 * PI / 180, ry: 30 * PI / 180, rz: 0.2 }, 'stand head look + roll');
eq(pose({}, 'right_hind_leg', { l: 2, a: 0.5 }), { rx: Math.cos(2 * 0.6662) * 0.7 }, 'stand hind leg swing');
eq(pose({}, 'left_hind_leg', { l: 2, a: 0.5 }), { rx: Math.cos(2 * 0.6662 + PI) * 0.7 }, 'stand left hind leg swing');
eq(pose({ walking: true, leg: 1.34 }, 'right_hind_leg'), { rx: Math.cos(1.34 * 0.4662) * 0.1 }, 'walking legs');
eq(pose({ walking: true, leg: 1.34 }, 'left_front_leg'), { rx: Math.cos(1.34 * 0.4662) * 0.1 }, 'walking front leg');
eq(pose({ walking: true }, 'head', { yaw: 30 }), { rx: 0, ry: 0 }, 'walking head does not look');
// tick state
const e = { type: 'fox', age: 5, crouching: true, rollingHead: true };
let a = ER.foxAnim(e, 1); ok(near(a.bodyOff, 0.2) && near(a.headRoll, 0.4 * 0.11 * PI), 'foxAnim tick 1');
e.age = 6; a = ER.foxAnim(e, 0); ok(near(a.bodyOff, 0.2) && near(a.headRoll, 0.4 * 0.11 * PI), 'foxAnim lerp start');

// anti-vacuity: wrong numbers must fail the same comparison
okAv(!Object.keys({ py: 9 }).every((k) => near(pose({ sitting: true }, 'body')[k], 21)), 'sit body is not the sleep pivot');
okAv(!near(pose({ sleeping: true }, 'tail').rx, -PI / 4), 'sleep tail is not the sit pitch');
okAv(pose({}, 'body').rx === REST.body.rx && pose({}, 'head').py === REST.head.py, 'standing fox stays at rest');
okAv(pose({ sleeping: true }, 'head').ry !== pose({}, 'head').ry, 'sleep head differs from stand');
okAv(!near(pose({ walking: true, leg: 1.34 }, 'right_hind_leg').rx, pose({}, 'right_hind_leg', { l: 1.34, a: 1 }).rx), 'walking legs differ from limb swing');

console.log('================ foxposecheck ==================');
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' breaks caught ...... ' + breaks);
console.log(pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
