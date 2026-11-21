#!/usr/bin/env node
// arrowrefcheck.mjs — infra I6 (25 Sept 2026): ARROW HIT DAMAGE (#6090: pull curve, Power, crit, armour) vs the real 1.18.2 server (golden: runarrow.mjs,
// arrow.json; scenarios: arrowscen.mjs). Per scenario the engine builds the same stone floor, spawns the target (EL.spawn,
// the engine's own equipment slots + enchantment tags, Resistance through Effects.addStatusEffect, AI disabled), spawns an
// owner-less arrow (EL.spawn('arrow') with the scenario's velocity and `arrowDamage`) 2 blocks in front of it, runs T ticks of
// EL.tick, and compares the health kept with the server's (float, |diff| <= 0.001; the server must be constant over reps).
// Anti-vacuity (D-30/D-305): a golden health shifted by 0.5, the engine's Resistance switched off, and the engine arrow's
// damage field doubled are each caught. Mismatches are FINDINGS (red, exit 1).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, T, HIT_Y, START_DZ } from './arrowscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(MCLITE_ROOT, 'tools', 'referee', 'golden', 'arrow.json'), join(refDir, 'golden', 'arrow.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'arrow.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('arrowrefcheck: golden not generated -- run node tools/referee/runarrow.mjs (skipped)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
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
const { EntityList: EL, Items: IT, Equip: Eq, States: S } = M;
const SLOTS = [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD];
const PAD = 0;

function engineHealth(s, hook, critRnd) {
  cells.clear(); EL.list.length = 0;
  const stone = S.stateOf('stone');
  for (let x = -3; x <= 3; x++) for (let z = -5; z <= 5; z++) w.set(x, PAD, z, stone);
  const e = EL.spawn(s.mob, 0.5, PAD + 1, 0.5);
  if (!e) return { err: 'EL.spawn gives nothing' };
  e.persistent = true; e.aiDisabled = true; e.vx = e.vy = e.vz = 0;
  for (const sl of SLOTS) Eq.setEquipped(e, sl, null);
  for (const a of s.armor) {
    const st = { i: IT.of(a.item), n: 1 };
    if (!st.i) return { err: `no engine item ${a.item}` };
    if (a.ench) st.t = { Enchantments: a.ench.map(([id, l]) => ({ id: 'minecraft:' + id, lvl: l })) };
    Eq.setEquipped(e, SLOTS[a.slot], st);
  }
  if (s.resist !== undefined) M.Effects.addStatusEffect(e, 'resistance', 100000, s.resist, false, false);
  const before = e.health;
  const ar = EL.spawn('arrow', 0.5, PAD + 1 + HIT_Y, 0.5 + START_DZ, { vx: 0, vy: 0, vz: s.v });
  if (!ar) return { err: 'EL.spawn(arrow) gives nothing' };
  ar.vx = 0; ar.vy = 0; ar.vz = s.v; ar.arrowDamage = s.d;
  if (s.crit) { ar.critical = true; ar.rnd = critRnd || rng; }
  if (hook) hook(e, ar);
  for (let t = 0; t < T; t++) EL.tick();
  const gone = e.removed || e.dead || !(e.health > 0);
  return { before, after: gone ? -1 : e.health };
}

const reds = [];
let pass = 0;
const f3 = (v) => (v < 0 ? 'died' : (Math.round(v * 10000) / 10000).toString());
function compare(s, g, e, eLo, eHi) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const lost = (b, a) => (a < 0 ? -1 : b - a);
  if (s.crit) {
    // the crit bonus is nextInt(ceil/2 + 2): the server's hits spread; each must lie in the engine's [bonus 0, bonus max] range
    const lo = lost(eLo.before, eLo.after), hi = lost(eHi.before, eHi.after);
    const bad = g.after.map((a, i) => lost(g.before[i], a)).filter((l) => l !== -1 && (l < lo - 0.001 || l > hi + 0.001) || (l === -1 && hi !== -1));
    return bad.length ? [`${s.id}: server hits ${g.after.map((a, i) => f3(lost(g.before[i], a))).join('/')} outside the engine's crit range [${f3(lo)}, ${f3(hi)}]`] : [];
  }
  const ga = g.after[0];
  if (g.after.some((v) => v !== ga) || g.before.some((v) => v !== g.before[0])) return [`${s.id}: the server was not constant over reps (${g.after.join('/')}) -- harness`];
  const lostG = lost(g.before[0], ga), lostE = lost(e.before, e.after);
  if ((lostG < 0) !== (lostE < 0) || Math.abs(lostG - lostE) > 0.001) {
    return [`${s.id}: ${s.mob} hit by an arrow v=${s.v} damage=${s.d}: server loses ${f3(lostG)}, engine ${f3(lostE)}`];
  }
  return [];
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) { caught++; console.log(`  ✓ break caught: ${name}`); } else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`arrowrefcheck — arrow hit damage vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
const ENG = {}, LO = {}, HI = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineHealth(s);
  ENG[s.id] = e;
  if (s.crit) { LO[s.id] = engineHealth(s, null, () => 0); HI[s.id] = engineHealth(s, null, () => 0.9999999); }
  const bad = compare(s, g, e, LO[s.id], HI[s.id]);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${s.id.padEnd(28)} server ${g.after.map((a, i) => f3(a < 0 ? -1 : g.before[i] - a)).join('/')}  engine ${e.err || f3(e.after < 0 ? -1 : e.before - e.after)}`);
}
const cmp = (id, g, e) => compare(SCEN.find((q) => q.id === id), g, e, LO[id], HI[id]);
{ const id = 'zombie_10t_plain'; const g = JSON.parse(JSON.stringify(golden.cases[id])); g.after = g.after.map((v) => v - 0.5);
  brk('golden health -0.5', cmp(id, g, ENG[id]).length > 0); }
{ const id = 'zombie_10t_plain', s = SCEN.find((q) => q.id === id), orig = M.Combat.arrowHitDamage;
  M.Combat.arrowHitDamage = (e) => Math.floor(Math.sqrt(e.vx * e.vx + e.vy * e.vy + e.vz * e.vz) * e.arrowDamage);
  const e = engineHealth(s); M.Combat.arrowHitDamage = orig;
  brk('ceil replaced by floor', cmp(id, golden.cases[id], e).length > 0); }
{ const id = 'zombie_bare_20t_crit', s = SCEN.find((q) => q.id === id), orig = M.Combat.arrowCritBonus;
  M.Combat.arrowCritBonus = (d) => d * 1.25;
  const lo = engineHealth(s, null, () => 0), hi = engineHealth(s, null, () => 0.9999999); M.Combat.arrowCritBonus = orig;
  brk('crit factor 1.25', compare(s, golden.cases[id], ENG[id], lo, hi).length > 0); }
{ const id = 'zombie_20t_power3', s = SCEN.find((q) => q.id === id);
  const e = engineHealth(s, (t, ar) => { ar.arrowDamage = 2; });
  brk('Power ignored', cmp(id, golden.cases[id], e).length > 0); }
{ const id = 'zombie_5t_plain', s = SCEN.find((q) => q.id === id);
  const e = engineHealth(s, (t, ar) => { ar.vz = 3; });
  brk('pull curve ignored (full speed)', cmp(id, golden.cases[id], e).length > 0); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`arrowrefcheck: ${pass}/${SCEN.length} scenarios agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
