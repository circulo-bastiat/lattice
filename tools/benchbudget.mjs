// tools/benchbudget.mjs — performance budget (#7770). Pure rules + a small CLI; with no args it is the check.
//   node tools/benchbudget.mjs record <bench.json> <store.json> <sha> [pr]   append one landing's numbers
//   node tools/benchbudget.mjs spread <store.json>                          run-to-run spread per benchmark (10-run file)
//   node tools/benchbudget.mjs gate <store.json>                            exit 3 + print regressions of the newest entry
//   node tools/benchbudget.mjs trend <store.json>                           latest value + 7-day trend (go.mjs status)
// Lower is better for every benchmark. Alerts only: the caller opens a `perf-regression` issue, never blocks the lander.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BENCHES = ['meanMs', 'p95Ms', 'drawsPerFrame', 'trisPerFrame', 'worldMB', 'arenaMB', 'genMsPerChunk', 'remeshMsPerSection', 'entityTickMs60'];   // CPU frame prep, stalls, submitted geometry, memory
export const MIN_BUDGET = 0.10, SPREAD_MULT = 3, WINDOW = 5, MAX_SPREAD = 0.10, STALE_DAYS = 14;

export const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// relative spread of repeated runs of one benchmark: (max-min)/median
export const spread = (runs) => { const m = median(runs); return m ? (Math.max(...runs) - Math.min(...runs)) / m : 0; };
// a benchmark whose spread exceeds 10% must be rewritten or dropped
export const unstable = (spreads) => Object.keys(spreads).filter((k) => spreads[k] > MAX_SPREAD);

// entry = { sha, pr, t, v:{bench:number} }; store = { spread:{bench:rel}, entries:[...] } oldest first
export function regressions(store, entry = store.entries[store.entries.length - 1]) {
  const prior = store.entries.filter((e) => e !== entry && e.t <= entry.t).slice(-WINDOW), out = [];
  if (prior.length < 3) return out;
  for (const k of Object.keys(entry.v)) {
    const base = median(prior.map((e) => e.v[k]).filter((x) => typeof x === 'number'));
    if (!(base > 0)) continue;
    const sp = (store.spread || {})[k] ?? 0, limit = Math.max(SPREAD_MULT * sp, MIN_BUDGET), rel = entry.v[k] / base - 1;
    if (rel > limit) out.push({ bench: k, base, now: entry.v[k], rel, limit, sha: entry.sha, pr: entry.pr });
  }
  return out;
}
export const stale = (store, now = Date.now()) => !store.entries.length || now - store.entries[store.entries.length - 1].t > STALE_DAYS * 864e5;

export function trend(store, now = Date.now()) {
  const last = store.entries[store.entries.length - 1]; if (!last) return ['perf: no data yet'];
  const old = store.entries.find((e) => now - e.t <= 7 * 864e5) || last;
  return Object.keys(last.v).map((k) => `${k} ${last.v[k]} (${old.v[k] ? ((last.v[k] / old.v[k] - 1) * 100).toFixed(1) : '0'}% vs 7d)`);
}

const load = (f) => existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { spread: {}, entries: [] };
export const flatten = (j) => { const v = {}; for (const r of j.runs || []) for (const k of BENCHES) if (typeof r[k] === 'number') v[`${r.label || r.preset}.${k}`] = r[k]; return v; };

function selfcheck() {
  let breaks = 0, bad = 0;
  const ok = (c, m) => { if (!c) { bad++; console.log('FAIL  ' + m); } };
  const mk = (vals, sp) => ({ spread: { x: sp }, entries: vals.map((v, i) => ({ sha: 's' + i, pr: i, t: i * 1000, v: { x: v } })) });
  const base = [100, 101, 99, 100, 100];
  ok(regressions(mk([...base, 100], 0.02)).length === 0, 'steady run flagged');
  // injected slow loop (+25%) must be detected
  ok(regressions(mk([...base, 125], 0.02)).length === 1, 'injected regression missed'); breaks++;
  // spread rule: 3x a 6% spread = 18%, so +15% is noise, +20% is not
  ok(regressions(mk([...base, 115], 0.06)).length === 0, 'spread rule ignored (+15% at 6% spread)'); breaks++;
  ok(regressions(mk([...base, 120], 0.06)).length === 1, 'spread rule too loose'); breaks++;
  // floor: tiny spread still allows 10%
  ok(regressions(mk([...base, 109], 0)).length === 0, '10% floor ignored'); breaks++;
  // baseline is the median of the last 5, not the mean or the oldest
  ok(regressions(mk([300, 300, 100, 100, 100, 100, 100, 125], 0.02)).length === 1, 'baseline not last-5 median'); breaks++;
  ok(unstable({ a: 0.2, b: 0.05 }).join() === 'a', 'unstable bench kept'); breaks++;
  ok(spread([100, 110, 100]) > 0.09 && spread([100, 100]) === 0, 'spread math');
  // chunk-gen microbench (benchmicro.mjs) rows must reach the store, and a slower generator must trip the gate
  const fv = flatten({ runs: [{ label: 'micro', genMsPerChunk: 20 }] });
  ok(fv['micro.genMsPerChunk'] === 20, 'micro bench not recorded'); breaks++;
  const gm = (v) => ({ spread: { g: 0.02 }, entries: [20, 20, 21, 20, 20, v].map((x, i) => ({ sha: 's' + i, pr: i, t: i * 1000, v: { g: x } })) });
  ok(regressions(gm(26)).length === 1 && regressions(gm(21)).length === 0, 'slower chunk gen undetected'); breaks++;
  // stale baseline
  ok(stale(mk(base, 0.02), 40 * 864e5) && !stale(mk(base, 0.02), 2000), 'stale baseline undetected'); breaks++;
  console.log(bad ? `FAIL  benchbudget: ${bad} problem(s)` : `ok    benchbudget: ${breaks} breaks caught`);
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, a, b, sha, pr] = process.argv.slice(2);
  if (!cmd) selfcheck();
  else if (cmd === 'record') { const s = load(b); s.entries.push({ sha, pr: pr || null, t: Date.now(), v: flatten(JSON.parse(readFileSync(a, 'utf8'))) }); s.entries = s.entries.slice(-200); writeFileSync(b, JSON.stringify(s)); }
  else if (cmd === 'spread') { const s = load(a), keys = Object.keys(s.entries[0]?.v || {}); s.spread = {}; for (const k of keys) s.spread[k] = spread(s.entries.map((e) => e.v[k])); writeFileSync(a, JSON.stringify(s)); console.log(JSON.stringify(s.spread)); const u = unstable(s.spread); if (u.length) { console.log('UNSTABLE (>10%, rewrite or drop): ' + u.join(', ')); process.exit(4); } }
  else if (cmd === 'gate') { const s = load(a), r = regressions(s); if (stale(s)) console.log('STALE baseline'); for (const x of r) console.log(`perf-regression ${x.bench}: ${x.base} -> ${x.now} (+${(x.rel * 100).toFixed(1)}% > ${(x.limit * 100).toFixed(1)}%) sha ${x.sha} PR #${x.pr}`); process.exit(r.length ? 3 : 0); }
  else if (cmd === 'trend') console.log(trend(load(a)).join('\n'));
}
