#!/usr/bin/env node
// effectrefcheck.mjs — infra I6 (s142, 25 Sept 2026): STATUS EFFECTS on mobs vs the real 1.18.2 server (golden:
// runeffect.mjs, effects.json; scenarios: effectscen.mjs). Per scenario the engine spawns the mob (EL.spawn, AI disabled,
// health set, the scenario's armour/Resistance through the engine's own equipment slots and Effects.addStatusEffect), then
// gives the effect exactly as `/effect give` does (Effects.addStatusEffect: the canHaveStatusEffect gate; an instant effect
// applies at once) and logs its health after every EL.tick for T ticks. Judged per scenario (effectscen.summarize): the
// ordered list of health values after each change (0.001), the tick gaps between changes (exact), whether it died, and if so
// how many ticks after the first change. Anti-vacuity (D-30/D-305): a golden step shifted by 1, the engine's poison cadence
// changed 25 -> 20, and the engine's undead-refuses-regeneration gate removed are each caught. Mismatches are FINDINGS.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, T, summarize } from './effectscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'effects.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'effects.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('effectrefcheck: golden not generated -- run node tools/referee/runeffect.mjs (skipped)'); process.exit(0); }
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

function engineSeries(s) {
  cells.clear(); EL.list.length = 0;
  const stone = S.stateOf('stone');
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) w.set(x, PAD, z, stone);
  const e = EL.spawn(s.mob, 0.5, PAD + 1, 0.5);
  if (!e) return { err: 'EL.spawn gives nothing' };
  e.persistent = true; e.aiDisabled = true; e.vx = e.vy = e.vz = 0; e.health = s.hp;
  for (const sl of SLOTS) Eq.setEquipped(e, sl, null);
  if (/diamond_boots/.test(s.nbt || '')) ['diamond_boots', 'diamond_leggings', 'diamond_chestplate', 'diamond_helmet'].forEach((it, i) =>
    Eq.setEquipped(e, SLOTS[i], { i: IT.of(it), n: 1, t: { Enchantments: [{ id: 'minecraft:protection', lvl: 4 }] } }));
  if (/Id:11b/.test(s.nbt || '')) ES.addStatusEffect(e, 'resistance', 100000, 1, false, false);
  // EffectCommand.executeGive (.decomp EffectCommand.java:101-106): an INSTANT effect's duration is the seconds argument as
  // TICKS (1), every other effect's is seconds x 20 -- then LivingEntity.addStatusEffect, as here.
  ES.addStatusEffect(e, s.eff, /^instant_/.test(s.eff) ? s.secs : s.secs * 20, s.amp, false, false);
  const series = [e.health];   // entry 0 = before any tick, like the server's log (tick functions run before the world)
  for (let t = 0; t < T; t++) {
    EL.tick();
    if (e.removed || e.dead || !(e.health > 0)) break;
    series.push(e.health);
  }
  return { series };
}
const f3 = (v) => String(Math.round(v * 1000) / 1000);
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const gs = g.series.map((q) => summarize(q, s.hp)), es = summarize(e.series, s.hp);
  const a = gs[0];
  if (gs.some((q) => JSON.stringify(q.steps) !== JSON.stringify(a.steps) || JSON.stringify(q.gaps) !== JSON.stringify(a.gaps) || q.len !== a.len)) return [`${s.id}: the server was not constant over reps -- harness`];
  const out = [];
  const what = `${s.mob} ${s.eff} ${s.amp + 1} for ${s.secs}s from ${s.hp} hp${s.nbt ? (/diamond/.test(s.nbt) ? ' (diamond + Protection IV)' : ' (Resistance II)') : ''}`;
  const sameSteps = a.steps.length === es.steps.length && a.steps.every((v, i) => Math.abs(v - es.steps[i]) <= 0.001);
  if (!sameSteps) out.push(`${s.id}: ${what}: health steps server [${a.steps.map(f3).join(',')}] engine [${es.steps.map(f3).join(',')}]`);
  else if (JSON.stringify(a.gaps) !== JSON.stringify(es.gaps)) out.push(`${s.id}: ${what}: ticks between changes server [${a.gaps.join(',')}] engine [${es.gaps.join(',')}]`);
  const gDied = a.len < T, eDied = es.len < T;
  if (gDied !== eDied) out.push(`${s.id}: ${what}: server ${gDied ? 'dies' : 'survives'}, engine ${eDied ? 'dies' : 'survives'}`);
  else if (gDied && (a.len - a.first) !== (es.len - es.first)) out.push(`${s.id}: ${what}: dies ${a.len - a.first} ticks after the first hit on the server, ${es.len - es.first} in the engine`);
  return out;
}
const reds = [];
let pass = 0, breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`effectrefcheck — status effects on mobs vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
const ENG = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineSeries(s);
  ENG[s.id] = e;
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) { const a = summarize(g.series[0], s.hp), b = e.err ? null : summarize(e.series, s.hp);
    console.log(`  ${s.id.padEnd(30)} server steps ${a.steps.length} gaps ${a.gaps.slice(0, 4).join(',')} final ${f3(a.final)} len ${a.len}  |  engine ${e.err || `steps ${b.steps.length} gaps ${b.gaps.slice(0, 4).join(',')} final ${f3(b.final)} len ${b.len}`}`); }
}
{ const s = SCEN.find((q) => q.id === 'pig_poison1'); const g = JSON.parse(JSON.stringify(golden.cases[s.id]));
  g.series = g.series.map((q) => q.map((v) => (v < 10 ? v - 1 : v)));
  brk('golden pig_poison1 every step -1', compare(s, g, ENG[s.id]).length > compare(s, golden.cases[s.id], ENG[s.id]).length); }
{ const s = SCEN.find((q) => q.id === 'pig_poison1'); const orig = ES.TICK_INTERVAL_BASE.poison; ES.TICK_INTERVAL_BASE.poison = 20;
  const e = engineSeries(s); ES.TICK_INTERVAL_BASE.poison = orig;
  brk('engine poison cadence 25 -> 20', compare(s, golden.cases[s.id], e).length > 0); }
{ const s = SCEN.find((q) => q.id === 'zombie_regen'); const orig = ES.isUndead; ES.isUndead = () => false;
  const e = engineSeries(s); ES.isUndead = orig;
  brk('engine undead gate removed (zombie_regen)', compare(s, golden.cases[s.id], e).length > 0); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`effectrefcheck: ${pass}/${SCEN.length} scenarios agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
