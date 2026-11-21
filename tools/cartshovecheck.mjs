#!/usr/bin/env node
// cartshovecheck.mjs -- #5146 (G17-M4): AbstractMinecartEntity.tick entity scan. A fast RIDEABLE cart pushes
// (pushAwayFrom) players, iron golems and anything when it has a passenger / the entity has a vehicle; it mounts
// only the free pushable mob; a slow cart pushes only other carts.
import { loadEngine } from './loadsrc.mjs';
console.log('cartshovecheck -- #5146 (G17-M4), rideable minecart shoves player/golem/occupied-cart mobs');

function scenarios(patch) {
  const f = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) f.push(m); };
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07f_redstone.js', '07k_goals.js', '07zzq_rail.js', '07zzr_minecart.js'], dom: false, patch });
  const Mc = M.Minecart;
  M.Raid = { startRiding(o, c) { o.vehicle = c; return true; } };
  const cells = new Map();
  Mc.world = { getBlock: () => 0, setBlock: () => true, blockLightAt: () => 15 };
  Mc.mover = (e, dx, dy, dz) => { e.x += dx; e.y += dy; e.z += dz; };
  M.EntityList = { list: [], remove(e) { e.removed = true; }, random: () => 0.5, dropStack() { return {}; } };
  const mk = (type, x, vx) => {
    const e = { id: 1, type, x, y: 100, z: 0.5, px: x, py: 100, pz: 0.5, vx, vy: 0, vz: 0, yaw: 0, width: 0.98, height: 0.7, age: 0, removed: false, fallDistance: 0, noGravity: true };
    Mc.init(e, {}); e.noGravity = true; return e;
  };
  const mob = (type, dx) => ({ id: 2, type, x: 0.5 + dx, y: 100, z: 0.5, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.9, maxHealth: 20, removed: false });
  const run = (cartVx, o, setup) => {
    const c = mk('minecart', 0.5, cartVx); c.cartType = 'RIDEABLE';
    if (setup) setup(c, o);
    M.EntityList.list = [c, o];
    c.px = c.x; Mc.tick(c);
    return c;
  };
  for (const t of ['player', 'iron_golem']) {
    const o = mob(t, 0.3); const c = run(0.2, o);
    ok(!o.vehicle, t + ' is not mounted');
    ok(o.vx > 0, t + ' is pushed away from the cart (vx=' + o.vx + ')');
  }
  { const o = mob('zombie', 0.3); run(0.2, o); ok(o.vehicle, 'free zombie is picked up'); }
  { const o = mob('zombie', 0.3); const c = run(0.2, o, (c) => { const p = { id: 9, vehicle: c }; c.cartPassengers = [p]; });
    ok(!o.vehicle && o.vx > 0, 'occupied cart shoves a second mob instead of mounting'); }
  { const o = mob('zombie', 0.3); o.vehicle = { id: 8 }; run(0.2, o); ok(o.vehicle.id === 8 && o.vx > 0, 'mob with a vehicle is shoved'); }
  { const o = mob('iron_golem', 0.3); run(0.05, o); ok(o.vx === 0, 'slow cart (<0.01) leaves a golem alone'); }
  return { f, n };
}
const real = scenarios();
const fails = real.f; let breaks = 0;
const bf = scenarios((file, src) => file === '07zzr_minecart.js' ? src.replace("NS.Ai.pushAwayFrom(o, e);", "0;") : src);
if (bf.f.length) { breaks++; console.log('   ✓ break caught: pushAwayFrom reverted to continue'); } else fails.push('anti-vacuity: reverting the push went unnoticed');
if (fails.length) { console.log('FAIL'); fails.forEach((x) => console.log('  ' + x)); process.exit(1); }
console.log(`cartshovecheck: ${real.n} assertions, 0 failures, ${breaks} breaks caught`);
