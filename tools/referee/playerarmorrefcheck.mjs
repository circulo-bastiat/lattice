#!/usr/bin/env node
// playerarmorrefcheck.mjs — infra I6 (s142, 25 Sept 2026): the PLAYER's damage through armour vs the real 1.18.2 server
// (golden: runplayerarmor.mjs, player-armor.json; scenarios: armorscen.mjs's skeleton scenes worn by a real survival player).
// Engine side, through the joins the game uses: a player object built by Survival.init, its armour in inventory slots
// ARMOR_START..+3 (feet, legs, chest, head — enchantments in the stack's `t.Enchantments`, as every other reader), turned
// into e.armor/e.armorToughness by Survival.updateArmor (what 14_player.js:523 runs every tick), Resistance through
// Effects.addStatusEffect; then an owner-less arrow (EL.spawn('arrow')) whose Cb.tickArrow hit lands in Survival.hurt.
// Judged: health lost within 0.001. Anti-vacuity (D-30/D-305): a golden health -0.5, the engine's armour formula switched
// off (Survival.afterArmor -> identity), the arrow's damage doubled. Mismatches are FINDINGS (red, exit 1).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN as ALL, HIT_Y, START_DZ } from './armorscen.mjs';
const SCEN = ALL.filter((s) => s.mob === 'skeleton');
const T = 20;
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'player-armor.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'player-armor.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('playerarmorrefcheck: golden not generated -- run node tools/referee/runplayerarmor.mjs (skipped)'); process.exit(0); }
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
const { Survival: Sv, Inventory: Iv } = M;
if (!Sv || !Iv) { console.log('playerarmorrefcheck: engine has no Survival/Inventory module loaded'); process.exit(1); }
const PAD = 0;
function engineHealth(s, hook) {
  cells.clear(); EL.list.length = 0;
  const stone = S.stateOf('stone');
  for (let x = -3; x <= 3; x++) for (let z = -5; z <= 5; z++) w.set(x, PAD, z, stone);
  const P = { x: 0.5, y: PAD + 1, z: 0.5, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, type: 'player', inventory: { slots: new Array(46).fill(null) } };
  Sv.init(P);
  for (const a of s.armor) {
    const st = { i: IT.of(a.item), n: 1 };
    if (!st.i) return { err: `no engine item ${a.item}` };
    if (a.ench) st.t = { Enchantments: a.ench.map(([id, l]) => ({ id: 'minecraft:' + id, lvl: l })) };
    P.inventory.slots[Iv.ARMOR_START + a.slot] = st;
  }
  Sv.updateArmor(P, P.inventory);
  M.Player = P;
  if (s.resist !== undefined) M.Effects.addStatusEffect(P, 'resistance', 100000, s.resist, false, false);
  const before = P.health;
  const ar = EL.spawn('arrow', 0.5, PAD + 1 + HIT_Y, 0.5 + START_DZ, { vx: 0, vy: 0, vz: s.v });
  if (!ar) return { err: 'EL.spawn(arrow) gives nothing' };
  ar.vx = 0; ar.vy = 0; ar.vz = s.v; ar.arrowDamage = s.d;
  if (hook) hook(P, ar);
  for (let t = 0; t < T; t++) EL.tick();
  return { before, after: P.dead ? -1 : P.health };
}
const reds = [];
let pass = 0;
const f3 = (v) => (v < 0 ? 'died' : (Math.round(v * 10000) / 10000).toString());
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const ga = g.after[0];
  if (g.after.some((v) => v !== ga) || g.before.some((v) => v !== 20)) return [`${s.id}: the server was not constant over reps (${g.after.join('/')}) -- harness`];
  const lostG = g.before[0] - ga, lostE = e.after < 0 ? -1 : e.before - e.after;
  if (Math.abs(lostG - lostE) > 0.001) {
    const armorTxt = s.armor.length ? s.armor.map((a) => a.item + (a.ench ? '+' + a.ench.map((q) => q.join(' ')).join(',') : '')).join(' ') : 'no armour';
    return [`${s.id}: PLAYER (${armorTxt}${s.resist !== undefined ? ', Resistance ' + (s.resist + 1) : ''}) hit by an arrow v=${s.v} damage=${s.d}: server loses ${f3(lostG)}, engine ${f3(lostE)}`];
  }
  return [];
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`playerarmorrefcheck — the player's damage through armour/Protection/Resistance vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
const ENG = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineHealth(s);
  ENG[s.id] = e;
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${s.id.padEnd(28)} server ${f3(g.before[0] - g.after[0])}  engine ${e.err || f3(e.before - e.after)}`);
}
{ const s = SCEN.find((q) => q.id === 'skel_bare_v3'); const g = JSON.parse(JSON.stringify(golden.cases[s.id])); g.after = g.after.map((v) => v - 0.5);
  brk('golden skel_bare_v3 health -0.5', compare(s, g, ENG[s.id]).length > 0); }
{ const s = SCEN.find((q) => q.id === 'skel_iron'); const orig = Sv.afterArmor; Sv.afterArmor = (d) => d;
  const e = engineHealth(s); Sv.afterArmor = orig;
  brk('engine armour formula off (skel_iron)', compare(s, golden.cases[s.id], e).length > 0); }
{ const s = SCEN.find((q) => q.id === 'skel_bare_v3'); const e = engineHealth(s, (p, ar) => { ar.arrowDamage = s.d * 2; });
  brk('engine arrow damage doubled (skel_bare_v3)', compare(s, golden.cases[s.id], e).length > 0); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`playerarmorrefcheck: ${pass}/${SCEN.length} scenarios agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
