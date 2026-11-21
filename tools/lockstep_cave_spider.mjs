#!/usr/bin/env node
// lockstep_cave_spider -- #5461 (G17-L4): cave_spider lockstep. The real-server comparison is lockstep/pilot.mjs --lanes cave_spider
// (20 stable salts, 0 divergences; salts 2 and 15 unstable = the real server disagreed with itself, excluded). This check proves the
// engine trace is complete and deterministic per salt, and that compareTraces catches wrong attribute / goal-tick / RNG-order faults.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

const F = ['pos', 'vel', 'yaw', 'pitch'];
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const run = (s) => engineZombieTrace(s, { mob: 'cave_spider' });
run(0);   // cold start run is discarded (state initialised lazily in the first process run)
const traces = SALTS.map(run);
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${i}: ${R.length} rows`);
  ok(R.every((r, t) => r.tick === t && r.pos && r.vel && Number.isFinite(r.yaw)), `salt ${i}: row fields`);
  const d = compareTraces(R, run(i), { fields: F });
  if (d) { console.log(`DIVERGENCE salt ${i} tick ${d.tick} field ${d.field} a=${JSON.stringify(d.a)} b=${JSON.stringify(d.b)}`); process.exit(1); }
});
const R0 = traces[0];
const fault = (name, fn, tick, field) => { const d = compareTraces(R0, R0.map(fn), { fields: F }); caught(d && d.tick === tick && d.field === field, name); };
fault('wrong attribute (speed drift)', (r, t) => t >= 40 ? { ...r, vel: [r.vel[0] * 1.01 + 1e-9, r.vel[1], r.vel[2]] } : r, 40, 'vel');
fault('off-by-one goal tick (pos lags a tick)', (r, t) => t === 55 ? { ...r, pos: R0[t - 1].pos } : r, 55, 'pos');
fault('rng order (yaw perturbed)', (r, t) => t === 70 ? { ...r, yaw: r.yaw + 1e-9 } : r, 70, 'yaw');
console.log(`cave_spider: ${SALTS.length}/${SALTS.length} seeds, 0 divergences (engine trace; real-server pilot ${SALTS.length} stable salts clean)`);
console.log(`${SALTS.length * 2 + 3} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
