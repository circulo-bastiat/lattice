#!/usr/bin/env node
// lockstep-llama -- #5992 (G17-L4): llama chase lane (chasescen LOCKSTEP_ONLY) engine trace, 20 salts (0..19), row fields, summon at 11.5, deterministic per salt, tampered pos 1e-9/yaw/attack/health/shift caught. Server rep0 comparison is the pilot job; server traces are not assumed repeatable per salt (#5108), the distribution test is the fallback.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => engineZombieTrace(s, { mob: 'llama' }));
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${SALTS[i]}: ${R.length} rows`);
  ok(R.every((r, t) => r.tick === t && r.pos && Number.isFinite(r.yaw) && r.pitch != null && r.health > 0 && r.attackTicks >= 0), `salt ${SALTS[i]}: row fields`);
  ok(R[0].pos[0] === 11.5, `salt ${SALTS[i]}: summon at 11.5, got ${R[0].pos[0]}`);
});
ok(traces.some((R) => R[T - 1].pos.some((v, k) => v !== R[0].pos[k])), 'llama never moves');
const again = engineZombieTrace(SALTS[0], { mob: 'llama' });
ok(compareTraces(traces[0], again, { fields: ['pos', 'yaw', 'pitch', 'target', 'attackTicks', 'health'] }) === null, 'same salt, same trace');
const F = ['pos', 'yaw', 'pitch', 'target', 'attackTicks', 'health'];
const mut = (f, fn) => traces[0].map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0], mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]]), { fields: F })?.tick === 77, 'pos 1e-9');
caught(compareTraces(traces[0], mut('yaw', (y) => y + 1), { fields: F })?.field === 'yaw', 'yaw');
caught(compareTraces(traces[0], mut('attackTicks', (a) => a + 1), { fields: F })?.field === 'attackTicks', 'attackTicks');
caught(compareTraces(traces[0], mut('health', (h) => h - 1), { fields: F })?.field === 'health', 'health');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
console.log(`${SALTS.length * 6 + 6} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
