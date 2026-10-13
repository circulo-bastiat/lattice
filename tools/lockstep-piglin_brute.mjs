#!/usr/bin/env node
// lockstep-piglin_brute -- #6976: the engine piglin_brute chase lane against the real-server facts (salt 0): the brute stands still
// through tick 10 (brain sensors' first scan), first moves on tick 11, closes on the player, stops (RangedApproachTask forgets the
// WalkTarget in melee range) and does not retreat. Owed: terminal speed (server ~0.264/tick, engine 0.2698) and stop x 21.8081.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const R = engineZombieTrace(0, { mob: 'piglin_brute' });
ok(R.slice(0, 11).every((r) => r.pos[0] === 11.5), 'brute moved before tick 11');
ok(R[11].pos[0] > 11.5, 'brute did not move on tick 11');
ok(R[159].pos[0] > 20 && R[159].pos[0] < 22.5, 'brute final x ' + R[159].pos[0]);
ok(R[159].pos[0] >= R[100].pos[0] - 1e-6, 'brute retreated after closing');
const F = ['pos'];
const mut = R.map((r, t) => (t === 11 ? { ...r, pos: [11.5, r.pos[1], r.pos[2]] } : r));
caught(compareTraces(R, mut, { fields: F })?.tick === 11, 'tick-11 move tampered');
caught(compareTraces(R, R.slice(1), { fields: F }) !== null, 'row shift');
console.log(`6 assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
