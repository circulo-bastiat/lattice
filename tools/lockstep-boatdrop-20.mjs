#!/usr/bin/env node
// #6083 (G17-M15): a boat dropped 5 blocks onto stone (fall distance, onGround landing, ground friction), no passenger.
// Engine trace x 20 salts: pos/vel/yaw/pitch per tick. Server side (0 divergences, 20 salts): node tools/referee/lockstep/pilot.mjs --lanes boatdrop --see
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { readFileSync } from 'node:fs';
import { T } from './referee/chasescen.mjs';
const PHYS = JSON.parse(readFileSync(new URL('../assets/block-physics.json', import.meta.url), 'utf8'));
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const F = ['pos', 'vel', 'yaw', 'pitch'];
const run = (salt, up = 5) => engineZombieTrace(salt, {
  mob: 'boat', up,
  build: ({ M }) => { M.Reg.buildPhysics({ defaults: PHYS.defaults, exceptions: PHYS.exceptions }); },
});
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => run(s));
traces.forEach((R, i) => ok(R.length === T, `salt ${i}: ${R.length} rows`));
const R = traces[0];
ok(compareTraces(R, run(0), { fields: F }) === null, 'same salt, same trace');
ok(R[0].pos[1] > R[T - 1].pos[1] + 4, `the boat falls ~5 blocks (${R[0].pos[1]} -> ${R[T - 1].pos[1]})`);
ok(Math.abs(R[T - 1].vel[1]) < 0.2, 'it has landed and rests on the floor');
const mut = (f, fn, at = 20) => R.map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(R, mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]]), { fields: F })?.tick === 20, 'pos 1e-9');
caught(compareTraces(R, mut('vel', (v) => [v[0], v[1] + 1e-6, v[2]]), { fields: F })?.field === 'vel', 'vel');
caught(compareTraces(R, run(0, 3), { fields: F }) !== null, 'drop height differs');
caught(compareTraces(R, R.slice(1), { fields: F }) !== null, 'row shift');
console.log(`${breaks} breaks caught; boatdrop: ${SALTS.length} salts x ${T} ticks, ${SALTS.length + 7} assertions, ${bad} failures`);
process.exit(bad ? 1 : 0);
