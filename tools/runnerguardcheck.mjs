#!/usr/bin/env node
// runnerguardcheck.mjs - #3568: envFault() separates a broken runner from a broken master; quarantine/restore call the right
// API; full.mjs/go.mjs/brain/smoke are wired to them. Then anti-vacuity: broken guards must each fail a case.
import { readFileSync } from 'node:fs';
import { fullStale } from './infra/runnerguard.mjs';
import { envFault, isLastGpu, quarantine, restore, smokePassed, faultTitle, FAULT_LABEL } from './infra/runnerguard.mjs';
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const ids = (n, p = 'x') => Array.from({ length: n }, (_, i) => p + i);

function cases(guard) {
  const bad = [], t = (n, c) => { let r = false; try { r = !!c(); } catch {} if (!r) bad.push(n); };
  t('one ordinary red is code', () => guard({ failed: ['cullcheck'], ran: 800 }) === null);
  t('no failures is fine', () => guard({ failed: [], ran: 800 }) === null);
  t('16 NEW failures is a fault', () => !!guard({ failed: ids(16), ran: 800, prev: [] }));
  t('15 spread new failures is code', () => guard({ failed: ids(15), ran: 800, prev: [] }) === null);
  t('over 10% new is a fault', () => !!guard({ failed: ids(9), ran: 60, prev: [] }));
  t('17 failures all known from the last run is code', () => guard({ failed: ids(17), ran: 800, prev: ids(17) }) === null);
  t('17 known + 1 new is code', () => guard({ failed: ids(18), ran: 800, prev: ids(17) }) === null);
  t('no baseline: a big count alone is not a fault', () => guard({ failed: ids(40), ran: 800 }) === null);
  t('a first pack-* failure is a fault', () => !!guard({ failed: ['pack-entities', 'cullcheck'], ran: 800, prev: [] }));
  t('a known pack-* failure first is not a fault', () => guard({ failed: ['pack-entities', 'cullcheck'], ran: 800, prev: ['pack-entities'] }) === null);
  t('a later pack-* failure alone is code', () => guard({ failed: ['cullcheck', 'pack-mobs'], ran: 800, prev: [] }) === null);
  t('a missing ledger is a fault', () => !!guard({ failed: ['suite-ledger-missing'], ran: 0 }));
  t('the same mass failure twice is code (#6627)', () => guard({ failed: ids(41), ran: 800, prev: [], prevFault: ids(41) }) === null);
  t('a different mass failure after a fault is still a fault', () => !!guard({ failed: ids(41, 'y'), ran: 800, prev: [], prevFault: ids(41) }));
  return bad;
}
let fails = 0, asserts = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const bad = cases(envFault); ok(!bad.length, 'envFault: ' + bad.join('; '));

// API calls, against a fake gh
const calls = [];
const fake = async (m, p, b) => { calls.push(`${m} ${p}`);
  if (p.includes('actions/runners?')) return { runners: [{ name: 'DADS', id: 34, labels: [{ name: 'mclite' }, { name: 'gpu' }, { name: 'express' }] }] };
  if (p.includes('issues?')) return [{ number: 9, title: faultTitle('DADS') }];
  return {}; };
await quarantine(fake, 'DADS');
ok(calls.includes('DELETE /repos/{repo}/actions/runners/34/labels/gpu') && calls.includes('DELETE /repos/{repo}/actions/runners/34/labels/express'), 'quarantine deletes gpu and express');
calls.length = 0; await restore(fake, 'DADS', ['gpu']);
ok(calls.includes('POST /repos/{repo}/actions/runners/34/labels') && calls.includes('PATCH /repos/{repo}/issues/9'), 'restore adds the label and closes the fault issue');

calls.length = 0; await smokePassed(fake, 'DADS');
ok(calls.includes('POST /repos/{repo}/issues/9/labels') && !calls.some((c) => c.includes('actions/runners/34')), 'smokePassed marks the issue and never writes a runner label (github.token 403)');

