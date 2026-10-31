#!/usr/bin/env node
// lockstep-boatdamage.mjs -- #6856 (G17-L155): lockstep scenario 'boatdamage', 20 seeds. Engine = src/07zzt_boat.js through EntityList.tickOne;
// reference = an independent transcription of .decomp BoatEntity.damage / animate fields / fall / Entity.handleFallDamage / setRemoved.
// Lanes per seed: (1) a boat hit by a scripted player at several damage values (wobble ticks / side / strength, break tick, drops, creative hit);
// (2) a boat dropped from 4, 10 and 40 blocks onto land and onto water (fallDistance per tick, break, drops); (3) a resting boat with fallDistance
// > 3 on land (planks + sticks, handleFallDamage forwarded to the rider); (4) a boat with a rider broken by damage (rider thrown off).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const SEEDS = 20;
const rng = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const f32 = Math.fround;

const cache = new Map();
function mkEngine(patch) {
  const key = patch || null;
  if (!cache.has(key)) cache.set(key, buildEngine(patch));
  const g = cache.get(key); g.drops.length = 0; return g;
}
function buildEngine(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '07zzt_boat.js'], dom: false, patch });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  const S = M.States, N = 48, MID = 24, cells = new Uint16Array(N * N * N);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
  M.World = { getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0), setBlock(x, y, z, id) { if (!inside(x, y, z)) return false; cells[idx(x, y, z)] = id; return true; }, blockLightAt: () => 15 };
  const PHYS = rdj('block-physics.json');
  M.Reg.buildPhysics({ defaults: PHYS.defaults, exceptions: PHYS.exceptions });
  const Ph = M.Physics;
  Ph.shapeAt = (x, y, z) => { const id = M.World.getBlock(x, y, z); return id === 0 || S.solid[id] !== 1 ? null : Ph.shapesFor(id); };
  M.Behave.init(M.World); M.Entities.init(); M.EntityList.init();
  const drops = [];
  M.EntityList.dropStack = (x, y, z, item, n) => { drops.push(item); return null; };
  const world = (water) => {
    cells.fill(0); M.EntityList.list.length = 0;
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) {
      cells[idx(x, -1 - water, z)] = S.stateOf('stone');
      for (let d = 0; d < water; d++) cells[idx(x, -1 - d, z)] = M.Behave.setProp(S.stateOf('water'), 'level', 0);
    }
  };
  return { M, world, drops };
}

// ---- reference ------------------------------------------------------------------------------------------------------------------
class RefBoat {   // BoatEntity damage / wobble / fall / removal, field for field
  constructor(type) { this.type = type; this.side = 1; this.ticks = 0; this.str = 0; this.removed = false; this.drops = []; this.fallDistance = 0; this.rider = true; }
  damage(amount, creative, o = {}) {
    if (this.removed) return;
    this.side = -this.side; this.ticks = 10; this.str = f32(this.str + f32(amount * 10));
    if (creative || this.str > (o.limit ?? 40)) { if (!creative) this.drops.push(this.type + '_boat'); this.removed = true; this.rider = false; }
  }
  tickWobble() { if (this.ticks > 0) this.ticks--; if (this.str > 0) this.str = f32(this.str - 1); }
  // fall(dy, onGround, location, fluidBelow)
  fall(dy, onGround, loc, fluidBelow, hasVehicle, o = {}) {
    if (hasVehicle) return;
    if (onGround) {
      if (this.fallDistance > (o.fallLimit ?? 3)) {
        if (loc !== 'on_land') { this.fallDistance = 0; return; }
        this.removed = true; this.rider = false; this.fell = this.fallDistance;
        for (let i = 0; i < 3; i++) this.drops.push(this.type + '_planks'); this.drops.push('stick', 'stick');
      }
      this.fallDistance = 0;
    } else if (!fluidBelow && dy < 0) this.fallDistance = f32(this.fallDistance - dy);
  }
}
const row = (t, o) => `${t}:${o.wt}/${o.ws}/${o.wstr}/${o.fd.toFixed(5)}/${o.rm ? 1 : 0}/${o.rider}/${o.drops}`;

