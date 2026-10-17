#!/usr/bin/env node
// mobdefaultcheck2.mjs — loop/mobdefaults (this session): two referee findings against the real
// 1.18.2 server (RCON), transcribed off `.decomp` rather than remembered.
//
// (a) WOLF ATTACK DAMAGE. `WolfEntity`'s own constructor calls `this.setTamed(false)`
//     (.decomp/net/minecraft/entity/passive/WolfEntity.java:90), and `setTamed` UNCONDITIONALLY
//     sets `generic.attack_damage`'s base to 4.0 (:330-331) -- overwriting `createWolfAttributes`'
//     own `.add(ATTACK_DAMAGE, 2.0)` (:123) before a wolf ever ticks once. So 4.0, not 2.0, is
//     EVERY wolf's real attack damage, wild or tamed alike; only MAX_HEALTH differs by tamed
//     state (8.0 wild / 20.0 tamed, :76-77,324-331).
// (b) CanPickUpLoot/PersistenceRequired. `MobEntity.canPickUpLoot`/`.persistent` (NBT
//     `CanPickUpLoot`/`PersistenceRequired`, MobEntity.java:106-107,354-355,431) had no state
//     anywhere in src/ before this session. Seven types call `setCanPickUpLoot(true)`
//     unconditionally from their own constructor/initialize (dolphin, fox, panda, piglin,
//     piglin_brute, pillager, villager -- `grep -rl "setCanPickUpLoot(true)"
//     .decomp/net/minecraft/entity/`); zombie/skeleton kin roll it from local difficulty
//     (`random.nextFloat() < 0.55F * getClampedLocalDifficulty()`, ZombieEntity.java:444-445,
//     AbstractSkeletonEntity.java:145). Every other MobEntity stays false.
//
// Headless, node-only. `node tools/mobdefaultcheck2.mjs [--verbose]`

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

