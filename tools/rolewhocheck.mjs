#!/usr/bin/env node
// rolewhocheck.mjs - #6646: (1) only the commander role signs as `commander` (a fixer/tester/chore signing as commander
// made its replies mark the commander's mail answered and its reports `mail to itself`); (2) the brain's maxPerHour waker
// is armed only when the worker hour cap really holds (with per-account switches it armed one waker per worker start).
import { readFileSync } from 'node:fs';
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const roles = JSON.parse(src('brain/roles.json')).roles, brain = src('brain/brain.mjs');
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
function idBad(R) {
  const bad = [];
  for (const [k, v] of Object.entries(R)) {
    if (k === 'commander' || k === 'worker') continue;
    if (v.who === 'commander') bad.push(`${k}: who=commander`);
    if (/MCLITE_WHO=commander/.test(v.prompt || '')) bad.push(`${k}: prompt runs go.mjs as commander`);
    if (v.who && new RegExp(`--to ${v.who}(?![\\w-])`).test(v.prompt || '')) bad.push(`${k}: prompt mails itself`);
  }
  if ((R.commander || {}).who !== 'commander') bad.push('commander: who is not commander');
  return bad;
}
const wakerBad = (b) => (/if \(want > 0 && n === 0 && left\('worker'\) === 0\)/.test(b) ? [] : ['the maxPerHour waker is armed without the hour cap holding']);
const b1 = idBad(roles); ok(!b1.length, 'role identity: ' + b1.join('; '));
const b2 = wakerBad(brain); ok(!b2.length, b2.join('; '));
// anti-vacuity: each break must be caught
const clone = () => JSON.parse(JSON.stringify(roles));
const brk = {
  'fixer signs as commander': () => { const r = clone(); r.fixer.who = 'commander'; return idBad(r).length; },
  'tester prompt runs as commander': () => { const r = clone(); r.tester.prompt += ' MCLITE_WHO=commander node tools/go.mjs say'; return idBad(r).length; },
  'chore mails itself': () => { const r = clone(); r.chore.prompt += ` --to ${r.chore.who} "x"`; return idBad(r).length; },
  'commander loses its name': () => { const r = clone(); r.commander.who = 'boss'; return idBad(r).length; },
  'waker armed on n === 0 alone': () => wakerBad(brain.replace("if (want > 0 && n === 0 && left('worker') === 0)", 'if (want > 0 && n === 0)')).length,
};
for (const [k, f] of Object.entries(brk)) { const c = f() > 0; ok(c, `break "${k}" must be caught`); if (c) { breaks++; console.log(`  ✓ break "${k}" caught`); } }
// #9761: a worker's pre-Claude `go.mjs start` (brain.yml, pack-slot.sh) runs before launch.mjs sets MCLITE_WHO; without it whoAmI() falls back to commander
for (const [n, s, re] of [['brain.yml runs go.mjs start as worker', src('../.github/workflows/brain.yml'), /MCLITE_WHO=worker MCLITE_RUN_ACCOUNT="\$ACCOUNT" timeout 1800 flock ~\/\.brain\/start\.lock node tools\/go\.mjs start/],
  ['pack-slot.sh runs go.mjs start as worker', src('infra/mirror/pack-slot.sh'), /MCLITE_WHO=worker timeout 1800 flock "\$BRAIN_HOME\/start\.lock" node tools\/go\.mjs start/]]) {
  ok(re.test(s), n); const c = !re.test(s.replace('MCLITE_WHO=worker ', '')); ok(c, `break "${n}" removed must be caught`); if (c) breaks++; }
console.log(`rolewhocheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
