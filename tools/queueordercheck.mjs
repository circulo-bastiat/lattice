// tools/queueordercheck.mjs - #2632: a PR labelled `priority` lands before older unlabelled PRs; order inside a group is
// oldest first (input order); plain issues are skipped. Anti-vacuity: mutated copies of orderQueue must all be caught.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./infra/queueorder.mjs', import.meta.url), 'utf8');
const load = async (s) => import('data:text/javascript;base64,' + Buffer.from(s).toString('base64'));
const pr = (n, ...labels) => ({ number: n, pull_request: {}, labels: labels.map((name) => ({ name })) });
const verdicts = async (s) => {
  const { orderQueue } = await load(s);
  const bad = [];
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!eq(orderQueue([pr(1, 'land'), pr(2, 'land'), pr(3, 'land', 'priority')]), [3, 1, 2])) bad.push('a priority PR does not go first');
  if (!eq(orderQueue([pr(1, 'land'), pr(2, 'land'), pr(3, 'land')]), [1, 2, 3])) bad.push('unlabelled order is not oldest first');
  if (!eq(orderQueue([pr(5, 'priority'), pr(1, 'land'), pr(7, 'priority')]), [5, 7, 1])) bad.push('priority group is not oldest first');
  if (!eq(orderQueue([{ number: 9, labels: [{ name: 'priority' }] }, pr(2, 'land')]), [2])) bad.push('a plain issue is queued');
  if (!eq(orderQueue([]), [])) bad.push('empty queue');
  return bad;
};
const BREAKS = [
  ['priority ignored', (s) => s.replace("=== 'priority'", "=== 'nope'")],
  ['priority goes last', (s) => s.replace('[...prs.filter(hasPriority), ...prs.filter((i) => !hasPriority(i))]', '[...prs.filter((i) => !hasPriority(i)), ...prs.filter(hasPriority)]')],
  ['plain issues queued', (s) => s.replace('items.filter((i) => i.pull_request)', 'items')],
  ['order reversed', (s) => s.replace('.map((i) => i.number)', '.reverse().map((i) => i.number)')],
];
const real = await verdicts(src);
let caught = 0;
for (const [name, mut] of BREAKS) { const m = mut(src); if (m !== src && (await verdicts(m)).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ break NOT caught: ${name}`); }
for (const r of real) console.log(`  ✗ ${r}`);
console.log(`queueordercheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${5 - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
