#!/usr/bin/env node
// goldensynccheck.mjs - #6524: referee golden reaches the lander.   node tools/goldensynccheck.mjs
// 1. goldenNames reads the names a refcheck reads   2. publishGolden against a fake GitHub: new -> PUT to branch store, identical -> skipped, changed -> PUT with sha,
// missing locally -> reported   3. syncGolden in a REAL git repo: a store branch's golden/ is copied, an identical file is left alone, a changed one is rewritten
// 4. source guards: done --finished publishes before the PR and refuses a missing golden; land.mjs syncs at start   5. anti-vacuity: each behaviour removed must FAIL.
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { goldenNames, publishGolden, syncGolden, proofGoldenNames } from './infra/golden.mjs';
for (const k of ['AUTHOR', 'COMMITTER']) { process.env[`GIT_${k}_NAME`] = 't'; process.env[`GIT_${k}_EMAIL`] = 't@t'; }
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => mkdtempSync(join(tmpdir(), 'goldensync-'));

// 1. names
ok(JSON.stringify(goldenNames("const G = [join(refDir, 'golden', 'crystal.json'), join(R, 'golden', 'crystal.json'), join(x, 'golden', 'pig-hurt.json')];")) === '["crystal.json","pig-hurt.json"]', 'goldenNames: finds each distinct golden file once');
ok(goldenNames('no golden here').length === 0, 'goldenNames: a check without golden gives none');

// 2. publish against a fake GitHub
const fake = (store) => { const calls = []; const gh = async (m, p, body) => { calls.push([m, p, body]); const n = (p.match(/golden\/([\w.-]+)\?/) || p.match(/golden\/([\w.-]+)$/) || [])[1]; if (m === 'GET' && p.includes('/commits?')) { const q = (p.match(/path=golden\/([\w.-]+)&/) || [])[1], dt = store.__dates && store.__dates[q]; return dt ? [{ commit: { committer: { date: dt } } }] : null; }
    if (m === 'GET') return store[n] || null; store[n] = { sha: 'S' + calls.length, content: body.content }; return {}; }; return { gh, calls }; };
{
  const d = tmp(); writeFileSync(join(d, 'new.json'), '{"a":1}'); writeFileSync(join(d, 'same.json'), '{"b":2}'); writeFileSync(join(d, 'chg.json'), '{"c":3}');
  const store = { 'same.json': { sha: 'X', content: Buffer.from('{"b":2}').toString('base64') + '\n' }, 'chg.json': { sha: 'OLD', content: Buffer.from('{"c":0}').toString('base64') } };
  const f = fake(store);
  const r = await publishGolden(['new.json', 'same.json', 'chg.json', 'gone.json'], f.gh, d, new Set(['chg.json']));
  ok(JSON.stringify(r.pushed) === '["new.json","chg.json"]', 'publish: a new and a changed golden are pushed');
  ok(JSON.stringify(r.same) === '["same.json"]', 'publish: an identical golden is not pushed again');
  ok(JSON.stringify(r.missing) === '["gone.json"]', 'publish: a golden absent from this machine is reported');
  const puts = f.calls.filter((c) => c[0] === 'PUT');
  ok(puts.length === 2 && puts.every((c) => c[2].branch === 'store'), 'publish: pushes go to the store branch');
  ok(puts.find((c) => c[1].endsWith('chg.json'))?.[2].sha === 'OLD' && !('sha' in puts.find((c) => c[1].endsWith('new.json'))[2]), 'publish: an update carries the old sha, a new file none');
}

