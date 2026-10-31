// #10414 step 1, reader half: turns the MCLITE_RAM record ramwatch.mjs publishes every 5 min into lines a Linux session can read.
// Pure report(); the CLI reads the repo variable through gh(). Numbers only.
import { gh } from './gh.mjs';
export const STALE_MS = 15 * 60e3;   // three missed 5-min ticks = the host service is down
export const CONSUMERS = { vm: 'Hyper-V brain VM', lander: 'lander/runner processes', browser: 'headless browsers', java: 'real-server JVMs', node: 'node' };
export function report(rec, now = Date.now()) {
  if (!rec || typeof rec !== 'object' || !rec.mb || !(rec.totalMB > 0)) return { ok: false, lines: ['no usable RAM record (usaged not publishing?)'] };
  const age = now - Date.parse(rec.at), stale = !(age < STALE_MS);
  const lines = [`host: ${rec.freeMB} of ${rec.totalMB} MB free, cpu ${rec.cpuPct}%${stale ? `  STALE (${Math.round(age / 60e3)} min old)` : ''}`];
  const rows = Object.entries(CONSUMERS).map(([k, name]) => ({ k, name, mb: Math.round(rec.mb[k] || 0) })).sort((a, b) => b.mb - a.mb);
  for (const r of rows) lines.push(`${String(r.mb).padStart(6)} MB ${String(Math.round(100 * r.mb / rec.totalMB)).padStart(3)}%  ${r.name}`);
  if (rec.vmMaxMB) lines.push(`VM: assigned ${rec.vmAssignedMB} MB, max ${rec.vmMaxMB} MB, cpu ${rec.vmCpuPct}%`);
  return { ok: !stale, top: rows[0].k, lines };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const v = await gh('GET', '/repos/{repo}/actions/variables/MCLITE_RAM', null, { ok404: true });
  let rec = null; try { rec = JSON.parse(v && v.value); } catch {}
  console.log(report(rec).lines.join('\n'));
}
