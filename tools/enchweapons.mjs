#!/usr/bin/env node
// enchweapons.mjs — G22 (unit h) (#200): the WEAPON-side enchantments, driven end to end through the real join a
// player's kill takes: a sword in the selected hotbar slot, `Combat.attack(P, mob)`, then `Combat.tickEntity`
// (where `Cb.dropLoot` -> `Loot.entityDrops` pops real item entities), and the item entities counted.
//   node tools/enchweapons.mjs [--verbose]
// Expectations come from the jar, not from this file: sword damage from tools/golden/item-attributes-1.18.2.tsv,
// the Sharpness / Fire Aspect constants from tools/golden/combat-enchant-1.18.2.tsv, the cow's drop table from
// data/minecraft/loot_tables/entities/cow.json inside jars/1.18.2/1.18.2.jar, and the looting arithmetic from
// .decomp LootingEnchantLootFunction (`increment(Math.round(level * uniform(0,1)))`, mean level/2).
//   1. Sharpness I..V on every sword tier = the tier's jar damage + 1 + (lvl-1)*0.5, against an undead, an
//      arthropod and a plain mob alike (DamageEnchantment type 0 is unconditional).
//   2. Fire Aspect: a cow killed by it drops only cooked_beef (furnace_smelt's is_on_fire), a plain kill raw beef.
//   3. Looting: I and III raise leather/beef means by level/2; Looting 0, no enchant, and Looting held in a
//      non-selected slot are all the baseline (getLooting is MAINHAND only).
// Anti-vacuity (D-30): each section is re-run with the engine broken — Sharpness bonus zeroed, Sharpness made
// conditional on mob type, Fire Aspect never igniting, the killer's Looting forced 0, and forced 1 — and every
// break must turn the section red. Prints "<n> breaks caught".
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Jar } from './jarlib.mjs';   // node-only zip reader: the lander machine has no `unzip` binary
import { loadEngine, MCLITE_ROOT as ROOT } from './loadsrc.mjs';
import { jarPath } from './paths.mjs';

const VERBOSE = process.argv.includes('--verbose');
const say = (...a) => { if (VERBOSE) console.log(...a); };
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
const tsv = (f) => readFileSync(join(ROOT, 'tools', 'golden', f), 'utf8').split(/\r?\n/).filter((l) => l && l[0] !== '#').map((l) => l.split('\t'));

// ── the jar's facts ─────────────────────────────────────────────────────────────────────────────
const SWORD_DMG = {};
for (const c of tsv('item-attributes-1.18.2.tsv')) if (/_sword$/.test(c[0]) && c.length >= 9) SWORD_DMG[c[0]] = +c[6];
const ENCH = {};
for (const [k, a, b] of tsv('combat-enchant-1.18.2.tsv')) if (k === 'const') ENCH[a] = b;
// the jar wherever this machine keeps it (tools/paths.mjs). Without it only the two cow sections skip: Sharpness and
// its breaks need nothing but the golden tables, so the check can always show it fails (D-30).
const JAR = jarPath('1.18.2');
const COW = JAR && existsSync(JAR) ? JSON.parse(new Jar(JAR).read('data/minecraft/loot_tables/entities/cow.json').toString('utf8')) : null;
if (!COW) console.log('   SKIP fireAspect, looting — no 1.18.2 jar on this machine (tools/paths.mjs), so no cow loot table');
const cowPool = (item) => {
  if (!COW) return null;
  const e = COW.pools.map((p) => p.entries[0]).find((x) => x.name === 'minecraft:' + item);
  const fn = (n) => e.functions.find((f) => f.function === 'minecraft:' + n);
  const sc = fn('set_count').count, le = fn('looting_enchant');
  return { mean0: (sc.min + sc.max) / 2, lootMax: le ? le.count.max : 0, smelts: !!fn('furnace_smelt') };
};
const LEATHER = cowPool('leather'), BEEF = cowPool('beef');

