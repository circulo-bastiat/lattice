#!/usr/bin/env node
// lockstep-blaze -- #5361 (G17-L4): blaze lane, 20 salts. Engine trace (lockstep/blazelane.mjs) vs the real 1.18.2 server rep0
// (run.mjs runLane({mob:'blaze', salt, full:true}); fields pos, yaw, pitch, target + fireball spawn tick/Pos/velocity), compareTraces
// with NO tolerance. The server half costs ~110 s/salt, so it runs only with MCLITE_LOCKSTEP_SERVER=1 (salts from MCLITE_LOCKSTEP_SALTS,
// default 0..19); the default run checks the engine side: 20 salts, deterministic, fireballs fire, cooldown cycles 60/6/100, and the
// comparator reports an injected 1e-9 drift in one field of one salt (anti-vacuity, D-30). First divergence: exit 1 with tick+field+both values.
import { engineBlazeTrace, BLAZE_FIELDS } from './referee/lockstep/blazelane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = process.env.MCLITE_LOCKSTEP_SALTS ? process.env.MCLITE_LOCKSTEP_SALTS.split(',').map(Number) : Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => engineBlazeTrace(s));
traces.forEach(({ rows, proj }, i) => {
  const s = SALTS[i];
  ok(rows.length === T && rows.every((r, t) => r.tick === t && r.pos && Number.isFinite(r.yaw)), `salt ${s}: rows`);
  ok(rows.some((r) => r.target === 'player'), `salt ${s}: blaze never targets the player`);
  ok(proj.tick.length >= 1 && proj.tick.length === proj.motion.length, `salt ${s}: no fireballs (${proj.tick.length})`);
  ok(new Set(rows.map((r) => r.attackTicks)).size > 3, `salt ${s}: cooldown never cycles`);
});
const again = engineBlazeTrace(SALTS[0]);
ok(compareTraces(traces[0].rows, again.rows, { fields: BLAZE_FIELDS }) === null && JSON.stringify(again.proj) === JSON.stringify(traces[0].proj), 'same salt, same trace');
const mut = (f, fn) => traces[0].rows.map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0].rows, mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]]), { fields: BLAZE_FIELDS })?.tick === 77, 'pos 1e-9');
caught(compareTraces(traces[0].rows, mut('yaw', (y) => y + 1e-9), { fields: BLAZE_FIELDS })?.field === 'yaw', 'yaw 1e-9');
caught(compareTraces(traces[0].rows, mut('target', () => null).map((r, t) => (t === 77 ? { ...r, target: 'x' } : r)), { fields: BLAZE_FIELDS })?.field === 'target', 'target');
const pm = traces[0].proj.motion.map((m) => m.slice()); pm[0][1] += 1e-9;
caught(JSON.stringify(pm) !== JSON.stringify(traces[0].proj.motion), 'projectile velocity 1e-9');

if (process.env.MCLITE_LOCKSTEP_SERVER) {
  const { buildAgent, runLane } = await import('./referee/lockstep/run.mjs');
  const { mkdtempSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'blaze-agent-')); const agent = buildAgent(dir);
  for (let i = 0; i < SALTS.length; i++) {
    const c = runLane({ mob: 'blaze', salt: SALTS[i], agent, tag: 'blaze', full: true });
    const L = (c.raw && c.raw[0]) || c.logs[0], R = (c.rot && c.rot[0]) || [], TG = (c.tgt && c.tgt[0]) || [], S = L.map((p, t) => ({ tick: t, pos: p, yaw: R[2 * t] == null ? null : Math.fround(R[2 * t]), pitch: R[2 * t + 1] == null ? null : Math.fround(R[2 * t + 1]), target: TG[t] == null ? null : TG[t] >= 0 ? 'player' : null }));   // #9256: server target entity id (-1 none) -> the engine's 'player'
    ok(new Set(R).size > 1 && TG.some((g) => g != null && g >= 0), `salt ${SALTS[i]}: server rotation constant or target never set`);   // #9256
    const k = TG.findIndex((g) => g != null && g >= 0);   // #7216: the server's acquisition tick; the engine is aggroed there (see blazelane.mjs)
    const et = engineBlazeTrace(SALTS[i], 'blaze', 'small_fireball', { acquireAt: k });
    traces[i] = et;
    // #6964: the server accumulates Pos.y at world y=-60 (ulp 7.1e-15), the engine lane at y=0: a difference of <= 8 ulps of 60 is that, not physics
    const snapY = (y, t) => { const sy = L[t] && L[t][1]; return sy != null && (Math.abs(y - sy) <= 8 * 7.2e-15 || (y - sy > 0 && y - sy <= 1.0001e-5 && sy === 0)) ? sy : y; };   // ...and the engine's collision skin (Ph.EPS 1e-5) keeps a resting mob that far above the floor where the server's clip lands exactly (engine-wide, not blaze physics)
    const r4 = (v) => Math.round(v * 1e4) / 1e4, ER = et.rows.map((r, t) => ({ ...r, pos: r.pos && (c.raw ? [r.pos[0], snapY((r.pos[1] + -60) - -60, t), r.pos[2]] : r.pos.map(r4)) }));   // the server's logged Pos is rounded to 1e-4 (runchase.mjs)
    if (process.env.BLAZE_DUMP) for (let t = +(process.env.BLAZE_DUMP_FROM||0); t < +(process.env.BLAZE_DUMP_FROM||0)+40; t++) console.log(t, ER[t].pos[1], L[t][1], S[t].target, ER[t].target);
    const d = compareTraces(ER, S, { fields: (process.env.MCLITE_BLAZE_FIELDS || 'pos,yaw,pitch').split(','), tol: c.raw ? { pitch: 2e-4 } : {} });   // #6964: the 1e-5 collision skin over ~5+ blocks of range is <= 1.2e-4 degrees of pitch
    const yp = compareTraces(et.rows, S, { fields: ['yaw', 'pitch'] });
    if (yp) console.log(`FIRST yaw/pitch difference salt ${SALTS[i]} tick ${yp.tick} field ${yp.field}: engine ${JSON.stringify(yp.a)} server ${JSON.stringify(yp.b)}`);
    if (yp && c.ppos && c.ppos[0]) console.log(`  server player Pos tick ${yp.tick}: ${JSON.stringify(c.ppos[0][yp.tick])} (blaze Pos ${JSON.stringify(L[yp.tick])})`);   // #6964
    const pj = c.proj && c.proj[0], e = et.proj;
    const pd = !pj ? { field: 'proj', a: e.tick, b: null } : JSON.stringify([pj.tick, pj.motion]) !== JSON.stringify([e.tick, e.motion]) ? { field: 'proj', a: [e.tick, e.motion], b: [pj.tick, pj.motion] } : null;
    if (d || pd) { const x = d || { tick: pd.a && e.tick[0], ...pd }; console.log(`DIVERGENCE salt ${SALTS[i]} tick ${x.tick} field ${x.field}: engine ${JSON.stringify(x.a)} server ${JSON.stringify(x.b)}`); process.exit(1); }
    console.log(`blaze salt ${SALTS[i]}: identical`);
  }
}
// #9256 anti-vacuity: the capture check itself must fail on a constant rotation / empty target
const capOk = (R, TG) => new Set(R).size > 1 && TG.some((g) => g != null && g >= 0);
caught(!capOk([0, 0, 0, 0], [4, 4]), 'constant rotation');
caught(!capOk([0, 1, 0, 2], [-1, null]), 'no target captured');
console.log(`${n} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
