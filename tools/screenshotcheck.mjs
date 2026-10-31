#!/usr/bin/env node
// screenshotcheck.mjs -- #10624: F2 screenshot vs 1.18.2 (.decomp ScreenshotRecorder / Keyboard).
//   name     SimpleDateFormat("yyyy-MM-dd_HH.mm.ss") local time + ".png"; a taken name gets "_2", "_3" (getScreenshotFilename)
//   message  chat gets TranslatableText screenshot.success ("Saved screenshot as %s") with the bare file name; failure "Couldn't save screenshot: %s"
//   key      F2 (key.keyboard.f2) is what the keybind table and the key handler use
// The expectations are parsed out of the decompiled source, then every engine rule is broken and must be caught.
import { loadEngine } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';

const DEC = new URL('../.decomp/net/minecraft/client/util/ScreenshotRecorder.java', import.meta.url);
const dec = readFileSync(DEC, 'utf8');
const fmt = /new SimpleDateFormat\("([^"]+)"\)/.exec(dec)[1];
const sep = /\$\$2 == 1 \? "" : "(_)" \+ \$\$2\) \+ "(\.png)"/.exec(dec);
const keys = [...dec.matchAll(/"(screenshot\.\w+)"/g)].map(m => m[1]);
const SRC = readFileSync(new URL('../src/15j_ss.js', import.meta.url), 'utf8');

function run(patch) {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  let M;
  try { M = loadEngine({ extra: ['15j_ss.js'], dom: false, patch }); } catch (e) { return ['load: ' + e.message]; }
  const SS = M.SS;
  if (!SS || !SS.fileName) return ['SS.fileName missing'];
  ok(fmt === 'yyyy-MM-dd_HH.mm.ss' && sep && sep[2] === '.png' && keys.includes('screenshot.success'), 'decomp facts not as expected');
  SS.used = {};
  const d = new Date(2026, 0, 5, 3, 4, 9);
  ok(SS.fileName(d) === '2026-01-05_03.04.09.png', 'name: ' + SS.fileName(new Date(2026, 0, 5, 3, 4, 9)));
  SS.used = {};
  const a = SS.fileName(d), b = SS.fileName(d), c = SS.fileName(d);
  ok(a === '2026-01-05_03.04.09.png' && b === '2026-01-05_03.04.09_2.png' && c === '2026-01-05_03.04.09_3.png', 'duplicates: ' + [a, b, c]);
  ok(SS.fileName(new Date(2026, 11, 31, 23, 59, 58)) === '2026-12-31_23.59.58.png', 'two-digit fields');
  ok(SS.successText('x.png') === 'Saved screenshot as x.png', 'success text: ' + SS.successText('x.png'));
  ok(SS.failureText('boom') === "Couldn't save screenshot: boom", 'failure text');
  ok(/e\.code === 'F2'/.test(SRC), 'F2 key handler');
  ok(/'key\.screenshot', 'key\.keyboard\.f2'/.test(readFileSync(new URL('../src/15g_keybinds.js', import.meta.url), 'utf8')), 'keybind');
  ok(/say\(SS\.successText\(name\)\)/.test(readFileSync(new URL('../src/15j_ss.js', import.meta.url), 'utf8').replace(/\n/g, ' ')) || false, 'chat uses successText');
  return fails;
}
const base = run();
if (base.length) console.log(base.map(f => '  ✗ ' + f).join('\n'));
let caught = 0, total = 0;
const brk = (from, to) => {
  total++;
  const f = run((f, s) => { if (f !== '15j_ss.js') return s; if (!s.includes(from)) throw new Error('break target missing: ' + from); return s.replace(from, to); });
  if (f.length) caught++; else console.log('  ✗ NOT caught: ' + from);
};
const P = '15j_ss.js';
void P;
brk("'-' + p2(d.getMonth() + 1)", "'-' + (d.getMonth() + 1)");
brk("'_' + p2(d.getHours()) + '.'", "'_' + p2(d.getHours()) + ':'");
brk("SS.used[name] = true; return name;", "return name;");
brk("'Saved screenshot as '", "'Screenshot saved: '");
brk("\"Couldn't save screenshot: \"", "'failed: '");
brk("d.getMonth() + 1)", "d.getMonth())");
console.log(`✓ ${base.length ? 'FAIL' : '8 assertions'}, ${caught} breaks caught`);
process.exit(base.length || caught !== total ? 1 : 0);
