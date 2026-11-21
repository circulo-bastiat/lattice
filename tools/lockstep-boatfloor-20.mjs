#!/usr/bin/env node
// #9442 (G17-L72a-2): the boat lane over packed ice, blue ice and plain stone (ground friction / slip), shoved at 0.1 b/t at the summon.
// Engine trace x 20 salts: pos/vel/yaw/pitch per tick. Server side: node tools/referee/lockstep/pilot.mjs --lanes boatice,boatblueice,boatland --see
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { readFileSync } from 'node:fs';
import { T } from './referee/chasescen.mjs';
const PAD = 0;
const PHYS = JSON.parse(readFileSync(new URL('../assets/block-physics.json', import.meta.url), 'utf8'));   // the harness registry has no friction table until buildPhysics
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const F = ['pos', 'vel', 'yaw', 'pitch'];
const run = (floor, salt) => engineZombieTrace(salt, {
  mob: 'boat',
  build: ({ w, M }) => { M.Reg.buildPhysics({ defaults: PHYS.defaults, exceptions: PHYS.exceptions }); if (floor !== 'stone') { const s = M.States.stateOf(floor); for (let x = -3; x <= 25; x++) for (let z = -1; z <= 1; z++) w.set(x, PAD - 1, z, s); } },
  onStart: (EL) => { EL.list[0].vx = 0.1; },
});
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const by = {};
for (const f of ['packed_ice', 'blue_ice', 'stone']) {
  by[f] = SALTS.map((s) => run(f, s));
  by[f].forEach((R, i) => ok(R.length === T, `${f} salt ${i}: ${R.length} rows`));
  ok(compareTraces(by[f][0], run(f, 0), { fields: F }) === null, `${f}: same salt, same trace`);
}
const dx = (f) => by[f][0][T - 1].pos[0] - by[f][0][0].pos[0];
ok(dx('stone') > 0, 'the boat moves on stone');
ok(dx('packed_ice') > dx('stone') && dx('blue_ice') > dx('packed_ice'), `slip order: stone ${dx('stone')} < packed ${dx('packed_ice')} < blue ${dx('blue_ice')}`);
const base = by.blue_ice[0], mut = (f, fn, at = 20) => base.map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(base, mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]]), { fields: F })?.tick === 20, 'pos 1e-9');
caught(compareTraces(base, mut('vel', (v) => [v[0] + 1e-6, v[1], v[2]]), { fields: F })?.field === 'vel', 'vel');
caught(compareTraces(base, by.packed_ice[0], { fields: F }) !== null, 'blue vs packed friction differ');
caught(compareTraces(by.stone[0], by.blue_ice[0], { fields: F }) !== null, 'stone vs ice friction differ');
caught(compareTraces(base, base.slice(1), { fields: F }) !== null, 'row shift');
console.log(`${breaks} breaks caught; boatfloor: 3 floors x ${SALTS.length} salts x ${T} ticks, ${bad} failures`);
process.exit(bad ? 1 : 0);
