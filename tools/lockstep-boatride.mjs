#!/usr/bin/env node
// lockstep-boatride.mjs -- #6332 (G17-L72): lockstep scenario 'boatride': a boat with a scripted rider (forward / left / right) for 200 ticks on
// water, on packed ice and run aground on stone, then a 5-block fall; plus a grounded boat holding 5 blocks of fall distance. 20 seeds.
// Per tick: pos, velocity, yaw, location, rider pos, fall damage / break -- engine (07zzt_boat.js) vs an independent transcription of
// .decomp BoatEntity.tick / checkLocation / updateVelocity / updatePaddles / fall / updatePassengerPosition (flat world, no collisions but the floor).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const F = Math.fround, DEG = F(0.017453292), SEEDS = 20, TICKS = 200, H = 0.5625;
const rng = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
// scripted input: idle 10 ticks, then runs of forward / left / right chosen by the seed
function script(seed) {
  const r = rng(seed * 104729 + 17), out = [];
  while (out.length < TICKS) { const n = 5 + Math.floor(r() * 25), k = r(); const inp = out.length < 10 ? [0, 0, 0] : k < 0.5 ? [1, 0, 0] : k < 0.7 ? [1, 1, 0] : k < 0.9 ? [1, 0, 1] : [0, 1, 0]; for (let i = 0; i < n; i++) out.push(inp); }
  return out.slice(0, TICKS);
}
const SURF = { water: { floor: -1, y0: -0.3, slip: 0 }, ice: { floor: 0, y0: 0, slip: F(0.98) }, land: { floor: 0, y0: 0, slip: F(0.6) },
               fall: { floor: 0, y0: 5, slip: F(0.6) }, aground: { floor: 0, y0: 0, slip: F(0.6), fd: 5 } };
const SURFACES = Object.keys(SURF);

function oracle(kind, inputs, o = {}) {
  const S = SURF[kind], water = kind === 'water', A = o.paddle || 0.04;
  const b = { x: 0.5, y: S.y0, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, yv: 0, loc: null, last: null, wl: 0, slip: 0.75, fd: S.fd || 0, fv: 0, ground: false, broke: false, dmg: 0 };
  const wh = (y) => (water && y === -1 ? 8 / 9 : 0);
  const rows = []; let rp = { x: 0, y: 0, z: 0 };
  for (let t = 0; t < inputs.length; t++) {
    const [f, l, r] = inputs[t];
    if (b.broke) { rows.push(rows[rows.length - 1]); continue; }   // a removed boat is no longer ticked
    b.last = b.loc;
    const top = b.y + H;
    // checkLocation
    if (water && top + 0.001 < -1 + 8 / 9) { b.loc = 'under_water'; b.wl = top; }
    else if (water && b.y < -1 + 8 / 9) { b.loc = 'in_water'; b.wl = -1 + 8 / 9; }
    else if (b.y - 0.001 < S.floor + (water ? 0 : 0) && !water) { b.loc = 'on_land'; b.slip = S.slip; }
    else b.loc = 'in_air';
    if (b.loc === 'in_water' || b.loc === 'under_water') b.fd = 0;
    // updateVelocity
    let decay = 0.05, grav = -0.04, buoy = 0, skip = false;
    if (b.last === 'in_air' && b.loc !== 'in_air' && b.loc !== 'on_land') {
      b.wl = b.y + H;
      const tp = b.y + H; let y = Math.floor(tp), y1 = Math.ceil(tp - b.fv), res = y1 + 1;
      for (; y < y1; y++) if (wh(y) < 1) { res = y + wh(y); break; }
      b.y = res - H + 0.101; b.vy = 0; b.fv = 0; b.loc = 'in_water'; skip = true;
    } else if (b.loc === 'in_water') { buoy = (b.wl - b.y) / H; decay = 0.9; }
    else if (b.loc === 'under_water') { buoy = F(0.01); decay = 0.45; }
    else if (b.loc === 'in_air') decay = 0.9;
    else decay = b.slip;
    if (!skip) { b.vx *= decay; b.vy += grav; b.vz *= decay; if (buoy > 0) b.vy = (b.vy + buoy * 0.06153846016296973) * 0.75; }
    b.yv = F(b.yv * F(decay));
    // updatePaddles
    let a = 0;
    if (l) b.yv = F(b.yv - 1);
    if (r) b.yv = F(b.yv + 1);
    if (r !== l && !f) a = F(a + F(0.005));
    b.yaw = F(b.yaw + b.yv);
    if (f) a = F(a + F(A));
    b.vx += F(Math.sin(F(F(-b.yaw) * DEG))) * a; b.vz += F(Math.cos(F(F(b.yaw) * DEG))) * a;
    // move
    const y0 = b.y; b.x += b.vx; b.z += b.vz; b.y += b.vy; b.ground = false;
    if (b.y <= S.floor + (water ? 0 : 0) && b.vy < 0) { b.y = S.floor; b.vy = 0; b.ground = true; }
    // fall
    b.fv = b.vy; const dy = b.y - y0;
    if (b.ground) {
      if (b.fd > 3) {
        if (b.loc !== 'on_land') b.fd = 0;
        else { b.broke = true; b.dmg = Math.ceil(b.fd - 3); b.fd = 0; }
      } else b.fd = 0;
    } else if (!(water && Math.floor(b.y) - 1 === -1) && dy < 0) b.fd -= dy;
    if (b.loc === 'in_water' || b.loc === 'under_water') b.fd = 0;   // updateWaterState runs before move; the engine zeroes there too
    // a boat that broke this tick has already ejected its rider (Entity.setRemoved), so the rider keeps its last seat position
    if (!b.broke) rp = { x: b.x, y: b.y - 0.1, z: b.z };
    rows.push({ x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, yaw: b.yaw, loc: b.loc, rx: rp.x, ry: rp.y, rz: rp.z, dmg: b.dmg, broke: b.broke });
  }
  return rows;
}

