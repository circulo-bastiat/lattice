#!/usr/bin/env node
// lockstep_waterentities -- #9264 (G17-L69a-2): engine side of the waterentities lane (real-server side: lanes.d/waterentities.json, pilot on the mirror). A zombie
// submerged in a 2-deep pool converts to a drowned: 600 submerged ticks + 300 countdown (+3, the golden's conversion tick is 903). Faults: the engine rule broken
// (no water descent in the path nodes -> the zombie floats, never submerged; no conversion), entity list off by a tick, wrong kind, row shift.
import { engineWaterTrace, convTick, WATER_FIELDS as F, WATER_TICKS } from './referee/lockstep/waterentitieslane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { harnessM } from './referee/lockstep/zombielane.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => engineWaterTrace(s));
traces.forEach((R, i) => {
  ok(R.length === WATER_TICKS && R.every((r, t) => r.tick === t && r.pos && Array.isArray(r.entities)), `salt ${SALTS[i]}: rows`);
  ok(R[0].entities.length === 1 && R[0].entities[0][0] === 'zombie', `salt ${SALTS[i]}: starts as one zombie`);
  const c = convTick(R);
  ok(c >= 890 && c <= 920, `salt ${SALTS[i]}: converted at ${c}`);
  ok(R[c].entities.length === 1 && R[c - 1].entities[0][0] === 'zombie', `salt ${SALTS[i]}: one entity swapped`);
});
ok(compareTraces(traces[0], engineWaterTrace(0), { fields: F }) === null, 'same salt, same trace');
const mut = (f, fn, at) => traces[0].map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
const at = (m, tick, field, name) => { const r = compareTraces(traces[0], m, { fields: F }); caught(r?.tick === tick && r?.field === field, `${name}: got ${JSON.stringify(r && { tick: r.tick, field: r.field })}`); };
at(mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]], 300), 300, 'pos', 'wrong attribute (pos)');
at(mut('entities', (e) => e.map((x) => ['zombie', ...x.slice(1)]), convTick(traces[0]) + 5), convTick(traces[0]) + 5, 'entities', 'wrong kind after conversion');
at(mut('entities', () => traces[0][convTick(traces[0]) - 1].entities, convTick(traces[0])), convTick(traces[0]), 'entities', 'conversion tick late');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
// the engine rule itself: without the non-swimmer's descent to the water bottom the zombie floats at the surface, is never submerged, and never converts
{
  const Ai = harnessM().Ai;
  Ai.__testNoWaterDescent = true;
  const broken = engineWaterTrace(0);
  Ai.__testNoWaterDescent = false;
  caught(convTick(broken) === -1 && compareTraces(traces[0], broken, { fields: F }) !== null, `engine rule broken (no water descent): converted at ${convTick(broken)}`);
}
console.log(`waterentities: ${SALTS.length} seeds, ${bad} divergences, ${breaks} breaks caught (engine lane; real-server lane in pilot --lanes waterentities)`);
process.exit(bad || breaks < 5 ? 1 : 0);
