#!/usr/bin/env node
// lockstep-leashknot -- #7059 (G17-L4): leash_knot lane, 20 salts. Engine trace (lockstep/knotlane.mjs: knot present, cow leashed, lead item count/Pos per tick)
// vs the real 1.18.2 server (lockstep/knotrun.mjs: cow with Leash NBT on a fence -> the cow's first tick makes the knot at block+(0.5,0.375,0.5); fence removed;
// the knot is discarded by the 101st-tick poll, the cow drops a lead). compareTraces with NO tolerance. The server half costs ~25 s/salt, so it runs only with
// MCLITE_LOCKSTEP_SERVER=1 (salts from MCLITE_LOCKSTEP_SALTS, default 0..19). Alignment: server summon tick = attach+1, so server row = engine row + 2;
// the fence goes at engine tick brk (after that tick's entity pass) = server row brk+3. Default run: engine side + anti-vacuity (1e-9 drift in one field of one salt).
// First divergence: exit 1 with tick+field+both values.
import { engineKnot, knotParams } from './referee/lockstep/knotlane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';

let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = process.env.MCLITE_LOCKSTEP_SALTS ? process.env.MCLITE_LOCKSTEP_SALTS.split(',').map(Number) : Array.from({ length: 20 }, (_, i) => i);
const FIELDS = ['knot', 'leash', 'drops', 'kpos', 'dpos', 'dcount'];
const traces = SALTS.map((s) => engineKnot(s));
traces.forEach((rows, i) => {
  ok(rows.length === 260, `salt ${SALTS[i]}: rows`);
  ok(rows.some((r) => r.knot === 1 && r.kpos && r.kpos[1] === 0.375), `salt ${SALTS[i]}: knot at y 0.375`);
});
ok(traces.some((rows) => rows.some((r) => r.drops > 0)), 'some salt drops the lead');
ok(compareTraces(traces[0], engineKnot(SALTS[0]), { fields: FIELDS }) === null, 'same salt, same trace');
const mut = (f, fn) => traces[0].map((r, t) => (t === 20 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0], mut('kpos', (p) => [p[0], p[1] + 1e-9, p[2]]), { fields: FIELDS })?.field === 'kpos', 'kpos 1e-9');
caught(compareTraces(traces[0], mut('leash', (v) => 1 - v), { fields: FIELDS })?.field === 'leash', 'leash flag');

if (process.env.MCLITE_LOCKSTEP_SERVER) {
  const { runKnot, parseKnot, KT } = await import('./referee/lockstep/knotrun.mjs');
  for (let i = 0; i < SALTS.length; i++) {
    const p = knotParams(SALTS[i]), g = parseKnot(await runKnot({ attach: p.attach + 1, brk: p.brk + 3 }));
    const itemAt = g.itick.length ? g.itick[g.itick.length - 1] : 0, last = g.itick.length - 1;
    const lo = (q) => (q ? [q[0], q[1] + 59, q[2]] : null);   // server fence block is at y -59, engine's at 0
    const S = traces[i].map((r) => {
      const s = r.tick + 2;
      const drops = itemAt && s >= itemAt ? 1 : 0;
      return { tick: r.tick, knot: g.kn[s - 1] ?? 0, leash: g.cl[s - 1] ?? 0, drops, kpos: g.kn[s - 1] ? lo(g.kpos[0]) : null, dpos: drops ? lo(g.ipos[last]) : null, dcount: drops ? g.icount[last] : null };
    });
    const E = traces[i].map((r) => ({ ...r, drops: Math.min(r.drops, 1), dcount: r.drops ? r.dcount : null }));
    const d = compareTraces(S.filter((r) => r.tick >= p.attach), E.filter((r) => r.tick >= p.attach), { fields: FIELDS });   // before the cow exists on the server there is nothing to compare
    if (d) { console.log(`DIVERGENCE salt ${SALTS[i]} tick ${d.tick} field ${d.field}: server ${JSON.stringify(d.a)} engine ${JSON.stringify(d.b)}`); process.exit(1); }
    console.log(`leashknot salt ${SALTS[i]}: identical`);
  }
}
console.log(`lockstep-leashknot: ${n} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
