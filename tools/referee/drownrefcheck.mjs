#!/usr/bin/env node
// drownrefcheck.mjs — infra W (drown unit, 25 Sept 2026): MOB DROWNING / AIR SUPPLY on mobs vs the real 1.18.2
// server (golden: rundrown.mjs, drown.json; scenarios: drownscen.mjs). Per scenario the engine builds the same
// 1x1 glass pen (floor / feet cell / head cell / lid), spawns the mob (EL.spawn, AI on, seeded), applies the
// Water Breathing effect where the scenario asks for one, and logs its Health AND whatever air field the engine
// keeps (e.air for axolotl/player-shaped mobs, e.squidAir for squid, e.fishAir for cod -- src/07*.js's own field
// names, `grep -n -i 'air\|drown\|breath' src/07*.js src/14*.js`) every EL.tick for T ticks. The server's pens are
// not perfectly deterministic, so the judgement is coarse and in both directions: does the mob take damage at
// all; the set of per-hit damage amounts; does it die within T, and if so within 20% of the server's
// ticks-to-death (measured from the first hit); and, where the engine tracks an air field at all, does its
// series start and end land in the same ballpark as the server's `Air` NBT short. Anti-vacuity (D-30/D-305): a
// golden series made harmless, the engine's Combat.hurt made a no-op for one scenario, and a golden hit amount
// doubled are each caught.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, T } from './drownscen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'drown.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'drown.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('drownrefcheck: golden not generated -- run node tools/referee/rundrown.mjs (skipped)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
let seed = 0x0d40b1e5;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// The engine as the game builds it (the hazardrefcheck loader, same BASE_MODS + every 07*.js mob module).
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
// Squid/Fish gate their own per-tick air-drowning behind a `.ready` flag `07i_entitylist.js`'s
// tick loop checks (`Sq.ready`/`Fish.ready`, set only by `Sq.init`/`Fish.init` -- `src/17_main.js`'s
// own real boot sequence calls both; the hazardrefcheck loader this file was modelled on never
// spawns a squid or a fish, so it never needed them). Axolotl and turtle set `.ready` true at
// module load unconditionally and need no such call.
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.EntityList.random = rng;
Math.random = rng;
const { EntityList: EL, Items: IT, Equip: Eq, States: S, Effects: ES } = M;
const PAD = 0;
function stateOf(spec) {
  const m = /^([a-z_]+)(?:\[(.*)\])?$/.exec(spec);
  let st = S.stateOf(m[1]);
  if (st && m[2] && S.withProp) for (const kv of m[2].split(',')) { const [k, v] = kv.split('='); st = S.withProp(st, k, v); }
  return st;
}
// The one engine field each per-scenario mob keeps its own air counter under -- src/07*.js's own names
// (07zi_squid.js's `squidAir`, 07zj_fish.js's `fishAir`, 07zm_axolotl.js/14d_survival.js's plain `air`). A mob
// with none of these (pig, cow, zombie, skeleton, turtle, dolphin -- confirmed by `grep -n -i 'air\b' src/07*.js
// src/14*.js`: no generic LivingEntity.baseTick air/drowning port exists) reports `null`, and the comparison
// below then judges Health alone for it, exactly as the task's "compare... where the engine has an air field" asks.
function airOf(e) {
  if (e.squidAir !== undefined) return e.squidAir;
  if (e.fishAir !== undefined) return e.fishAir;
  if (e.air !== undefined) return e.air;
  return null;
}
function engineSeries(s, hook) {
  cells.clear(); EL.list.length = 0;
  const glass = S.stateOf('glass');
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = PAD; y <= PAD + 4; y++) if (x || z) w.set(x, y, z, glass);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) w.set(x, PAD - 1, z, S.stateOf('stone'));
  const need = [['floor', PAD], ['at', PAD + 1], ['head', PAD + 2], ['lid', PAD + 3]];
  for (const [k, y] of need) if (s[k]) { const st = stateOf(s[k]); if (!st) return { err: `no engine state ${s[k]}` }; w.set(0, y, 0, st); }
  const e = EL.spawn(s.mob, 0.5, PAD + 1, 0.5);
  if (!e) return { err: 'EL.spawn gives nothing' };
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  for (const sl of [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD]) Eq.setEquipped(e, sl, null);
  if (s.effect && ES && ES.addStatusEffect) ES.addStatusEffect(e, s.effect, 1000000, 0, false, true);
  if (hook) hook(e);
  const T_ = s.t || T;
  const series = [e.health], airSeries = [airOf(e)];
  for (let t = 0; t < T_; t++) {
    EL.tick();
    if (e.removed || e.dead || !(e.health > 0)) break;
    series.push(e.health);
    airSeries.push(airOf(e));
  }
  return { series, airSeries };
}
function summ(series) {
  const hits = [], at = [];
  for (let i = 1; i < series.length; i++) { const d = series[i - 1] - series[i]; if (d > 1e-4) { hits.push(Math.round(d * 100) / 100); at.push(i); } }
  // `died`/`toDeath` are relative to whatever T the caller ran this series for -- `compare` below
  // knows the scenario's own T_ and computes aDied/bDied itself; `toDeath` here only needs at[0].
  return { amounts: [...new Set(hits)].sort((a, b) => a - b), n: hits.length, toDeath: at.length ? series.length - at[0] : null };
}
function airSumm(arr) {
  // Entry 0 can be `null` for a field the engine only lazily creates on its first EL.tick() (an
  // axolotl's `e.air`, set inside `Ax.tickAir` rather than at `EL.spawn`) -- skip leading/trailing
  // nulls rather than let one poison the direction comparison below.
  if (!arr || !arr.length) return null;
  const vals = arr.filter((v) => v !== null && v !== undefined);
  if (!vals.length) return null;
  // a bob through the surface dips the air for up to ~7 ticks then refills +4/tick: a run that happens to END mid-dip
  // is not a drowning, so the end is the best air over the last 8 samples (a real drowning is still falling there)
  return { start: vals[0], end: Math.max(...vals.slice(-8)) };
}
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const T_ = s.t || T;
  const a = summ(g.series[0]), b = summ(e.series);
  const aDied = g.series[0].length < T_, bDied = e.series.length < T_;
  const out = [];
  const where = `${s.mob}${s.at ? (s.head ? ' fully submerged' : ' in feet-deep water') : ' on dry stone'}${s.effect ? ` (${s.effect})` : ''}`;
  if ((a.n > 0) !== (b.n > 0)) return [`${s.id}: ${where}: server ${a.n ? `takes ${a.n} hits (${a.amounts.join('/')} each)` : 'takes no damage'}, engine ${b.n ? `takes ${b.n} hits (${b.amounts.join('/')} each)` : 'takes no damage'}`];
  if (a.n && JSON.stringify(a.amounts) !== JSON.stringify(b.amounts)) out.push(`${s.id}: ${where}: hit amounts server ${a.amounts.join('/')} engine ${b.amounts.join('/')}`);
  if (aDied !== bDied) out.push(`${s.id}: ${where}: server ${aDied ? `dies ${a.toDeath} ticks after the first hit` : 'survives ' + T_ + ' ticks'}, engine ${bDied ? `dies ${b.toDeath} ticks after the first hit` : 'survives'}`);
  else if (aDied && a.toDeath != null && b.toDeath != null && Math.abs(a.toDeath - b.toDeath) > 0.2 * a.toDeath + 2) out.push(`${s.id}: ${where}: dies ${a.toDeath} ticks after the first hit on the server, ${b.toDeath} in the engine`);
  const ga = airSumm(g.airSeries ? g.airSeries[0] : null), ea = airSumm(e.airSeries);
  if (ea) { // the engine tracks SOME air field for this mob -- compare it to the server's real NBT Air
    // a few points of air is the mob bobbing up through the surface in its first ticks (1-3 points), not a drowning series
    if (!ga) out.push(`${s.id}: ${where}: engine keeps an air field (${ea.start}->${ea.end}) the server's own golden capture is missing (bug in rundrown.mjs, not a finding)`);
    else if (Math.sign(Math.abs(ea.end - ea.start) > 3 ? ea.end - ea.start : 0) !== Math.sign(Math.abs(ga.end - ga.start) > 3 ? ga.end - ga.start : 0)) out.push(`${s.id}: ${where}: air series server ${ga.start}->${ga.end}, engine ${ea.start}->${ea.end} (opposite direction)`);
  }
  return out;
}
const reds = [];
let pass = 0, breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`drownrefcheck — mob drowning / air supply vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
const ENG = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineSeries(s);
  ENG[s.id] = e;
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) {
    const a = summ(g.series[0]), ga = airSumm(g.airSeries ? g.airSeries[0] : null);
    const b = e.err ? null : summ(e.series), ea = e.err ? null : airSumm(e.airSeries);
    console.log(`  ${s.id.padEnd(22)} server n${a.n} [${a.amounts}] death ${a.toDeath} air ${ga ? `${ga.start}->${ga.end}` : 'n/a'}` +
      `  |  engine ${e.err || `n${b.n} [${b.amounts}] death ${b.toDeath} air ${ea ? `${ea.start}->${ea.end}` : 'n/a'}`}`);
  }
}
const greenOf = (pred) => SCEN.find((s) => pred(s) && golden.cases[s.id] && ENG[s.id] && compare(s, golden.cases[s.id], ENG[s.id]).length === 0);
{ const s = greenOf((q) => summ(golden.cases[q.id].series[0]).n > 0) || SCEN[0]; const g = { series: golden.cases[s.id].series.map((q) => q.map(() => q[0])), airSeries: golden.cases[s.id].airSeries };
  brk(`golden ${s.id} made harmless`, compare(s, g, ENG[s.id]).length > 0); }
{ const s = greenOf((q) => summ(golden.cases[q.id].series[0]).n > 0) || SCEN[0]; const orig = M.Combat.hurt; M.Combat.hurt = () => false;
  const e = engineSeries(s); M.Combat.hurt = orig; brk(`engine Combat.hurt no-op (${s.id})`, compare(s, golden.cases[s.id], e).length > 0); }
{ const s = greenOf((q) => summ(golden.cases[q.id].series[0]).n > 0) || SCEN[0]; const g = { series: golden.cases[s.id].series.map((q) => q.map((v, i) => (i ? q[0] - 2 * (q[0] - v) : v))), airSeries: golden.cases[s.id].airSeries };
  brk(`golden ${s.id} hit amounts doubled`, compare(s, g, ENG[s.id]).length > 0); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`drownrefcheck: ${pass}/${SCEN.length} scenarios agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
