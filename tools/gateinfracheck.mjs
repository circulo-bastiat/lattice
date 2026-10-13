#!/usr/bin/env node
// gateinfracheck.mjs — proves tools/infra/gate.mjs's automatic gate actually blocks and unblocks (#58; Dan, 28 Sept:
// "the check shouldn't be by their own whim, it should happen automatically"). The gate stops every build, test and
// hand-in in the whole project — until this check, nothing proved it actually does that, or that its off-switches
// actually switch off.
//
// ANTI-VACUITY: each case is a distinct branch of gate()'s decision (yield / pending mail / clear / bypasses /
// unreadable cache). A gate that silently stopped gating — flipped exit codes, a broken cache read, a bypass that
// never bypasses — would let sessions build past a message they were supposed to answer first, or block forever
// on one they should never have seen. gate() is exercised out-of-process (it calls process.exit() itself) against
// a throwaway fixture directory, never against this real workspace or the network.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const GATE_URL = pathToFileURL(join(MCLITE_ROOT, 'tools', 'infra', 'gate.mjs')).href;

let pass = 0; const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else fails.push(msg); };

// A fixture workspace: just enough for gate()'s own existsSync guards (tools/go.mjs, .git/) to let it proceed.
// The stub go.mjs is a real, do-nothing script — case 7 relies on it actually running and printing nothing.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mclite-gatecheck-'));
  mkdirSync(join(dir, 'tools'), { recursive: true });
  writeFileSync(join(dir, 'tools', 'go.mjs'), '// stub: never a real go.mjs, so a cache miss here must degrade quietly\n');
  mkdirSync(join(dir, '.git'), { recursive: true });
  return dir;
}
// The gate's own bypasses must be OFF in the child unless a case turns one on: this check runs on the landing runner,
// where GITHUB_ACTIONS is set, and inheriting it made every blocking case pass through (28 Sept: #64 bounced for it).
const BASE_ENV = { ...process.env }; delete BASE_ENV.GITHUB_ACTIONS; delete BASE_ENV.MCLITE_GATE;
// Nor may the host's free disk decide a case: the lander's tmp can be < 2 GB, and the disk guard exits 5 before mail/yield.
BASE_ENV.MCLITE_GATE_NODISK = '1';
function runGate(dir, cacheBody, env = {}, url = GATE_URL) {
  if (cacheBody !== undefined) writeFileSync(join(dir, '.git', 'mclite-gate.json'), cacheBody);
  return spawnSync(process.execPath, ['-e', `import(${JSON.stringify(url)}).then(({gate}) => gate(${JSON.stringify(dir)}))`],
    { encoding: 'utf8', timeout: 45000, env: { ...BASE_ENV, ...env } });
}
const fresh = (extra) => JSON.stringify({ at: Date.now(), ...extra });

// 1. a pending message must exit 3, print the message body and a reply command carrying the right id
{
  const dir = fixture();
  const r = runGate(dir, fresh({ pending: [{ id: 42, body: 'to: #58\nfrom: commander\n\nGate test.' }] }));
  ok(r.status === 3, `pending mail: expected exit 3, got ${r.status}`);
  ok(r.stdout.includes('Gate test.'), 'pending mail: message body not printed');
  ok(r.stdout.includes('go.mjs reply 42'), 'pending mail: reply command missing or has the wrong message id');
  rmSync(dir, { recursive: true, force: true });
}

// 2. yield (issue closed or taken over) must exit 4, and win over pending mail — there is no point answering
//    mail on an issue you must already stop
{
  const dir = fixture();
  const r = runGate(dir, fresh({ yield: 'issue #58 was closed', pending: [{ id: 1, body: 'x' }] }));
  ok(r.status === 4, `yield: expected exit 4, got ${r.status}`);
  ok(r.stdout.includes('issue #58 was closed'), 'yield: reason not printed');
  rmSync(dir, { recursive: true, force: true });
}

// 3. a clear cache (no pending, no yield) must NOT stop the session
{
  const dir = fixture();
  const r = runGate(dir, fresh({}));
  ok(r.status === 0, `clear: expected exit 0 (work continues), got ${r.status}`);
  rmSync(dir, { recursive: true, force: true });
}

