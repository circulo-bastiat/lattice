// waterflow lockstep check -- #6682 (G17-L111): flow vector direction per level + the 0.014 / 0.0023333 push.
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
// Reference = .decomp FlowableFluid.getVelocity (per-neighbour height difference, normalised) + Entity.updateMovementInFluid
// (average of the vectors, normalised for non-players, times 0.014 water / 0.0023333 lava; a resting entity gets at least 0.0045).
// 1x9 channel along +x at y=0 on stone, stone walls at z=+-1. Source at x=0, flow level L at x=L (heights (8-L)/9), x=8 level 7.
const WANT_H = (L) => (8 - Math.min(L, 7)) / 9;
function lane(salt, kind, type, push) {
  cells.clear(); EL.list.length = 0;
  const base = S.stateOf(kind);
  for (let x = -2; x <= 11; x++) { w.set(x, -1, 0, S.stateOf('stone')); w.set(x, 0, -1, S.stateOf('stone')); w.set(x, 0, 1, S.stateOf('stone')); }
  const rev = salt & 1;   // salts alternate the flow direction
  for (let i = 0; i < 9; i++) w.set(rev ? 8 - i : i, 0, 0, base + Math.min(i, 7));
  const r = stream(salt); EL.random = r; Math.random = r;
  M.Player = { x: 30, y: 0, z: 30 };
  const bad = [];
  for (let c = 0; c < 9; c++) {
    const e = EL.spawn(type, c + 0.5, 0, 0.5); e.persistent = true; e.vx = 0; e.vy = 0; e.vz = 0; e.flying = false;
    Ph.fluidPush(e);
    const L = rev ? 8 - c : c, hs = (i) => (i < 0 || i > 8 ? 0 : WANT_H(i));
    const lv = (x) => { const q = rev ? 8 - x : x; return q < 0 || q > 8 ? 0 : WANT_H(q); };
    const own = lv(c); let vx = 0;
    for (const dx of [-1, 1]) { const h = lv(c + dx); if (h !== 0) vx += dx * Math.fround(own - h); }
    let ex = vx > 0 ? push : vx < 0 ? -push : 0;
    if (ex !== 0 && Math.abs(ex) < 0.0045) ex = Math.sign(ex) * 0.0045;
    if (Math.abs(e.vx - ex) > 1e-9 || Math.abs(e.vz) > 1e-9) bad.push({ c, L, got: e.vx, want: ex });
    e.removed = true;
  }
  return bad.length ? bad[0] : null;
}
let cases = 0;
const run = (kind, type, push, quiet) => { const rs = salts.map((s) => lane(s, kind, type, push)); cases++; const bad = rs.filter(Boolean);
  if (!quiet) ok(!bad.length, `${kind}/${type}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`); return bad.length; };
run('water', 'cow', 0.014); run('water', 'zombie', 0.014); run('lava', 'cow', 0.0023333333333333335); run('lava', 'zombie', 0.0023333333333333335);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
Ph.WATER_PUSH = 0.015; brk(run('water', 'cow', 0.014, true) > 0, 'water push 0.014 -> 0.015 caught'); Ph.WATER_PUSH = 0.014;
fails -= 0;
console.log(`waterflowlockstepcheck: ${cases + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
