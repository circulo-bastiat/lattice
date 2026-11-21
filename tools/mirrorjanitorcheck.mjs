#!/usr/bin/env node
// mirrorjanitorcheck.mjs - #9709: stale result branches on the public mirror are deleted (r/ p/ t/ f/, older than 12 h, oldest first, at most 60 per pass),
// nothing else is touched (main, a fresh run's branches), and the brain health pass calls it at most hourly. Breaks: no age test, no prefix test, no cap, no wiring.
import { readFileSync } from 'node:fs';
import { planJanitor, runJanitor } from './infra/mirrorjanitor.mjs';
const NOW = Date.parse('2026-10-22T21:00:00Z'), H = 3600e3, iso = (t) => new Date(t).toISOString();
let asserts = 0, fails = 0, breaks = 0; const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const refs = [{ name: 'r/a.1', date: iso(NOW - 20 * H) }, { name: 'p/b', date: iso(NOW - 13 * H) }, { name: 't/c', date: iso(NOW - 1 * H) }, { name: 'main', date: iso(NOW - 900 * H) }, { name: 'f/d', date: iso(NOW - 100 * H) }];
const cases = (plan) => { const bad = []; const t = (n, c) => { let v = false; try { v = !!c(); } catch { v = false; } if (!v) bad.push(n); };
  t('old result branches go, oldest first', () => plan(refs, NOW, 60).join() === 'f/d,r/a.1,p/b');
  t('a branch younger than 12 h stays (a run may still use it)', () => !plan(refs, NOW, 60).includes('t/c'));
  t('main and other branches are never touched', () => !plan(refs, NOW, 60).includes('main'));
  t('at most cap per pass', () => plan(refs, NOW, 2).length === 2);
  return bad; };
const real = cases(planJanitor); ok(real.length === 0, 'planJanitor: ' + real.join('; '));
for (const [n, f] of [['no age test', (r, now, cap) => r.filter((x) => /^[rptf]\//.test(x.name)).slice(0, cap).map((x) => x.name)], ['no prefix test', (r, now, cap) => planJanitor(r.map((x) => ({ ...x, name: x.name === 'main' ? 'r/main' : x.name })), now, cap).map((x) => x.replace('r/main', 'main'))], ['no cap', (r, now) => planJanitor(r, now, 999)]]) {
  const b = cases(f); ok(b.length > 0, `cases cannot tell "${n}"`); if (b.length) { breaks++; console.log(`  ✓ "${n}" caught: ${b[0]}`); } }
{ const calls = []; const fetchFn = async (u, o) => { calls.push(o.method + ' ' + u.replace('https://api.github.com', ''));
    if (u.endsWith('/graphql')) { const p = JSON.parse(o.body).variables.p; const nodes = p === 'refs/heads/r/' ? [{ name: 'old.1', target: { committedDate: iso(NOW - 30 * H) } }, { name: 'new.1', target: { committedDate: iso(NOW - H) } }] : []; return { json: async () => ({ data: { repository: { refs: { nodes, pageInfo: { hasNextPage: false } } } } }) }; }
    return { status: 204 }; };
  const r = await runJanitor({ repo: 'o/lattice', token: 't', now: NOW, fetchFn });
  ok(r.deleted === 1 && calls.filter((c) => c.startsWith('DELETE')).join() === 'DELETE /repos/o/lattice/git/refs/heads/r/old.1', 'runJanitor deletes exactly the stale ref'); }
const B = readFileSync(new URL('./brain/brain.mjs', import.meta.url), 'utf8'), W = /now - \(hj\.lastJanitor \|\| 0\) > 3600e3\)[\s\S]{0,400}runJanitor\(\{ repo: process\.env\.MIRROR_REPO/;
ok(W.test(B), 'the health pass runs the janitor at most hourly'); if (!W.test(B.replace('runJanitor({ repo: process.env.MIRROR_REPO', 'x({'))) { breaks++; console.log('  ✓ the janitor wiring removed is caught'); }
console.log(`mirrorjanitorcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
