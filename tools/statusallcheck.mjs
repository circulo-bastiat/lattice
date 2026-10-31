// #7689: the "7 workers running -> ask all, wait for all replies" rule (tools/infra/statusall.mjs).
import { STATUS_AT, shouldAsk, collect } from './infra/statusall.mjs';
const rep = (from, re) => ({ body: `to: brain\nfrom: ${from}\nre: ${re}\n\nok` });
const W = ['w1', 'w2', 'w3'];
function verdict(f) { const bad = [];
  if (!f.shouldAsk(7, false)) bad.push('7 running must ask');
  for (const n of [0, 6, 8]) if (f.shouldAsk(n, false)) bad.push(`${n} running must not ask`);
  if (f.shouldAsk(7, true)) bad.push('must not ask twice while waiting');
  if (f.collect([rep('w1', 5), rep('w2', 5)], 5, W).done) bad.push('2 of 3 replies is not done');
  if (f.collect([rep('w1', 5), rep('w2', 5)], 5, W).missing.join() !== 'w3') bad.push('missing wrong');
  if (!f.collect([rep('w1', 5), rep('w2', 5), rep('W3', 5)], 5, W).done) bad.push('all replies must be done');
  if (f.collect([rep('w1', 4), rep('w2', 4), rep('w3', 4)], 5, W).done) bad.push('replies to another ask do not count');
  return bad; }
let bad = verdict({ shouldAsk, collect }); bad.forEach((b) => console.log('FAIL', b));
const breaks = [{ shouldAsk: (r, p) => r >= 7 && !p, collect }, { shouldAsk: (r) => r === 7, collect }, { shouldAsk: (r, p) => r === 6 && !p, collect },
  { shouldAsk, collect: (c, i, e) => ({ ...collect(c, i, e), done: true }) }, { shouldAsk, collect: (c, i, e) => collect(c, '', e) }];
let caught = 0; for (const b of breaks) if (verdict(b).length) caught++;
console.log(`STATUS_AT=${STATUS_AT}; ${caught}/${breaks.length}; ${caught} breaks caught`); if (caught < breaks.length && !bad.includes('vacuous')) bad.push('vacuous');
console.log(bad.length ? 'statusallcheck FAIL' : 'statusallcheck ok'); process.exit(bad.length ? 1 : 0);
