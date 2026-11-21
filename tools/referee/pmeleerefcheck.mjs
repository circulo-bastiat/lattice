#!/usr/bin/env node
// pmeleerefcheck.mjs — infra I6 (s143, 25 Sept 2026): ONE full-cooldown PLAYER melee blow vs the real 1.18.2 server (golden:
// runpmelee.mjs, player-melee.json — a growbot's own Attack packet; scenarios: pmeleescen.mjs). Engine side, through the join
// the game's left-click uses: Combat.attack(P, target) with the weapon in hotbar slot 0 (P.slot), Hand.attackStrengthTicker
// full, Strength/Weakness by Effects.addStatusEffect, a crit by P.fallDistance 0.1 / !onGround, the target spawned by
// EL.spawn (max health 100, NBT-form: no gear) with Equip.setEquipped armour; the sweep neighbour 1 block +x. Judged: health
// lost by the target (and the neighbour) within 0.001. Anti-vacuity (D-30/D-305): a golden loss +0.5, the engine's
// enchantment bonus off (Combat.damageBonus -> 0) on a Smite scene, the engine's crit multiplier off on a crit scene.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, DZ, SWEEP_DX } from './pmeleescen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'player-melee.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'player-melee.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('pmeleerefcheck: golden not generated -- run node tools/referee/runpmelee.mjs (skipped)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
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
// the weapon attribute table from the SAME golden file gen-data.mjs inlines into DATA.itemAttrs (the mobpickupcheck recipe, D-335)
{
  const tsv = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8');
  const table = {};
  for (const line of tsv.split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r16 = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r16(c[6]), r16(c[7]), +c[8]];
  }
  if (!(M.Hand.bindAttrs(table) > 0)) { console.log('pmeleerefcheck: empty item attribute table'); process.exit(1); }
}
if (M.Combat.init) M.Combat.init();
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
if (!Sv || !Iv) { console.log('pmeleerefcheck: engine has no Survival/Inventory module loaded'); process.exit(1); }
const PAD = 0;
const SLOTS = [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD];
function engineLoss(s, hook) {
  cells.clear(); EL.list.length = 0;
  const stone = S.stateOf('stone');
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 6; z++) w.set(x, PAD, z, stone);
  const P = { x: 0.5, y: PAD + 1, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, fallDistance: 0, width: 0.6, height: 1.8,
    type: 'player', slot: 0, sprinting: false, inventory: { slots: new Array(46).fill(null), selected: 0 } };
  Sv.init(P);
  if (s.weapon) {
    const st = { i: IT.of(s.weapon.item), n: 1 };
    if (!st.i) return { err: `no engine item ${s.weapon.item}` };
    if (s.weapon.ench) st.t = { Enchantments: s.weapon.ench.map(([id, l]) => ({ id: 'minecraft:' + id, lvl: l })) };
    P.inventory.slots[0] = st;
  }
  M.Player = P;
  if (s.effect) M.Effects.addStatusEffect(P, s.effect[0], 100000, s.effect[1], false, false);
  const mk = (x) => {
    const e = EL.spawn(s.target, x, PAD + 1, 0.5 + DZ);
    if (!e) return null;
    e.persistent = true; e.noAI = true; e.vx = e.vy = e.vz = 0;
    for (const sl of SLOTS) Eq.setEquipped(e, sl, null);
    if (s.targetArmor) ['boots', 'leggings', 'chestplate', 'helmet'].forEach((p, i) => Eq.setEquipped(e, SLOTS[i], { i: IT.of(`${s.targetArmor}_${p}`), n: 1 }));
    e.maxHealth = 100; e.health = 100;
    return e;
  };
  const e = mk(0.5), e2 = s.sweep ? mk(0.5 + SWEEP_DX) : null;
  if (!e || (s.sweep && !e2)) return { err: `EL.spawn(${s.target}) gives nothing` };
  if (s.crit) { P.onGround = false; P.fallDistance = 0.1; }
  M.Hand.attackStrengthTicker = 1000;
  if (hook) hook(P, e);
  M.Combat.attack(P, e);
  return { lost: 100 - e.health, lost2: e2 ? 100 - e2.health : null };
}
const reds = [];
let pass = 0;
const f3 = (v) => (Math.round(v * 10000) / 10000).toString();
const wTxt = (s) => (s.weapon ? s.weapon.item + (s.weapon.ench ? '+' + s.weapon.ench.map((q) => q.join(' ')).join(',') : '') : 'bare hand');
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const out = [];
  if (g.lost.some((v) => v !== g.lost[0])) return [`${s.id}: the server was not constant over reps (${g.lost.join('/')}) -- harness`];
  const what = `PLAYER hits a ${s.target}${s.targetArmor ? ' in ' + s.targetArmor + ' armour' : ''} with ${wTxt(s)}${s.effect ? ' under ' + s.effect[0] + ' ' + (s.effect[1] + 1) : ''}${s.crit ? ' (crit)' : ''}`;
  if (Math.abs(g.lost[0] - e.lost) > 0.001) out.push(`${s.id}: ${what}: server loses ${f3(g.lost[0])}, engine ${f3(e.lost)}`);
  if (s.sweep && Math.abs(g.lost2[0] - e.lost2) > 0.001) out.push(`${s.id}: ${what}: the swept neighbour loses ${f3(g.lost2[0])} on the server, ${f3(e.lost2)} in the engine`);
  return out;
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`pmeleerefcheck — one full-cooldown player melee blow vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
const ENG = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineLoss(s);
  ENG[s.id] = e;
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${s.id.padEnd(24)} server ${f3(g.lost[0])}${s.sweep ? ' / ' + f3(g.lost2[0]) : ''}  engine ${e.err || f3(e.lost) + (s.sweep ? ' / ' + f3(e.lost2) : '')}`);
}
{ const s = SCEN.find((q) => q.id === 'pig_smite5'); const g = JSON.parse(JSON.stringify(golden.cases[s.id])); g.lost = g.lost.map((v) => v + 0.5);
  brk('golden pig_smite5 loss +0.5', compare(s, g, ENG[s.id]).length > 0); }
{ const s = SCEN.find((q) => q.id === 'zombie_smite5'); const orig = M.Combat.damageBonus; M.Combat.damageBonus = () => 0;
  const e = engineLoss(s); M.Combat.damageBonus = orig; brk('engine enchantment bonus off (zombie_smite5)', compare(s, golden.cases[s.id], e).length > 0); }
{ const s = SCEN.find((q) => q.id === 'zombie_crit_iron'); const orig = M.Combat.CRIT_MULTIPLIER; M.Combat.CRIT_MULTIPLIER = 1;
  const e = engineLoss(s); M.Combat.CRIT_MULTIPLIER = orig; brk('engine crit multiplier 1 (zombie_crit_iron)', compare(s, golden.cases[s.id], e).length > 0); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`pmeleerefcheck: ${pass}/${SCEN.length} scenarios agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
