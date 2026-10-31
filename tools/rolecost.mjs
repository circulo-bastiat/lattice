// tools/rolecost.mjs - #8897 R4: runs/day and $ per role from the "run ended" lines, over closed bus issues too (the bus rotates every ~3 h).
//   node tools/rolecost.mjs <from-iso> <to-iso> [<from2> <to2> ...]   one window per pair, printed per role, scaled to 24 h
import { ghAll } from './infra/gh.mjs';
import { parseRun } from './infra/metrics.mjs';
const w = process.argv.slice(2);
if (w.length < 2 || w.length % 2) { console.error('usage: rolecost.mjs <from> <to> [<from> <to>...]'); process.exit(2); }
const bus = (await ghAll('/repos/{repo}/issues?state=all&labels=bus')).sort((a, b) => a.number - b.number);
for (let i = 0; i < w.length; i += 2) {
  const [a, b] = [Date.parse(w[i]), Date.parse(w[i + 1])], hrs = (b - a) / 36e5, by = {};
  for (const is of bus) {
    if (Date.parse(is.created_at) > b || (is.closed_at && Date.parse(is.closed_at) < a)) continue;
    for (const c of await ghAll(`/repos/{repo}/issues/${is.number}/comments?since=${w[i]}`)) {
      const t = Date.parse(c.created_at); if (t < a || t >= b) continue;
      const r = parseRun(c); if (!r) continue;
      const o = by[r.role] ||= { runs: 0, usd: 0 }; o.runs++; o.usd += r.usd;
    }
  }
  console.log(`${w[i]} .. ${w[i + 1]} (${hrs.toFixed(1)} h)`);
  for (const [k, o] of Object.entries(by).sort()) console.log(`  ${k.padEnd(10)} ${String(o.runs).padStart(4)} runs  $${o.usd.toFixed(2).padStart(7)}   per day: ${(o.runs * 24 / hrs).toFixed(0)} runs  $${(o.usd * 24 / hrs).toFixed(2)}`);
}
