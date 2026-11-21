#!/usr/bin/env node
// minecartcheck.mjs -- #1564 (G25): the minecart entities' movement/logic (src/07zzr_minecart.js) against
// AbstractMinecartEntity / FurnaceMinecartEntity / TntMinecartEntity (.decomp), headless.
//
//   1. rail following: a straight run decays by 0.96/tick and its x follows the independent closed form; a
//      closed ring of rails (four curves) keeps a fast cart on rails for 300 ticks at a constant height.
//   2. slopes: on an ascending rail the cart's y is by + 0.0625 + (offset along the slope), it slows climbing
//      (the 0.0078125 pull plus the dy*0.05 energy term) and gains speed descending.
//   3. powered rail: the +0.06 boost recurrence, the unpowered rail's brake (stop below 0.03, else x0.5), and
//      the 0.02 push off a wall from rest.
//   4. off rail: gravity then x0.95 airborne; the water numbers (-0.005).
//   5. damage: the wobble numbers, break at strength > 40, creative hit discards without a drop, drops per
//      variant (minecart / +furnace / +chest and inventory / +tnt / +hopper), doEntityDrops off drops nothing.
//   6. furnace fuel (3600 ticks per coal, cap 32000) and push vector; TNT cart prime (fuse 80), explode power.
//   7. the activator-rail reactions and the 4-tick command-block cooldown.
// Anti-vacuity: the same scenarios run against engines whose source text is edited (boost, slowdown, ADJ table,
// gravity, wobble limit, brake, slope pull, ...); each must produce failures ('<n> breaks caught').
import { loadEngine } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from './loadsrc.mjs';

console.log('minecartcheck -- #1564 (G25), minecart entities: rails, slopes, boost, off-rail, damage, variants');

const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

