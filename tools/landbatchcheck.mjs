#!/usr/bin/env node
// landbatchcheck.mjs - #5760: the merge-train lander (tools/infra/landbatch.mjs + land.mjs).   node tools/landbatchcheck.mjs
// 1. pickBatch cases   2. mergeBatch in a REAL git repo: clean PRs all merge, a conflicting PR is left out and the tree is clean, a list-only
// conflict is finished by the resolver   3. land.mjs source guards (the fallbacks the design depends on)
// 4. anti-vacuity: a merger that never aborts, one that takes the conflicting PR, and a pickBatch that ignores the back-off must each FAIL the cases.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickBatch, mergeBatch, failedIds, suspects, halves } from './infra/landbatch.mjs';

for (const k of ['AUTHOR', 'COMMITTER']) { process.env[`GIT_${k}_NAME`] = 't'; process.env[`GIT_${k}_EMAIL`] = 't@t'; }
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 1. pickBatch ──
const picks = (pb) => [
  ['takes the first B in queue order', () => JSON.stringify(pb([1, 2, 3, 4, 5, 6], 4, 0)) === '[1,2,3,4]'],
  ['a short queue is taken whole when it has 2+', () => JSON.stringify(pb([7, 8], 4, 0)) === '[7,8]'],
  ['one queued PR is the single path', () => pb([9], 4, 0).length === 0],
  ['size 0 and 1 switch batching off', () => pb([1, 2, 3], 0, 0).length === 0 && pb([1, 2, 3], 1, 0).length === 0],
  ['after a red batch the back-off holds the batch off', () => pb([1, 2, 3], 4, 3).length === 0],
  ['back-off at 0 batches again', () => pb([1, 2, 3], 4, 0).length === 3],
];
for (const [name, f] of picks(pickBatch)) ok(f(), 'pickBatch: ' + name);
for (const [name, bad] of [['ignores the back-off', (q, s) => (s >= 2 && q.length >= 2 ? q.slice(0, s) : [])], ['batches one PR', (q, s, o) => (s >= 2 && !o ? q.slice(0, s) : [])]]) {
  const caught = picks(bad).some(([, f]) => !f());
  ok(caught, `anti-vacuity: a pickBatch that ${name} is caught`); if (caught) breaks++;
}

