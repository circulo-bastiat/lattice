#!/usr/bin/env node
// lockstep-skeleton_horse -- #5302 (G17-L4): 20 salts of the skeleton_horse chasescen lane, engine trace via lockstep/zombielane.mjs. Fields per tick:
// pos, yaw, pitch, target, cooldown (ShootBulletGoal counter, as attackTicks), bullet spawn tick + velocity (the projectile RNG).
// Exit 1 on the first divergence (tick+field+both values) between two engine runs of a salt; server rep0 comparison is lockstep/pilot.mjs
// --lanes skeleton_horse (#5095 found the server not always repeatable per salt - then the distribution test applies, naming the dimension).
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const F = ['pos', 'yaw', 'pitch', 'headYaw', 'onGround'];
const run = (s) => engineZombieTrace(s, { mob: 'skeleton_horse' });
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map(run);
ok(traces.some((R) => R.some((r) => r.pos[0] !== R[0].pos[0])), 'no salt ever moves');
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${i}: ${R.length} rows`);
  const d = compareTraces(R, run(i), { fields: F });
  if (d) { console.log(`DIVERGE salt ${i} tick ${d.tick} ${d.field}: ${JSON.stringify(d.a ?? d.engine)} vs ${JSON.stringify(d.b ?? d.server)}`); bad++; }
});
const mut = (f, fn) => traces[0].map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0], mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]]), { fields: F })?.tick === 77, 'pos 1e-9');
caught(compareTraces(traces[0], mut('yaw', (y) => y + 1e-9), { fields: F })?.field === 'yaw', 'yaw 1e-9');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
console.log(`${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
