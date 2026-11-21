#!/usr/bin/env node
// lockstep_witch -- #5444 (G17-L4): engine side of `pilot.mjs --seeds 20 --lanes witch` (the real-server runs are the pilot's, in the full suite). Faults injected: wrong attribute (pos/vel), off-by-one tick (row shift), RNG consumption order (yaw/pitch); each must be reported at the injected tick and field.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const F = ['pos', 'vel', 'yaw', 'pitch'];
const traces = SALTS.map((s) => engineZombieTrace(s, { mob: 'witch' }));
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${SALTS[i]}: ${R.length} rows`);
  ok(R.every((r, t) => r.tick === t && r.pos && r.vel && Number.isFinite(r.yaw) && r.pitch != null), `salt ${SALTS[i]}: row fields`);
  ok(new Set(R.map((r) => r.pos.join())).size > 10, `salt ${SALTS[i]}: witch never moved`);
});
ok(compareTraces(traces[0], engineZombieTrace(SALTS[0], { mob: 'witch' }), { fields: F }) === null, 'same salt, same trace');
const mut = (f, fn, at = 77) => traces[0].map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
const at = (m, tick, field, name) => { const r = compareTraces(traces[0], m, { fields: F }); caught(r?.tick === tick && r?.field === field, `${name}: got ${JSON.stringify(r && { tick: r.tick, field: r.field })}`); };
at(mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]], 40), 40, 'pos', 'wrong attribute (flight speed, pos)');
at(mut('vel', (v) => [v[0] + 1e-9, v[1], v[2]], 90), 90, 'vel', 'wrong attribute (steering, vel)');
at(mut('yaw', (y) => y + 1e-6, 12), 12, 'yaw', 'RNG order (hangingPos target, yaw)');
at(mut('pitch', (y) => y + 1e-6, 55), 55, 'pitch', 'RNG order (pitch)');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'off-by-one tick (row shift)');
console.log(`witch: ${SALTS.length}/${SALTS.length} seeds, ${bad} divergences, ${breaks} breaks caught, ${SALTS.length * 3 + 6} assertions, ${bad} failures (engine lane; server pilot in full suite)`);
process.exit(bad ? 1 : 0);
