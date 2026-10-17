#!/usr/bin/env node
// lockstep-wither_skull -- #5383 (G17-L4): wither_skull lane, 20 salts. Engine trace (lockstep/skulllane.mjs: pos, vel, impact tick, effect)
// must be deterministic per salt, the skull must hit the wall and explode, and compareTraces (NO tolerance) must report an injected 1e-9
// drift in one field of one salt (anti-vacuity, D-30). First divergence: exit 1 with tick+field+both values. The real-server half
// (a chasescen/runchase wither_skull summon lane) is not built yet: owed, see the issue.
import { engineSkullTrace, SKULL_FIELDS } from './referee/lockstep/skulllane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = process.env.MCLITE_LOCKSTEP_SALTS ? process.env.MCLITE_LOCKSTEP_SALTS.split(',').map(Number) : Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => engineSkullTrace(s));
traces.forEach((tr, i) => {
  const s = SALTS[i], again = engineSkullTrace(s);
  ok(tr.rows.length === T && tr.rows.every((r, t) => r.tick === t && r.pos.every(Number.isFinite)), `salt ${s}: rows`);
  ok(tr.impact > 0, `salt ${s}: skull never impacts`);
  ok(tr.explodes > 0, `salt ${s}: no explosion effect`);
  const d = compareTraces(tr.rows, again.rows, { fields: SKULL_FIELDS });
  ok(d === null, `salt ${s}: not deterministic ${d && JSON.stringify(d)}`);
});
const t0 = traces[0].rows, mut = (f, fn) => t0.map((r, t) => (t === 5 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(t0, mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]]), { fields: SKULL_FIELDS })?.tick === 5, 'pos 1e-9');
caught(compareTraces(t0, mut('vel', (v) => [v[0], v[1] + 1e-9, v[2]]), { fields: SKULL_FIELDS })?.field === 'vel', 'vel 1e-9');
caught(compareTraces(t0, t0.map((r) => ({ ...r, impact: r.impact + 1 })), { fields: SKULL_FIELDS })?.field === 'impact', 'impact tick');
caught(compareTraces(t0, t0.map((r) => ({ ...r, effect: r.effect + 1e-9 })), { fields: SKULL_FIELDS })?.field === 'effect', 'effect');
console.log(`${n} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