// The scenarios take an engine and return the list of failed assertions (so a broken engine can be run through
// the very same code and must produce some).
function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); return c; };
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07f_redstone.js', '07zzq_rail.js', '07zzr_minecart.js'], dom: false, patch });
  const R = M.Reg, S = M.States, B = M.Behave, Mc = M.Minecart;
  const N = 24, MID = 12;
  const cells = new Uint16Array(N * N * N);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const world = {
    getBlock: (x, y, z) => cells[idx(x, y, z)],
    setBlock(x, y, z, id) { const old = cells[idx(x, y, z)]; cells[idx(x, y, z)] = id; B.changed(x, y, z, old); return true; },
    blockLightAt: () => 15,
  };
  B.init(world); M.Redstone.init();
  Mc.world = world;
  const def = (nm) => R.realFirst[R.id[nm]] + R.defaultState[R.id[nm]];
  const STONE = def('stone');
  const rail = (shape, nm = 'rail', props = {}) => {
    let st = B.setProp(def(nm), 'shape', shape);
    for (const k of Object.keys(props)) st = B.setProp(st, k, props[k]);
    return st;
  };
  const FLOOR = () => { cells.fill(0); for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) cells[idx(x, -1, z)] = STONE; };
  const put = (x, y, z, st) => { cells[idx(x, y, z)] = st; };

  // a box mover against full-cube stone/air cells: Y, then X, then Z (Physics.move's order), sets onGround/horizontalCollision
  const HW = 0.49, H = 0.7;
  const solid = (x, y, z) => { const s = cells[idx(x, y, z)]; return s !== 0 && S.solid[s] === 1; };
  const hit = (e) => {
    for (let x = Math.floor(e.x - HW); x <= Math.floor(e.x + HW); x++)
      for (let y = Math.floor(e.y); y <= Math.floor(e.y + H - 1e-9); y++)
        for (let z = Math.floor(e.z - HW); z <= Math.floor(e.z + HW); z++) if (solid(x, y, z)) return true;
    return false;
  };
  Mc.mover = (e, dx, dy, dz) => {
    e.onGround = false; e.horizontalCollision = false;
    const axes = [['y', dy], ['x', dx], ['z', dz]];
    for (const [ax, d] of axes) {
      if (d === 0) continue;
      const o = e[ax]; e[ax] += d;
      if (hit(e)) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; e[ax] = o + d * m; if (hit(e)) hi = m; else lo = m; }
        e[ax] = o + d * lo;
        if (ax === 'y') { if (d < 0) e.onGround = true; e.vy = 0; } else e.horizontalCollision = true;
      }
    }
  };
  const drops = [];
  M.EntityList = { list: [], remove(e) { e.removed = true; }, random: () => 0.5, dropStack(x, y, z, item, count, opts) { drops.push(item + (count > 1 ? 'x' + count : '') + (opts && opts.tag ? '#' : '')); return {}; } };
  const explosions = [];
  M.Explosion = { ready: true, explode(src, x, y, z, power, griefing, rnd, decay, resist, fire, keep) { explosions.push({ x, y, z, power, griefing, decay, resist, keep }); } };
  const mk = (type, x, y, z, vx = 0, vy = 0, vz = 0, yaw = 0) => {
    const e = { id: 1, type, x, y, z, px: x, py: y, pz: z, vx, vy, vz, yaw, width: 0.98, height: 0.7, age: 0, removed: false, onGround: false, fallDistance: 0 };
    Mc.init(e, {});
    return e;
  };
  const tick = (e) => { e.px = e.x; e.py = e.y; e.pz = e.z; Mc.tick(e); };
  ok(Mc && R.ready && M.Rail.ready, 'Minecart, Registry and Rail are ready');

  // ── 0. storage cart slowdown: 0.98 + (15 - comparator) * 0.001 (#3868) ───────────────
  FLOOR();
  for (let x = -7; x <= 7; x++) put(x, 0, 0, rail('east_west'));
  {
    const sl = (type, fill) => {
      const e = mk(type, 0.5, 0, 0.5, 0.2, 0, 0);
      if (fill) for (let i = 0; i < Mc.INVENTORY[type]; i++) e.inventory[i] = { item: 'stone', count: 64 };
      tick(e); return e.vx / 0.2;
    };
    ok(near(sl('chest_minecart', false), 0.995, 1e-6), 'empty chest cart slows x0.995');
    ok(near(sl('chest_minecart', true), 0.98, 1e-6), 'full chest cart slows x0.98');
    {   // #4219: an unrolled loot table makes the slowdown a flat 0.98
      const lc = mk('chest_minecart', 0.5, 0, 0.5, 0.2, 0, 0); Mc.readNbt(lc, { LootTable: 'x' }); tick(lc);
      ok(near(lc.vx / 0.2, 0.98, 1e-6) && lc.lootTable === 'x', 'loot-table cart slows a flat 0.98 without rolling');
    }
    ok(near(sl('hopper_minecart', true), 0.98, 1e-6), 'full hopper cart slows x0.98');
  }

  // ── 0b. cart-vs-cart push is o.pushAwayFrom(e): the NEIGHBOUR's yaw gates it (#4830) ──
  FLOOR();
  {
    const run = (oYaw, withO) => {
      const e = mk('minecart', 0.5, 0, 0.5, 0.1, 0, 0, 0), o = mk('minecart', 1.0, 0, 0.5, 0, 0, 0, oYaw);
      if (withO) M.EntityList.list.push(e, o);
      tick(e); M.EntityList.list.length = 0; return e.vx;
    };
    const alone = run(0, false);
    ok(run(90, true) === alone, 'neighbour heading across the line of centres: vanilla early-out, no push');
    ok(run(0, true) !== alone, 'neighbour heading along the line of centres: pushed');
  }

  // ── 0b'. updatePassengerForDismount: rail-axis scan (west-moving cart: north side first, then south, then above) ──
  {
    const wall = new Set(); const Ph = { solidAt: (x, y, z) => y < 1 || wall.has(x + ',' + y + ',' + z) };
    const e = mk('minecart', 5.5, 1, 5.5, 0, 0, 0), d = () => M.Minecart.findDismountPos(e, Ph);
    let p = d(); ok(p.x === 5.5 && p.y === 1 && p.z === 4.5, 'dismount lands on the first side of the rail axis');
    wall.add('5,1,4'); p = d(); ok(p.z === 6.5, 'a blocked side falls to the other side');
    for (const z of [4, 6]) for (const x of [4, 5, 6]) for (const y of [1, 2]) wall.add(x + ',' + y + ',' + z);
    for (const y of [1, 2]) { wall.add('4,' + y + ',5'); wall.add('6,' + y + ',5'); } p = d(); ok(p.y > 1 && p.x === 5.5 && p.z === 5.5, 'fully boxed in: falls back to above the cart');
  }

  // ── 0c. RIDEABLE cart at speed picks up a pushed mob; player / iron golem / cart are pushed, not mounted (#4906) ──
  FLOOR();
  {
    M.Raid = { startRiding(r, v) { r.vehicle = v; r.riding = true; v.passenger = r; return true; } };
    const mob = (type, x) => ({ id: 9, type, x, y: 0, z: 0.5, vx: 0, vy: 0, vz: 0, width: 0.6, height: 0.9, maxHealth: 10, vehicle: null });
    const run = (type, ct = 'minecart', vx = 0.3) => {
      const e = mk(ct, 0.5, 0, 0.5, vx, 0, 0), o = mob(type, 1.1);
      M.EntityList.list.push(e, o); tick(e); M.EntityList.list.length = 0; return { e, o };
    };
    let r = run('pig');
    ok(r.o.vehicle === r.e && r.e.cartPassengers[0] === r.o, 'a fast rideable cart picks up a pig in its path');
    ok(run('iron_golem').o.vehicle === null, 'an iron golem is not picked up');
    ok(run('pig', 'minecart', 0.05).o.vehicle === null, 'a slow cart (speed^2 <= 0.01) does not pick up');
    ok(run('pig', 'chest_minecart').o.vehicle === null, 'a chest cart does not pick up');
    { const e = mk('minecart', 0.5, 0, 0.5, 0.3, 0, 0), a = mob('pig', 1.1), b = mob('cow', 1.1);
      M.EntityList.list.push(e, a, b); tick(e); M.EntityList.list.length = 0;
      ok(a.vehicle === e && b.vehicle === null, 'only one mob rides: a loaded cart takes no second'); }
    { const e = mk('minecart', 0.5, 0, 0.5, 0.3, 0, 0), o = mk('minecart', 1.1, 0, 0.5);
      M.EntityList.list.push(e, o); tick(e); M.EntityList.list.length = 0;
      ok(!o.vehicle && !e.cartPassengers.length, 'a second cart is not mounted'); }
    delete M.Raid;
  }

  // ── 1. straight run + ring ───────────────────────────────────────────────────────────
  FLOOR();
  for (let x = -7; x <= 7; x++) put(x, 0, 0, rail('east_west'));
  {
    const e = mk('minecart', 0.5, 0, 0.5, 0.2, 0, 0);
    let x = 0.5, v = 0.2, good = true;
    for (let t = 0; t < 20; t++) {
      tick(e);
      x += v; v *= 0.96;                       // reaim keeps |v|, move, then applySlowdown x0.96
      if (!near(e.x, x, 1e-9) || !near(e.vx, v, 1e-9) || !near(e.y, 0.0625, 1e-9)) { good = false; break; }
    }
    ok(good, 'straight east_west run follows x += v; v *= 0.96 at y = 0.0625 for 20 ticks');
    ok(e.cartOnRail === true, 'cart reports it is on a rail');
  }
  {
    // a rail ring: corners + straights around (-2..2, -2..2)
    FLOOR();
    for (let x = -1; x <= 1; x++) { put(x, 0, -2, rail('east_west')); put(x, 0, 2, rail('east_west')); }
    for (let z = -1; z <= 1; z++) { put(-2, 0, z, rail('north_south')); put(2, 0, z, rail('north_south')); }
    put(-2, 0, -2, rail('south_east')); put(2, 0, -2, rail('south_west')); put(-2, 0, 2, rail('north_east')); put(2, 0, 2, rail('north_west'));
    const e = mk('minecart', 0.5, 0, -1.5, 0.45, 0, 0);
    let off = 0, yOk = true, minX = 99, maxZ = -99, maxX = -99;
    for (let t = 0; t < 300; t++) {
      tick(e);
      if (!e.cartOnRail) off++;
      if (!near(e.y, 0.0625, 1e-6)) yOk = false;
      minX = Math.min(minX, e.x); maxZ = Math.max(maxZ, e.z); maxX = Math.max(maxX, e.x);
      if (Math.hypot(e.vx, e.vz) < 0.02) break;
    }
    ok(off === 0, 'a cart on a closed rail ring stays on rails round the corners (' + off + ' ticks off a rail)');
    ok(yOk, 'and never leaves the rail plane (y = 0.0625)');
    ok(maxX > 2 && maxZ > 2 && minX < -1, 'and went round three corners (max x ' + maxX.toFixed(2) + ', max z ' + maxZ.toFixed(2) + ', min x ' + minX.toFixed(2) + ')');
  }

  // ── 2. slopes ────────────────────────────────────────────────────────────────────────
  FLOOR();
  for (let x = -6; x <= -1; x++) put(x, 0, 0, rail('east_west'));
  put(0, 0, 0, rail('ascending_east')); put(0, -1, 0, STONE);
  for (let x = 1; x <= 6; x++) { put(x, 1, 0, rail('east_west')); put(x, 0, 0, STONE); }
  {
    const e = mk('minecart', -0.5, 0, 0.5, 0.35, 0, 0);
    let sloped = 0, bad = null, v0 = null, vEnd = null;
    for (let t = 0; t < 40; t++) {
      tick(e);
      if (e.x >= 0 && e.x < 1) {
        sloped++;
        const want = 0 + 0.0625 + (e.x - 0);
        if (!near(e.y, want, 1e-6) && bad === null) bad = `x=${e.x} y=${e.y} want ${want}`;
        if (v0 === null) v0 = Math.hypot(e.vx, e.vz);
        vEnd = Math.hypot(e.vx, e.vz);
      }
    }
    ok(sloped >= 2 && bad === null, 'cart on an ascending_east rail rides y = by + 0.0625 + (x - bx) (' + (bad || sloped + ' ticks') + ')');
    ok(e.x > 1 && near(e.y, 1.0625, 1e-6), 'and ends up on the upper rail at y = 1.0625 (x=' + e.x.toFixed(3) + ' y=' + e.y.toFixed(4) + ')');
    // climbing costs speed beyond the plain 0.96 decay: compare with the flat run of the same start speed
    const flat = 0.35 * Math.pow(0.96, 8);
    ok(vEnd !== null && vEnd < flat, 'climbing slows the cart more than flat drag (' + (vEnd && vEnd.toFixed(4)) + ' < ' + flat.toFixed(4) + ')');
  }
  {
    // descending: from the top of the slope heading west gains speed relative to flat drag
    const e = mk('minecart', 0.9, 0.9625, 0.5, -0.1, 0, 0);
    const v0 = 0.1; let ticks = 0;
    for (let t = 0; t < 4; t++) { tick(e); ticks++; if (e.x < 0) break; }
    ok(e.cartOnRail && Math.hypot(e.vx, e.vz) > v0 * Math.pow(0.96, ticks), 'descending an ascending_east rail gains speed over flat drag');
  }

  // ── 3. powered rail ──────────────────────────────────────────────────────────────────
  FLOOR();
  for (let x = -7; x <= 7; x++) put(x, 0, 0, rail('east_west', 'powered_rail', { powered: 'true' }));
  {
    const e = mk('minecart', -6.5, 0, 0.5, 0.1, 0, 0);
    let v = 0.1, good = true;
    for (let t = 0; t < 6; t++) {
      tick(e);
      v = v * 0.96; v += v / Math.abs(v) * 0.06;
      if (!near(e.vx, v, 1e-9)) { good = false; break; }
    }
    ok(good, 'a powered rail adds 0.06 along the heading after the slowdown: 0.1 -> ' + v.toFixed(5));
  }
  FLOOR();
  for (let x = -7; x <= 7; x++) put(x, 0, 0, rail('east_west', 'powered_rail', { powered: 'false' }));
  {
    const e = mk('minecart', 0.5, 0, 0.5, 0.2, 0, 0);
    tick(e);
    ok(near(e.vx, 0.2 * 0.5 * 0.96, 1e-9), 'an unpowered powered rail brakes: x0.5 then the 0.96 slowdown (' + e.vx.toFixed(5) + ')');
    const np = mk('minecart', 0.5, 0, 0.5, 0.05, 0, 0), pl = { type: 'player', vx: 0, vz: 0 };
    np.cartPassengers = [pl]; np.rider = pl; np.riderInput = { forwardSpeed: 1, sidewaysSpeed: 0, yaw: Math.PI / 2, pitch: 0 };
    tick(np);
    ok(np.vx > 0.055 && Math.abs(np.vz) < 1e-6, 'a slow cart takes the rider-input nudge (+0.1*0.1) and does not brake (' + np.vx.toFixed(5) + ')');
    const s = mk('minecart', 2.5, 0, 0.5, 0.02, 0, 0);
    tick(s);
    ok(s.vx === 0 && s.vz === 0, 'below 0.03 on an unpowered powered rail it stops dead');
  }
  FLOOR();
  put(0, 0, 0, rail('east_west', 'powered_rail', { powered: 'true' })); put(1, 0, 0, rail('east_west', 'powered_rail', { powered: 'true' })); put(-1, 0, 0, STONE); put(-1, 1, 0, STONE);
  {
    const e = mk('minecart', 0.5, 0, 0.5, 0, 0, 0);
    tick(e);
    ok(e.vx > 0, 'at rest beside a wall a powered rail pushes the cart away (vx=' + e.vx + ')');
    ok(near(e.vx, 0.02, 1e-9), 'by exactly 0.02');
  }

  // ── 4. off rail ──────────────────────────────────────────────────────────────────────
  FLOOR();
  {
    const e = mk('minecart', 0.5, 5, 0.5, 0, 0, 0);
    tick(e);
    ok(near(e.vy, -0.04 * 0.95, 1e-9), 'off a rail: gravity -0.04 then x0.95 airborne (' + e.vy + ')');
    ok(near(e.y, 5 - 0.04, 1e-9), 'and the move used the unscaled -0.04');
    const g = mk('minecart', 0.5, 0, 0.5, 0.3, 0, 0);          // on stone floor (y=0 is the cell above floor -1)
    for (let t = 0; t < 30; t++) tick(g);
    ok(Math.abs(g.vx) < 0.3 * 0.5 * 0.5 && g.onGround, 'grounded off rail it loses half its speed per tick');
    ok(g.cartOnRail === false, 'and reports no rail');
    const v = mk('minecart', 0.5, -200, 0.5);
    tick(v);
    ok(v.removed === true, 'below world bottom - 64 the cart is discarded (attemptTickInVoid)');
  }

  // ── 4b. getVelocityMultiplier, setOnFireFromLava (#4832) ───────────────────────────
  {
    R.speedFactor[R.id.soul_sand] = Math.fround(0.4);   // buildPhysics data is not loaded here
    FLOOR();
    const a = mk('minecart', 0.5, 0, 0.5, 0.3, 0, 0); tick(a);
    FLOOR(); cells[idx(0, -1, 0)] = S.stateOf('soul_sand');
    const b = mk('minecart', 0.5, 0, 0.5, 0.3, 0, 0); tick(b);
    ok(near(b.vx / a.vx, Math.fround(0.4), 1e-6), 'off rail on soul sand the cart is slowed by speedFactor (' + b.vx / a.vx + ')');
    FLOOR(); cells[idx(0, 0, 0)] = S.stateOf('lava');
    const l = mk('minecart', 0.5, 0, 0.5); tick(l);
    ok(l.cartWobbleStrength > 30, 'a cart in lava takes the 4 damage of setOnFireFromLava (wobble ' + l.cartWobbleStrength + ')');
  }

  // ── 4c. riding: MinecartEntity.interact (#4829) ──────────────────────────────────────
  {
    const mkP = (crouching) => ({ crouching, vehicle: null, mountVehicle(c) { this.vehicle = c; }, dismountVehicle() { this.vehicle.rider = null; this.vehicle = null; } });
    const e = mk('minecart', 0.5, 5, 0.5), p = mkP(true);
    ok(Mc.interact(e, p) === false && !p.vehicle, 'a sneaking player does not mount');
    p.crouching = false;
    ok(Mc.interact(e, p) === true && p.vehicle === e && e.cartPassengers[0] === p && e.rider === p, 'right-click seats the player');
    ok(Mc.interact(e, mkP(false)) === false, 'an occupied cart takes no second rider');
    M.Player = p;
    Mc.onActivatorRail(e, true);
    ok(p.vehicle === null && e.cartPassengers.length === 0 && !e.rider, 'a powered activator rail removes all passengers');
    ok(Mc.interact(mk('chest_minecart', 0.5, 5, 0.5), mkP(false)) === false, 'only the plain minecart is rideable');
    const d = mk('minecart', 0.5, 5, 0.5), q = mkP(false); Mc.interact(d, q); M.Player = q; Mc.damage(d, 3, {}); Mc.damage(d, 3, {});
    ok(q.vehicle === null && d.removed, 'breaking the cart dismounts the rider');
    drops.length = 0; M.Player = null;
  }

  // ── 5. damage and drops ──────────────────────────────────────────────────────────────
  {
    const e = mk('minecart', 0.5, 5, 0.5);
    ok(Mc.damage(e, 3, {}) === true && e.cartWobbleTicks === 10 && e.cartWobbleSide === -1 && near(e.cartWobbleStrength, 30), 'a hit of 3: wobble 10 ticks, side flips, strength 30');
    ok(!e.removed && drops.length === 0, 'strength 30 does not break it');
    tick(e);
    ok(e.cartWobbleTicks === 9 && near(e.cartWobbleStrength, 29), 'a tick counts the wobble down by 1 and the strength by 1');
    Mc.damage(e, 3, {});
    ok(e.removed && drops.join() === 'minecart', 'strength 59 > 40 breaks it and drops one minecart (' + drops.join() + ')');
    drops.length = 0;
    const c = mk('minecart', 0.5, 5, 0.5);
    Mc.damage(c, 1, { instabuild: true });
    ok(c.removed && drops.length === 0, 'a creative hit discards without a drop');
    const named = mk('minecart', 0.5, 5, 0.5); named.cartName = 'Bob';
    Mc.damage(named, 1, { instabuild: true });
    ok(named.removed && drops.join() === 'minecart#', 'a named cart hit by a creative player drops (with its name)');
    drops.length = 0;
    const f = mk('furnace_minecart', 0.5, 5, 0.5); Mc.dropItems(f, {});
    ok(drops.join() === 'minecart,furnace', 'furnace minecart drops minecart + furnace (' + drops.join() + ')');
    drops.length = 0;
    const ch = mk('chest_minecart', 0.5, 5, 0.5); ch.inventory.push({ item: 'dirt', count: 3 }); Mc.dropItems(ch, {});
    ok(drops.join() === 'dirtx3,minecart,chest', 'chest minecart drops minecart, its contents, chest (' + drops.join() + ')');
    drops.length = 0;
    {   // #4219: Items / LootTable round-trip through writeNbt/readNbt, generateLoot once, 0.98 flat slowdown
      const src = mk('chest_minecart', 0, 0, 0); src.inventory[3] = { item: 'dirt', count: 5 };
      const w = Mc.writeNbt(src), back = mk('chest_minecart', 0, 0, 0); Mc.readNbt(back, JSON.parse(JSON.stringify(w)));
      ok(w.Items.length === 1 && w.Items[0].Slot === 3 && !w.LootTable && back.inventory[3] && back.inventory[3].item === 'dirt' && back.inventory[3].count === 5, 'chest cart Items round-trip');
      const lt = mk('chest_minecart', 0, 0, 0); Mc.readNbt(lt, { LootTable: 'minecraft:chests/simple_dungeon', LootTableSeed: 7 });
      const w2 = Mc.writeNbt(lt);
      ok(w2.LootTable === 'minecraft:chests/simple_dungeon' && w2.LootTableSeed === 7 && !w2.Items, 'chest cart LootTable written instead of Items');
      M.Loot = { rng: (sd) => ({ nextInt: () => 0, sd }), rollTable: (nm, c) => [{ item: 'gold_ingot', count: 2 }, { item: 'bone', count: 1 }] };
      Mc.generateLoot(lt, null);
      ok(!lt.lootTable && lt.inventory.filter(Boolean).length === 2 && !Mc.writeNbt(lt).LootTable, 'generateLoot rolls the table into the slots once');
      Mc.generateLoot(lt, null);
      ok(lt.inventory.filter(Boolean).length === 2, 'generateLoot does not roll twice');
      const bc = mk('chest_minecart', 0.5, 5, 0.5); Mc.readNbt(bc, { LootTable: 'x' }); drops.length = 0; Mc.dropItems(bc, {});
      ok(drops.join() === 'gold_ingotx2,bone,minecart,chest', 'breaking a loot cart drops the rolled loot (' + drops.join() + ')');
      M.Loot = undefined;
    }
    drops.length = 0;
    {
      const hc = mk('hopper_minecart', 3.5, 0, 3.5);
      const it = { type: 'item', item: 'dirt', count: 2, x: 3.5, y: 1.2, z: 3.5, width: 0.25, height: 0.25, removed: false };
      M.EntityList.list.push(it);
      for (let t = 0; t < 4; t++) tick(hc);
      ok(it.removed && hc.inventory[0] && hc.inventory[0].count === 2, 'hopper cart absorbs an item entity above it within 4 ticks');
      M.EntityList.list.length = 0;
      const hf = mk('hopper_minecart', 3.5, 0, 3.5);
      const it2 = { type: 'item', item: 'dirt', count: 2, x: 4.1, y: 0.1, z: 3.5, width: 0.25, height: 0.25, removed: false };
      M.EntityList.list.push(it2);
      for (let t = 0; t < 4; t++) tick(hf);
      ok(it2.removed && hf.inventory[0] && hf.inventory[0].count === 2, 'hopper cart absorbs an item at its feet (own box grown 0.25, #3884)');
      M.EntityList.list.length = 0;
      const he = mk('hopper_minecart', 3.5, 0, 3.5);
      const it3 = { type: 'item', item: 'dirt', count: 2, x: 4.05, y: 0.74, z: 3.5, width: 0.25, height: 0.25, removed: false };
      M.EntityList.list.push(it3);
      for (let t = 0; t < 4; t++) tick(he);
      ok(!it3.removed && !(he.inventory[0] && he.inventory[0].count), 'hopper cart ignores an item only in the 0..2/16 edge ring at y 11/16..1 (INSIDE_SHAPE x/z 2..14)');
      M.EntityList.list.length = 0;
    }
    {
      const hc = mk('hopper_minecart', 3.5, 0, 3.5), cc = mk('chest_minecart', 3.5, 1, 3.5);
      cc.inventory[0] = null; cc.inventory[1] = { item: 'dirt', count: 2 };
      const it = { type: 'item', item: 'stone', count: 1, x: 3.5, y: 1.2, z: 3.5, width: 0.25, height: 0.25, removed: false };
      M.EntityList.list.push(cc, it);
      tick(hc);
      ok(cc.inventory[1].count === 1 && hc.inventory[0] && hc.inventory[0].item === 'dirt' && !it.removed, 'hopper cart pulls 1 item from a chest cart above and skips the item scan');
      M.EntityList.list.length = 0;
    }
    const h = mk('hopper_minecart', 0.5, 5, 0.5); Mc.dropItems(h, {});
    ok(drops.join() === 'minecart,hopper', 'hopper minecart drops minecart + hopper');
    { const big = mk('chest_minecart', 0.5, 5, 0.5); big.inventory[0] = { item: 'cobblestone', count: 64 }; drops.length = 0; Mc.dropItems(big, {});
      ok(drops.join() === 'cobblestonex20,cobblestonex20,cobblestonex20,cobblestonex4,minecart,chest', 'a 64 stack scatters in 10..30 chunks (' + drops.join() + ')'); }
    { // #5912: scatter velocity is java.util.Random.nextGaussian (polar), value for value
      const M48 = (1n << 48n) - 1n;
      const jr = seed => { let sd = (BigInt(seed) ^ 0x5DEECE66Dn) & M48, hg = false, ng = 0;
        const next = b => { sd = (sd * 0x5DEECE66Dn + 0xBn) & M48; return Number(BigInt.asIntN(32, sd >> (48n - BigInt(b)))); };
        const nd = () => (next(26) * 134217728 + next(27)) / 9007199254740992;
        const gauss = () => { if (hg) { hg = false; return ng; } let a, b, q; do { a = 2 * nd() - 1; b = 2 * nd() - 1; q = a * a + b * b; } while (q >= 1 || q === 0);
          const m = Math.sqrt(-2 * Math.log(q) / q); ng = b * m; hg = true; return a * m; };
        return { nd, gauss }; };
      const ref = jr(12345), got = jr(12345), recs = [], saveDrop = M.EntityList.dropStack, saveRnd = M.EntityList.random;
      M.EntityList.random = got.nd;
      M.EntityList.dropStack = (x, y, z, item, count, o) => { if (o && o.vx !== undefined) recs.push([x, y, z, o.vx, o.vy, o.vz, count]); return {}; };
      const c = mk('chest_minecart', 0.5, 5, 0.5); c.inventory[0] = { item: 'cobblestone', count: 64 }; Mc.dropItems(c, {});
      M.EntityList.dropStack = saveDrop; M.EntityList.random = saveRnd;
      const px = 0 + ref.nd() * 0.75 + 0.125, py = 5 + ref.nd() * 0.75, pz = 0 + ref.nd() * 0.75 + 0.125, exp = []; let left = 64;
      while (left > 0) { const n = Math.min(left, Math.floor(ref.nd() * 21) + 10); left -= n; exp.push([px, py, pz, ref.gauss() * 0.05, ref.gauss() * 0.05 + 0.2, ref.gauss() * 0.05, n]); }
      ok(recs.length === 4 && recs.every((r, k) => r.every((v, j) => Math.abs(v - exp[k][j]) < 1e-12)), 'chest cart scatter (x,y,z,v,count) matches java.util.Random nextGaussian reference');
    }
    drops.length = 0;
    drops.length = 0;
    const t1 = mk('tnt_minecart', 0.5, 5, 0.5); Mc.dropItems(t1, {});
    ok(drops.join() === 'minecart,tnt', 'a still tnt minecart drops minecart + tnt');
    drops.length = 0;
    const t2 = mk('tnt_minecart', 0.5, 5, 0.5, 0.2, 0, 0); Mc.dropItems(t2, {});
    ok(drops.length === 0 && t2.cartFuse >= 0 && !t2.removed, 'a fast tnt minecart broken primes instead of dropping (fuse ' + t2.cartFuse + ')');
    {
      const was = M.Piglin, calls = []; M.Piglin = { ready: true, onGuardedBlockInteracted: (pl, los) => calls.push([pl, los]) };
      const pl = { id: 'p' };
      Mc.dropItems(mk('chest_minecart', 0.5, 5, 0.5), { player: pl });
      Mc.dropItems(mk('hopper_minecart', 0.5, 5, 0.5), {});
      Mc.dropItems(mk('furnace_minecart', 0.5, 5, 0.5), { player: pl });
      ok(calls.length === 1 && calls[0][0] === pl && calls[0][1] === true, 'a player-broken chest cart angers piglins (LOS true); other sources/variants do not (' + calls.length + ')');
      M.Piglin = was; drops.length = 0;
    }
    M.Commands = { ruleGet: (n) => (n === 'doEntityDrops' ? 'false' : null) };
    const nd = mk('furnace_minecart', 0.5, 5, 0.5); Mc.dropItems(nd, {});
    ok(nd.removed && drops.length === 0, 'doEntityDrops false: the cart goes, nothing drops');
    const cc = mk('chest_minecart', 0.5, 5, 0.5); cc.inventory.push({ item: 'dirt', count: 3 });
    const n0 = drops.length; const o = Mc.dropItems(cc, {});
    ok(o.includes('dirtx3') && drops.length === n0 + 1 && !o.includes('chest'), 'doEntityDrops false: chest cart still scatters its contents (remove(), #3869)');
    // #4587: an open cart screen is flushed into the cart (and closed) before the cart scatters
    {
      const c3 = mk('chest_minecart', 0.5, 5, 0.5); c3.inventory.push({ item: 'dirt', count: 3 });
      let closed = 0;
      M.Hud = { cartGone(e) { if (e === c3) { c3.inventory[0] = { item: 'stone', count: 7 }; closed++; } } };
      const o3 = Mc.dropItems(c3, {}); M.Hud = null;
      ok(closed === 1 && o3.includes('stonex7') && !o3.includes('dirtx3'), 'cart removal flushes the open screen first, no stale dup (#4587)');
    }
    M.Commands = undefined;
  }

  // ── 6. furnace and tnt ───────────────────────────────────────────────────────────────
  FLOOR();
  for (let x = -7; x <= 7; x++) put(x, 0, 0, rail('east_west'));
  {
    const f = mk('furnace_minecart', 0.5, 0, 0.5);
    ok(Mc.furnaceInteract(f, -1.5, 0.5, 'coal') === true && f.fuel === 3600, 'coal adds 3600 ticks of fuel');
    ok(near(f.pushX, 2.0) && f.pushZ === 0, 'and the pusher sets the push vector away from the player');
    f.fuel = 30000; ok(Mc.furnaceInteract(f, -1.5, 0.5, 'coal') === false && f.fuel === 30000, 'no coal over the 32000 cap');
    f.fuel = 3600;
    let vmax = 0;
    for (let t = 0; t < 40; t++) { const x0 = f.x; tick(f); vmax = Math.max(vmax, Math.abs(f.x - x0)); }
    ok(f.cartLit === true && vmax > 0.05 && vmax <= 4 / 20 + 1e-9, 'a fuelled furnace cart drives itself, each tick\'s move capped at 4/20 (max step ' + vmax.toFixed(4) + ')');
    ok(f.fuel === 3560, 'and burns one fuel tick per tick');
    const g = mk('furnace_minecart', 0.5, 0, 0.5); g.fuel = 1; g.pushX = 1;
    tick(g);
    ok(g.fuel === 0 && g.cartLit === false && g.pushX === 0, 'out of fuel: unlit and the push vector cleared');
    const ps = [];
    M.Particle = { spawn: (k, x, y) => ps.push([k, y]) };
    const lc = mk('furnace_minecart', 0.5, 0, 0.5); lc.fuel = 1000; lc.pushX = 0;
    const uc = mk('furnace_minecart', 0.5, 0, 0.5); uc.fuel = 0;
    for (let i = 0; i < 200; i++) tick(uc);
    ok(ps.length === 0, 'an unlit furnace cart spawns no smoke');
    const r0 = M.EntityList.random; let sd = 1; M.EntityList.random = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 200; i++) tick(lc);
    M.EntityList.random = r0;
    M.Particle = undefined;
    ok(ps.length > 25 && ps.length < 80 && ps.every(p => p[0] === 'large_smoke'), 'a lit furnace cart spawns large_smoke ~1 in 4 ticks (' + ps.length + '/200)');
  }
  {
    const t = mk('tnt_minecart', 0.5, 0, 0.5);
    const snd = [], smoke = [];
    M.Sound = { entitySound: (ev) => snd.push(ev) };
    M.Particle = { spawn: (k) => smoke.push(k) };
    Mc.onActivatorRail(t, true);
    ok(snd.join() === 'entity.tnt.primed' && t.statusQueue && t.statusQueue[0] === 10, 'priming plays entity.tnt.primed once and sends status 10');
    ok(t.cartFuse === 80, 'a powered activator rail primes a tnt minecart (fuse 80)');
    for (let i = 0; i < 80; i++) tick(t);
    ok(smoke.length === 80 && smoke.every(k => k === 'smoke'), 'one smoke particle per fuse tick (' + smoke.length + ')');
    M.Sound = M.Particle = undefined;
    ok(!t.removed && t.cartFuse === 0, 'after 80 ticks the fuse reads 0 and the cart still stands');
    tick(t);
    ok(t.removed && explosions.length === 1, 'the next tick (fuse == 0) explodes it, exactly once');
    const ex = explosions[0];
    ok(ex && ex.power === Math.fround(4 + 0.5 * 1.5 * 0) && ex.griefing === true && ex.decay === false, 'power 4 + rand*1.5*|v| (here 4), BREAK type (' + (ex && ex.power) + ')');
    explosions.length = 0;
    const fast = mk('tnt_minecart', 0.5, 0, 0.5);
    Mc.explode(fast, 9);
    ok(near(explosions[0].power, Math.fround(4 + 0.5 * 1.5 * 3), 1e-6), 'power scales with speed: |v|=3 -> 4 + 0.5*1.5*3');
    explosions.length = 0;
    const inv = mk('tnt_minecart', 0.5, 0, 0.5); Mc.damage(inv, 1, { invulnerable: true, flamingArrowSpeed2: 9 });
    ok(inv.removed && explosions.length === 1, '#4934: a flaming arrow explodes an invulnerable cart (explode runs before the early-outs)');
    explosions.length = 0;
    const sp = mk('tnt_minecart', 0.5, 0, 0.5); Mc.explode(sp, 400);
    ok(near(explosions[0].power, Math.fround(4 + 0.5 * 1.5 * 5), 1e-6), '|v| is capped at 5');
    explosions.length = 0;
    const wall = mk('tnt_minecart', 5.5, 0, 0.5, 0.45, 0, 0); put(7, 0, 0, STONE); put(7, 1, 0, STONE);
    for (let i = 0; i < 10 && !wall.removed; i++) tick(wall);
    ok(wall.removed && explosions.length === 1, 'a tnt minecart hitting a wall at speed explodes');
    explosions.length = 0;
    {
      // #4850: fuse 0 explodes (discards), then the wall-hit branch runs with no removed check: vanilla blasts twice
      const w2 = mk('tnt_minecart', 6.6, 0, 0.5, 0.45, 0, 0); w2.cartFuse = 0;
      for (let i = 0; i < 10 && explosions.length < 2 && !(w2.removed && i > 0 && explosions.length); i++) tick(w2);
      ok(explosions.length === 2, 'fuse 0 + wall hit: two explosions like vanilla (' + explosions.length + ')');
      explosions.length = 0;
    }
    {
      // #3925: a PRIMED cart's blast spares rails and the block under a rail; an unprimed one gets no hooks
      const pr = mk('tnt_minecart', 0.5, 0, 0.5); Mc.prime(pr); Mc.explode(pr, 0);
      const h = explosions[0]; explosions.length = 0;
      const STN = STONE;
      put(3, 0, 3, STN); put(3, 1, 3, rail('east_west')); put(5, 0, 3, STN); put(5, 1, 3, STN);
      const st = (x, y, z) => cells[idx(x, y, z)];
      ok(h.resist && h.resist(st(3, 1, 3), 9, 3, 1, 3) === 0 && h.keep(st(3, 1, 3), 3, 1, 3) === false, 'primed: a rail has resistance 0 and is not destroyed');
      ok(h.resist(st(3, 0, 3), 9, 3, 0, 3) === 0 && h.keep(st(3, 0, 3), 3, 0, 3) === false, 'primed: the block under a rail is spared too');
      ok(h.resist(st(5, 0, 3), 9, 5, 0, 3) === 9 && h.keep(st(5, 0, 3), 5, 0, 3) === true, 'primed: other blocks keep their resistance and break');
      Mc.explode(mk('tnt_minecart', 0.5, 0, 0.5), 0);
      ok(explosions[0].resist === undefined && explosions[0].keep === undefined, 'an unprimed cart (wall hit) uses the plain explosion');
      explosions.length = 0;
    }
    const slow = mk('tnt_minecart', 0.5, 0, 0.5);
    Mc.onActivatorRail(slow, false); ok(slow.cartFuse === -1, 'an unpowered activator rail does not prime it');
  }

  // ── 7. activator rail reactions ──────────────────────────────────────────────────────
  {
    const m = mk('minecart', 0.5, 0, 0.5); m.cartPassengers.push({ type: 'zombie' });
    Mc.onActivatorRail(m, true);
    ok(m.cartPassengers.length === 0 && m.cartWobbleTicks === 10 && m.cartWobbleStrength === 50 && m.cartWobbleSide === -1, 'activator rail ejects passengers and wobbles at strength 50');
    const w = m.cartWobbleSide; Mc.onActivatorRail(m, true);
    ok(m.cartWobbleSide === w, 'and does not re-wobble while the wobble is running');
    const h = mk('hopper_minecart', 0.5, 0, 0.5);
    Mc.onActivatorRail(h, true); ok(h.hopperEnabled === false, 'powered activator rail disables a hopper minecart');
    Mc.onActivatorRail(h, false); ok(h.hopperEnabled === true, 'unpowered re-enables it');
    const cb = mk('command_block_minecart', 0.5, 0, 0.5); cb.age = 10;
    Mc.onActivatorRail(cb, true); cb.age = 12; Mc.onActivatorRail(cb, true); cb.age = 14; Mc.onActivatorRail(cb, true);
    ok(cb.commandRuns === 2, 'a command block minecart fires at most once per 4 ticks (' + cb.commandRuns + ' of 3 attempts at ages 10/12/14)');
  }

  // ── 8. a rail activator at the cell triggers during tick ─────────────────────────────
  FLOOR();
  put(0, 0, 0, rail('east_west', 'activator_rail', { powered: 'true' }));
  { const t = mk('tnt_minecart', 0.5, 0, 0.5); tick(t); ok(t.cartFuse === 79, 'ticking over a powered activator rail primes the tnt cart (fuse 80 then one tick -> 79)'); }

  // ── 9. display fields a renderer reads ───────────────────────────────────────────────
  {
    const f = mk('furnace_minecart', 0.5, 0, 0.5);
    ok(blockOf(f.displayBlockState) === 'furnace' && f.displayOffset === 6, 'furnace cart displays a furnace at offset 6');
    f.fuel = 5; tick(f);
    ok(f.cartLit === true && B.propName(f.displayBlockState, 'lit') === 'true', 'a lit furnace cart displays lit=true');
    ok(blockOf(mk('chest_minecart', 0, 0, 0).displayBlockState) === 'chest' && mk('chest_minecart', 0, 0, 0).displayOffset === 8, 'chest cart: chest, offset 8');
    ok(mk('hopper_minecart', 0, 0, 0).displayOffset === 1, 'hopper cart offset 1');
    ok(mk('minecart', 0, 0, 0).displayBlockState === 0, 'plain minecart displays nothing');
    function blockOf(st) { return st ? R.names[S.block[st]] : null; }
  }
  ok(Mc.entityDataRequiresOperator('spawner_minecart') && Mc.entityDataRequiresOperator('command_block_minecart') && !Mc.entityDataRequiresOperator('minecart') && !Mc.entityDataRequiresOperator('chest_minecart'), 'entityDataRequiresOperator: spawner + command block carts only');
  {
    // SpawnerMinecartEntity.tick runs the spawner logic: 900 ticks -> tickSpawner every tick on the cart's block cell
    const calls = []; let spawned = 0;
    M.Spawn = { tickSpawner(L) { calls.push([L.x, L.y, L.z, L.entity]); if (L.delay > 0) { L.delay--; return false; } spawned++; L.delay = 200; return true; } };
    const e = mk('spawner_minecart', 3.5, 0.0625, 4.5);
    e.spawnerLogic.entity = 'zombie';
    for (let t = 0; t < 900; t++) tick(e);
    ok(calls.length === 900 && calls[0].join() === '3,0,4,zombie', 'spawner cart ticks its MobSpawnerLogic every tick at its block cell');
    ok(spawned >= 3, 'spawner cart with zombie SpawnData spawns within 900 ticks');
    {
      // logic runs AFTER the move: a cart crossing x=4 in one tick reports the post-move block
      calls.length = 0;
      const c = mk('spawner_minecart', 3.99, 0.0625, 4.5); c.vx = 0.3; tick(c);
      ok(calls.length === 1 && calls[0][0] === Math.floor(c.x) && Math.floor(c.x) === 4, 'spawner cart logic runs at the post-move block pos');
    }
    ok(mk('minecart', 0, 0, 0).spawnerLogic === undefined, 'a plain cart has no spawner logic');
    delete M.Spawn;
  }
  {
    // CommandBlockMinecartEntity read/writeCustomDataToNbt -> CommandBlockExecutor.readNbt/writeNbt
    const e = mk('command_block_minecart', 0, 0, 0);
    Mc.readNbt(e, { Command: 'say hi', SuccessCount: 3, TrackOutput: 1, LastOutput: '"hi"' });
    const o = Mc.writeNbt(e);
    ok(o.Command === 'say hi' && o.SuccessCount === 3 && o.TrackOutput === true && o.LastOutput === '"hi"', 'command cart NBT round-trips Command/SuccessCount/TrackOutput/LastOutput');
    Mc.readNbt(e, { Command: 'x', TrackOutput: 0, LastOutput: '"y"' });
    ok(e.lastOutput === null && Mc.writeNbt(e).LastOutput === undefined && Mc.writeNbt(e).TrackOutput === false, 'TrackOutput false drops LastOutput');
    ok(Mc.writeNbt(mk('minecart', 0, 0, 0)).Command === undefined, 'plain cart writes no Command');
  }
  // 8. StorageMinecartEntity.interact: chest cart opens its screen, emits container_open, angers piglins; canPlayerUse 8 blocks
  {
    const opened = [], events = [], angered = [];
    M.Hud = { openCartChest: (c) => { opened.push(c); return true; } };
    M.GameEvents = { emit: (ev) => events.push(ev) };
    M.Piglin = { ready: true, onGuardedBlockInteracted: (p, los) => angered.push(los) };
    const cc = mk('chest_minecart', 0, 0, 0), pl = { x: 0, y: 0, z: 0 };
    ok(Mc.storageInteract(cc, pl) === true && opened[0] === cc, 'chest cart interact opens the screen');
    ok(events.join() === 'container_open', 'chest cart interact emits container_open');
    ok(angered.length === 1 && angered[0] === true, 'chest cart interact calls onGuardedBlockInteracted(player, true)');
    ok(Mc.storageInteract(mk('minecart', 0, 0, 0), pl) === false && opened.length === 1, 'a plain cart opens nothing');
    ok(Mc.cartTitle(cc) === 'Minecart with Chest' && Mc.cartTitle(mk('hopper_minecart', 0, 0, 0)) === 'Minecart with Hopper', 'cart screen title is the entity name, not Chest');
    { const nc = mk('chest_minecart', 0, 0, 0); nc.cartName = 'Bob'; ok(Mc.cartTitle(nc) === 'Bob', 'named cart: screen title is the custom name'); }
    ok(Mc.canPlayerUse(cc, { x: 7.9, y: 0, z: 0 }) && !Mc.canPlayerUse(cc, { x: 8.1, y: 0, z: 0 }), 'canPlayerUse: within 8 blocks only');
    {   // loot cart: spectator gets nothing and keeps the table; otherwise the stacks are rolled before the screen copies them
      const lc = mk('chest_minecart', 0, 0, 0); lc.lootTable = 'minecraft:chests/abandoned_mineshaft';
      M.Gamemode = { isSpectator: () => true };
      ok(Mc.storageInteract(lc, pl) === false && lc.lootTable, 'spectator + lootTable -> no screen, table kept');
      M.Gamemode = { isSpectator: () => false };
      M.Loot = { rng: () => ({ nextInt: () => 0 }), rollTable: () => [{ item: 'gold_ingot', count: 2 }] };
      let seen = -1; M.Hud = { openCartChest: (c) => { seen = c.inventory.filter((s) => s && s.count > 0).length; return true; } };
      ok(Mc.storageInteract(lc, pl) === true && !lc.lootTable && seen > 0, 'loot cart is rolled before the screen opens');
      M.Gamemode = undefined; M.Loot = undefined;
    }
    {   // hopper cart: HopperScreenHandler via Hud.openCartHopper, same event + piglin anger
      const hop = [], ev0 = events.length;
      M.Hud = { openCartChest: () => false, openCartHopper: (c) => { hop.push(c); return true; } };
      const hc = mk('hopper_minecart', 0, 0, 0);
      ok(Mc.storageInteract(hc, pl) === true && hop[0] === hc, 'hopper cart interact opens the hopper screen');
      ok(events.length === ev0 + 1 && events[ev0] === 'container_open', 'hopper cart interact emits container_open');
    }
    cc.removed = true;
    ok(!Mc.canPlayerUse(cc, pl), 'canPlayerUse false for a removed cart');
  }
  {   // #4902: CustomDisplayTile/DisplayState/DisplayOffset round-trip (AbstractMinecartEntity.read/writeCustomDataToNbt)
    const dia = S.stateOf('diamond_block');
    const c1 = mk('minecart', 0, 0, 0); Mc.readNbt(c1, { CustomDisplayTile: 1, DisplayState: { Name: 'minecraft:diamond_block' }, DisplayOffset: 8 });
    ok(c1.displayBlockState === dia && c1.displayOffset === 8, 'CustomDisplayTile read: diamond block at offset 8');
    const o1 = Mc.writeNbt(c1);
    ok(o1.CustomDisplayTile === true && o1.DisplayState.Name === 'minecraft:diamond_block' && o1.DisplayOffset === 8, 'CustomDisplayTile written back');
    const st = S.stateOf('oak_stairs'), nb = Mc.stateToNbt(st);
    ok(nb.Name === 'minecraft:oak_stairs' && nb.Properties && nb.Properties.facing === 'north' && S.stateOf('oak_stairs') === Mc.stateFromNbt(nb), 'DisplayState with Properties round-trips');
    const nb2 = { Name: 'minecraft:oak_stairs', Properties: { facing: 'east', half: 'top' } };
    ok(JSON.stringify(Mc.stateToNbt(Mc.stateFromNbt(nb2)).Properties) === JSON.stringify({ facing: 'east', half: 'top', shape: 'straight', waterlogged: 'false' }), 'non-default properties survive');
    ok(Mc.writeNbt(mk('minecart', 0, 0, 0)).CustomDisplayTile === undefined, 'plain cart writes no display tags');
  }
  return { fails, n };
}

