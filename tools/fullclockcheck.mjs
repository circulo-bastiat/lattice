#!/usr/bin/env node
// fullclockcheck.mjs - #9180: GitHub drops the full suite's 2-hourly cron ticks, so the brain tick (its own clock) dispatches it when
// the newest run is over 130 min old. fullDispatchDue decides; the brain health pass and tick.sh are wired to it. Then anti-vacuity.
import { readFileSync } from 'node:fs';
import { fullDispatchDue } from './infra/runnerguard.mjs';
const N = Date.parse('2026-10-21T04:00:00Z'), M = 60e3;
const run = (minAgo, status = 'completed') => ({ created_at: new Date(N - minAgo * M).toISOString(), status });
function cases(due) {
  const bad = [], t = (n, c) => { let r = false; try { r = !!c(); } catch {} if (!r) bad.push(n); };
  t('a run 3 h old is overdue', () => due([run(180)], N) === true);
  t('a run 100 min old is not', () => due([run(100)], N) === false);
  t('no run ever is overdue', () => due([], N) === true);
  t('a run in progress blocks it', () => due([run(10, 'in_progress'), run(300)], N) === false);
  t('a queued run blocks it', () => due([run(10, 'queued'), run(300)], N) === false);
  t('FULL_MODE=off never dispatches', () => due([run(300)], N, { mode: 'off' }) === false);
  t('a disabled workflow never dispatches', () => due([run(300)], N, { state: 'disabled_manually' }) === false);
  t('not twice within 45 min', () => due([run(300)], N, { lastDispatch: N - 20 * M }) === false);
  t('again after 45 min', () => due([run(300)], N, { lastDispatch: N - 50 * M }) === true);
  t('the newest run counts, not the first listed', () => due([run(300), run(30)], N) === false);
  t('#9721: a run whose jobs were all skipped (a push) is no full run', () => due([{ ...run(30), conclusion: 'skipped' }, run(300)], N) === true);
  t('#9721: a cancelled run is no full run', () => due([{ ...run(30), conclusion: 'cancelled' }, run(300)], N) === true);
  return bad;
}
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const b = cases(fullDispatchDue); ok(!b.length, 'cases: ' + b.join('; '));
const brain = readFileSync(new URL('./brain/brain.mjs', import.meta.url), 'utf8'), tick = readFileSync(new URL('./brain/tick.sh', import.meta.url), 'utf8');
ok(/fullDispatchDue\(fr2, now/.test(brain) && /full-suite\.yml\/dispatches/.test(brain) && /lastFullDispatch/.test(brain), 'wired: the health pass dispatches the full suite when overdue');
ok(/FULL_MODE/.test(tick), 'wired: tick.sh passes FULL_MODE');
for (const [name, d] of [['counts skipped runs (#9721)', (r, n, o = {}) => fullDispatchDue((r || []).map((x) => ({ ...x, conclusion: 'success' })), n, o)], ['never dispatches', () => false], ['always dispatches', () => true], ['ignores a running run', (r, n, o = {}) => fullDispatchDue([], n, o)], ['ignores FULL_MODE=off', (r, n, o = {}) => fullDispatchDue(r, n, { ...o, mode: 'on' })], ['no 45-min gap', (r, n, o = {}) => fullDispatchDue(r, n, { ...o, lastDispatch: 0 })], ['uses the oldest run', (r, n, o = {}) => fullDispatchDue(r.slice().reverse().slice(0, 1), n, o)]]) {
  const c = cases(d).length > 0; ok(c, `break "${name}" must be caught`); if (c) { breaks++; console.log(`  ✓ break "${name}" caught`); }
}
console.log(`fullclockcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
