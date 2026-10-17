// autorebasefamilycheck - #8198: hot-file PR families are released in waves; sibling-caused bounces count 0.
import { families, decide, siblingCaused, MAX_BOUNCES } from './infra/autorebase.mjs';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
function run(brk) {
  const bad = [];
  const mk = (n, f = 'src/a.js') => ({ number: n, created_at: new Date(1e12 + n * 1000).toISOString(), files: [{ filename: f, status: 'modified' }, { filename: 'tools/stages.d/x' + n + '.json', status: 'modified' }, { filename: 'tools/new' + n + '.mjs', status: 'added' }] });
  let prs = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => mk(n));
  let f = families(prs);
  if (brk === 1) f = { active: new Set(prs.map((p) => p.number)), queued: new Map() };   // break: no family limit
  if (![1, 2, 3].every((n) => f.active.has(n))) bad.push('oldest 3 active');
  if (f.active.size !== 3) bad.push('only 3 active');
  if ([...(f.queued.get(4) || [])].join() !== '1,2,3') bad.push('4 queued behind 1 2 3');
  f = families(prs.filter((p) => p.number !== 1));
  if (!f.active.has(4)) bad.push('4th releases when one merges');
  if (families(prs.slice(0, 2)).queued.size) bad.push('<3 PRs is no family');
  const cm = [], t0 = 1e12; const L = (i) => ({ body: '**Lander:** conflicts with master', created_at: new Date(t0 + i).toISOString() });
  const comments = [L(10), { body: 'w', created_at: new Date(t0 + 20).toISOString() }, L(30), { body: 'w', created_at: new Date(t0 + 40).toISOString() }, L(50)];
  const d = (m) => decide({ pr: { labels: [], mergeable: false }, issue: { state: 'open', labels: [] }, comments, now: t0 + 100, siblingMerges: brk === 2 ? [] : m });
  if (d([]) !== 'block') bad.push('3 plain bounces block');
  if (d([t0 + 45]) !== 'none') bad.push('sibling-caused bounce counts 0');
  return bad;
}
const base = run(0); ok(!base.length, 'rules: ' + base.join('; '));
let caught = 0; for (const b of [1, 2]) if (run(b).length) caught++;
ok(caught === 2, 'breaks not caught');
console.log(fails ? 'autorebasefamilycheck FAILED' : `6 assertions, 0 failures, ${caught} breaks caught`);
process.exit(fails ? 1 : 0);
