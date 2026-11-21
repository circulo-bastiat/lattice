// #10414: which PC pieces Dan can switch off NOW. Pure verdict over the repo variables and the last day's private-repo workflow runs; the CLI reads them
// through gh() and prints one line per piece (never a token). A piece is "retire" only when the hosted path is switched on AND the PC path did no work for 24 h.
import { gh } from './gh.mjs';
export const DAY = 24 * 3600e3;
// piece -> [workflow file, the repo-variable test that says the hosted path is on]
export const PIECES = {
  'Hyper-V brain VM': ['brain.yml', (v) => v.BRAIN_RUNNER === 'mirror'],
  'lander runners -land/-land2': ['land.yml', (v) => v.TEST_RUNNER === 'lattice' || v.TEST_RUNNER === 'mirror'],
  'phone relay (relay.yml)': ['relay.yml', (v) => v.BRAIN_RUNNER === 'mirror'],
  'full-suite GPU runner': ['full-suite.yml', (v) => !!v.TEST_RUNNER && v.TEST_RUNNER !== 'pc'],
  'usaged service': [null, (v) => v.BRAIN_RUNNER === 'mirror'],
  'idle DADS runners': [null, (v) => v.BRAIN_RUNNER === 'mirror' && !!v.TEST_RUNNER && v.TEST_RUNNER !== 'pc'],
};
// DADS* runners have no workflow of their own: PC work = one of them is busy right now (runners = the /actions/runners list)
export const dadsBusy = (runners) => (runners || []).filter((r) => /^DADS/i.test(String(r.name || '')) && r.busy).length;
// usaged has no workflow: it stamps the MCLITE_USAGE variable ({at, host}). PC work = the last stamp is under 24 h old and came from a Windows PC host (the hosted tick's host is a Linux runner)
export function usagedPcWork(vars, now = Date.now()) {
  let r = null; try { r = JSON.parse((vars || {}).MCLITE_USAGE); } catch {}
  return r && /^DESKTOP-/i.test(String(r.host || '')) && now - Date.parse(r.at) < DAY ? 1 : 0;
}
// pcWork: runs of that workflow in the last 24 h that actually ran (not skipped / cancelled); the hosted path leaves the PC job skipped.
// A run still `queued` after an hour was never picked up by any PC runner (the VM is off or idle): that is stuck, not work, and must not block retiring.
export const STUCK = 3600e3;
export function pcWork(runs, now = Date.now()) {
  return (runs || []).filter((r) => now - Date.parse(r.created_at) < DAY && r.conclusion !== 'skipped' && r.conclusion !== 'cancelled' && !(r.status === 'queued' && now - Date.parse(r.created_at) > STUCK)).length;
}
// the repo variable that switches a piece's hosted path on (what the 'keep' line tells Dan to set)
export const SWITCH = { BRAIN_RUNNER: 'BRAIN_RUNNER=mirror', TEST_RUNNER: 'TEST_RUNNER=lattice' };
export const switchFor = (piece) => (/lander|full-suite/.test(piece) ? SWITCH.TEST_RUNNER : piece === 'idle DADS runners' ? `${SWITCH.BRAIN_RUNNER} and ${SWITCH.TEST_RUNNER}` : SWITCH.BRAIN_RUNNER);
export function readiness(vars, runsByFile, now = Date.now(), runners = []) {
  return Object.entries(PIECES).map(([piece, [file, on]]) => {
    if (!on(vars || {})) return { piece, verdict: 'keep', why: `hosted path is not switched on: set repo variable ${switchFor(piece)}` };
    const n = file ? pcWork(runsByFile[file], now) : piece === 'idle DADS runners' ? dadsBusy(runners) : usagedPcWork(vars, now);
    return n ? { piece, verdict: 'keep', why: `${file ? `${n} PC run(s) of ${file}` : piece === 'idle DADS runners' ? `${n} DADS runner(s) busy now` : 'the PC usaged stamped MCLITE_USAGE'} in the last 24 h` } : { piece, verdict: 'retire', why: 'hosted path on and no PC work for 24 h' };
  });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const list = await gh('GET', '/repos/{repo}/actions/variables?per_page=100');
  const vars = Object.fromEntries(((list && list.variables) || []).map((x) => [x.name, x.value]));
  const runsByFile = {};
  for (const [, [file]] of Object.entries(PIECES)) if (file) runsByFile[file] = ((await gh('GET', `/repos/{repo}/actions/workflows/${file}/runs?per_page=30`)) || {}).workflow_runs || [];
  const rl = await gh('GET', '/repos/{repo}/actions/runners?per_page=100');
  for (const r of readiness(vars, runsByFile, Date.now(), (rl && rl.runners) || [])) console.log(`${r.verdict.toUpperCase().padEnd(6)} ${r.piece}: ${r.why}`);
}
