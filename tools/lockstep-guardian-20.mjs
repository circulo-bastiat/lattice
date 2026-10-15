#!/usr/bin/env node
// lockstep_guardian -- #5506 (G17-L4): engine side of `pilot.mjs --seeds 20 --lanes guardian` (server comparison runs in the full suite). Lane: chasescen guardian (water pool), fields pos/vel/yaw/pitch/air. Faults injected: wrong attribute (pos/air), off-by-one goal tick (row shift), RNG consumption order (yaw/pitch); each must be reported at the injected tick and field.
import { engineGuardianTrace, GUARDIAN_FIELDS as F } from './referee/lockstep/guardianlane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const run = (s) => engineZombieTraceGuardian(s);
const engineZombieTraceGuardian = (s) => engineGuardianTrace(s);
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map(run);
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${i}: ${R.length} rows`);
  ok(R.every((r, t) => r.tick === t && r.pos && r.vel && Number.isFinite(r.yaw) && r.pitch != null), `salt ${i}: row fields`);
  const d = compareTraces(R, run(i), { fields: F });
  ok(d === null, `salt ${i}: not deterministic ${d && d.tick + '/' + d.field}`);
});
const mut = (f, fn, at) => traces[0].map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
const at = (m, tick, field, name) => { const r = compareTraces(traces[0], m, { fields: F }); caught(r?.tick === tick && r?.field === field, `${name}: got ${JSON.stringify(r && { tick: r.tick, field: r.field })}`); };
at(mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]], 77), 77, 'pos', 'wrong attribute (pos)');
at(mut('vel', (v) => [v[0] + 1e-9, v[1], v[2]], 40), 40, 'vel', 'wrong attribute (speed, vel)');
at(mut('air', (a) => a + 1, 90), 90, 'air', 'wrong attribute (air)');
at(mut('yaw', (y) => y + 1e-9, 12), 12, 'yaw', 'RNG order (yaw)');
at(mut('pitch', (y) => y + 1e-9, 55), 55, 'pitch', 'RNG order (pitch)');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'off-by-one goal tick (row shift)');
console.log(`guardian: ${SALTS.length}/${SALTS.length} seeds, ${bad} divergences, ${breaks} breaks caught, ${SALTS.length * 3 + 6} assertions, ${bad} failures (engine lane; server pilot in full suite)`);
process.exit(bad ? 1 : 0);
