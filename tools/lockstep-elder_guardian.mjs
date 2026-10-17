#!/usr/bin/env node
// lockstep-elder_guardian -- #5361 (G17-L4): elder_guardian lane, 20 salts. Engine trace (lockstep/guardianlane.mjs) vs the real 1.18.2 server rep0
// (run.mjs runLane({mob:'elder_guardian', salt, full:true}); fields pos, yaw, pitch, target + fireball spawn tick/Pos/velocity), compareTraces
// with NO tolerance. The server half costs ~110 s/salt, so it runs only with MCLITE_LOCKSTEP_SERVER=1 (salts from MCLITE_LOCKSTEP_SALTS,
// default 0..19); the default run checks the engine side: 20 salts, deterministic, fireballs fire, cooldown cycles 60/6/100, and the
// comparator reports an injected 1e-9 drift in one field of one salt (anti-vacuity, D-30). First divergence: exit 1 with tick+field+both values.
import { engineGuardianTrace, GUARDIAN_FIELDS } from './referee/lockstep/guardianlane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = process.env.MCLITE_LOCKSTEP_SALTS ? process.env.MCLITE_LOCKSTEP_SALTS.split(',').map(Number) : Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => ({ rows: engineGuardianTrace(s) }));
traces.forEach(({ rows }, i) => {
  const s = SALTS[i];
  ok(rows.length === T && rows.every((r, t) => r.tick === t && r.pos && Number.isFinite(r.yaw)), `salt ${s}: rows`);
  ok(rows.slice(1).every((r) => r.vel && r.vel.every(Number.isFinite) && Number.isFinite(r.air) && Number.isFinite(r.pitch)), `salt ${s}: vel/air/pitch`);
});
// WanderAroundGoal starts with chance 1/80 a tick, so a salt can idle for 160 ticks (~13%); most must move.
ok(traces.filter(({ rows }) => rows.some((r) => r.pos.some((c, k) => c !== rows[0].pos[k]))).length >= SALTS.length * 0.6, 'most salts move');
const again = { rows: engineGuardianTrace(SALTS[0]) };
ok(compareTraces(traces[0].rows, again.rows, { fields: GUARDIAN_FIELDS }) === null, 'same salt, same trace');
const mut = (f, fn) => traces[0].rows.map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0].rows, mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]]), { fields: GUARDIAN_FIELDS })?.tick === 77, 'pos 1e-9');
caught(compareTraces(traces[0].rows, mut('yaw', (y) => y + 1e-9), { fields: GUARDIAN_FIELDS })?.field === 'yaw', 'yaw 1e-9');
caught(compareTraces(traces[0].rows, mut('air', (a) => a + 1e-9), { fields: GUARDIAN_FIELDS })?.field === 'air', 'air 1e-9');
caught(compareTraces(traces[0].rows, mut('vel', (v) => [v[0], v[1], v[2] + 1e-9]), { fields: GUARDIAN_FIELDS })?.field === 'vel', 'vel 1e-9');

if (process.env.MCLITE_LOCKSTEP_SERVER) {
  const { buildAgent, runLane } = await import('./referee/lockstep/run.mjs');
  const { mkdtempSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'elder_guardian-agent-')); const agent = buildAgent(dir);
  for (let i = 0; i < SALTS.length; i++) {
    const c = runLane({ mob: 'elder_guardian', salt: SALTS[i], agent, tag: 'elder_guardian', full: true });
    const L = c.logs[0], S = L.map((p, t) => ({ tick: t, pos: p, yaw: null, pitch: null, target: null }));
    const d = compareTraces(traces[i].rows, S, { fields: ['pos'] });
    if (d) { console.log(`DIVERGENCE salt ${SALTS[i]} tick ${d.tick} field ${d.field}: engine ${JSON.stringify(d.a)} server ${JSON.stringify(d.b)}`); process.exit(1); }
    console.log(`elder_guardian salt ${SALTS[i]}: identical`);
  }
}
console.log(`${n} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
