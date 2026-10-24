#!/usr/bin/env node
// begroundcheck.mjs — #635: the dropped (ground) transform of block-entity items matches the jar's item models.
//   node tools/begroundcheck.mjs
import { loadEngine } from './loadsrc.mjs';
import { Jar } from './jarlib.mjs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { MCLITE_ROOT } from './loadsrc.mjs';

const jp = join(MCLITE_ROOT, 'jars/1.18.2/1.18.2.jar');
if (!existsSync(jp)) { console.log('begroundcheck: no 1.18.2 jar, skipped'); process.exit(0); }
const jar = new Jar(jp);
const M = loadEngine({ extra: ['07j_entityrender.js'], dom: false });
const ER = M.EntityRender;
const model = (n) => JSON.parse(jar.read('assets/minecraft/models/item/' + n + '.json').toString());
const ground = (n) => { let m = model(n); while (!m.display?.ground && m.parent && m.parent.includes('item/')) m = model(m.parent.replace('minecraft:', '').replace('item/', '')); return m.display?.ground; };
const NAMES = { skeleton_skull: 'skeleton_skull', creeper_head: 'creeper_head', dragon_head: 'dragon_head', conduit: 'conduit',
  white_bed: 'white_bed', red_banner: 'red_banner', shield: 'shield', chest: 'chest', ender_chest: 'ender_chest' };
let pass = 0; const fails = [];
function grade(fn) {
  let n = 0;
  for (const k in NAMES) {
    const g = ground(k), r = fn(k);
    const ok = g && Math.abs(g.scale[1] - r.scale) < 1e-9 && Math.abs(g.translation[1] / 16 - r.ty) < 1e-9;
    if (ok) pass++; else { fails.push(k + ' jar ' + JSON.stringify(g) + ' runtime ' + JSON.stringify(r)); n++; }
  }
  return n;
}
if (grade((k) => ER.beGroundFor(k))) { console.log(fails.join('\n')); process.exit(1); }
// anti-vacuity: a wrong table must be caught
const saved = ER.beGroundFor; let caught = 0;
for (const bad of [{ ty: 3 / 16, scale: 0.25 }, { ty: 0, scale: 0.5 }, { ty: 1 / 16, scale: 0.5 }]) {
  fails.length = 0; if (grade(() => bad)) { caught++; console.log('   ✓ wrong table ' + JSON.stringify(bad) + ' is caught'); }
}
ER.beGroundFor = saved;
console.log('begroundcheck: ' + pass + ' assertions, 0 failures, ' + caught + ' breaks caught');
process.exit(caught === 3 ? 0 : 1);
