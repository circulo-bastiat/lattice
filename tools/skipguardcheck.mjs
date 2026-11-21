#!/usr/bin/env node
// skipguardcheck.mjs - #9166: `done --already-fixed` on a `RED <check>:` issue must re-run the check and refuse a SKIP. Drives the pure
// helpers with real captured outputs, checks go.mjs is wired to them, then anti-vacuity: a guard that accepts SKIP, ignores the exit
// status, or guards every issue must be caught.
import { readFileSync } from 'node:fs';
import { redCheckName, verdict } from './infra/skipguard.mjs';
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const SKIP = ' ✓ xprefcheck            49 ms  xprefcheck: SKIP (golden not generated -- run node tools/referee/runxp.mjs)\n 0 assertions · 0 deliberate breaks caught · 0 stages failed\n   They ran and passed.';
const GREEN = ' ✓ soundcheck           161 ms  114 assertions, 0 failures, 25 breaks caught\n 114 assertions · 25 deliberate breaks caught · 0 stages failed\n   A browser IS available here — these were deselected, not skipped for want of one.';
const cases = (name, v) => {
  const bad = [], t = (n, c) => { let r = false; try { r = !!c(); } catch {} if (!r) bad.push(n); };
  t('a SKIPped check is refused', () => v(SKIP, 0).ok === false && /SKIP/.test(v(SKIP, 0).why));
  t('a green check is accepted', () => v(GREEN, 0).ok === true);
  t('a failing check is refused whatever it printed', () => v(GREEN, 1).ok === false);
  t('the word "skipped" in a green run is not a SKIP', () => v(GREEN, 0).ok === true);
  return bad;
};
const real = cases('real', verdict);
ok(real.length === 0, `the real verdict fails: ${real.join(' | ')}`);
ok(redCheckName('RED xprefcheck: full-suite check red on master') === 'xprefcheck', 'a RED title names its check');
ok(redCheckName('G17-OPT1: Brightness option') === null && redCheckName('') === null && redCheckName(undefined) === null, 'only RED titles are guarded');
ok(redCheckName('RED lockstep-tablecheck: x') === 'lockstep-tablecheck', 'a hyphenated check name is kept whole');
const go = readFileSync(new URL('./go.mjs', import.meta.url), 'utf8');
ok(/from '\.\/infra\/skipguard\.mjs'/.test(go) && /redCheckName\(/.test(go) && /skipVerdict\(/.test(go), 'go.mjs uses the guard');
ok(go.indexOf('redCheckName(') > go.indexOf("flag('--already-fixed')) {") && go.indexOf('redCheckName(') < go.indexOf("closed #${num} as already fixed"), 'the guard runs inside --already-fixed, before the issue is closed');
for (const [name, v] of [['accepts everything', () => ({ ok: true, why: '' })], ['ignores the exit status', (o) => verdict(o, 0)], ['never refuses a SKIP', (o, s) => (s !== 0 ? { ok: false, why: 'x' } : { ok: true, why: '' })]]) {
  const b = cases(name, v); ok(b.length > 0, `the cases cannot tell "${name}" from the real verdict`);
  if (b.length) { breaks++; console.log(`  ✓ "${name}" fails ${b.length} case(s): ${b.slice(0, 2).join(' | ')}`); }
}
console.log(`skipguardcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
