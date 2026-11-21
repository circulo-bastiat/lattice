#!/usr/bin/env node
// lockstep_experience_orb -- #8286 (G17-L4): engine side of `pilot.mjs --seeds 20 --lanes experience_orb` (experience_orblane.mjs; server comparison runs in the full suite). Faults injected: wrong attribute (pos/vel), off-by-one removal tick, row shift; each must be reported at the injected tick and field.
import { engineExperienceOrbTrace, EXPERIENCE_ORB_FIELDS } from './referee/lockstep/experience_orblane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => engineExperienceOrbTrace(s));
traces.forEach((R, i) => {
  ok(R.rows.length === T, `salt ${i}: ${R.rows.length} rows`);
  ok(R.rows.every((r, t) => r.tick === t && r.pos.every(Number.isFinite) && r.vel.every(Number.isFinite)), `salt ${i}: row fields`);
  ok(R.rows[T - 1].pos[1] < R.rows[0].pos[1], `salt ${i}: orb never fell`);
});
const again = engineExperienceOrbTrace(0);
ok(compareTraces(traces[0].rows, again.rows, { fields: EXPERIENCE_ORB_FIELDS }) === null, 'same salt, same trace');
ok(compareTraces(traces[0].rows, traces[1].rows, { fields: EXPERIENCE_ORB_FIELDS }) !== null, 'salts differ (start pos)');
const base = traces[0].rows, F = EXPERIENCE_ORB_FIELDS;
const mut = (f, fn, at) => base.map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
const at = (m, tick, field, name) => { const r = compareTraces(base, m, { fields: F }); caught(r?.tick === tick && r?.field === field, `${name}: got ${JSON.stringify(r && { tick: r.tick, field: r.field })}`); };
at(mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]], 5), 5, 'pos', 'wrong attribute (pos)');
at(mut('vel', (v) => [v[0], v[1] * 1.01 + 1e-6, v[2]], 8), 8, 'vel', 'wrong attribute (vel)');
at(mut('gone', (g) => g + 1, 100), 100, 'gone', 'removal tick off by one');
at(mut('pos', (p) => [p[0], p[1], p[2] + 1e-6], 30), 30, 'pos', 'start offset (dz)');
caught(compareTraces(base, base.slice(1), { fields: F }) !== null, 'row shift');
console.log(`experience_orb: ${SALTS.length}/${SALTS.length} seeds, ${bad} divergences, ${breaks} breaks caught (engine lane; server pilot in full suite)`);
process.exit(bad ? 1 : 0);
