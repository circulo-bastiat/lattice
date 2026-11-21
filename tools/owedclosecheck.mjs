#!/usr/bin/env node
// owedclosecheck.mjs - #11907: a landed `--part` PR whose owed items are empty, or all tracked by another open issue, closes the issue; anything else keeps it open.
// Pure rules + wiring in land.mjs, each also run against a broken copy (the lines "✓ break caught" are counted by the suite and the lander's anti-vacuity gate).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseOwed, owedTracked } from './infra/owedclose.mjs';
let bad = 0, caught = 0, asserts = 0;
const ok = (c, m) => { asserts++; if (!c) { bad++; console.log('FAIL ' + m); } };
const hit = (m) => { caught++; console.log(' ✓ break caught: ' + m); };
const B = (t) => `Part of #11500. **Owed (the issue stays open):** ${t}`;
const T = (t, self = 11500) => owedTracked(parseOwed(B(t)), self);

// rules
ok(parseOwed(B('port 11 loot functions (#11884)')) === 'port 11 loot functions (#11884)', 'parseOwed reads the text after the marker');
ok(parseOwed('no marker here') === null && !owedTracked(null, 1).close, 'a body without an Owed marker never closes');
ok(T('port 11 loot functions (#11884)').close && T('port 11 loot functions (#11884)').refs.join() === '11884', 'one item tracked in another issue closes');
ok(T('A (#11884); B (#11885)').close && T('A (#11884); B (#11885)').refs.join() === '11884,11885', 'every item tracked closes, refs listed');
ok(T('nothing').close && T('None.').close && T('-').close && T('').close, 'nothing owed closes');
ok(!T('port 11 loot functions').close, 'an item with no issue reference keeps it open');
ok(!T('A (#11884); B still to port').close, 'one untracked item among tracked ones keeps it open');
ok(!T('the rest of #11500').close, 'a reference to the issue itself is not tracking');
ok(T('A (done in #11884, #11885)').refs.length === 2 && T('A (done in #11884, #11885)').close, 'a comma inside parentheses does not split an item');
// breaks: each broken rule must be visible to a case above
const old = owedTracked;
const broken = [
  ['an untracked item still closes', (o, s) => ({ close: true, refs: [] })],
  ['a self reference counts as tracking', (o, s) => owedTracked(o, -1)],
  ['empty owed never closes', (o, s) => (o === '' ? { close: false, refs: [] } : old(o, s))],
];
for (const [name, fn] of broken) {
  const wrong = [!fn('port 11 loot functions', 11500).close === false, fn('the rest of #11500', 11500).close, !fn('', 11500).close].some(Boolean);
  if (wrong) hit(name); else ok(false, 'break not caught: ' + name);
}
// wiring in land.mjs
const LAND = readFileSync(fileURLToPath(new URL('./infra/land.mjs', import.meta.url)), 'utf8');
const W = [
  ['the partial-landing branch asks owedTracked', /const ot = owedTracked\(parseOwed\(owed\), issue\)/],
  ['it closes the issue only when every tracking issue is open', /if \(ot\.close && live\.every\(Boolean\)\) \{[\s\S]{0,700}state: 'closed', state_reason: 'completed'/],
  ['otherwise it still posts Partly landed and keeps the issue open', /\} else \{\n      await gh\('POST', `\/repos\/\{repo\}\/issues\/\$\{issue\}\/comments`, \{ body: `\*\*Partly landed\*\*/],
];
for (const [name, re] of W) { ok(re.test(LAND), 'wiring: ' + name); const b = LAND.replace(re, '/*gone*/'); if (b !== LAND && !re.test(b)) hit('wiring removed: ' + name); else ok(false, 'wiring break not caught: ' + name); }
console.log(`owedclosecheck: ${asserts} assertions, ${bad} failures, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
