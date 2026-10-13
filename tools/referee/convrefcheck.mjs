#!/usr/bin/env node
// convrefcheck.mjs — infra I6 (25 Sept 2026): MOB CONVERSIONS vs the real 1.18.2 server (golden: runconv.mjs, conversion.json;
// scenarios: convscen.mjs). Per scenario the engine builds the same 1x1 glass cell (air / water / powder snow), spawns the mob
// (EL.spawn) with the scenario's state set through the engine's OWN fields/setters, runs T ticks of `EL.tick`, and records the
// first tick after which the converted type stands in the cell, plus that mob's baby flag, health, held/worn items and the
// nausea duration it carried on its first tick. Compared EXACTLY with the server's (constant over its reps).
// Anti-vacuity (D-30/D-305): a golden tick shifted by 1, a golden health changed, and the engine's zombie submerge clock
// started 300 ticks in are each caught. Mismatches are FINDINGS (red, exit 1). No golden -> SKIP.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, T } from './convscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'conversion.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'conversion.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('convrefcheck: SKIP (golden not generated -- run node tools/referee/runconv.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

let seed = 0x0c0f7e12;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// The engine as the game builds it: mobdefaultscheck's module list + EVERY src/07*.js (the mob modules), so every mob gets its
// real goal selector (`e.ai`) -- without it EL.tickOne never reaches EL.tickMob, where the conversions run.
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
M.Diff = { get: () => 'normal' };       // runconv.mjs runs difficulty normal
M.Player = { x: 0, y: 200, z: 0 };
for (const k of ['Effects', 'Undead', 'Piglin', 'Hoglin']) if (M[k] && M[k].init) M[k].init();
M.EntityList.random = rng;
Math.random = rng;
const { EntityList: EL, Items: IT, Equip: Eq, States: S } = M;
const H = 4;

const SLOT = (n) => (IT[n.toUpperCase()] !== undefined ? IT[n.toUpperCase()] : IT[n]);
function applyState(e, st) {
  if (!st) return;
  { // the server spawns from NBT (no Age = adult); the engine spawn rolls a random baby, so always pin it
    const baby = !!st.baby;
    if (M.Piglin && M.Piglin.setBaby && (e.type === 'piglin')) M.Piglin.setBaby(e, baby);
    else if (M.Hoglin && M.Hoglin.setBaby && e.type === 'hoglin') M.Hoglin.setBaby(e, baby);
    else if (M.Breed && M.Breed.setAge) M.Breed.setAge(e, baby ? -24000 : 0);
    else { e.isBaby = baby; e.growAge = baby ? -24000 : 0; }
  }
  if (st.timeInOverworld !== undefined) e.timeInOverworld = st.timeInOverworld;
  if (st.immuneToZombification) e.immuneToZombification = true;
  if (st.waterConvertTime !== undefined) e.waterConvertTime = st.waterConvertTime;
  if (st.health !== undefined) e.health = st.health;
  if (st.main) Eq.setEquipped(e, SLOT('mainhand'), { i: IT.of(st.main), n: 1 });
  if (st.head) Eq.setEquipped(e, SLOT('head'), { i: IT.of(st.head), n: 1 });
}
function itemName(e, slot) {
  const st = Eq.getEquipped ? Eq.getEquipped(e, SLOT(slot)) : null;
  return st && st.i ? String(IT.nameOf(st.i)).replace('minecraft:', '') : '';
}
function isBaby(e) { return !!(e.isBaby || (e.growAge | 0) < 0); }
function nauseaOf(e) {
  const E = M.Effects;
  if (E && E.getEffect) { const f = E.getEffect(e, 'nausea'); return f ? (f.duration | 0) : 0; }
  const list = e.effects || e.activeEffects;
  if (!list) return 0;
  const f = Array.isArray(list) ? list.find((q) => q && (q.id === 'nausea' || q.type === 'nausea')) : list.nausea;
  return f ? (f.duration | 0) : 0;
}

