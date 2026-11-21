// lockstep/knotlane.mjs -- #7059: ENGINE side of the leash_knot lane (the leashknotlockstepcheck harness): engineKnot(salt) -> rows {tick, knot, leash, drops, kpos}.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js'];
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
const { EntityList: EL, Tame: T } = M;
const FENCE = 777, FX = 3, FY = 0, FZ = 3;
M.Tags = { ready: true, blockTag: () => 1, stateInCol: (c, st) => st === FENCE };
T._fencesCol = 1;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export const KNOT_TICKS = 260;
export const knotParams = (salt) => { const r = stream(salt); return { attach: 1 + Math.floor(r() * 5), brk: 1 + Math.floor(r() * 230) }; };
export { T as Tame };
export function engineKnot(salt) {
  const p = knotParams(salt);
  cells.clear(); EL.list.length = 0; T.knots.length = 0;
  const r = stream(salt + 100); EL.random = r; Math.random = r;
  const e = EL.spawn('cow', 0.5, 0, 0.5); e.persistent = true; T.leashToPlayer(e);
  w.set(FX, FY, FZ, FENCE); M.Player.x = 0.5; M.Player.y = 0; M.Player.z = 1.5;
  const rows = [];
  for (let t = 1; t <= KNOT_TICKS; t++) {
    e.x = 0.5; e.y = 0; e.z = 0.5; e.vx = e.vy = e.vz = 0;
    T.tickLeash();
    if (t === p.attach) T.attachHeldMobsToBlock(FX, FY, FZ);
    if (t === p.brk) w.set(FX, FY, FZ, 0);
    const k = T.knots.filter((q) => !q.removed)[0];
    rows.push({ tick: t, knot: k ? 1 : 0, leash: e.leashHolder ? 1 : 0, drops: EL.list.filter((q) => q.type === 'item').length, dpos: (EL.list.find((q) => q.type === 'item') || {}).x === undefined ? null : [EL.list.find((q) => q.type === 'item').x, EL.list.find((q) => q.type === 'item').y, EL.list.find((q) => q.type === 'item').z], dcount: (EL.list.find((q) => q.type === 'item') || { stack: { count: 0 } }).stack?.count ?? null, kpos: k ? [k.x, k.y, k.z] : null });
  }
  return rows;
}
