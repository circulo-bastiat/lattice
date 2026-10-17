#!/usr/bin/env node
// geardroprefcheck.mjs — infra I6 (25 Sept 2026): a mob's WORN GEAR dropping on a player kill (MobEntity.dropEquipment) vs the real
// 1.18.2 server (golden: rungeardrop.mjs, gear-drop.json; the zombie's gear: geardropscen.mjs). Engine side, the REAL kill join:
// a player (Survival.init) holding the lane's netherite sword (Looting 0 / III), Strength 101 as on the server, a zombie from
// EL.spawn with exactly the GEAR list worn (Equip.setEquipped, Enchantments on the stack) and its drop chances
// (Equip.setDropChance), health 0.001, `Combat.attack(P, mob)` then `Combat.tickEntity` (Cb.dropLoot -> Equip.dropEquipment ->
// EL.dropStack), and the gear item entities it spawned counted, with their damage and enchantment tag if the entity carries one.
// Judged per lane: each piece's drop RATE (pooled 5 sigma; the three 0.02 pieces pooled, 3 x kills rolls); the leggings' mean
// Damage (5 sigma, Welch); boots keeping their enchantment (all-or-nothing). Anti-vacuity (D-30/D-305): golden L0 boots halved,
// the engine's drop chance forced 0, golden L0 0.02-piece hits tripled — each must add a red. Mismatches are FINDINGS (exit 1).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { GEAR, LANES } from './geardropscen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const N_E = +(process.env.MCLITE_GEARDROP_N || 4000), Z = 5;
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'gear-drop.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'gear-drop.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('geardroprefcheck: golden not generated -- run node tools/referee/rungeardrop.mjs (skipped)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
let seed = 0x9ea5d209;
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
const SLOT = { mainhand: IT.MAINHAND, offhand: IT.OFFHAND, feet: IT.FEET, legs: IT.LEGS, chest: IT.CHEST, head: IT.HEAD };
const LOW = GEAR.filter((g) => g.chance === 0.02).map((g) => g.item);
function kills(lvl, n) {
  const sword = { i: IT.of('netherite_sword'), n: 1 };
  if (lvl) sword.t = { Enchantments: [{ id: 'minecraft:looting', lvl }] };
  P.inventory.slots[0] = sword;
  if (M.Effects && M.Effects.addStatusEffect && !P._str) { M.Effects.addStatusEffect(P, 'strength', 1e9, 100, false, false); P._str = 1; }
  const rec = { kills: 0, items: {}, damage: { iron_leggings: [] }, enchanted: { iron_boots: 0 }, boots: 0, errs: 0 };
  for (const g of GEAR) rec.items[g.item] = 0;
  for (let k = 0; k < n; k++) {
    EL.list.length = 0;
    const e = EL.spawn('zombie', 2.5, 1, 0.5);
    if (!e) { rec.errs++; continue; }
    e.equip = {};
    for (const g of GEAR) {
      const st = { i: IT.of(g.item), n: 1 };
      if (g.ench) st.t = { Enchantments: g.ench.map(([id, l]) => ({ id: 'minecraft:' + id, lvl: l })) };
      Eq.setEquipped(e, SLOT[g.slot], st); Eq.setDropChance(e, SLOT[g.slot], g.chance);
    }
    e.health = 0.001;
    M.Hand.attackStrengthTicker = 1000;
    Cb.attack(P, e);
    if (!e.dead) { rec.errs++; continue; }
    Cb.tickEntity(e);
    rec.kills++;
    for (const o of EL.list) {
      if (o.type !== 'item' || o.item === undefined) continue;
      const id = IT.nameOf(o.item);
      if (!(id in rec.items)) continue;
      rec.items[id] += o.count | 0 || 1;
      const st = o.stack || o;
      if (id === 'iron_leggings') rec.damage.iron_leggings.push(+(st.d || st.damage || 0));
      if (id === 'iron_boots') { rec.boots++; if (st.t || st.tag) rec.enchanted.iron_boots++; }
    }
  }
  return rec;
}
const rate = (label, hv, nv, he, ne) => {
  const pv = hv / nv, pe = he / ne, p = (hv + he) / (nv + ne);
  const se = Math.sqrt(p * (1 - p) * (1 / nv + 1 / ne)) || 1e-9;
  if ((hv === 0 && pe > 0.03) || (he === 0 && pv > 0.03) || Math.abs(pe - pv) > Z * se + 1e-9) return [`${label}: engine ${(pe * 100).toFixed(1)}% vs server ${(pv * 100).toFixed(1)}%`];
  return [];
};
const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const vari = (a) => { const m = mean(a); return a.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, a.length - 1); };
function compare(lane, van, eng) {
  const out = [], L = lane === 'L3' ? 'Looting III kill' : 'plain player kill';
  if (!eng.kills) return [`${lane}: the engine never killed a zombie (${eng.errs} failed)`];
  for (const g of GEAR) if (!LOW.includes(g.item)) out.push(...rate(`${L}: ${g.item} (drop chance ${g.chance}${g.ench ? ', ' + g.ench.map((q) => q[0]).join(',') : ''}) drop rate`, van.items[g.item], van.kills, eng.items[g.item], eng.kills));
  const hv = LOW.reduce((s, i) => s + van.items[i], 0), he = LOW.reduce((s, i) => s + eng.items[i], 0);
  out.push(...rate(`${L}: the drop-chance-0.02 pieces (${LOW.join(', ')}) pooled drop rate`, hv, van.kills * LOW.length, he, eng.kills * LOW.length));
  const dv = van.damage.iron_leggings, de = eng.damage.iron_leggings;
  if (dv.length && de.length) {
    const se = Math.sqrt(vari(dv) / dv.length + vari(de) / de.length) || 1e-9;
    if (Math.abs(mean(dv) - mean(de)) > Z * se + 1e-9) out.push(`${L}: dropped iron_leggings (chance 1.0) mean Damage: server ${mean(dv).toFixed(1)} of 225 (random wear), engine ${mean(de).toFixed(1)}`);
  } else if (dv.length !== de.length && (!dv.length || !de.length)) out.push(`${L}: dropped iron_leggings: server ${dv.length} read, engine ${de.length}`);
  const bv = van.enchanted.iron_boots / Math.max(1, van.damage.iron_boots.length), be = eng.enchanted.iron_boots / Math.max(1, eng.boots);
  if (Math.abs(bv - be) > 0.5) out.push(`${L}: dropped iron_boots keep their Feather Falling: server ${(bv * 100).toFixed(0)}%, engine ${(be * 100).toFixed(0)}%`);
  return out;
}
const reds = [];
let pass = 0, breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`geardroprefcheck — worn gear dropping on a player kill, engine x${N_E} vs server x${golden.lanes.L0.kills} kills a lane (${golden.generatedAt})`);
const ENG = {};
for (const [lane, lvl] of Object.entries(LANES)) {
  const van = golden.lanes[lane];
  if (!van || !van.kills) { reds.push(`${lane}: no golden`); continue; }
  const eng = ENG[lane] = kills(lvl, N_E);
  const bad = compare(lane, van, eng);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${lane} server ${JSON.stringify(van.items)}  engine ${JSON.stringify(eng.items)}`);
}
const base = compare('L0', golden.lanes.L0, ENG.L0).length;
{ const v = JSON.parse(JSON.stringify(golden.lanes.L0)); v.items.iron_boots = Math.round(v.items.iron_boots / 2); brk('golden L0 iron_boots halved', compare('L0', v, ENG.L0).length > base); }
{ const o = Eq.dropChance; Eq.dropChance = () => 0; const e = kills(0, 600); Eq.dropChance = o; brk('engine drop chance forced 0', compare('L0', golden.lanes.L0, e).length > base); }
{ const v = JSON.parse(JSON.stringify(golden.lanes.L0)); for (const i of LOW) v.items[i] *= 3; brk('golden L0 0.02-piece hits tripled', compare('L0', v, ENG.L0).length > base); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`geardroprefcheck: ${pass}/${Object.keys(LANES).length} lanes agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
