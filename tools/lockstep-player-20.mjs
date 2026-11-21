#!/usr/bin/env node
// lockstep_player -- #5523 (G17-L4): engine side of the player lane, 20 seeds (one input script per seed: sprint/jump/sneak edges shifted by the seed). Same seed = same trace; the server comparison is the pilot's job (full suite).
// Faults injected: wrong attribute (food, pos), off-by-one goal tick (onGround edge, row shift), RNG/consumption order (exhaustion); each must be reported at the injected tick and field.
import { enginePlayerTrace, compareInputTraces } from './referee/lockstep/playerinput.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const T = 60, SEEDS = Array.from({ length: 20 }, (_, i) => i);
const scriptOf = (s) => [{ tick: 2 + (s % 5), op: 'input', fwd: 1, sprint: true }, { tick: 20 + (s % 7), op: 'input', fwd: 1, jump: true, sprint: true }, { tick: 30 + (s % 3), op: 'input', fwd: 1, sneak: true }, { tick: 45 + (s % 4), op: 'input' }];
const traces = SEEDS.map((s) => enginePlayerTrace(scriptOf(s), T));
traces.forEach((R, i) => {
  ok(R.length === T, `seed ${i}: ${R.length} rows`);
  ok(R.every((r) => r.pos && r.vel && r.food != null && r.exhaustion >= 0), `seed ${i}: row fields`);
  ok(compareInputTraces(R, enginePlayerTrace(scriptOf(i), T)) === null, `seed ${i}: same seed, same trace`);
});
ok(traces.some((R) => R[T - 1].pos[2] !== traces[0][T - 1].pos[2]), 'seeds differ');
const A = traces[0];
const mut = (f, fn, at) => A.map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
const at = (m, tick, field, name) => { const r = compareInputTraces(A, m); caught(r?.tick === tick && r?.field === field, `${name}: got ${JSON.stringify(r && { tick: r.tick, field: r.field })}`); };
at(mut('food', (f) => f - 1, 33), 33, 'food', 'wrong attribute (food)');
at(mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]], 40), 40, 'pos', 'wrong attribute (pos)');
at(mut('onGround', (g) => !g, 25), 25, 'onGround', 'goal tick off by one (onGround)');
at(mut('exhaustion', (e) => e + 0.001, 50), 50, 'exhaustion', 'consumption order (exhaustion)');
caught(compareInputTraces(A, A.slice(1)) !== null, 'row shift');
console.log(`player: ${SEEDS.length}/${SEEDS.length} seeds, ${bad} divergences, ${breaks} breaks caught (engine lane; server pilot in full suite)`);
process.exit(bad ? 1 : 0);
