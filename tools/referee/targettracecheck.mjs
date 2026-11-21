// targettracecheck.mjs -- #6253 (G17-L21): server-side trace rows take 'target' from the agent's TGT log (MobEntity.getTarget), not only AngryAt.
import { serverRow, engineRow, compareTraces, parseTargetLog } from './lockstep/trace.mjs';
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  ✗ ' + m); } };
const brk = (c, m) => { n++; if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const U = '11111111-2222-3333-4444-555555555555';
const P = parseTargetLog(`noise\nTGT 0 none\nTGT 1 none\nTGT 2 ${U}\nTGT 3 ${U}\n`);
ok(P[0] === null && P[2] === U && P[4] === undefined, 'log parsed per tick, none -> null');
const srv = Array.from({ length: 4 }, (_, t) => serverRow(t, {}, { target: P[t] }));
ok(srv[1].target === null && srv[2].target === U, 'serverRow target from x.target (no AngryAt)');
ok(serverRow(0, { AngryAt: 'abc' }, {}).target === 'abc', 'AngryAt fallback kept when no log');
const eng = (id) => Array.from({ length: 4 }, (_, t) => engineRow(t, { target: t >= 2 ? { id } : null }));
ok(compareTraces(srv, eng(U), { fields: ['target'] }) === null, 'identical targets compare equal');
const d = compareTraces(srv, eng('other'), { fields: ['target'] });
brk(d && d.tick === 2 && d.field === 'target', 'different target id reported at tick 2, field target');
console.log(`targettracecheck: ${n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
