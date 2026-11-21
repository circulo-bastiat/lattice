// tools/gorunscheck.mjs - #9009: RUN go.mjs, do not just grep it. #8981 moved deps() into infra/claimfilter.mjs and left one
// call site behind; every check grepped go.mjs, so every `go.mjs start` died with 'deps is not defined' for ~40 min.
// Runs `go.mjs claimable` against a stubbed GitHub (fetch replaced by a preload) and breaks go.mjs 5 ways.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const TOOLS = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(TOOLS, 'go.mjs'), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'gorun-'));
const stub = join(tmp, 'stub.mjs');
writeFileSync(stub, `
const issue = (n, t) => ({ number: n, title: t, body: 'x', labels: [{ name: '01 BUGS' }], created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', state: 'open', comments: 0, user: { login: 'u' }, assignees: [] });
globalThis.fetch = async (url) => {
  const p = String(url).replace('https://api.github.com', '');
  let body = {};
  if (/\\/issues\\?/.test(p)) body = p.includes('page=2') ? [] : [issue(1, 'a'), issue(2, 'b')];
  else if (/\\/pulls\\?/.test(p)) body = [];
  else if (/matching-refs/.test(p)) body = [];
  else if (/\\/comments/.test(p)) body = [];
  else if (/git\\/ref\\/heads\\/master/.test(p)) body = { object: { sha: 'a'.repeat(40) } };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};
`);
let n = 0;
const run = (text) => {
  const f = join(TOOLS, `go.gorunscheck-${process.pid}-${n++}.mjs`);
  writeFileSync(f, text);
  try {
    const env = { ...process.env, GH_TOKEN: 'stub', MCLITE_GH_TOKEN: 'stub' }; delete env.HTTPS_PROXY; delete env.https_proxy;
    return spawnSync(process.execPath, ['--import', stub, f, 'claimable'], { encoding: 'utf8', env, timeout: 120e3 });
  } finally { rmSync(f, { force: true }); }
};
const bad = (r) => r.status !== 0 || /is not defined|ReferenceError|SyntaxError|Cannot find|does not provide|TypeError/.test(r.stdout + r.stderr);
let fail = 0;
const base = run(src);
if (bad(base)) { fail++; console.log('FAIL go.mjs claimable does not run clean:\n' + (base.stdout + base.stderr).slice(-600)); } else console.log('ok go.mjs claimable runs against stubbed GitHub');
const breaks = [
  ['deps import dropped', (s) => s.replace('claimFilter, branchTaken, deps, burnLabelsToClear }', 'claimFilter, branchTaken, burnLabelsToClear }')],
  ['claimFilter import dropped', (s) => s.replace('{ claimFilter, branchTaken, deps, burnLabelsToClear }', '{ branchTaken, deps, burnLabelsToClear }')],
  ['gh import dropped', (s) => s.replace("import { gh, ghAll,", "import { ghAll,")],
  ['ghAll import dropped', (s) => s.replace("import { gh, ghAll,", "import { gh,")],
  ['gateFilter import dropped', (s) => s.replace('import { gateFilter, ', 'import { ')],
];
let caught = 0;
for (const [name, f] of breaks) {
  const m = f(src);
  if (m === src) { fail++; console.log(`FAIL break "${name}" did not change go.mjs (the pattern is stale)`); continue; }
  if (bad(run(m))) { caught++; console.log(`✓ caught: ${name}`); } else { fail++; console.log(`FAIL break "${name}" was NOT caught`); }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`gorunscheck: ${breaks.length + 1} assertions, ${fail} failures, ${caught} breaks caught`);
process.exit(fail || caught < breaks.length ? 1 : 0);
