// tools/workertotalcapcheck.mjs - #8999 (Dan, 20 Oct: "make sure the cap doesn't reflect the old quantity"): the TOTAL worker ceiling follows where workers run.
// fill.maxTotal (10) is the brain VM's runner-slot count; on the mirror (WORKER_RUNNER=mirror) it is mirrorWorkerJobs x PACK_MAX. RUNS workerTotalCap, reservePlan and
// acctPlanLine; checks the wiring in brain.mjs and go.mjs. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import * as R from './brain/route.mjs';
import { PACK_MAX } from './infra/workerpack.mjs';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { brain: rd('./brain/brain.mjs'), go: rd('./go.mjs'), roles: rd('./brain/roles.json') };
const OUT = Date.parse('2026-10-11T19:00:00Z'), IN = Date.parse('2026-10-11T15:00:00Z');   // 15:00 and 11:00 New York (the quiet window halves)
const cfg = (fill = {}) => ({ accounts: [{ name: 'max', workers: 20 }], fill: { maxTotal: 10, mirrorWorkerJobs: 4, quiet: { tz: 'America/New_York', from: '08:00', to: '14:00', factor: 0.5 }, ...fill } });
function verdict(fn, S) {
  const bad = [], eq = (got, want, what) => { if (got !== want) bad.push(`${what}: got ${got}, want ${want}`); };
  eq(PACK_MAX, 4, 'workerpack PACK_MAX');
  eq(fn.workerTotalCap(cfg(), 'vm'), 10, 'vm: the runner-slot number');
  eq(fn.workerTotalCap(cfg(), undefined), 10, 'unset mode: the vm number (safe default)');
  eq(fn.workerTotalCap(cfg(), 'bogus'), 10, 'garbage mode: the vm number');
  eq(fn.workerTotalCap(cfg(), 'mirror'), 4 * PACK_MAX, 'mirror: 4 jobs x PACK_MAX');
  eq(fn.workerTotalCap(cfg({ mirrorWorkerJobs: 2 }), 'mirror'), 2 * PACK_MAX, 'mirror: mirrorWorkerJobs is read');
  eq(fn.workerTotalCap(cfg({ mirrorWorkerJobs: undefined }), 'mirror'), 4 * PACK_MAX, 'mirror without the setting: 4 jobs');
  eq(fn.workerTotalCap(cfg({ mirrorWorkerJobs: 0 }), 'mirror'), 4 * PACK_MAX, 'mirror with a nonsense 0: 4 jobs, never a cap of 0');
  eq(fn.workerTotalCap({ accounts: [], fill: {} }, 'vm'), undefined, 'no maxTotal: unlimited as before');
  const ask = (mode, now = OUT) => (fn.reservePlan(cfg(), now, {}, 0, null, null, {}, fn.workerTotalCap(cfg(), mode))[0] || { n: 0 }).n;
  eq(ask('vm'), 10, 'reservePlan vm: 20 asked, 10 allowed');
  eq(ask('mirror'), 16, 'reservePlan mirror: 20 asked, 16 allowed (not the VM 10)');
  eq(ask('mirror', IN), 8, 'reservePlan mirror in the quiet window: 16 x 0.5');
  eq((fn.reservePlan(cfg(), OUT, {}, 0, null, null, {})[0] || { n: 0 }).n, 10, 'reservePlan with no explicit cap = fill.maxTotal (old behaviour)');
  eq((fn.reservePlan(cfg(), OUT, {}, 14, null, null, {}, 16)[0] || { n: 0 }).n, 2, 'mirror: 14 running, 2 room left');
  const line = (mode) => fn.acctPlanLine(cfg(), {}, OUT, {}, mode);
  if (!/total cap 10(?!\d)/.test(line('vm')) || /follows the mirror/.test(line('vm'))) bad.push('status line vm: "total cap 10", no mirror note: ' + line('vm'));
  if (!/total cap 16 \(follows the mirror: 4 jobs x 4 workers, not the VM's 10 runner slots\)/.test(line('mirror'))) bad.push('status line mirror: ' + line('mirror'));
  if (!/total cap 10(?!\d)/.test(fn.acctPlanLine(cfg(), {}, OUT, {}))) bad.push('acctPlanLine without a mode must behave as vm');
  // wiring
  if (!/reservePlan\(CFGH, now, \w+, \w+, U, api, poolOpen, workerTotalCap\(CFGH, mode\)(, \w+)?\)/.test(S.brain)) bad.push('brain.mjs fillReserve does not pass workerTotalCap to reservePlan');
  if (!/const mode = runnerMode\(\(await gh\('GET', '\/repos\/\{repo\}\/actions\/variables\/WORKER_RUNNER'/.test(S.brain)) bad.push('brain.mjs fillReserve does not read WORKER_RUNNER');
  if (!/acctPlanLine\(R, env, Date\.now\(\), by, runnerMode\(wr && wr\.value\)\)/.test(S.go)) bad.push('go.mjs status does not pass the runner mode to acctPlanLine');
  let f; try { f = JSON.parse(S.roles).fill; } catch { return [...bad, 'roles.json is not valid JSON']; }
  if (!(f.mirrorWorkerJobs >= 1 && f.mirrorWorkerJobs <= 10)) bad.push('roles.json fill.mirrorWorkerJobs must be 1..10');
  if (f.maxTotal !== 10) bad.push('roles.json fill.maxTotal changed: the vm path must stay as it was');
  return bad;
}
const sub = (k, a, b) => (S) => { if (!S[k].includes(a)) throw new Error('break target missing: ' + a); return { ...S, [k]: S[k].replace(a, b) }; };
const BREAKS = [   // [name, mutate route functions or sources]
  ['mirror still the vm number', { fn: { ...R, workerTotalCap: (c) => (c.fill || {}).maxTotal } }],
  ['mirror ignores mirrorWorkerJobs', { fn: { ...R, workerTotalCap: (c, m) => (m === 'mirror' ? 4 * PACK_MAX : (c.fill || {}).maxTotal) } }],
  ['mirror cap 0 on nonsense', { fn: { ...R, workerTotalCap: (c, m) => (m === 'mirror' ? Number((c.fill || {}).mirrorWorkerJobs) * PACK_MAX : (c.fill || {}).maxTotal) } }],
  ['garbage mode is mirror', { fn: { ...R, workerTotalCap: (c, m) => (m ? R.workerTotalCap(c, 'mirror') : R.workerTotalCap(c, 'vm')) } }],
  ['reservePlan ignores the cap argument', { fn: { ...R, reservePlan: (c, n, r, t, u, a, p) => R.reservePlan(c, n, r, t, u, a, p) } }],
  ['reservePlan loses the old default', { fn: { ...R, reservePlan: (c, n, r, t, u, a, p, m) => R.reservePlan(c, n, r, t, u, a, p, m === undefined ? Infinity : m) } }],
  ['status line ignores the mode', { fn: { ...R, acctPlanLine: (c, e, n, r) => R.acctPlanLine(c, e, n, r) } }],
  ['status line hides the mirror note', { fn: { ...R, acctPlanLine: (c, e, n, r, m) => R.acctPlanLine(c, e, n, r, m).replace(/ \(follows the mirror[^)]*\)/, '') } }],
  ['brain does not pass the cap', { src: sub('brain', ', poolOpen, workerTotalCap(CFGH, mode), claimable)) {', ', poolOpen, claimable)) {') }],
  ['brain does not read the runner', { src: sub('brain', "const mode = runnerMode((await gh('GET', '/repos/{repo}/actions/variables/WORKER_RUNNER'", "const mode = runnerMode((await gh('GET', '/repos/{repo}/actions/variables/NOPE'") }],
  ['status does not pass the mode', { src: sub('go', 'by, runnerMode(wr && wr.value)', 'by') }],
  ['roles.json no setting', { src: (S) => ({ ...S, roles: S.roles.replace('"mirrorWorkerJobs": 4,', '') }) }],
  ['roles.json vm cap changed', { src: (S) => ({ ...S, roles: S.roles.replace('"maxTotal": 10', '"maxTotal": 16') }) }],
];
const real = verdict(R, SRC); let caught = 0;
for (const [n, o] of BREAKS) { let S = SRC; try { if (o.src) S = o.src(SRC); } catch (e) { console.log(' BAD BREAK:', n, e.message); continue; } if (verdict(o.fn || R, S).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`workertotalcapcheck: ${real.length} failed; ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
