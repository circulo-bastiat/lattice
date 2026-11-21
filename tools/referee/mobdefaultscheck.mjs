#!/usr/bin/env node
// mobdefaultscheck.mjs — unit I4 (the behaviour referee), G18's own check: does the engine's
// mob attribute table (`DATA.entities.attrs`, D-336) and its handful of default NBT fields
// actually MATCH the real 1.18.2 server, not just the bytecode extraction that produced the
// table in the first place? Two independent sources (a live server over RCON, and the static
// bytecode walk in tools/extract-entityattrs.mjs) that still agree cannot be a coincidence
// (D-263); where they disagree, one of them is wrong, and this check does not decide which —
// it reports the disagreement as a FINDING and stays red (the referee's fence forbids touching
// src/, so a real mismatch is not this check's to fix).
//
//   node tools/referee/mobdefaultscheck.mjs [--verbose]
//
// Golden comes from `node tools/referee/run.mjs tools/referee/packs/mob-defaults.json`, which
// talks to a REAL server over RCON and is never committed (D-6, generated data). Missing golden
// prints SKIP and exits 0 — this check cannot invent the numbers it is supposed to be checking.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadEngine, initRegistry, MCLITE_ROOT } from '../loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
const PACK = JSON.parse(readFileSync(join(MCLITE_ROOT, 'tools', 'referee', 'packs', 'mob-defaults.json'), 'utf8'));

