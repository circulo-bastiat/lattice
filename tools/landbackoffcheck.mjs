// tools/landbackoffcheck.mjs - #9640 (22 Oct 2026: the lander tested the same red batch #9591-#9593 ~40 times, landed 0, and its log said neither
// which check was red nor what the one-PR rounds did). Rules: (a) the one-PR backoff after a red batch is used up only by rounds that really
// tested a PR, never by a skipped head; (b) those single rounds go to the red batch's own members first; (c) a red batch prints its red check
// rows; (d) every single round prints one `single #N: <result>` line. Anti-vacuity: each break below must be caught by the same verdicts.
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const load = (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const verdicts = async (lb, land) => {
  const bad = [];
  const m = await load(lb);
  if (m.backoffAfter(3, 'skipped') !== 3) bad.push('a skipped head uses up the backoff');
  if (m.backoffAfter(3, 'bounced') !== 2) bad.push('a tested PR does not use up the backoff');
  if (m.backoffAfter(3, 'landed') !== 2) bad.push('a landed PR does not use up the backoff');
  if (m.backoffAfter(0, 'landed') !== 0) bad.push('the backoff goes below zero');
  if (m.singleHead([1, 2, 3], new Set([2])) !== 2) bad.push('single rounds do not go to the red batch members first');
  if (m.singleHead([1, 2, 3], new Set()) !== 1) bad.push('no red batch: the head is not taken');
  if (m.singleHead([1, 2, 3], new Set([9])) !== 1) bad.push('members gone from the queue: the head is not taken');
  if (!/import \{[^}]*\bbackoffAfter\b[^}]*\bsingleHead\b[^}]*\} from '\.\/landbatch\.mjs'/.test(land)) bad.push('land.mjs does not import backoffAfter and singleHead');
  if (!/batchOff = backoffAfter\(batchOff, r\)/.test(land)) bad.push('land.mjs does not use backoffAfter');
  if (/if \(batchOff > 0\) batchOff--;/.test(land)) bad.push('land.mjs still decrements the backoff for every round');
  if (!/const head = singleHead\(queue, redMembers\)/.test(land)) bad.push('land.mjs does not use singleHead');
  if (!/redMembers = new Set\(members\)/.test(land)) bad.push('a red batch does not remember its members');
  if (!/redMembers\.delete\(head\);/.test(land)) bad.push('a single head stays in redMembers after its round (#9678: ghost rounds after each landing)');
  if (!/console\.log\(`single #\$\{head\}: \$\{r\}/.test(land)) bad.push('a single round prints no result line');
  for (const w of ["red('build', b)", "red('core', s)", "red('impact-selected stages', ti)"]) if (!land.includes('return ' + w)) bad.push(`a red batch does not print its red rows: ${w}`);
  if (!/if \(o\) console\.log\(reds\(/.test(land)) bad.push('red() does not print the red rows');
  return bad;
};
const BREAKS = [
  ['skipped uses the backoff', (l, p) => [l.replace("result !== 'skipped' ? off - 1", 'true ? off - 1'), p]],
  ['backoff never counts down', (l, p) => [l.replace('off - 1 : off', 'off : off'), p]],
  ['members ignored', (l, p) => [l.replace('(queue.find((n) => redMembers.has(n)) ?? queue[0])', 'queue[0]'), p]],
  ['old decrement back', (l, p) => [l, p.replace('batchOff = backoffAfter(batchOff, r);', 'if (batchOff > 0) batchOff--;')]],
  ['no single log line', (l, p) => [l, p.replace('console.log(`single #${head}: ${r}', 'void (`${head}${r}')]],
  ['core red prints nothing', (l, p) => [l, p.replace("return red('core', s);", "return red('core');")]],
  ['a single head is never dropped from the members (#9678)', (l, p) => [l, p.replace('redMembers.delete(head);', '')]],
  ['members not remembered', (l, p) => [l, p.replace('redMembers = new Set(members);', '')]],
  ['import removed', (l, p) => [l, p.replace(/import \{ pickBatch[^\n]*landbatch\.mjs';/, "import { pickBatch, mergeBatch, BATCH_DEFAULT } from './landbatch.mjs';")]],
];
const lb = read('./infra/landbatch.mjs'), land = read('./infra/land.mjs');
const real = await verdicts(lb, land);
let caught = 0;
for (const [name, mk] of BREAKS) { const [l, p] = mk(lb, land); if ((l !== lb || p !== land) && (await verdicts(l, p)).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ break NOT caught: ${name}`); }
for (const r of real) console.log(`  ✗ ${r}`);
console.log(`landbackoffcheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${23 - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
