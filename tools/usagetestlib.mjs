// tools/usagetestlib.mjs - the arithmetic of the usage test (#1497). No imports on purpose: usagetestcheck.mjs mutates this
// file to prove its own verdicts. Dan, 1 Oct: "pro sonnet is feeling really fishy on usage, like insane rise at the beginning".
//
// A ROW is one headless session: { account, run, before: {window, week} (pct), samples: [{t, window, week}] (pct after the
// run, t = seconds after it ended), tokens: {in, out, cw, cr}, cost }. The usage endpoint lags, so the delta of a run is
// its LARGEST sample minus the reading taken before it.
export const BUSY_PCT = 60;                       // an account whose 5-hour window is above this is not measured (deltas would be capped/noisy)
export const num = (x) => (typeof x === 'number' && isFinite(x) ? x : 0);

export function delta(row, key) {
  const peak = Math.max(...(row.samples || []).map((s) => num(s[key])), num(row.before[key]));
  return Math.round((peak - num(row.before[key])) * 100) / 100;
}
export const totalTokens = (t) => num(t.in) + num(t.out) + num(t.cw) + num(t.cr);

/** Window percentage points per million tokens and per dollar of API-equivalent cost (null when there is nothing to divide by). */
export function rates(row) {
  const d = delta(row, 'window'), tok = totalTokens(row.tokens || {}), cost = num(row.cost);
  return { pctPerMTok: tok > 0 ? Math.round((d / tok) * 1e6 * 100) / 100 : null, pctPerDollar: cost > 0 ? Math.round((d / cost) * 100) / 100 : null };
}

/** Should this account be measured now? (Dan's rule: only when its window is under BUSY_PCT.) */
export const measurable = (usage) => !!(usage && usage.ok && usage.window && num(usage.window.pct) < BUSY_PCT);

/** The plain-English table, Pro vs Max side by side per run. */
export function table(rows) {
  const L = ['usage test - one headless Sonnet session per row; "window" = the 5-hour window, "week" = the weekly line (percentage points)', ''];
  L.push('account  run                      window+  week+   tokens in/out/cache-write/cache-read        cost    window pts per M tokens');
  for (const r of rows) {
    const t = r.tokens || {}, k = rates(r);
    L.push(`${r.account.padEnd(8)} ${r.run.padEnd(24)} ${String(delta(r, 'window')).padEnd(8)} ${String(delta(r, 'week')).padEnd(7)} ${[t.in, t.out, t.cw, t.cr].map(num).join('/').padEnd(40)} $${num(r.cost).toFixed(3).padEnd(7)} ${k.pctPerMTok ?? 'n/a'}`);
  }
  const by = (a, run) => rows.find((r) => r.account === a && r.run === run);
  for (const run of [...new Set(rows.map((r) => r.run))]) {
    const p = by('pro', run), m = by('max', run);
    if (p && m && delta(m, 'window') > 0) L.push('', `${run}: Pro's window rose ${(delta(p, 'window') / delta(m, 'window')).toFixed(1)}x as much as Max's for the same session (Pro ${delta(p, 'window')} pts, Max ${delta(m, 'window')} pts).`);
  }
  const a = rows.find((r) => r.run === 'A empty dir'), b = rows.find((r) => r.run === 'B repo dir' && (!a || r.account === a.account));
  if (a && b) L.push('', `Start-up cost (${a.account}): an empty-directory session already moves the window ${delta(a, 'window')} pts; the same session inside the repo moves it ${delta(b, 'window')} pts (cache-write ${num(a.tokens.cw)} vs ${num(b.tokens.cw)} tokens).`);
  return L.join('\n');
}
