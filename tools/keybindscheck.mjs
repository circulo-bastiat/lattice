#!/usr/bin/env node
// keybindscheck.mjs — G17-KB1: the Key Binds screen's table and the Input that reads it.
//
//   node tools/keybindscheck.mjs
//
// The id / default key / category table is compared with GameOptions.java (the 1.18.2 decompile), a rebind
// of key.jump to KeyQ must make Input jump on Q and not on Space, two bindings on one key are both
// flagged, Reset Keys restores the defaults, and the screen draws every binding. Then the module and the
// input reader are broken and each break must be caught (anti-vacuity, D-30).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

// GLFW key code -> vanilla key id, written out independently of the module under test
function glfw(code) {
  if (code === -1) return '';
  if (code >= 65 && code <= 90) return 'key.keyboard.' + String.fromCharCode(code + 32);
  if (code >= 48 && code <= 57) return 'key.keyboard.' + String.fromCharCode(code);
  const m = { 32: 'space', 258: 'tab', 47: 'slash', 340: 'left.shift', 341: 'left.control', 291: 'f2', 294: 'f5', 300: 'f11' };
  return m[code] ? 'key.keyboard.' + m[code] : '?' + code;
}
const MOUSE = ['key.mouse.left', 'key.mouse.right', 'key.mouse.middle'];

