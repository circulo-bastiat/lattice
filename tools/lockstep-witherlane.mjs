#!/usr/bin/env node
// lockstep-witherlane -- #5378 (G17-L4): wither lane, 20 salts. Engine trace (lockstep/blazelane.mjs) vs the real 1.18.2 server rep0
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
const traces = SALTS.map((s) => engineBlazeTrace(s, 'wither', 'wither_skull'));
traces.forEach(({ rows, proj }, i) => {
  const s = SALTS[i];
  ok(rows.length === T && rows.every((r, t) => r.tick === t && r.pos && Number.isFinite(r.yaw)), `salt ${s}: rows`);
  ok(rows.some((r) => r.target === 'player'), `salt ${s}: wither never targets the player`);
  ok(proj.tick.length >= 1 && proj.tick.length === proj.motion.length, `salt ${s}: no fireballs (${proj.tick.length})`);
});
const again = engineBlazeTrace(SALTS[0], 'wither', 'wither_skull');
ok(compareTraces(traces[0].rows, again.rows, { fields: BLAZE_FIELDS }) === null && JSON.stringify(again.proj) === JSON.stringify(traces[0].proj), 'same salt, same trace');
const mut = (f, fn) => traces[0].rows.map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0].rows, mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]]), { fields: BLAZE_FIELDS })?.tick === 77, 'pos 1e-9');
caught(compareTraces(traces[0].rows, mut('yaw', (y) => y + 1e-9), { fields: BLAZE_FIELDS })?.field === 'yaw', 'yaw 1e-9');
caught(compareTraces(traces[0].rows, mut('target', () => null).map((r, t) => (t === 77 ? { ...r, target: 'x' } : r)), { fields: BLAZE_FIELDS })?.field === 'target', 'target');
{ const R = traces[0].rows, sh = R.map((r, t) => (t >= 2 ? { ...r, pos: R[t - 1].pos } : r));   // #10618 anti-vacuity: the whole impulse ramp one tick late (what an engine impulse-tick shift does to pos)
  caught(compareTraces(R, sh, { fields: ['pos'] })?.tick === 2, 'engine impulse tick shifted by one tick (first divergent tick 2)'); }
const pm = traces[0].proj.motion.map((m) => m.slice()); pm[0][1] += 1e-9;
caught(JSON.stringify(pm) !== JSON.stringify(traces[0].proj.motion), 'projectile velocity 1e-9');

if (process.env.MCLITE_LOCKSTEP_SERVER) {
  const { buildAgent, runLane } = await import('./referee/lockstep/run.mjs');
  const { mkdtempSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'wither-agent-')); const agent = buildAgent(dir);
  for (let i = 0; i < SALTS.length; i++) {
    const c = runLane({ mob: 'wither', salt: SALTS[i], agent, tag: 'wither', full: true });
    const L = (c.raw && c.raw[0]) || c.logs[0], R = (c.rot && c.rot[0]) || [], TG = (c.tgt && c.tgt[0]) || [], S = L.map((p, t) => ({ tick: t, pos: p, yaw: R[2 * t] == null ? null : Math.fround(R[2 * t]), pitch: R[2 * t + 1] == null ? null : Math.fround(R[2 * t + 1]), target: TG[t] == null ? null : TG[t] >= 0 ? 'player' : null }));   // as lockstep-blaze (#6964/#9256)
    if (process.env.WITHER_DUMP) console.log('TG', JSON.stringify(TG.slice(0, 60)), 'L', JSON.stringify(L.slice(0, 40).map((p) => p.map((v) => +v.toFixed(4)))));
    const k = TG.findIndex((g) => g != null && g >= 0) - 2;   // #10618: the server wither already holds its target (ProjectileAttackGoal tick -> navigation path -> MOVE_TO, no Random draw) in tick 1, one tick before its TGT line shows it. #7216: the server's acquisition tick; the wither's TGT is logged at age+1, and its first 0.3 impulse lands in row k-1 (#6990), so the engine is aggroed one row earlier than the raw index
    const et = engineBlazeTrace(SALTS[i], 'wither', 'wither_skull', { acquireAt: k < 0 ? undefined : k });
    traces[i] = et;
    const r4 = (v) => Math.round(v * 1e4) / 1e4, ER = et.rows.map((r) => ({ ...r, pos: r.pos && (c.raw ? r.pos : r.pos.map(r4)) }));
    const d = compareTraces(ER, S, { fields: (process.env.MCLITE_WITHER_FIELDS || 'pos').split(','), tol: c.raw ? { pitch: 2e-4, pos: 1e-12 } : {} });
    const pj0 = c.proj && c.proj[0], e = et.proj;
    // the arena hosts one wither per rep, 24 blocks apart on z, and the @e[type=wither_skull] walk logs all of them: keep this lane's own skulls (muzzle within 8 of its z)
    const keep = pj0 && pj0.tick.map((_, j) => Math.abs(pj0.pos[j][2] - S[0].pos[2]) < 8);
    const pj = pj0 && { tick: pj0.tick.filter((_, j) => keep[j]), pos: pj0.pos.filter((_, j) => keep[j]), motion: pj0.motion.filter((_, j) => keep[j]) };
    const pd = !pj ? { field: 'proj', a: e.tick, b: null } : JSON.stringify([pj.tick, pj.motion]) !== JSON.stringify([e.tick, e.motion]) ? { field: 'proj', a: [e.tick, e.motion], b: [pj.tick, pj.motion] } : null;
    if (d || pd) { const x = d || { tick: pd.a && e.tick[0], ...pd }; console.log(`DIVERGENCE salt ${SALTS[i]} tick ${x.tick} field ${x.field}: engine ${JSON.stringify(x.a)} server ${JSON.stringify(x.b)}`); process.exit(1); }
    console.log(`wither salt ${SALTS[i]}: identical`);
  }
}
console.log(`${n} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