// ── the engine as the game builds it (lootingrefcheck's loader) ────────────────────────────────
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14i_hand.js'];
const MOB_MODS = readdirSync(join(ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
{
  const table = {};
  const r = (v) => Math.round(parseFloat(v) * 10000) / 10000;
  for (const c of tsv('item-attributes-1.18.2.tsv')) if (c[0] !== 'item' && c.length >= 9) table[c[0]] = [r(c[6]), r(c[7]), +c[8]];
  M.Hand.bindAttrs(table);
}
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init(); M.Combat.init();
M.Diff = { get: () => 'normal' };
if (M.Goat && M.Goat.init) M.Goat.init();
let seed = 0x200c0de5;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
M.EntityList.random = rng; Math.random = rng;
const { EntityList: EL, Items: IT, Survival: Sv, Inventory: Iv, Combat: Cb, Hand: H, States: S } = M;
const P = { x: 0.5, y: 1, z: 0.5, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, yaw: 0, pitch: 0, type: 'player', slot: 0,
  onGround: true, fallDistance: 0, sprinting: false, inventory: { slots: new Array(Iv.SIZE || 46).fill(null), selected: 0 } };
Sv.init(P);
M.Player = P;
for (let x = -3; x <= 6; x++) for (let z = -3; z <= 3; z++) w.set(x, 0, z, S.stateOf('stone'));

const ench = (list) => (list && list.length ? { Enchantments: list.map(([id, lvl]) => ({ id: 'minecraft:' + id, lvl })) } : null);
const arm = (item, list, slot) => {
  P.inventory.slots.fill(null);
  const st = { i: IT.of(item), n: 1 }; const t = ench(list); if (t) st.t = t;
  P.inventory.slots[slot | 0] = st;
};
const charge = () => { H.reset(); for (let i = 0; i < 40; i++) H.tickAttackStrength(); };
let asserts = 0;                                // comparisons made (the un-broken run's count is reported)
const spawn = (type) => { EL.list.length = 0; const e = EL.spawn(type, 2.5, 1, 0.5); e.equip = {}; return e; };

// ── 1. Sharpness: the jar's sword damage plus 1 + (lvl-1)*0.5, against ANY mob type ─────────────────
function sharpness() {
  const f = [];
  for (const [sword, base] of Object.entries(SWORD_DMG)) {
    for (const type of ['cow', 'zombie', 'spider']) {
      for (let lvl = 0; lvl <= 5; lvl++) {
        arm(sword, lvl ? [['sharpness', lvl]] : null); charge();
        const e = spawn(type); e.maxHealth = e.health = 1000; e.invulnerableTime = 0;
        const got = Cb.attack(P, e).damage;
        const want = base + (lvl ? +ENCH.sharpness_base + (lvl - 1) * +ENCH.sharpness_per_level_above_1 : 0);
        asserts++;
        if (!(Math.abs(got - want) < 1e-6)) f.push(`${sword} sharpness ${lvl} vs ${type}: ${got}, jar ${want}`);
      }
    }
  }
  return f;
}

// the kill loop: a mob left at 0.001 health, one full-strength swing, one tick (the death drop), items counted
function kills(item, list, n, slot) {
  const rec = { n: 0, errs: 0, items: {}, sq: {} };
  for (let k = 0; k < n; k++) {
    arm(item, list, slot); charge();
    const e = spawn('cow'); e.health = 0.001;
    Cb.attack(P, e);
    if (!e.dead) { rec.errs++; continue; }
    Cb.tickEntity(e);
    rec.n++;
    const per = {};
    for (const o of EL.list) if (o.type === 'item' && o.item !== undefined) { const id = IT.nameOf(o.item); per[id] = (per[id] || 0) + (o.count | 0); }
    for (const [id, c] of Object.entries(per)) { rec.items[id] = (rec.items[id] || 0) + c; rec.sq[id] = (rec.sq[id] || 0) + c * c; }
  }
  return rec;
}
const mean = (r, id) => (r.items[id] || 0) / Math.max(1, r.n);
const sd = (r, id) => Math.sqrt(Math.max(0, (r.sq[id] || 0) / Math.max(1, r.n) - mean(r, id) ** 2));
const near = (f, r, id, want, what) => {       // 5 sigma of the sample mean, never tighter than 0.03
  asserts++;
  const tol = Math.max(0.03, 5 * sd(r, id) / Math.sqrt(Math.max(1, r.n)));
  if (!(Math.abs(mean(r, id) - want) <= tol)) f.push(`${what}: ${id} mean ${mean(r, id).toFixed(3)} per kill, jar ${want} (±${tol.toFixed(3)})`);
};

// ── 2. Fire Aspect: the burning cow's beef is smelted ─────────────────────────────────────────────
function fireAspect() {
  const f = [];
  if (!BEEF.smelts) f.push('the jar\'s cow table has no furnace_smelt on beef — the fixture is wrong');
  const hot = kills('diamond_sword', [['fire_aspect', 1]], 300);
  if (hot.errs) f.push(`fire aspect: ${hot.errs} swings did not kill`);
  if (hot.items.beef) f.push(`a Fire Aspect kill dropped ${hot.items.beef} RAW beef over ${hot.n} kills`);
  near(f, hot, 'cooked_beef', BEEF.mean0, 'Fire Aspect I');
  const plain = kills('diamond_sword', null, 300);
  if (plain.items.cooked_beef) f.push(`a plain kill dropped ${plain.items.cooked_beef} cooked beef`);
  near(f, plain, 'beef', BEEF.mean0, 'plain sword');
  // Fire Aspect and Looting stack: the smelted stack is still incremented by looting_enchant
  const both = kills('diamond_sword', [['fire_aspect', 2], ['looting', 3]], 1500);
  near(f, both, 'cooked_beef', BEEF.mean0 + BEEF.lootMax * 3 / 2, 'Fire Aspect II + Looting III');
  return f;
}

// ── 3. Looting: +level/2 per looting_enchant pool; 0 / none / off-hand-slot are the baseline ────────
function looting() {
  const f = [];
  const N = 2500;
  for (const lvl of [1, 3]) {
    const r = kills('diamond_sword', [['looting', lvl]], N);
    near(f, r, 'leather', LEATHER.mean0 + LEATHER.lootMax * lvl / 2, 'Looting ' + lvl);
    near(f, r, 'beef', BEEF.mean0 + BEEF.lootMax * lvl / 2, 'Looting ' + lvl);
  }
  for (const [what, list, slot] of [['no enchantment', null, 0], ['Looting 0', [['looting', 0]], 0]]) {
    const r = kills('diamond_sword', list, N, slot);
    near(f, r, 'leather', LEATHER.mean0, what);
    near(f, r, 'beef', BEEF.mean0, what);
  }
  // Looting III in hotbar slot 1 while slot 0 (bare hand) is selected: MAINHAND only, so baseline
  {
    const r = { n: 0, errs: 0, items: {}, sq: {} };
    for (let k = 0; k < N; k++) {
      P.inventory.slots.fill(null);
      P.inventory.slots[1] = { i: IT.of('diamond_sword'), n: 1, t: ench([['looting', 3]]) };
      charge();
      const e = spawn('cow'); e.health = 0.001;
      Cb.attack(P, e);
      if (!e.dead) { r.errs++; continue; }
      Cb.tickEntity(e); r.n++;
      for (const o of EL.list) if (o.type === 'item' && o.item !== undefined) { const id = IT.nameOf(o.item); r.items[id] = (r.items[id] || 0) + (o.count | 0); r.sq[id] = (r.sq[id] || 0) + (o.count | 0) ** 2; }
    }
    near(f, r, 'beef', BEEF.mean0, 'Looting III in an unselected slot');
  }
  return f;
}

// ── run, then break ───────────────────────────────────────────────────────────────────────────────
const SECTIONS = COW ? { sharpness, fireAspect, looting } : { sharpness };
let pass = 0;
const fails = [];
console.log('enchweapons — G22 (unit h) weapon enchantments through the real kill join (#200)');
for (const [name, fn] of Object.entries(SECTIONS)) {
  const f = fn();
  if (f.length) fails.push(...f.slice(0, 12).map((m) => name + ': ' + m));
  else { pass++; console.log('   ok ' + name); }
  for (const m of f) say('     ' + m);
}
const assertsRun = asserts;

const withPatch = (patch, fn) => { const old = {}; for (const k of Object.keys(patch)) { old[k] = Cb[k]; Cb[k] = patch[k]; } try { return fn(); } finally { Object.assign(Cb, old); } };
const BREAKS = [
  ['Sharpness bonus zeroed', { SHARPNESS_BASE: 0, SHARPNESS_PER_LEVEL: 0 }, sharpness],
  ['Sharpness per-level wrong (0.75)', { SHARPNESS_PER_LEVEL: 0.75 }, sharpness],
  ['Sharpness only against undead', { damageBonus: ((orig) => (st, mt) => (mt === 'undead' ? orig(st, mt) : 0))(Cb.damageBonus) }, sharpness],
  ['Fire Aspect never ignites', { FIRE_ASPECT_SECONDS_PER_LEVEL: 0, FIRE_ASPECT_PRE_IGNITE_SECONDS: 0 }, fireAspect],
  ['killer Looting forced 0', { lootingOf: () => 0 }, looting],
  ['killer Looting forced 1 (Looting 0 not baseline)', { lootingOf: () => 1 }, looting],
];
let breaks = 0;
for (const [name, patch, fn] of BREAKS) {
  if (!Object.values(SECTIONS).includes(fn)) continue;
  const f = withPatch(patch, fn);
  if (f.length) { breaks++; console.log(`   ✓ break caught: ${name} (${f.length} red)`); }
  else fails.push(`anti-vacuity: break "${name}" was NOT caught`);
}

console.log('\n=================== enchweapons ===================');
console.log(` sections passed .... ${pass} of ${Object.keys(SECTIONS).length}`);
console.log(` assertions passed .. ${assertsRun - fails.filter((m) => !m.startsWith('anti-vacuity')).length}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks} of ${BREAKS.filter((b) => Object.values(SECTIONS).includes(b[2])).length}`);
console.log(`${breaks} breaks caught`);
if (fails.length) { console.log('\nFAIL'); for (const m of fails) console.log('  - ' + m); process.exit(1); }
console.log('enchweapons: PASS');
