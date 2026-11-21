// tools/infra/fullgate.mjs - run first by full-suite.yml's full-pc job (Dan, 10 Oct: "why is the lander still so slow").
// MEASURED 10 Oct: the PC runs the lander AND the full suite (17-27 min per run, restarted by every landing, two runs of 21 and 27 min
// were cancelled by the next landing and thrown away), so free RAM fell to ~1 GB and each PR took ~3.5 min instead of ~1.
// Now the full suite WAITS until landings pause: no PR labelled `land`, no lander run queued or running, and master unchanged for
// QUIET_MS. A newer master cancels this waiting run (concurrency cancel-in-progress), so waiting costs no CPU and no run is wasted.
// It never starves: after MAX_WAIT_MS it runs anyway. Any GitHub error also lets it run (a broken gate must not hide a red master).
import { gh, ghAll } from './gh.mjs';

export const QUIET_MS = 4 * 60e3, MAX_WAIT_MS = 30 * 60e3, STEP_MS = 60e3;
/** pure: should the full suite start now? */
export function decide({ now, headAt, landPRs, landRunning, waitedMs }) {
  if (waitedMs >= MAX_WAIT_MS) return { go: true, why: `waited ${Math.round(waitedMs / 60e3)} min: running anyway (the suite never starves)` };
  if (landPRs > 0) return { go: false, why: `${landPRs} PR(s) labelled land are queued` };
  if (landRunning > 0) return { go: false, why: `${landRunning} lander run(s) queued or running` };
  if (now - headAt < QUIET_MS) return { go: false, why: `master changed ${Math.round((now - headAt) / 1000)} s ago (quiet needed: ${QUIET_MS / 1000} s)` };
  return { go: true, why: 'landings are quiet' };
}
async function snapshot() {
  const head = await gh('GET', '/repos/{repo}/commits/master');
  const prs = await ghAll('/repos/{repo}/pulls?state=open');
  const runs = [];
  for (const st of ['in_progress', 'queued']) runs.push(...((await gh('GET', `/repos/{repo}/actions/workflows/land.yml/runs?status=${st}&per_page=20`)).workflow_runs || []));
  return { headAt: Date.parse(head.commit.committer.date), landPRs: prs.filter((p) => (p.labels || []).some((l) => l.name === 'land')).length, landRunning: runs.length };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function main() {
  const t0 = Date.now();
  for (;;) {
    let d;
    try { d = decide({ now: Date.now(), waitedMs: Date.now() - t0, ...(await snapshot()) }); } catch (e) { d = { go: true, why: `could not read GitHub (${String(e.message).slice(0, 80)}): running` }; }
    console.log(`${new Date().toISOString()} fullgate: ${d.go ? 'GO' : 'wait'} - ${d.why}`);
    if (d.go) return;
    await sleep(STEP_MS);
  }
}
if (process.argv[1] && /fullgate\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) await main();
