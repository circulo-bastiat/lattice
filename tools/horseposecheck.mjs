#!/usr/bin/env node
// horseposecheck.mjs -- #1352: HorseEntityModel.animateModel/setAngles (.decomp) as ER.setupAnimDelta deltas;
// asserts absolute part pivots/rotations (golden rest + delta) equal the vanilla numbers, plus the
// saddle/strap/baby-leg visibility gates and the per-tick animation progresses.
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

console.log('horseposecheck -- #1352: HorseEntityModel poses');
const M = loadEngine({ extra: ['07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js', '07j_entityrender.js'] });
const ER = M.EntityRender || M.ER;

const REST = {};
for (const l of readFileSync(join(ROOT, 'tools/golden/models-1.18.2.tsv'), 'utf8').split('\n')) {
  const c = l.split('\t');
  if (c[0] === 'horse') REST[c[1]] = { px: +c[10], py: +c[11], pz: +c[12], rx: +c[13], ry: +c[14], rz: +c[15] };
}
const PI = Math.PI, C = Math.cos, S = Math.sin;
const H0 = { saddled: false, passengers: false, baby: false, inWater: false, grass: 0, angry: 0, eating: 0, tailWag: false };
function pose(h, name, o = {}) {
  const r = REST[name];
  const d = ER.setupAnimDelta(name, o.l || 0, o.a || 0, o.yaw || 0, o.pitch || 0, false, null,
    { horse: Object.assign({}, H0, h), ageInTicks: o.age || 0, rest: r });
  const z = d || { rx: 0, ry: 0, rz: 0 };
  return { px: r.px + (z.dpx || 0), py: r.py + (z.dpy || 0), pz: r.pz + (z.dpz || 0), rx: r.rx + z.rx, ry: r.ry + z.ry, rz: r.rz + z.rz };
}
const eq = (p, w, m) => ok(Object.keys(w).every((k) => near(p[k], w[k])), m + ' ' + JSON.stringify(p) + ' vs ' + JSON.stringify(w));

