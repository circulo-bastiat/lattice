#!/usr/bin/env node
// lockstep_wandering_trader -- #5510 (G17-L4): engine side of `pilot.mjs --seeds 20 --lanes wandering_trader` (server comparison runs in the full suite). Faults injected: wrong attribute (health/pos), off-by-one goal tick (attackTicks, row shift), RNG consumption order (yaw/target); each must be reported at the injected tick and field.
// lockstep-wandering-trader -- #5510 (G17-L4): the wandering_trader lane (chasescen main list, id wandering_trader) on the engine side, 20 salts: 160 rows per salt, every row carries pos/yaw/pitch/target/attackTicks/health,
// same salt = same trace, and compareTraces reports a tampered row. Server rep0 comparison is the pilot's job (#5341); the server is not assumed repeatable per salt (#5095, #5108).
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => engineZombieTrace(s, { mob: 'wandering_trader' }));
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${SALTS[i]}: ${R.length} rows`);
  ok(R.every((r, t) => r.tick === t && r.pos && Number.isFinite(r.yaw) && r.pitch != null && r.health > 0 && r.attackTicks >= 0), `salt ${SALTS[i]}: row fields`);
  ok(R[0].pos[0] === 11.5, `salt ${SALTS[i]}: summon at 11.5, got ${R[0].pos[0]}`);
});
ok(traces.some((R) => R[T - 1].pos[0] > 11.5), 'no salt ever moves the wandering_trader');
const again = engineZombieTrace(SALTS[0], { mob: 'wandering_trader' });
ok(compareTraces(traces[0], again, { fields: ['pos', 'yaw', 'pitch', 'target', 'attackTicks', 'health'] }) === null, 'same salt, same trace');
const F = ['pos', 'yaw', 'pitch', 'rng', 'target', 'attackTicks', 'health'];
const mut = (f, fn, at = 77) => traces[0].map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
const at = (m, tick, field, name) => { const r = compareTraces(traces[0], m, { fields: F }); caught(r?.tick === tick && r?.field === field, `${name}: got ${JSON.stringify(r && { tick: r.tick, field: r.field })}`); };
at(mut('health', (h) => h - 1), 77, 'health', 'wrong attribute (health)');
at(mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]], 40), 40, 'pos', 'wrong attribute (speed, pos)');
at(mut('attackTicks', (a) => a + 1, 90), 90, 'attackTicks', 'goal tick off by one');
at(mut('yaw', (y) => y + 1e-6, 12), 12, 'yaw', 'RNG order (yaw)');
at(mut('rng', (v) => String(BigInt(v) + 1n), 55), 55, 'rng', 'RNG order (rng state)');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
console.log(`wandering_trader: ${SALTS.length}/${SALTS.length} seeds, ${bad} divergences, ${breaks} breaks caught, ${SALTS.length * 6 + 12} assertions, ${bad} failures (engine lane; server pilot in full suite)`);
process.exit(bad ? 1 : 0);
