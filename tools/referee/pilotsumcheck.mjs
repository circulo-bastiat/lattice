// #6426: pilotsum merges chunks; two servers on one requested port get different ports and workdirs.
import { merge } from './lockstep/pilotsum.mjs';
import { resolveBusyPort, portFree } from './server.mjs';
import { createServer } from 'node:net';
const L = ['zombie', 'creeper'], ch = (from, seeds, d = []) => JSON.stringify({ pilot: 'chunk', lanes: L, from, seeds, divergences: d });
const good = [ch(0, 6), ch(6, 6, [{ lane: 'zombie', salt: 7 }]), ch(12, 8)];
const m = merge(good); let fail = 0;
if (m.pilot !== 'done' || m.runs !== 40 || m.divergences.length !== 1) { console.log('FAIL merge', m); fail++; }
let caught = 0;
for (const [n, bad] of [['dropped', [good[0], good[2]]], ['duplicate', [...good, ch(0, 6)]], ['lanes', [good[0], JSON.stringify({ pilot: 'chunk', lanes: ['cow'], from: 6, seeds: 6, divergences: [] }), good[2]]]]) {
  try { merge(bad); console.log('NOT caught', n); fail++; } catch { caught++; console.log("✓ break caught: " + n); }
}
const srv = createServer(); await new Promise((r) => srv.listen(0, r)); const p = srv.address().port;
const a = await resolveBusyPort({ port: p, workDir: '/tmp/x' }), b = await resolveBusyPort({ port: p, workDir: '/tmp/x' });
if (a.port === p || b.port === p || !a.workDir.startsWith('/tmp/x-p') || a.workDir === '/tmp/x') { console.log('FAIL fallback', a, b); fail++; } else { caught++; console.log("✓ break caught"); }
srv.close();
if (!(await portFree(p))) { console.log('FAIL portFree'); fail++; }
const c = await resolveBusyPort({ port: p, workDir: '/tmp/x' });
if (c.workDir !== '/tmp/x') { console.log('FAIL free port changed'); fail++; } else { caught++; console.log("✓ break caught"); }
console.log(`pilotsumcheck: ${caught + 1} assertions, ${fail} failures, ${caught} breaks caught`);
process.exit(fail ? 1 : 0);
