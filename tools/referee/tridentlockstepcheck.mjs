// tridentlockstepcheck.mjs -- #6601 (G17-L76): lockstep scenario 'trident': a thrown trident (speed 2.5) at a cow dummy; 20 salts, three lanes.
// Reference = .decomp PersistentProjectileEntity.tick (segment vs target box + 0.3, pos += v, v *= 0.99, vy -= 0.05) + TridentEntity.onEntityHit
// (damage 8, dealtDamage, v *= (-0.01,-0.1,-0.01); dealtDamage trident no longer collides) + TridentEntity.tick (loyalty: y += dy*0.015*L,
// v = v*0.95 + normalize(eye - pos)*0.05*L, noClip; void y < -64 with loyalty -> noClip; owner dead -> drop as item + discard).
// Lanes: 'plain' (no loyalty: stays where it falls), 'loyalty' (I-III returns to the owner), 'void' (loyalty III thrown into the void). Per tick: pos, vel, target health, dealtDamage.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const M = loadEngine({ extra: ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '07b_behaviour.js', '09c_weather.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Entities.init(); M.EntityList.init(); M.Combat.init();
const { EntityList: EL, Combat: Cb, World: W, CH } = M;
M.Behave.init({ get: (x, y, z) => W.getBlock(x, y, z), set: (x, y, z, s) => W.setBlock(x, y, z, s), getLight: () => 240, getBlock: (x, y, z) => W.getBlock(x, y, z), setBlock: (x, y, z, s) => W.setBlock(x, y, z, s) });
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const TICKS = 60, f32 = Math.fround, EYE = Math.fround(1.62);
const DMG = { hit: 8, ret: 0.05, ydrift: 0.015 };   // injected faults edit these in the ENGINE copy only (see breaks)
const params = (salt, lane) => {
  const r = stream(salt), L = lane === 'plain' ? 0 : 1 + (salt % 3), y0 = lane === 'void' ? -60 : 80;
  const cow = { x: 8 + r() * 4, y: y0 - 1 + r(), z: (r() - 0.5) * 3 };
  const aim = [cow.x - 0.5, cow.y + 0.7 + (r() - 0.5) * 0.6 - y0, cow.z - 0.5];
  const len = Math.hypot(...aim), v = aim.map((c) => f32(c / len * 2.5));
  if (lane === 'void') { v[1] = f32(-1.2); v[0] = f32(0.4); v[2] = f32(0.1); cow.x = 400; }   // no hit: falls through y < -64
  return { L, y0, cow, v, deadAt: lane === 'dead' ? 25 : 1e9 };
};
// segment [p, p+d] vs box (slab method)
const segBox = (p, d, lo, hi) => { let a = 0, b = 1; for (let i = 0; i < 3; i++) { if (Math.abs(d[i]) < 1e-12) { if (p[i] < lo[i] || p[i] > hi[i]) return false; continue; } let t0 = (lo[i] - p[i]) / d[i], t1 = (hi[i] - p[i]) / d[i]; if (t0 > t1) [t0, t1] = [t1, t0]; a = Math.max(a, t0); b = Math.min(b, t1); if (a > b) return false; } return true; };
function reference(lane, p) {
  const rows = [], pos = [0.5, p.y0, 0.5], v = p.v.slice(), owner = [0.5, 80, 0.5];
  let dealt = false, noClip = false, hp = 10, rt = 0;
  const lo = [p.cow.x - 0.45 - 0.3, p.cow.y - 0.3, p.cow.z - 0.45 - 0.3], hi = [p.cow.x + 0.45 + 0.3, p.cow.y + 1.4 + 0.3, p.cow.z + 0.45 + 0.3];
  for (let t = 1; t <= TICKS; t++) {
    if (p.L > 0 && pos[1] < -64) noClip = true;
    if (p.L > 0 && (dealt || noClip)) {
      noClip = true;
      const d = [owner[0] - pos[0], owner[1] + EYE - pos[1], owner[2] - pos[2]], n = Math.hypot(...d);
      pos[1] += d[1] * 0.015 * p.L;
      for (let i = 0; i < 3; i++) v[i] = v[i] * 0.95 + d[i] / n * 0.05 * p.L;
      rt++;
    }
    if (noClip) { for (let i = 0; i < 3; i++) { pos[i] += v[i]; v[i] *= f32(0.99); } }
    else {
      if (!dealt && segBox(pos, v, lo, hi)) { hp -= 8; dealt = true; for (const [i, k] of [[0, -0.01], [1, -0.1], [2, -0.01]]) v[i] *= k; }
      for (let i = 0; i < 3; i++) { pos[i] += v[i]; v[i] *= f32(0.99); } v[1] -= f32(0.05);
    }
    rows.push({ tick: t, pos: pos.slice(), vel: v.slice(), hp, dealt });
  }
  return rows;
}
function engine(lane, p) {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  EL.clear(); M.Player = null;
  const owner = { type: 'player', x: 0.5, y: 80, z: 0.5, health: 20, width: 0.6, height: 1.8, eyeHeight: EYE };
  const cow = EL.spawn('cow', p.cow.x, p.cow.y, p.cow.z); cow.health = 10; cow.silent = true;
  const t = EL.spawn('trident', 0.5, p.y0, 0.5, { vx: p.v[0], vy: p.v[1], vz: p.v[2], shooter: owner });
  t.loyalty = p.L; t.pickupType = Cb.PICKUP_ALLOWED;
  const rows = [];
  for (let n = 1; n <= TICKS; n++) { Cb.tickTrident(t); rows.push({ tick: n, pos: [t.x, t.y, t.z], vel: [t.vx, t.vy, t.vz], hp: cow.health, dealt: !!t.dealtDamage }); }
  return rows;
}
const rd = (a) => a.map((x) => Math.round(x * 1e4) / 1e4);   // engine's loyalty pull differs from the double reference in the 11th digit
const norm = (rows) => rows.map((r) => ({ tick: r.tick, pos: rd(r.pos), vel: rd(r.vel), health: r.hp, goals: [[0, r.dealt ? 'dealt' : 'flying']] }));
const cmp = (a, b) => compareTraces(norm(a), norm(b), { fields: ['pos', 'vel', 'health', 'goals']});
const lane = (name, salt) => { const p = params(salt, name), R = reference(name, p), E = engine(name, p); return { R, d: cmp(R, E) }; };
for (const name of ['plain', 'loyalty', 'void']) {
  const res = salts.map((s) => ({ s, ...lane(name, s) }));
  ok(res.every((r) => !r.d), name + ' lane: ' + res.filter((r) => r.d).slice(0, 3).map((r) => `salt ${r.s} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`));
  if (name !== 'void') ok(res.every((r) => r.R.some((x) => x.hp === 2 && x.dealt)), name + ' reference: cow takes 8 damage, dealtDamage set');
  if (name === 'loyalty') ok(res.every((r) => Math.hypot(r.R[TICKS - 1].pos[0] - 0.5, r.R[TICKS - 1].pos[2] - 0.5) < 5), 'loyalty trident has come home');
  if (name === 'void') ok(res.every((r) => r.R[TICKS - 1].pos[1] > -64), 'void trident returned above -64');
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const anyDiff = (name) => salts.some((s) => lane(name, s).d);
const sv = { b: Cb.TRIDENT_BASE_DAMAGE, h: Cb.tridentHit };
Cb.TRIDENT_BASE_DAMAGE = 9; brk(anyDiff('plain'), 'damage 8 -> 9 is reported'); Cb.TRIDENT_BASE_DAMAGE = sv.b;
Cb.tridentHit = function (e, t) { const r = sv.h(e, t); e.dealtDamage = false; return r; };
brk(anyDiff('plain'), 'dealtDamage never set is reported'); Cb.tridentHit = sv.h;
const tt = Cb.tickTrident;
Cb.tickTrident = function (e) { if (e.dealtDamage && !e.lateFlag) { e.lateFlag = 1; e.dealtDamage = false; tt(e); e.dealtDamage = true; return; } tt(e); };
brk(anyDiff('loyalty'), 'loyalty return one tick late (dealtDamage flag wrong tick) is reported'); Cb.tickTrident = tt;
Cb.tickTrident = function (e) { const l = e.loyalty; if (l > 0 && (e.dealtDamage || e.noClip)) e.loyalty = l + 1; tt(e); e.loyalty = l; };
brk(anyDiff('loyalty'), 'loyalty return speed (level + 1) is reported'); Cb.tickTrident = tt;
const vy = Cb.TRIDENT_VOID_Y; Cb.TRIDENT_VOID_Y = -80; brk(anyDiff('void'), 'void return threshold -64 -> -80 is reported'); Cb.TRIDENT_VOID_Y = vy;
console.log(`tridentlockstepcheck: ${breaks + 7} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