// 4. GITHUB_ACTIONS (the landing runners) must never gate, even with pending mail cached — a broken bypass here
//    would make every landing block on Dan replying to a GitHub comment
{
  const dir = fixture();
  const r = runGate(dir, fresh({ pending: [{ id: 1, body: 'x' }] }), { GITHUB_ACTIONS: 'true' });
  ok(r.status === 0, `GITHUB_ACTIONS bypass: expected exit 0, got ${r.status}`);
  rmSync(dir, { recursive: true, force: true });
}

// 5. MCLITE_GATE=off (gate's own recursion guard for its `go.mjs gatecheck` child process) must also bypass
{
  const dir = fixture();
  const r = runGate(dir, fresh({ pending: [{ id: 1, body: 'x' }] }), { MCLITE_GATE: 'off' });
  ok(r.status === 0, `MCLITE_GATE=off bypass: expected exit 0, got ${r.status}`);
  rmSync(dir, { recursive: true, force: true });
}

// 6. no .git directory at all (this runs on Dan's synced Projects folder before any clone/claim exists there)
//    must never gate
{
  const dir = mkdtempSync(join(tmpdir(), 'mclite-gatecheck-'));
  mkdirSync(join(dir, 'tools'), { recursive: true });
  writeFileSync(join(dir, 'tools', 'go.mjs'), '// stub\n');
  const r = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(GATE_URL)}).then(({gate}) => gate(${JSON.stringify(dir)}))`],
    { encoding: 'utf8', timeout: 45000 });
  ok(r.status === 0, `no .git: expected exit 0 (never gates), got ${r.status}`);
  rmSync(dir, { recursive: true, force: true });
}

// 7. an unreadable/corrupt cache must degrade quietly, not crash the session: gate() falls back to asking a
//    (stubbed, silent) go.mjs gatecheck, gets no parseable answer, and must let work continue rather than throw
{
  const dir = fixture();
  const r = runGate(dir, '{ not json');
  ok(r.status === 0, `corrupt cache: expected a quiet exit 0, got ${r.status}`);
  ok(!/Error|Traceback/i.test(r.stderr), `corrupt cache: gate() must not crash — stderr: ${r.stderr.slice(0, 200)}`);
  rmSync(dir, { recursive: true, force: true });
}

// ANTI-VACUITY (D-30; the lander refuses a new check without it): three broken copies of the real gate.mjs, each
// must be caught by the same probes the cases above use.
{
  const src = readFileSync(fileURLToPath(GATE_URL), 'utf8');
  const BREAKS = [
    ['pending mail no longer blocks', 'process.exit(3);', 'process.exit(0);', (u, d) => runGate(d, fresh({ pending: [{ id: 42, body: 'x' }] }), {}, u).status !== 3],
    ['a closed issue no longer yields', 'process.exit(4);', 'process.exit(0);', (u, d) => runGate(d, fresh({ yield: 'closed' }), {}, u).status !== 4],
    ['the runner bypass removed', "if (process.env.GITHUB_ACTIONS || process.env.MCLITE_GATE === 'off') return;", '',
      (u, d) => runGate(d, fresh({ pending: [{ id: 1, body: 'x' }] }), { GITHUB_ACTIONS: 'true' }, u).status !== 0],
  ];
  let caught = 0;
  for (const [name, from, to, isCaught] of BREAKS) {
    const bdir = mkdtempSync(join(tmpdir(), 'mclite-gatebreak-'));
    if (!src.includes(from)) { fails.push(`break "${name}": gate.mjs no longer contains ${from} - update this check`); continue; }
    writeFileSync(join(bdir, 'gate.mjs'), src.split(from).join(to));
    const d = fixture();
    if (isCaught(pathToFileURL(join(bdir, 'gate.mjs')).href, d)) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
    rmSync(d, { recursive: true, force: true }); rmSync(bdir, { recursive: true, force: true });
  }
  console.log(`gateinfracheck: ${caught} breaks caught (of ${BREAKS.length})`);
}

console.log(`gateinfracheck: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  ✗ ${f}`);
console.log(` assertions passed .... ${pass}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
