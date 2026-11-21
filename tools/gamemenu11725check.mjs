#!/usr/bin/env node
// gamemenu11725check.mjs — #11725: GameMenuScreen row set/order (return, adv|stats, feedback|bugs, options|LAN, quit) and link URLs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const SRC = readFileSync(fileURLToPath(new URL('../src/15f_options.js', import.meta.url)), 'utf8');
let pass = 0, breaks = 0; const fails = [];
function trial(patch) {
  const src = patch ? patch(SRC) : SRC;
  const m = /O\.openLink = [^\n]*\n[\s\S]*?O\.pauseRows = function \(\) \{[\s\S]*?\n  \};\n/.exec(src);
  if (!m) throw new Error('pause block missing');
  const opened = [], O = {}, NS = { Hud: { close() { } } };
  new Function('O', 'NS', 'window', m[0])(O, NS, { open: (u) => opened.push(u) });
  const rows = O.pauseRows();
  const labels = rows.map((r) => r.label).join('|');
  rows.filter((r) => /Feedback|Bugs/.test(r.label)).forEach((r) => r.fn());
  return {
    order: labels === 'Back to Game|Advancements|Statistics|Send Feedback|Report Bugs|Options...|Open to LAN|Save and Quit to Title',
    wide: rows.filter((r) => r.wide).map((r) => r.label).join() === 'Back to Game,Save and Quit to Title',
    urls: opened.join() === 'https://aka.ms/javafeedback?ref=game,https://aka.ms/snapshotbugs?ref=game'
  };
}
const base = trial(); for (const [k, v] of Object.entries(base)) { if (v) pass++; else fails.push('baseline ' + k); }
const R = (a, b) => (t) => { if (!t.includes(a)) throw new Error('break target missing: ' + a); return t.replace(a, b); };
const BR = [
  ['nofeedback', "{ t: 'btn', label: 'Send Feedback'", "{ t: 'btn', label: 'Feedback'", 'order'],
  ['nobugs', "label: 'Report Bugs'", "label: 'Bugs'", 'order'],
  ['swap', "      { t: 'btn', label: 'Options...', fn: function () { O.go('options'); } },\n      { t: 'owed'", "      { t: 'owed'", 'order'],
  ['url', 'javafeedback?ref=game', 'x', 'urls'],
  ['wide', "{ t: 'btn', wide: true, label: 'Save and Quit", "{ t: 'btn', label: 'Save and Quit", 'wide']
];
for (const [n, a, b, k] of BR) {
  try { const o = trial(R(a, b)); if (!o[k]) breaks++; else fails.push('break ' + n + ' NOT caught'); }
  catch (e) { if (/break target missing/.test(e.message)) fails.push(e.message); else breaks++; }
}
for (const f of fails) console.log('FAIL ' + f);
console.log(`gamemenu11725check: ${pass} assertions · ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