// ── 2. mergeBatch in a real repo ──
const sh = (cwd) => (c, a) => spawnSync(c, a, { cwd, encoding: 'utf8' });
function repo() {
  const d = mkdtempSync(join(tmpdir(), 'landbatch-')), g = sh(d);
  g('git', ['init', '-q', '-b', 'master']); g('git', ['config', 'core.autocrlf', 'false']);
  const put = (f, t) => writeFileSync(join(d, f), t);
  put('a.txt', 'a0\n'); put('b.txt', 'b0\n'); put('c.txt', 'c0\n'); put('list.json', '{\n "k": [\n  "x"\n ]\n}\n');
  g('git', ['add', '-A']); g('git', ['commit', '-q', '-m', 'base']);
  const pr = (name, files) => { g('git', ['checkout', '-q', '-b', name, 'master']); for (const [f, t] of Object.entries(files)) put(f, t); g('git', ['commit', '-qam', name]); };
  pr('pr1', { 'a.txt': 'a1\n' }); pr('pr2', { 'b.txt': 'b2\n' }); pr('pr3', { 'a.txt': 'a3\n' });   // pr3 conflicts with pr1 on a.txt
  pr('pr4', { 'c.txt': 'c4\n' }); pr('pr5', { 'list.json': '{\n "k": [\n  "x",\n  "five"\n ]\n}\n' });
  g('git', ['checkout', '-q', 'master']);
  return { d, g, put };
}
const items = [1, 2, 3, 4].map((n) => ({ n, ref: 'pr' + n }));
function cases(merge) {
  const bad = [];
  const t = (name, c) => { let r = false; try { r = !!c(); } catch { r = false; } if (!r) bad.push(name); };
  const r = repo();
  const out = merge(r.g, items, undefined);
  t('clean PRs merge and the conflicting one is left out', () => JSON.stringify(out.members) === '[1,2,4]' && JSON.stringify(out.excluded) === '[3]');
  t('the combined tree holds every member and nothing of the left-out PR', () => {
    const rd = (f) => readFileSync(join(r.d, f), 'utf8');
    return rd('a.txt') === 'a1\n' && rd('b.txt') === 'b2\n' && rd('c.txt') === 'c4\n';
  });
  t('the tree is clean after the abort (no conflict markers, no merge in progress)', () => r.g('git', ['status', '--porcelain']).stdout.trim() === '' && r.g('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).status !== 0);
  t('each member is a real merge commit on top of master', () => r.g('git', ['log', '--merges', '--format=%s']).stdout.trim().split('\n').length === 3);
  rmSync(r.d, { recursive: true, force: true });
  return bad;
}
{ const bad = cases(mergeBatch); for (const m of bad) ok(false, 'mergeBatch: ' + m); ok(bad.length === 0, 'mergeBatch passes its own cases'); }
const neverAborts = (s, its) => { const members = [], excluded = []; for (const it of its) { const m = s('git', ['merge', '--no-ff', '-q', '-m', 'x', it.ref]); (m.status ? excluded : members).push(it.n); } return { members, excluded }; };
const takesAll = (s, its) => { const members = []; for (const it of its) { s('git', ['merge', '--no-ff', '-q', '-m', 'x', '-X', 'theirs', it.ref]); members.push(it.n); } return { members, excluded: [] }; };
for (const [name, bad] of [['never aborts a conflicted merge', neverAborts], ['takes the conflicting PR too', takesAll]]) {
  const caught = cases(bad).length > 0;
  ok(caught, `anti-vacuity: a merger that ${name} is caught`); if (caught) breaks++;
}
{ // a resolver that finishes the conflict (the shared-list auto-merge) keeps the PR in the batch
  const r = repo();
  const out = mergeBatch(r.g, [{ n: 1, ref: 'pr1' }, { n: 3, ref: 'pr3' }], () => { r.put('a.txt', 'a1+a3\n'); r.g('git', ['add', 'a.txt']); return r.g('git', ['commit', '-q', '--no-edit']).status ? 'commit failed' : ''; });
  ok(JSON.stringify(out.members) === '[1,3]' && readFileSync(join(r.d, 'a.txt'), 'utf8') === 'a1+a3\n', 'a resolver that finishes the conflict keeps that PR in the batch');
  ok(JSON.stringify(mergeBatch(r.g, [{ n: 4, ref: 'pr4' }], undefined).members) === '[4]', 'later PRs still merge after a resolved one');
  rmSync(r.d, { recursive: true, force: true });
}

// ── 3. land.mjs guards ──
const land = readFileSync(join(ROOT, 'tools/infra/land.mjs'), 'utf8');
ok(/try \{ k = await landBatch\(take[^;\n]*\); \} catch/.test(land), 'land.mjs: an exception in the batch path falls back to the single path');
ok(/if \(k >= 0\) \{ landed \+= k; continue; \}/.test(land), 'land.mjs: a returned batch ends the round, -1 falls through to landOne');
ok(/await Promise\.all\(pendingAfter\)/.test(land) && land.indexOf('await Promise.all(pendingAfter)') < land.indexOf('rebaseSweep({'), 'land.mjs: the background bookkeeping is awaited before the auto-rebase sweep');
ok(/if \(b\.status\) return red\('build'(, b)?\)[\s\S]*if \(s\.status( && !flaky\(s\))?\) return red\('core'(, s)?\)[\s\S]*antiVacuity\(members/.test(land), 'land.mjs: the batch is judged by build, core and anti-vacuity before any push');
ok(land.indexOf("return red('core')") < land.indexOf('await apiMerge(n, p.pr)'), 'land.mjs: no API merge happens before the batch is green');
ok(/err\) \{ batchOff = 3;[^\n]*break;/.test(land), 'land.mjs: a refused push stops the batch and backs off');
ok(/sha: pr\.head\.sha/.test(land), 'land.mjs: every push is still pinned to the tested head sha');
// #6428: a vacuous new check bounces exactly its own PR(s) and the batch carries on (no back-off), instead of discarding the batch and 3 rounds
const culpritGuard = (src) => /const av = antiVacuity\(members[\s\S]*?av\.ids\.includes\(e\.id\)[\s\S]*?await bounceOne\(n, p\.issue, av\.why, av\.out\);? \}\s*return 0;/.test(src);
ok(culpritGuard(land), 'land.mjs: an anti-vacuity red bounces the PR that adds the vacuous check and returns 0 without a back-off');
{ const old = land.replace(/const av = antiVacuity\(members[\s\S]*?\n  \}\n/, "if (antiVacuity(members.map((n) => `origin/master...pr${n}`))) return red('anti-vacuity');\n");
  const caught = !culpritGuard(old); ok(caught, 'anti-vacuity: the old whole-batch red (no culprit bounce) is caught'); if (caught) breaks++; }

// #9743: a red batch whose red check names one member tests that member alone first
{ const out = ' \u2713 okcheck   12 ms\n \u2717 packhomecheck      10243 ms  FAIL: x\n \u2717 packhomecheck      10243 ms  FAIL: x\n';
  ok(JSON.stringify(failedIds(out)) === '["packhomecheck"]', 'failedIds: the red rows, deduplicated');
  const src = (id) => (id === 'packhomecheck' ? "copy tools/infra/mirror/pack-slot.sh and tools/core.json" : '');
  const files = { 9737: ['tools/brain/brain.mjs', 'tools/infra/mirror/pack-slot.sh', 'tools/core.json'], 9617: ['proof/pilot-results/a.json', 'tools/core.json'], 9618: ['tools/stages.d/x.json'] };
  const cases = (sf) => [
    ['the member that changes a file the red check names is the one suspect', JSON.stringify(sf(['packhomecheck'], files, src)) === '[9737]'],
    ['the member that changes the red check itself is a suspect', JSON.stringify(sf(['zcheck'], { 1: ['tools/zcheck.mjs'], 2: ['a.js'] }, () => '')) === '[1]'],
    ['the shared lists never make a suspect', sf(['packhomecheck'], { 9617: ['tools/core.json'] }, src).length === 0],
    ['no red ids (a build red) = no suspect', sf([], files, src).length === 0],
  ];
  for (const [n, c] of cases(suspects)) ok(c, 'suspects: ' + n);
  const caught = cases((f, fl) => Object.keys(fl).map(Number)).some(([, c]) => !c); ok(caught, 'anti-vacuity: a suspects() that blames every member is caught'); if (caught) breaks++;
  const wire = /if \(s\.length === 1\) \{ bisectQ = pending; batchOff = 1; redMembers = new Set\(s\); narrowRest = members\.filter/;
  ok(wire.test(land), 'land.mjs: one suspect = one single round on it (#9743)');
  ok(/if \(r === 'landed'\) \{ batchOff = Math\.min\(2, narrowRest\.length\); redMembers = new Set\(narrowRest\)/.test(land), 'land.mjs: a suspect that lands hands the single rounds to the other members');
  ok(/catch \(e\) \{ console\.log\(`batch RED: suspect step failed/.test(land), 'land.mjs: a failing suspect step says so in the log');
  const br = land.replace(wire, 'if (false) {'); const c2 = !wire.test(br); ok(c2, 'anti-vacuity: removing the narrowing is caught'); if (c2) breaks++; }

// #9750: a batch is topped up past closed / just-landed PRs, and a closed-issue PR is refused on the spot
{ const top = /for \(const n of \[\.\.\.nums, \.\.\.more\]\) \{[^\n]*\n\s+if \(prs\.length >= size\) break;/, call = /await landBatch\(take, [^\n]{0,40}queue\.filter\([\s\S]{0,90}?\)\.slice\(0, \d+\), [^\n]{0,40}BATCH\)/,
    refuse = /state === 'closed'\) \{ await refuseClosed\(n, issue\); continue; \}/;
  for (const [n, re] of [['the batch tops up from the rest of the queue', top], ['land.mjs passes the rest of the queue and the batch size', call], ['a closed-issue PR is refused inside the batch', refuse]]) {
    ok(re.test(land), 'land.mjs: ' + n); const c = !re.test(land.replace(re, 'X')); ok(c, 'anti-vacuity: removing "' + n + '" is caught'); if (c) breaks++; } }

// #9849: a red stage is rerun once (flaky-in-batch), and a still-red batch is bisected instead of 3 single rounds
{ const h = (m) => JSON.stringify(halves(m));
  const cs = (hf) => [['4 members -> 2 + 2', JSON.stringify(hf([1, 2, 3, 4])) === '[[1,2],[3,4]]'], ['3 members -> 2 + 1', JSON.stringify(hf([1, 2, 3])) === '[[1,2],[3]]'], ['one member is not split', JSON.stringify(hf([1])) === '[]']];
  for (const [n, c] of cs(halves)) ok(c, 'halves: ' + n);
  const caught = cs((m) => [m, []]).some(([, c]) => !c); ok(caught, 'anti-vacuity: a halves() that does not split is caught'); if (caught) breaks++;
  const g = [['a red stage is rerun once before the batch is declared red', /const flaky = \(o\) => \{[\s\S]*?suite\(\['--fast', '--only', ids\.join\(','\)\]\)/],
    ['a stage green on the rerun is logged flaky-in-batch', /flaky-in-batch: \$\{ids\.join/],
    ['the core stage is judged through the rerun', /if \(s\.status && !flaky\(s\)\) return red\('core', s\)/],
    ['a still-red batch is bisected, no 3 single rounds', /bisectQ = \[\.\.\.halves\(members\), \.\.\.pending\]/],
    ['the next round takes the next bisect group', /if \(bisectQ\.length\) \{[\s\S]*?bisectQ\.shift\(\)/]];
  for (const [n, re] of g) { ok(re.test(land), 'land.mjs: ' + n); const c = !re.test(land.replace(re, 'X')); ok(c, 'anti-vacuity: removing "' + n + '" is caught'); if (c) breaks++; }
  ok(h([1, 2]) === '[[1],[2]]', 'halves: a pair splits into two singles'); }

console.log('\n' + asserts + ' assertions, ' + fails + ' failures, ' + breaks + ' breaks caught');
process.exit(fails ? 1 : 0);
