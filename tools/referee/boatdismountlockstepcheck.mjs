// boatdismount lockstep check -- #8839 (G17-L247): lockstep scenario 'boatdismount'. Reference = .decomp BoatEntity.updatePassengerForDismount + Entity.getPassengerDismountOffset + Dismounting (written from a grid, independent of Physics).
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
const { States: S, Physics: Ph } = M;
let fails = 0, breaks = 0, cases = 0;
const ok = (c, m) => { cases++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const STONE = S.stateOf('stone'), ICE = S.stateOf('ice'), WATER = S.stateOf('water');
const f = Math.fround, solid = (x, y, z) => { const s = w.get(x, y, z); return s === STONE || s === ICE; };
const KINDS = ['shore', 'ice', 'ceiling', 'blocked', 'water'];
// a lake y=0 water on stone y=-1, boat floats at y 0.5 (box top 1.0625); the shore (stone top y=1 -> cells y=0) lies at x>=2 or x<=-2 for 'shore'
function build(salt, kind) {
  cells.clear(); const r = stream(salt);
  const yaw = Math.floor(r() * 360), sideRight = salt % 2;
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) { w.set(x, -1, z, STONE); w.set(x, 0, z, WATER); }
  const bx = 0.5 + (r() - 0.5) * 0.2, bz = 0.5 + (r() - 0.5) * 0.2;
  // ring of land (y=0 cell solid, i.e. shore at floor level 1) beyond |d|>=2 on the dismount side(s)
  const land = (x, z) => { w.set(x, 0, z, kind === 'ice' ? ICE : STONE); };
  if (kind !== 'water') for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) if (Math.max(Math.abs(x), Math.abs(z)) >= 1 && (kind !== 'blocked' || (x * (sideRight ? 1 : -1) + z) % 3 === 0 || true)) { if (Math.hypot(x, z) >= 1.2) land(x, z); }
  if (kind === 'blocked') for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) if (solid(x, 0, z) && (x + z + salt) % 2 === 0) w.set(x, 1, z, STONE);
  if (kind === 'ceiling') for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) w.set(x, 2, z, STONE);   // // solid cell y=2: only the 0.6 swimming box fits above the shore
  return { yaw, bx, bz };
}
// reference, straight from the jar, on the grid
function reference(sc, riderW, ps) {
  const bw = 1.375, bh = 0.5625, by = 0.5;
  const half = (f(bw * 1.4142135) + riderW + f(1.0E-5)) / 2, rad = f(Math.PI / 180);
  const sx = -f(Math.sin(f(f(sc.yaw) * rad))), cz = f(Math.cos(f(f(sc.yaw) * rad))), sc2 = Math.max(Math.abs(sx), Math.abs(cz));
  const x = sc.bx + sx * half / sc2, z = sc.bz + cz * half / sc2, top = by + bh;
  const fx = Math.floor(x), fz = Math.floor(z), y4 = Math.floor(top), y5 = y4 - 1;
  const water = (X, Y, Z) => w.get(X, Y, Z) === WATER;
  if (!water(fx, y5, fz)) {
    const cand = [];
    const dh = (X, Y, Z) => solid(X, Y, Z) ? 1 : (solid(X, Y - 1, Z) ? 0 : -Infinity);
    if (dh(fx, y4, fz) < 1 && isFinite(dh(fx, y4, fz))) cand.push(y4 + dh(fx, y4, fz));
    if (dh(fx, y5, fz) < 1 && isFinite(dh(fx, y5, fz))) cand.push(y5 + dh(fx, y5, fz));
    for (const [pose, h] of ps) for (const cy of cand) {
      let free = true;
      for (let X = Math.floor(x - 0.3); X <= Math.floor(x + 0.3 - 1e-7); X++) for (let Z = Math.floor(z - 0.3); Z <= Math.floor(z + 0.3 - 1e-7); Z++)
        for (let Y = Math.floor(cy); Y < cy + h; Y++) if (solid(X, Y, Z)) free = false;
      if (free) return [x, cy, z, pose];
    }
  }
  return [sc.bx, top, sc.bz, 'fallback'];
}
const POSES = [['standing', 1.8], ['crouching', 1.5], ['swimming', 0.6]];
function lane(salt, kind) {
  const sc = build(salt, kind);
  const e = { type: 'boat', x: sc.bx, y: 0.5, z: sc.bz, width: 1.375, height: 0.5625, yaw: 0 };
  const got = M.Boat.findDismountPos(e, 0.6, sc.yaw, Ph), ref = reference(sc, 0.6, POSES);
  const gp = got.pose || 'fallback';
  if (gp !== ref[3] || Math.abs(got.x - ref[0]) > 1e-9 || Math.abs(got.y - ref[1]) > 1e-9 || Math.abs(got.z - ref[2]) > 1e-9) return { salt, kind, got, ref };
  return null;
}
const seen = {};
for (const kind of KINDS) {
  const bad = salts.map((s) => lane(s, kind)).filter(Boolean);
  ok(!bad.length, `${kind}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`);
  for (const s of salts) { const p = reference(build(s, kind), 0.6, POSES)[3]; seen[kind + ':' + p] = 1; }
}
ok(seen['shore:standing'] && seen['ceiling:swimming'] && seen['water:fallback'] && seen['blocked:fallback'] && seen['ice:standing'], 'outcomes not vacuous: ' + Object.keys(seen));
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
const anyBad = () => KINDS.some((k) => salts.some((s) => lane(s, k)));
const fd = M.Boat.findDismountPos;
M.Boat.findDismountPos = (e, rw, y, P) => fd(e, rw, y + 180, P); brk(anyBad(), 'wrong side (yaw + 180) caught'); M.Boat.findDismountPos = fd;
M.Boat.findDismountPos = (e, rw, y, P) => fd(e, rw, y, Object.assign({}, P, { solidAt: (x, yy, z) => yy >= 2 ? false : P.solidAt(x, yy, z) })); brk(anyBad(), 'ceiling ignored caught'); M.Boat.findDismountPos = fd;
M.Boat.findDismountPos = (e, rw, y, P) => fd(Object.assign({}, e, { width: e.width * 0.8 }), rw, y, P); brk(anyBad(), 'wrong offset (hull width x0.8) caught'); M.Boat.findDismountPos = fd;
console.log(`boatdismountlockstepcheck: ${cases + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
