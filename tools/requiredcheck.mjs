// tools/requiredcheck.mjs - #7767: the issue contract (tools/infra/required.mjs) and its wiring in go.mjs / land.mjs.
// Anti-vacuity: every break below must be caught by the verdicts.
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const load = async (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const BODY = 'Why\n```required\n- [ ] add the check\n- [x] write the record\n```\n';   // the second box is pre-ticked IN THE BODY: must not count
const OK = '- [x] R1 :: evidence: requiredcheck: ok, 5 breaks caught\n- [x] write the record :: evidence: docs/decisions/7767-x.md';
const verdicts = async (req, go, land) => {
  const bad = [], M = await load(req), items = M.parseRequired(BODY);
  if (items.length !== 2) bad.push('parse: items');
  if (!M.evaluate(items, OK, { finished: true }).allTicked) bad.push('a fully ticked finish is refused');
  if (M.evaluate(items, '- [x] R1 :: evidence: ok output line here', { finished: true }).problems.length === 0) bad.push('finish with an unanswered item accepted');
  if (M.evaluate(items, OK.replace('evidence: requiredcheck: ok, 5 breaks caught', 'evidence:'), { finished: true }).problems.length === 0) bad.push('tick without evidence accepted');
  if (M.evaluate(items, OK.replace('[x] R1', '[ ] R1').replace('evidence: requiredcheck: ok, 5 breaks caught', 'blocked: node x.mjs -> ENOENT'), { finished: true }).problems.length === 0) bad.push('--finished with an unticked item accepted');
  const hp = M.evaluate(items, '- [ ] R1 :: blocked: node x.mjs -> ENOENT foo\n- [ ] R2 :: does-not-fit: 3 modules, 120 min :: follow-up: #9', { finished: false });
  if (hp.problems.length || hp.unticked.length !== 2) bad.push('an honest partial is refused');
  if (!M.evaluate(items, '- [ ] R1 :: blocked: node x.mjs -> ENOENT foo\n- [ ] R2 :: does-not-fit: 3 modules, 120 min', {}).problems.length) bad.push('does-not-fit without a filed follow-up accepted');
  if (M.landerKeepsOpen(BODY, 'Closes #1') !== true || M.landerKeepsOpen(BODY, 'Closes #1\n' + M.DONE_MARK) !== false || M.landerKeepsOpen('no block', 'x') !== false) bad.push('lander keep-open rule');
  const cm = (b) => ({ body: b });
  if (M.classifyIssue([cm('<!-- brain-run 1 worker #5 -->')]).join() !== 'gave-up') bad.push('an empty run is not gave-up');
  if (M.classifyIssue([cm('<!-- brain-run 1 worker #5 -->'), cm(M.OUTCOME('honest-partial'))]).join() !== 'honest-partial') bad.push('honest partial mislabelled');
  if (M.gaveUpTwice(M.classifyIssue([cm('<!-- brain-run 1 worker #5 -->'), cm('<!-- brain-run 2 worker #5 -->'), cm('**Commander: released'), cm('<!-- brain-run 3 worker #5 -->')]))) bad.push('commander note does not reset the give-up count');
  if (M.classifyRun([], { claimed: false }) !== 'no-claim') bad.push('no-claim');
  if (!M.gaveUpTwice(['landed', 'gave-up', 'gave-up']) || M.gaveUpTwice(['gave-up', 'landed', 'gave-up'])) bad.push('gave-up twice rule');
  if (!/if \(req\.problems\.length\) die\(/.test(go) || !/required items are not met[\s\S]{0,40}nothing was pushed/.test(go) || !/evaluate\(items/.test(go)) bad.push('done does not enforce the items');
  if (!/gaveUpTwice\(classifyIssue\(cs\)\)[\s\S]{0,200}needs-commander/.test(go)) bad.push('claim never labels needs-commander');
  if (!/countClasses/.test(go.slice(go.indexOf('async function status')))) bad.push('status shows no counts');
  if (!/--already-fixed needs the evidence line/.test(go)) bad.push('already-fixed without evidence accepted');
  if (!/landerKeepsOpen\(ib, pr\.body\)/.test(land) || !/if \(issue && reqOpen\)/.test(land)) bad.push('lander closes with unticked items');
  return bad;
};
const [req, go, land] = [read('./infra/required.mjs'), read('./go.mjs'), read('./infra/land.mjs')];
const base = await verdicts(req, go, land);
if (base.length) { console.log('✗ ' + base.join('\n✗ ')); process.exit(1); }
const BREAKS = [
  ['commander reset removed', (r, g, l) => [r.replace("runs.length = 0; cur = null; continue;", "void 0;"), g, l]],
  ['body ticks count', (r, g, l) => [r.replace("\\[[ xX]\\]\\s*(.+?)", "\\[[ ]\\]\\s*(.+?)"), g, l]],
  ['evidence optional', (r, g, l) => [r.replace('a.text.length < 8) problems.push(`required item R${i + 1} "${it}" is ticked', 'false) problems.push(`required item R${i + 1} "${it}" is ticked'), g, l]],
  ['silent skip ok', (r, g, l) => [r.replace('(silent skip)', '(silent skip)').replace("problems.push(`required item R${i + 1} \"${it}\" is not answered", 'void (`'), g, l]],
  ['finish with unticked', (r, g, l) => [r.replace('if (finished) problems.push', 'if (false) problems.push'), g, l]],
  ['no follow-up demanded', (r, g, l) => [r.replace('if (!n.followUps.length) problems', 'if (false) problems'), g, l]],
  ['lander ignores marker', (r, g, l) => [r.replace('!String(prBody || \'\').includes(DONE_MARK) ||', 'false ||'), g, l]],
  ['empty run is landed', (r, g, l) => [r.replace("return 'gave-up';", "return 'landed';"), g, l]],
  ['done skips evaluation', (r, g, l) => [r, g.replace('if (req.problems.length) die(', 'if (false) die('), l]],
  ['lander closes anyway', (r, g, l) => [r, g, l.replace('if (issue && reqOpen)', 'if (false)')]],
  ['already-fixed w/o evidence', (r, g, l) => [r, g.replace('--already-fixed needs the evidence line', 'x'), l]],
];
let caught = 0;
for (const [name, f] of BREAKS) {
  const [r, g, l] = f(req, go, land);
  if (r === req && g === go && l === land) { console.log('✗ break did not change anything: ' + name); continue; }
  let v; try { v = await verdicts(r, g, l); } catch { v = ['threw']; }
  if (v.length) caught++; else console.log('✗ break not caught: ' + name);
}
if (caught !== BREAKS.length) process.exit(1);
console.log(`requiredcheck: ok, ${caught} breaks caught`);
