// tools/quietcheck.mjs - #3569 (Dan, 6 Oct): 9 testers on Max (#4298); 08:00-14:00 New York the Max total is halved. Anti-vacuity: each piece broken.
import { readFileSync } from 'node:fs';
import * as R from './brain/route.mjs';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const CFG = JSON.parse(rd('./brain/roles.json')), brain = rd('./brain/brain.mjs');
const Z = (s) => Date.parse(s);
const verdicts = (cfg, b, r = R) => {
  const bad = [], F = cfg.fill, W = (t) => r.fillWant({ fill: { ...F, until: '2099-01-01T00:00:00Z' } }, Z(t));
  const T = (t) => r.primaryCaps({ fill: F, accounts: [{ name: 'max' }] }, 'max', Z(t)).testers;
  if (F.testers !== 9 || F.workers !== 10 || F.maxTotal !== 10) bad.push('Max is not 10 total with 9 testers');
  if (W('2026-10-06T16:00Z') !== 5 || T('2026-10-06T16:00Z') !== 5) bad.push('inside 08:00-14:00 NY (EDT) the total is not 5 / testers 5');
  if (W('2026-10-06T11:59Z') !== 10 || T('2026-10-06T11:59Z') !== 9) bad.push('before 08:00 NY the fill is not full');
  if (W('2026-10-06T18:00Z') !== 10 || T('2026-10-06T18:01Z') !== 9) bad.push('from 14:00 NY (EDT) the fill is not full again');
  if (W('2026-11-03T13:30Z') !== 5 || W('2026-11-03T12:59Z') !== 10 || W('2026-11-03T19:00Z') !== 10) bad.push('DST: in November (EST) the window is not 13:00-19:00Z');
  const q = r.quietState({ fill: F }, Z('2026-10-06T12:00Z'));
  if (q.next !== Z('2026-10-06T18:00Z') || r.quietState({ fill: F }, Z('2026-10-06T20:00Z')).next !== Z('2026-10-07T12:00Z')) bad.push('quietState gives the wrong next flip');
  if (!/quietState\(CFG, now\)\.next[\s\S]{0,200}?await arm\(edge/.test(b)) bad.push('no waker armed for the 08:00/14:00 edges');
  return bad;
};
const real = verdicts(CFG, brain);
const BREAKS = [
  ['testers 2', () => [{ fill: { ...CFG.fill, testers: 2 } }, brain]],
  ['no halving', () => [{ fill: { ...CFG.fill, quiet: { ...CFG.fill.quiet, factor: 1 } } }, brain]],
  ['fixed UTC offset', () => [{ fill: { ...CFG.fill, quiet: { ...CFG.fill.quiet, tz: 'Etc/GMT+4' } } }, brain]],
  ['window shifted', () => [{ fill: { ...CFG.fill, quiet: { ...CFG.fill.quiet, to: '15:00' } } }, brain]],
  ['no edge waker', () => [CFG, brain.replace('await arm(edge', 'await (edge')]],
];
let caught = 0;
for (const [n, f] of BREAKS) { const v = verdicts(...f()); if (v.length) { caught++; console.log('  ✓ break caught: ' + n); } else console.log('NOT caught: ' + n); }
console.log(real.length ? real.join('\n') : 'quiet window ok');
console.log(`quietcheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${7 - real.length}`);
console.log(` failures ........... ${real.length}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
