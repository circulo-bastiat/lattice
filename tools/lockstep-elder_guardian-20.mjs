#!/usr/bin/env node
// lockstep_elder_guardian -- #5507 (G17-L4): engine side of `pilot.mjs --seeds 20 --lanes elder_guardian` (server comparison runs in the full suite). Faults injected: wrong attribute (pos/vel), off-by-one goal tick (row shift, air), RNG consumption order (yaw/pitch); each must be reported at the injected tick and field.
import { engineGuardianTrace, GUARDIAN_FIELDS as F } from './referee/lockstep/guardianlane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => engineGuardianTrace(s));
traces.forEach((R, i) => {
  ok(R.length === T && R.every((r, t) => r.tick === t && r.pos && Number.isFinite(r.yaw)), `salt ${SALTS[i]}: rows`);
  ok(R.slice(1).every((r) => r.vel && r.vel.every(Number.isFinite) && Number.isFinite(r.air) && Number.isFinite(r.pitch)), `salt ${SALTS[i]}: vel/air/pitch`);
});
ok(traces.filter((R) => R.some((r) => r.pos.some((c, k) => c !== R[0].pos[k]))).length >= 12, 'most salts move');
ok(compareTraces(traces[0], engineGuardianTrace(0), { fields: F }) === null, 'same salt, same trace');
const mut = (f, fn, at = 77) => traces[0].map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
const at = (m, tick, field, name) => { const r = compareTraces(traces[0], m, { fields: F }); caught(r?.tick === tick && r?.field === field, `${name}: got ${JSON.stringify(r && { tick: r.tick, field: r.field })}`); };
at(mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]], 40), 40, 'pos', 'wrong attribute (speed, pos)');
at(mut('vel', (v) => [v[0], v[1], v[2] + 1e-9], 60), 60, 'vel', 'wrong attribute (vel)');
at(mut('air', (a) => a + 1, 90), 90, 'air', 'goal tick off by one (air)');
at(mut('yaw', (y) => y + 1e-9, 12), 12, 'yaw', 'RNG order (yaw)');
at(mut('pitch', (y) => y + 1e-9, 55), 55, 'pitch', 'RNG order (pitch)');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
console.log(`elder_guardian: ${SALTS.length}/${SALTS.length} seeds, ${bad} divergences, ${breaks} breaks caught, ${SALTS.length * 2 + 12} assertions, ${bad} failures (engine lane; server pilot in full suite)`);
process.exit(bad ? 1 : 0);
