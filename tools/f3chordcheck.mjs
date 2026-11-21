#!/usr/bin/env node
// f3chordcheck.mjs — G17-K4. Keyboard.processF3 chords (A reload, D clear chat, P pause-on-lost-focus, Q help) and the
// "F3 used" flag: F3 alone toggles the overlay on release, F3 + a key does not. Breaks its own module to prove it can fail.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = f => readFileSync(join(ROOT, f), 'utf8');
const meta = JSON.parse(rd('assets/lang.meta.json'));
function load(inputSrc) {
  const NS = {};
  globalThis.window = { addEventListener() {} };
  for (const f of ['00_ns', '01_util', '01b_inflate', '02i_text', '15c_chat']) new Function('MCL', rd(`src/${f}.js`))(NS);
  NS.Text.init({ lang: readFileSync(join(ROOT, 'assets/lang.bin')).toString('base64'), langBytes: meta.rawBytes, langOverrides: rd('assets/lang-overrides.json') });
  let remesh = 0, saved = 0;
  NS.World = { remeshAll() { remesh++; } };
  NS.Settings = { pauseOnLostFocus: true, save() { saved++; } };
  new Function('MCL', inputSrc)(NS);
  const I = NS.Input, fired = [];
  I.onAction = n => fired.push(n);
  return { NS, I, fired, st: () => ({ remesh, saved }) };
}
const down = (I, c) => { if (c === 'F3') { I.f3Held = true; I.f3Used = false; } else I.processF3(c); };
const up = (I, fired) => { if (I.f3Release()) fired.push('debug'); };
function verify(src) {
  const f = []; let n = 0; const no = (c, m) => { n++; if (!c) f.push(m); };
  const { NS, I, fired, st } = load(src), T = NS.Text, C = NS.Chat;
  const plain = () => C.messages.map(m => T.plain(T.resolve ? T.resolve(m.component) : m.component));
  const text = k => T.translate(k, []);
  no(T.has('debug.help.message') && T.has('debug.reload_chunks.message') && T.has('debug.pause_focus.on'), 'lang keys missing');
  // bare F3 toggles
  down(I, 'F3'); up(I, fired); no(fired.join() === 'debug', 'F3 alone must toggle the overlay');
  // F3+A
  fired.length = 0; down(I, 'F3'); down(I, 'KeyA'); up(I, fired);
  no(st().remesh === 1, 'F3+A reloads chunks'); no(!fired.length, 'F3 release after a chord must not toggle');
  no(plain().pop().endsWith(text('debug.reload_chunks.message')), 'F3+A chat line = lang value');
  // F3+P
  down(I, 'F3'); down(I, 'KeyP'); up(I, fired);
  no(NS.Settings.pauseOnLostFocus === false && st().saved === 1, 'F3+P toggles and persists');
  no(plain().pop().endsWith(text('debug.pause_focus.off')), 'F3+P off line');
  down(I, 'F3'); down(I, 'KeyP'); up(I, fired);
  no(NS.Settings.pauseOnLostFocus === true && plain().pop().endsWith(text('debug.pause_focus.on')), 'F3+P back on');
  // F3+Q
  const before = C.messages.length; down(I, 'F3'); down(I, 'KeyQ'); up(I, fired);
  const added = plain().slice(before);
  no(added.length === 16 && added[0].endsWith(text('debug.help.message')), 'F3+Q prints header + 15 help lines');
  I.HELP_KEYS.forEach((k, i) => no(added[i + 1] === text(`debug.${k}.help`), `help line ${k}`));
  // unhandled key: suppressed toggle, no chat
  const c0 = C.messages.length; fired.length = 0; down(I, 'F3'); down(I, 'KeyZ'); up(I, fired);
  no(!fired.length && C.messages.length === c0, 'unhandled F3+key does nothing and suppresses toggle');
  // F3+D clears
  down(I, 'F3'); down(I, 'KeyD'); up(I, fired);
  no(C.messages.length === 0 && C.lines.length === 0, 'F3+D empties the chat model');
  // flag resets: F3 alone again works
  fired.length = 0; down(I, 'F3'); up(I, fired); no(fired.join() === 'debug', 'F3 alone works after a chord');
  return { f, n };
}
const base = rd('src/13_input.js');
const ok = verify(base);
ok.f.forEach(m => console.log('FAIL', m));
let caught = 0;
const breaks = [
  s => s.replace('I.f3Used = true;', ''),
  s => s.replace("KeyD: function () { if (NS.Chat && NS.Chat.clearAll) NS.Chat.clearAll(); }", "KeyD: function () {}"),
  s => s.replace("S.pauseOnLostFocus = !S.pauseOnLostFocus;", ""),
  s => s.replace("dbg('debug.help.message');", ""),
];
for (const b of breaks) { const m = b(base); if (m === base) { console.log('FAIL break did not apply'); continue; } if (verify(m).f.length) caught++; }
console.log(`${ok.n} asserted, ${caught} breaks caught`);
process.exit(ok.f.length || caught !== breaks.length ? 1 : 0);
