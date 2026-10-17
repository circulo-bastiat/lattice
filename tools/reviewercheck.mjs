// #7768 reviewercheck: each break flips one rule in the logic and must be seen.
import * as R from './brain/reviewer.mjs';
let fails = 0, caught = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
const run = (M) => {
  const pr = { issueText: 'i required: x', diff: 'd', checkOutput: 'c', workerSummary: 'SECRET', labels: [], workerTurns: 20 };
  const bad = [];
  if ('workerSummary' in M.buildInput(pr) || JSON.stringify(M.buildInput(pr)).includes('SECRET')) bad.push('sees summary');
  const hr = Array.from({ length: 6 }, () => Date.now());
  if (M.allowed(hr, Date.now(), false)) bad.push('cap ignored');
  if (M.allowed([], Date.now(), true)) bad.push('usage stop ignored');
  if (!M.actions('mismatch', 5).some((a) => a.do === 'reopen' && a.label === 'review-mismatch')) bad.push('no reopen');
  if (!M.actions('mismatch', 5).some((a) => a.do === 'mail')) bad.push('no mail');
  if (!M.shouldSample({ labels: ['verifier-change'], workerTurns: 40 }, 1)) bad.push('verifier-change unsampled');
  if (!M.shouldSample({ labels: [], workerTurns: 2 }, 1)) bad.push('short run unsampled');
  if (M.shouldSample({ labels: [], workerTurns: 40 }, 1)) bad.push('over-sampling');
  return bad;
};
ok(run(R).length === 0, 'real logic: ' + run(R));
const breaks = {
  'sees summary': { ...R, buildInput: (p) => ({ ...p }) },
  'cap ignored': { ...R, allowed: () => true },
  'mismatch not reopening': { ...R, actions: (v, i) => [{ do: 'mail' }] },
  'verifier-change not sampled': { ...R, shouldSample: (p, n) => n % 5 === 0 },
};
for (const [k, M] of Object.entries(breaks)) { if (run(M).length) caught++; else { fails++; console.log('NOT CAUGHT ' + k); } }
console.log(`${caught} breaks caught`);
process.exit(fails ? 1 : 0);