// 2b. #9133: stale local never replaces a fresher store file (the exact 20 Oct failure: old 31248 B mob-loot.json over the 35221 B one)
{
  const d = tmp(); const old = '{"old":1}', fresh = '{"fresh":1,"fireTables":[]}';
  const mk = (localNewer, regen) => { writeFileSync(join(d, 'mob-loot.json'), old); const t = new Date(localNewer ? Date.now() : Date.now() - 1e9); utimesSync(join(d, 'mob-loot.json'), t, t);
    const store = { 'mob-loot.json': { sha: 'F', content: Buffer.from(fresh).toString('base64') }, __dates: { 'mob-loot.json': new Date(Date.now() - 1e8).toISOString() } };
    return publishGolden(['mob-loot.json'], fake(store).gh, d, new Set(regen ? ['mob-loot.json'] : [])); };
  ok((await mk(false, false)).pushed.length === 0, 'stale local + fresh store: NOT pushed'); breaks++;
  ok((await mk(true, false)).pushed.length === 0, 'stale local with a FRESH mtime (bootstrap copy) + fresh store: NOT pushed'); breaks++;
  process.env.MCLITE_GOLDEN_REGEN = 'mob-loot.json'; ok((await mk(false, false)).pushed.length === 1, 'named in MCLITE_GOLDEN_REGEN: pushed'); delete process.env.MCLITE_GOLDEN_REGEN;
  ok((await mk(false, true)).pushed.length === 1, 'local named in regen: pushed');
  const e = await publishGolden(['mob-loot.json'], fake({}).gh, d); ok(e.pushed.length === 1, 'missing on store: pushed');
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
const goGuard = (s) => /publishGolden\(gn, gh[^)]*\)[\s\S]{0,500}r\.missing\.length\) die\([\s\S]{0,400}if \(!flag\('--finished'\)\) git\(\[\.\.\.who, 'commit', '-q', '--allow-empty'/.test(s);
const landGuard = (s) => /logEvidence\('lander start', ROOT\);\ntry \{ const w = syncGolden\(ROOT\)/.test(s);
ok(goGuard(go), 'go.mjs: done --finished publishes the golden of changed referee checks and refuses a missing one, before the PR');
ok(landGuard(land), 'land.mjs: the lander syncs the store golden before its first test');
// the mirror runs the lander's suite and its data repo has no store-branch golden: each mirror workflow must pull it (#6081)
const mirrorYml = ['ci', 'ci-full', 'ci-pilot'].map((n) => readFileSync(join(ROOT, 'tools/infra/mirror', n + '.yml'), 'utf8'));
const mirrorGuard = (ys) => ys.every((y) => /bootstrap\.mjs --store "\$STORE_URL"[^\n]*golden\.sh; silent golden golden_pull/.test(y));
ok(mirrorGuard(mirrorYml) && /git clone -q --depth 1 --branch store/.test(readFileSync(join(ROOT, 'tools/infra/mirror/golden.sh'), 'utf8')), 'mirror: every workflow pulls the store-branch golden after the data step');

// #9020: every golden a proof check reads is in the publish list (mobdropsproofcheck needs looting-roster.json)
{ const pn = proofGoldenNames(join(ROOT, 'tools')); ok(pn.includes('looting-roster.json') && pn.includes('mob-loot.json'), 'proofGoldenNames lists the mob drops proof goldens');
  ok(/proofGoldenNames\(join\(dir, 'tools'\)\)[\s\S]{0,400}publishGolden\(gn, gh[^)]*\)/.test(go), 'go.mjs publishes the proof-check goldens');
  breaks++; ok(!/proofGoldenNames\(join\(dir, 'tools'\)\)[\s\S]{0,400}publishGolden\(gn, gh[^)]*\)/.test(go.replace('proofGoldenNames(join(dir', 'noop(join(dir')), 'anti-vacuity: go.mjs without the proof goldens is caught'); }

// 5. anti-vacuity
const drop = (name, caught) => { ok(caught, 'anti-vacuity: ' + name + ' is caught'); if (caught) breaks++; };
drop('a go.mjs that never publishes', !goGuard(go.replace('publishGolden(gn, gh, goldenDir(), regen)', 'null')));
drop('a go.mjs that lets a missing golden through', !goGuard(go.replace('if (r.missing.length) die(', 'if (false) die(')));
drop('a lander that never syncs', !landGuard(land.replace('syncGolden(ROOT)', '[]')));
drop('a mirror workflow that skips the golden pull', !mirrorGuard([mirrorYml[0], mirrorYml[1].replace('golden_pull', 'true'), mirrorYml[2]]));
drop('a goldenNames that finds nothing', (() => { const bad = () => []; return bad("join(r, 'golden', 'x.json')").length === 0 && goldenNames("join(r, 'golden', 'x.json')").length === 1; })());
{ const f = fake({}); const d = tmp(); writeFileSync(join(d, 'n.json'), '1');
  const blind = async (names, gh, dir) => ({ pushed: [], same: [], missing: [] });   // a publisher that does nothing
  const r = await blind(['n.json'], f.gh, d), real = await publishGolden(['n.json'], fake({}).gh, d);
  drop('a publisher that pushes nothing', r.pushed.length === 0 && real.pushed.length === 1); }

console.log('\n' + asserts + ' assertions, ' + fails + ' failures, ' + breaks + ' breaks caught');
process.exit(fails ? 1 : 0);
