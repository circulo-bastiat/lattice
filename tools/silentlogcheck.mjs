// silentlogcheck (#8913): the public lattice mirror's job logs must not leak. Scans a log (file args) or, with no args, the
// workflow templates + a sample log produced by silent.sh itself; then proves the scanner by feeding it leaking samples.
import fs from 'node:fs'; import cp from 'node:child_process'; import os from 'node:os'; import path from 'node:path';
const RULES = [
  ['src/ line with content', /\bsrc\/[\w./-]+\.js:\d+|\bsrc\/[\w./-]+\.js\s*[:|]\s*\S/],
  ['email', /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ['main account', new RegExp('boiler' + 'bobbing', 'i')],
  ['owner account', new RegExp('hinerman' + 'danny', 'i')],
  ['usage %', /\b(usage|quota|limit|used)\b[^\n]{0,30}\d+(\.\d+)?\s*%/i],
  ['token', /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|sk-[A-Za-z0-9-]{20,}|x-access-token:[^@\s*]+@|Bearer\s+\S{12,})/],
];
export function scan(text) { const hits = []; for (const [n, re] of RULES) if (re.test(text)) hits.push(n); return hits; }
let bad = 0;
const files = process.argv.slice(2);
if (!files.length) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'silent-'));
  const sh = path.resolve('tools/infra/mirror/silent.sh');
  const run = cmd => cp.spawnSync('bash', ['-c', `. ${sh}; silent t ${cmd}`], { env: { ...process.env, RUNNER_TEMP: tmp }, encoding: 'utf8' });
  const r = run(`bash -c 'echo src/04b_caves.js:12: secret; echo a@b.com >&2; exit 3'`);
  const hits = scan(r.stdout);
  if (hits.length || !/exit=3 elapsed=\d+s/.test(r.stdout)) { bad++; console.log('FAIL silent.sh log:', r.stdout, hits); }
  if (!/secret/.test(fs.readFileSync(path.join(tmp, 'out.log'), 'utf8'))) { bad++; console.log('FAIL out.log missing output'); }
  // the workflows must route code-touching steps through silent
  for (const f of ['ci.yml', 'ci-full.yml', 'ci-pilot.yml']) {
    const t = fs.readFileSync('tools/infra/mirror/' + f, 'utf8');
    if (t.split('\n').some(l => !/^\s*#/.test(l) && /\|\s*tail\b/.test(l))) { bad++; console.log('FAIL', f, 'pipes command output to the log through tail'); }
    if (!/silent data/.test(t)) { bad++; console.log('FAIL', f, 'data step not silent'); }
  }
  // anti-vacuity
  const leaks = ['src/04b_caves.js:12: x', 'mail me@x.org', 'boiler' + 'bobbing', 'Hinerman' + 'Danny', 'weekly usage 83%', 'ghp_' + 'a'.repeat(30), 'https://x-access-' + 'token:abc123@github.com'];
  let caught = 0; for (const l of leaks) if (scan(l).length) caught++;
  if (scan('[silent] data exit=0 elapsed=12s').length) { bad++; console.log('FAIL clean line flagged'); }
  console.log(`${caught}/${leaks.length} leaks; ${caught} breaks caught`); if (caught < leaks.length) bad++;
} else for (const f of files) { const h = scan(fs.readFileSync(f, 'utf8')); console.log(f, h.length ? 'LEAKS: ' + h.join(', ') : 'clean'); bad += h.length ? 1 : 0; }
console.log(bad ? 'silentlogcheck FAIL' : 'silentlogcheck ok'); process.exit(bad ? 1 : 0);
