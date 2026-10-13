// tools/infra/full.mjs - run by full-suite.yml on a GPU runner: the WHOLE suite, then open/refresh or close the
// `master is red` issue. Quarantined checks (tools/quarantine.json) are reported but never make master red.
import { spawnSync } from 'node:child_process';
import { existsSync, symlinkSync, readFileSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { gh, ghAll, busIssue, ROOT } from './gh.mjs';
import { updateLocalCopy } from './localcopy.mjs';
import { applyRedIssues } from './redissues.mjs';
import { envFault, openFaultIssue } from './runnerguard.mjs';
import { setPriority, constants as OS } from 'node:os';
// #102: the full suite shares the PC with the lander; at below-normal priority (inherited by the suite and its
// browsers) a landing's core suite gets the CPU first. 28 Sept: tagcheck/gateinfracheck timed out under this load.
try { setPriority(0, OS.priority.PRIORITY_BELOW_NORMAL); } catch { /* not permitted: run as before */ }
import { logEvidence } from './browserslots.mjs';
import { mergeShards } from './fullshard.mjs';
const AGG = process.env.FULL_AGG_DIR;   // hosted (Dan, 6 Oct): the 16 shard results, merged here; unset = the whole suite on this PC
logEvidence('full start', ROOT);
const DATA = process.env.MCLITE_DATA;
for (const d of ['jars', '.mcdata', '.mcsnd', '.chromium', '.decomp'])   // never assets/: it is generated per checkout (D-6)
  if (DATA && existsSync(join(DATA, d)) && !existsSync(join(ROOT, d))) symlinkSync(join(DATA, d), join(ROOT, d), 'junction');
const merged = AGG ? mergeShards(AGG) : null;
// a newer master cancels this run's shards (concurrency cancel-in-progress) but the aggregate can still start: missing shards
// of a superseded run are not a fault (#3984). Only a run that is still the newest may report them.
if (merged && merged.ledger.failedStages.some((f) => /^pack-shard-\d+-missing$/.test(f)) && process.env.GITHUB_RUN_ID) {
  const runs = await gh('GET', '/repos/{repo}/actions/workflows/full-suite.yml/runs?per_page=5').catch(() => null);
  if (runs && runs.workflow_runs.some((x) => x.id > Number(process.env.GITHUB_RUN_ID))) { console.log('superseded by a newer full-suite run; shards missing, nothing reported'); process.exit(0); }
}
const r = merged ? { stdout: merged.out, stderr: '' } : spawnSync('node', ['tools/suite.mjs'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 27, env: { ...process.env, MCLITE_PRESET: 'medium' } });
const out = r.stdout + r.stderr;
logEvidence('full end', ROOT);
// the suite's own record, never a scrape of its output (detail lines contain words like FAIL too: issue #50 listed
// "the", "and", "live" as red checks)
const ledger = merged ? merged.ledger : (() => { try { return JSON.parse(readFileSync(join(ROOT, '.ledger', 'suite-last.json'), 'utf8')); } catch { return null; } })();
const failed = ledger ? ledger.failedStages || [] : ['suite-ledger-missing'];
const q = existsSync(join(ROOT, 'tools', 'quarantine.json')) ? JSON.parse(readFileSync(join(ROOT, 'tools', 'quarantine.json'), 'utf8')) : {};
const real = failed.filter((id) => !q[id]);
const open = (await ghAll('/repos/{repo}/issues?state=open&labels=master-red'))[0];
const sha = (process.env.GITHUB_SHA || '').slice(0, 7);
// each red stage's own "──── id FAILED ────" block (suite.mjs prints its last 25 lines): the old out.slice(-3000) was
// the summary table's tail, so a day of #50 comments said WHICH checks were red on the PC but never WHY
const why = (id) => {
  const L = out.split('\n'), i = L.findIndex((l) => l.includes(`──── ${id} FAILED ────`));
  if (i < 0) return `──── ${id}: no FAILED block in the suite output`;
  let j = i + 1;
  while (j < L.length && j <= i + 25 && !/^(────|====)/.test(L[j])) j++;
  return L.slice(i, j).join('\n').trimEnd();
};
// #3568: a broken runner is not a broken master. Mass failure / setup-stage failure = ENVIRONMENT FAULT: no master-red, no
// per-check RED issues; quarantine this runner, ONE issue, mail fixer + commander.
const prevFile = join(process.env.MCLITE_DATA || ROOT, 'full-last-failed.json');
const prev = (() => { try { return JSON.parse(readFileSync(prevFile, 'utf8')); } catch { return null; } })();
const faultFile = join(process.env.MCLITE_DATA || ROOT, 'full-last-fault.json');   // #6627: a repeat of the same mass failure is master's
const prevFault = (() => { try { return JSON.parse(readFileSync(faultFile, 'utf8')); } catch { return null; } })();
const fault = envFault({ failed: real, ran: ledger ? ledger.ran : 0, prev, prevFault });
try { writeFileSync(faultFile, JSON.stringify(fault ? real : [])); } catch { /* best effort */ }
const runner = process.env.RUNNER_NAME || 'unknown';
if (!fault) try { writeFileSync(prevFile, JSON.stringify(real)); } catch { /* no baseline next time: only setup faults */ }
if (fault) {
  // github.token cannot edit runner labels (403, 6 Oct): the open fault issue IS the request; the brain health pass (PAT) removes
  // gpu/express, except from the last online gpu runner
  const n = await openFaultIssue(gh, runner, fault, `first failures: ${real.slice(0, 8).join(', ')}\n\n${real.slice(0, 2).map(why).join('\n\n')}`);
  for (const to of ['fixer', 'commander']) await gh('POST', `/repos/{repo}/issues/${await busIssue()}/comments`, { body: `to: ${to}\nfrom: full-suite\n\nrunner ${runner} ENVIRONMENT FAULT (#${n}): ${fault}. The brain removes the labels unless this is the last gpu runner; no RED issues filed.` }).catch(() => {});
  console.log(`ENVIRONMENT FAULT on ${runner}: ${fault} (#${n}); no RED issues`);
} else if (real.length) {
  const body = `Full suite on ${process.env.RUNNER_NAME || 'a PC'} at ${sha}: **${real.length} red** - ${real.join(', ')}\n\n\`\`\`\n${real.map(why).join('\n\n').slice(0, 60000)}\n\`\`\``;
  if (open) await gh('POST', `/repos/{repo}/issues/${open.number}/comments`, { body });
  else await gh('POST', '/repos/{repo}/issues', { title: 'master is red', body, labels: ['master-red', 'severe'] });
} else if (open) {
  await gh('POST', `/repos/{repo}/issues/${open.number}/comments`, { body: `Green at ${sha}.` });
  await gh('PATCH', `/repos/{repo}/issues/${open.number}`, { state: 'closed' });
}
// #1912: one issue per red check (opened, reopened, closed here) so the worker fill takes each red without a commander
// splitting this aggregate issue by hand. Only with a real ledger: without one nothing is known to have run.
if (ledger && !fault) await applyRedIssues(gh, ghAll, { failed, skipped: ledger.skipped || [], quarantine: q, sha, why });
console.log(real.length ? `RED ${real.join(',')}` : 'GREEN', failed.length - real.length ? `(quarantined red: ${failed.filter((i) => q[i]).join(',')})` : '');
// Keep Dan's own copy current: Projects\mclite is where he double-clicks dist/mclite.html, and no session edits it
// any more (they work in clones), so it only ever fast-forwards. Syncthing carries the result to his other PCs.
if (!AGG) updateLocalCopy(DATA, { force: true });   // tools/infra/localcopy.mjs (land.mjs calls it too: this run is often cancelled)
process.exit(0);
