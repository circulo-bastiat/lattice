#!/usr/bin/env node
// lockstep-husk -- #6486 (G17-L4): the husk lane (chasescen LOCKSTEP_ONLY, HuskEntity goals) on the engine side,
// 20 salts, fields pos/yaw/pitch/headYaw/onGround. Same salt = same trace; compareTraces reports tampered rows (1e-9 drift included).
// Server rep0 comparison is the pilot's job (pilot --lanes husk); #5094 found the server not repeatable on some salts (#5108).
import { engineZombieTrace } from './lockstep/zombielane.mjs';
import { compareTraces } from './lockstep/trace.mjs';
import { T } from './chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const F = ['pos', 'yaw', 'pitch', 'headYaw', 'onGround'];
const traces = SALTS.map((s) => engineZombieTrace(s, { mob: 'husk' }));
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${SALTS[i]}: ${R.length} rows`);
  ok(R.every((r, t) => r.tick === t && r.pos && Number.isFinite(r.yaw) && r.pitch != null), `salt ${SALTS[i]}: row fields`);
});
ok(traces.some((R) => R.some((r) => r.pos[0] !== R[0].pos[0] || r.pos[2] !== R[0].pos[2])), 'no husk ever strolled');
const again = engineZombieTrace(SALTS[0], { mob: 'husk' });
ok(compareTraces(traces[0], again, { fields: F }) === null, 'same salt, same trace');
const mut = (f, fn) => traces[0].map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
let d = compareTraces(traces[0], mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]]), { fields: F });
caught(d?.tick === 77, 'pos 1e-9');
caught(compareTraces(traces[0], mut('yaw', (y) => y + 1e-9), { fields: F })?.field === 'yaw', 'yaw 1e-9');
caught(compareTraces(traces[0], mut('headYaw', (y) => y + 1), { fields: F })?.field === 'headYaw', 'headYaw');
caught(compareTraces(traces[0], mut('onGround', (g) => !g), { fields: F })?.field === 'onGround', 'onGround');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
console.log(`divergences: ${bad}`);
console.log(`${SALTS.length * 2 + 7} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
