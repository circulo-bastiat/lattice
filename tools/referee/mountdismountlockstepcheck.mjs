// mountdismount lockstep check -- #8840 (G17-L248): lockstep scenario 'mountdismount'.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14l_use.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.Reg.buildPhysics(rdj('block-physics.json'));
M.Use.init(w);
const { EntityList: EL, States: S, Physics: Ph } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
// Reference = .decomp HorseBaseEntity.updatePassengerForDismount/locateSafeDismountingPos (horse, donkey, llama), PigEntity.updatePassengerForDismount
// (Dismounting.getDismountOffsets ladder), Entity.updatePassengerForDismount, BlockView.getDismountHeight, Dismounting.canPlaceEntityAt; rider = player poses.
const POSES = [['standing', 1.8], ['crouching', 1.5], ['swimming', 0.6]], RW = 0.6;
const boxes = (x, y, z) => { const id = w.get(x, y, z); return id ? (Ph.shapesFor(id) || []).map((q) => [x + q[0], y + q[1], z + q[2], x + q[3], y + q[4], z + q[5]]) : []; };
const dh = (x, y, z) => { const t = (bs) => bs.length ? Math.max(...bs.map((b) => b[4])) - y : -Infinity;
  const here = boxes(x, y, z); if (here.length) return Math.max(...here.map((b) => b[4])) - y;
  const b = boxes(x, y - 1, z); const m = b.length ? Math.max(...b.map((q) => q[4])) - (y - 1) : -Infinity; return m >= 1 ? m - 1 : -Infinity; };
const free = (x, y, z, h) => { const a = [x - RW / 2, y, z - RW / 2], c = [x + RW / 2, y + h, z + RW / 2];
  for (let i = Math.floor(a[0]); i <= Math.floor(c[0]); i++) for (let j = Math.floor(a[1]) - 1; j <= Math.floor(c[1]); j++) for (let k = Math.floor(a[2]); k <= Math.floor(c[2]); k++)
    for (const b of boxes(i, j, k)) if (b[0] < c[0] && b[3] > a[0] && b[1] < c[1] && b[4] > a[1] && b[2] < c[2] && b[5] > a[2]) return false;
  return true; };
const ok1 = (d) => d !== -Infinity && d < 1;
const WH = { horse: [1.3964844, 1.6], donkey: [1.3964844, 1.5], llama: [0.9, 1.87], pig: [0.9, 0.9] };
function safe(e, ox, oz, hgt) {
  const X = e.x + ox, Z = e.z + oz, top = e.y + hgt + 0.75;
  for (const [pn, ph] of POSES) { let y = Math.floor(e.y);
    do { const d = dh(Math.floor(X), y, Math.floor(Z)); if (y + d > top) break;
      if (ok1(d) && free(X, y + d, Z, ph)) return { x: X, y: y + d, z: Z, pose: pn }; y++; } while (y < top); }
  return null; }
function ref(e, kind) {
  const [mw, hgt] = [Math.fround(WH[kind][0]), Math.fround(WH[kind][1])];
  const off = (yaw) => { const half = (mw + RW + 1e-5) / 2, sx = -Math.sin(yaw), cz = Math.cos(yaw), s = Math.max(Math.abs(sx), Math.abs(cz)); return [sx * half / s, cz * half / s]; };
  const horse = () => { for (const sg of [1, -1]) { const o = off(e.yaw + sg * Math.PI / 2), r = safe(e, o[0], o[1], hgt); if (r) return r; } return { x: e.x, y: e.y, z: e.z }; };
  if (kind !== 'pig') return horse();
  const dirs = [[0, 1], [-1, 0], [0, -1], [1, 0]], i = ((Math.floor(e.yaw * 180 / Math.PI / 90 + 0.5) % 4) + 4) % 4, f = dirs[i], r = dirs[(i + 1) % 4], l = [-r[0], -r[1]], b = [-f[0], -f[1]];
  const ladder = [r, l, [b[0] + r[0], b[1] + r[1]], [b[0] + l[0], b[1] + l[1]], [f[0] + r[0], f[1] + r[1]], [f[0] + l[0], f[1] + l[1]], b, f];
  for (const [pn, ph] of POSES) for (const [ox, oz] of ladder) { const cx = Math.floor(e.x) + ox, cz = Math.floor(e.z) + oz, y = Math.floor(e.y), d = dh(cx, y, cz);
    if (ok1(d) && free(cx + 0.5, y + d, cz + 0.5, ph)) return { x: cx + 0.5, y: y + d, z: cz + 0.5, pose: pn }; }
  return { x: e.x, y: e.y + hgt, z: e.z }; }
const NAMES = ['stone', 'oak_fence', 'oak_slab', 'oak_trapdoor'];
function lane(salt, kind) {
  cells.clear(); EL.list.length = 0;
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) w.set(x, 0, z, S.stateOf('stone'));
  const r = stream(salt * 7 + kind.length);
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { if (!x && !z) continue;
    const n = r(); if (n < 0.45) continue; const nm = NAMES[Math.floor(r() * 4)]; const st = S.stateOf(nm); w.set(x, 1, z, st);
    if (nm === 'stone' && r() < 0.5) w.set(x, 2, z, st); if (nm === 'oak_fence' && r() < 0.5) w.set(x, 2, z, st); }
  const e = EL.spawn(kind, 0.5, 1, 0.5); e.persistent = true; e.yaw = (r() * 4 - 2) * Math.PI; e.y = 1;
  const want = ref(e, kind), got = M.Mount.findDismountPos(e, RW, Ph);
  const bad = !got || ['x', 'y', 'z'].some((k) => Math.abs(got[k] - want[k]) > 1e-6) || (want.pose && got.pose !== want.pose);
  return bad ? { salt, kind, ref: want, got } : null;
}
let cases = 0, hits = 0;
for (const kind of ['horse', 'donkey', 'pig', 'llama']) {
  const bad = salts.map((s) => lane(s, kind)).filter(Boolean); cases++;
  ok(!bad.length, `${kind}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
const anyBad = () => salts.some((s) => ['horse', 'pig', 'llama'].some((k) => lane(s, k)));
const M0 = M.Mount.dismountOffset;
M.Mount.dismountOffset = (a, b, y) => M0(a, b, y + 0.3); brk(anyBad(), 'exit-side yaw skewed caught'); M.Mount.dismountOffset = M0;
const L0 = M.Mount.locateSafeDismountingPos;
M.Mount.locateSafeDismountingPos = (e, o, P, rw) => L0(e, { x: o.x * 0.5, z: o.z * 0.5 }, P, rw); brk(anyBad(), 'exit offset halved caught'); M.Mount.locateSafeDismountingPos = L0;
const P0 = M.Mount.pigDismountPos;
M.Mount.pigDismountPos = (e, rw, P) => { const r = P0(e, rw, P); return r.pose ? Object.assign({}, r, { y: r.y + 0.5 }) : r; }; brk(anyBad(), 'pig ladder height +0.5 caught'); M.Mount.pigDismountPos = P0;
console.log(`mountdismountlockstepcheck: ${cases + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
