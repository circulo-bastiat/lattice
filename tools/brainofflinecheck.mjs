#!/usr/bin/env node
// brainofflinecheck.mjs - #2893: brainOffline() alerts when EVERY brain runner has been offline over 15 min; vm-setup.sh keeps a fallback DNS.
import { readFileSync } from 'node:fs';
import { brainOffline } from './infra/runnerguard.mjs';
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const M = 60e3, N = Date.parse('2026-10-05T10:00:00Z');
const R = (st, n = 3) => Array.from({ length: n }, (_, i) => ({ name: `brain-${i}`, status: st[i] || st[0], labels: ['brain'] }));
const all = (t) => Object.fromEntries([0, 1, 2].map((i) => [`brain-${i}`, t]));
function cases(f) {
  const bad = [], t = (n, c) => { let r = false; try { r = !!c(); } catch {} if (!r) bad.push(n); };
  t('all online: no alert, empty since', () => { const x = f(R(['online']), N, {}); return !x.alert && !Object.keys(x.since).length; });
  t('first sighting offline: no alert, remembered', () => { const x = f(R(['offline']), N, {}); return !x.alert && x.since['brain-0'] === N; });
  t('offline 14 min: no alert', () => !f(R(['offline']), N, all(N - 14 * M)).alert);
  t('offline 16 min: alert', () => /16 min/.test(f(R(['offline']), N, all(N - 16 * M)).alert || ''));
  t('one runner online: no alert', () => !f(R(['online', 'offline', 'offline']), N, all(N - 60 * M)).alert);
  t('a runner back online is forgotten', () => !('brain-0' in f(R(['online', 'offline', 'offline']), N, all(N - 60 * M)).since));
  t('a runner that only just went offline holds the alert', () => !f(R(['offline']), N, { ...all(N - 60 * M), 'brain-2': N - 5 * M }).alert);
  t('non-brain runners ignored', () => !f([{ name: 'PC', status: 'offline', labels: ['gpu'] }], N, {}).alert);
  return bad;
}
let fails = 0, breaks = 0;
const bad = cases(brainOffline); if (bad.length) { fails++; console.log('  FAIL ' + bad.join('; ')); }
for (const [n, g] of [['never alerts', (r, now, s) => ({ since: s, alert: null })], ['always alerts', (r, now, s) => ({ since: s, alert: 'x' })],
  ['no memory', (r, now, s) => brainOffline(r, now, {})], ['any runner offline', (r, now, s) => { const x = brainOffline(r, now, s); return { since: x.since, alert: Object.keys(x.since).length ? 'x' : null }; }]]) {
  const b = cases(g); if (!b.length) { fails++; console.log(`  FAIL cases cannot tell "${n}" from the real check`); } else { breaks++; console.log(`  ✓ "${n}" fails ${b.length} case(s)`); }
}
const w = { 'brain.mjs calls brainOffline and mails': /brainOffline\(/.test(src('brain/brain.mjs')) && /brainOfflineAt/.test(src('brain/brain.mjs')),
  'vm-setup writes fix.conf with a public DNS': /resolved\.conf\.d\/fix\.conf/.test(src('brain/vm-setup.sh')) && /1\.1\.1\.1/.test(src('brain/vm-setup.sh')) };
for (const [k, v] of Object.entries(w)) { if (!v) { fails++; console.log('  FAIL wired: ' + k); } }
breaks++;
console.log(`brainofflinecheck: ${8 + 2} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