function engineRun(s, hook) {
  cells.clear(); EL.list.length = 0;
  const glass = S.stateOf('glass'), fill = s.fill === 'air' ? 0 : S.stateOf(s.fill);
  if (s.fill !== 'air' && !fill) return { err: `no engine state ${s.fill}` };
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = -1; y <= H; y++) {
    if (x === 0 && z === 0 && y >= 0 && y < H) { if (y < (s.depth || 0)) w.set(0, y, 0, fill); }
    else w.set(x, y, z, glass);
  }
  const e = EL.spawn(s.mob, 0.5, 0, 0.5);
  if (!e) return { err: 'EL.spawn gives nothing' };
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  applyState(e, s.eng);
  if (hook) hook(e);
  let at = -1, out = null;
  for (let t = 1; t <= T && at < 0; t++) {
    EL.tick();
    const c = EL.list.find((q) => q.type === s.to && !q.removed && Math.floor(q.x) === 0 && Math.floor(q.z) === 0);
    if (c) {
      at = t;
      out = { baby: isBaby(c), health: Math.round(c.health * 100) / 100, main: itemName(c, 'mainhand'), head: itemName(c, 'head'), nausea: nauseaOf(c) };
    }
  }
  return { at, out };
}

const reds = [];
let pass = 0;
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  if (g.at.some((v) => v !== g.at[0])) return [`${s.id}: the server was not constant over reps (${g.at.join('/')}) -- harness`];
  const bad = [];
  const ga = g.at[0];
  const what = `${s.mob} -> ${s.to}`;
  if (ga !== e.at) bad.push(`${s.id}: ${what} converts after ${ga < 0 ? 'never (in ' + T + ')' : ga + ' ticks'} on the server, ${e.at < 0 ? 'never (in ' + T + ')' : e.at + ' ticks'} in the engine`);
  const go = g.out[0];
  if (go && e.out) {
    for (const f of ['baby', 'health', 'main', 'head', 'nausea']) {
      if (f === 'main' && !(s.eng && s.eng.main)) continue;   // random spawn gear (the server's summon has none; the engine's donor keeps its own)
      if (f === 'head' && !(s.eng && s.eng.head)) continue;
      if (go[f] !== e.out[f]) bad.push(`${s.id}: converted ${s.to} ${f} server ${JSON.stringify(go[f])}, engine ${JSON.stringify(e.out[f])}`);
    }
  }
  return bad;
}
console.log(`convrefcheck — mob conversions vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
const ENG = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  let e;
  try { e = engineRun(s); } catch (err) { e = { err: 'engine threw: ' + String(err && err.message || err).slice(0, 120) }; }
  ENG[s.id] = e;
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${s.id.padEnd(24)} server ${g.at[0]} ${JSON.stringify(g.out[0])}\n  ${''.padEnd(24)} engine ${e.err || e.at + ' ' + JSON.stringify(e.out)}`);
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
const same = (s, g, e) => compare(s, g, e).join('|');
{ const s = SCEN.find((q) => q.id === 'hoglin'); const g = JSON.parse(JSON.stringify(golden.cases[s.id])); g.at = g.at.map((v) => v + 1);
  brk('golden hoglin tick +1', same(s, g, ENG[s.id]) !== same(s, golden.cases[s.id], ENG[s.id])); }
{ const s = SCEN.find((q) => q.id === 'husk_water'); const g = JSON.parse(JSON.stringify(golden.cases[s.id])); g.out = g.out.map((o) => (o ? Object.assign({}, o, { health: o.health - 1 }) : o));
  brk('golden zombified health -1', same(s, g, ENG[s.id]) !== same(s, golden.cases[s.id], ENG[s.id])); }
{ const s = SCEN.find((q) => q.id === 'zombie_water'); let e;
  try { e = engineRun(s, (m) => { m.convWarm = true; m.waterConvertTime = 300; }); } catch (err) { e = { err: String(err) }; }
  brk('engine zombie starts 300 ticks into its submerge clock', same(s, golden.cases[s.id], e) !== same(s, golden.cases[s.id], ENG[s.id])); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`convrefcheck: ${pass}/${SCEN.length} scenarios match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
