#!/usr/bin/env node
// #9441 (G17-L72a-1): boat on open water carrying a pig (the one passenger the real 1.18.2 server simulates: a Player rider is
// not, see docs/decisions/9441-boat-player-rider-no-server-truth.md). Engine trace x 20 salts: pos/vel/yaw/pitch plus the
// vehicle/passenger links per tick (the boat sinks to the floor; the pig's eyes go under water and LivingEntity.baseTick stops its ride at once: !vehicle.canBeRiddenInWater()). Server side: node tools/referee/lockstep/pilot.mjs --lanes boatpax --seeds 20 (MCLITE_PILOT_REMOTE=mirror).
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const F = ['pos', 'vel', 'yaw', 'pitch', 'link'];
const run = (salt) => {
  let pig = null;
  return engineZombieTrace(salt, {
    mob: 'boat', pool: true, up: 0.5,
    onStart: (EL) => { const b = EL.list[0]; pig = EL.spawn('pig', b.x, b.y, b.z); pig.persistent = true; pig.aiDisabled = true; ok(NS_Boat().interact(b, pig), 'pig boards'); },
    extra: (EL, b) => ({ link: [b.passengers.length, pig && pig.vehicle === b ? 1 : 0, b.passengers.length ? +b.passengers[0].y.toFixed(6) - +b.y.toFixed(6) : null] }),
  });
};
let NSB = null; const NS_Boat = () => NSB;
import { harnessM } from './referee/lockstep/zombielane.mjs';
NSB = harnessM().Boat;
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map(run);
traces.forEach((R, i) => ok(R.length === T && R[0].link[0] === 1 && R[0].link[1] === 1 && R.slice(2).every((r) => r.link[0] === 0 && r.link[1] === 0), `salt ${i}: rows/links`));
ok(traces[0].some((r) => r.pos[1] !== traces[0][0].pos[1] || r.vel[1] !== 0), 'the boat moves vertically (it sinks in 2-deep water, as on the server)');
ok(compareTraces(traces[0], run(0), { fields: F }) === null, 'same salt, same trace');
const mut = (f, fn, at = 30) => traces[0].map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0], mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]]), { fields: F })?.tick === 30, 'pos 1e-9');
caught(compareTraces(traces[0], mut('link', (l) => [1, 1, l[2]], 30), { fields: F })?.field === 'link', 'passenger dropped');
caught(compareTraces(traces[0], mut('vel', (v) => [v[0], v[1] + 1e-6, v[2]]), { fields: F })?.field === 'vel', 'vel');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
console.log(`${breaks} breaks caught; boatpax: ${SALTS.length} salts x ${T} ticks, ${SALTS.length + 7} assertions, ${bad} failures`);
process.exit(bad ? 1 : 0);
