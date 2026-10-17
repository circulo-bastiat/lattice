#!/usr/bin/env node
// lockstep-rabbit-lane -- #6148 (G17-L4): rabbit lane (tools/referee/lanes.d/rabbit.json), 20 salts engine trace, deterministic per salt.
// The lane must stay registered; tampered pos/vel/yaw/pitch and a dropped row are caught. Server comparison: lockstep/pilot.mjs --lanes rabbit --seeds 20.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T, LOCKSTEP_ONLY } from './referee/chasescen.mjs';

const F = ['pos', 'vel', 'yaw', 'pitch'];
let bad = 0, breaks = 0, moved = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
ok(LOCKSTEP_ONLY.some((l) => l.id === 'rabbit' && l.mob === 'rabbit'), 'rabbit lane not registered in lanes.d');
const run = (s) => engineZombieTrace(s, { mob: 'rabbit' });
run(0);   // cold start differs from later runs of its salt; discarded
const traces = Array.from({ length: 20 }, (_, i) => run(i));
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${i}: ${R.length} rows`);
  ok(R.every((r, t) => r.tick === t && r.pos && r.vel), `salt ${i}: row fields`);
  if (R.some((r, t) => t && (r.pos[0] !== R[0].pos[0] || r.pos[2] !== R[0].pos[2]))) moved++;
  const d = compareTraces(R, run(i), { fields: F });
  if (d) { console.log(`DIVERGENCE salt ${i} tick ${d.tick} field ${d.field} a=${JSON.stringify(d.a)} b=${JSON.stringify(d.b)}`); process.exit(1); }
});
ok(moved >= 1, `rabbit moved in only ${moved}/20 salts`);
const mut = (f, fn) => traces[0].map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0], mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]]), { fields: F })?.tick === 77, 'pos 1e-9');
caught(compareTraces(traces[0], mut('vel', (v) => [v[0] + 1e-9, v[1], v[2]]), { fields: F })?.field === 'vel', 'vel 1e-9');
caught(compareTraces(traces[0], mut('yaw', (y) => y + 1e-9), { fields: F })?.field === 'yaw', 'yaw 1e-9');
caught(compareTraces(traces[0], mut('pitch', (y) => y + 1e-9), { fields: F })?.field === 'pitch', 'pitch 1e-9');
console.log(`${20 * 3 + 5} assertions, ${bad} failures, ${breaks} breaks caught (20 salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
