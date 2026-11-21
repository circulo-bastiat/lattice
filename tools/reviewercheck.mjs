// #7768 reviewercheck: each break flips one rule in the logic and must be seen.
import * as R from './brain/reviewer.mjs';
import * as T from './brain/reviewtick.mjs';
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
// reviewtick: plan honours cap/sampling, record reopens and mails on mismatch
await Promise.resolve();
{
  const prs = [{ number: 1, labels: ['verifier-change'] }, { number: 2, labels: [], workerTurns: 2 }, { number: 3, labels: [], workerTurns: 30 }];
  const full = Array.from({ length: 6 }, () => Date.now());
  const p1 = T.plan({ prs, n: 0 }), p2 = T.plan({ prs, times: full }), p3 = T.plan({ prs, usageStop: true }), p4 = T.plan({ prs, seen: [1, 2] });
  const good = p1.out.length >= 2 && p2.out.length === 0 && p3.out.length === 0 && !p4.out.some((x) => x.number < 3);
  if (!good) { fails++; console.log('FAIL reviewtick plan ' + JSON.stringify([p1.out, p2.out, p3.out, p4.out])); }
  if (T.plan({ prs, times: full, caps: { ...R.CAPS, maxPerHour: 99, maxPerDay: 99 } }).out.length > 0) caught++; else { fails++; console.log('NOT CAUGHT plan cap ignored'); }
  const calls = [];
  await T.record({ issue: 9, verdict: 'MISMATCH: x', tokens: 100, gh: async (m, u) => calls.push(m + u), say: async (to) => calls.push('say ' + to) });
  const calls2 = [];
  await T.record({ issue: 9, verdict: 'pass', gh: async (m, u) => calls2.push(m + u), say: async (to) => calls2.push('say ' + to) });
  if (calls.some((c) => c.startsWith('PATCH')) && calls.includes('say commander') && !calls2.some((c) => c.startsWith('PATCH'))) {} else { fails++; console.log('FAIL reviewtick record ' + calls + ' | ' + calls2); }
}
console.log(`${caught} breaks caught`);
process.exit(fails ? 1 : 0);
