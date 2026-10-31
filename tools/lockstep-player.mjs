#!/usr/bin/env node
// lockstep-player -- #6988 (G17): the movement-input driver: script validation, server packet split, the headless engine player stepper
// (walk / sprint / jump / sneak, per-tick pos/vel/onGround/food/saturation/exhaustion), and that the comparator catches a tampered row.
import { validateInputs, heldInput, inputPackets, enginePlayerTrace, compareInputTraces } from './referee/lockstep/playerinput.mjs';
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const T = 60;
const script = [{ tick: 2, op: 'input', fwd: 1, sprint: true }, { tick: 20, op: 'input', fwd: 1, jump: true, sprint: true }, { tick: 22, op: 'input', fwd: 1, sneak: true }, { tick: 40, op: 'input' }];
ok(validateInputs(script, T).length === 0, 'good script validates');
caught(validateInputs([{ tick: 99, op: 'input' }, { tick: 1, op: 'input', fwd: 2 }, { tick: 1, op: 'input', sneak: true, sprint: true }], T).length === 3, 'bad inputs rejected');
ok(heldInput(script, 1).fwd === 0 && heldInput(script, 5).sprint && !heldInput(script, 41).fwd, 'held input follows the last step');
const pk = inputPackets(script, T);
ok(pk.length === T && pk[2].some((p) => p.mode === 'start_sprinting') && pk[22].some((p) => p.mode === 'press_shift_key') && pk[40].some((p) => p.mode === 'release_shift_key'), 'packets on edges');
const A = enginePlayerTrace(script, T), B = enginePlayerTrace(script, T);
ok(A.length === T && compareInputTraces(A, B) === null, 'deterministic trace');
ok(A[0].pos[0] === 0.5 && A[0].onGround, 'starts on the floor');
ok(A[8].pos[2] < A[1].pos[2] - 1, 'sprinting moves the player');
ok(A.some((r, t) => t >= 20 && t < 26 && !r.onGround), 'jump leaves the ground');
ok(A[T - 1].exhaustion > 0 || A[T - 1].saturation < 5, `movement costs exhaustion (${A[T - 1].exhaustion}, sat ${A[T - 1].saturation})`);
const mut = (f, fn) => A.map((r, t) => (t === 30 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareInputTraces(A, mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]]))?.tick === 30, 'pos 1e-9');
caught(compareInputTraces(A, mut('exhaustion', (e) => e + 0.001))?.field === 'exhaustion', 'exhaustion');
caught(compareInputTraces(A, mut('onGround', (g) => !g))?.field === 'onGround', 'onGround');
caught(compareInputTraces(A, mut('food', (f) => f - 1))?.field === 'food', 'food');
console.log(`17 assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
