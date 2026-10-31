// tools/noclaimreleasecheck.mjs - 11 Oct (Dan: "fix it immediately and permanently"): a worker that found nothing to claim held the whole fill 20 min even after the
// commander refilled the queue (16:31Z hold, issues filed 16:33Z, 0 workers until 16:52Z). route.mjs noClaimReleased + brain.mjs fillReserve must release the hold. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import { noClaimReleased } from './brain/route.mjs';
const BRAIN = readFileSync(new URL('./brain/brain.mjs', import.meta.url), 'utf8');
const M = Date.parse('2026-10-11T16:31:00Z'), mk = (o) => ({ number: 1, created_at: '2026-10-11T16:33:00Z', labels: [{ name: 'bug' }], ...o });
const verdict = (fn, src) => {
  const bad = [];
  if (!fn(M, [mk({})])) bad.push('an issue created after the marker must release the hold');
  if (fn(M, [mk({ created_at: '2026-10-11T16:20:00Z' })])) bad.push('an issue older than the marker must not release it');
  if (fn(M, [mk({ pull_request: {} })])) bad.push('a PR must not release it');
  for (const l of ['bus', 'tracking', 'blocked', 'ask-dan']) if (fn(M, [mk({ labels: [{ name: l }] })])) bad.push(l + ' issues must not release it');
  if (fn(M, []) || fn(M, null)) bad.push('no issues = still held');
  if (!/noClaimReleased\(noClaimAt\(a\.name\), fresh\)\) \{ rmSync\(P\('noclaim-' \+ a\.name\)/.test(src)) bad.push('brain.mjs fillReserve does not release a held pool');
  if (!/const held = [\s\S]{0,1500}const CFGH = /.test(src)) bad.push('the release must run before the held pools are filtered out');
  return bad;
};
const BREAKS = [
  ['always held', () => () => false, BRAIN],
  ['always released', () => () => true, BRAIN],
  ['old issues release', () => (m, is) => (is || []).some((i) => !i.pull_request), BRAIN],
  ['PRs release', () => (m, is) => (is || []).some((i) => Date.parse(i.created_at) > m), BRAIN],
  ['bus posts release', () => (m, is) => (is || []).some((i) => !i.pull_request && Date.parse(i.created_at) > m && !(i.labels || []).some((l) => ['tracking', 'blocked', 'ask-dan'].includes(l.name))), BRAIN],
  ['fillReserve never releases', (f) => f, BRAIN.replace("rmSync(P('noclaim-' + a.name), { force: true });", '')],
  ['release runs after the filter', (f) => f, BRAIN.replace('const held = (C.accounts', 'const held2 = (C.accounts')],
];
const real = verdict(noClaimReleased, BRAIN); let caught = 0;
for (const [n, mkf, src] of BREAKS) { if (verdict(mkf(noClaimReleased), src).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`noclaimreleasecheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
