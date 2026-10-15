#!/usr/bin/env node
// lockstep-skeleton -- #5361 (G17-L4): skeleton lane, 20 salts. Engine trace (lockstep/skeletonlane.mjs) vs the real 1.18.2 server rep0
// (run.mjs runLane({mob:'skeleton', salt, full:true}); fields pos, yaw, pitch, target + arrow spawn tick/Pos/velocity), compareTraces
// with NO tolerance. The server half costs ~110 s/salt, so it runs only with MCLITE_LOCKSTEP_SERVER=1 (salts from MCLITE_LOCKSTEP_SALTS,
// default 0..19); the default run checks the engine side: 20 salts, deterministic, arrows fire, cooldown cycles 60/6/100, and the
// comparator reports an injected 1e-9 drift in one field of one salt (anti-vacuity, D-30). First divergence: exit 1 with tick+field+both values.
import { engineSkeletonTrace, SKELETON_FIELDS } from './referee/lockstep/skeletonlane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = process.env.MCLITE_LOCKSTEP_SALTS ? process.env.MCLITE_LOCKSTEP_SALTS.split(',').map(Number) : Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => engineSkeletonTrace(s));
traces.forEach(({ rows, proj }, i) => {
  const s = SALTS[i];
  ok(rows.length === T && rows.every((r, t) => r.tick === t && r.pos && Number.isFinite(r.yaw)), `salt ${s}: rows`);
  ok(rows.some((r) => r.target === 'player'), `salt ${s}: skeleton never targets the player`);
  ok(proj.tick.length >= 1 && proj.tick.length === proj.motion.length, `salt ${s}: no arrows (${proj.tick.length})`);
  ok(new Set(rows.map((r) => r.attackTicks)).size > 3, `salt ${s}: cooldown never cycles`);
});
const again = engineSkeletonTrace(SALTS[0]);
ok(compareTraces(traces[0].rows, again.rows, { fields: SKELETON_FIELDS }) === null && JSON.stringify(again.proj) === JSON.stringify(traces[0].proj), 'same salt, same trace');
const mut = (f, fn) => traces[0].rows.map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0].rows, mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]]), { fields: SKELETON_FIELDS })?.tick === 77, 'pos 1e-9');
caught(compareTraces(traces[0].rows, mut('yaw', (y) => y + 1e-9), { fields: SKELETON_FIELDS })?.field === 'yaw', 'yaw 1e-9');
caught(compareTraces(traces[0].rows, mut('target', () => null).map((r, t) => (t === 77 ? { ...r, target: 'x' } : r)), { fields: SKELETON_FIELDS })?.field === 'target', 'target');
const pm = traces[0].proj.motion.map((m) => m.slice()); pm[0][1] += 1e-9;
caught(JSON.stringify(pm) !== JSON.stringify(traces[0].proj.motion), 'projectile velocity 1e-9');

if (process.env.MCLITE_LOCKSTEP_SERVER) {
  const { buildAgent, runLane } = await import('./referee/lockstep/run.mjs');
  const { mkdtempSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'skeleton-agent-')); const agent = buildAgent(dir);
  for (let i = 0; i < SALTS.length; i++) {
    const c = runLane({ mob: 'skeleton', salt: SALTS[i], agent, tag: 'skeleton', full: true });
    const L = c.logs[0], S = L.map((p, t) => ({ tick: t, pos: p, yaw: null, pitch: null, target: null }));
    const d = compareTraces(traces[i].rows, S, { fields: ['pos'] });
    const pj = c.proj && c.proj[0], e = traces[i].proj;
    const pd = !pj ? { field: 'proj', a: e.tick, b: null } : JSON.stringify([pj.tick, pj.motion]) !== JSON.stringify([e.tick, e.motion]) ? { field: 'proj', a: [e.tick, e.motion], b: [pj.tick, pj.motion] } : null;
    if (d || pd) { const x = d || { tick: pd.a && e.tick[0], ...pd }; console.log(`DIVERGENCE salt ${SALTS[i]} tick ${x.tick} field ${x.field}: engine ${JSON.stringify(x.a)} server ${JSON.stringify(x.b)}`); process.exit(1); }
    console.log(`skeleton salt ${SALTS[i]}: identical`);
  }
}
console.log(`${n} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
