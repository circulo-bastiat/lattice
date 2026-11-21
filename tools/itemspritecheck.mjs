#!/usr/bin/env node
// itemspritecheck.mjs — #635: every flat item's sprite layers match the jar's item model and exist in the item atlas.
//   node tools/itemspritecheck.mjs
import { MCLITE_ROOT } from './loadsrc.mjs';
import { Jar } from './jarlib.mjs';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const jp = join(MCLITE_ROOT, 'jars/1.18.2/1.18.2.jar');
if (!existsSync(jp)) { console.log('itemspritecheck: no 1.18.2 jar, skipped'); process.exit(0); }
const jar = new Jar(jp);
const reg = Object.values(JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets/item-registry.json'), 'utf8')).items).filter((v) => v.real && v.kind === 'flat');
const atlas = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets/item-atlas-index.json'), 'utf8')).index;
const model = (n) => { try { return JSON.parse(jar.read('assets/minecraft/models/' + n + '.json').toString()); } catch { return null; } };
const jarLayers = (name) => {
  let m = model('item/' + name); const out = {};
  while (m) {
    for (const [k, v] of Object.entries(m.textures || {})) if (/^layer\d+$/.test(k) && !(k in out)) out[k] = v.replace('minecraft:', '');
    m = m.parent && !m.parent.includes('builtin') ? model(m.parent.replace('minecraft:', '')) : null;
  }
  return Object.keys(out).sort().map((k) => out[k]);
};
function grade(items, lay) {
  const fails = [];
  for (const it of items) {
    const g = jarLayers(it.name), r = lay(it);
    if (!g.length) continue;
    if (JSON.stringify(g) !== JSON.stringify(r)) fails.push(it.name + ' jar ' + g + ' runtime ' + r);
    else for (const l of r) if (!(l in atlas)) fails.push(it.name + ' layer ' + l + ' not in item atlas');
  }
  return fails;
}
const real = (it) => it.layers || [];
const f = grade(reg, real);
if (f.length) { console.log(f.slice(0, 20).join('\n')); console.log(f.length + ' failures of ' + reg.length); process.exit(1); }
let caught = 0;
const bads = [(it) => real(it).slice(0, -1), (it) => real(it).map((l) => l + 'x'), (it) => [...real(it), 'item/apple'], (it) => real(it).slice().reverse().concat(real(it).length > 1 ? [] : ['item/stick'])];
for (const b of bads) if (grade(reg, b).length) caught++;
console.log(reg.length + ' flat items, 0 failures, ' + caught + ' breaks caught');
process.exit(caught === bads.length ? 0 : 1);