ok(!!ER.horseAnim && ER.PART_PARENT.horse && ER.PART_PARENT.horse.head === 'head_parts' && ER.PART_PARENT.horse.tail === 'body', 'horse anim + parents exist');
// standing: head PI/6 + look, yaw clamped +-20, tail PI/6 + a*0.75
eq(pose({}, 'head_parts', { yaw: 50, pitch: 30 }), { py: 4, pz: -12, rx: PI / 6 + 30 * PI / 180, ry: 20 * PI / 180 }, 'stand head clamps yaw');
eq(pose({}, 'head_parts', { l: 1, a: 0.5, yaw: -5 }), { rx: PI / 6 + C(0.4) * 0.15 * 0.5, ry: -5 * PI / 180 }, 'moving head bob');
eq(pose({ eating: 1 }, 'head_parts', { age: 3 }), { rx: PI / 6 + S(3) * 0.05 }, 'eating head bob');
eq(pose({}, 'tail', { a: 0.4, age: 7 }), { py: -5 + 0.4, pz: 2 + 0.8, rx: PI / 6 + 0.3, ry: 0 }, 'tail swing');
eq(pose({ tailWag: true }, 'tail', { age: 7 }), { ry: C(7 * 0.7) }, 'tail wag yaw');
eq(pose({}, 'left_front_leg', { l: 2, a: 0.5 }), { py: 14, pz: -10, rx: C(2 * 0.6662 + PI) * 0.8 * 0.5 }, 'front leg swing (pivot z -10)');
eq(pose({}, 'right_front_leg', { l: 2, a: 0.5 }), { rx: -C(2 * 0.6662 + PI) * 0.8 * 0.5 }, 'right front leg swing');
eq(pose({}, 'left_hind_leg', { l: 2, a: 0.5 }), { py: 14, pz: 7, rx: -C(2 * 0.6662 + PI) * 0.25 }, 'left hind leg swing');
eq(pose({ inWater: true }, 'right_hind_leg', { l: 2, a: 0.5 }), { rx: C(0.2 * 2 * 0.6662 + PI) * 0.25 }, 'water slows legs');
eq(pose({ baby: true }, 'left_front_baby_leg', { l: 2, a: 0.5 }), { py: 14, pz: -10, rx: C(2 * 0.6662 + PI) * 0.4 }, 'baby leg copies adult');
// angry (rearing)
eq(pose({ angry: 1 }, 'body'), { rx: -PI / 4 }, 'angry body pitch');
eq(pose({ angry: 1 }, 'head_parts', { pitch: 10 }), { py: -4, pz: -4, rx: PI / 12 + 10 * PI / 180 }, 'angry head');
eq(pose({ angry: 1 }, 'left_front_leg', { age: 2 }), { py: 2, pz: -6, rx: -PI / 3 + C(2 * 0.6 + PI) }, 'angry left front leg');
eq(pose({ angry: 1 }, 'right_front_leg', { age: 2 }), { rx: -PI / 3 - C(2 * 0.6 + PI) }, 'angry right front leg');
eq(pose({ angry: 1 }, 'right_hind_leg', { l: 2, a: 0.5 }), { rx: PI / 12 }, 'angry hind legs');
eq(pose({ angry: 0.5 }, 'body'), { rx: -PI / 8 }, 'half angry body');
// eating grass
eq(pose({ grass: 1 }, 'head_parts', { age: 4 }), { py: 11, pz: -12, rx: 2.1816616 + S(4) * 0.05 }, 'grass head down');
eq(pose({ grass: 0.5 }, 'head_parts'), { py: 0.5 * 11 + 0.5 * 4 }, 'half grass pivot');
// visibility gates
const hz = (e, partial) => ER.horseAnim(e, partial || 0);
const unsaddled = hz({ type: 'horse', age: 1 });
ok(!unsaddled.saddled && !unsaddled.passengers, 'unsaddled horse: saddle + straps hidden');
const ridden = hz({ type: 'horse', age: 1, saddled: true, rider: 'player' });
ok(ridden.saddled && ridden.passengers, 'saddled ridden horse: saddle + straps shown');
ok(hz({ type: 'horse', age: 1, saddled: true }).saddled && !hz({ type: 'horse', age: 1, saddled: true }).passengers, 'saddled unridden: saddle only');
ok(hz({ type: 'horse', age: 1, isBaby: true }).baby, 'baby flag');
// per-tick progresses
const e = { type: 'horse', age: 5, angry: true, eatingGrass: true };
let a = ER.horseAnim(e, 1);
ok(near(a.angry, 0.45), 'angry tick 1 = 0 + 1*0.4 + 0.05');
ok(near(a.grass, 0), 'angry zeroes eat-grass progress');
e.age = 6; a = ER.horseAnim(e, 1);
ok(near(a.angry, 0.45 + 0.55 * 0.4 + 0.05), 'angry tick 2');
e.angry = false; e.age = 7; a = ER.horseAnim(e, 1);
ok(a.angry < 0.5 && a.angry > 0, 'angry decays');

// anti-vacuity
okAv(!near(pose({ angry: 1 }, 'body').rx, pose({}, 'body').rx), 'rearing differs from standing');
okAv(!near(pose({ grass: 1 }, 'head_parts').rx, pose({}, 'head_parts').rx), 'grazing head differs from standing');
okAv(!near(pose({}, 'tail', { a: 1 }).rx, pose({}, 'tail', { a: 0 }).rx), 'tail swings with limb amount');
okAv(pose({}, 'tail', { age: 7 }).ry === 0 && pose({ tailWag: true }, 'tail', { age: 7 }).ry !== 0, 'tail wag only while tailWagTicks != 0');
okAv(unsaddled.saddled !== ridden.saddled, 'saddled state flips visibility input');

console.log('================ horseposecheck ==================');
for (const f of fails) console.log('  ✗ ' + f);
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' breaks caught ...... ' + breaks);
console.log(pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
