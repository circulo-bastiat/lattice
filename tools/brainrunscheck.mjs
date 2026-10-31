#!/usr/bin/env node
// brainrunscheck.mjs - 21 Oct (Dan chose "live smoke gate in the lander"): RUN the brain, do not grep it.
// 21 Oct 11:30-17:42Z a stray line in brain.mjs killed every tick for 6 h; 20 Oct a half-finished refactor left `deps is not defined` in go.mjs for ~40 min and every
// check passed because they only read the files. This check runs the real entry points against a stubbed GitHub (fetch replaced by a preload that
// child processes inherit, token `stub`, a throw-away BRAIN_HOME): `brain.mjs health --dry`, `brain.mjs fill`, `launch.mjs --role worker|commander --dry`.
// A run is bad if it exits non-zero or prints a load/reference error. Then it breaks brain.mjs and launch.mjs six ways: each must be caught.
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
const BRAIN = join(dirname(fileURLToPath(import.meta.url)), 'brain');
const tmp = mkdtempSync(join(tmpdir(), 'brainruns-'));
const home = join(tmp, 'home'); mkdirSync(join(home, 'tokens'), { recursive: true });
writeFileSync(join(home, 'tokens', 'max.txt'), 'x'); writeFileSync(join(home, 'tokens', 'pro.txt'), 'x');
const stub = join(tmp, 'stub.mjs');
writeFileSync(stub, `
globalThis.fetch = async (url) => {
  const p = String(url).replace('https://api.github.com', '');
  let body = [];
  if (/labels=bus/.test(p)) body = [{ number: 9300, title: 'bus', labels: [{ name: 'bus' }], comments: 0, state: 'open' }];
  else if (/\\/actions\\/variables\\//.test(p)) body = { name: 'x', value: '' };
  else if (/\\/actions\\/(runs|workflows\\/[^/]+\\/runs)/.test(p)) body = { total_count: 0, workflow_runs: [] };
  else if (/\\/actions\\/runners/.test(p)) body = { total_count: 0, runners: [] };
  else if (/git\\/refs?\\/heads\\/master|\\/branches\\/master/.test(p)) body = { ref: 'refs/heads/master', object: { sha: 'a'.repeat(40) }, commit: { sha: 'a'.repeat(40), commit: { committer: { date: new Date().toISOString() } } } };
  else if (/^\\/repos\\/[^/]+\\/[^/]+$/.test(p)) body = { owner: { login: 'o' }, default_branch: 'master', full_name: 'o/r' };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};
`);
const env = { ...process.env, BRAIN_HOME: home, GH_TOKEN: 'stub', MCLITE_GH_TOKEN: 'stub', NODE_OPTIONS: `--import ${pathToFileURL(stub).href}`, NODE_NO_WARNINGS: '1' };
for (const k of ['HTTPS_PROXY', 'https_proxy', 'NODE_USE_ENV_PROXY', 'GITHUB_EVENT_PATH', 'GITHUB_RUN_ID', 'BRAIN_RUNNER', 'MCLITE_HOSTED', 'MIRROR_REPO', 'MIRROR_TOKEN']) delete env[k];
const BAD = /ReferenceError|SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export|[A-Za-z_$][\w$]* is not defined|Cannot find (module|package)|Unexpected (token|identifier|end of input)/;
const CALLS = [['brain.mjs', ['health', '--dry']], ['brain.mjs', ['fill']], ['launch.mjs', ['--role', 'worker', '--reason', 'smoke', '--dry']], ['launch.mjs', ['--role', 'commander', '--reason', 'smoke', '--dry']]];
let n = 0;
const run = (file, args, text) => {
  rmSync(join(home, 'fill.lock'), { recursive: true, force: true });
  let f = join(BRAIN, file);
  if (text != null) { f = join(BRAIN, `${file.replace(/\.mjs$/, '')}.brainrunscheck-${process.pid}-${n++}.mjs`); writeFileSync(f, text); }
  try { const r = spawnSync(process.execPath, [f, ...args], { encoding: 'utf8', env, timeout: 90e3, cwd: dirname(BRAIN) }); return { r, out: (r.stdout || '') + (r.stderr || '') }; }
  finally { if (text != null) rmSync(f, { force: true }); }
};
const bad = (x) => x.r.status !== 0 || BAD.test(x.out.split('\n').filter((l) => !l.startsWith('STUB')).join('\n'));
let fail = 0, caught = 0, asserts = 0;
for (const [file, args] of CALLS) {
  asserts++; const x = run(file, args);
  if (bad(x)) { fail++; console.log(`FAIL ${file} ${args.join(' ')} does not run clean (exit ${x.r.status}):\n${x.out.slice(-700)}`); } else console.log(`ok   ${file} ${args.join(' ')}`);
}
const src = { brain: readFileSync(join(BRAIN, 'brain.mjs'), 'utf8'), launch: readFileSync(join(BRAIN, 'launch.mjs'), 'utf8') };
const BREAKS = [
  ['brain.mjs: a stray unfinished try line (the 21 Oct outage)', 'brain.mjs', ['health', '--dry'], src.brain, (s) => s.replace("const HERE = dirname(fileURLToPath(import.meta.url));", "const HERE = dirname(fileURLToPath(import.meta.url));\ntry { catch (e) {} ")],
  ['brain.mjs: an import used by fill() dropped', 'brain.mjs', ['fill'], src.brain, (s) => s.replace('measuredRate, pushPace, fillShape, overdueRuns', 'measuredRate, pushPace, overdueRuns')],
  ['brain.mjs: an import used by health() dropped', 'brain.mjs', ['health', '--dry'], src.brain, (s) => s.replace('routeComment, findings, dueAlerts', 'routeComment, dueAlerts')],
  ['brain.mjs: a module path that does not exist', 'brain.mjs', ['health', '--dry'], src.brain, (s) => s.replace("'../infra/workerpack.mjs'", "'../infra/workerpack-gone.mjs'")],
  ['brain.mjs: a named export that does not exist', 'brain.mjs', ['fill'], src.brain, (s) => s.replace('dispatchPacks, poolTag', 'dispatchPacksGone, poolTag')],
  ['launch.mjs: an import dropped', 'launch.mjs', ['--role', 'worker', '--reason', 'smoke', '--dry'], src.launch, (s) => s.replace('import { trimLaunch, pickAccount,', 'import { pickAccount,')],
];
for (const [name, file, args, s, mk] of BREAKS) {
  asserts++; const m = mk(s);
  if (m === s) { fail++; console.log(`FAIL break "${name}" did not change the file (the pattern is stale)`); continue; }
  if (bad(run(file, args, m))) { caught++; console.log(`✓ caught: ${name}`); } else { fail++; console.log(`FAIL break "${name}" was NOT caught`); }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`brainrunscheck: ${asserts} assertions, ${fail} failures, ${caught} breaks caught`);
process.exit(fail || caught < BREAKS.length ? 1 : 0);
