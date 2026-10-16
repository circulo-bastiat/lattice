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
// #6767 (Dan, 13 Oct): TEST_REMOTE=mirror -> this PC only pushes the snapshot and gathers the 16 shard results the public test mirror's
// hosted runners produced (tools/infra/mirror.mjs runFull); everything below (aggregate, master-red, per-check issues) is unchanged.
// #7184: FULL_MODE (repo variable) = off (do nothing) | dry (run, write _status/full-dry-<sha>.json, NO issue writes) | on (default). FULL_SOURCE=pc (a
// workflow_dispatch input) runs the whole suite on this PC even when TEST_REMOTE=mirror: the GPU PC is the reference the mirror is judged against.
const MODE = (process.env.FULL_MODE || 'on').toLowerCase();
if (MODE === 'off') { console.log('FULL_MODE=off: the full suite is switched off; nothing run, nothing reported'); process.exit(0); }
const MIRRORED = !process.env.FULL_AGG_DIR && process.env.FULL_SOURCE !== 'pc' && process.env.MCLITE_TEST_REMOTE === 'mirror';
const AGG = process.env.FULL_AGG_DIR || (MIRRORED ? await (await import('./mirror.mjs')).runFull() : undefined);   // hosted (Dan, 6 Oct): the 16 shard results, merged here; unset = the whole suite on this PC
logEvidence('full start', ROOT);
const DATA = process.env.MCLITE_DATA;
for (const d of ['jars', '.mcdata', '.mcsnd', '.chromium', '.decomp'])   // never assets/: it is generated per checkout (D-6)
  if (DATA && existsSync(join(DATA, d)) && !existsSync(join(ROOT, d))) symlinkSync(join(DATA, d), join(ROOT, d), 'junction');
const merged = AGG ? mergeShards(AGG) : null;
// a newer master cancels this run's shards (concurrency cancel-in-progress) but the aggregate can still start: missing shards
// of a superseded run are not a fault (#3984). Only a run that is still the newest may report them.
// a mirror run whose shards did not report is the MIRROR's fault, never this PC's: report nothing (no env-fault issue that would strip
// this runner's gpu label), fail the job so it shows, and the next full-suite run tries again
if (MIRRORED && merged && merged.ledger.failedStages.some((f) => /^pack-shard-\d+-missing$/.test(f))) {
  console.log(`mirror run incomplete: ${merged.ledger.failedStages.filter((f) => /^pack-shard-\d+-missing$/.test(f)).join(', ')}; nothing reported`); process.exit(1);
}
if (!MIRRORED && merged && merged.ledger.failedStages.some((f) => /^pack-shard-\d+-missing$/.test(f)) && process.env.GITHUB_RUN_ID) {
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
const flaky = merged ? merged.ledger.flaky || [] : [];
if (flaky.length) console.log(`flaky (failed once, passed on the retry; not red): ${flaky.join(',')}`);
if (MODE === 'dry') {   // measure only: no master-red, no per-check RED issues, no env-fault, no runner quarantine
  const dry = { sha: process.env.GITHUB_SHA || '', source: MIRRORED || AGG ? 'mirror' : 'pc', ran: ledger ? ledger.ran : 0, failed: real, quarantinedRed: failed.filter((id) => q[id]), flaky };
  const out2 = join(process.env.MCLITE_PROJECTS || ROOT, '_status'); try { writeFileSync(join(out2, `full-dry-${dry.source}-${(dry.sha || 'nosha').slice(0, 8)}.json`), JSON.stringify(dry, null, 1)); } catch { /* no _status here */ }
  console.log(`DRY RUN (${dry.source}): ran ${dry.ran}, red ${real.length}: ${real.join(',')}`);
  process.exit(0);
}
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
if (ledger && !fault) try {   // #7520: proven-mob ledger vs the fresh matrix
  const { buildMatrix } = await import('../mobproof.mjs'), { applyProven } = await import('../mobproof-proven.mjs');
  await applyProven(gh, ghAll, buildMatrix(), join(ROOT, 'tools', 'mobproof-proven.json'));
} catch (e) { console.log(`mobproof: ${String(e.message).slice(0, 100)}`); }
console.log(real.length ? `RED ${real.join(',')}` : 'GREEN', flaky.length ? `(flaky: ${flaky.join(',')})` : '', failed.length - real.length ? `(quarantined red: ${failed.filter((i) => q[i]).join(',')})` : '');
// Keep Dan's own copy current: Projects\mclite is where he double-clicks dist/mclite.html, and no session edits it
// any more (they work in clones), so it only ever fast-forwards. Syncthing carries the result to his other PCs.
if (!AGG || MIRRORED) updateLocalCopy(DATA, { force: true });   // tools/infra/localcopy.mjs (land.mjs calls it too: this run is often cancelled)
process.exit(0);
