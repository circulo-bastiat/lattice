// sculkvibe lockstep check -- #6784 (G17-L139): lockstep scenario 'sculkvibe'.
// A sculk sensor in a flat arena hears step / projectile_land / block_place / projectile_shoot / item-drop-class events at
// ranges 1-9, sneaking sources and wool-occluded sources are ignored. Per tick the engine (GameEvent.emit -> Sculk.emit/tick,
// Behave.tick) is compared with an independently stepped reference of SculkSensorBlock / SculkSensorBlockEntity /
// VibrationListener (.decomp): range 8, arrival delay floor(distance), ACTIVE 40 ticks then COOLDOWN 1 tick,
// frequency table, power max(1, 15 - floor(distance/range*15)), comparator = frequency while active.
import { loadEngine } from '../loadsrc.mjs';
import { compareTraces, serverRow, engineRow } from './lockstep/trace.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14f_inventory.js', '07f_redstone.js', '07zx_particle.js', '07zzu_sculk.js', '07zzw_gameevent.js'], dom: false });
const R = M.Reg, B = M.Behave, Rs = M.Redstone, Sc = M.Sculk;
const N = 40, MID = 20, cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const world = { getBlock: (x, y, z) => cells[idx(x, y, z)], setBlock(x, y, z, id) { const o = cells[idx(x, y, z)]; cells[idx(x, y, z)] = id; B.changed(x, y, z, o); return true; }, blockLightAt: () => 15 };
M.World = world; M.Sound = { play() {} };
B.init(world); Rs.init();
const def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
// reference tables, written out from SculkSensorBlock.FREQUENCIES (only the events the scenario uses)
const FREQ = { step: 1, projectile_shoot: 7, projectile_land: 8, block_place: 12, hit_ground: 5, entity_damaged: 8 };
const K = { range: 8, active: 40 };
const NAMES = Object.keys(FREQ);
function lane(salt) {
  cells.fill(0); Sc.reset();
  const r = stream(salt);
  world.setBlock(0, 0, 0, def('sculk_sensor'));
  // script: events at distinct ticks, ranges 1-9 along a random direction
  const ev = [], TICKS = 130;
  let t = 2;
  for (let i = 0; i < 6; i++) {
    const name = NAMES[Math.floor(r() * NAMES.length)], d = 1 + Math.floor(r() * 9);
    const ax = Math.floor(r() * 3), sg = r() < 0.5 ? -1 : 1, off = Math.floor(r() * 2);
    const p = [0, 0, 0]; p[ax] = sg * d; p[(ax + 1) % 3] = off && d > 1 ? 1 : 0;
    const sneak = r() < 0.2, wool = r() < 0.2 && d >= 3;
    ev.push({ t, name, p, sneak, wool }); t += 1 + Math.floor(r() * 30);
  }
  const ref = { ph: 'inactive', left: 0, pow: 0, freq: 0, pend: null };
  const Rr = [], E = [];
  const set = () => { for (const e of ev) if (e.wool) { const w = e.p.map((c) => Math.trunc(c / 2)); e.w = w; } };
  set();
  for (let tick = 0; tick < TICKS; tick++) {
    for (const e of ev) if (e.t === tick) {
      if (e.wool) world.setBlock(e.w[0], e.w[1], e.w[2], def('white_wool'));
      M.GameEvent.emit(e.name, e.p[0], e.p[1], e.p[2], { sneaking: e.sneak });
      // reference listener
      const dist = Math.floor(Math.hypot(e.p[0], e.p[1], e.p[2]));
      const quiet = e.sneak && (e.name === 'step' || e.name === 'hit_ground');
      if (!quiet && !e.wool && Math.hypot(e.p[0], e.p[1], e.p[2]) <= K.range && ref.ph === 'inactive' && !ref.pend)
        ref.pend = { f: FREQ[e.name], dist, left: dist };
    }
    B.tick(); Sc.tick && 0;
    // reference step: block tick (phase timers) then listener arrival
    if (ref.left > 0 && --ref.left === 0) { if (ref.ph === 'active') { ref.ph = 'cooldown'; ref.left = 1; ref.pow = 0; } else ref.ph = 'inactive'; }
    if (ref.pend && --ref.pend.left <= 0) {
      if (ref.ph === 'inactive') { ref.freq = ref.pend.f; ref.ph = 'active'; ref.left = K.active; ref.pow = Math.max(1, 15 - Math.floor(ref.pend.dist / K.range * 15)); }
      ref.pend = null;
    }
    const st = world.getBlock(0, 0, 0);
    const ph = B.propName(st, 'sculk_sensor_phase'), pw = Rs.signal(st, Rs.EAST, 0, 0, 0) | 0, cmp = Rs.analogOutput(0, 0, 0, st) | 0;
    const phn = { inactive: 0, active: 1, cooldown: 2 };
    Rr.push(serverRow(tick, { Health: phn[ref.ph], HurtTime: ref.ph === 'active' ? ref.pow : 0, Motion: [ref.ph === 'active' ? ref.freq : 0, 0, 0] }));
    E.push(engineRow(tick, { health: phn[ph], hurtTime: ph === 'active' ? pw : 0, vx: cmp, vy: 0, vz: 0 }));
  }
  return { d: compareTraces(Rr, E, { fields: ['health', 'hurtTime', 'vel'], tol: 1e-9 }), act: Rr.some((x) => x.Health === 1 || (x.health === 1)) };
}
let act = 0;
const rs = Array.from({ length: 20 }, (_, i) => lane(i));
for (const [i, x] of rs.entries()) { ok(!x.d, `salt ${i} diverges ${x.d ? JSON.stringify(x.d) : ''}`); if (x.act) act++; }
ok(act >= 15, 'sensor actually activated in ' + act + '/20 salts');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const any = () => Array.from({ length: 20 }, (_, i) => lane(i)).some((x) => x.d);
Sc.RANGE = 7; brk(any(), 'engine range 8 -> 7 caught'); Sc.RANGE = 8;
K.active = 39; brk(any(), 'reference active 40 -> 39 caught'); K.active = 40;
Sc.FREQUENCIES.projectile_land = 9; brk(any(), 'frequency projectile_land 8 -> 9 caught'); Sc.FREQUENCIES.projectile_land = 8;
const occ = M.GameEvent.occluded; M.GameEvent.occluded = () => false; brk(any(), 'wool occlusion ignored caught'); M.GameEvent.occluded = occ;
const q = M.GameEvent.QUIET_WHEN_SNEAKING; M.GameEvent.QUIET_WHEN_SNEAKING = {}; brk(any(), 'sneaking not quiet caught'); M.GameEvent.QUIET_WHEN_SNEAKING = q;
ok(!any(), 'restored engine matches again');
console.log(`sculkvibelockstepcheck: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
