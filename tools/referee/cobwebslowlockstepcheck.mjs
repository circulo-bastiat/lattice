// cobwebslow lockstep check -- #8791 (G17-L240): lockstep scenario 'cobwebslow'.
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
// Reference = .decomp WebBlock.onEntityCollision -> Entity.slowMovement(state, (0.25, 0.05, 0.25)) (fallDistance = 0, movementMultiplier = v);
// Entity.move head: a pending multiplier scales the displacement, zeroes velocity and is cleared; checkBlockCollision may set it again.
const TICKS = 40, WEB = S.stateOf('cobweb');
const inWeb = (e) => { const hw = e.width / 2;
  for (let x = Math.floor(e.x - hw + 0.001); x <= Math.floor(e.x + hw - 0.001); x++) for (let y = Math.floor(e.y + 0.001); y <= Math.floor(e.y + e.height - 0.001); y++)
    for (let z = Math.floor(e.z - hw + 0.001); z <= Math.floor(e.z + hw - 0.001); z++) if (w.get(x, y, z) === WEB) return true;
  return false; };
function lane(salt, kind) {
  cells.clear(); EL.list.length = 0;
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) w.set(x, 0, z, S.stateOf('stone'));
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = 4; y <= 6; y++) w.set(x, y, z, WEB);
  const r = stream(salt); EL.random = r; Math.random = r;
  M.Player = { x: 30, y: 0, z: 30 };
  const e = EL.spawn(kind, 0.5 + (r() - 0.5) * 0.6, kind === 'item' ? 12 : (salt % 2 ? 9 : 3.11), 0.5 + (r() - 0.5) * 0.6); e.persistent = true;
  let y = e.y, vy = 0, pend = false; const bad = [];
  for (let t = 0; t < TICKS; t++) {
    const y0 = e.y, vy0 = e.vy || 0;
    EL.tick();
    if (e.removed) break;
    const web = inWeb(e);
    const wantMm = web ? [0.25, 0.05, 0.25] : null, gotMm = e.movementMultiplier || null;
    if (JSON.stringify(wantMm) !== JSON.stringify(gotMm)) bad.push({ t, n: 'mm', ref: wantMm, got: gotMm });
    if (web && e.fallDistance !== 0) bad.push({ t, n: 'fd', ref: 0, got: e.fallDistance });
    if (!web && gotMm) bad.push({ t, n: 'mmleft', ref: null, got: gotMm });
    if (kind === 'item' && pend && Math.abs(e.vy) > 1e-9 && web) bad.push({ t, n: 'vy', ref: 0, got: e.vy });
    if (kind === 'item' && pend) {
      const dy = (vy0 - 0.04) * 0.05;
      if (Math.abs(e.y - (y0 + dy)) > 2 * Ph.EPS) bad.push({ t, n: 'y', ref: y0 + dy, got: e.y });
    }
    pend = web;
    if (bad.length) break;
  }
  return bad.length ? bad[0] : null;
}
let cases = 0;
for (const kind of ['zombie', 'pig', 'item']) {
  const bad = salts.map((s) => lane(s, kind)).filter(Boolean); cases++;
  ok(!bad.length, `${kind}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
const anyBad = () => [0, 1, 2, 3].some((s) => lane(s, 'item') || lane(s, 'pig') || lane(s, 'zombie'));
const sm = Ph.slowMovement;
Ph.slowMovement = (e, m, c) => sm(e, [m[0], m[1] === 0.05 ? 0.5 : m[1], m[2]], c);
brk(anyBad(), 'vertical factor 0.05 -> 0.5 caught'); Ph.slowMovement = sm;
const mv = Ph.move;
Ph.move = (e, dx, dy, dz) => { const m = e.movementMultiplier; const r = mv(e, dx, dy, dz); if (m) e.movementMultiplier = m; return r; };
brk(anyBad(), 'per-tick multiplier reset removed caught'); Ph.move = mv;
console.log(`cobwebslowlockstepcheck: ${cases + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
