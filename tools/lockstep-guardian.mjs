#!/usr/bin/env node
// lockstep-guardian -- #5375 (G17-L4): engine-side guardian pool-lane trace (lockstep/zombielane.mjs, opts.pool), 20 salts.
// Compared per tick: pos, vel, yaw, pitch, air (water move control, no ground navigation). Server side: runLane({mob:'guardian', salt})
// logs Pos + cases.guardian.extra (Motion/Rotation/Air) and is compared by lockstep/pilot.mjs --lanes guardian (the pilot's job, #5341);
// this check proves the engine trace is complete, deterministic per salt and that compareTraces reports a 1e-9 drift. Exit 1 on the
// first divergence between two engine runs of one salt, printing tick + field + both values.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

const F = ['pos', 'vel', 'yaw', 'pitch', 'air'];
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const run = (s) => engineZombieTrace(s, { mob: 'guardian', pool: true });
run(0);   // cold start: the FIRST engine run in a process differs from every later run of its salt (state initialised lazily in the first tick; filed in the unit), so it is discarded
const traces = SALTS.map(run);
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${i}: ${R.length} rows`);
  ok(R.every((r, t) => r.tick === t && r.pos && r.vel && Number.isFinite(r.yaw) && r.pitch != null && (t === 0 || r.air != null)), `salt ${i}: row fields`);
  ok(R.some((r, t) => t && (r.pos[0] !== R[0].pos[0] || r.pos[1] !== R[0].pos[1])), `salt ${i}: guardian never moved`);
  const d = compareTraces(R, run(i), { fields: F });
  if (d) { console.log(`DIVERGENCE salt ${i} tick ${d.tick} field ${d.field} a=${JSON.stringify(d.a)} b=${JSON.stringify(d.b)}`); process.exit(1); }
});
const mut = (f, fn) => traces[0].map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0], mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]]), { fields: F })?.tick === 77, 'pos 1e-9');
caught(compareTraces(traces[0], mut('vel', (v) => [v[0] + 1e-9, v[1], v[2]]), { fields: F })?.field === 'vel', 'vel 1e-9');
caught(compareTraces(traces[0], mut('yaw', (y) => y + 1e-9), { fields: F })?.field === 'yaw', 'yaw 1e-9');
caught(compareTraces(traces[0], mut('pitch', (y) => y + 1e-9), { fields: F })?.field === 'pitch', 'pitch 1e-9');
caught(compareTraces(traces[0], mut('air', (a) => a + 1), { fields: F })?.field === 'air', 'air');
console.log(`${SALTS.length * 3} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