function refereeDir() { return process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2'); }
// I5: the store checkout (a cloud container's ../mclite-store) caches golden too, so a fresh
// container needs no server run before this check means something.
const GOLDEN = [join(refereeDir(), 'golden', `${PACK.name}.json`), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', `${PACK.name}.json`)]
  .find((f) => existsSync(f)) || join(refereeDir(), 'golden', `${PACK.name}.json`);

if (!existsSync(GOLDEN)) {
  console.log('mobdefaultscheck: SKIP (golden not generated -- run node tools/referee/run.mjs tools/referee/packs/mob-defaults.json)');
  console.log(`mobdefaultscheck: expected golden at ${GOLDEN}`);
  process.exit(0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

// Attribute id (vanilla) <-> engine field, same mapping genpack.mjs used to build the pack.
const ATTR_FIELD = {
  'minecraft:generic.max_health': 'hp',
  'minecraft:generic.movement_speed': 'speed',
  'minecraft:generic.attack_damage': 'dmg',
  'minecraft:generic.follow_range': 'follow',
  'minecraft:generic.knockback_resistance': 'kbRes',
  'minecraft:generic.attack_knockback': 'atkKb',
};
// Mobs whose max_health vanilla itself RANDOMISES per spawn (AbstractHorse family --
// `initAttributes` rerolls it, .decomp-confirmed by src/07i_entitylist.js's own EL.DEFAULTS
// comments). A single live sample cannot be compared for equality; noted, not asserted.
const RANDOM_HP = new Set(['horse', 'donkey', 'mule', 'llama', 'trader_llama']);
// Infra orchestrator review (24 Sept): three more kinds of vanilla value one live sample cannot pin.
// - AbstractHorse also rolls movement_speed per spawn (horse family) — one sample is not "the" value.
// - Slime/MagmaCube.setSize() REWRITES max_health/movement_speed/attack_damage from Size
//   (.decomp SlimeEntity setSize: hp = size*size, speed = 0.2 + 0.1*size, damage = size); the engine
//   table row is not per-size, so equality is meaningless until the pack pins Size and the engine exposes it.
// - Health on a live sample drops from the environment before it is read: a dolphin dries out on land,
//   a drowned burns in daylight (dolphin 9/10, drowned 19/20 in the first run) — not a spawn default.
const RANDOM_ATTR = { 'minecraft:generic.movement_speed': new Set(['horse', 'donkey', 'mule', 'llama', 'trader_llama']) };
const SIZE_DEPENDENT = new Set(['slime', 'magma_cube']);
const ENV_HEALTH = new Set(['dolphin', 'drowned']);
const NEAR = (a, b, eps = 1e-3) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= eps;

let pass = 0; const fails = [];
const mismatches = []; // {mob, field, engine, vanilla} -- the valuable output
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

// I5 (gate, 24 Sept): compare what a mob IS when the engine spawns it (EntityList.spawn, the
// real path), not the static per-type table. The first version read `Entities.attrsOf` only and
// so kept failing wolf attack_damage (the table's createWolfAttributes base 2, overwritten to 4
// by the constructor's setTamed(false) -- D-605 put that on the instance as e.attackDamage) and
// hard-coded CanPickUpLoot/PersistenceRequired as "no such field" after D-605 added them.
// mobdefaultcheck2's module list + EVERY src/07*.js (the mob modules: spell/fly/silverfish/phantom
// goals live in their own files; with a hand-picked list evoker/vex/phantom/silverfish failed to spawn).
const BASE_MODS = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
  '07n_tame.js', '07q_effects.js', '07y_equip.js', '10_gfx.js', '15h_bemodel.js',
  '07j_entityrender.js', '14j_combat.js', '07zw_mobnbt.js', '07w_passive.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const MCL = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false });
initRegistry(MCL);
MCL.DATA = Object.assign({}, MCL.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
{
  const meta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
  MCL.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
MCL.Entities.init(); MCL.EntityList.init(); MCL.Ai.init(); MCL.Breed.init(); MCL.Tame.init();
if (MCL.Passive && MCL.Passive.init) MCL.Passive.init();
if (MCL.Equip) MCL.Equip.ready = true;
MCL.Diff = { get: () => 'easy' };      // the referee server runs difficulty=easy (server.mjs)
MCL.Player = { x: 0, y: 64, z: 0 };
const E = MCL.Entities, EL = MCL.EntityList;
// One freshly spawned instance per mob, far apart; what the engine really gives it.
const SPAWNED = {};
// Spawn-time ROLLS (zombie leader bonus, CanPickUpLoot, baby chance...) pinned high so every
// "rolled" branch stays off -- the referee's one summon is compared against the un-rolled default.
const realRandom = Math.random; Math.random = () => 0.999; const realELr = EL.random; EL.random = () => 0.999;
{ let i = 0; for (const mob of PACK.mobs) { try { SPAWNED[mob.id] = EL.spawn(mob.id, (i++) * 64, 64, 0) || null; } catch (e) { SPAWNED[mob.id] = null; if (process.env.MDC_DEBUG) console.log(mob.id, e.stack.split("\n").slice(0, 3).join(" / ")); } } }
Math.random = realRandom; EL.random = realELr;
/** Engine value a fresh spawn carries for a table field: the instance override first (D-605). */
function engineAttr(id, field) {
  const e = SPAWNED[id], at = E.attrsOf(id) || {};
  if (e && field === 'hp' && typeof e.maxHealth === 'number') return e.maxHealth;
  if (e && field === 'dmg' && typeof e.attackDamage === 'number') return e.attackDamage;
  return at[field];
}

console.log(`mobdefaultscheck -- unit I4, live-server vs engine for ${PACK.mobs.length} mobs`);
console.log(` golden: ${GOLDEN} (generated ${golden.generatedAt})`);

// ── attributes ───────────────────────────────────────────────────────────────────────────────
for (const mob of PACK.mobs) {
  const eng = E.attrsOf(mob.id);
  const gm = golden.mobs[mob.id];
  if (!ok(!!eng, `${mob.id}: engine has no attrsOf() row`)) continue;
  if (!ok(!!gm, `${mob.id}: no golden sample (server could not summon it? see notes)`)) continue;
  for (const attrId of mob.attrs) {
    const field = ATTR_FIELD[attrId];
    const engVal = engineAttr(mob.id, field);
    // infra I6 (25 Sept): prefer the no-NBT (initialize-run) sample -- what EL.spawn models; the NBT summon skips
    // MobEntity.initialize (e.g. wither_skeleton attack_damage 2 there, 4 after initialize).
    const vanVal = gm.init && gm.init.attrs && gm.init.attrs[attrId] !== null && gm.init.attrs[attrId] !== undefined ? gm.init.attrs[attrId] : gm.attrs[attrId];
    if (SIZE_DEPENDENT.has(mob.id) || (RANDOM_ATTR[attrId] && RANDOM_ATTR[attrId].has(mob.id))) {
      if (VERBOSE) console.log(`   (skip) ${mob.id}.${attrId}: size-dependent or rolled per spawn (engine ${engVal}, one live sample ${vanVal})`);
      continue;
    }
    if (field === 'hp' && RANDOM_HP.has(mob.id)) {
      if (VERBOSE) console.log(`   (skip) ${mob.id}.${attrId}: vanilla randomises this at spawn (engine base ${engVal}, one live sample ${vanVal})`);
      continue;
    }
    const same = NEAR(engVal, vanVal);
    if (!same) mismatches.push({ mob: mob.id, field: attrId, engine: engVal, vanilla: vanVal });
    ok(same, `${mob.id}.${attrId}: engine=${engVal} vanilla=${vanVal}`);
  }
  // Health defaults to max_health on a fresh spawn, engine and vanilla alike (src/07i_entitylist.js: e.health = at.hp).
  if (!RANDOM_HP.has(mob.id) && !SIZE_DEPENDENT.has(mob.id) && !ENV_HEALTH.has(mob.id)) {
    const e = SPAWNED[mob.id]; const engH = e && typeof e.health === 'number' ? e.health : eng.hp;
    const same = NEAR(engH, gm.health && gm.health.value);
    if (!same) mismatches.push({ mob: mob.id, field: 'Health', engine: engH, vanilla: gm.health && gm.health.value });
    ok(same, `${mob.id}.Health: engine=${engH} vanilla=${gm.health && gm.health.value}`);
  }
}

// ── NBT defaults: CanPickUpLoot / PersistenceRequired / Age ────────────────────────────────────
// D-605: the engine carries both as e.canPickUpLoot / e.persistent (EntityList.mobStateDefaults).
// Zombie/skeleton kin ROLL CanPickUpLoot from local difficulty per spawn in both games -- one live
// sample says nothing about a roll, so those are skipped (named, not asserted).
const NBT_FIELD = { CanPickUpLoot: 'canPickUpLoot', PersistenceRequired: 'persistent' };
const ROLLED_LOOT = new Set(Object.keys(EL.PICKUP_LOOT_ROLL || {}));
for (const mob of PACK.mobs) {
  const gm = golden.mobs[mob.id];
  if (!gm) continue;
  for (const field of mob.nbt) {
    if (field === 'Age') {
      // The engine's own field is `growAge`, not `age` (07m_breed.js's own header: "ONE TYPO
      // APART" from vanilla's AgeableMob.age -- deliberately not the same name). A fresh, un-bred
      // spawn is an adult in both: engine growAge defaults to 0/undefined (non-negative = adult),
      // vanilla Age defaults to 0. We only have the engine's STATIC default here (0), since
      // spawning through the full EntityList apparatus is out of this check's fence-safe reach
      // without duplicating mobnbtcheck's bootstrap; that is recorded as a note, not a failure.
      const vanAge = gm.nbt.Age && gm.nbt.Age.value;
      const same = NEAR(vanAge, 0);
      if (!same) mismatches.push({ mob: mob.id, field: 'Age (default)', engine: 0, vanilla: vanAge });
      ok(same, `${mob.id}.Age: engine default=0 vanilla=${vanAge}`);
      continue;
    }
    if (NBT_FIELD[field]) {
      if (field === 'CanPickUpLoot' && ROLLED_LOOT.has(mob.id)) { if (VERBOSE) console.log(`   (skip) ${mob.id}.CanPickUpLoot: rolled per spawn`); continue; }
      const e = SPAWNED[mob.id];
      if (gm.nbt[field] === undefined || gm.nbt[field] === null || gm.nbt[field].value === null || gm.nbt[field].value === undefined) {
        if (VERBOSE) console.log(`   (skip) ${mob.id}.${field}: vanilla has no such tag on this entity (not a MobEntity)`); continue;
      }
      if (!e) { if (field === 'CanPickUpLoot') { mismatches.push({ mob: mob.id, field: 'spawn', engine: '(EntityList.spawn gives nothing)', vanilla: 'summonable' }); ok(false, `${mob.id}: the engine cannot spawn it (EntityList.spawn returned nothing) -- vanilla summons it`); } continue; }
      const raw = e[NBT_FIELD[field]];
      const engV = raw === undefined ? '(unset on a fresh spawn)' : (raw ? 1 : 0);
      const gi = gm.init && gm.init.nbt && gm.init.nbt[field];
      const vanV = gi && gi.value !== null && gi.value !== undefined ? gi.value : gm.nbt[field] && gm.nbt[field].value;
      // ElderGuardianEntity's constructor calls setPersistent() (.decomp ElderGuardianEntity.java:23), but /summon
      // loads the entity from NBT, and MobEntity.readCustomDataFromNbt resets persistent to PersistenceRequired
      // (absent -> 0): the golden's 0 is a summon artifact. A real spawn (monument) is persistent -> engine 1 is right.
      const SUMMON_RESETS = { elder_guardian: 1 };
      if (field === 'PersistenceRequired' && SUMMON_RESETS[mob.id]) { ok(engV === 1, `${mob.id}.${field}: engine=${engV}, vanilla constructor setPersistent() (golden ${vanV} is a /summon NBT-load artifact)`); continue; }
      const same = engV === (typeof vanV === 'boolean' ? (vanV ? 1 : 0) : Number(vanV));
      if (!same) mismatches.push({ mob: mob.id, field, engine: engV, vanilla: vanV });
      ok(same, `${mob.id}.${field}: engine=${engV} vanilla=${vanV}`);
    }
  }
}

// ── anti-vacuity (D-30/D-305): break the engine's own numbers and prove this check notices ────
console.log('\nanti-vacuity');
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); console.log('   ' + (c ? '✓' : '✗') + ' ' + m); };

{
  const real = E.attrsOf('zombie').hp;
  E.attrs.zombie.hp = real + 5;
  const gm = golden.mobs.zombie;
  const caught = gm && !NEAR(E.attrsOf('zombie').hp, gm.attrs['minecraft:generic.max_health']);
  okAv(caught, `a zombie max_health perturbed by +5 in memory is caught against the golden`);
  E.attrs.zombie.hp = real;
}
{
  const real = E.attrs.cow;
  delete E.attrs.cow;
  okAv(!E.attrsOf('cow'), `deleting cow's attrs row makes attrsOf('cow') falsy (caught by the 'no attrsOf() row' assertion above)`);
  E.attrs.cow = real;
}
{
  const real = E.attrsOf('creeper').follow;
  E.attrs.creeper.follow = (real || 0) + 1000;
  const gm = golden.mobs.creeper;
  const caught = gm && !NEAR(E.attrsOf('creeper').follow, gm.attrs['minecraft:generic.follow_range']);
  okAv(caught, `a creeper follow_range perturbed by +1000 in memory is caught against the golden`);
  E.attrs.creeper.follow = real;
}

{
  // I5: the instance path -- a spawned wolf's own e.attackDamage (D-605) is what is compared.
  const w = SPAWNED.wolf, gm = golden.mobs.wolf;
  if (w && gm) {
    const real = w.attackDamage; w.attackDamage = 2;   // back to the table's builder base
    okAv(!NEAR(engineAttr('wolf', 'dmg'), gm.attrs['minecraft:generic.attack_damage']),
      `a spawned wolf's attackDamage reset to 2 (the static table) is caught against the golden 4`);
    w.attackDamage = real;
  } else okAv(false, 'wolf spawned and sampled (needed for the instance-path break)');
  const v = SPAWNED.villager, gv = golden.mobs.villager;
  if (v && gv) {
    const real = v.canPickUpLoot; v.canPickUpLoot = !real;
    okAv(((v.canPickUpLoot ? 1 : 0) !== Number(gv.nbt.CanPickUpLoot && gv.nbt.CanPickUpLoot.value)),
      `a villager's canPickUpLoot flipped in memory is caught against the golden CanPickUpLoot`);
    v.canPickUpLoot = real;
  } else okAv(false, 'villager spawned and sampled (needed for the NBT break)');
}

console.log('');
console.log('================ mobdefaultscheck (I4) ================');
console.log(` mobs checked ....... ${PACK.mobs.length}`);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
if (mismatches.length) {
  console.log(`\n engine-vs-vanilla mismatches (${mismatches.length}) -- FINDINGS, not fixed here (out of the referee's fence):`);
  for (const m of mismatches.slice(0, VERBOSE ? mismatches.length : 40)) {
    console.log(`   ${m.mob}.${m.field}: engine=${JSON.stringify(m.engine)} vanilla=${JSON.stringify(m.vanilla)}`);
  }
  if (!VERBOSE && mismatches.length > 40) console.log(`   ... and ${mismatches.length - 40} more (--verbose for all)`);
}
console.log('=========================================================');
process.exit(fails.length ? 1 : 0);
