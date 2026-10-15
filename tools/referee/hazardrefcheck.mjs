#!/usr/bin/env node
// hazardrefcheck.mjs — infra I6 (s142, 25 Sept 2026): BLOCK HAZARDS on mobs vs the real 1.18.2 server (golden: runhazard.mjs,
// hazards.json; scenarios: hazardscen.mjs). Per scenario the engine builds the same 1x1 glass pen with the hazard block
// (floor / feet cell / head cell), spawns the mob (EL.spawn, AI on, seeded), and logs its health every EL.tick for T ticks.
// The server's pens are not perfectly deterministic (a pig shuffles inside its pen), so the judgement is coarse and in both
// directions: does the mob take damage at all; the set of per-hit damage amounts; does it die within T, and if so within 20 %
// of the server's ticks-to-death (measured from the first hit). Anti-vacuity (D-30/D-305): a golden series made harmless,
// the engine's Combat.hurt made a no-op for one scenario, and a golden hit amount doubled are each caught.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, T } from './hazardscen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'hazards.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'hazards.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('hazardrefcheck: golden not generated -- run node tools/referee/runhazard.mjs (skipped)'); process.exit(0); }
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
const { EntityList: EL, Items: IT, Equip: Eq, States: S, Effects: ES } = M;
const SLOTS = [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD];
const PAD = 0;
function stateOf(spec) {
  const m = /^([a-z_]+)(?:\[(.*)\])?$/.exec(spec);
  let st = S.stateOf(m[1]);
  if (st && m[2] && S.withProp) for (const kv of m[2].split(',')) { const [k, v] = kv.split('='); st = S.withProp(st, M.Reg.PROP[k], M.Reg.valueNames.indexOf(v)); }
  return st;
}
function engineSeries(s, hook) {
  cells.clear(); EL.list.length = 0;
  const glass = S.stateOf('glass');
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = PAD; y <= PAD + 3; y++) if (x || z) w.set(x, y, z, glass);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) w.set(x, PAD - 1, z, S.stateOf('stone'));
  const need = [['floor', PAD], ['at', PAD + 1], ['head', PAD + 2]];
  for (const [k, y] of need) if (s[k]) { const st = stateOf(s[k]); if (!st) return { err: `no engine state ${s[k]}` }; w.set(0, y, 0, st); }
  const e = EL.spawn(s.mob, 0.5, PAD + 1, 0.5);
  if (!e) return { err: 'EL.spawn gives nothing' };
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  for (const sl of [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD]) Eq.setEquipped(e, sl, null);
  if (hook) hook(e);
  const series = [e.health];
  for (let t = 0; t < T; t++) {
    EL.tick();
    if (e.removed || e.dead || !(e.health > 0)) break;
    series.push(e.health);
  }
  return { series };
}
function summ(series) {
  const hits = [], at = [];
  for (let i = 1; i < series.length; i++) { const d = series[i - 1] - series[i]; if (d > 1e-4) { hits.push(Math.round(d * 100) / 100); at.push(i); } }
  return { amounts: [...new Set(hits)].sort((a, b) => a - b), n: hits.length, died: series.length < T, toDeath: series.length < T && at.length ? series.length - at[0] : null };
}
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const a = summ(g.series[0]), b = summ(e.series), out = [];
  const where = `${s.mob} ${s.at ? 'in ' + s.at : ''}${s.head ? ' (head: ' + s.head + ')' : ''}${!s.at && !s.head ? 'on ' + s.floor : s.floor !== 'stone' ? ' on ' + s.floor : ''}`;
  if ((a.n > 0) !== (b.n > 0)) return [`${s.id}: ${where}: server ${a.n ? `takes ${a.n} hits (${a.amounts.join('/')} each)` : 'takes no damage'}, engine ${b.n ? `takes ${b.n} hits (${b.amounts.join('/')} each)` : 'takes no damage'}`];
  if (a.n && JSON.stringify(a.amounts) !== JSON.stringify(b.amounts)) out.push(`${s.id}: ${where}: hit amounts server ${a.amounts.join('/')} engine ${b.amounts.join('/')}`);
  if (a.died !== b.died) out.push(`${s.id}: ${where}: server ${a.died ? `dies ${a.toDeath} ticks after the first hit` : 'survives ' + T + ' ticks'}, engine ${b.died ? `dies ${b.toDeath} ticks after the first hit` : 'survives'}`);
  else if (a.died && Math.abs(a.toDeath - b.toDeath) > 0.2 * a.toDeath + 2) out.push(`${s.id}: ${where}: dies ${a.toDeath} ticks after the first hit on the server, ${b.toDeath} in the engine`);
  return out;
}
const reds = [];
let pass = 0, breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`hazardrefcheck — block hazards on mobs vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
const ENG = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineSeries(s);
  ENG[s.id] = e;
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) { const a = summ(g.series[0]), b = e.err ? null : summ(e.series); console.log(`  ${s.id.padEnd(20)} server n${a.n} [${a.amounts}] death ${a.toDeath}  |  engine ${e.err || `n${b.n} [${b.amounts}] death ${b.toDeath}`}`); }
}
const greenOf = (pred) => SCEN.find((s) => pred(s) && golden.cases[s.id] && ENG[s.id] && compare(s, golden.cases[s.id], ENG[s.id]).length === 0);
{ const s = greenOf((q) => summ(golden.cases[q.id].series[0]).n > 0) || SCEN[3]; const g = { series: golden.cases[s.id].series.map((q) => q.map(() => q[0])) };
  brk(`golden ${s.id} made harmless`, compare(s, g, ENG[s.id]).length > 0); }
{ const s = greenOf((q) => summ(golden.cases[q.id].series[0]).n > 0) || SCEN[3]; const orig = M.Combat.hurt; M.Combat.hurt = () => false;
  const e = engineSeries(s); M.Combat.hurt = orig; brk(`engine Combat.hurt no-op (${s.id})`, compare(s, golden.cases[s.id], e).length > 0); }
{ const s = greenOf((q) => summ(golden.cases[q.id].series[0]).n > 0) || SCEN[3]; const g = { series: golden.cases[s.id].series.map((q) => q.map((v, i) => (i ? q[0] - 2 * (q[0] - v) : v))) };
  brk(`golden ${s.id} hit amounts doubled`, compare(s, g, ENG[s.id]).length > 0); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`hazardrefcheck: ${pass}/${SCEN.length} scenarios agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
