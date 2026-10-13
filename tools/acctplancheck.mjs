// tools/acctplancheck.mjs - #5110 (11 Oct): a commander read the shared 'fill shape: 1w+0t' line as the whole fill while two accounts each had their own
// FILL_WORKERS_<ACCOUNT> count. `go.mjs status` must print the per-account line, computed by route.mjs acctPlanLine. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import { acctPlanLine } from './brain/route.mjs';
const GO = readFileSync(new URL('./go.mjs', import.meta.url), 'utf8'), RUN = readFileSync(new URL('../RUN.md', import.meta.url), 'utf8');
const CFG = { accounts: [{ name: 'max' }, { name: 'pro', workers: 1, role: 'tester' }], fill: { maxTotal: 10, quiet: { tz: 'America/New_York', from: '08:00', to: '14:00', factor: 0.5 } } };
const IN = Date.parse('2026-10-11T15:00:00Z'), OUT = Date.parse('2026-10-11T19:00:00Z');   // 11:00 and 15:00 New York
const verdict = (fn, go, run) => {
  const bad = [], env = { FILL_WORKERS_MAX: '8', FILL_WORKERS_PRO: '2' };
  const a = fn(CFG, env, IN, { max: 3, pro: 1 }), b = fn(CFG, env, OUT, {}), c = fn(CFG, { FILL_WORKERS_MAX: '8' }, OUT, {});
  if (!/max target 4 \(8 x 0\.5 quiet\) running 3/.test(a) || !/pro target 1 \(2 x 0\.5 quiet\) running 1/.test(a)) bad.push('quiet hours: 8 and 2 must show as targets 4 and 1 with the running counts: ' + a);
  if (!/total cap 5/.test(a)) bad.push('quiet total cap must be maxTotal x 0.5');
  if (!/max target 8 \(8\) running 0/.test(b) || !/pro target 2 \(2\)/.test(b) || !/total cap 10/.test(b)) bad.push('outside the quiet window the targets are the full counts: ' + b);
  if (!/no FILL_WORKERS_PRO switch/.test(c)) bad.push('an account without a switch must say so');
  if (!/acctPlanLine\(R, env, Date\.now\(\), by\)/.test(go)) bad.push('go.mjs status does not print the per-account line');
  if (!/FILL_WORKERS_<ACCOUNT>[\s\S]{0,400}fill per account/.test(run)) bad.push('RUN.md lost the warning that the shape line is only the shared pool');
  return bad;
};
const BREAKS = [
  ['factor ignored', (fn) => (c, e, n, r) => fn(c, e, 0, r), GO, RUN],
  ['switch ignored', (fn) => (c, e, n, r) => fn(c, {}, n, r), GO, RUN],
  ['running dropped', (fn) => (c, e, n, r) => fn(c, e, n, {}), GO, RUN],
  ['status does not print it', (fn) => fn, GO.replace('acctPlanLine(R, env, Date.now(), by)', "'x'"), RUN],
  ['RUN.md warning gone', (fn) => fn, GO, RUN.replace('fill per account', 'fill x')],
];
const real = verdict(acctPlanLine, GO, RUN); let caught = 0;
for (const [n, mk, go, run] of BREAKS) { if (verdict(mk(acctPlanLine), go, run).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`acctplancheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