const LOADED = new Map();   // one engine per patch; the world below reads the surface being run from `cur`
let cur = SURF.water, curWater = true;
function boot(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '07zzt_boat.js'], dom: false, patch });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  const St = M.States, B = M.Behave, EL = M.EntityList, R = M.Reg, Ph = M.Physics;
  const PHYS = rdj('block-physics.json'); R.buildPhysics({ defaults: PHYS.defaults, exceptions: PHYS.exceptions });
  Ph.shapeAt = (x, y, z) => { const id = M.World.getBlock(x, y, z); return id === 0 || St.solid[id] !== 1 ? null : Ph.shapesFor(id); };
  let FS = 0, WS = 0, ICE = 0;   // an infinite flat world: floor slab, plus a water sheet in the 'water' surface
  M.World = { getBlock: (x, y, z) => (y === cur.floor - 1 ? (cur.ice ? ICE : FS) : curWater && y === -1 ? WS : 0), setBlock() { return true; }, blockLightAt: () => 15 };
  B.init(M.World); M.Entities.init(); EL.init();
  FS = St.stateOf('stone') | 0; ICE = St.stateOf('packed_ice') | 0; WS = B.setProp(St.stateOf('water') | 0, 'level', 0);
  return M;
}
function engine(kind, inputs, patch) {
  cur = SURF[kind]; curWater = kind === 'water'; cur.ice = kind === 'ice';
  const S = cur;
  if (!LOADED.has(patch)) LOADED.set(patch, boot(patch));
  const M = LOADED.get(patch), EL = M.EntityList, Bt = M.Boat;
  EL.list.length = 0;
  const rider = { isPlayer: true, type: 'player', x: 0, y: 0, z: 0, yawDeg: 0 };
  const e = EL.spawn('boat', 0.5, S.y0, 0.5, { boatType: 'oak' });
  Bt.interact(e, rider); e.fallDistance = S.fd || 0;
  const rows = [];
  for (let t = 0; t < inputs.length; t++) {
    const [f, l, r] = inputs[t];
    Bt.setInputs(e, l, r, f, 0);
    EL.tickOne(e);
    rows.push({ x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, yaw: e.yawDeg, loc: e.location, rx: rider.x, ry: rider.y, rz: rider.z, dmg: rider.fallDamageTaken | 0, broke: !!e.fallBroke });
  }
  return rows;
}
const TOL = 1e-6;
function diff(a, b) {
  for (let t = 0; t < a.length; t++) for (const k of Object.keys(a[t])) {
    const u = a[t][k], v = b[t][k];
    if (typeof u === 'number' ? !(Math.abs(u - v) <= (k === 'y' || k === 'ry' ? 2e-5 : TOL)) : u !== v) return `tick ${t} ${k}: engine ${u} oracle ${v}`;
  }
  return null;
}
function run(o = {}) {
  let bad = 0, first = '';
  for (let seed = 1; seed <= SEEDS; seed++) for (const kind of SURFACES) {
    const inp = script(seed), d = diff(engine(kind, inp, o.patch), oracle(kind, inp, o));
    if (d) { bad++; if (!first) first = `seed ${seed} ${kind} ${d}`; }
  }
  return { bad, first };
}
let fails = 0, breaks = 0; const notes = [];
const base = run();
if (base.bad) { fails++; console.log(`  FAIL ${base.bad} divergences; first: ${base.first}`); }
// anti-vacuity: the scenario must exercise every branch
const cover = (kind, f) => oracle(kind, script(1)).some(f);
const need = [['water rides in_water', cover('water', (r) => r.loc === 'in_water')], ['ice glides', cover('ice', (r) => Math.hypot(r.vx, r.vz) > 0.15)],
  ['land is on_land', cover('land', (r) => r.loc === 'on_land')], ['fall ends on_land', cover('fall', (r) => r.loc === 'on_land')], ['aground breaks with 2 damage', cover('aground', (r) => r.broke && r.dmg === 2)]];