say('mobdefaultcheck2 -- wolf attack_damage (setTamed override) + CanPickUpLoot/PersistenceRequired (loop/mobdefaults)');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
    '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
    '07n_tame.js', '07q_effects.js', '07y_equip.js', '10_gfx.js', '15h_bemodel.js',
    '07j_entityrender.js', '14j_combat.js', '07zw_mobnbt.js', '07w_passive.js', '07zj2_dolphin.js', '07zjd_dolphin.js', '07zz2_dolphin.js', '07zj_fox.js'],
  dom: false
});
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8'))
});
{
  const meta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.Entities.init();
M.EntityList.init();
M.Ai.init();
M.Breed.init();
M.Tame.init();
if (M.Passive && M.Passive.init) M.Passive.init();
if (M.Equip) M.Equip.ready = true;
M.Diff = { get: () => 'normal' };   // (b)3 pins clampedLocalDifficulty() at 1.0 itself
M.Player = { x: 0, y: 64, z: 0 };

const EL = M.EntityList, Ent = M.Entities, Tm = M.Tame, Cb = M.Combat;
ok(EL.ready && Ent.ready && Tm.ready && !!Cb, 'EntityList/Entities/Tame/Combat all ready');

// ── (a)1. .decomp facts, re-read here so the check owns none of them (rule 3) ────────────────
say('\n(a)1 -- .decomp: WolfEntity always ends up ATTACK_DAMAGE 4.0, MAX_HEALTH 8.0/20.0');
const wolfSrc = readFileSync(join(MCLITE_ROOT, '.decomp', 'net', 'minecraft', 'entity', 'passive', 'WolfEntity.java'), 'utf8');
ok(/this\.setTamed\(false\);/.test(wolfSrc), 'WolfEntity\'s constructor calls setTamed(false) (.decomp WolfEntity.java)');
ok(/\.getAttributeInstance\(EntityAttributes\.field_23721\)\.setBaseValue\(4\.0\);/.test(wolfSrc),
  'setTamed sets ATTACK_DAMAGE (field_23721) base to 4.0 OUTSIDE the tamed/!tamed if -- unconditional');
ok(/\.add\(EntityAttributes\.field_23721,\s*2\.0\)/.test(wolfSrc),
  'createWolfAttributes\' own builder base for ATTACK_DAMAGE is 2.0 (the value the constructor then overwrites)');
ok(/WILD_MAX_HEALTH = 8\.0F/.test(wolfSrc) && /TAMED_MAX_HEALTH = 20\.0F/.test(wolfSrc),
  'WILD_MAX_HEALTH 8.0 / TAMED_MAX_HEALTH 20.0 constants (.decomp WolfEntity.java)');

// ── (a)2. a fresh wild wolf: 4.0 attack damage, 8.0 max health, both paths Combat actually reads
say('\n(a)2 -- a freshly spawned wild wolf');
{
  const w = EL.spawn('wolf', 0, 64, 0);
  ok(!!w, 'a wolf spawns');
  ok(w.tamed === false, 'fresh wolf is untamed');
  ok(w.attackDamage === 4, `fresh WILD wolf e.attackDamage === 4 (not createWolfAttributes' table 2.0) -- got ${w.attackDamage}`);
  ok(w.maxHealth === 8 && w.health === 8, `fresh WILD wolf max/health 8.0 (WILD_MAX_HEALTH) -- got ${w.maxHealth}/${w.health}`);
  ok(Ent.attrsOf('wolf').dmg === 2, 'the GENERIC per-type table (createWolfAttributes builder base) still says 2 -- e.attackDamage is what overrides it, not a table edit');
  const target = { removed: false };
  const dealt = [];
  const realHurt = M.Survival;
  M.Survival = { hurt: (t, src, amt) => { dealt.push(amt); return true; } };
  Cb.mobAttack(w, M.Player);
  M.Survival = realHurt;
  ok(dealt[0] === 4, `Cb.mobAttack actually LANDS 4 damage through the real combat path, not 2 -- got ${dealt[0]}`);
}

// ── (a)3. taming: attack damage UNCHANGED (already 4), health JUMPS to 20 and heals full ─────
say('\n(a)3 -- taming a damaged wild wolf');
{
  const w = EL.spawn('wolf', 5, 64, 5);
  w.health = 3;   // hurt, well under WILD_MAX_HEALTH 8 -- proves setTamed(true) HEALS, not just raises the ceiling
  const res = Tm.feed(w, 'bone', { random: () => 0 });   // roll === 0 -> always tames
  ok(res && res.tamed === true, 'the forced roll tames the wolf');
  ok(w.attackDamage === 4, `TAMED wolf attackDamage is STILL 4 (setTamed sets it to 4.0 in BOTH branches) -- got ${w.attackDamage}`);
  ok(w.maxHealth === 20 && w.health === 20,
    `TAMED wolf jumps to TAMED_MAX_HEALTH 20 and is healed to FULL 20 (was 3/8) -- got ${w.maxHealth}/${w.health}`);
}

// ── (a)4. anti-vacuity -- Cb.mobAttack without the per-instance override falls back to the
//    generic table's 2.0, proving the fix (not the table) is what makes 4 land.
say('\n(a)4 -- anti-vacuity: strip e.attackDamage, watch the damage fall back to the table\'s 2');
{
  const w = EL.spawn('wolf', -5, 64, -5);
  delete w.attackDamage;
  const dealt = [];
  M.Survival = { hurt: (t, s, amt) => { dealt.push(amt); return true; } };
  Cb.mobAttack(w, M.Player);
  M.Survival = undefined;
  okAv(dealt[0] === 2, `without e.attackDamage, Cb.mobAttack falls back to Entities.attrsOf('wolf').dmg (2) -- proves the 4 above came from the fix, not a lucky table value (got ${dealt[0]})`);
}

// ── (a)5. save/load round-trip -- a tamed wolf's health/maxHealth survive a reload (COMMON),
//    and attackDamage is re-derived as 4 on the reload spawn (never persisted, never needs to be
//    -- it is a constant of the type, not saved state; MobNbt does not carry it).
say('\n(a)5 -- save/load: a tamed wolf reloads at max_health 20 / attack_damage 4');
{
  const w = EL.spawn('wolf', 20, 64, 20);
  Tm.feed(w, 'bone', { random: () => 0 });
  const recs = M.MobNbt.serializeAll();
  const rec = recs.find((r) => r.type === 'wolf' && r.x === 20);
  ok(!!rec && rec.maxHealth === 20 && rec.health === 20, `serializeAll carries the tamed wolf's 20/20 (got ${rec && rec.maxHealth}/${rec && rec.health})`);
  EL.remove(w);
  const n = M.MobNbt.restoreAll([rec]);
  ok(n === 1, 'restoreAll restores the one record');
  const w2 = EL.list[EL.list.length - 1];
  ok(w2.type === 'wolf' && w2.tamed === true, 'the restored entity is a tamed wolf');
  ok(w2.maxHealth === 20 && w2.health === 20, `restored tamed wolf keeps 20/20 through the COMMON maxHealth/health fields -- got ${w2.maxHealth}/${w2.health}`);
  ok(w2.attackDamage === 4, `restored tamed wolf's attackDamage is re-derived as 4 by EL.DEFAULTS.wolf on reload (a constant of the type, not saved) -- got ${w2.attackDamage}`);
}

// ── (b)1. .decomp: the seven CanPickUpLoot(true) constructors, and the two roll classes ──────
say('\n(b)1 -- .decomp: which types call setCanPickUpLoot(true) unconditionally');
function findSetCanPickupTrue() {
  const root = join(MCLITE_ROOT, '.decomp', 'net', 'minecraft', 'entity');
  const out = [];
  (function walk(d) {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.java')) {
        const s = readFileSync(p, 'utf8');
        if (/setCanPickUpLoot\(true\)/.test(s)) out.push(f.name.replace('.java', ''));
      }
    }
  })(root);
  return out.sort();
}
const pickupTrueClasses = findSetCanPickupTrue();
ok(JSON.stringify(pickupTrueClasses) === JSON.stringify(
  ['AbstractPiglinEntity', 'DolphinEntity', 'FoxEntity', 'PandaEntity', 'PillagerEntity', 'VillagerEntity'].sort()),
  `exactly these classes call setCanPickUpLoot(true) unconditionally -- got ${JSON.stringify(pickupTrueClasses)}`);
