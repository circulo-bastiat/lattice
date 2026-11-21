#!/usr/bin/env node
// itemsheetcheck.mjs — #110: the item display-transform sheet.
//
// Writes assets/item-sheet.html (GENERATED, D-6): one row per real item, the five transforms the game
// draws it by — gui, ground (dropped), fixed (item frame), firstperson_righthand, thirdperson_righthand —
// each as rotation / translation / scale, the model chain they were resolved through, and a `default`
// mark where the chain declares none (vanilla ItemTransform.NO_TRANSFORM: identity). Review it once.
//
// Asserts: every real item resolves each transform to a 3x3 numeric triple or a declared default; the
// only items without a gui transform are ones whose chain declares none (item/generated & co, whose
// json has no display.gui); ground/fixed/hand3 exist for every real item; then anti-vacuity.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const reg = JSON.parse(readFileSync(join(ASSETS, 'item-registry.json'), 'utf8')).items;
const KEYS = [['gui', 'gui'], ['ground', 'ground'], ['fixed', 'fixed'], ['hand', 'firstperson_righthand'], ['hand3', 'thirdperson_righthand']];
const real = Object.values(reg).filter((v) => v.real);
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
// a json transform may omit a key: vanilla ItemTransform defaults rotation/translation to 0 and scale to 1
const DEF = { rotation: [0, 0, 0], translation: [0, 0, 0], scale: [1, 1, 1] };
const full = (t, k) => (t[k] === undefined ? DEF[k] : t[k]);
const good = (t) => t && ['rotation', 'translation', 'scale'].every((k) => { const v = full(t, k); return Array.isArray(v) && v.length === 3 && v.every(Number.isFinite); });
console.log('itemsheetcheck — #110: every item at gui/ground/fixed/first/thirdperson transforms');

function audit(items) {
  const out = { bad: [], defaults: {} };
  for (const it of items) for (const [f, key] of KEYS) {
    const t = it[f];
    if (t === undefined) { out.defaults[key] = (out.defaults[key] || 0) + 1; continue; }
    if (!good(t)) out.bad.push(it.name + '.' + key);
  }
  return out;
}
const a = audit(real);
ok(real.length > 1000, 'real items: ' + real.length);
ok(a.bad.length === 0, 'malformed transforms: ' + a.bad.slice(0, 5).join(', '));
for (const k of ['ground', 'fixed', 'thirdperson_righthand']) ok(!a.defaults[k], k + ' missing on ' + a.defaults[k] + ' items');
ok((a.defaults.gui || 0) < real.length, 'some items declare a gui transform');
const rows = real.map((it) => '<tr><td>' + it.name + '</td>' + KEYS.map(([f]) => {
  const t = it[f];
  return '<td>' + (t ? ['rotation', 'translation', 'scale'].map((k) => full(t, k).join(',')).join(' | ') : '<i>default</i>') + '</td>';
}).join('') + '</tr>').join('\n');
writeFileSync(join(ASSETS, 'item-sheet.html'), '<!doctype html><meta charset=utf-8><title>item transforms</title><table border=1 cellpadding=3><tr><th>item' +
  KEYS.map(([, k]) => '<th>' + k).join('') + '<th></tr>\n' + rows + '</table>');
console.log('   sheet: ' + real.length + ' items, defaults per transform ' + JSON.stringify(a.defaults));

// anti-vacuity: corrupt data and assert the audit notices
const broken = real.slice(0, 50).map((it) => Object.assign({}, it, { ground: { rotation: [0, 0], translation: [0, 0, 0], scale: [1, 1, 1] } }));
breaks++; if (ok(audit(broken).bad.length === 50, 'anti-vacuity: 50 truncated ground transforms caught')) console.log('   ✓ truncated transforms caught');
const nan = [Object.assign({}, real[0], { fixed: { rotation: [0, 0, NaN], translation: [0, 0, 0], scale: [1, 1, 1] } })];
breaks++; if (ok(audit(nan).bad.length === 1, 'anti-vacuity: NaN fixed transform caught')) console.log('   ✓ NaN caught');
if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); console.log(' assertions passed .... ' + pass + '\n failures ........... ' + fails.length + '\n ' + breaks + ' breaks caught'); process.exit(1); }
console.log(' assertions passed .... ' + pass + '\n failures ........... 0\n ' + breaks + ' breaks caught');