const two = async () => ({ runners: [{ name: 'A', id: 1, status: 'online', labels: [{ name: 'gpu' }] }, { name: 'B', id: 2, status: 'online', labels: [{ name: 'gpu' }] }] });
const one = async () => ({ runners: [{ name: 'A', id: 1, status: 'online', labels: [{ name: 'gpu' }] }, { name: 'B', id: 2, status: 'offline', labels: [{ name: 'gpu' }] }] });
ok(!(await isLastGpu(two, 'A')) && await isLastGpu(one, 'A') && !(await isLastGpu(one, 'B')), 'isLastGpu: only the sole online gpu runner');
// #6627: the sole gpu runner OFFLINE is still the last (an offline blip once lost the only gpu label for 21 h)
const off = async () => ({ runners: [{ name: 'A', id: 1, status: 'offline', labels: [{ name: 'gpu' }] }, { name: 'B', id: 2, status: 'online', labels: [{ name: 'express' }] }] });
ok(await isLastGpu(off, 'A'), 'isLastGpu: an offline sole gpu runner is still the last');
{ // break: the old online-only count must fail the offline case
  const old = async (gh, name) => { const g = (await gh()).runners.filter((r) => r.labels.some((l) => l.name === 'gpu') && r.status === 'online'); return g.length <= 1 && g.some((r) => r.name === name); };
  ok(!(await old(off, 'A')), 'the online-only isLastGpu must be caught by the offline case');
  if (!(await old(off, 'A'))) { console.log('  ✓ "online-only isLastGpu" fails the offline case'); }
}
// #6627 fullStale: cancelled/pending runs are no result; the reason names a missing gpu label
{ const N = Date.parse('2026-10-13T01:00:00Z'), H = 3600e3, run = (h, c, s = 'completed') => ({ status: s, conclusion: c, updated_at: new Date(N - h * H).toISOString() });
  const R = [{ name: 'PC', status: 'online', labels: ['mclite'] }], G = [{ name: 'PC', status: 'online', labels: ['gpu'] }];
  const real = fullStale, brk = { 'counts cancelled runs': (runs, r, n) => (n - Date.parse(runs[0].updated_at) < 6 * H ? null : 'x'), 'never stale': () => null };
  const cs = (f) => [f([run(1, 'cancelled'), run(2, 'cancelled'), run(21, 'failure')], R, N)?.includes('NO runner has the gpu label'), f([run(1, 'success')], G, N) === null, !!f([run(1, null, 'queued'), run(30, 'success')], G, N)];
  ok(cs(real).every(Boolean), 'fullStale: 21 h of cancelled runs is stale and names the missing gpu label; a fresh result is not');
  for (const [k, f] of Object.entries(brk)) { const b = !cs(f).every(Boolean); ok(b, `fullStale break "${k}" must be caught`); if (b) console.log(`  ✓ fullStale break "${k}" caught`); }
  ok(/fullStale\(fr/.test(src('brain/brain.mjs')), 'wired: brain health mails a stale full suite');
}
// wiring: each caller really uses the guard
const full = src('infra/full.mjs'), go = src('go.mjs'), brain = src('brain/brain.mjs'), smoke = src('infra/smoke.mjs');
const wired = {
  // #6750: a full-suite workflow Dan disabled on purpose must not wake a fixer + commander every 6 h
  'brain fullStale skips a disabled full-suite workflow': /workflows\/full-suite\.yml'\)[^\n]*\?\.state/.test(brain) && /wfState !== 'active' \? null/.test(brain),
  'full.mjs skips RED issues on a fault': !/quarantine\(gh|isLastGpu|restore\(gh/.test(full) && /prev/.test(full) && /ledger && !fault\) await applyRedIssues/.test(full) && /to: \$\{to\}/.test(full),
  'go.mjs has runner list/quarantine/restore + queue skips env-fault': /async function runner/.test(go) && /lab\(i, 'env-fault'\)/.test(go),
  'brain health quarantines + dispatches smoke': /quarantine\(gh, r\.name\)/.test(brain) && /restore\(gh, r\.name/.test(brain) && /isLastGpu\(gh, r\.name/.test(brain) && /smoke\.yml/.test(brain),
  'smoke restores only after a clean run': /if \(!ok\)[^\n]*process\.exit\(1\)[\s\S]*smokePassed\(gh/.test(smoke) && !/restore\(gh|quarantine\(gh/.test(smoke + full),
  'smoke.yml exists without a gpu label': !/gpu\]/.test(src('../.github/workflows/smoke.yml').replace(/#.*/g, '')),
  'RUN.md documents go.mjs runner': /go\.mjs runner/.test(src('../RUN.md')),
};
for (const [k, v] of Object.entries(wired)) ok(v, 'wired: ' + k);

let breaks = 0;
for (const [name, g] of [['never faults', () => null], ['always faults', () => 'x'], ['ignores the count', (x) => (/^pack-/.test(x.failed[0] || '') ? 'x' : null)], ['counts known reds', (x) => (x.failed.length > 15 ? 'x' : null)], ['ignores prevFault', (x) => envFault({ ...x, prevFault: null })], ['ignores setup stages', (x) => (x.failed.length > 15 && x.prev ? 'x' : null)]]) {
  const b = cases(g); ok(b.length > 0, `the cases cannot tell "${name}" from the real guard`);
  if (b.length) { breaks++; console.log(`  ✓ "${name}" fails ${b.length} case(s): ${b.slice(0, 2).join(' | ')}`); }
}
const w = Object.keys(wired).length; breaks++; console.log(`  ✓ wiring checks: ${w} (a wiring regex failing is a hard FAIL above)`);
console.log(`runnerguardcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
