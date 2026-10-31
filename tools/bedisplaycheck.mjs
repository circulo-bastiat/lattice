#!/usr/bin/env node
// bedisplaycheck.mjs — #635: the thirdperson_righthand and head displays of block-entity items matches the jar's item models.
//   node tools/bedisplaycheck.mjs
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { Jar } from './jarlib.mjs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const jp = join(MCLITE_ROOT, 'jars/1.18.2/1.18.2.jar');
if (!existsSync(jp)) { console.log('bedisplaycheck: no 1.18.2 jar, skipped'); process.exit(0); }
const jar = new Jar(jp);
const M = loadEngine({ extra: ['07j_entityrender.js'], dom: false });
const ER = M.EntityRender;
const model = (n) => JSON.parse(jar.read('assets/minecraft/models/item/' + n + '.json').toString());
const disp = (n, key) => { let m = model(n); while (!m.display?.[key] && m.parent && m.parent.includes('item/')) m = model(m.parent.replace('minecraft:', '').replace('item/', '')); return m.display?.[key]; };
const NAMES = ['skeleton_skull', 'creeper_head', 'dragon_head', 'conduit', 'white_bed', 'red_banner', 'shield', 'chest', 'ender_chest'];
const eq = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
let pass = 0; const fails = [];
function grade(fn, key) {
  let n = 0;
  for (const k of NAMES) {
    const g = disp(k, key), r = fn(k);
    const ok = (!g && !r) || g && r && eq(g.rotation, r.rot) && eq(g.translation, r.t) && eq(g.scale, [r.s, r.s, r.s]);
    if (ok) pass++; else { fails.push(k + ' jar ' + JSON.stringify(g) + ' runtime ' + JSON.stringify(r)); n++; }
  }
  return n;
}
const T = [['thirdperson_righthand', (k) => ER.beThirdFor(k)], ['head', (k) => ER.beHeadFor(k)]];
for (const [key, f] of T) if (grade(f, key)) { console.log(fails.join('\n')); process.exit(1); }
let caught = 0;
for (const [key, real] of T) {
  for (const bad of [(k) => real(k) && ({ ...real(k), s: 2 }), (k) => real(k) && ({ ...real(k), rot: [1, 2, 3] }), (k) => real(k) && ({ ...real(k), t: [0, 9, 0] }), (k) => real(k) ? null : { rot: [0, 0, 0], t: [0, 0, 0], s: 1 }]) {
    fails.length = 0; if (grade(bad, key)) caught++;
  }
}
// the held-by-a-mob renderer takes the display as ER.beThirdXf's [rot, t, s] array: graded against the jar too
const xfOk = (fn) => NAMES.every((k) => { const g = disp(k, 'thirdperson_righthand'), x = fn(k);
  return (!g && !x) || (g && x && eq(x, [...g.rotation, ...g.translation, ...g.scale])); });
if (!xfOk((k) => ER.beThirdXf(k))) { console.log('beThirdXf disagrees with the jar'); process.exit(1); }
pass++;
for (const bad of [(k) => ER.beThirdXf(k) && ER.beThirdXf(k).map((v, i) => i === 3 ? v + 1 : v), () => null]) if (!xfOk(bad)) caught++;
console.log(pass + ' assertions, 0 failures, ' + caught + ' breaks caught');
process.exit(caught === 10 ? 0 : 1);
