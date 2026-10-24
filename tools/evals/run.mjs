#!/usr/bin/env node
// run.mjs - replay past issues against the CURRENT worker prompt (#7774).
//   node tools/evals/run.mjs [--case cID | --all] [--repeat 3] [--dry]
// Each case: throwaway git worktree at the case's pre sha, `claude -p` with roles.json worker prompt on the lowest worker
// model, then the end-state checks (stage ids the good PR added/changed) run with suite --fast. No judge call is made
// unless a case lists "required" items a script cannot score (judge: one call, 0-1 + pass/fail).
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scoreCase, isFlaky, budgetGate, reportText } from './lib.mjs';
const ROOT = join(import.meta.dirname, '..', '..');
const roles = JSON.parse(readFileSync(join(ROOT, 'tools/brain/roles.json'), 'utf8'));
const B = roles.evals, args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const all = JSON.parse(readFileSync(join(import.meta.dirname, 'worker-cases.json'), 'utf8')).cases;
let cases = opt('--case') ? all.filter((c) => c.id === opt('--case')) : args.includes('--all') ? all : [];
if (!cases.length) { console.error('give --case <id> or --all'); process.exit(2); }
const repeat = +(opt('--repeat') || 1), dry = args.includes('--dry');
const hash = createHash('sha256').update(JSON.stringify(roles.roles.worker) + (readTools() || '')).digest('hex').slice(0, 12);
function readTools() { try { return readFileSync(join(ROOT, 'tools/brain/tools.json'), 'utf8'); } catch { return ''; } }
const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
let tokens = 0, minutes = 0;
const results = [];
for (const c of cases.slice(0, B.maxCasesPerRun)) {
  const runs = [];
  for (let i = 0; i < repeat; i++) {
    const gate = budgetGate(B, { cases: cases.length, model: B.model, usagePct: +(process.env.MCLITE_USAGE_PCT || 0), tokensSoFar: tokens });
    if (!gate.ok) { console.error('BUDGET: ' + gate.why); break; }
    const ids = g(ROOT, 'diff', '--name-only', c.pre, c.good, '--', 'tools/stages.d').split('\n').filter(Boolean).map((f) => f.replace(/^.*\/|\.json$/g, ''));
    let r = { checks: ids.map((id) => ({ id, pass: false })), required: c.required || [], tokens: 0, minutes: 0 };
    if (!dry) {
      const wt = mkdtempSync(join(tmpdir(), 'eval-'));
      g(ROOT, 'worktree', 'add', '--detach', wt, c.pre);
      const t0 = Date.now();
      const p = spawnSync('claude', ['-p', roles.roles.worker.prompt.replace('{reason}', `eval case ${c.id}: issue #${c.issue}: ${c.subject}`), '--model', B.model, '--output-format', 'json', '--max-turns', String(B.maxTurns)], { cwd: wt, encoding: 'utf8', maxBuffer: 1 << 28 });
      try { const j = JSON.parse(p.stdout); const u = j.usage || {}; r.tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0); } catch {}
      r.minutes = (Date.now() - t0) / 6e4;
      r.checks = ids.map((id) => ({ id, pass: spawnSync('node', ['tools/suite.mjs', '--fast', '--only', id], { cwd: wt }).status === 0 }));
      g(ROOT, 'worktree', 'remove', '--force', wt);
    }
    tokens += r.tokens; minutes += r.minutes;
    runs.push(scoreCase(r, B));
  }
  if (runs.length) results.push({ id: c.id, kind: c.kind, pass: runs.every((x) => x.pass), flaky: isFlaky(runs), runs });
}
const text = reportText(results, { tokens, minutes });
console.log(text);
mkdirSync(join(ROOT, 'tools/evals/reports'), { recursive: true });
writeFileSync(join(ROOT, 'tools/evals/reports', `${hash}.json`), JSON.stringify({ hash, text, results }, null, 1));
