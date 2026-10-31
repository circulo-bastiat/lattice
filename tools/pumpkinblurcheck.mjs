#!/usr/bin/env node
// pumpkinblurcheck.mjs — G17-O3. H.pumpkinBlurWanted (InGameHud pumpkin overlay): first person + carved_pumpkin on the HEAD only.
//   node tools/pumpkinblurcheck.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/15_hud.js'), 'utf8');
const HUD = readFileSync(join(ROOT, 'src/15_hud.js'), 'utf8');
const names = ['air', 'carved_pumpkin', 'jack_o_lantern'];
function wanted(src) {
  const m = src.match(/H\.pumpkinBlurWanted = function[\s\S]*?\n  \};/);
  if (!m) return null;
  const NS = { Inventory: { ARMOR_START: 36, isEmpty: (s) => !s || s.n <= 0 }, Items: { FEET: 2, nameOf: (i) => names[i] } };
  const H = {};
  new Function('NS', 'H', m[0])(NS, H);
  return H.pumpkinBlurWanted;
}
function run(src) {
  const f = [], fn = wanted(src);
  if (!fn) return ['pumpkinBlurWanted missing'];
  const mk = (tp, slot, st) => { const slots = Array(41).fill(null); slots[slot] = st; return { thirdPerson: tp, inventory: { slots } }; };
  const st = (i) => ({ i, n: 1 });
  const no = (c, m) => { if (!c) f.push(m); };
  no(fn(mk(0, 39, st(1))) === true, 'first person + pumpkin on head must draw');
  no(fn(mk(1, 39, st(1))) === false, 'third person back must not draw');
  no(fn(mk(2, 39, st(1))) === false, 'third person front must not draw');
  no(fn(mk(0, 0, st(1))) === false, 'pumpkin in the hand must not draw');
  no(fn(mk(0, 39, st(2))) === false, 'jack_o_lantern must not draw');
  no(fn(mk(0, 39, null)) === false, 'empty head must not draw');
  return f;
}
const base = run(SRC);
if (base.length) { console.log('FAIL ' + base.join('; ')); process.exit(1); }
if (!/H\.drawPumpkinBlur\(c\);[\s\S]*H\.drawCrosshair\(c\)[\s\S]*H\.drawHotbar\(c\)/.test(HUD)) { console.log('FAIL overlay not drawn before crosshair/hotbar'); process.exit(1); }
const breaks = [
  ['(P.thirdPerson | 0) !== 0', '(P.thirdPerson | 0) === 0'],
  ["=== 'carved_pumpkin'", "!== 'carved_pumpkin'"],
  ['(5 - IT.FEET)', '(4 - IT.FEET)'],
  ["nameOf(st.i | 0) === 'carved_pumpkin'", "nameOf(st.i | 0).indexOf('pumpkin') >= 0 || IT.nameOf(st.i | 0) === 'jack_o_lantern'"],
];
let caught = 0;
for (const [a, b] of breaks) {
  if (!SRC.includes(a)) { console.log('FAIL break target missing: ' + a); process.exit(1); }
  let r; try { r = run(SRC.replace(a, b)); } catch (e) { r = ['threw']; }
  if (r.length) caught++;
}
if (caught !== breaks.length) { console.log(`FAIL only ${caught}/${breaks.length} breaks caught`); process.exit(1); }
console.log(`pumpkinblurcheck OK — 6 cases; ${caught} breaks caught`);