const src = read('.decomp/net/minecraft/client/option/GameOptions.java');
const vanilla = [];
for (const m of src.matchAll(/new (?:Sticky)?KeyBinding\(\s*"(key\.[A-Za-z.0-9]+)",\s*(?:InputUtil\.Type\.field_1672,\s*(\d+)|(InputUtil\.UNKNOWN_KEY\.getCode\(\))|(\d+))\s*,\s*"key\.categories\.(\w+)"/g)) {
  const def = m[2] !== undefined ? MOUSE[+m[2]] : (m[3] ? '' : glfw(+m[4]));
  vanilla.push({ id: m[1], def, cat: 'key.categories.' + m[5] });
}

function boot(mutate) {
  const NS = {};
  globalThis.MCL = NS;
  NS.Settings = { save() {} };
  let inp = read('src/13_input.js'), kb = read('src/15g_keybinds.js');
  if (mutate) [inp, kb] = mutate(inp, kb);
  new Function('MCL', inp)(NS);
  new Function('MCL', kb)(NS);
  return NS;
}
// the body of the player's per-frame command that reads the movement keys
const jumpOn = (NS, code) => { NS.Input.keys = Object.create(null); NS.Input.keys[code] = true; return NS.Input.bdown('key.jump'); };

function suite(NS) {
  const out = [];
  const t = (c, m) => out.push([c, m]);
  const K = NS.KeyBinds, I = NS.Input;
  t(vanilla.length === 34, 'extracted 34 GameOptions bindings, got ' + vanilla.length);
  t(K.TABLE.length === vanilla.length, 'table has ' + K.TABLE.length + ' bindings, GameOptions ' + vanilla.length);
  for (const v of vanilla) {
    t(K.def[v.id] === v.def, v.id + ' default ' + K.def[v.id] + ' != vanilla ' + v.def);
    t(K.cat[v.id] === v.cat, v.id + ' category ' + K.cat[v.id] + ' != ' + v.cat);
  }
  t(K.CATEGORIES.join() === 'key.categories.movement,key.categories.gameplay,key.categories.inventory,key.categories.creative,key.categories.multiplayer,key.categories.ui,key.categories.misc', 'category order');
  const ents = K.entries();
  t(ents.filter((e) => e.id).length === 34 && ents.filter((e) => e.header).length === 6, 'the list shows all 34 bindings under 6 headers');
  t(ents[0].header === 'key.categories.movement', 'the list starts with Movement');

  t(jumpOn(NS, 'Space') && !jumpOn(NS, 'KeyQ'), 'jump fires on Space by default');
  K.set('key.jump', 'key.keyboard.q');
  t(jumpOn(NS, 'KeyQ') && !jumpOn(NS, 'Space'), 'rebinding key.jump to Q: jump on Q, not on Space');
  t(NS.Input.BINDINGS['key.jump'] === 'key.keyboard.q', 'Input.BINDINGS (Text.keybindName) follows the rebind');
  t(K.conflicts('key.jump') && K.conflicts('key.drop') && !K.conflicts('key.forward'), 'jump and drop both on Q are both conflicting');
  t(I.actionFor('KeyQ') !== undefined, 'Q still fires an action (the later binding wins, as vanilla\'s map)');
  K.set('key.drop', '');
  t(!K.conflicts('key.jump') && !K.conflicts('key.drop'), 'unbound never conflicts');
  t(I.actionFor('KeyQ') === undefined && I.actionFor('KeyE') === 'inventory', 'a rebound action leaves its old key; others stay');
  K.listening = 'key.sneak';
  t(K.keyPressed('Escape') && K.keyOf('key.sneak') === '' && K.listening === null, 'Escape while listening binds NONE');
  K.listening = 'key.sneak'; K.keyPressed('KeyZ');
  t(K.keyOf('key.sneak') === 'key.keyboard.z', 'a key press while listening binds it');
  K.listening = 'key.attack'; K.mousePressed(1);
  t(K.keyOf('key.attack') === 'key.mouse.right', 'a click while listening binds the mouse button');
  t(NS.Settings.keyBinds['key.jump'] === 'key.keyboard.q' && !('key.forward' in NS.Settings.keyBinds), 'only changed bindings are saved');
  K.resetAll();
  t(K.ids.every((i) => K.isDefault(i)) && jumpOn(NS, 'Space') && !K.anyChanged(), 'Reset Keys restores every default');
  t(Object.keys(NS.Settings.keyBinds).length === 0, 'and the saved set is empty');
  NS.Settings.keyBinds = { 'key.jump': 'key.keyboard.j', 'key.bogus': 'x' };
  K.load();
  t(jumpOn(NS, 'KeyJ') && K.keyOf('key.bogus') === '', 'saved binds load; unknown ids are ignored');
  K.resetAll();
  return out;
}

const live = boot();
for (const [c, m] of suite(live)) ok(c, m);

// anti-vacuity: each broken build must fail the suite
const BREAKS = [
  ['Input ignores the table', (i, k) => [i.replace(/I\.codeOf = function \(id\) \{[^\n]*\n/, "I.codeOf = function (id) { return ({'key.forward':'KeyW','key.back':'KeyS','key.left':'KeyA','key.right':'KeyD','key.jump':'Space'})[id] || ''; };\n"), k]],
  ['conflicts never flagged', (i, k) => [i, k.replace('return K.ids.some(function (o) { return o !== id && K.bound[o] === k; });', 'return false;')]],
  ['Reset Keys does nothing', (i, k) => [i, k.replace("K.ids.forEach(function (i) { K.set(i, K.def[i], true); }); K.save();", '')]],
  ['a default is wrong', (i, k) => [i, k.replace("['key.jump', 'key.keyboard.space'", "['key.jump', 'key.keyboard.x'")]],
  ['a binding is missing', (i, k) => [i, k.replace("['key.advancements', 'key.keyboard.l', 'misc']", "['key.advancements2', 'key.keyboard.l', 'misc']")]],
  ['Escape binds a key instead of NONE', (i, k) => [i, k.replace("code === 'Escape' ? '' :", "code === 'Escape' ? 'key.keyboard.escape' :")]],
  ['rebound action keeps its old key', (i, k) => [i.replace('return (ALIAS[code] === a && I.isDefaultBinding(id)) ? a : undefined;', 'return a;'), k]]
];
let caught = 0;
for (const [name, fn] of BREAKS) {
  let bad = false;
  try { bad = suite(boot(fn)).some(([c]) => !c); } catch { bad = true; }
  if (bad) { caught++; console.log('   ✓ caught: ' + name); } else fails.push('anti-vacuity: break "' + name + '" was NOT caught');
}
ok(caught === BREAKS.length, 'all breaks caught');

console.log('keybindscheck — G17-KB1: ' + pass + ' assertions, ' + fails.length + ' failed; ' + caught + ' breaks caught');
console.log('    ' + caught + ' breaks caught');
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
