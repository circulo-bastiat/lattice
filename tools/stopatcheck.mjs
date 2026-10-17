// tools/stopatcheck.mjs - the hourly loop stops at loop.json's stop_at (28 Sept: the loop's task became an hourly
// schedule, so nothing but workers() stops it once Dan's Max plan ends). Pure: evaluates workers() from go.mjs's source.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('./go.mjs', import.meta.url), 'utf8');
const make = (src) => {
  const body = (src.match(/async function workers\(\) \{[\s\S]*?\n\}/) || [''])[0];
  return (L, u) => new Function('usage', 'readFileSync', 'join', 'ROOT', body.replace('async function workers', 'return async function'))(
    async () => u, () => JSON.stringify(L), () => '', '')();
};
const H = 3600e3, now = Date.now(), u = { ok: true, week: { pct: 20 }, window: { pct: 10 } };
async function verdicts(src) {
  const w = make(src), bad = [];
  if (await w({ enabled: true, stop_at: new Date(now - H).toISOString() }, u) !== 0) bad.push('past stop_at still starts workers');
  if (await w({ enabled: true, stop_at: new Date(now + 10 * 60e3).toISOString(), stop_margin_min: 30 }, u) !== 0) bad.push('inside the stop margin still starts workers');
  if (await w({ enabled: false }, u) !== 0) bad.push('a switched-off loop still starts workers');
  if (await w({ enabled: true, stop_at: new Date(now + 5 * H).toISOString() }, u) !== 4) bad.push('before stop_at the loop does not get its workers');
  return bad;
}
const real = await verdicts(SRC);
const BREAKS = [['stop_at check removed', (s) => s.replace(/  if \(!L\.enabled \|\| \(L\.stop_at[^\n]*\n/, '')],
  ['margin ignored', (s) => s.replace(' - (L.stop_margin_min || 30) * 60e3', '')]];
let caught = 0;
for (const [n, br] of BREAKS) { const m = br(SRC); if (m !== SRC && (await verdicts(m)).length) { caught++; console.log(`  ✓ break caught: ${n}`); } else console.log(`  ✗ break NOT caught: ${n}`); }
for (const b of real) console.log(`  ✗ ${b}`);
console.log(`stopatcheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${4 - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