ok(EL.PICKUP_LOOT_ALWAYS && Object.keys(EL.PICKUP_LOOT_ALWAYS).sort().join(',') ===
  'dolphin,fox,panda,piglin,piglin_brute,pillager,villager',
  `EL.PICKUP_LOOT_ALWAYS is exactly {dolphin,fox,panda,piglin,piglin_brute,pillager,villager} (AbstractPiglinEntity covers both piglin rows) -- got ${JSON.stringify(EL.PICKUP_LOOT_ALWAYS)}`);

// ── (b)2. spawn defaults: the seven true types, a plain false type, zombie/skeleton kin roll ─
say('\n(b)2 -- spawn-time canPickUpLoot / persistent defaults');
for (const t of ['dolphin', 'fox', 'panda', 'pillager', 'villager']) {
  const e = EL.spawn(t, 0, 64, 0);
  ok(!!e && e.canPickUpLoot === true, `${t} spawns with canPickUpLoot === true (vanilla ctor calls setCanPickUpLoot(true)) -- got ${e && e.canPickUpLoot}`);
}
// `piglin`/`piglin_brute` have no measured motion yet (EL.motionFor -> null, D-307's own closed-
// set gap, unrelated to this unit) so EL.spawn refuses them today -- (b)1 above already proves
// both are in EL.PICKUP_LOOT_ALWAYS from the table-membership assertion; this just double-checks
// EL.mobStateDefaults' OWN branch would set true for them without needing a live spawn.
for (const t of ['piglin', 'piglin_brute']) {
  const fakeE = {};
  EL.mobStateDefaults(fakeE, t, { hp: 1 });
  ok(fakeE.canPickUpLoot === true, `EL.mobStateDefaults sets canPickUpLoot true for ${t} even though it cannot be live-spawned yet (no motion data) -- got ${fakeE.canPickUpLoot}`);
}
for (const t of ['cow', 'sheep', 'creeper']) {
  const e = EL.spawn(t, 0, 64, 0);
  ok(!!e && e.canPickUpLoot === false, `${t} spawns with canPickUpLoot === false (MobEntity.java:106's own field default) -- got ${e && e.canPickUpLoot}`);
}
{
  const w = EL.spawn('wolf', 1, 64, 1);
  ok(w.persistent === false, `a fresh wolf's persistent is false, never undefined -- got ${w.persistent}`);
}
// the zombie/skeleton 0.55*clampedLocalDifficulty() roll, forced both ways through EL.random
say('\n(b)3 -- zombie/skeleton-kin canPickUpLoot rolls 0.55 * clampedLocalDifficulty()');
// s130: LocalDifficulty is real now (a fresh world clamps to 0 on normal -- equipcheck §3b owns
// that); this section tests the 0.55 roll, so it pins the multiplier at 1.0.
if (M.Equip) M.Equip.clampedLocalDifficulty = () => 1.0;
{
  const NO_MOTION_YET = {};   // D-673: zombified_piglin (lightning, s128) and wither_skeleton both spawn now
  for (const t of ['zombie', 'husk', 'drowned', 'zombie_villager', 'zombified_piglin', 'skeleton', 'stray', 'wither_skeleton']) {
    ok(!!EL.PICKUP_LOOT_ROLL[t], `${t} is in EL.PICKUP_LOOT_ROLL (inherits ZombieEntity/AbstractSkeletonEntity's own initialize roll)`);
    if (NO_MOTION_YET[t]) {
      const fakeTrue = {}, fakeFalse = {};
      const savedRandom = EL.random;
      EL.random = () => 0.1; EL.mobStateDefaults(fakeTrue, t, { hp: 1 });
      EL.random = () => 0.99; EL.mobStateDefaults(fakeFalse, t, { hp: 1 });
      EL.random = savedRandom;
      ok(fakeTrue.canPickUpLoot === true && fakeFalse.canPickUpLoot === false,
        `${t} cannot be live-spawned yet (no motion data) -- EL.mobStateDefaults still rolls it correctly both ways (got ${fakeTrue.canPickUpLoot}/${fakeFalse.canPickUpLoot})`);
      continue;
    }
    const savedRandom = EL.random;
    EL.random = () => 0.1;    // 0.1 < 0.55*1.0 -> true
    const eTrue = EL.spawn(t, 0, 64, 0);
    EL.random = () => 0.99;   // 0.99 >= 0.55 -> false
    const eFalse = EL.spawn(t, 1, 64, 1);
    EL.random = savedRandom;
    ok(!!eTrue && eTrue.canPickUpLoot === true, `${t} rolls TRUE at rand=0.1 (< 0.55*1.0 normal difficulty) -- got ${eTrue && eTrue.canPickUpLoot}`);
    ok(!!eFalse && eFalse.canPickUpLoot === false, `${t} rolls FALSE at rand=0.99 -- got ${eFalse && eFalse.canPickUpLoot}`);
  }
}

