// tools/stalecheck.mjs - #8887: fails when a producer named in tools/staleness.mjs has not written in 3x its period.
// On the full suite a failure opens a RED issue "STALE <producer>" (the check prints that title).
import { all, judge, PERIODS } from './staleness.mjs';
import { findUnder } from './infra/gh.mjs';
const ROOT = new URL('..', import.meta.url).pathname, now = Date.now();
let fail = 0; const out = [];
for (const j of all(ROOT, now, findUnder)) { out.push(j.line); if (j.dead && process.env.FULL_MODE) { fail = 1; out.push(`FAIL RED title: STALE ${j.name}`); } }
// anti-vacuity: a producer silent for 3x+ must be dead, a fresh one must not, a never-written one must be dead
let caught = 0, bad = 0;
for (const n of Object.keys(PERIODS)) {
  const p = PERIODS[n] * 60e3;
  if (judge(n, now - 3.1 * p, now).dead) caught++; else bad++;
  if (judge(n, null, now).dead) caught++; else bad++;
  if (!judge(n, now - 0.5 * p, now).stale) caught++; else bad++;
}
// #9670: the producer's real output (metrics branch, MCLITE_USAGE) beats this host's files, and status passes it
{ const m = (o) => all('/nonexistent-root', now, () => null, o).find((j) => j.name === 'metrics');
  if (!m({ metrics: now - 60e3 }).stale && m({}).stale) caught++; else { bad++; console.log('FAIL all() ignores the override'); }
  const go = (await import('node:fs')).readFileSync(new URL('./go.mjs', import.meta.url), 'utf8');
  if (/S\.all\(ROOT, Date\.now\(\), findUnder, over\)/.test(go) && /branches\/metrics/.test(go) && /MCLITE_USAGE[^\n]*over\.usage = t/.test(go)) caught++; else { bad++; console.log('FAIL go.mjs status does not pass the producers\' real times (#9670)'); } }
if (bad) { fail = 1; console.log('FAIL judge broken'); }
console.log(`${caught} breaks caught`); out.forEach((l) => console.log(l)); process.exit(fail);