// ── run the real engine ──────────────────────────────────────────────────────────────────
const real = scenarios();
let breaks = 0;
const fails = real.fails.slice();

// ── anti-vacuity: edit the real source text; the same scenarios must now fail ───────────────
const breaksList = [
  ['velocity multiplier dropped', 'if (m !== 1) { e.vx *= m; e.vz *= m; }', ''],
  ['flaming arrow skipped when invulnerable', "if (e.type === 'tnt_minecart' && src.flamingArrowSpeed2 !== undefined) Mc.explode", "if (e.type === 'tnt_minecart' && !src.invulnerable && src.flamingArrowSpeed2 !== undefined) Mc.explode"],
  ['lava damage dropped', 'Mc.damage(e, 4, { fire: true });', ''],
  ['scatter dropped from discard', 'var out = scatter(e);', 'var out = [];'],
  ['boost 0.06 -> 0.07', 'e.vx += e.vx / h3 * 0.06; e.vz += e.vz / h3 * 0.06;', 'e.vx += e.vx / h3 * 0.07; e.vz += e.vz / h3 * 0.07;'],
  ['slowdown 0.96 -> 0.97', 'Mc.SLOWDOWN = 0.96;', 'Mc.SLOWDOWN = 0.97;'],
  ['storage slowdown base 0.98 -> 0.96', ': Math.fround(0.98 + (15', ': Math.fround(0.96 + (15'],
  ['gravity -0.04 -> -0.05', 'e.vy += touchingWater(e) ? -0.005 : -0.04;', 'e.vy += touchingWater(e) ? -0.005 : -0.05;'],
  ['wobble break limit 40 -> 400', 'e.cartWobbleStrength > 40.0', 'e.cartWobbleStrength > 400.0'],
  ['ascending_east table row swapped', '[[-1, -1, 0], [1, 0, 0]],    // ascending_east', '[[1, 0, 0], [-1, -1, 0]],    // ascending_east'],
  ['rider nudge dropped', 'e.vx += pvx * 0.1; e.vz += pvz * 0.1; brake = false;', ''],
  ['unpowered brake x0.5 -> x0.9', 'e.vx *= 0.5; e.vy *= 0.0; e.vz *= 0.5;', 'e.vx *= 0.9; e.vy *= 0.0; e.vz *= 0.9;'],
  ['slope energy term removed', 'var dy = (snap0.y - snap1.y) * 0.05;', 'var dy = 0;'],
  ['off-rail airborne drag 0.95 -> 1', 'if (!e.onGround) { e.vx *= 0.95; e.vy *= 0.95; e.vz *= 0.95; }', 'if (!e.onGround) { e.vx *= 1; e.vy *= 1; e.vz *= 1; }'],
  ['tnt fuse 80 -> 60', 'e.cartFuse = 80;', 'e.cartFuse = 60;'],
  ['furnace smoke 1-in-4 -> never', '(rnd()() * 4 | 0) === 0', '(rnd()() * 4 | 0) === 9'],
  ['coal fuel 3600 -> 3000', 'e.fuel += 3600;', 'e.fuel += 3000;'],
  ['furnace max speed 4/20 -> 8/20', '(w ? 3.0 : 4.0) / 20.0 :', '(w ? 3.0 : 8.0) / 20.0 :'],
  ['wall push-off from rest removed', 'if (willHitBlockAt(bx - 1, by, bz)) vx = 0.02;', 'if (false) vx = 0.02;'],
  ['instabuild hit still drops', 'if (insta && !e.cartName) discard(e);', 'if (false) discard(e);'],
  ['rideable pickup removed', "|| o.type === 'bat')) continue;", "|| o.type === 'bat' || true) continue;"],
  ['golem not excluded from pickup', "(o.type === 'iron_golem' || o.type === 'player'", "(o.type === 'player'"],
  ['hopper cart canOperate stubbed', 'Mc.canOperate = function (e) {', 'Mc.canOperate = function (e) { return false;'],
  ['entity inventory source removed', 'if (o === e || o.removed ||', 'if (true ||'],
  ['hopper cart own-box fallback removed', 'if (it2.y + (it2.height || 0.25) < e.y || it2.y > e.y + 0.7) continue;', 'continue;'],
  ['spawner cart tick removed', 'if (NS.Spawn && NS.Spawn.tickSpawner) NS.Spawn.tickSpawner(L);', ''],
  ['primed rail spare removed', 'var keep = primed ?', 'var keep = false ?'],
  ['primed rail resistance removed', 'nearRail(st, x, y, z) ? 0 : r', 'r'],
  ['command cart Command not written', 'o.Command = e.command;', ''],
  ['command cart LastOutput ignores TrackOutput', 'e.lastOutput = typeof n.LastOutput === \'string\' && e.trackOutput ?', 'e.lastOutput = typeof n.LastOutput === \'string\' ?'],
  ['command block cart not operator-only', "|| type === 'command_block_minecart'; };", '; };'],
  ['storage cart piglin anger removed', 'if (src.player && NS.Piglin', 'if (false && NS.Piglin'],
  ['loot table not written', 'o.LootTable = e.lootTable;', ''],
  ['Items not read back', 'e.inventory[sl] = {', 'void {'],
  ['loot cart slowdown uses comparator', 'f = e.lootTable ? Math.fround(0.98) :', 'f ='],
  ['loot never generated on scatter', 'if (!inv) return out;\n    Mc.generateLoot(e, null);', 'if (!inv) return out;'],
  ['loot rolls every access', 'e.lootTable = null;\n    var seed', 'var seed'],
  ['chest cart interact skips piglins', 'NS.Piglin.onGuardedBlockInteracted(p, true);', ''],
  ['chest cart range 64 -> 100', 'dz * dz <= 64;', 'dz * dz <= 100;'],
  ['chest cart container_open not emitted', "emit('container_open', e.x", "emit('x', e.x"],
  ['cart screen not flushed before scatter', 'if (NS.Hud && NS.Hud.cartGone) NS.Hud.cartGone(e);', ''],
  ['scatter gaussian back to Box-Muller', 'NS.U.polarGaussian(rnd) * 0.05', 'Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()) * 0.05'],
  ['scatter not chunked', 'Math.min(left, Math.floor(rnd() * 21) + 10)', 'left'],
  ['dismount scan skips the first side', 'var d = Mc.movementDirection(e), f = DIRV[d], s = DIRV[CW[d]];', 'var d = Mc.movementDirection(e), f = DIRV[d], s = [-DIRV[CW[d]][0], -DIRV[CW[d]][1]];'],
  ['sneaking player still mounts', "p.crouching || hasPassengers(e)", "hasPassengers(e)"],
  ['interact seats nobody', 'e.cartPassengers = [p]; e.rider = p;', ''],
  ['activator rail leaves the rider', 'if (hasPassengers(e)) removeAllPassengers(e);', ''],
  ['damage leaves the rider', 'removeAllPassengers(e);\n      if (insta', 'if (insta'],
  ['push uses ticking cart yaw (swapped args)', 'Mc.pushAwayFrom(o, e);', 'Mc.pushAwayFrom(e, o);'],
  ['display tile not read', 'if (n.CustomDisplayTile) {', 'if (false) {'],
  ['display tile not written', 'o.CustomDisplayTile = true;', ''],
  ['display properties not applied', 'st += (j - cur) * R.propStride[k];', ''],
  ['furnace drop removed', "dropStack(e, 'furnace'); out.push('furnace');", "out.push('furnace');"],
  ['cart title ignores custom name', 'if (e.cartName) return String(e.cartName);', ''],
  ['cart title back to Chest', "'Minecart with Chest';\n  };", "'Chest';\n  };"],
];
for (const [label, a, b] of breaksList) {
  let matched = true;
  const patch = (f, src) => {
    if (f !== '07zzr_minecart.js') return src;
    if (!src.includes(a)) matched = false;
    return src.split(a).join(b);
  };
  let r;
  try { r = scenarios(patch); } catch (err) { r = { fails: ['threw: ' + err.message] }; }
  if (!matched) { fails.push('anti-vacuity: the edit for "' + label + '" matched nothing in the source'); continue; }
  if (r.fails.length > 0) { breaks++; console.log('   ✓ break caught: ' + label + ' (' + r.fails.length + ' assertions notice)'); }
  else fails.push('anti-vacuity: breaking "' + label + '" went unnoticed');
}

