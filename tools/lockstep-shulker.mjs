#!/usr/bin/env node
// lockstep-shulker -- #5373 (G17-L4): 20 salts of the shulker chasescen lane, engine trace via lockstep/zombielane.mjs. Fields per tick:
// pos, yaw, pitch, target, cooldown (ShootBulletGoal counter, as attackTicks), bullet spawn tick + velocity (the projectile RNG).
// Exit 1 on the first divergence (tick+field+both values) between two engine runs of a salt; server rep0 comparison is lockstep/pilot.mjs
// --lanes shulker (#5095 found the server not always repeatable per salt - then the distribution test applies, naming the dimension).
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const seen = new Set();
const extra = (EL, e, t) => {
  let bullet = null;
  for (const o of EL.list) if (o.type === 'shulker_bullet' && !seen.has(o)) { seen.add(o); bullet = { spawnTick: t, vel: [o.vx || 0, o.vy || 0, o.vz || 0] }; }
  return { bullet };
};
const F = ['pos', 'yaw', 'pitch', 'target', 'attackTicks', 'bullet'];
const run = (s) => { seen.clear(); return engineZombieTrace(s, { mob: 'shulker', extra }); };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map(run);
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${i}: ${R.length} rows`);
  ok(R.some((r) => r.target), `salt ${i}: shulker never targets the player`);
  ok(R.some((r) => r.bullet), `salt ${i}: no bullet spawned`);
  const d = compareTraces(R, run(i), { fields: F });
  if (d) { console.log(`DIVERGE salt ${i} tick ${d.tick} ${d.field}: ${JSON.stringify(d.a ?? d.engine)} vs ${JSON.stringify(d.b ?? d.server)}`); bad++; }
});
const mut = (f, fn) => traces[0].map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0], mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]]), { fields: F })?.tick === 77, 'pos 1e-9');
caught(compareTraces(traces[0], mut('yaw', (y) => y + 1e-9), { fields: F })?.field === 'yaw', 'yaw 1e-9');
caught(compareTraces(traces[0], mut('attackTicks', (a) => a + 1), { fields: F })?.field === 'attackTicks', 'cooldown');
const bt = traces[0].findIndex((r) => r.bullet);
caught(compareTraces(traces[0], traces[0].map((r, t) => (t === bt ? { ...r, bullet: { ...r.bullet, vel: [r.bullet.vel[0] + 1e-9, 0, 0] } } : r)), { fields: F })?.tick === bt, 'bullet vel 1e-9');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
console.log(`${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
