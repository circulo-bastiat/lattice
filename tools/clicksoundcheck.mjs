#!/usr/bin/env node
// clicksoundcheck.mjs — #344: lever / button / pressure-plate click sounds (.decomp LeverBlock.onUse,
// AbstractButtonBlock.playClickSound, PressurePlateBlock / WeightedPressurePlateBlock).
// Each source's on/off event, volume and pitch, every event in sounds.json, and the four edges wired
// to Use's click() (lever, button press, button release, plate/arrow edge). Anti-vacuity: breaks its own data.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({ extra: ['14l_use.js'], dom: false });
const U = M.Use;
const evs = JSON.parse(readFileSync(join(ROOT, '.mcsnd', 'sounds.json'), 'utf8'));
const src = readFileSync(join(ROOT, 'src', '14l_use.js'), 'utf8');
const F = Math.fround;
const WANT = {
  lever: ['block.lever.click', 'block.lever.click', 0.6, 0.5],
  wooden_button: ['block.wooden_button.click_on', 'block.wooden_button.click_off', 0.6, 0.5],
  stone_button: ['block.stone_button.click_on', 'block.stone_button.click_off', 0.6, 0.5],
  wooden_plate: ['block.wooden_pressure_plate.click_on', 'block.wooden_pressure_plate.click_off', 0.8, 0.7],
  stone_plate: ['block.stone_pressure_plate.click_on', 'block.stone_pressure_plate.click_off', 0.6, 0.5],
  metal_plate: ['block.metal_pressure_plate.click_on', 'block.metal_pressure_plate.click_off', F(0.90000004), 0.75]
};
function problems(table, text) {
  const bad = [];
  for (const k of Object.keys(WANT)) {
    const c = table[k], w = WANT[k];
    if (!c) { bad.push(k + ' missing'); continue; }
    if (c.on !== w[0] || c.off !== w[1]) bad.push(k + ' event');
    if (c.pitchOn !== w[2] || c.pitchOff !== w[3]) bad.push(k + ' pitch');
    if (c.volume !== 0.3) bad.push(k + ' volume');
    if (!evs[w[0]] || !evs[w[1]]) bad.push(k + ' not in sounds.json');
  }
  const n = (text.match(/\bclick\(state, x, y, z, [^)]*\)/g) || []).length;
  if (n !== 6) bad.push('click() sites ' + n + ' != 6');
  if (/sound\(state, x, y, z, null, 'place'\)/.test(text)) bad.push('plate/arrow edge still plays place');
  return bad;
}
let breaks = 0, pass = 0;
const fails = [];
for (const b of problems(U.CLICK, src)) fails.push(b);
console.log(`   ${Object.keys(WANT).length} sources checked`);
const caught = (label, table, text) => {
  if (problems(table, text).length) { breaks++; console.log('   ✓ break caught: ' + label); }
  else fails.push('anti-vacuity: ' + label + ' went unnoticed');
};
const clone = () => JSON.parse(JSON.stringify(U.CLICK));
{ const t = clone(); t.lever.pitchOn = 1; caught('lever pitch 1', t, src); }
{ const t = clone(); t.stone_button.off = t.stone_button.on; caught('button off = on event', t, src); }
{ const t = clone(); t.metal_plate.pitchOn = 0.9; caught('metal pitch 0.9 not float', t, src); }
{ const t = clone(); t.wooden_plate.volume = 1; caught('plate volume 1', t, src); }
{ const t = clone(); t.stone_plate.on = 'block.stone.place'; caught('plate generic sound', t, src); }
caught('release silent', U.CLICK, src.replace('click(state, x, y, z, false);', ''));
console.log('\n================ clicksoundcheck ================');
console.log(` assertions passed .. ${Object.keys(WANT).length * 5 + 2 - fails.length}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
