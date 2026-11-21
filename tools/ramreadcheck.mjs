// ramreadcheck (#10414): the RAM record becomes a per-consumer table, ranked, and a stale or missing record is flagged. Each rule is then broken to prove the check fails.
import { report } from './infra/ramread.mjs';
const now = Date.parse('2026-10-27T12:00:00Z');
const rec = (o = {}) => ({ totalMB: 31000, freeMB: 6900, cpuPct: 80, at: new Date(now - 60e3).toISOString(), mb: { vm: 12000, lander: 900, browser: 2500, java: 3000, node: 400 }, vmAssignedMB: 12000, vmMaxMB: 12288, vmCpuPct: 70, ...o });
function verdict(impl) {
  const bad = [], r = impl(rec(), now);
  if (!r.ok || r.top !== 'vm') bad.push('fresh record: top consumer is not the VM');
  if (!r.lines.some((l) => /12000 MB\s+39%\s+Hyper-V/.test(l))) bad.push('VM row (MB and % of host) missing');
  if (r.lines.findIndex((l) => /Hyper-V/.test(l)) > r.lines.findIndex((l) => /JVM/.test(l))) bad.push('rows not ranked by MB');
  if (!r.lines.some((l) => /max 12288/.test(l))) bad.push('VM memory max not shown');
  const s = impl(rec({ at: new Date(now - 40 * 60e3).toISOString() }), now);
  if (s.ok || !/STALE/.test(s.lines[0])) bad.push('40-minute-old record not flagged stale');
  if (impl(null, now).ok || impl({ totalMB: 0, mb: {} }, now).ok) bad.push('missing record reported ok');
  if (impl(rec({ at: 'garbage' }), now).ok) bad.push('unparseable timestamp reported ok');
  return bad;
}
const base = report;
const breaks = [
  (r, n) => ({ ...base(r, n), top: 'node' }),                                                        // wrong ranking
  (r, n) => base(r, 0),                                                                              // stale never noticed (now=0 -> negative age)
  (r, n) => (r ? base(r, n) : { ok: true, lines: [] }),                                              // missing record ok
  (r, n) => { const o = base(r, n); return { ...o, lines: o.lines.filter((l) => !/^VM:/.test(l)) }; }, // drops VM cap line
];
const bad = verdict(base); bad.forEach((b) => console.log('FAIL', b));
let caught = 0; breaks.forEach((b, i) => { if (verdict(b).length) caught++; else console.log('NOT CAUGHT: break #' + (i + 1)); });
console.log(`ramreadcheck: ${bad.length} failed; ${caught} breaks caught (of ${breaks.length})`);
process.exit(bad.length || caught < breaks.length ? 1 : 0);
