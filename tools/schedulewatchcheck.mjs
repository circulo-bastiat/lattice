// schedulewatchcheck (22 Oct, Dan: "never leave a check to a session's discipline"): GitHub drops cron ticks and the private repo has no hosted minutes, so a workflow whose only
// trigger is `schedule:` can silently never run (heartbeat, metrics, pilot-farm sat dead or unstarted for days and nothing noticed). Every workflow with a `schedule:` must be
// declared here WITH its watchdog: the brain code that dispatches it when overdue or alerts when it is stale. A new scheduled workflow with no entry fails the core suite.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// workflow file -> [file that must contain the watchdog, text proving it]
export const WATCHDOGS = {
  'full-suite.yml': ['tools/brain/brain.mjs', 'fullDispatchDue'],        // #9180: the tick dispatches it when the newest run is over 130 min old
  'pilot-farm.yml': ['tools/brain/brain.mjs', 'farmDispatchDue'],        // #9435: the tick dispatches it when over 140 min old; route.mjs raises farm-stale at 360
  'brain.yml': ['tools/brain/tick.sh', 'health --if-due'],               // the schedule is only a backup: the systemd tick is the clock (#8958)
};
export function scheduled(files) { return Object.keys(files).filter((f) => /(^|\n)\s*schedule:/.test(files[f])); }
export function verdict(wf, src) {
  const bad = [];
  for (const f of scheduled(wf)) {
    const w = WATCHDOGS[f];
    if (!w) { bad.push(`${f} has a schedule: but no watchdog is declared for it (add it to WATCHDOGS with the code that dispatches or alerts on it)`); continue; }
    if (!(src[w[0]] || '').includes(w[1])) bad.push(`${f}: its watchdog '${w[1]}' is not in ${w[0]} any more`);
  }
  return bad;
}
const dir = join(ROOT, '.github', 'workflows');
const wf = Object.fromEntries(readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
const src = Object.fromEntries([...new Set(Object.values(WATCHDOGS).map((w) => w[0]))].map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));
const real = verdict(wf, src); for (const b of real) console.log(' FAIL: ' + b);
let caught = 0, wrong = 0;
const must = [
  ['a new scheduled workflow with no watchdog', () => verdict({ ...wf, 'newthing.yml': 'on:\n  schedule:\n    - cron: "0 * * * *"\n' }, src).some((x) => /newthing\.yml/.test(x))],
  ['a watchdog that was deleted from the brain', () => verdict(wf, { ...src, 'tools/brain/brain.mjs': src['tools/brain/brain.mjs'].replaceAll('farmDispatchDue', 'x') }).length >= 1 || !wf['pilot-farm.yml']],
  ['a declared workflow that stopped being scheduled is not flagged', () => verdict({ 'full-suite.yml': 'on:\n  push:\n' }, src).length === 0],
];
for (const [n, t] of must) { if (t()) { caught++; console.log(' \u2713 break caught: ' + n); } else { wrong++; console.log(' NOT CAUGHT: ' + n); } }
console.log(`schedulewatchcheck: ${real.length || wrong ? 'FAILED' : 'ok'} ${caught} breaks caught (of ${must.length}); ${scheduled(wf).length} scheduled of ${Object.keys(wf).length} workflows`);
process.exit(real.length || wrong ? 1 : 0);
