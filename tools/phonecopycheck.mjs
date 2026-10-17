#!/usr/bin/env node
// phonecopycheck.mjs - #7810: the phone app talks plain English. Breaks: raw HTTP error text shown to the user, a jargon term shown without its "?" explanation, a destructive button without a two-tap confirm, outcome words wrong.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const P = join(dirname(fileURLToPath(import.meta.url)), 'phone-web'), rd = (f) => readFileSync(join(P, f), 'utf8');
const UIsrc = rd('ui.js'), APP = rd('app.js');
const TERMS = ['lander', 'bus', 'fill', 'salts'];
function run(S) {
  const f = [], ok = (c, m) => { if (!c) f.push(m); };
  const m = { exports: {} }; new Function('module', 'document', S.ui + '\nreturn 0')(m, {}); const UI = m.exports;
  // 1 raw HTTP text never reaches the screen: every catch that shows an error goes through UI.plain
  const leaks = S.app.split('\n').filter((l) => /catch \((e|err)\)/.test(l) && /String\((e|err)\.message \|\| (e|err)\)/.test(l));
  ok(leaks.length === 0, `raw error text shown: ${leaks.map((l) => l.trim().slice(0, 50)).join(' | ')}`);
  ok(!/GitHub \d{3}/.test(UI.ErrorState(new Error('GitHub 403 on GET /x'))), 'ErrorState leaks the HTTP status');
  // 2 every jargon term has a sentence, and the screens that show it carry a "?"
  for (const t of TERMS) ok((UI.explain(t) || '').length > 20, `"${t}" has no explanation`);
  ok(/Help\('fill'\)/.test(S.app), 'the fill controls have no "?"');
  ok(/data-help/.test(S.app) && /BottomSheet/.test(S.app.split('data-help').pop()), '"?" does not open an explanation');
  // 3 every button that stops or spends goes through twoTap with a consequence
  ok(/twoTap\(pb, UI\.CONSEQUENCE\.pause/.test(S.app), 'the Pause button has no two-tap confirm');
  ok(/armed === 'commander'/.test(S.app) && /armed === 'fixer'/.test(S.app), 'start buttons lost their confirm');
  ok(/Stops new workers/.test(UI.CONSEQUENCE.pause(6)) && /6 running/.test(UI.CONSEQUENCE.pause(6)), 'pause consequence not in words');
  // 4 outcomes in words
  const w = (r) => UI.outcomeWord(r);
  ok(w({ ok: true, text: 'done' }) === 'landed' && w({ ok: false, text: '' }) === 'gave up' && w({ ok: true, text: 'already fixed on master' }) === 'already fixed' && w({ ok: true, text: 'partial: x' }) === 'partial' && w({ ok: true, text: 'found nothing to do' }) === 'found nothing', 'outcome words wrong');
  return f;
}
const base = { ui: UIsrc, app: APP };
const fails = run(base);
if (fails.length) { console.log('FAIL phonecopycheck\n' + fails.map((x) => '  ' + x).join('\n')); process.exit(1); }
const breaks = [
  ['ui', (s) => s.replace('const plain = (e) => {', 'const plain = (e) => { return String(e.message || e);')],
  ['app', (s) => s.replace('UI.plain(e), \'bad\'', 'String(e.message || e), \'bad\'')],
  ['app', (s) => s.replace('UI.twoTap(pb,', 'pb.addEventListener(\'click\',')],
  ['app', (s) => s.replace("UI.Help('fill')", '')],
  ['ui', (s) => s.replace(/fill: 'How many[^']*'/, "fill: 'x'")],
  ['ui', (s) => s.replace("'already fixed'", "'landed'")],
];
let caught = 0;
for (const [k, fn] of breaks) { const s = { ...base, [k]: fn(base[k]) }; if (s[k] === base[k]) { console.log('FAIL break does not change the source'); process.exit(1); } try { if (run(s).length) caught++; } catch { caught++; } }
if (caught !== breaks.length) { console.log(`FAIL only ${caught}/${breaks.length} breaks caught`); process.exit(1); }
console.log(`ok phonecopycheck: ${caught} breaks caught`);
