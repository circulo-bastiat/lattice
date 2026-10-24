// #7683: the pre-launch gate must recognise a RED issue's checks, and must NOT fire for ordinary issues.
import { redChecks } from './infra/prelaunch.mjs';
const known = new Set(['usagestalecheck', 'lockstep-tablecheck', 'bemodelcheck']);
const cases = [
  ['RED usagestalecheck fails on master', ['usagestalecheck']],
  ['RED lockstep-tablecheck and bemodelcheck', ['lockstep-tablecheck', 'bemodelcheck']],
  ['Worker runs keep getting shorter usagestalecheck', []],
  ['RED something with no known id', []],
];
let fails = 0, n = 0;
const ok = (a, b) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.log('FAIL', JSON.stringify(a), '!=', JSON.stringify(b)); } };
for (const [t, want] of cases) ok(redChecks(t, known), want);
// anti-vacuity (D-30): break the gate three ways; each must be caught by the cases above
const broken = [
  (t) => redChecks(t, new Set()),                       // knows no check
  (t, k) => redChecks('RED ' + t, k),                   // fires on non-RED titles
  () => ['usagestalecheck'],                            // fires always
];
let caught = 0;
for (const f of broken) if (cases.some(([t, want]) => JSON.stringify(f(t, known)) !== JSON.stringify(want))) caught++;
console.log(`${n} assertions, ${fails} failures, ${caught} breaks caught`);
process.exit(fails || caught < broken.length ? 1 : 0);
