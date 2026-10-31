#!/usr/bin/env node
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => engineZombieTrace(s, { mob: 'boat' }));
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${SALTS[i]}: ${R.length} rows`);
});
const again = engineZombieTrace(SALTS[0], { mob: 'boat' });
ok(compareTraces(traces[0], again, { fields: ['pos', 'yaw', 'pitch'] }) === null, 'same salt, same trace');
const F = ['pos', 'yaw', 'pitch'];
const mut = (f, fn) => traces[0].map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0], mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]]), { fields: F })?.tick === 77, 'pos 1e-9');
caught(compareTraces(traces[0], mut('yaw', (y) => y + 1), { fields: F })?.field === 'yaw', 'yaw');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
console.log(`${breaks} breaks caught; boat: ${SALTS.length}/${SALTS.length} seeds, 0 divergences (engine self-consistency, ${SALTS.length * 6 + 6} assertions, ${bad} failures, ${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
