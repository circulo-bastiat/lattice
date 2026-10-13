#!/usr/bin/env node
// lootingrefcheck.mjs — infra I6 (s142, 25 Sept 2026): mob drops from a PLAYER's kill, plain sword and Looting III, vs the real
// 1.18.2 server (golden: runlooting.mjs, looting.json; tables: lootingscen.mjs). The engine side is the REAL join a kill takes:
// a player (Survival.init) holding the lane's netherite sword in its selected hotbar slot, `Combat.attack(P, mob)` on a mob left
// with 0.001 health (so the swing kills it and Cb.notePlayerHit arms killed_by_player), then `Combat.tickEntity` — where the
// death drop (`Cb.dropLoot` -> `Loot.entityDrops`) happens — and the item entities it spawned are counted. The mob's rolled
// spawn gear is stripped first (MobEntity.dropEquipment is NOT part of `/loot ... kill`, which rolls the table only).
// Statistics as mobreflootcheck (drop RATE and MEAN count per kill, pooled 5-sigma). Anti-vacuity (D-30/D-305): a golden
// rotten-flesh rate halved, the engine's killed_by_player forced false, the killer's Looting forced 0, and the L0 golden swapped in for L3 on a
// looting-sensitive table are each caught. Mismatches are FINDINGS (red, exit 1).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { TABLES, LANES } from './lootingscen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const N_E = +(process.env.MCLITE_LOOTING_N || 1500), Z = 5;
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'looting.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'looting.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('lootingrefcheck: golden not generated -- run node tools/referee/runlooting.mjs (skipped)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
let seed = 0x0a4a0125;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// The engine as the game builds it (the fallrefcheck loader): every 07*.js mob module.
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14i_hand.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.EntityList.random = rng;
Math.random = rng;
const { EntityList: EL, Items: IT, Equip: Eq, States: S } = M;
const { Survival: Sv, Inventory: Iv, Combat: Cb } = M;
const P = { x: 0.5, y: 1, z: 0.5, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, yaw: 0, pitch: 0, type: 'player', slot: 0, inventory: { slots: new Array(Iv.SIZE || 46).fill(null), selected: 0 } };
Sv.init(P);
M.Player = P;
for (let x = -3; x <= 6; x++) for (let z = -3; z <= 3; z++) w.set(x, 0, z, S.stateOf('stone'));
function kills(table, lvl, n, hook) {
  const sword = { i: IT.of('netherite_sword'), n: 1 };
  if (lvl) sword.t = { Enchantments: [{ id: 'minecraft:looting', lvl }] };
  P.inventory.slots[0] = sword;
  const rec = { rolls: 0, empty: 0, items: {}, errs: 0 };
  for (let k = 0; k < n; k++) {
    EL.list.length = 0;
    const e = EL.spawn(table, 2.5, 1, 0.5);
    if (!e) { rec.errs++; continue; }
    e.equip = {};
    // `/summon` WITH an NBT argument skips `MobEntity.initialize` (SummonCommand), so the lane's
    // sheep keep the default white fleece; the engine's spawn rolls a colour, reset it to match.
    if (table === 'sheep') e.woolColor = 'white';
    e.health = 0.001;
    // the golden's `/summon ... {NBT}` skips MobEntity.initialize (SummonCommand: only an EMPTY nbt
    // initializes), so its sheep is always the default WHITE -- EL.spawn rolls a natural colour.
    if (table === 'sheep') e.woolColor = 'white';
    if (hook) hook(e);
    Cb.attack(P, e);
    if (!e.dead) { rec.errs++; continue; }
    Cb.tickEntity(e);
    rec.rolls++;
    const per = {};
    for (const o of EL.list) if (o.type === 'item' && o.item !== undefined) { const id = IT.nameOf(o.item); per[id] = (per[id] || 0) + (o.count | 0); }
    if (!Object.keys(per).length) rec.empty++;
    for (const [id, c] of Object.entries(per)) { const s = rec.items[id] || (rec.items[id] = { total: 0, sq: 0, hits: 0, max: 0 }); s.total += c; s.sq += c * c; s.hits++; s.max = Math.max(s.max, c); }
  }
  return rec;
}
function compare(label, van, eng) {
  const out = [];
  if (!eng.rolls) return [`${label}: the engine never killed it (${eng.errs} failed kills)`];
  const ids = new Set([...Object.keys(van.items), ...Object.keys(eng.items)]);
  const nv = van.rolls, ne = eng.rolls;
  for (const id of ids) {
    const v = van.items[id] || { total: 0, sq: 0, hits: 0 }, e = eng.items[id] || { total: 0, sq: 0, hits: 0 };
    const pv = v.hits / nv, pe = e.hits / ne;
    const p = (v.hits + e.hits) / (nv + ne);
    const seP = Math.sqrt(p * (1 - p) * (1 / nv + 1 / ne)) || 1e-9;
    if ((v.hits === 0 && pe > 0.03) || (e.hits === 0 && pv > 0.03) || Math.abs(pe - pv) > Z * seP + 1e-9) {
      out.push(`${label}: ${id} drop rate engine ${(pe * 100).toFixed(1)}% vs server ${(pv * 100).toFixed(1)}%`); continue; }
    const mv = v.total / nv, me = e.total / ne;
    const seM = Math.sqrt(Math.max(v.sq / nv - mv * mv, 0) / nv + Math.max(e.sq / ne - me * me, 0) / ne) || 1e-9;
    if (Math.abs(me - mv) > Z * seM + 1e-9) out.push(`${label}: ${id} mean count engine ${me.toFixed(3)} vs server ${mv.toFixed(3)} per kill`);
  }
  return out;
}
const reds = [];
let pass = 0, breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`lootingrefcheck — player-kill drops, plain sword and Looting III, engine x${N_E} kills vs server x${golden.rolls} (${golden.generatedAt})`);
const ENG = {};
for (const [lane, lvl] of Object.entries(LANES)) {
  for (const t of TABLES) {
    const van = golden.lanes[lane] && golden.lanes[lane][t];
    if (!van || !van.rolls) { reds.push(`${lane} ${t}: no golden`); continue; }
    const eng = kills(t, lvl, N_E);
    ENG[lane + t] = eng;
    const bad = compare(`${t} (${lane === 'L0' ? 'player kill' : 'player kill, Looting III'})`, van, eng);
    if (bad.length) reds.push(...bad); else pass++;
    if (VERBOSE) console.log(`  ${lane} ${t.padEnd(18)} ${bad.length ? 'RED ' + bad.length : 'ok'}`);
  }
}
{ const van = JSON.parse(JSON.stringify(golden.lanes.L0.zombie)); van.items.rotten_flesh.hits = Math.round(van.items.rotten_flesh.hits / 2);
  brk('golden zombie rotten_flesh rate halved', compare('zombie', van, ENG.L0zombie).length > compare('zombie', golden.lanes.L0.zombie, ENG.L0zombie).length); }
{ const orig = Cb.killedByPlayer; Cb.killedByPlayer = () => false; const eng = kills('blaze', 0, 600); Cb.killedByPlayer = orig;
  brk('engine killed_by_player forced false (blaze rods)', compare('blaze', golden.lanes.L0.blaze, eng).length > 0); }
{ const orig = Cb.lootingOf; Cb.lootingOf = () => 0; const eng = kills('blaze', 3, 600); Cb.lootingOf = orig;
  brk('engine killer Looting forced 0 (blaze rods, L3)', compare('blaze', golden.lanes.L3.blaze, eng).length > 0); }
{ brk('L0 golden used as L3 (wither_skeleton coal/bones)', compare('ws', golden.lanes.L0.wither_skeleton, ENG.L3wither_skeleton).length > 0 || compare('ws', golden.lanes.L3.wither_skeleton, ENG.L3wither_skeleton).length > 0); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`lootingrefcheck: ${pass}/${TABLES.length * 2} table x lane agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
