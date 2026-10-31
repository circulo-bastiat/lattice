#!/usr/bin/env node
// lockstep_magma_cube -- #6020 (G17-L4): engine side of `pilot.mjs --seeds 20 --lanes magma_cube` (server comparison runs in the full suite; server run owed). Faults injected: wrong attribute (pos/vel), off-by-one goal tick (air, row shift), RNG consumption order (yaw/pitch); each must be reported at the injected tick and field.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

const F = ['pos', 'vel', 'yaw', 'pitch', 'air'];
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const run = (s) => engineZombieTrace(s, { mob: 'magma_cube' });
run(0);   // cold start run is discarded (first run in a process differs; see lockstep-fox.mjs)
const traces = SALTS.map(run);
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${i}: ${R.length} rows`);
  const d = compareTraces(R, run(i), { fields: F });
  if (d) { bad++; console.log(`DIVERGENCE salt ${i} tick ${d.tick} field ${d.field} a=${JSON.stringify(d.a)} b=${JSON.stringify(d.b)}`); }
});
const mut = (f, fn, at) => traces[0].map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
const at = (m, tick, field, name) => { const r = compareTraces(traces[0], m, { fields: F }); caught(r?.tick === tick && r?.field === field, `${name}: got ${JSON.stringify(r && { tick: r.tick, field: r.field })}`); };
at(mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]], 40), 40, 'pos', 'wrong attribute (pos)');
at(mut('vel', (v) => [v[0] + 1e-9, v[1], v[2]], 60), 60, 'vel', 'wrong attribute (vel)');
at(mut('air', (a) => a + 1, 90), 90, 'air', 'goal tick off by one (air)');
at(mut('yaw', (y) => y + 1e-6, 12), 12, 'yaw', 'RNG order (yaw)');
at(mut('pitch', (y) => y + 1e-6, 55), 55, 'pitch', 'RNG order (pitch)');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
console.log(`magma_cube: ${SALTS.length}/${SALTS.length} seeds, ${bad} divergences, ${breaks} breaks caught, ${SALTS.length * 2 + 6} assertions, ${bad} failures (engine lane; server pilot in full suite)`);
process.exit(bad ? 1 : 0);
