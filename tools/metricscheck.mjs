// tools/metricscheck.mjs - #7771: the dashboard's numbers cannot double count, lose history, misattribute cost or show stale as fresh.
import { parseRun, merge, summarize, freshness } from './infra/metrics.mjs';
const T = Date.parse('2026-10-16T12:00:00Z'), iso = (m) => new Date(T - m * 60e3).toISOString();
const line = (id, m, tail, usd, n) => ({ id, created_at: iso(m), body: `to: log\nfrom: brain\n\nbrain: worker run ended (ok, 9 turns, acc1) [usage claude in 10 out 20 cw 100 cr 1000 $${usd}; total $${usd}; 3 min; plugs] -${tail} [#${n}]` });
const mk = (impl = {}) => {
  const P = impl.parse || parseRun, M = impl.merge || merge, S = impl.sum || summarize, F = impl.fresh || freshness, bad = [];
  const ok = (c, w) => { if (!c) bad.push(w); };
  const bounce = line(1, 90, ' CUT OFF at 60 turns: nothing salvaged.', 2, 5), land = line(2, 30, ' queued for the lander', 1, 5), other = line(3, 20, ' done', 4, 6);
  const r = [bounce, land, other].map(P);
  ok(r[0] && r[0].usd === 2 && r[0].cw === 100 && r[0].cr === 1000 && r[0].issue === 5, 'a run line is parsed with tokens, $ and issue');
  ok(r[0].outcome === 'gave-up' && r[1].outcome === 'landed', 'outcomes read from the line');
  let st = M({ runs: [] }, r); st = M(st, r);
  ok(st.runs.length === 3, 'a run seen twice is counted twice');
  const rotated = M(st, [P(line(4, 5, ' done', 1, 7))]);
  ok(rotated.runs.length === 4 && rotated.runs.some((x) => x.id === 1), 'a run missing after bus rotation');
  const s = S(st, T, 864e5);
  ok(s.landedPRs === 2 && s.usdPerLanded === 3.5 && s.perIssueUsd[5] === 3, 'a bounce cost attributed to the wrong PR (issue 5 costs 3, avg of 3 and 4)');
  ok(S(st, T, 40 * 60e3).runs === 2, 'window excludes older runs');
  ok(/STALE/.test(F(iso(300), T)) && /^fresh/.test(F(iso(5), T)), 'a stale file shown as fresh');
  return bad;
};
const real = mk(); if (real.length) { console.error('FAIL metricscheck:\n  ' + real.join('\n  ')); process.exit(1); }
const breaks = [
  ['double count', { merge: (s, r) => ({ ...s, runs: [...s.runs, ...r] }) }],
  ['lost after rotation', { merge: (s, r) => ({ ...s, runs: r }) }],
  ['bounce cost dropped', { sum: (s, n, w) => { const o = summarize({ runs: s.runs.filter((x) => x.outcome === 'landed') }, n, w); return o; } }],
  ['stale as fresh', { fresh: () => 'fresh (0 min old)' }],
];
let caught = 0;
for (const [n, impl] of breaks) { if (mk(impl).length) caught++; else console.error('NOT CAUGHT: ' + n); }
if (caught !== breaks.length) process.exit(1);
console.log(`metricscheck ok - ${caught} breaks caught`);
