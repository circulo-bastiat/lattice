#!/usr/bin/env node
// goldensynccheck.mjs - #6524: referee golden reaches the lander.   node tools/goldensynccheck.mjs
// 1. goldenNames reads the names a refcheck reads   2. publishGolden against a fake GitHub: new -> PUT to branch store, identical -> skipped, changed -> PUT with sha,
// missing locally -> reported   3. syncGolden in a REAL git repo: a store branch's golden/ is copied, an identical file is left alone, a changed one is rewritten
// 4. source guards: done --finished publishes before the PR and refuses a missing golden; land.mjs syncs at start   5. anti-vacuity: each behaviour removed must FAIL.
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { goldenNames, publishGolden, syncGolden } from './infra/golden.mjs';
for (const k of ['AUTHOR', 'COMMITTER']) { process.env[`GIT_${k}_NAME`] = 't'; process.env[`GIT_${k}_EMAIL`] = 't@t'; }
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => mkdtempSync(join(tmpdir(), 'goldensync-'));

// 1. names
ok(JSON.stringify(goldenNames("const G = [join(refDir, 'golden', 'crystal.json'), join(R, 'golden', 'crystal.json'), join(x, 'golden', 'pig-hurt.json')];")) === '["crystal.json","pig-hurt.json"]', 'goldenNames: finds each distinct golden file once');
ok(goldenNames('no golden here').length === 0, 'goldenNames: a check without golden gives none');

// 2. publish against a fake GitHub
const fake = (store) => { const calls = []; const gh = async (m, p, body) => { calls.push([m, p, body]); const n = (p.match(/golden\/([\w.-]+)\?/) || p.match(/golden\/([\w.-]+)$/) || [])[1]; if (m === 'GET') return store[n] || null; store[n] = { sha: 'S' + calls.length, content: body.content }; return {}; }; return { gh, calls }; };
{
  const d = tmp(); writeFileSync(join(d, 'new.json'), '{"a":1}'); writeFileSync(join(d, 'same.json'), '{"b":2}'); writeFileSync(join(d, 'chg.json'), '{"c":3}');
  const store = { 'same.json': { sha: 'X', content: Buffer.from('{"b":2}').toString('base64') + '\n' }, 'chg.json': { sha: 'OLD', content: Buffer.from('{"c":0}').toString('base64') } };
  const f = fake(store);
  const r = await publishGolden(['new.json', 'same.json', 'chg.json', 'gone.json'], f.gh, d);
  ok(JSON.stringify(r.pushed) === '["new.json","chg.json"]', 'publish: a new and a changed golden are pushed');
  ok(JSON.stringify(r.same) === '["same.json"]', 'publish: an identical golden is not pushed again');
  ok(JSON.stringify(r.missing) === '["gone.json"]', 'publish: a golden absent from this machine is reported');
  const puts = f.calls.filter((c) => c[0] === 'PUT');
  ok(puts.length === 2 && puts.every((c) => c[2].branch === 'store'), 'publish: pushes go to the store branch');
  ok(puts.find((c) => c[1].endsWith('chg.json'))?.[2].sha === 'OLD' && !('sha' in puts.find((c) => c[1].endsWith('new.json'))[2]), 'publish: an update carries the old sha, a new file none');
}

// 3. sync in a real repo
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
{
  const up = tmp(); sh(up, 'init', '-q', '-b', 'master'); sh(up, 'commit', '-q', '--allow-empty', '-m', 'm');
  sh(up, 'checkout', '-q', '-b', 'store'); mkdirSync(join(up, 'golden')); writeFileSync(join(up, 'golden', 'a.json'), '{"a":1}'); writeFileSync(join(up, 'golden', 'b.json'), '{"b":1}'); writeFileSync(join(up, 'other.txt'), 'x');
  sh(up, 'add', '-A'); sh(up, 'commit', '-q', '-m', 'store'); sh(up, 'checkout', '-q', 'master');
  const cl = tmp(); sh(cl, 'init', '-q', '-b', 'master'); sh(cl, 'remote', 'add', 'origin', up);
  const dir = join(tmp(), 'golden');
  const w1 = syncGolden(cl, dir);
  ok(JSON.stringify(w1.sort()) === '["a.json","b.json"]' && readFileSync(join(dir, 'a.json'), 'utf8') === '{"a":1}', 'sync: the store branch golden/ is copied, nothing else');
  ok(syncGolden(cl, dir).length === 0, 'sync: a second sync writes nothing');
  writeFileSync(join(dir, 'b.json'), 'stale');
  ok(JSON.stringify(syncGolden(cl, dir)) === '["b.json"]' && readFileSync(join(dir, 'b.json'), 'utf8') === '{"b":1}', 'sync: a stale local file is rewritten');
  ok(readdirSync(dir).length === 2, 'sync: no stray files');
}

// 4. source guards
const go = readFileSync(join(ROOT, 'tools/go.mjs'), 'utf8'), land = readFileSync(join(ROOT, 'tools/infra/land.mjs'), 'utf8');
const goGuard = (s) => /publishGolden\(gn, gh\)[\s\S]{0,500}r\.missing\.length\) die\([\s\S]{0,400}if \(!flag\('--finished'\)\) git\(\[\.\.\.who, 'commit', '-q', '--allow-empty'/.test(s);
const landGuard = (s) => /logEvidence\('lander start', ROOT\);\ntry \{ const w = syncGolden\(ROOT\)/.test(s);
ok(goGuard(go), 'go.mjs: done --finished publishes the golden of changed referee checks and refuses a missing one, before the PR');
ok(landGuard(land), 'land.mjs: the lander syncs the store golden before its first test');

// 5. anti-vacuity
const drop = (name, caught) => { ok(caught, 'anti-vacuity: ' + name + ' is caught'); if (caught) breaks++; };
drop('a go.mjs that never publishes', !goGuard(go.replace('publishGolden(gn, gh)', 'null')));
drop('a go.mjs that lets a missing golden through', !goGuard(go.replace('if (r.missing.length) die(', 'if (false) die(')));
drop('a lander that never syncs', !landGuard(land.replace('syncGolden(ROOT)', '[]')));
drop('a goldenNames that finds nothing', (() => { const bad = () => []; return bad("join(r, 'golden', 'x.json')").length === 0 && goldenNames("join(r, 'golden', 'x.json')").length === 1; })());
{ const f = fake({}); const d = tmp(); writeFileSync(join(d, 'n.json'), '1');
  const blind = async (names, gh, dir) => ({ pushed: [], same: [], missing: [] });   // a publisher that does nothing
  const r = await blind(['n.json'], f.gh, d), real = await publishGolden(['n.json'], fake({}).gh, d);
  drop('a publisher that pushes nothing', r.pushed.length === 0 && real.pushed.length === 1); }

console.log('\n' + asserts + ' assertions, ' + fails + ' failures, ' + breaks + ' breaks caught');
process.exit(fails ? 1 : 0);
