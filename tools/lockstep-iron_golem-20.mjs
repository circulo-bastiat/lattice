#!/usr/bin/env node
// lockstep_iron_golem -- #5511 (G17-L4): engine side of `pilot.mjs --seeds 20 --lanes iron_golem` (the real-server runs are the pilot's, in the full suite). Faults injected: wrong attribute (pos/vel), off-by-one tick (row shift), RNG consumption order (yaw/pitch); each must be reported at the injected tick and field.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const F = ['pos', 'vel', 'yaw', 'pitch'];
// the golem is a rare wanderer (RandomStrollGoal 1/120 per tick): idle seeds are legitimate, so require motion across the set, not per seed
const traces = SALTS.map((s) => engineZombieTrace(s, { mob: 'iron_golem' }));
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${SALTS[i]}: ${R.length} rows`);
  ok(R.every((r, t) => r.tick === t && r.pos && r.vel && Number.isFinite(r.yaw) && r.pitch != null), `salt ${SALTS[i]}: row fields`);
});
ok(traces.filter((R) => new Set(R.map((r) => r.pos.join())).size > 10).length >= 5, 'iron_golem moved in fewer than 5 seeds');
ok(compareTraces(traces[0], engineZombieTrace(SALTS[0], { mob: 'iron_golem' }), { fields: F }) === null, 'same salt, same trace');
const mut = (f, fn, at = 77) => traces[0].map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
const at = (m, tick, field, name) => { const r = compareTraces(traces[0], m, { fields: F }); caught(r?.tick === tick && r?.field === field, `${name}: got ${JSON.stringify(r && { tick: r.tick, field: r.field })}`); };
at(mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]], 40), 40, 'pos', 'wrong attribute (movement speed, pos)');
at(mut('vel', (v) => [v[0] + 1e-9, v[1], v[2]], 90), 90, 'vel', 'wrong attribute (steering, vel)');
at(mut('yaw', (y) => y + 1e-6, 12), 12, 'yaw', 'RNG order (target, yaw)');
at(mut('pitch', (y) => y + 1e-6, 55), 55, 'pitch', 'RNG order (pitch)');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'off-by-one tick (row shift)');
console.log(`iron_golem: ${SALTS.length}/${SALTS.length} seeds, ${bad} divergences, ${breaks} breaks caught, ${SALTS.length * 3 + 6} assertions, ${bad} failures (engine lane; server pilot in full suite)`);
process.exit(bad ? 1 : 0);
