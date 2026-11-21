#!/usr/bin/env node
// phonebugscheck.mjs - #7808: the Bugs tab model. Drives the real bugs.js with a fixture GraphQL answer.
// Breaks: wrong state for a held branch, dan not first, Depends-on not detected, > 1 request per refresh (cap 5), closed-yesterday shown as Landed.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const P = join(dirname(fileURLToPath(import.meta.url)), 'phone-web'), rd = (f) => readFileSync(join(P, f), 'utf8');
const SRC = rd('bugs.js'), NOW = Date.parse('2026-10-16T12:00:00Z'), H = (h) => new Date(NOW - h * 36e5).toISOString();
const lab = (...n) => ({ nodes: n.map((name) => ({ name })) }), cm = (b) => ({ totalCount: b ? 1 : 0, nodes: b ? [{ body: b }] : [] });
const iss = (number, labels, o = {}) => ({ number, title: 't' + number, body: '', createdAt: H(100 - number), updatedAt: H(1), state: 'OPEN', labels: lab(...labels), milestone: o.ms || null, assignees: { nodes: [] }, comments: cm(o.c), ...o });
const FIX = { data: { rateLimit: { remaining: 4000 }, repository: {
  open: { nodes: [iss(1, []), iss(2, ['severe']), iss(3, ['dan']), iss(4, [], { body: 'Depends on: #1' }), iss(5, [], { body: 'Depends on: #99' }), iss(6, ['blocked']), iss(7, []), iss(8, [])] },
  closed: { nodes: [iss(20, [], { closedAt: H(2), c: 'Try: open the Bugs tab' }), iss(21, [], { closedAt: H(30) })] },
  pullRequests: { nodes: [{ number: 100, title: 'x', headRefName: 'work/7-foo', labels: lab('land'), commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] } }, { number: 101, title: 'y', headRefName: 'work/8-bar', labels: lab(), commits: { nodes: [] } }] },
  refs: { nodes: [{ name: '1-held-one', target: { committedDate: H(0.5) } }, { name: '8-bar', target: { committedDate: H(1) } }, { name: '7-foo', target: { committedDate: H(1) } }] } } } };
async function run(src) {
  const f = [], ok = (c, m) => { if (!c) f.push(m); };
  const g = { REPO: 'o/r', UI: { E: String, Chip: (s, t) => t, EmptyState: String, ErrorState: String, Skeleton: String, BottomSheet() {} }, Tabs: { counts: {} } };
  const B = new Function('REPO', 'UI', 'Tabs', 'module', src.replace(/if \(typeof module[\s\S]*$/, '') + '\nreturn Bugs;')(g.REPO, g.UI, g.Tabs);
  const rows = B.model(FIX.data.repository, NOW), st = (n) => (rows.find((r) => r.n === n) || {}).state;
  ok(st(1) === 'working' && rows.find((r) => r.n === 1).mins === 30, 'held branch is not Working with minutes since push');
  ok(st(8) === 'working', '#8 held branch (PR without land) should be Working');
  ok(st(7) === 'review', 'open land PR is not In review');
  ok(st(4) === 'blocked', 'unmet Depends on not detected as Blocked');
  ok(st(5) !== 'blocked', 'Depends on a closed/unknown issue treated as unmet');
  ok(st(6) === 'blocked', 'label blocked not Blocked');
  ok(st(2) === 'waiting', 'idle issue not Waiting');
  ok(st(20) === 'landed' && rows.find((r) => r.n === 20).tryLine === 'open the Bugs tab', 'closed in 24 h is not Landed with its try-line');
  ok(st(21) === undefined, 'closed yesterday shown as Landed');
  const order = rows.filter((r) => r.state !== 'landed').map((r) => r.n); ok(order[0] === 3 && order[1] === 2, 'dan first, then severe');
  ok(rows[rows.length - 1].state === 'landed', 'landed rows not last');
  ok(B.filter(rows, { q: '#4' }).length === 1 && B.filter(rows, { dan: true }).length === 1 && B.filter(rows, { state: 'blocked' }).length === 2, 'filters wrong');
  ok(B.counts(rows).blocked === 2 && B.counts(rows).dan === 1, 'counts wrong');
  let n = 0; const post = async () => { n++; return FIX; };
  await B.load(post, NOW, true); await B.load(post, NOW + 1000); await B.load(post, NOW + 59000);
  ok(n <= 5 && n === 1, `${n} requests for one refresh + cached reads (must be 1, cap 5)`);
  await B.load(post, NOW + 61000); ok(n === 2, 'cache does not expire after 60 s');
  ok(B.plainText('# Hi **there** [a](http://x) ```code```') === 'Hi there a', 'markdown not stripped');
  return f;
}
const rep = (a, b) => () => { if (!SRC.includes(a)) throw new Error('no such text: ' + a); return SRC.replace(a, b); };
const BR = [
  ['held branch not Working', rep("else if (h) state = 'working';", '')],
  ['dan not first', rep('(b.labels.includes(\'dan\') - a.labels.includes(\'dan\')) || ', '')],
  ['Depends on not detected', rep('|| d.length) state', ') state')],
  ['Depends on closed issue counts', rep('.filter((x) => openN.has(x))', '')],
  ['request per refresh not cached', rep('now - S.at < TTL) return', 'false) return')],
  ['closed yesterday is Landed', rep('now - Date.parse(i.closedAt) < 864e5', 'true')],
  ['land PR not In review', rep("if (pr) { state", "if (false) { state")],
  ['markdown kept', rep('.replace(/[#*_`>~|]/g, \'\')', '')],
];
const fails = await run(SRC); for (const m of fails) console.log('FAIL: ' + m);
let caught = 0; for (const [name, fn] of BR) { let r; try { r = await run(fn()); } catch (e) { console.log('NO-OP BREAK: ' + name + ' ' + e.message); continue; } if (r.length) caught++; else console.log('NOT CAUGHT: ' + name); }
console.log(`phonebugscheck: ${fails.length ? fails.length + ' FAILURES, ' : ''}${caught} breaks caught (of ${BR.length})`);
process.exit(fails.length || caught < BR.length ? 1 : 0);
