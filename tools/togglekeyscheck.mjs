#!/usr/bin/env node
// togglekeyscheck.mjs — G17-P2. Sneak/Sprint Hold|Toggle (ToggleKeyBinding) in src/13_input.js.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/13_input.js'), 'utf8');
function load(src) {
  const NS = { U: { now: () => 0 } };
  new Function('MCL', src)(NS);
  return NS.Input;
}
function press(I, c) { I.keys[c] = true; I.togglePress(c); }
function release(I, c) { I.keys[c] = false; }
let n = 0;
function ok(c, m) { n++; if (!c) throw new Error('FAIL: ' + m); }
function run(src) {
  n = 0;
  let I = load(src);
  press(I, 'ShiftLeft'); ok(I.sneakOn(), 'HOLD held'); release(I, 'ShiftLeft'); ok(!I.sneakOn(), 'HOLD released');
  I.toggleSneak = true;
  press(I, 'ShiftLeft'); release(I, 'ShiftLeft'); ok(I.sneakOn(), 'TOGGLE on after first release');
  press(I, 'ShiftLeft'); release(I, 'ShiftLeft'); ok(!I.sneakOn(), 'TOGGLE off after second release');
  press(I, 'ShiftLeft'); release(I, 'ShiftLeft'); ok(I.sneakOn(), 'on again');
  I.clearToggles(); ok(!I.sneakOn(), 'opening a screen clears toggled sneak');
  I.toggleSprint = true;
  press(I, 'ControlLeft'); release(I, 'ControlLeft'); ok(I.sprintOn(1), 'sprint toggled on');
  ok(!I.sprintOn(0), 'sprint stops when not moving'); ok(!I.sprintOn(1), 'and stays off');
  I = load(src); press(I, 'ControlLeft'); ok(I.sprintOn(1), 'sprint HOLD'); release(I, 'ControlLeft'); ok(!I.sprintOn(1), 'sprint HOLD released');
  return n;
}
const asserts = run(SRC);
const breaks = [
  ['option ignored (sneak)', s => s.replace('I.toggleSneak ? I.sneakToggled :', 'false ? 0 :')],
  ['no flip', s => s.replace('I.sneakToggled = !I.sneakToggled;', '')],
  ['no clear', s => s.replace('I.sneakToggled = I.sprintToggled = false; };', '};')],
  ['sprint never stops', s => s.replace('if (!fwd) I.sprintToggled = false;', '')]
];
let caught = 0;
for (const [name, f] of breaks) {
  const b = f(SRC); if (b === SRC) { console.log('break not applied: ' + name); process.exit(1); }
  try { run(b); console.log("NOT caught: " + name); process.exit(1); } catch { caught++; console.log("  ✓ caught: " + name); }
}
console.log(`togglekeyscheck: ${asserts} assertions, ${caught} breaks caught`);
