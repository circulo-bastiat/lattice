// tools/landreportcheck.mjs - a lander bounce comment names the red check (28 Sept: three bounces of #64/#65 showed
// only the tail of the suite output, which is its SKIP list, so no session could see gateinfracheck was the red one).
// Pure: takes reds() out of tools/infra/land.mjs's source (importing land.mjs would run the lander).
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./infra/land.mjs', import.meta.url), 'utf8');
const body = (src.match(/export function reds\(out\) \{[\s\S]*?\n\}/) || [])[0];
if (!body) { console.log('landreportcheck: reds() not found in land.mjs\n failures ........... 1'); process.exit(1); }
const make = (code) => new Function(code.replace('export function reds', 'return function reds'))();
const skipList = Array.from({ length: 300 }, (_, i) => `x${i}check`).join(' ');
const OUT = [' ✓ stagecheck           12 ms  5 assertions, 0 failures', ' ✗ gateinfracheck     300 ms  6 assertions, 5 failures',
  '', '──── gateinfracheck FAILED ────', '  ✗ pending mail: expected exit 3, got 0', ' ✗ gateinfracheck     300 ms  6 assertions, 5 failures',
  'skipped: ' + skipList, '   --fast skips the browser stages.'].join('\n');
function verdicts(reds) {
  const bad = []; const r = reds(OUT); const shown = r.slice(-3500);   // bounce() keeps the last 3500 characters
  if (!/✗ gateinfracheck/.test(shown)) bad.push('the red row is not in the comment');
  if (!/expected exit 3, got 0/.test(shown)) bad.push("the failed stage's own output is not in the comment");
  if (/x299check/.test(shown)) bad.push('the skip list is in the comment');
  if ((shown.match(/^ ✗ gateinfracheck/gm) || []).length !== 1) bad.push('the red row is repeated');
  return bad;
}
const real = verdicts(make(body));
let caught = 0;
for (const [name, fn] of [['raw tail (the 28 Sept bug)', (o) => o], ['no FAILED blocks', (o) => o.split('\n').filter((l) => /^ ✗ /.test(l)).join('\n')],
  ['rows not de-duplicated', (o) => o.split('\n').filter((l) => /^ ✗ |exit 3/.test(l)).join('\n')]])
  if (verdicts(fn).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ break NOT caught: ${name}`);
for (const b of real) console.log(`  ✗ ${b}`);
console.log(`landreportcheck: ${4 - real.length} assertions passed, ${caught} breaks caught (of 3)`);
console.log(` assertions passed .... ${4 - real.length}`);
console.log(` failures ........... ${real.length + (3 - caught)}`);
process.exit(real.length || caught < 3 ? 1 : 0);
