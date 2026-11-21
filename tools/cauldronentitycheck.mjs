#!/usr/bin/env node
// cauldronentitycheck.mjs — G17-K3: cauldron entityInside (Use.entityCollide).
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('cauldronentitycheck — water cauldron extinguishes, lava cauldron ignites');
const E = loadEngine({ extra: ['07_world.js', '07b_behaviour.js', '14b_physics.js', '14j_combat.js', '14l_use.js'], dom: false });
const S = E.States, U = E.Use, Cb = E.Combat;
const cells = new Map(), k = (x, y, z) => x + ',' + y + ',' + z;
const W = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(k(x, y, z), s); return true; } };
E.World = W; E.Behave.init(W); U.init(W);
const hurts = [];
Cb.hurt = (e, n, a, b, o) => { hurts.push([n, o && o.source]); return true; };
const mk = (y, burning) => { const e = { type: 'zombie', x: 0.5, y, z: 0.5, width: 0.6, height: 1.95, vx: 0, vy: 0, vz: 0 }; if (burning) Cb.igniteForSeconds(e, 8); return e; };
const water = (lv) => S.withLocal('water_cauldron', lv - 1) , lvOf = (st) => S.propValue ? 0 : 0;
cells.set(k(0, 10, 0), S.stateOf('water_cauldron'));
const start = cells.get(k(0, 10, 0));
let e = mk(10, true);
ok(e.isOnFire, 'precondition: burning');
U.entityCollide(e);
ok(!e.isOnFire && !(e.remainingFireTicks > 0), 'burning zombie in water cauldron is extinguished');
ok(cells.get(k(0, 10, 0)) !== start, 'cauldron level dropped');
cells.set(k(0, 10, 0), start);
e = mk(11, true); U.entityCollide(e);
ok(e.isOnFire && cells.get(k(0, 10, 0)) === start, 'entity above the cauldron untouched');
cells.set(k(0, 10, 0), S.stateOf('lava_cauldron'));
const pig = mk(10, false); pig.type = 'pig'; U.entityCollide(pig);
ok(pig.isOnFire && pig.remainingFireTicks >= 15 * Cb.FIRE_TICKS_PER_SECOND, 'lava cauldron ignites 15 s');
ok(hurts.length === 1 && hurts[0][0] === 4 && hurts[0][1] === 'lava', 'lava cauldron deals LAVA 4');
// anti-vacuity: with the branch removed (entityCollide no-op) the same scenarios must fail
let breaks = 0;
{
  const real = U.entityCollide; U.entityCollide = () => {};
  cells.set(k(0, 10, 0), start); const z = mk(10, true); U.entityCollide(z);
  if (z.isOnFire && cells.get(k(0, 10, 0)) === start) breaks++;
  cells.set(k(0, 10, 0), S.stateOf('lava_cauldron')); const p2 = mk(10, false); p2.type = 'pig'; U.entityCollide(p2);
  if (!p2.isOnFire) breaks++;
  U.entityCollide = real;
}
ok(breaks === 2, 'both scenarios fail without the branch');
if (fails.length) { console.log(fails.map((f) => 'FAIL ' + f).join('\n')); process.exit(1); }
console.log(pass + ' passed, ' + breaks + ' breaks caught');
