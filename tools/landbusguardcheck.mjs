// tools/landbusguardcheck.mjs - #9513 (22 Oct 2026: PR #9481's branch was work/9482-..., 9482 was the open message bus, the lander
// closed it on landing and the project had no mail for 4 h). The lander must (a) get the PR's issue from workIssue(), which returns
// nothing for a `bus`-labelled issue, at BOTH places it reads a branch (landOne and landBatch), (b) never parse work/<n>- inline again.
// Anti-vacuity: each break below must be caught by the same verdict.
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const helper = read('./infra/branchissue.mjs'), land = read('./infra/land.mjs');
const load = (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const verdicts = async (h, l) => {
  const bad = [];
  const m = await load(h);
  const iss = (...names) => async () => ({ labels: names.map((name) => ({ name })) });
  if ((await m.workIssue('work/9482-retire-dead-workflows', iss('bus'))) !== undefined) bad.push('a bus-labelled issue is still returned as the PR issue');
  if ((await m.workIssue('work/9481-x', iss('infra', 'severe'))) !== '9481') bad.push('an ordinary work issue is no longer returned');
  if ((await m.workIssue('work/12-x', iss())) !== '12') bad.push('an issue with no labels is no longer returned');
  if ((await m.workIssue('claude/foo', iss())) !== undefined) bad.push('a non-work branch returned an issue');
  if ((await m.workIssue('work/77-y', async () => { throw new Error('404'); })) !== '77') bad.push('a failed lookup must keep the old behaviour');
  const uses = (l.match(/await workIssue\(pr\.head\.ref/g) || []).length;
  if (uses < 2) bad.push(`land.mjs uses workIssue ${uses} time(s); landOne and landBatch both need it`);
  if (/match\(\/\^work\\\/\(\\d\+\)-\/\)/.test(l)) bad.push('land.mjs parses work/<n>- inline again (a bus issue would be closed)');
  if (!/import \{ workIssue \} from '\.\/branchissue\.mjs'/.test(l)) bad.push('land.mjs does not import workIssue');
  return bad;
};
const BREAKS = [
  ['bus label ignored', (h, l) => [h.replace("=== 'bus'", "=== 'busx'"), l]],
  ['every issue dropped', (h, l) => [h.replace('return n;\n}', 'return undefined;\n}'), l]],
  ['single path parses the branch itself', (h, l) => [h, l.replace('const issue = await workIssue(pr.head.ref, (k) => gh(', 'const issue = (pr.head.ref.match(/^work\\/(\\d+)-/) || [])[1]; void ((k) => gh(')]],
  ['batch path parses the branch itself', (h, l) => [h, l.replace(/const issue = await workIssue\(pr\.head\.ref[^\n]*\n(?=[^]*?const issue = await workIssue\(pr\.head\.ref)/, '')]],
  ['import removed', (h, l) => [h, l.replace("import { workIssue } from './branchissue.mjs';", '')]],
];
const real = await verdicts(helper, land);
let caught = 0;
for (const [name, mk] of BREAKS) { const [h, l] = mk(helper, land); if ((h !== helper || l !== land) && (await verdicts(h, l)).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ NOT caught: ${name}`); }
for (const r of real) console.log(`  ✗ ${r}`);
console.log(`landbusguardcheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${8 - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
