#!/usr/bin/env node
// phazardrefcheck.mjs — infra I6 (s143, 25 Sept 2026): BLOCK HAZARDS and FALLS on the PLAYER vs the real 1.18.2 server (golden:
// runphazard.mjs, player-hazards.json — one growbot survival player per lane; scenarios: phazardscen.mjs). Engine side, through
// the joins the game uses every tick (14_player.js:451-526): Physics.tick(P, no input) -> Survival.updateArmor ->
// pendingFallDamage -> Survival.hurt('fall') -> Survival.tick (effects, air, hunger). The player is built by Survival.init, its
// armour in inventory slots ARMOR_START..+3 with `t.Enchantments` (the playerarmorrefcheck recipe). Hazards are judged coarsely
// in both directions (hit or not, per-hit amounts, death within 20 % of the server's ticks-from-first-hit); falls exactly (total
// health lost within 0.01). Anti-vacuity (D-30/D-305): a golden hazard series made harmless, the engine's Survival.hurt no-op'd
// for a fall scene, a golden fall loss +1. Mismatches are FINDINGS (red, exit 1).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, T } from './phazardscen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'player-hazards.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'player-hazards.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('phazardrefcheck: golden not generated -- run node tools/referee/runphazard.mjs (skipped)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
let seed = 0x0a4a0125;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// The engine as the game builds it (the fallrefcheck loader): every 07*.js mob module.
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
const { EntityList: EL, Items: IT, States: S, Survival: Sv, Inventory: Iv, Physics: Ph } = M;
if (!Sv || !Iv || !Ph) { console.log('phazardrefcheck: engine has no Survival/Inventory/Physics module loaded'); process.exit(1); }
const PAD = 0;
function stateOf(spec) {
  const m = /^([a-z_]+)(?:\[(.*)\])?$/.exec(spec);
  let st = S.stateOf(m[1]);
  if (st && m[2] && S.withProp) for (const kv of m[2].split(',')) { const [k, v] = kv.split('='); st = S.withProp(st, M.Reg.PROP[k], M.Reg.valueNames.indexOf(v)); }
  return st;
}
const NOCMD = { fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false };
function engineSeries(s, hook) {
  cells.clear(); EL.list.length = 0;
  const glass = S.stateOf('glass'), top = PAD + 3 + (s.fall || 0);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = PAD; y <= top; y++) if (x || z) w.set(x, y, z, glass);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) w.set(x, PAD - 1, z, S.stateOf('stone'));
  for (const [k, y] of [['floor', PAD], ['at', PAD + 1], ['head', PAD + 2]]) if (s[k]) { const st = stateOf(s[k]); if (!st) return { err: `no engine state ${s[k]}` }; w.set(0, y, 0, st); }
  const y0 = PAD + 1 + (s.fall || 0);
  const P = { x: 0.5, y: y0, z: 0.5, vx: 0, vy: 0, vz: 0, px: 0.5, py: y0, pz: 0.5, yaw: 0, pitch: 0, onGround: false, flying: false,
    noclip: false, sprinting: false, inWater: false, eyeInWater: false, inLava: false, EYE: 1.62, HEIGHT: 1.8, WIDTH: 0.6,
    width: 0.6, height: 1.8, type: 'player', invulnerableGamemode: false, naturalRegen: false, inventory: { slots: new Array(46).fill(null) } };
  Sv.init(P);
  P.naturalRegen = false;
  for (const a of s.armor) {
    const st = { i: IT.of(a.item), n: 1 };
    if (!st.i) return { err: `no engine item ${a.item}` };
    if (a.ench) st.t = { Enchantments: a.ench.map(([id, l]) => ({ id: 'minecraft:' + id, lvl: l })) };
    P.inventory.slots[Iv.ARMOR_START + a.slot] = st;
  }
  M.Player = P;
  if (hook) hook(P);
  const series = [P.health];
  for (let t = 1; t < T; t++) {
    P.px = P.x; P.py = P.y; P.pz = P.z;
    Ph.tick(P, NOCMD);
    Sv.updateArmor(P, P.inventory);
    if (P.pendingFallDamage) { Sv.hurt(P, 'fall', P.pendingFallDamage); P.pendingFallDamage = 0; }
    Sv.tick(P);
    series.push(P.dead ? 0 : P.health);
  }
  return { series };
}
function summ(series) {
  const hits = [], at = [];
  for (let i = 1; i < series.length; i++) { const d = series[i - 1] - series[i]; if (d > 1e-4) { hits.push(Math.round(d * 100) / 100); at.push(i); } }
  const di = series.findIndex((v) => !(v > 0));
  return { amounts: [...new Set(hits)].sort((a, b) => a - b), n: hits.length, died: di >= 0, toDeath: di >= 0 && at.length ? di - at[0] : null, lost: series[0] - series[series.length - 1] };
}
const f2 = (v) => (Math.round(v * 1000) / 1000).toString();
const armorTxt = (s) => (s.armor.length ? s.armor.map((a) => a.item + (a.ench ? '+' + a.ench.map((q) => q.join(' ')).join(',') : '')).join(' ') : 'no armour');
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const a = summ(g.series[0]), b = summ(e.series), out = [];
  if (s.fall) {
    if (Math.abs(a.lost - b.lost) > 0.01) out.push(`${s.id}: PLAYER falls ${s.fall} blocks (${armorTxt(s)}): server loses ${f2(a.lost)}, engine ${f2(b.lost)}`);
    return out;
  }
  const where = `PLAYER ${s.at ? 'in ' + s.at : ''}${s.head ? ' (head: ' + s.head + ')' : ''}${!s.at && !s.head ? 'on ' + s.floor : s.floor !== 'stone' ? ' on ' + s.floor : ''}${s.armor.length ? ' wearing ' + armorTxt(s) : ''}`;
  if ((a.n > 0) !== (b.n > 0)) return [`${s.id}: ${where}: server ${a.n ? `takes ${a.n} hits (${a.amounts.join('/')} each)${a.died ? ', dies' : ''}` : 'takes no damage'}, engine ${b.n ? `takes ${b.n} hits (${b.amounts.join('/')} each)` : 'takes no damage'}`];
  if (a.n && JSON.stringify(a.amounts) !== JSON.stringify(b.amounts)) out.push(`${s.id}: ${where}: hit amounts server ${a.amounts.join('/')} engine ${b.amounts.join('/')}`);
  if (a.died !== b.died) out.push(`${s.id}: ${where}: server ${a.died ? `dies ${a.toDeath} ticks after the first hit` : 'survives ' + T + ' ticks'}, engine ${b.died ? `dies ${b.toDeath} ticks after the first hit` : 'survives'}`);
  else if (a.died && Math.abs(a.toDeath - b.toDeath) > 0.2 * a.toDeath + 2) out.push(`${s.id}: ${where}: dies ${a.toDeath} ticks after the first hit on the server, ${b.toDeath} in the engine`);
  else if (!a.died && Math.abs(a.lost - b.lost) > 0.2 * a.lost + 0.5) out.push(`${s.id}: ${where}: loses ${f2(a.lost)} in ${T} ticks on the server, ${f2(b.lost)} in the engine`);
  return out;
}
const reds = [];
let pass = 0, breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) { caught++; console.log(`  ✓ break caught: ${name}`); } else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`phazardrefcheck — block hazards and falls on the PLAYER vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
const ENG = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineSeries(s);
  ENG[s.id] = e;
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) { const a = summ(g.series[0]), b = e.err ? null : summ(e.series); console.log(`  ${s.id.padEnd(20)} server n${a.n} [${a.amounts}] lost ${f2(a.lost)} death ${a.toDeath}  |  engine ${e.err || `n${b.n} [${b.amounts}] lost ${f2(b.lost)} death ${b.toDeath}`}`); }
}
{ const s = SCEN.find((q) => !q.fall && summ(golden.cases[q.id].series[0]).n > 0); const g = { series: golden.cases[s.id].series.map((q) => q.map(() => q[0])) };
  const e = { series: golden.cases[s.id].series[0] };   // the server's own series as the "engine": only the harmless golden differs
  brk(`golden ${s.id} made harmless`, compare(s, g, e).length > 0); }
{ const s = SCEN.find((q) => q.id === 'fall10_bare'); const orig = Sv.hurt; Sv.hurt = () => false;
  const e = engineSeries(s); Sv.hurt = orig; brk(`engine Survival.hurt no-op (${s.id})`, compare(s, golden.cases[s.id], e).length > 0); }
{ const s = SCEN.find((q) => q.id === 'fall23_ff4'); const g = { series: golden.cases[s.id].series.map((q) => q.map((v, i) => (i ? v - 1 : v))) };
  const e = { series: golden.cases[s.id].series[0] };
  brk(`golden ${s.id} loss +1`, compare(s, g, e).length > 0); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`phazardrefcheck: ${pass}/${SCEN.length} scenarios agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
