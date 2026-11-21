#!/usr/bin/env node
// lockstep_lightning_bolt -- #8287 (G17-L4): engine side of `pilot.mjs --seeds 20 --lanes lightning_bolt` (lightning_boltlane.mjs; server comparison runs in the full suite). Faults injected: wrong attribute (pos/vel), off-by-one removal tick, RNG consumption order (salt-dependent aim); each must be reported at the injected tick and field.
import { engineLightningBoltTrace, LIGHTNING_BOLT_FIELDS } from './referee/lockstep/lightning_boltlane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => engineLightningBoltTrace(s));
traces.forEach((R, i) => {
  ok(R.rows.length === T, `salt ${i}: ${R.rows.length} rows`);
  ok(R.rows.every((r, t) => r.tick === t && r.pos.every(Number.isFinite)), `salt ${i}: row fields`);
  ok(R.removal > 0, `salt ${i}: lightning_bolt never removed`);
});
const again = engineLightningBoltTrace(0);
ok(compareTraces(traces[0].rows, again.rows, { fields: LIGHTNING_BOLT_FIELDS }) === null, 'same salt, same trace');
const base = traces[0].rows, F = LIGHTNING_BOLT_FIELDS;
const mut = (f, fn, at) => base.map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
const at = (m, tick, field, name) => { const r = compareTraces(base, m, { fields: F }); caught(r?.tick === tick && r?.field === field, `${name}: got ${JSON.stringify(r && { tick: r.tick, field: r.field })}`); };
at(mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]], 5), 5, 'pos', 'wrong attribute (pos)');
at(mut('vel', (v) => [v[0], v[1] * 1.01 - 1e-3, v[2]], 2), 2, 'vel', 'wrong attribute (speed)');
at(mut('removal', (i) => i + 1, 100), 100, 'removal', 'removal tick off by one');
at(mut('effect', (e) => e + 1, 120), 120, 'effect', 'fire count');
at(mut('pos', (p) => [p[0], p[1], p[2] + 1e-6], 30), 30, 'pos', 'RNG order (aim dz)');
caught(compareTraces(base, base.slice(1), { fields: F }) !== null, 'row shift');
console.log(`lightning_bolt: ${SALTS.length}/${SALTS.length} seeds, ${bad} divergences, ${breaks} breaks caught (engine lane; server pilot in full suite)`);
process.exit(bad ? 1 : 0);
