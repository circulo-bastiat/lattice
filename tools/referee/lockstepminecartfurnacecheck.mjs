// lockstep-minecartfurnace -- #6904 (G17-L187): furnace minecart on a long powered east-west rail, 20 salts.
// Reference = an independent restatement of .decomp FurnaceMinecartEntity (tick fuel--/push reset/lit, interact +3600 per coal/charcoal, applySlowdown, moveOnRail tail, large_smoke on nextInt(4)==0)
// and AbstractMinecartEntity.moveOnRail for a flat powered EW rail (maxSpeed 0.2, power boost 0.06). Script: coal, charcoal, stick, a pusher at tick 3 and again at tick 400.
// Per tick compared: fuel, lit, pushX/pushZ, vx, x, smoke tick; the drop on break is furnace + minecart. (A hill is not modelled: flat rail only.)
import { loadEngine } from '../loadsrc.mjs';
const FILES = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '14b_physics.js', '14f_inventory.js', '07f_redstone.js', '07zzq_rail.js', '07zzr_minecart.js'];
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

function lane(salt, patch) {
  const M = loadEngine({ extra: FILES, dom: false, initReg: true, patch });
  const R = M.Reg, B = M.Behave, Mc = M.Minecart;
  B.init({ getBlock: () => 0, setBlock: () => true, blockLightAt: () => 15 });
  const def = (nm) => R.realFirst[R.id[nm]] + R.defaultState[R.id[nm]];
  const rail = B.setProp(B.setProp(def('powered_rail'), 'shape', 'east_west'), 'powered', 'true');
  const stone = def('stone');
  Mc.world = { getBlock: (x, y, z) => (y === 0 ? rail : y === -1 ? stone : 0), setBlock: () => true, blockLightAt: () => 15 };
  Mc.mover = (e, dx, dy, dz) => { e.x += dx; e.y += dy; e.z += dz; };
  const re = stream(salt + 500), rr = stream(salt + 500);
  const drops = [];
  M.World = Mc.world;
  M.EntityList = { list: [], remove(e) { e.removed = true; }, random: re, dropStack(x, y, z, item) { drops.push(item); return {}; } };
  let smokeNow = 0;
  M.Particle = { spawn(n) { if (n === 'large_smoke') smokeNow++; } };
  const x0 = 0.5 + ((salt * 7) % 5), fuel0 = (salt * 131) % 500;
  const e = { id: 1, type: 'furnace_minecart', x: x0, y: 0, z: 0.5, px: x0, py: 0, pz: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, width: 0.98, height: 0.7, age: 0, removed: false, fallDistance: 0, noGravity: true };
  Mc.init(e, { fuel: fuel0 }); e.noGravity = true;
  // reference state
  let fuel = fuel0, pX = 0, pZ = 0, x = x0, vx = 0, vz = 0;
  const push = (px) => { if (fuel > 0) { pX = x - px; pZ = 0; } };
  const give = (item) => { if ((item === 'coal' || item === 'charcoal') && fuel + 3600 <= 32000) fuel += 3600; };
  const script = { 0: ['coal', -1.5], 1: ['charcoal', -1.5], 2: ['stick', -1.5], 3: [null, -1.2], 400: [null, -0.9] };
  const total = fuel0 + 7200 + 150;
  for (let t = 0; t < total; t++) {
    const s = script[t];
    if (s) {
      const px = x + s[1];
      const used = Mc.furnaceInteract(e, px, 0.5, s[0]);
      give(s[0]); push(px);
      if ((s[0] === 'coal' || s[0] === 'charcoal') !== used) return `tick ${t} item ${s[0]} consumed=${used}`;
    }
    // reference tick
    {
      const sp = Math.min(2.0, Math.abs(vx)); vx = (vx < 0 ? -1 : 1) * sp;
      const m = 4.0 / 20.0, d = Math.max(-m, Math.min(m, vx));
      const cell0 = Math.floor(x); x += d;
      let p = pX * pX + pZ * pZ;
      if (p > 1.0E-7) { p = Math.sqrt(p); pX /= p; pZ /= p; vx = vx * 0.8 + pX; vz = vz * 0.8 + pZ; }
      else { vx *= 0.98; vz *= 0.98; }
      vx *= 0.96; vz *= 0.96;
      const cell1 = Math.floor(x);
      if (cell1 !== cell0) vx = Math.abs(vx) * (cell1 - cell0);
      const h = Math.abs(vx);
      if (h > 0.01) vx += vx / h * 0.06;
      const h2 = vx * vx + vz * vz, p2 = pX * pX + pZ * pZ;
      if (p2 > 1.0E-4 && h2 > 0.001) { const sq = Math.sqrt(h2), pq = Math.sqrt(p2); pX = vx / sq * pq; pZ = vz / sq * pq; }
      if (fuel > 0) fuel--;
      if (fuel <= 0) { pX = 0; pZ = 0; }
    }
    const lit = fuel > 0, smokeRef = lit && Math.floor(rr() * 4) === 0;
    smokeNow = 0; e.px = e.x; const xb = e.x; Mc.tick(e);
    const bad = e.fuel !== fuel ? `fuel ${e.fuel} vs ${fuel}` : !!e.cartLit !== lit ? `lit ${e.cartLit} vs ${lit}`
      : Math.abs(e.pushX - pX) > 1e-9 || Math.abs(e.pushZ - pZ) > 1e-9 ? `push ${e.pushX},${e.pushZ} vs ${pX},${pZ}`
      : Math.abs(e.vx - vx) > 1e-9 ? `vx ${e.vx} vs ${vx}` : Math.abs(e.x - x) > 1e-9 ? `x ${e.x} vs ${x}`
      : (smokeNow > 0) !== smokeRef ? `smoke ${smokeNow > 0} vs ${smokeRef}` : null;
    if (bad) return `tick ${t}: ${bad}`;
    if (Math.abs(e.x - xb) > 0.2 + 1e-9) return `tick ${t}: moved ${e.x - xb} beyond maxSpeed 0.2`;
  }
  const out = Mc.dropItems(e, {});
  if (!out.includes('furnace') || !out.includes('minecart') || !drops.includes('furnace') || !drops.includes('minecart')) return `drops ${out}`;
  return null;
}
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r, `minecartfurnace salt ${s} ${r}`); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const rep = (a, b) => (f, s) => (f === '07zzr_minecart.js' ? (s.includes(a) ? s.replace(a, b) : (() => { throw new Error('break target missing: ' + a); })()) : s);
{ const r = lane(3, rep('e.fuel + 3600 <= 32000) { e.fuel += 3600;', 'e.fuel + 3600 <= 32000) { e.fuel += 3000;')); brk(!!r, `fuel per coal 3000 reported: ${r}`); }
{ const r = lane(5, rep('(w ? 3.0 : 4.0) / 20.0 : (w', '(w ? 3.0 : 5.0) / 20.0 : (w')); brk(!!r, `maxSpeed 0.25 reported: ${r}`); }
console.log(`lockstep-minecartfurnace: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
