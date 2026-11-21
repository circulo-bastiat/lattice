// tools/busclosecheck.mjs - #10967 (1 Nov 2026): a claim of the bus issue (#10961) landed "Closes #10961" and the bus went dark ~6 h.
// Guards: go.mjs claim() refuses a bus-labelled issue (explicit --issue too); land.mjs refuses such a PR and afterMerge never closes it.
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const load = (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const verdicts = async (h, l, g) => {
  const bad = [], m = await load(h);
  const bus = async () => ({ labels: [{ name: 'bus' }] }), plain = async () => ({ labels: [{ name: 'infra' }] });
  if (!(await m.busBranch('work/10961-message-bus', bus))) bad.push('busBranch misses a bus issue');
  if (await m.busBranch('work/5-x', plain)) bad.push('busBranch flags an ordinary issue');
  if (!m.isBusIssue({ labels: [{ name: 'bus' }] }) || m.isBusIssue({ labels: [] })) bad.push('isBusIssue wrong');
  if (!/async function claim\(issue, inReview\) \{\n  if \(isBusIssue\(issue\)\) \{[^\n]*return null;/.test(g)) bad.push('go.mjs claim() does not refuse a bus issue first');
  if ((l.match(/await busBranch\(pr\.head\.ref[^\n]*refuseBus/g) || []).length < 2) bad.push('land.mjs: landOne and landBatch must both refuse a bus branch');
  if (!/async function afterMerge\(n, pr, issue\) \{\n  if \(issue && isBusIssue\(await gh\('GET'[^\n]*issue = undefined/.test(l)) bad.push('afterMerge does not skip the close for a bus issue');
  return bad;
};
const h = read('./infra/branchissue.mjs'), l = read('./infra/land.mjs'), g = read('./go.mjs');
const BREAKS = [
  ['isBusIssue never true', (h, l, g) => [h.replaceAll("=== 'bus'", "=== 'busx'"), l, g]],
  ['claim guard removed', (h, l, g) => [h, l, g.replace(/  if \(isBusIssue\(issue\)\) \{[^\n]*\n/, '')]],
  ['afterMerge guard removed', (h, l, g) => [h, l.replace(/  if \(issue && isBusIssue\(await gh[^\n]*\n/, ''), g]],
  ['landOne guard removed', (h, l, g) => [h, l.replace(/  if \(await busBranch[^\n]*return refuseBus[^\n]*\n/, ''), g]],
  ['landBatch guard removed', (h, l, g) => [h, l.replace(/    if \(await busBranch[^\n]*continue; \}[^\n]*\n/, ''), g]],
];
const real = await verdicts(h, l, g);
let caught = 0;
for (const [name, mk] of BREAKS) { const [a, b, c] = mk(h, l, g); if ((a !== h || b !== l || c !== g) && (await verdicts(a, b, c)).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ NOT caught: ${name}`); }
for (const r of real) console.log(`  ✗ ${r}`);
console.log(`busclosecheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${6 - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
