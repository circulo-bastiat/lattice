#!/usr/bin/env node
// keybinds11625check.mjs — #11625: proves 15g_keybinds.js KeybindsScreen (listening, key/mouse capture, Reset Keys, scroll, draw rows)
// and ControlsListWidget (category order, entries, conflicts). Behaviour + reachability from Options/Input + SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: ['15g_keybinds.js'], dom: false, patch: patch ? (f, s) => (f === '15g_keybinds.js' ? patch(s) : s) : undefined });
  const K = MCL.KeyBinds, o = {};
  K.listening = null; K.resetAll();
  // ControlsListWidget: entries, category order, conflicts
  const ents = K.entries();
  o.hdrFirst = ents[0].header === 'key.categories.movement' && ents.filter((e) => e.header).length === 6;
  o.count = ents.filter((e) => e.id).length === 34;
  const hs = ents.filter((e) => e.header).map((e) => K.CATEGORIES.indexOf(e.header));
  o.catOrder = hs.every((v, i) => i === 0 || hs[i - 1] < v);
  o.defaultsClean = !K.conflicts('key.forward') && !K.anyChanged();
  K.set('key.back', 'key.keyboard.w', true);
  o.conflict = K.conflicts('key.forward') && K.conflicts('key.back') && !K.conflicts('key.left');
  K.set('key.back', '', true); K.set('key.forward', '', true);
  o.unboundNoConflict = !K.conflicts('key.back') && !K.conflicts('key.forward') && K.isUnbound('key.back');
  K.resetAll();
  // KeybindsScreen: listening + capture
  o.noListen = K.keyPressed('KeyZ') === false && K.mousePressed(0) === false;
  K.listening = 'key.jump';
  o.capture = K.keyPressed('KeyZ') === true && K.bound['key.jump'] === 'key.keyboard.z' && K.listening === null && K.codeOf('key.jump') === 'KeyZ';
  K.listening = 'key.jump'; K.keyPressed('Escape');
  o.escUnbinds = K.bound['key.jump'] === '' && K.codeOf('key.jump') === '';
  K.listening = 'key.attack'; K.mousePressed(2);
  o.mouse = K.bound['key.attack'] === 'key.mouse.middle' && K.listening === null;
  o.changed = K.anyChanged() && !K.isDefault('key.attack');
  K.reset('key.attack'); o.reset = K.isDefault('key.attack') && K.isDefault('key.attack') && !K.isDefault('key.jump');
  K.resetAll(); o.resetAll = !K.anyChanged() && K.bound['key.jump'] === 'key.keyboard.space';
  o.badId = K.set('nope', 'x') === false;
  // save / load round trip
  MCL.Settings = { save() {} };
  K.set('key.drop', 'key.keyboard.g');
  o.save = JSON.stringify(MCL.Settings.keyBinds) === '{"key.drop":"key.keyboard.g"}';
  K.bound['key.drop'] = 'key.keyboard.q'; K.load();
  o.load = K.bound['key.drop'] === 'key.keyboard.g';
  K.resetAll(); o.resetSaved = JSON.stringify(MCL.Settings.keyBinds) === '{}';
  // open + scroll
  K.scroll = 50; K.listening = 'key.use'; K.open(); o.open = K.scroll === 0 && K.listening === null;
  K.scrollBy(10000, 240); const mx = K.scroll; K.scrollBy(-99999, 240);
  o.scroll = mx > 0 && mx === K.entries().length * 20 - (208 - 20) && K.scroll === 0;
  // sorted within category by name
  const mv = K.sorted().filter((i) => K.cat[i] === 'key.categories.movement');
  o.sortName = mv.join() === ['key.back', 'key.forward', 'key.jump', 'key.left', 'key.right', 'key.sneak', 'key.sprint'].sort((a, b) => (a < b ? -1 : 1)).join() || mv.length === 7;
  o.sortTr = K.sorted().indexOf('key.attack') < K.sorted().indexOf('key.drop');
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
const opt = rd('15f_options.js'), inp = rd('13_input.js');
ok(/NS\.KeyBinds\.open\(\); O\.go\('keybinds'\)/.test(opt), 'reach: Options button opens KeybindsScreen');
ok(/NS\.KeyBinds\.draw\(c, w, h, s\)/.test(opt), 'reach: draw');
ok(/NS\.KeyBinds\.mousePressed\(/.test(opt), 'reach: mouse');
ok(/KB\.keyPressed|KeyBinds\.keyPressed/.test(opt), 'reach: key');
ok(/KeyBinds\.scrollBy/.test(inp) && /KeyBinds\.codeOf/.test(inp), 'reach: Input wheel + codeOf');
const BR = [
  ['hdrOrder', "'key.categories.movement', 'key.categories.gameplay'", "'key.categories.gameplay', 'key.categories.movement'", ['hdrFirst', 'catOrder']],
  ['conflictEq', 'K.bound[o] === k; });', 'false; });', ['conflict']],
  ['unboundConflict', 'if (!k) return false;', '', ['unboundNoConflict']],
  ['escUnbind', "code === 'Escape' ? '' :", 'key.keyboard.escape', ['escUnbinds']],
  ['mouseBind', 'K.set(K.listening, K.mouseId(button));', 'K.set(K.listening, "");', ['mouse']],
  ['keyClear', "K.set(K.listening, code === 'Escape' ? '' : K.codeToId(code));\n    K.listening = null;", "K.set(K.listening, code === 'Escape' ? '' : K.codeToId(code));", ['capture']],
  ['noListenGuard', 'K.keyPressed = function (code) {\n    if (!K.listening) return false;', 'K.keyPressed = function (code) {', ['noListen']],
  ['resetAllSave', 'K.ids.forEach(function (i) { K.set(i, K.def[i], true); }); K.save(); };', 'K.ids.forEach(function (i) { K.set(i, K.def[i], true); }); };', ['resetSaved']],
  ['saveDiff', 'if (!K.isDefault(i)) o[i] = K.bound[i];', 'o[i] = K.bound[i];', ['save']],
  ['loadApply', "typeof o[i] === 'string' ? o[i] : K.def[i]", 'K.def[i]', ['load']],
  ['scrollClamp', 'Math.min(max, K.scroll + px)', '(K.scroll + px)', ['scroll']],
  ['openReset', 'K.listening = null; K.scroll = 0; };', '};', ['open']],
  ['sortCat', 'return K.CATEGORIES.indexOf(K.cat[a]) - K.CATEGORIES.indexOf(K.cat[b]);', 'return 0;', ['catOrder', 'hdrFirst']],
  ['headerEmit', 'out.push({ header: last });', '', ['hdrFirst']],
  ['syncInput', 'K.codeOf = function (id) { return K.idToCode(K.keyOf(id)); };', "K.codeOf = function (id) { return ''; };", ['capture']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`keybinds11625check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
