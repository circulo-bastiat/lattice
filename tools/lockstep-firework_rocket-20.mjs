#!/usr/bin/env node
// lockstep_firework_rocket -- #8281 (G17-L4): engine side of `pilot.mjs --seeds 20 --lanes firework_rocket` (firework_rocketlane.mjs; server comparison runs in the full suite). Faults injected: wrong attribute (pos/vel), off-by-one impact tick, RNG consumption order (salt-dependent aim); each must be reported at the injected tick and field.
import { engineFireworkRocketTrace, FIREWORK_ROCKET_FIELDS } from './referee/lockstep/firework_rocketlane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => engineFireworkRocketTrace(s));
traces.forEach((R, i) => {
  ok(R.rows.length === T, `salt ${i}: ${R.rows.length} rows`);
  ok(R.rows.every((r, t) => r.tick === t && r.pos.every(Number.isFinite)), `salt ${i}: row fields`);
  ok(R.impact > 0, `salt ${i}: rocket never removed`);
});
const again = engineFireworkRocketTrace(0);
ok(compareTraces(traces[0].rows, again.rows, { fields: FIREWORK_ROCKET_FIELDS }) === null, 'same salt, same trace');
const base = traces[0].rows, F = FIREWORK_ROCKET_FIELDS;
const mut = (f, fn, at) => base.map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
const at = (m, tick, field, name) => { const r = compareTraces(base, m, { fields: F }); caught(r?.tick === tick && r?.field === field, `${name}: got ${JSON.stringify(r && { tick: r.tick, field: r.field })}`); };
at(mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]], 5), 5, 'pos', 'wrong attribute (pos)');
at(mut('vel', (v) => [v[0], v[1] * 1.01, v[2]], 8), 8, 'vel', 'wrong attribute (speed)');
at(mut('impact', (i) => i + 1, 100), 100, 'impact', 'impact tick off by one');
at(mut('effect', (e) => e + 1, 120), 120, 'effect', 'orb value total');
at(mut('pos', (p) => [p[0], p[1], p[2] + 1e-6], 30), 30, 'pos', 'RNG order (aim dz)');
caught(compareTraces(base, base.slice(1), { fields: F }) !== null, 'row shift');
console.log(`firework_rocket: ${SALTS.length}/${SALTS.length} seeds, ${bad} divergences, ${breaks} breaks caught (engine lane; server pilot in full suite)`);
process.exit(bad ? 1 : 0);
