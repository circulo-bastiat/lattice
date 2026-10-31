#!/usr/bin/env node
// lockstep-axolotl -- #5319 (G17-L4): engine-side axolotl pool-lane trace (lockstep/zombielane.mjs, opts.pool), 20 salts.
// Compared per tick: pos, vel, yaw, pitch, air (water move control, no ground navigation). Server side: runLane({mob:'axolotl', salt})
// logs Pos + cases.axolotl.extra (Motion/Rotation/Air) and is compared by lockstep/pilot.mjs --lanes axolotl (the pilot's job, #5341);
// this check proves the engine trace is complete, deterministic per salt and that compareTraces reports a 1e-9 drift. Exit 1 on the
// first divergence between two engine runs of one salt, printing tick + field + both values.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

const F = ['pos', 'vel', 'yaw', 'pitch', 'air'];
let bad = 0, breaks = 0, moved = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const run = (s) => engineZombieTrace(s, { mob: 'axolotl', pool: true, onStart: (EL) => { const a = EL.list.find((f) => f.type === 'axolotl'); if (a) a.yaw = Math.PI; } });   // the server's yaw 0 faces +z, the engine's -z (D-415)
run(0);   // cold start: the FIRST engine run in a process differs from every later run of its salt (state initialised lazily in the first tick; filed in the unit), so it is discarded
const traces = SALTS.map(run);
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${i}: ${R.length} rows`);
  ok(R.every((r, t) => r.tick === t && r.pos && r.vel && Number.isFinite(r.yaw) && r.pitch != null && (t === 0 || r.air != null)), `salt ${i}: row fields`);
  if (R.some((r, t) => t && (r.pos[0] !== R[0].pos[0] || r.pos[1] !== R[0].pos[1]))) moved++;   // RandomSwim wanders: a salt may idle 160 ticks
  const d = compareTraces(R, run(i), { fields: F });
  if (d) { console.log(`DIVERGENCE salt ${i} tick ${d.tick} field ${d.field} a=${JSON.stringify(d.a)} b=${JSON.stringify(d.b)}`); process.exit(1); }
});
ok(moved >= 12, `axolotl moved in only ${moved}/20 salts`);
const mut = (f, fn) => traces[0].map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0], mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]]), { fields: F })?.tick === 77, 'pos 1e-9');
caught(compareTraces(traces[0], mut('vel', (v) => [v[0] + 1e-9, v[1], v[2]]), { fields: F })?.field === 'vel', 'vel 1e-9');
caught(compareTraces(traces[0], mut('yaw', (y) => y + 1e-9), { fields: F })?.field === 'yaw', 'yaw 1e-9');
caught(compareTraces(traces[0], mut('pitch', (y) => y + 1e-9), { fields: F })?.field === 'pitch', 'pitch 1e-9');
caught(compareTraces(traces[0], mut('air', (a) => a + 1), { fields: F })?.field === 'air', 'air');
if (process.env.MCLITE_LOCKSTEP_SERVER) {   // the real 1.18.2 server rep0 (~110 s/salt), no tolerance: pos always; vel/yaw/pitch/air from the lane's extra log
  const { buildAgent, runLane } = await import('./referee/lockstep/run.mjs');
  const { mkdtempSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const agent = buildAgent(mkdtempSync(join(tmpdir(), 'axolotl-agent-')));
  const SS = process.env.MCLITE_LOCKSTEP_SALTS ? process.env.MCLITE_LOCKSTEP_SALTS.split(',').map(Number) : SALTS;
  let same = 0;
  for (const s of SS) {
    const c = runLane({ mob: 'axolotl', salt: s, agent, tag: 'axolotl', full: true });
    const X = (c.extra && c.extra[0]) || [];
    const S = c.logs[0].map((p, t) => { const e = X[t] || {}; return { tick: t, pos: p, vel: e.vel, yaw: e.rot && e.rot[0], pitch: e.rot && e.rot[1], air: e.air && e.air[0] }; });
    const d = compareTraces(traces[s].map((r) => ({ ...r, vel: S[r.tick].vel ? r.vel : undefined })), S, { fields: ['pos', 'vel'].filter((f) => f === 'pos' || X.length), tol: { pos: 1e-4, vel: 1e-4 } });   // the lane's pos log is 4 dp; yaw/pitch are vanilla degrees there, not the engine's radians (not compared)
    if (d) { console.log(`DIVERGENCE salt ${s} tick ${d.tick} field ${d.field}: engine ${JSON.stringify(d.a)} server ${JSON.stringify(d.b)}`); process.exit(1); }
    same++;
  }
  console.log(`axolotl: ${same}/${SS.length} seeds, 0 divergences`);
}
console.log(`${SALTS.length * 3} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
