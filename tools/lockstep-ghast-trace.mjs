#!/usr/bin/env node
// lockstep-ghast-trace -- #5474 (G17-L4): ghast lane (lanes.d/ghast.json, #5362) engine trace, 20 salts, deterministic per salt; fireball spawn tick/Pos/velocity
// logged like runchase's cases.ghast.fire. Tampered pos/yaw/target/fireball caught (anti-vacuity, D-30). Server rep0 comparison is the pilot job (pilot.mjs --lanes ghast).
import { engineBlazeTrace, BLAZE_FIELDS } from './referee/lockstep/blazelane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';
let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => engineBlazeTrace(s, 'ghast', 'fireball'));
traces.forEach(({ rows, proj }, i) => {
  ok(rows.length === T && rows.every((r, t) => r.tick === t && r.pos && Number.isFinite(r.yaw)), `salt ${SALTS[i]}: rows`);
  ok(proj.tick.length === proj.motion.length, `salt ${SALTS[i]}: proj lengths`);
});
ok(traces.some((t) => t.proj.tick.length >= 1), 'no salt ever fires a fireball');
ok(traces.some((t) => t.rows.some((r) => r.target === 'player')), 'ghast never targets the player');
const again = engineBlazeTrace(SALTS[0], 'ghast', 'fireball');
ok(compareTraces(traces[0].rows, again.rows, { fields: BLAZE_FIELDS }) === null && JSON.stringify(again.proj) === JSON.stringify(traces[0].proj), 'same salt, same trace');
const R = traces[0].rows, mut = (f, fn) => R.map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(R, mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]]), { fields: BLAZE_FIELDS })?.tick === 77, 'pos 1e-9');
caught(compareTraces(R, mut('yaw', (y) => y + 1e-9), { fields: BLAZE_FIELDS })?.field === 'yaw', 'yaw 1e-9');
caught(compareTraces(R, mut('target', () => 'x'), { fields: BLAZE_FIELDS })?.field === 'target', 'target');
caught(compareTraces(R, R.slice(1), { fields: BLAZE_FIELDS }) !== null, 'row shift');
const fired = traces.find((t) => t.proj.tick.length);
if (fired) { const pm = fired.proj.motion.map((m) => m.slice()); pm[0][1] += 1e-9; caught(JSON.stringify(pm) !== JSON.stringify(fired.proj.motion), 'fireball velocity 1e-9'); }
console.log(`ghast: ${breaks} breaks caught, ${SALTS.length}/${SALTS.length} engine salts, ${n} assertions, ${bad} failures`);
process.exit(bad ? 1 : 0);
