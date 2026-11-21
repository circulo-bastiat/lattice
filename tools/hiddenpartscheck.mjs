#!/usr/bin/env node
// hiddenpartscheck.mjs — #1587. A vanilla model constructor's `this.X.visible = false` (never re-enabled) must be in
// ER.DEFAULT_HIDDEN for every mob layer sharing that model. Illagers: IllagerEntityModel hides `hat`.
// Breaks its own data (an emptied table, a source without the line) and each must fail: "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const MODELS = { IllagerEntityModel: ['evoker', 'illusioner', 'pillager', 'vindicator'] };
const src = (m) => readFileSync(`${MCLITE_ROOT}/.decomp/net/minecraft/client/render/entity/model/${m}.java`, 'utf8');
function hiddenOf(java) {
  const kids = {}, out = [];
  for (const m of java.matchAll(/this\.(\w+)\s*=\s*[\w.]+\.getChild\("(\w+)"\)/g)) kids[m[1]] = m[2];
  for (const m of java.matchAll(/this\.(\w+)\.visible\s*=\s*false/g)) out.push(kids[m[1]] || m[1]);
  return out;
}
function problems(java, table) {
  const p = [], hid = hiddenOf(java);
  if (!hid.length) p.push('no .visible = false found in the vanilla constructor');
  for (const mob of MODELS.IllagerEntityModel) for (const part of hid) if (!(table[mob] && table[mob][part])) p.push(`${mob}: vanilla hides "${part}" but DEFAULT_HIDDEN does not`);
  return p;
}
const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07zs_spawner.js'], dom: false });
initRegistry(M); const ER = M.EntityRender;
const java = src('IllagerEntityModel'), table = ER.DEFAULT_HIDDEN;
const bad = problems(java, table);
if (bad.length) { console.log('FAIL\n' + bad.join('\n')); process.exit(1); }
let breaks = 0;
for (const [j, t] of [[java, {}], [java.replace(/\.visible\s*=\s*false/g, '.visible = true'), table], [java, { ...table, evoker: {} }]]) {
  if (problems(j, t).length) { breaks++; console.log("✓ break caught"); } else { console.log('FAIL a break was not caught'); process.exit(1); }
}
console.log(`OK  ${MODELS.IllagerEntityModel.length} checks passed, 0 failures; illagers hide ${hiddenOf(java).join(',')} like vanilla; ${breaks} breaks caught`);
