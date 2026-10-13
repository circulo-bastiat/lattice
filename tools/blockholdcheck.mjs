#!/usr/bin/env node
// blockholdcheck.mjs - #6663: a `blocked` issue that others depend on must not deadlock the queue. heldByBlocked counts who
// waits on a blocked issue through Depends-on chains; unblockDue picks the ones the brain unblocks (20+ held, once per 6 h);
// the brain health pass is wired to both. Then anti-vacuity: broken versions must each fail a case.
import { readFileSync } from 'node:fs';
import { heldByBlocked, unblockDue } from './brain/route.mjs';
const I = (number, deps = [], blocked = false) => ({ number, body: deps.length ? `x\n\nDepends on: ${deps.map((d) => '#' + d).join(', ')}\n` : 'x', labels: blocked ? [{ name: 'blocked' }] : [] });
const H = 3600e3, N = Date.parse('2026-10-13T02:00:00Z');
function cases(held, due) {
  const bad = [], t = (n, c) => { let r = false; try { r = !!c(); } catch {} if (!r) bad.push(n); };
  const get = (r, n) => (r.find((x) => x.n === n) || { holds: 0 }).holds;
  // chain 3 <- 2 <- 1 (1 blocked): 2 and 3 wait on it
  t('a chain counts every issue behind the blocked one', () => get(held([I(1, [], true), I(2, [1]), I(3, [2])]), 1) === 2);
  t('an unblocked dependency holds nothing', () => held([I(1), I(2, [1]), I(3, [2])]).length === 0);
  t('a closed (absent) dependency holds nothing', () => held([I(2, [99]), I(3, [2])]).length === 0);
  t('a cycle terminates and still counts', () => get(held([I(1, [3], true), I(2, [1]), I(3, [2])]), 1) === 2);
  t('two blocked roots are both counted', () => { const r = held([I(1, [], true), I(5, [], true), I(2, [1, 5])]); return get(r, 1) === 1 && get(r, 5) === 1; });
  t('a wide fan of 25 is counted', () => get(held([I(1, [], true), ...Array.from({ length: 25 }, (_, k) => I(10 + k, [1]))]), 1) === 25);
  const big = [{ n: 1, holds: 341 }], small = [{ n: 2, holds: 3 }];
  t('20+ held is unblocked', () => due(big, {}, N).length === 1);
  t('a small holder is not', () => due(small, {}, N).length === 0);
  t('not twice within 6 h', () => due(big, { 1: N - 2 * H }, N).length === 0);
  t('again after 6 h', () => due(big, { 1: N - 7 * H }, N).length === 1);
  return bad;
}
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const b = cases(heldByBlocked, unblockDue); ok(!b.length, 'cases: ' + b.join('; '));
const brain = readFileSync(new URL('./brain/brain.mjs', import.meta.url), 'utf8'), route = readFileSync(new URL('./brain/route.mjs', import.meta.url), 'utf8');
ok(/heldByBlocked\(open\)/.test(brain) && /unblockDue\(held, h1\.unblocked, now\)/.test(brain) && /labels\/blocked`/.test(brain), 'wired: brain health unblocks via heldByBlocked/unblockDue');
ok(/blocked-holds:\$\{x\.n\}/.test(route), 'wired: a blocked-holds finding mails the commander');
const directOnly = (iss) => { const r = new Map(); const by = new Map(iss.map((i) => [i.number, i])); for (const i of iss) for (const m of (i.body.match(/#(\d+)/g) || []).map((x) => +x.slice(1))) { const d = by.get(m); if (d && d.labels.length) r.set(m, (r.get(m) || 0) + 1); } return [...r].map(([n, holds]) => ({ n, holds })); };
for (const [name, h, d] of [['direct dependents only', directOnly, unblockDue], ['never unblocks', heldByBlocked, () => []], ['no 6-h limit', heldByBlocked, (x) => x.filter((y) => y.holds >= 20)], ['unblocks every holder', heldByBlocked, (x) => x]]) {
  const c = cases(h, d).length > 0; ok(c, `break "${name}" must be caught`); if (c) { breaks++; console.log(`  ✓ break "${name}" caught`); }
}
console.log(`blockholdcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
