#!/usr/bin/env node
// cartkindscheck.mjs -- #314 (#314): the furnace / TNT carts end to end on rails (src/07zzr_minecart.js ports
// FurnaceMinecartEntity / TntMinecartEntity): a fuelled furnace cart drags a train and coasts to a stop when the fuel
// runs out; a TNT cart primes on a POWERED activator rail (not an unpowered one) and its blast power grows with speed.
// Spawner and command-block carts: see spawnercartcheck / cartcommandcheck.
import { loadEngine } from './loadsrc.mjs';
console.log('cartkindscheck -- #314 (#314), furnace train + TNT cart on activator rail');

function scenarios(patch) {
  const f = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) f.push(m); };
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07f_redstone.js', '07zzq_rail.js', '07zzr_minecart.js'], dom: false, patch });
  const R = M.Reg, B = M.Behave, Mc = M.Minecart;
  const N = 40, MID = 20, cells = new Uint16Array(N * N * N);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const world = { getBlock: (x, y, z) => cells[idx(x, y, z)], setBlock(x, y, z, id) { const o = cells[idx(x, y, z)]; cells[idx(x, y, z)] = id; B.changed(x, y, z, o); return true; }, blockLightAt: () => 15 };
  B.init(world); M.Redstone.init(); Mc.world = world;
  const def = (nm) => R.realFirst[R.id[nm]] + R.defaultState[R.id[nm]];
  const rail = (nm, props) => { let st = B.setProp(def(nm), 'shape', 'east_west'); for (const k in props || {}) st = B.setProp(st, k, props[k]); return st; };
  Mc.mover = (e, dx, dy, dz) => { e.x += dx; e.y += dy; e.z += dz; };
  const explosions = [];
  M.EntityList = { list: [], remove(e) { e.removed = true; }, random: () => 0.5, dropStack() { return {}; } };
  M.Explosion = { ready: true, explode(src, x, y, z, power) { explosions.push(power); } };
  const mk = (type, x, vx) => { const e = { id: 1, type, x, y: 0, z: 0.5, px: x, py: 0, pz: 0.5, vx, vy: 0, vz: 0, yaw: 0, width: 0.98, height: 0.7, age: 0, removed: false, fallDistance: 0, noGravity: true }; Mc.init(e, {}); e.noGravity = true; return e; };
  const tick = (e) => { e.px = e.x; e.pz = e.z; Mc.tick(e); };
  const lay = (nm, props) => { for (let x = -18; x <= 18; x++) cells[idx(x, 0, 0)] = rail(nm, props); };

  // furnace train: furnace pushes east, a plain cart ahead is shoved along; when the fuel is gone the train coasts to a halt
  lay('rail');
  const fu = mk('furnace_minecart', 0.5, 0), tr = mk('minecart', 2.0, 0);
  fu.fuel = 120; fu.pushX = 1; fu.cartLit = true;
  M.EntityList.list = [fu, tr];
  const steps = () => { tick(fu); tick(tr); };
  for (let t = 0; t < 60; t++) steps();
  ok(fu.x > 3 && fu.vx > 0.1, 'fuelled furnace cart drives off by itself (x=' + fu.x.toFixed(2) + ')');
  ok(tr.x > 2.5, 'the furnace cart pushes the train (cart ahead moved to x=' + tr.x.toFixed(2) + ')');
  for (let t = 0; t < 200; t++) steps();
  ok(fu.fuel === 0 && fu.cartLit === false && fu.pushX === 0, 'fuel ran out: unlit, push cleared');
  ok(Math.abs(fu.vx) < 0.005, 'and the furnace cart has coasted to a stop (vx=' + fu.vx.toFixed(4) + ')');
  const xs = fu.x; for (let t = 0; t < 40; t++) steps();
  ok(Math.abs(fu.x - xs) < 0.05, 'it stays stopped without fuel');

  // TNT cart on an activator rail
  lay('activator_rail', { powered: 'false' });
  const t1 = mk('tnt_minecart', 0.5, 0.2);
  for (let t = 0; t < 5; t++) tick(t1);
  ok(t1.cartFuse === -1, 'unpowered activator rail does not prime');
  lay('activator_rail', { powered: 'true' });
  const t2 = mk('tnt_minecart', 0.5, 0.2);
  tick(t2);
  ok(t2.cartFuse >= 79 && t2.cartFuse <= 80, 'powered activator rail primes (fuse 80, '+t2.cartFuse+')');
  for (let t = 0; t < 81; t++) tick(t2);
  ok(t2.removed && explosions.length === 1, 'fuse runs out -> one explosion');

  // power grows with speed
  const pw = (s2) => { explosions.length = 0; Mc.explode(mk('tnt_minecart', 0.5, 0), s2); return explosions[0]; };
  const p0 = pw(0), p1 = pw(1), p4 = pw(16), p9 = pw(400);
  ok(p0 === 4, 'standing cart: power 4');
  ok(p1 > p0 && p4 > p1, 'power grows with speed (' + [p0, p1, p4] + ')');
  ok(p9 <= 4 + 1.5 * 5 + 1e-6 && p9 > p4, 'and is capped at |v|=5 (' + p9 + ')');
  return { f, n };
}
const real = scenarios();
const fails = real.f.slice(); let breaks = 0;
const brk = (name, from, to) => {
  const r = scenarios((file, src) => { if (file !== '07zzr_minecart.js') return src; if (!src.includes(from)) throw new Error('break target missing: ' + name); return src.replace(from, to); });
  if (r.f.length) { breaks++; console.log('   ✓ break caught: ' + name); } else fails.push('anti-vacuity: ' + name + ' went unnoticed');
};
brk('infinite fuel', 'if (e.fuel > 0) e.fuel--;', '');
brk('constant explosion power', 'var power = Math.fround(4.0 + rnd()() * 1.5 * s);', 'var power = 4;');
brk('TNT never primes on activator', 'if (powered && e.cartFuse < 0) Mc.prime(e);', '');
brk('TNT primes unpowered', 'if (powered && e.cartFuse < 0) Mc.prime(e);', 'if (e.cartFuse < 0) Mc.prime(e);');
brk('no furnace push', 'var nx = e.vx * 0.8 + e.pushX, nz = e.vz * 0.8 + e.pushZ;', 'var nx = e.vx * 0.8, nz = e.vz * 0.8;');
if (fails.length) { console.log('FAIL'); fails.forEach((x) => console.log('  ' + x)); process.exit(1); }
console.log(`cartkindscheck: ${real.n} assertions, 0 failures, ${breaks} breaks caught`);
