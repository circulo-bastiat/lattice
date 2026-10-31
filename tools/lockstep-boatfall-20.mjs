#!/usr/bin/env node
// #9443 (G17-L72a-3): a boat with a pig passenger slides off a 5-high ledge (Motion 3.0 +x) onto stone (lane boatfallland) or into 2-deep water
// (lane boatfallwater). Rules from .decomp BoatEntity.fall (:786): fallDistance accrues only while the block below is not water; past 3 on the
// ground it breaks the boat ONLY if the tick-start location (checkLocation, :269) is ON_LAND - a boat landing from the air is IN_AIR, so it lands
// unharmed (fallDistance back to 0, boat kept, passenger kept, pig Health 10). Into water the accrual freezes at the water surface and the boat
// re-enters as IN_WATER and floats. Engine trace x 20 salts: pos/vel/hp/link/fallDistance/location per tick. Server side: node tools/referee/lockstep/pilot.mjs
// --lanes boatfallland,boatfallwater --seeds 20 (MCLITE_PILOT_REMOTE=mirror); the pilot proves the real server repeats itself per salt (rep a == rep b).
import { engineZombieTrace, harnessM } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { LEDGE_X } from './referee/chasescen.mjs';
const DROP = 5, T = 100;
let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) { breaks++; console.log('✓ break caught: ' + m); } else { bad++; console.log('NOT CAUGHT ' + m); } };
const F = ['pos', 'vel', 'hp', 'link', 'fd', 'loc'];
const run = (salt, water, patch) => {
  let pig = null;
  return engineZombieTrace(salt, {
    mob: 'boat', up: DROP, T,
    build: ({ w, M }) => {
      const st = M.States.stateOf('stone'), wa = M.States.stateOf('water');
      for (let x = -4; x < LEDGE_X; x++) for (let z = -1; z <= 1; z++) for (let y = 0; y < DROP; y++) w.set(x, y, z, st);
      for (let x = -4; x < LEDGE_X; x++) for (const z of [-2, 2]) for (let y = 2; y <= DROP + 1; y++) w.set(x, y, z, st);
      for (let z = -1; z <= 1; z++) for (let y = DROP; y <= DROP + 1; y++) w.set(-4, y, z, st);
      if (water) for (let x = LEDGE_X; x <= 25; x++) for (let z = -1; z <= 1; z++) for (let y = 0; y <= 1; y++) w.set(x, y, z, wa);
    },
    onStart: (EL) => { const b = EL.list[0]; b.vx = 3.0; pig = EL.spawn('pig', b.x, b.y, b.z); pig.persistent = true; pig.aiDisabled = true; ok(harnessM().Boat.interact(b, pig), 'pig boards'); if (patch) patch(b); },
    extra: (EL, b) => ({ hp: pig.health, link: [b.passengers.length, pig.vehicle === b ? 1 : 0, b.removed ? 1 : 0], fd: +(b.fallDistance || 0).toFixed(6), loc: String(b.location) }),
  });
};
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const land = SALTS.map((s) => run(s, false)), wat = SALTS.map((s) => run(s, true));
for (const [name, set] of [['land', land], ['water', wat]]) {
  set.forEach((R, i) => ok(R.length === T && R.every((r) => r.hp === 10 && r.link[0] === 1 && r.link[1] === 1 && r.link[2] === 0), `${name} salt ${i}: boat and rider unharmed, still linked`));
  ok(compareTraces(set[0], set === land ? run(0, false) : run(0, true), { fields: F }) === null, `${name}: same salt, same trace`);
  ok(set.every((R) => compareTraces(set[0], R, { fields: F }) === null), `${name}: the 20 salts agree (no randomness on this path)`);
}
const fdMax = (R) => Math.max(...R.map((r) => r.fd));
ok(fdMax(land[0]) > 3, 'land: the fall passes 3 blocks (fd ' + fdMax(land[0]) + ')');
ok(land[0].some((r) => r.loc === 'in_air') && land[0][T - 1].loc === 'on_land' && land[0][T - 1].fd === 0, 'land: lands IN_AIR (no break), fd reset, ends ON_LAND');
ok(fdMax(wat[0]) <= 3 && wat[0].some((r) => r.loc === 'in_water') && wat[0][T - 1].fd === 0, 'water: accrual stops at the surface, boat re-enters IN_WATER, fd 0');
ok(Math.abs(land[0][T - 1].pos[1]) < 1e-4 && wat[0][T - 1].pos[1] > 1.4, 'land rests on the floor, water boat floats ');
const mut = (R, f, fn, at = 12) => R.map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(land[0], mut(land[0], 'hp', (h) => h - 1), { fields: F })?.field === 'hp', 'pig fall damage');
caught(compareTraces(land[0], mut(land[0], 'link', (l) => [0, 0, 1]), { fields: F })?.field === 'link', 'dismount / boat broke');
caught(compareTraces(wat[0], mut(wat[0], 'loc', () => 'in_air', 30), { fields: F })?.field === 'loc', 'water re-entry state');
caught(compareTraces(land[0], run(0, false, (b) => { b.vx = 2.0; }), { fields: F }) !== null, 'a slower slide changes the trace');
caught(compareTraces(land[0], wat[0], { fields: F }) !== null, 'water vs land differ');
console.log(`boatfall (${SALTS.length} salts x 2 lanes x ${T} ticks): ${n} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
