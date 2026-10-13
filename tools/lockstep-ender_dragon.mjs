#!/usr/bin/env node
// lockstep-ender_dragon -- #5379 (G17-L4): the engine-side ender_dragon lane (chasescen 'ender_dragon': bow in hand, survival player DIST blocks along, inside
// follow range) over salts 0..19. Per salt: 160 rows of pos/yaw/pitch/target/attackTicks/health (zombielane.mjs) plus every arrow's spawn
// tick, Pos and Motion (the projectile RNG); deterministic per salt; compareTraces reports an injected 1e-9 drift in one field of one salt.
// Server rep0 comparison is the pilot's job (pilot.mjs --lanes ender_dragon); the lane itself (runchase proj:true projType:'dragon_fireball') is exercised there.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { bad++; console.log('NOT CAUGHT ' + m); } };
const F = ['pos', 'yaw', 'pitch', 'target', 'health', 'phase', 'arrows'];
const run = (salt) => {
  const phases = [];
  const arrows = [];
  const rows = engineZombieTrace(salt, { mob: 'ender_dragon', onTick: (t, EL) => { const dr = EL.list.find((e) => e.type === 'ender_dragon'); phases[t] = dr && dr.dragon ? dr.dragon.phaseManager.getCurrent().type.name : null; for (const a of EL.list) if (a.type === 'dragon_fireball' && !a._seen) { a._seen = 1; arrows.push([t, a.x, a.y, a.z, a.vx, a.vy, a.vz]); } } });
  // arrows seen after tick t's world step belong to row t: row.arrows = [spawn tick, pos, motion] of every arrow so far
  return rows.map((r, t) => ({ ...r, phase: phases[t] ?? phases[t + 1] ?? null, arrows: arrows.filter((a) => a[0] <= t).map((a) => a.slice()) }));
};
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map(run);
traces.forEach((R, i) => {
  const s = SALTS[i];
  ok(R.length === T, `salt ${s}: ${R.length} rows`);
  ok(R.every((r) => r.pos && Number.isFinite(r.yaw) && r.pitch != null && r.health > 0), `salt ${s}: row fields`);
  ok(R.every((r) => r.phase), `salt ${s}: phase missing`);
    const d = compareTraces(R, run(s), { fields: F });
  if (d) console.log(`salt ${s}: not deterministic: tick ${d.tick} ${d.field} ${JSON.stringify(d.a)} vs ${JSON.stringify(d.b)}`);
  ok(d === null, `salt ${s}: same salt, same trace`);
});
ok(new Set(traces.map((R) => JSON.stringify(R[T - 1].pos))).size > 1, 'salts differ (dragon RNG is live)');
const mut = (R, f, fn, t = 120) => R.map((r, k) => (k === t ? { ...r, [f]: fn(r[f]) } : r));
const A = traces[3];
caught(compareTraces(A, mut(A, 'pos', (p) => [p[0] + 1e-9, p[1], p[2]]), { fields: F })?.field === 'pos', 'pos 1e-9 drift');
caught(compareTraces(A, mut(A, 'yaw', (y) => y + 1e-9), { fields: F })?.field === 'yaw', 'yaw 1e-9 drift');
caught(compareTraces(A, mut(A, 'arrows', () => [[5, 0, 0, 0, 1e-9, 0, 0]], T - 1), { fields: F })?.field === 'arrows', 'fireball injected');
caught(compareTraces(A, mut(A, 'phase', () => 'Sitting'), { fields: F })?.field === 'phase', 'phase');
caught(compareTraces(A, mut(A, 'health', (h) => h + 1e-9), { fields: F })?.field === 'health', 'health 1e-9 drift');
console.log(`lockstep-ender_dragon: ${SALTS.length * 6 + 1 + 5} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
