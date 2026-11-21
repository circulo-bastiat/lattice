// brainstatuscheck (#10457): status must not say OFFLINE when the hosted brain (BRAIN_RUNNER=mirror) runs roles. Then each rule is broken to prove the check fails.
import fs from 'node:fs';
const M = await import('./infra/brainstatus.mjs'), now = Date.parse('2026-10-27T10:00:00Z');
const fresh = [{ created_at: '2026-10-27T09:44:00Z' }], old = [{ created_at: '2026-10-27T05:00:00Z' }];
function verdict(B, GO) {
  const bad = [], t = (a, b) => B.brainLines(B.brainState({ now, ...a }), 10);
  { const L = t({ variable: 'mirror' }); if (/OFFLINE/.test(L.req + L.main)) bad.push('BRAIN_RUNNER=mirror still reads OFFLINE'); }
  { const L = t({ env: { BRAIN_RUNNER: 'mirror' } }); if (/OFFLINE/.test(L.req + L.main)) bad.push('env BRAIN_RUNNER=mirror still reads OFFLINE'); }
  { const L = t({ roleRuns: fresh }); if (/OFFLINE/.test(L.req + L.main)) bad.push('a recent role run still reads OFFLINE'); }
  { const L = t({ roleRuns: old }); if (!/OFFLINE/.test(L.main)) bad.push('nothing recent does not read OFFLINE'); }
  { const L = t({ runners: [{ status: 'online' }] }); if (/OFFLINE/.test(L.main)) bad.push('an online VM runner reads OFFLINE'); }
  if (!/brainState\(/.test(GO) || /brain OFFLINE \(\$\{rs\.length\}/.test(GO)) bad.push('go.mjs status does not use brainstatus.mjs');
  return bad;
}
const GO = fs.readFileSync('tools/go.mjs', 'utf8'), real = verdict(M, GO);
const broken = [
  ['mirror ignored', { ...M, brainState: (a) => M.brainState({ ...a, variable: null, env: {}, roleRuns: [] }) }, GO],
  ['always offline', { ...M, brainLines: () => ({ req: 'OFFLINE', main: 'brain OFFLINE' }) }, GO],
  ['never offline', { ...M, brainLines: () => ({ req: 'online', main: 'brain online' }) }, GO],
  ['old wording in go.mjs', M, GO + '\nbrain OFFLINE (${rs.length}'],
];
let caught = 0;
for (const [n, B, g] of broken) { if (verdict(B, g).length) caught++; else console.log(`  NOT caught: ${n}`); }
if (real.length) { console.log('FAIL', real); process.exit(1); }
if (caught < broken.length) process.exit(1);
console.log(`brainstatuscheck OK - ${caught} breaks caught`);
