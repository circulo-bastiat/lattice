#!/usr/bin/env node
// textkeybindcheck.mjs — #8237. {"keybind":"key.jump"} shows the key bound RIGHT NOW (KeybindText).
//   node tools/textkeybindcheck.mjs [--quiet]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');

function load(mutate) {
  const NS = {};
  globalThis.MCL = NS;
  globalThis.window = globalThis.window || globalThis; globalThis.document = globalThis.document || { addEventListener() {}, getElementById() { return null; } };
  for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02i_text.js']) {
    let src = readFileSync(join(ROOT, 'src', f), 'utf8');
    if (mutate && f === '02i_text.js') src = mutate(src);
    new Function('MCL', src)(NS);
  }
  const src = readFileSync(join(ROOT, 'src/13_input.js'), 'utf8');
  const m = /I\.BINDINGS = \{[\s\S]*?\n  \};\n[\s\S]*?I\.setBinding = function[\s\S]*?\n  \};\n/.exec(src);
  if (!m) throw new Error('bindings table not found in 13_input.js');
  NS.Input = {};
  new Function('NS', 'var I = NS.Input;' + m[0])(NS);
  const meta = JSON.parse(readFileSync(join(ROOT, 'assets/lang.meta.json'), 'utf8'));
  NS.Text.init({ lang: readFileSync(join(ROOT, 'assets/lang.bin')).toString('base64'), langBytes: meta.rawBytes,
    langOverrides: readFileSync(join(ROOT, 'assets/lang-overrides.json'), 'utf8') });
  return NS;
}
function run(mutate) {
  const NS = load(mutate), T = NS.Text, I = NS.Input, bad = [];
  const show = (id) => T.runs(T.fromJson({ keybind: id })).map((r) => r.text).join('');
  const eq = (a, b, m) => { if (a !== b) bad.push(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
  eq(show('key.jump'), 'Space', 'jump default');
  eq(show('key.attack'), 'Left Button', 'attack default');
  eq(show('key.use'), 'Right Button', 'use default');
  eq(show('key.inventory'), 'E', 'inventory default');
  eq(show('key.sneak'), 'Left Shift', 'sneak default');
  I.setBinding('key.jump', 'key.keyboard.j');
  eq(show('key.jump'), 'J', 'jump rebound to J');
  I.setBinding('key.attack', 'key.mouse.3');
  eq(show('key.attack'), 'Button 4', 'attack rebound to mouse 4');
  I.setBinding('key.jump', '');
  eq(show('key.jump'), 'Not bound', 'unbound');
  eq(show('key.nonsense'), 'key.nonsense', 'unknown id renders raw');
  eq(T.runs(T.fromJson({ text: 'Press ', extra: [{ keybind: 'key.inventory', color: 'red' }] })).map((r) => r.text).join(''), 'Press E', 'inside extra');
  eq(T.JSON_OWED.includes('keybind'), false, 'keybind off JSON_OWED');
  return bad;
}
console.log('textkeybindcheck — #8237');
const base = run();
let fail = base.length;
base.forEach((m) => console.log('  FAIL ' + m));
const breaks = [
  ['caches the default name', (s) => s.replace('T.keybindName = function (id) {', 'var _c = {}; T.keybindName = function (id) { if (_c[id]) return _c[id]; var r = T.keybindName2(id); return (_c[id] = r); };\n  T.keybindName2 = function (id) {')],
  ['maps mouse buttons to key names', (s) => s.replace("var m = /^key", "if (/^key\\.mouse\\./.test(k)) return k.replace(/^key\\./, '').toUpperCase();\n    var m = /^key")]
];
let caught = 0;
for (const [name, mut] of breaks) {
  let b; try { b = run(mut); } catch (e) { b = [String(e)]; }
  if (b.length) { caught++; console.log('  ✓ caught: ' + name); } else { fail++; console.log('  NOT CAUGHT: ' + name); }
}
console.log(` assertions passed .. ${12 - base.length}`);
console.log(` failures ........... ${fail}`);
console.log(` breaks caught ...... ${caught}`);
console.log(`${caught} breaks caught`);
console.log(fail ? 'FAIL' : 'PASS');
process.exit(fail ? 1 : 0);