// ── (b)4. anti-vacuity -- delete the table row and watch the true-default vanish ─────────────
say('\n(b)4 -- anti-vacuity: strip villager out of PICKUP_LOOT_ALWAYS');
{
  const saved = EL.PICKUP_LOOT_ALWAYS.villager;
  delete EL.PICKUP_LOOT_ALWAYS.villager;
  const v = EL.spawn('villager', 2, 64, 2);
  okAv(v.canPickUpLoot === false, `with villager removed from PICKUP_LOOT_ALWAYS, a fresh villager's canPickUpLoot reads false -- proves the true-default above came from that table, not a hardcode (got ${v.canPickUpLoot})`);
  EL.PICKUP_LOOT_ALWAYS.villager = saved;
}

// ── (b)5. save/load round-trip for canPickUpLoot AND persistent (COMMON, 07zw_mobnbt.js) ────
say('\n(b)5 -- save/load: canPickUpLoot and persistent both round-trip generically (COMMON)');
{
  ok(M.MobNbt.fieldsFor('cow').includes('canPickUpLoot') && M.MobNbt.fieldsFor('cow').includes('persistent'),
    'canPickUpLoot/persistent are in COMMON, so even a cow (no SPECIES row) carries them');
  const c = EL.spawn('cow', 30, 64, 30);
  c.canPickUpLoot = true;   // a data-pack/command could set this even though cow's own ctor never does
  c.persistent = true;
  const recs = M.MobNbt.serializeAll();
  const rec = recs.find((r) => r.type === 'cow' && r.x === 30);
  ok(rec.canPickUpLoot === true && rec.persistent === true, `serializeAll carries a cow's non-default flags through -- got ${JSON.stringify(rec)}`);
  EL.remove(c);
  M.MobNbt.restoreAll([rec]);
  const c2 = EL.list[EL.list.length - 1];
  ok(c2.type === 'cow' && c2.canPickUpLoot === true && c2.persistent === true,
    `restoreAll reproduces both flags on the reloaded cow -- got canPickUpLoot=${c2.canPickUpLoot} persistent=${c2.persistent}`);
}

// ── (b)6. PersistenceRequired feeds the EXISTING despawn rule (Spawn.despawnTick already reads
//    e.persistent, 07l_spawn.js -- this proves it was reading a real, correctly-defaulted field
//    rather than a permanently-undefined one) ───────────────────────────────────────────────
say('\n(b)6 -- persistent feeds Spawn.despawnTick\'s existing e.persistent read (07l_spawn.js)');
{
  M.Spawn.init(); M.Spawn.ready = false;
  const S = M.Spawn;
  ok(typeof S.despawnTick === 'function', 'Spawn.despawnTick exists');
  // far outside the 'monster' category's own despawn band (128), idle past the counter gate,
  // exactly the shape despawncheck.mjs already exercises for the base (non-persistent) case.
  const far = EL.spawn('zombie', 500, 64, 500);
  far.canPickUpLoot = false;   // isolate: this test is about `persistent`, not the loot roll
  far.persistent = false;
  far.despawnCounter = S.DESPAWN_IDLE_TICKS + 1;
  const savedRandom = Math.random;
  Math.random = () => 0;   // always beats DESPAWN_ROLL_ODDS
  S.despawnTick();
  ok(far.removed === true, 'a far, idle, NON-persistent mob despawns (baseline -- the existing rule still works)');

  const far2 = EL.spawn('zombie', 500, 64, 501);
  far2.persistent = true;   // PersistenceRequired
  far2.despawnCounter = S.DESPAWN_IDLE_TICKS + 1;
  S.despawnTick();
  Math.random = savedRandom;
  okAv(far2.removed !== true, 'the SAME far, idle mob with persistent=true is NEVER removed -- PersistenceRequired actually blocks the despawn roll');
}

console.log('\n' + (fails.length ? 'FAIL' : 'PASS') + '  mobdefaultcheck2 -- ' + pass + ' assertions, ' +
  fails.length + ' failures' + (breaks ? ', ' + breaks + ' breaks caught' : ''));
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
