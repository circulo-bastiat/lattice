#!/usr/bin/env node
// jsonmergecheck.mjs - #1612: the lander finishes a merge that conflicts only in the shared ratchet lists
// (tools/*-known.json, tools/mobl3-mobs.json) by merging them BY KEY (tools/infra/jsonmerge.mjs + listmerge.mjs).
//   node tools/jsonmergecheck.mjs
// 1. merge3 unit cases   2. a REAL git merge in a temp repo, finished by mergeLists()   3. anti-vacuity: three broken
// mergers (take-theirs, always-ok, key-dropping) must each fail the same cases, or the cases prove nothing.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { merge3, MERGEABLE } from './infra/jsonmerge.mjs';
import { mergeLists } from './infra/listmerge.mjs';

for (const k of ['AUTHOR', 'COMMITTER']) { process.env[`GIT_${k}_NAME`] = 't'; process.env[`GIT_${k}_EMAIL`] = 't@t'; }   // the lander sets its own identity
let asserts = 0, fails = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const J = (x, ind = 1) => JSON.stringify(x, null, ind) + '\n';

// the cases, parameterised on the merger so the broken ones can be run through the same assertions
function cases(merge) {
  const bad = [];
  const t = (name, c) => { let r = false; try { r = !!c(); } catch { r = false; } if (!r) bad.push(name); };
  const base = J({ why: 'w', mobs: { a: 1, b: 2 } });
  const ours = J({ why: 'w', mobs: { a: 1, b: 2, c: 3 } });
  const theirs = J({ why: 'w', mobs: { a: 1, b: 2, d: 4 } });
  t('disjoint additions merge', () => { const r = merge(base, ours, theirs); return r.ok && eq(JSON.parse(r.text), { why: 'w', mobs: { a: 1, b: 2, c: 3, d: 4 } }); });
  t('same key, same value merges', () => { const r = merge(base, J({ mobs: { a: 1, b: 2, c: 3 } }), J({ mobs: { a: 1, b: 2, c: 3 } })); return r.ok; });
  t('same key, different value is a REAL conflict', () => !merge(base, J({ mobs: { a: 1, b: 2, c: 3 } }), J({ mobs: { a: 1, b: 2, c: 9 } })).ok);
  t('one side changed an existing value, the other did not', () => { const r = merge(base, ours, J({ why: 'w', mobs: { a: 7, b: 2 } })); return r.ok && JSON.parse(r.text).mobs.a === 7 && JSON.parse(r.text).mobs.c === 3; });
  t('an array merges as a set (both added, one removed)', () => { const b = J({ l: ['x', 'y'] }), r = merge(b, J({ l: ['x', 'y', 'o'] }), J({ l: ['x', 't'] })); return r.ok && eq(JSON.parse(r.text).l, ['x', 'y', 'o', 't'].filter((v) => v !== 'y')); });
  t('a removal against an untouched key is taken', () => { const r = merge(base, ours, J({ why: 'w', mobs: { a: 1 } })); return r.ok && eq(JSON.parse(r.text).mobs, { a: 1, c: 3 }); });
  t('removal against a change is a conflict', () => !merge(base, J({ why: 'w', mobs: { a: 5, b: 2 } }), J({ why: 'w', mobs: { b: 2 } })).ok);
  t('sorted keys stay sorted', () => { const r = merge(J({ a: 1, c: 3 }), J({ a: 1, b: 2, c: 3 }), J({ a: 1, c: 3, d: 4 })); return r.ok && eq(Object.keys(JSON.parse(r.text)), ['a', 'b', 'c', 'd']); });
  t('invalid JSON is refused', () => !merge(base, '{ nope', theirs).ok);
  return bad;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- 1. unit
const bad = cases(merge3);
ok(bad.length === 0, 'merge3 failed: ' + bad.join('; '));
const compact = '{\n "why": "w",\n "mobs": {\n  "x": ["a","b"],\n  "y": ["c"]\n }\n}\n';
const rc = merge3(compact, compact.replace('"y": ["c"]', '"y": ["c"],\n  "z": ["d"]'), compact);
ok(rc.ok && rc.text.includes('"x": ["a","b"]') && rc.text.includes('"z": ["d"]'), 'the compact-array layout is kept');
ok(MERGEABLE.test('tools/mobl3-known.json') && MERGEABLE.test('tools/golden/texroster-known.json') && MERGEABLE.test('tools/mobl3-mobs.json'), 'the list files are mergeable');
ok(['tools/mobshapecheck.json', 'tools/quarantine.json', 'tools/core.json'].every((f) => MERGEABLE.test(f)), '#1638: the ratchet, quarantine and core sets are mergeable');
ok(!MERGEABLE.test('tools/mobshapecheck.mjs') && !MERGEABLE.test('tools/corex.json') && !MERGEABLE.test('tools/golden/noise-golden-1.18.2.json'), 'look-alikes (the .mjs checks, other json) are NOT');
ok(!MERGEABLE.test('tools/mobl3check.mjs') && !MERGEABLE.test('src/07j_entityrender.js') && !MERGEABLE.test('tools/suite.mjs'), 'code is NOT touched');

// ---- 2. a real git merge
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { cwd, encoding: 'utf8' });
function repo(files) {   // files: {master:{path:text}, pr:{path:text}} on top of a common base
  const d = mkdtempSync(join(tmpdir(), 'jsonmerge-'));
  git(d, 'init', '-q', '-b', 'master'); mkdirSync(join(d, 'tools'), { recursive: true });
  const put = (m) => { for (const [p, x] of Object.entries(m)) writeFileSync(join(d, p), x); };
  put(files.base); git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'base');
  git(d, 'checkout', '-q', '-b', 'pr'); put(files.pr); git(d, 'commit', '-qam', 'pr');
  git(d, 'checkout', '-q', 'master'); put(files.master); git(d, 'commit', '-qam', 'master');
  return d;
}
const run = (files) => { const d = repo(files); const m = git(d, 'merge', '--no-ff', '-q', '-m', 'land', 'pr'); const why = m.status ? mergeLists(d) : 'clean'; return { d, m, why }; };
const L = (o) => J(o);
{ // the real shape: two PRs add different mobs to the same list, in the same place
  const k0 = L({ why: 'w', mobs: { a: 1 }, n: 1 });
  const r = run({ base: { 'tools/mobl3-known.json': k0 }, pr: { 'tools/mobl3-known.json': L({ why: 'w', mobs: { a: 1, p: 2 }, n: 2 }) }, master: { 'tools/mobl3-known.json': L({ why: 'w', mobs: { a: 1, m: 3 }, n: 1 }) } });
  ok(r.m.status !== 0, 'the plain git merge really conflicts (otherwise this proves nothing)');
  ok(r.why === '', 'mergeLists finished the list-only conflict: ' + r.why);
  const out = JSON.parse(readFileSync(join(r.d, 'tools/mobl3-known.json'), 'utf8'));
  ok(eq(out, { why: 'w', mobs: { a: 1, m: 3, p: 2 }, n: 2 }), 'both sides\' keys are in the merged file: ' + JSON.stringify(out));
  ok(git(r.d, 'status', '--porcelain').stdout.trim() === '' && git(r.d, 'log', '-1', '--format=%P').stdout.trim().split(' ').length === 2, 'it ended as a real merge commit, tree clean');
  rmSync(r.d, { recursive: true, force: true });
}
{ // a real value conflict stays a conflict
  const r = run({ base: { 'tools/mobl3-known.json': L({ n: 1 }) }, pr: { 'tools/mobl3-known.json': L({ n: 2 }) }, master: { 'tools/mobl3-known.json': L({ n: 3 }) } });
  ok(r.why.includes('different values'), 'both sides changed n differently -> not merged: ' + r.why);
  rmSync(r.d, { recursive: true, force: true });
}
{ // a conflict in a code file next to a list conflict stays a conflict
  const r = run({ base: { 'tools/mobl3-known.json': L({ a: 1 }), 'tools/x.mjs': 'one\n' }, pr: { 'tools/mobl3-known.json': L({ a: 1, p: 1 }), 'tools/x.mjs': 'two\n' }, master: { 'tools/mobl3-known.json': L({ a: 1, m: 1 }), 'tools/x.mjs': 'three\n' } });
  ok(r.why.includes('outside the lists') && r.why.includes('tools/x.mjs'), 'a code conflict is left to the session: ' + r.why);
  rmSync(r.d, { recursive: true, force: true });
}

// ---- 3. anti-vacuity: each broken merger must fail the same cases
let breaks = 0;
const takeTheirs = (b, o, t) => ({ ok: true, text: t });
const alwaysOk = (b, o, t) => { const r = merge3(b, o, t); return r.ok ? r : { ok: true, text: o }; };
const dropsOurs = (b, o, t) => { const r = merge3(b, o, t); if (!r.ok) return r; const x = JSON.parse(r.text); if (x.mobs) delete x.mobs.c; return { ok: true, text: J(x) }; };
for (const [name, fn] of [['take-theirs', takeTheirs], ['always-ok', alwaysOk], ['drops a key', dropsOurs]]) {
  const b = cases(fn);
  ok(b.length > 0, `the cases cannot tell "${name}" from a real merger`);
  if (b.length) { breaks++; console.log(`  ✓ "${name}" fails ${b.length} case(s): ${b.slice(0, 2).join(' | ')}`); }
}
console.log(`jsonmergecheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
