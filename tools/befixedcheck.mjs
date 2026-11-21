#!/usr/bin/env node
// befixedcheck.mjs — #635: the item-frame (fixed) display of block-entity items matches the jar's item models.
//   node tools/befixedcheck.mjs
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { Jar } from './jarlib.mjs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const jp = join(MCLITE_ROOT, 'jars/1.18.2/1.18.2.jar');
if (!existsSync(jp)) { console.log('befixedcheck: no 1.18.2 jar, skipped'); process.exit(0); }
const jar = new Jar(jp);
const M = loadEngine({ extra: ['07j_entityrender.js'], dom: false });
const ER = M.EntityRender;
const model = (n) => JSON.parse(jar.read('assets/minecraft/models/item/' + n + '.json').toString());
const fixed = (n) => { let m = model(n); while (!m.display?.fixed && m.parent && m.parent.includes('item/')) m = model(m.parent.replace('minecraft:', '').replace('item/', '')); return m.display?.fixed; };
const NAMES = ['skeleton_skull', 'creeper_head', 'dragon_head', 'conduit', 'white_bed', 'red_banner', 'shield', 'chest', 'ender_chest'];
const eq = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
let pass = 0; const fails = [];
function grade(fn) {
  let n = 0;
  for (const k of NAMES) {
    const g = fixed(k), r = fn(k);
    const ok = g && r && eq(g.rotation, r.rot) && eq(g.translation, r.t) && eq(g.scale, [r.s, r.s, r.s]);
    if (ok) pass++; else { fails.push(k + ' jar ' + JSON.stringify(g) + ' runtime ' + JSON.stringify(r)); n++; }
  }
  return n;
}
if (grade((k) => ER.beFixedFor(k))) { console.log(fails.join('\n')); process.exit(1); }
let caught = 0;
const real = (k) => ER.beFixedFor(k);
for (const bad of [(k) => ({ ...real(k), s: 1 }), (k) => ({ ...real(k), rot: [0, 0, 0] }), (k) => ({ ...real(k), t: [0, 1, 0] })]) {
  fails.length = 0; if (grade(bad)) { caught++; console.log('   ✓ wrong table is caught'); }
}
console.log('befixedcheck: ' + pass + ' assertions, 0 failures, ' + caught + ' breaks caught');
process.exit(caught === 3 ? 0 : 1);
