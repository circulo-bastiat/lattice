// landstreakcheck (#10420): the hosted-lander retirement gate (10 consecutive landings, bounce <= 0.06). Then each rule is broken to prove the check fails.
const SRC = await import('./infra/landstreak.mjs');
const R = (c) => ({ status: 'completed', conclusion: c });
const ok = (n) => Array.from({ length: n }, () => R('success'));
function verdict(M) {
  const bad = [];
  if (!M.landStreak(ok(10)).ok) bad.push('10 successes do not pass');
  if (M.landStreak(ok(9)).ok) bad.push('9 successes pass');
  if (M.landStreak([R('failure'), ...ok(12)]).ok) bad.push('a newest failure does not reset the streak');
  if (M.landStreak([...ok(10), R('failure')]).streak !== 10) bad.push('streak miscounted');
  if (M.landStreak([{ status: 'in_progress', conclusion: null }, ...ok(10)]).streak !== 10) bad.push('an in-progress run breaks the streak');
  if (M.landStreak([R('cancelled'), ...ok(10)]).streak !== 10) bad.push('a cancelled run counts');
  if (M.landStreak([...ok(10), ...Array.from({ length: 10 }, () => R('failure'))]).ok) bad.push('a high bounce rate passes');
  if (M.landStreak([]).ok) bad.push('no runs pass');
  return bad;
}
const brk = (o) => ({ ...SRC, landStreak: (r, x) => ({ ...SRC.landStreak(r, x), ...o(r) }) });
const breaks = [
  brk(() => ({ ok: true })), brk(() => ({ ok: false })), brk((r) => ({ streak: r.length })),
  { ...SRC, landStreak: (r, x) => SRC.landStreak(r, { ...x, needed: 5 }) }, { ...SRC, landStreak: (r, x) => SRC.landStreak(r, { ...x, bounceMax: 1 }) },
  { ...SRC, landStreak: (r, x) => SRC.landStreak((r || []).filter((e) => e.conclusion !== 'cancelled' ? true : false).map((e) => e), x) && SRC.landStreak((r || []).map((e) => e.conclusion === 'cancelled' ? { ...e, conclusion: 'success' } : e), x) },
];
let bad = verdict(SRC); bad.forEach((b) => console.log('FAIL', b));
let caught = 0; breaks.forEach((B, i) => { if (verdict(B).length) caught++; else console.log('NOT CAUGHT: break #' + (i + 1)); });
console.log(`landstreakcheck: ${bad.length} failed; ${caught} breaks caught (of ${breaks.length})`);
if (caught < breaks.length) bad = bad.concat('vacuous');
process.exit(bad.length ? 1 : 0);
