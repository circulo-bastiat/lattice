// #7768 calibratecheck: score/pickModel arithmetic; each break flips one rule and must be seen.
import * as C from './brain/calibrate.mjs';
let fails = 0, caught = 0;
const cases = [{ pr: 1, truth: 'pass' }, { pr: 2, truth: 'pass' }, { pr: 3, truth: 'mismatch' }, { pr: 4, truth: 'mismatch' }];
const v = (model, ...vs) => vs.map((verdict, i) => ({ pr: i + 1, model, verdict }));
const verdicts = [...v('haiku', 'pass', 'mismatch', 'mismatch', 'unclear'), ...v('sonnet', 'pass', 'pass', 'mismatch', 'mismatch')];
const run = (M) => {
  const bad = [], by = M.score(cases, verdicts), h = by.haiku, s = by.sonnet;
  if (!(h.tp === 1 && h.fp === 1 && h.fn === 1 && h.tn === 1 && h.unclear === 1)) bad.push('counts');
  if (!(h.precision === 0.5 && h.recall === 0.5 && s.precision === 1 && s.recall === 1)) bad.push('precision/recall');
  if (M.pickModel(by) !== 'sonnet') bad.push('pick better tier');
  if (M.pickModel({ haiku: { n: 4, agreement: 1 }, sonnet: { n: 4, agreement: 1 } }) !== 'haiku') bad.push('pick cheapest');
  return bad;
};
if (run(C).length) { fails++; console.log('FAIL real: ' + run(C)); }
const breaks = {
  'unclear counted as pass': { ...C, score: (c, vs) => C.score(c, vs.map((x) => ({ ...x, verdict: x.verdict === 'unclear' ? 'pass' : x.verdict }))) },
  'always cheapest': { ...C, pickModel: () => 'haiku' },
  'always priciest': { ...C, pickModel: () => 'sonnet' },
  'precision swapped': { ...C, score: (c, vs) => { const by = C.score(c, vs); for (const x of Object.values(by)) [x.precision, x.recall] = [x.recall, x.precision]; by.haiku.precision = 1; return by; } },
};
for (const [k, M] of Object.entries(breaks)) { if (run(M).length) caught++; else { fails++; console.log('NOT CAUGHT ' + k); } }
// runCases: reviewer never sees a worker summary, resumes, unparseable text is unclear.
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
const runLive = (M, summaryLeak) => {
  const bad = [], f = mkdtempSync(tmpdir() + '/cal-') + '/v.jsonl', prompts = [];
  const deps = { load: (c) => ({ issueText: 'ISSUE' + c.pr, diff: 'DIFF', checkOutput: 'CHK', workerSummary: 'WORKERSAYS' }), ask: (m, p) => { prompts.push(p); return { text: prompts.length === 1 ? 'garbage' : 'mismatch\nx', tokens: 7 }; } };
  const cs = [{ pr: 1, issue: 1, truth: 'pass' }, { pr: 2, issue: 2, truth: 'pass' }];
  const out = M.runCases(cs, ['haiku', 'sonnet'], deps, f);
  if (out.length !== 4 || !existsSync(f) || readFileSync(f, 'utf8').split('\n').filter(Boolean).length !== 4) bad.push('count');
  if (out[0].verdict !== 'unclear' || out[1].verdict !== 'mismatch') bad.push('parse');
  if (prompts.some((p) => p.includes('WORKERSAYS'))) bad.push('summary leaked');
  if (M.runCases(cs, ['haiku', 'sonnet'], deps, f).length !== 0) bad.push('not resumable');
  return bad;
};
if (runLive(C).length) { fails++; console.log('FAIL runCases: ' + runLive(C)); }
const liveBreaks = {
  'summary leaked to reviewer': { ...C, promptFor: undefined, runCases: (cs, t, d, f) => C.runCases(cs, t, { ...d, ask: (m, p) => d.ask(m, p + 'WORKERSAYS') }, f) },
  'not resumable': { ...C, runCases: (cs, t, d, f) => C.runCases(cs, t, d, f + 'x' + Math.random()) },
  'unparseable counted as pass': { ...C, runCases: (cs, t, d, f) => C.runCases(cs, t, { ...d, ask: (m, p) => { const r = d.ask(m, p); return { ...r, text: r.text === 'garbage' ? 'pass' : r.text }; } }, f) },
};
for (const [k, M] of Object.entries(liveBreaks)) { if (runLive(M, true).length) caught++; else { fails++; console.log('NOT CAUGHT ' + k); } }
// collectGit: cases from git history when gh is absent.
const glog = [['a5', 'revert #12 landed wrongly'], ['a4', 'land #14: #40: x'], ['a3', 'land #13: #30: y'], ['a2', 'land #12: #20: z'], ['a1', 'land #11: #10: w']].map(([sha, subject]) => ({ sha, subject }));
const gitRun = (M) => { const bad = [], r = M.collectGit(glog); const t = Object.fromEntries(r.map((c) => [c.pr, c.truth]));
  if (t[12] !== 'mismatch') bad.push('reverted not mismatch'); if (t[11] !== 'pass' || t[13] !== 'pass' || t[14] !== 'pass') bad.push('kept not pass');
  if (r.some((c) => !c.sha || !c.issue)) bad.push('sha/issue missing'); if (M.collectGit(glog, 1, 0).length !== 1) bad.push('limit'); return bad; };
if (gitRun(C).length) { fails++; console.log('FAIL collectGit: ' + gitRun(C)); }
const gitBreaks = {
  'all pass': { collectGit: (l, a, b) => C.collectGit(l, a, b).map((c) => ({ ...c, truth: 'pass' })) },
  'all mismatch': { collectGit: (l, a, b) => C.collectGit(l, a, b).map((c) => ({ ...c, truth: 'mismatch' })) },
  'no sha': { collectGit: (l, a, b) => C.collectGit(l, a, b).map(({ sha, ...c }) => c) },
};
for (const [k, M] of Object.entries(gitBreaks)) { if (gitRun(M).length) caught++; else { fails++; console.log('NOT CAUGHT ' + k); } }
console.log(`${caught} breaks caught`);
process.exit(fails ? 1 : 0);
