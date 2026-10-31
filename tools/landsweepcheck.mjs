// tools/landsweepcheck.mjs - #4976. The lander itself re-queues the PRs it bounced for a conflict GitHub now calls clean (autorebase sweep, twice,
// after the queue drains), so recovery never waits on the brain VM's 15-min health pass (down for 10 h on 10 Oct). Anti-vacuity below.
import { readFileSync } from 'node:fs';
const land = readFileSync(new URL('./infra/land.mjs', import.meta.url), 'utf8');
const verdict = (src) => {
  const bad = [], drained = src.indexOf('queue drained:'), call = src.indexOf('rebaseSweep({');
  if (!/import \{ sweep as rebaseSweep \} from '\.\/autorebase\.mjs'/.test(src)) bad.push('land.mjs does not import the auto-rebase sweep');
  if (!(call > 0 && call < drained)) bad.push('the sweep is not called before the run ends');
  if (!/pass < 2/.test(src)) bad.push('the sweep runs once only (GitHub mergeable is null on the first read)');
  if (!/catch \(e\) \{ console\.log\('auto-rebase sweep failed/.test(src)) bad.push('a sweep failure could crash the lander run');
  const loopEnd = src.indexOf('queue not empty (50 rounds'); if (!(call > loopEnd && loopEnd > 0)) bad.push('the sweep runs before the queue loop, not after it');
  return bad;
};
const BREAKS = [
  ['import removed', (s) => s.replace("import { sweep as rebaseSweep }", "import { sweepX as rebaseSweep }")],
  ['sweep never called', (s) => s.replace('rebaseSweep({', 'noop({')],
  ['called after the end', (s) => s.replace('rebaseSweep({', 'noop({') + '\nrebaseSweep({ gh })'],
  ['one pass only', (s) => s.replace('pass < 2', 'pass < 1')],
  ['no try/catch', (s) => s.replace("catch (e) { console.log('auto-rebase sweep failed", "catch (e) { throw (console.log('auto-rebase sweep failed")],
];
const real = verdict(land);
let caught = 0;
for (const [n, mk] of BREAKS) { const m = mk(land); if (m !== land && verdict(m).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const b of real) console.log(' FAIL:', b);
console.log(`landsweepcheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