// ---- lanes ----------------------------------------------------------------------------------------------------------------------
function damageLane(seed, o = {}, patch) {
  const { M, world, drops } = mkEngine(patch), EL = M.EntityList, Bt = M.Boat; world(3);
  const r = rng(seed * 7919 + 11), types = Bt.TYPES, type = types[Math.floor(r() * 6)];
  const e = EL.spawn('boat', 0.5, 0.4, 0.5, { boatType: type }), R = new RefBoat(type);
  const rider = { type: 'player', isPlayer: true, vehicle: e }; e.passengers.push(rider);
  const hits = new Map(), VALS = [1, 2, 3, 4, 4.05, 5, 6, 8, 10, 40];   // 4 -> 40 strength: just not broken; 5 adds up
  for (let n = 1 + Math.floor(r() * 5), t = 2; n > 0; n--, t += 1 + Math.floor(r() * 6)) hits.set(t, { amt: VALS[Math.floor(r() * VALS.length)], creative: r() < 0.08 });
  const rows = [[], []];
  for (let t = 0; t < 60; t++) {
    const h = hits.get(t);
    if (h) {
      const br = e.removed ? 0 : 1;
      M.Boat.damage(e, o.engAmt ? o.engAmt(h.amt) : h.amt, { instabuild: h.creative });
      R.damage(h.amt, h.creative, o);
    }
    if (!e.removed) EL.tickOne(e);
    if (!R.removed) R.tickWobble();
    const riderE = rider.vehicle ? 'on' : 'off', riderR = R.rider ? 'on' : 'off';
    rows[0].push(row(t, { wt: e.wobbleTicks | 0, ws: e.wobbleSide || 1, wstr: e.wobbleStrength | 0, fd: 0, rm: e.removed, rider: riderE, drops: drops.join(',') }));
    rows[1].push(row(t, { wt: R.ticks, ws: R.side, wstr: R.str | 0, fd: 0, rm: R.removed, rider: riderR, drops: R.drops.join(',') }));
  }
  return rows;
}
function fallLane(seed, o = {}, patch) {
  const r = rng(seed * 104729 + 3), H = [4, 10, 40][seed % 3], onWater = (seed >> 1) % 2 === 1, withRider = seed % 5 === 0;
  const { M, world, drops } = mkEngine(patch), EL = M.EntityList, Bt = M.Boat, Ph = M.Physics; world(onWater ? 3 : 0);
  const e = EL.spawn('boat', 0.5 + (r() - 0.5) * 2, H, 0.5 + (r() - 0.5) * 2, { boatType: Bt.TYPES[seed % 6] }), R = new RefBoat(Bt.TYPES[seed % 6]);
  const rows = [[], []];
  for (let t = 0; t < 400 && !e.removed; t++) {
    const y0 = e.y; EL.tickOne(e);
    // the reference's own fall() runs on the engine's observed (dy, onGround, location); water resets from the location as Entity.baseTick does
    if (e.location === Bt.IN_WATER || e.location === Bt.UNDER_WATER || e.location === Bt.UNDER_FLOWING_WATER) R.fallDistance = 0;
    const below = M.States.fluidKind[Ph.blockAt(e.x, e.y - 1, e.z)] === 1;
    R.fall(e.y - y0, e.onGround, e.location, below, false, o);
    rows[0].push(row(t, { wt: 0, ws: 1, wstr: 0, fd: e.fallDistance, rm: e.removed, rider: '-', drops: drops.join(',') }));
    rows[1].push(row(t, { wt: 0, ws: 1, wstr: 0, fd: R.fallDistance, rm: R.removed, rider: '-', drops: R.drops.join(',') }));
  }
  if (!rows[0].length) { rows[0].push('none'); rows[1].push('none'); }
  return rows;
}
function restLane(seed, o = {}, patch) {
  const r = rng(seed * 31 + 9), fd = seed % 4 === 0 ? 3.1 + r() * 0.8 : 3.5 + r() * 40, rider = { type: 'zombie', vehicle: null, x: 0.5, y: 0, z: 0.5 };
  const { M, world, drops } = mkEngine(patch), EL = M.EntityList; world(0);
  const e = EL.spawn('boat', 0.5, 0, 0.5, { boatType: M.Boat.TYPES[seed % 6] }), R = new RefBoat(M.Boat.TYPES[seed % 6]);
  e.passengers.push(rider); rider.vehicle = e; e.passengers.length = 0; rider.vehicle = null;   // settle first, mount after
  for (let i = 0; i < 40; i++) EL.tickOne(e);
  const passenger = { type: 'zombie', x: e.x, y: e.y, z: e.z, vehicle: e, fallDistance: 0 }; e.passengers.push(passenger);
  e.fallDistance = fd; R.fallDistance = fd; const rows = [[], []];
  for (let t = 0; t < 3; t++) {
    EL.tickOne(e); R.fall(0, true, 'on_land', false, false, o);
    rows[0].push(row(t, { wt: 0, ws: 1, wstr: 0, fd: e.fallDistance, rm: e.removed, rider: (passenger.vehicle ? 'on' : 'off') + ':' + (passenger.landedFrom !== undefined ? passenger.landedFrom.toFixed(4) : '-'), drops: drops.join(',') }));
    rows[1].push(row(t, { wt: 0, ws: 1, wstr: 0, fd: R.fallDistance, rm: R.removed, rider: (R.rider ? 'on' : 'off') + ':' + (R.fell !== undefined ? f32(R.fell).toFixed(4) : '-'), drops: R.drops.join(',') }));
  }
  return rows;
}
const LANES = { damage: damageLane, fall: fallLane, rest: restLane };
function run(o = {}) {
  let bad = 0, first = '', rm = 0, drop = 0, fallBreak = 0;
  for (let seed = 1; seed <= SEEDS; seed++) for (const [name, fn] of Object.entries(LANES)) {
    const [a, b] = fn(seed, o, o.patch);
    if (name === 'damage' && a.some((x) => /\/1\/\w+\/.+_boat/.test(x))) drop++;
    if (a.some((x) => x.includes(':1/') || /\/1\/(on|off)/.test(x))) rm++;
    if (name === 'rest' && a.at(-1).includes('stick')) fallBreak++;
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { bad++; if (!first) first = `seed ${seed} ${name} tick ${i}: engine ${a[i]} ref ${b[i]}`; break; }
  }
  return { bad, first, drop, fallBreak };
}
let fails = 0, breaks = 0; const notes = [];
const base = run();
if (base.bad) { fails++; console.log(`  FAIL ${base.bad} divergences; first: ${base.first}`); }
if (base.drop < 5) { fails++; console.log(`  FAIL vacuous: only ${base.drop} damage lanes dropped a boat`); }
if (base.fallBreak < SEEDS) { fails++; console.log(`  FAIL vacuous: only ${base.fallBreak} resting breaks`); }
const brk = [
  ['reference: break threshold 39', { limit: 39 }],
  ['reference: break threshold 41', { limit: 41 }],
  ['reference: fall limit 4', { fallLimit: 4 }],
  ['engine: break threshold 39', { patch: (f, s) => f === '07zzt_boat.js' ? s.replace('e.wobbleStrength > 40', 'e.wobbleStrength > 39') : s }],
  ['engine: wobble strength x5', { patch: (f, s) => f === '07zzt_boat.js' ? s.replace('amount * 10', 'amount * 5') : s }],
  ['engine: passengers not thrown', { patch: (f, s) => f === '07zzt_boat.js' ? s.replace('e.passengers[i].vehicle = null;\n', '') : s }],
  ['engine: no planks', { patch: (f, s) => f === '07zzt_boat.js' ? s.replace("out.push(Bt.planks(e))", "out.push('oak_planks')") : s }],
];
for (const [name, o] of brk) {
  const d = run(o);
  if (d.bad) { breaks++; notes.push(`   ✓ ${name} caught: ${d.first}`); } else { fails++; console.log(`  FAIL ${name} not caught`); }
}
notes.forEach((n) => console.log(n));
console.log(`boatdamage: ${brk.length + 3 - fails} assertions, ${fails} failures, ${breaks} breaks caught (${SEEDS} seeds, ${base.bad} divergences)`);
process.exit(fails ? 1 : 0);