// 8. #4837: right-click on a furnace cart goes through Use.entityUse (not Mc.furnaceInteract directly).
function useScenario(patch) {
  const f = []; const A = join(MCLITE_ROOT, 'assets');
  const rdj = (x) => JSON.parse(readFileSync(join(A, x), 'utf8'));
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js',
    '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
    '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
    '07zw_mobnbt.js', '07f_redstone.js', '07zzq_rail.js', '07zzr_minecart.js'], dom: false, patch });
  M.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
  M.World.init(1); M.Behave.init(M.World);
  if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
  M.EntityList.init(); M.Use.init(M.World);
  M.Breed.init();
  const Iv = M.Inventory;
  for (const insta of [false, true]) {
    const P = { inventory: Iv.create(), slot: 0, instabuild: insta, x: -1.5, y: 0, z: 0.5, ey: 1.62, EYE: 1.62, lookVec: () => [1, 0, 0], syncHotbar() {} };
    Iv.setItem(P.inventory, 0, Iv.stack('coal', 2, 0, null));
    const cart = { type: 'furnace_minecart', x: 0.5, y: 0, z: 0.5, fuel: 0 };
    const st = Iv.getItem(P.inventory, 0);
    const r = M.Use.entityUse(P, cart, st);
    if (!(r === true && cart.fuel === 3600 && st.n === (insta ? 2 : 1))) f.push('entityUse on furnace cart: r=' + r + ' fuel=' + cart.fuel + ' n=' + st.n + ' insta=' + insta);
  }
  return f;
}
{
  const f0 = useScenario();
  f0.forEach((m) => fails.push(m));
  const bf = useScenario((file, src) => file === '14l_use.js' ? src.replace("e.type === 'furnace_minecart' &&", "false &&") : src);
  if (bf.length) { breaks++; console.log('   ✓ break caught: furnace cart dispatch removed from Use.entityUse'); }
  else fails.push('anti-vacuity: removing the furnace_minecart dispatch went unnoticed');
}

if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log(`minecartcheck: ${real.n} assertions, 0 failures, ${breaks} breaks caught`);