for (const [n, c] of need) if (!c) { fails++; console.log('  FAIL vacuous: ' + n); }
// the 0.04 -> 0.05 fault is reported at the first tick the rider presses forward (every seed, every surface)
{
  let wrong = 0;
  for (let seed = 1; seed <= SEEDS; seed++) for (const kind of SURFACES) {
    if (kind === 'aground') continue;   // that boat breaks at tick 0, before any input: nothing left to disagree about
    const inp = script(seed), d = diff(engine(kind, inp), oracle(kind, inp, { paddle: 0.05 })), first = inp.findIndex((i) => i[0]);
    if (!d || +d.match(/^tick (\d+)/)[1] !== first) wrong++;
  }
  if (wrong) { fails++; console.log(`  FAIL forward fault not reported at the first input tick in ${wrong} runs`); }
}
const brk = [
  ['oracle: forward 0.04 -> 0.05', { paddle: 0.05 }],
  ['engine: forward 0.04 -> 0.05', { patch: (f, s) => f === '07zzt_boat.js' ? s.replace('F32(0.04)', 'F32(0.05)') : s }],
  ['engine: rider fall damage dropped', { patch: (f, s) => f === '07zzt_boat.js' ? s.replace('e.passengers[k].fallDamageTaken = NS.Physics.fallDamage(e.fallDistance, 1, 0);', '') : s }],
  ['engine: ice slipperiness lost', { patch: (f, s) => f === '07zzt_boat.js' ? s.replace('(R.friction[SR.block[st]] || 0.6)', '0.6') : s }],
  ['engine: water decay 0.9 -> 0.8', { patch: (f, s) => f === '07zzt_boat.js' ? s.replace('e.velocityDecay = 0.9; }\n    else if (L === Bt.UNDER_FLOWING', 'e.velocityDecay = 0.8; }\n    else if (L === Bt.UNDER_FLOWING') : s }],
];
for (const [name, o] of brk) {
  const d = run(o);
  if (d.bad) { breaks++; notes.push(`   ✓ ${name} caught: ${d.first}`); } else { fails++; console.log(`  FAIL ${name} not caught`); }
}
console.log(`${brk.length + 2 + need.length - fails} assertions, ${fails} failures, ${breaks} breaks caught (${SEEDS} seeds x ${SURFACES.length} surfaces x ${TICKS} ticks, ${base.bad} divergences)`);
notes.forEach((n) => console.log(n));
process.exit(fails ? 1 : 0);
