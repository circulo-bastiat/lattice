// gitnopopupcheck (#7856): no automated git call may reach Git Credential Manager (the "Select an account" window on Dan's PC).
const XT = 'x-access-' + 'token';
// Static: every remote-touching git call in tools/ and .github/ goes through tools/infra/gitenv.mjs (or carries -c credential.helper=).
// Behavioural: a fake `git` on PATH records args+env; every call made through gitenv carries the three settings.
// Anti-vacuity: each break is fed to the same detectors and must be caught.
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REMOTE = /['"`](push|fetch|pull|clone|ls-remote)['"`]/;
const RAW = /(spawnSync|execFileSync|spawn|execFile)\(\s*['"`]git['"`]/;
const walk = (d, out = []) => { for (const n of readdirSync(d)) { if (n === 'node_modules' || n === '.git' || n === 'stages.d') continue; const p = join(d, n); statSync(p).isDirectory() ? walk(p, out) : /\.(mjs|yml|sh)$/.test(n) && out.push(p); } return out; };
/** problems in one file's text */
export function scanText(name, t) {
  const bad = [];
  if (/\.mjs$/.test(name)) {
    if (/gitenv\.mjs$|gitnopopupcheck\.mjs$/.test(name)) return bad;
    t.split('\n').forEach((l, i) => {
      if (RAW.test(l) && (REMOTE.test(l) || /credential|x-access/.test(l)) && !/credential\.helper=/.test(l)) bad.push(`${name}:${i + 1} raw git call that touches a remote`);
      if (/x-access-token:\$\{[^}]*\}@|x-access-token:\$\{?token/.test(l) && /gitExec|gitSync|'git'|\bgit\s/.test(l) && !/replace\(/.test(l)) bad.push(`${name}:${i + 1} token inside a URL`);
    });
    if (RAW.test(t) && REMOTE.test(t) && !/gitenv\.mjs|credential\.helper=/.test(t)) bad.push(`${name} spawns git for a remote without gitenv`);
  } else if (/\.yml$/.test(name)) {
    t.split('\n').forEach((l, i) => { if (/\bgit\s+(-\S+\s+)*(push|fetch|pull|clone)\b/.test(l) && !/credential\.helper=/.test(l)) bad.push(`${name}:${i + 1} workflow git remote call without -c credential.helper=`); });
  }
  return bad;
}
/** problems in one recorded fake-git call */
export function scanCall(c) {
  const bad = [];
  if (!c.args.includes('credential.helper=')) bad.push('call without -c credential.helper=');
  if (c.env.GIT_TERMINAL_PROMPT !== '0') bad.push('call without GIT_TERMINAL_PROMPT=0');
  if (c.env.GCM_INTERACTIVE !== 'never') bad.push('call without GCM_INTERACTIVE=never');
  if (c.env.GIT_ASKPASS !== 'echo') bad.push('call without GIT_ASKPASS=echo');
  if (/x-access-token:[^*@\s]+@/.test(c.log || '')) bad.push('URL with credentials printed to a log');
  return bad;
}
let fail = 0, breaks = 0;
const say = (m) => { console.log(m); fail++; };
for (const f of [...walk(join(ROOT, 'tools')), ...walk(join(ROOT, '.github'))]) for (const b of scanText(f.slice(ROOT.length + 1).replace(/\\/g, '/'), readFileSync(f, 'utf8'))) say('FAIL  ' + b);

// behavioural: fake git
const dir = mkdtempSync(join(tmpdir(), 'gnp-')), rec = join(dir, 'rec.jsonl');
writeFileSync(join(dir, 'git'), `#!/usr/bin/env node\nrequire('fs').appendFileSync(${JSON.stringify(rec)}, JSON.stringify({args:process.argv.slice(2),env:process.env})+'\\n');process.stderr.write('fatal: could not read Username for https://${XT}:SECRET@github.com\\n');process.exit(128);\n`);
chmodSync(join(dir, 'git'), 0o755);
process.env.PATH = dir + ':' + process.env.PATH;
const { gitExec, gitSync, gitFault } = await import(pathToFileURL(join(ROOT, 'tools/infra/gitenv.mjs')).href);
gitSync(['push', 'x', 'HEAD']);
let line = ''; const oe = console.error; console.error = (s) => { line = s; };
try { gitExec(['fetch', '-q', 'origin']); } catch {}
console.error = oe;
const calls = readFileSync(rec, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
if (calls.length !== 2) say(`FAIL  expected 2 recorded calls, got ${calls.length}`);
for (const c of calls) for (const b of scanCall(c)) say('FAIL  ' + b);
if (!/GIT-FAULT\s+fetch:.*no usable credentials/.test(line) || /SECRET/.test(line)) say('FAIL  fault line is not one loud token-free line: ' + line);

// breaks
const expect = (what, got) => { if (got.length) breaks++; else say(`FAIL  break not caught: ${what}`); };
const c0 = calls[0];
expect('no credential.helper', scanCall({ ...c0, args: ['push'] }));
expect('no GIT_TERMINAL_PROMPT', scanCall({ ...c0, env: { ...c0.env, GIT_TERMINAL_PROMPT: undefined } }));
expect('no GCM_INTERACTIVE', scanCall({ ...c0, env: { ...c0.env, GCM_INTERACTIVE: 'true' } }));
expect('credential URL in log', scanCall({ ...c0, log: 'pushing https://'+XT+':abc@github.com/r.git' }));
expect('raw spawn push', scanText('t.mjs', "spawnSync('git', ['push', url])"));
expect('raw execFile fetch', scanText('t.mjs', "execFileSync('git', ['fetch', 'origin'])"));
expect('token in git URL', scanText('t.mjs', "gitExec([`https://" + XT + ":${tok}@github.com/r.git`])"));
expect('workflow push', scanText('w.yml', '        run: git push origin main'));
console.log(fail ? `gitnopopupcheck: ${fail} FAIL` : `gitnopopupcheck: ok - ${calls.length} fake-git calls clean, ${breaks} breaks caught`);
process.exit(fail ? 1 : 0);
