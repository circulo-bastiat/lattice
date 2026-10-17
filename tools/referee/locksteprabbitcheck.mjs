#!/usr/bin/env node
// locksteprabbitcheck -- #6452 (G17-L4): rabbit lane engine side, 20 salts, pos/vel/yaw/pitch; real server: pilot.mjs --lanes rabbit --seeds 20.
import { engineZombieTrace } from './lockstep/zombielane.mjs';
import { compareTraces } from './lockstep/trace.mjs';
import { T } from './chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const F = ['pos', 'vel', 'yaw', 'pitch'];
const traces = SALTS.map((s) => engineZombieTrace(s, { mob: 'rabbit' }));
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${SALTS[i]}: ${R.length} rows`);
  ok(R.every((r, t) => r.tick === t && r.pos && r.vel && Number.isFinite(r.yaw) && r.pitch != null), `salt ${SALTS[i]}: row fields`);
});
const again = engineZombieTrace(SALTS[0], { mob: 'rabbit' });
const d0 = compareTraces(traces[0], again, { fields: F });
if (d0) console.log(`DIVERGENCE tick ${d0.tick} field ${d0.field}: ${JSON.stringify(d0.a)} vs ${JSON.stringify(d0.b)}`);
ok(d0 === null, 'same salt, same trace');
const mut = (f, fn) => traces[0].map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0], mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]]), { fields: F })?.tick === 77, 'pos 1e-9');
caught(compareTraces(traces[0], mut('vel', (v) => [v[0] + 1e-9, v[1], v[2]]), { fields: F })?.field === 'vel', 'vel 1e-9');
caught(compareTraces(traces[0], mut('yaw', (y) => y + 1e-9), { fields: F })?.field === 'yaw', 'yaw 1e-9');
caught(compareTraces(traces[0], mut('pitch', (y) => y + 1e-9), { fields: F })?.field === 'pitch', 'pitch 1e-9');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
console.log(`divergences: ${bad ? 1 : 0}; ${SALTS.length * 3 + 6} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
