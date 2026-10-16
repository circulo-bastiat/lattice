// tools/fulldispatchcheck.mjs - #7698 (16 Oct, commander). land.mjs dispatched full-suite.yml after EVERY landing whenever !HOSTED, including TEST_REMOTE=mirror: 15 full runs (16 shards each)
// in 8 h instead of the 4 the 2-hourly cron gives, a third of the free-plan mirror's 20 concurrent jobs. Under the mirror the schedule alone runs the full suite (Dan, 13 Oct).
import { readFileSync } from 'node:fs';
const LAND = readFileSync(new URL('./infra/land.mjs', import.meta.url), 'utf8');
const verdict = (src) => {
  const bad = [], lines = src.split('\n').filter((l) => /workflows\/full-suite\.yml\/dispatches/.test(l));
  for (const l of lines) {
    if (!/!HOSTED/.test(l)) bad.push('the full-suite dispatch must not run on hosted runners');
    if (!/!REMOTE/.test(l)) bad.push('the full-suite dispatch must not run per landing under TEST_REMOTE=mirror (the 2-hourly schedule does it)');
  }
  return bad;
};
const BREAKS = [
  ['mirror guard removed', LAND.replace('landed && !HOSTED && !REMOTE) await gh(\'POST\', \'/repos/{repo}/actions/workflows/full-suite', 'landed && !HOSTED) await gh(\'POST\', \'/repos/{repo}/actions/workflows/full-suite')],
  ['hosted guard removed', LAND.replace('landed && !HOSTED && !REMOTE) await gh(\'POST\', \'/repos/{repo}/actions/workflows/full-suite', 'landed && !REMOTE) await gh(\'POST\', \'/repos/{repo}/actions/workflows/full-suite')],
  ['unconditional dispatch', LAND.replace('landed && !HOSTED && !REMOTE) await gh(\'POST\', \'/repos/{repo}/actions/workflows/full-suite', 'landed) await gh(\'POST\', \'/repos/{repo}/actions/workflows/full-suite')],
];
const real = verdict(LAND), has = /full-suite\.yml\/dispatches/.test(LAND);
let caught = 0;
for (const [n, t] of BREAKS) { if (t !== LAND && verdict(t).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
if (!has) console.log(' note: no full-suite dispatch in land.mjs at all (fine, but then this check proves nothing)');
console.log(`fulldispatchcheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught !== BREAKS.length ? 1 : 0);
