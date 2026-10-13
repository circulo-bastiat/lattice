#!/usr/bin/env node
// mobnbtcheck.mjs — loop/nbtsave-s104. Closes Mnt.OWED's "entity NBT PERSISTENCE at all" entry
// (07r_mount.js), Tu.OWED's "NBT persistence" (07zp_turtle.js) and part of Bee.OWED's hive
// fields (07zo_bee.js) — the per-bee fields, not the hive block entity's own occupant list.
// Drives the REAL modules: 07zw_mobnbt.js (the generic serializer), 16b_save.js's own
// S.save/S.load round trip (real localStorage JSON envelope, mocked store only), and every
// 07z*.js mob module whose fields 07zw_mobnbt.js lists.
//
//   node tools/mobnbtcheck.mjs [--verbose]
//
// Sections:
//   1. every species in MobNbt's own field table — spawn, set every persisted field to a
//      non-default value, S.save() -> real localStorage string -> fresh EL.list -> S.load() ->
//      MobNbt.restoreAll(S.mobRecords) (the exact 16b_save.js/17_main.js Main.finishBoot path)
//      -> every listed field equal on the reloaded entity, through the SAME EL.spawn path
//      (dimensions/motion re-derived, not hand-copied)
//   2. a save written before this unit (no `mobs` key at all) still loads — zero mobs, no throw
//   3. anti-vacuity — drop one field from MobNbt.fieldsFor and prove the round trip then FAILS
//      to carry it (the mechanism, not merely the field, is under test)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('mobnbtcheck — loop/nbtsave-s104, entity NBT persistence through 16b_save.js');

const EXTRA = ['02f_tags.js', '07z_potion.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
               '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js',
               '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js',
               '07n_tame.js', '07o_profession.js', '07r_mount.js', '07ze_llama.js', '07t_fly.js',
               '07q_effects.js', '07zf_bat.js', '07zg_enderman.js', '07zh_rabbit.js', '07zj_fox.js',
               '07zj_goat.js', '07zl_panda.js', '07zm_axolotl.js', '07zn_mooshroom.js', '07zo_bee.js',
               '07zz2_dolphin.js', '07zj_fish.js', '07zp_turtle.js', '07zr_zvillager.js', '07s_raid.js', '07w_passive.js', '07zk_undead.js', '09b_sky.js', '16b_save.js', '07zw_mobnbt.js',
               '07zb_creeper.js', '07zd_slime.js', '07zi_squid.js', '07x_patrol.js', '07v_spell.js', '07zt_wtrader.js', '07zzm_wither.js', '07zzf_piglin.js', '07zzq_rail.js', '07zzr_minecart.js', '07zzt_boat.js', '07zz_xporb.js', '07zzh_blaze.js', '07zzi_ghast.js', '07zc_tnt.js', '07z_potion.js', '07zzd_throw.js'];

function freshMCL() {
  const store = {};
  const MCL = loadEngine({ extra: EXTRA, dom: false });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  MCL.Entities.init();
  MCL.Entities.attrs = MCL.DATA.entities.attrs;
  MCL.World.init(1);
  MCL.Behave.init(MCL.World);
  if (MCL.BlockEntities && MCL.BlockEntities.init) MCL.BlockEntities.init();
  MCL.EntityList.init();
  if (MCL.Breed && MCL.Breed.init) MCL.Breed.init();
  if (MCL.Tame && MCL.Tame.init) MCL.Tame.init();
  if (MCL.Profession && MCL.Profession.init) MCL.Profession.init();
  // ⚠ 16b_save.js is main-thread/DOM code (localStorage, btoa/atob). Node has neither — the
  // SAME stub shape savecheck.mjs already uses for the same reason, not a new convention.
  globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
  globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  // `S.save` unconditionally calls `NS.Player.toJSON()`; this check has no live player, only
  // mobs, so it stubs the one field 16b_save.js reaches for outside `S.encode`/`MobNbt`.
  MCL.Player = { toJSON: () => ({ x: 0, y: 64, z: 0 }), fromJSON: () => false };
  MCL.Save.init();
  return MCL;
}

// ── § 1 -- every persisted species round-trips ──────────────────────────────────────────────
say('\n§1 species round trip (spawn, mutate, save, fresh world, load, compare)');

const MCL1 = freshMCL();
const Fish = MCL1.Fish;
const EL = MCL1.EntityList, Mb = MCL1.MobNbt, S = MCL1.Save;

/** Spawn one of `type` and push it away from every default value the persisted fields could
 *  hold, so a field that silently reset to its default would still be caught. Returns the live
 *  entity (or null if this build's own entity table has no such type -- skipped, not guessed). */
function spawnMutated(type, mutate) {
  const e = EL.spawn(type, 100.5, 64.0, -200.25);
  if (!e) return null;
  e.yaw = 137.5;
  mutate(e);
  return e;
}

const SPECIES_PIGLIN_INV = [null, { i: 5, n: 3 }, null, null, null, null, null, null];
const SPECIES_TESTS = {
  wolf: (e) => { e.tamed = true; e.owner = 'player'; e.sitting = true; e.collarColor = 'blue'; e.angerTime = 42; e.health = 3; },
  cat: (e) => { e.tamed = true; e.owner = 'player'; e.sitting = true; e.collarColor = 'lime'; e.catVariant = 7; },
  parrot: (e) => { e.tamed = true; e.owner = 'player'; e.sitting = true; e.parrotVariant = 3; },
  sheep: (e) => { e.woolColor = 'purple'; e.sheared = true; },
  chicken: (e) => { e.eggLayTime = 1234; },
  creeper: (e) => { e.charged = true; e.fuseTime = 45; e.explosionRadius = 5; e.ignited = true; },
  pig: (e) => { e.saddled = true; },
  slime: (e) => { e.size = 4; e.onGroundLastTick = true; },   // + SlimeEntity "wasOnGround" (#4401)
  magma_cube: (e) => { e.size = 4; e.onGroundLastTick = true; },   // #4466
  glow_squid: (e) => { e.darkTicksRemaining = 77; },
  wandering_trader: (e) => { e.despawnDelay = 555; e.wanderTarget = { x: 3, y: 65, z: 4 }; },
  pillager: (e) => { e.inventory = [null, { i: 5, n: 3 }, null, null, null]; e.patrolTarget = { x: 7, y: 64, z: -9 }; e.patrolLeader = true; e.patrolling = true; e.wave = 3; e.canJoinRaid = false; },
  vindicator: (e) => { e.patrolTarget = { x: 7, y: 64, z: -9 }; e.patrolLeader = true; e.patrolling = true; e.wave = 3; e.canJoinRaid = false; e.johnny = true; },
  evoker: (e) => { e.patrolTarget = { x: 7, y: 64, z: -9 }; e.patrolLeader = true; e.patrolling = true; e.wave = 3; e.canJoinRaid = false; e.spellTicks = 33; },
  ravager: (e) => { e.patrolTarget = { x: 7, y: 64, z: -9 }; e.patrolLeader = true; e.patrolling = true; e.wave = 3; e.canJoinRaid = false; e.ravagerAttackTick = 4; e.ravagerStunTick = 20; e.ravagerRoarTick = 11; },
  bat: (e) => { e.roosting = false; e.hangingPos = { x: 1, y: 2, z: 3 }; },
  enderman: (e) => { e.carriedBlock = 'dirt'; e.angerTime = 99; e.angryAt = 5; e.ageWhenTargetSet = 17; e.provoked = true; },
  zombified_piglin: (e) => { e.angerTime = 77; e.angryAt = 4; },
  piglin: (e) => { e.inventory = JSON.parse(JSON.stringify(SPECIES_PIGLIN_INV)); e.timeInOverworld = 9; },   // #3905
  iron_golem: (e) => { e.playerCreated = true; e.angerTime = 31; e.angryAt = 6; },
  rabbit: (e) => { e.rabbitType = 99; e.moreCarrotTicks = 40; },
  fox: (e) => { e.foxType = 1; e.sleeping = true; e.sitting = true; e.crouching = true; e.foxOwner = 1; e.foxTrusted = 2; },
  goat: (e) => { e.screaming = true; },
  panda: (e) => { e.mainGene = 3; e.hiddenGene = 5; },
  axolotl: (e) => { e.axolotlVariant = 4; e.fromBucket = true; e.growAge = -12000; },
  cod: (e) => { e.fromBucket = true; },
  pufferfish: (e) => { e.fromBucket = true; Fish.setPuffState(e, 2); },   // #1277: PuffState + FromBucket
  tropical_fish: (e) => { e.fromBucket = true; e.fishVariant = 0x03020101; },
  dolphin: (e) => { e.moistness = 1234; e.gotFish = true; e.treasureX = 5; e.treasureY = 60; e.treasureZ = -7; e.air = 4000; },
  turtle: (e) => { e.homeX = 11; e.homeY = 62; e.homeZ = -33; e.hasEgg = true; e.travelPos = { x: 5, y: 60, z: -8 }; },
  mooshroom: (e) => { e.mooshroomType = 'brown'; e.stewEffect = { id: 'regeneration', ticks: 160 }; },
  villager: (e) => {
    e.profession = 'farmer'; e.villagerType = 'savanna'; e.villagerLevel = 2; e.tradeXp = 40;
    e.tradeOffers = [{ buy: 'wheat', sell: 'emerald', maxUses: 16 }]; e.tradeUses = [3]; e.tradeProfession = 'farmer';
    e.gossip = [{ type: 'minor_positive', value: 25, target: 1 }]; e.vbLastSlept = 12345;
    e.villagerInventory = [null, null, null, { i: 5, n: 1 }, null, null, null, null];
    e.tradeRestocksToday = 2; e.tradeLastRestock = 98765; e.vbFoodLevel = 7; e.gossipLastDecay = 54321;
  },
  zombie: (e) => { e.waterConvertTime = 400; e.convertCountdown = 123; },
  zombie_villager: (e) => {
    e.villagerType = 'taiga'; e.profession = 'librarian'; e.villagerLevel = 3; e.tradeXp = 250;
    e.tradeOffers = [{ buy: 'emerald', sell: 'book', maxUses: 12 }];
    e.tradeUses = [4]; e.gossip = [{ type: 'major_positive', value: 20, target: 1 }];
    e.converting = true; e.conversionTimer = 1800;
  },
  bee: (e) => {
    e.hasNectar = true; e.hasStung = true; e.angerTime = 12; e.angryAt = 3; e.ticksSinceSting = 5;
    e.ticksSincePollination = 6; e.cannotEnterHiveTicks = 7; e.cropsGrownSincePollination = 2;
    e.ticksUntilCanPollinate = 88; e.flowerPos = { x: 1, y: 2, z: 3 }; e.hivePos = { x: 4, y: 5, z: 6 };
    e.stingerCount = 1;
  },
  horse: (e) => {
    e.variant = 0x0305; e.saddled = true; e.tamed = true; e.owner = 'player';
    e.maxHealthAttr = 27; e.movementSpeedAttr = 0.2; e.jumpStrengthAttr = 0.85;
    e.mountItems = [{ i: 10, n: 1 }, null];
    e.armorItem = 'iron_horse_armor'; e.armorBonus = 5; e.temper = 55; e.bred = true; e.eatingGrass = true;
  },
  donkey: (e) => {
    e.saddled = true; e.hasChest = true; e.tamed = true; e.owner = 'player';
    e.maxHealthAttr = 22; e.movementSpeedAttr = 0.175; e.jumpStrengthAttr = 0.5;
    e.mountItems = new Array(17).fill(null).map((_, i) => (i === 2 ? { i: 5, n: 3 } : null));
  },
  mule: (e) => {
    e.saddled = true; e.hasChest = true; e.tamed = true; e.owner = 'player';
    e.maxHealthAttr = 24; e.movementSpeedAttr = 0.176; e.jumpStrengthAttr = 0.51;
    e.mountItems = new Array(17).fill(null);
  },
  llama: (e) => {
    e.saddled = false; e.hasChest = true; e.tamed = true; e.owner = 'player'; e.strength = 4;
    e.variant = 2; e.carpetColor = 9;
    e.maxHealthAttr = 25; e.movementSpeedAttr = 0.175; e.jumpStrengthAttr = 0.5;
    e.mountItems = new Array(14).fill(null);
  }
};

// s116 (MOB-RIDES-MOB): SkeletonHorseEntity.writeCustomDataToNbt/readCustomDataFromNbt
// (.decomp:122-133) -- SkeletonTrap/SkeletonTrapTime, the "07zw_mobnbt.js field rows" third
// of this unit (07zzc_lightning.js's own Lgt.OWED line named it missing).
SPECIES_TESTS.skeleton_horse = (e) => {
  e.trapped = true; e.trapTime = 12345;
  e.saddled = true; e.tamed = true; e.owner = 'player';
  e.maxHealthAttr = 16; e.movementSpeedAttr = 0.21; e.jumpStrengthAttr = 0.7;
  e.mountItems = [{ i: 10, n: 1 }, null];
};
// #714: ZombieHorseEntity is a HorseBase -- Tame/Owner/SaddleItem/Temper etc. must survive a reload.
SPECIES_TESTS.zombie_horse = (e) => {
  e.saddled = true; e.tamed = true; e.owner = 'player';
  e.maxHealthAttr = 17; e.movementSpeedAttr = 0.22; e.jumpStrengthAttr = 0.6;
  e.mountItems = [{ i: 10, n: 1 }, null];
};

// Baseline: a species MobNbt.fieldsFor gives no extra row for at all -- only COMMON should
// round-trip. Proves the COMMON path independently of any per-species entry.
SPECIES_TESTS.cow = (e) => { e.health = 9; e.growAge = -1200; e.inLove = 300; };

// #4466: the snapshot below is built FROM fieldsFor, so a missing SPECIES row is invisible to it -- pin the subclass rows
for (const t of ['slime', 'magma_cube']) ok(Mb.fieldsFor(t).includes('size') && Mb.fieldsFor(t).includes('onGroundLastTick'), t + ': Size/wasOnGround are persisted (SlimeEntity NBT, inherited by MagmaCubeEntity)');
// #5269: LightningEntity.read/writeCustomDataToNbt are EMPTY in 1.18.2 -- vanilla persists nothing of a live bolt
// (ambientTick/remainingActions/cosmetic/seed are not saved; a reload drops it), so there is deliberately no row.
ok(Mb.fieldsFor('lightning_bolt').join() === Mb.fieldsFor('cow').join(), 'lightning_bolt: no species row (vanilla persists no bolt NBT, #5269)');
ok(!Mb.fieldsFor('turtle').includes('landBound'), 'turtle: LAND_BOUND is a DataTracker flag, never persisted (#4580)');

const beforeByType = {};
for (const [type, mutate] of Object.entries(SPECIES_TESTS)) {
  const e = spawnMutated(type, mutate);
  if (!ok(!!e, type + ': EL.spawn resolved (dimensions/motion in entities.json)')) continue;
  beforeByType[type] = { id: e.id, snapshot: {} };
  const fields = Mb.fieldsFor(type);
  for (const f of fields) if (e[f] !== undefined) beforeByType[type].snapshot[f] = JSON.parse(JSON.stringify(e[f]));
}
say('  spawned ' + Object.keys(beforeByType).length + ' mutated mobs, ' + EL.list.length + ' total in EL.list');

ok(S.save(false), 'S.save() wrote a payload (localStorage backend + Player stub present)');
const savedRaw = globalThis.localStorage.getItem(S.KEY);
ok(!!savedRaw && JSON.parse(savedRaw).mobs && JSON.parse(savedRaw).mobs.length === EL.list.length,
  'the saved JSON envelope carries one mob record per live mob');

// A FRESH WORLD: exactly what Main.boot's second pass does -- a new EntityList, same module.
EL.clear();
ok(EL.list.length === 0, 'EL.list cleared -- the "fresh world" this check reloads into');

ok(S.load(), 'S.load() re-parsed the saved envelope');
ok(Array.isArray(S.mobRecords) && S.mobRecords.length === Object.keys(beforeByType).length,
  'S.load() stashed one mob record per saved mob (S.mobRecords, not yet spawned -- EL is not ready this early in the real boot either)');

const restored = Mb.restoreAll(S.mobRecords);
ok(restored === S.mobRecords.length, 'MobNbt.restoreAll() (Main.finishBoot\'s own call) spawned every record');

function findRestored(id0) {
  // ids are reassigned by the fresh EntityList (EL.nextId restarts) -- match by insertion order,
  // the same order `serializeAll`/`restoreAll` both walk `EL.list`/`records` in.
  return EL.list[id0];
}

let idx = 0;
for (const [type, rec] of Object.entries(beforeByType)) {
  const e = findRestored(idx++);
  if (!ok(!!e && e.type === type, type + ': reloaded entity is the right type at the right slot')) continue;
  let allMatch = true;
  for (const [f, v] of Object.entries(rec.snapshot)) {
    const got = e[f];
    const eq = JSON.stringify(got) === JSON.stringify(v);
    if (!eq) allMatch = false;
    ok(eq, type + '.' + f + ' round-tripped (' + JSON.stringify(v) + ' -> ' + JSON.stringify(got) + ')');
  }
  ok(allMatch, type + ': every persisted field round-tripped');
  // #1036: independent of fieldsFor (the snapshot above only sees fields the row names) -- a bucketed baby stays bucketed.
  if (type === 'axolotl') ok(e.fromBucket === true && e.growAge === -12000, 'axolotl: FromBucket + Age (baby) survive a reload (despawn rule keeps canImmediatelyDespawn false)');
  // #3905: PiglinEntity "Inventory" (8 slots) survives a reload, and dropInventory empties it into drops.
  if (type === 'piglin') {
    ok(JSON.stringify(e.inventory) === JSON.stringify(SPECIES_PIGLIN_INV), 'piglin: Inventory survives a reload');
    const d = MCL1.Piglin.dropInventory(e);
    ok(d.length === 1 && d[0].count === 3 && e.inventory === null, 'piglin: dropInventory yields the one stack and clears the inventory');
  }
  // Position/yaw are COMMON to every entity, not species-specific -- checked once per species.
  ok(Math.abs(e.x - 100.5) < 1e-9 && Math.abs(e.y - 64.0) < 1e-9 && Math.abs(e.z + 200.25) < 1e-9,
    type + ': position round-tripped');
  ok(Math.abs(e.yaw - 137.5) < 1e-9, type + ': yaw round-tripped');
  // The REAL EL.spawn path re-derives dimensions/motion rather than them being hand-copied.
  ok(e.width > 0 && e.height > 0, type + ': dimensions re-derived by the real EL.spawn (not persisted numbers)');
}

// ── § 2 -- a pre-existing save (no `mobs` key) still loads, zero mobs, no throw ─────────────
say('\n§2 a save from before this unit loads with zero mobs');
const MCL2 = freshMCL();
const legacyPayload = JSON.stringify({
  v: MCL2.Save.VERSION, seed: 42, climate: 'vanilla', worldScale: 12000, t: Date.now(),
  player: MCL2.Player.toJSON(), data: MCL2.Save.encode()
  // no `mobs` key at all -- exactly what session <104's own save files look like on disk
});
globalThis.localStorage.setItem(MCL2.Save.KEY, legacyPayload);
let threw = null;
try { MCL2.Save.load(); } catch (e) { threw = e; }
ok(!threw, 'S.load() on a mobs-less legacy save does not throw');
ok(Array.isArray(MCL2.Save.mobRecords) && MCL2.Save.mobRecords.length === 0,
  'a legacy save (no `mobs` key) yields S.mobRecords === [] (not undefined, not a crash)');
ok(MCL2.MobNbt.restoreAll(MCL2.Save.mobRecords) === 0, 'restoreAll([]) is a no-op, zero mobs spawned');

// ── § 3 -- anti-vacuity: drop one field, prove the round trip then breaks ───────────────────
say('\n§3 anti-vacuity -- remove one field from the persisted list and confirm the LOSS is caught');

const MCL3 = freshMCL();
const EL3 = MCL3.EntityList, Mb3 = MCL3.MobNbt, S3 = MCL3.Save;
const wolf = EL3.spawn('wolf', 0, 64, 0);
wolf.tamed = true; wolf.owner = 'player'; wolf.sitting = true; wolf.collarColor = 'cyan'; wolf.angerTime = 55;

const realFieldsFor = Mb3.fieldsFor;
Mb3.fieldsFor = function (type) {
  const f = realFieldsFor(type);
  return type === 'wolf' ? f.filter((n) => n !== 'tamed') : f;
};

ok(S3.save(false), '(broken build) S.save() still succeeds -- the break is silent, as any real regression would be');
EL3.clear();
S3.load();
Mb3.restoreAll(S3.mobRecords);
const brokenWolf = EL3.list[0];
okAv(!!brokenWolf && brokenWolf.tamed !== true,
  'with "tamed" struck from MobNbt.fieldsFor, a reloaded tamed wolf comes back UNTAMED -- the round trip test above would have failed exactly here if the real code had this hole');

Mb3.fieldsFor = realFieldsFor; // restore -- prove the FIX, not just the break
const EL3b = MCL3.EntityList;
EL3b.clear();
const wolf2 = EL3b.spawn('wolf', 0, 64, 0);
wolf2.tamed = true; wolf2.owner = 'player'; wolf2.sitting = false; wolf2.collarColor = 'cyan'; wolf2.angerTime = 55;
S3.save(false);
EL3b.clear();
S3.load();
Mb3.restoreAll(S3.mobRecords);
okAv(EL3b.list[0] && EL3b.list[0].tamed === true,
  'restoring the field list, the SAME wolf comes back tamed -- the check catches both the break and the fix');


// #672: a brown mooshroom fed a flower keeps its suspicious-stew effect (MooshroomEntity
// EffectId/EffectDuration) across save/load. Asserted directly on e.stewEffect, NOT through the
// field list, so a missing row in MobNbt.fieldsFor fails it.
{
  const M5 = freshMCL();
  const EL5 = M5.EntityList, Mb5 = M5.MobNbt, S5 = M5.Save;
  const run = (strike) => {
    EL5.clear();
    const m = EL5.spawn('mooshroom', 5, 64, 5);
    m.mooshroomType = 'brown';
    m.stewEffect = { id: 'regeneration', ticks: 160 };   // what Mo.interact sets for a dandelion
    const realFF = Mb5.fieldsFor;
    if (strike) Mb5.fieldsFor = (t) => realFF(t).filter((n) => n !== 'stewEffect');
    S5.save(false);
    Mb5.fieldsFor = realFF;
    EL5.clear(); S5.load(); Mb5.restoreAll(S5.mobRecords);
    const r = EL5.list[0];
    return r && M5.Mooshroom.interact(r, 'bowl');
  };
  const good = run(false);
  ok(good && good.swapTo === 'suspicious_stew' && good.tag && good.tag.Effects[0].EffectDuration > 0,
     '#672: a reloaded fed brown mooshroom still yields suspicious_stew from a bowl', JSON.stringify(good));
  const bad = run(true);
  okAv(bad && bad.swapTo === 'mushroom_stew', '#672: with stewEffect struck from the field list the bowl gives plain mushroom_stew (loss is caught)');
}

// D-590: riders survive a reload. Vanilla nests them in the vehicle's "Passengers" NBT list and
// re-mounts on load; a chicken jockey also carries IsChickenJockey. Before D-590 a saved chicken
// jockey came back as two separate mobs and a chicken flagged hasJockey=false.
{
  const M4 = freshMCL();
  const EL4 = M4.EntityList, Mb4 = M4.MobNbt, S4 = M4.Save;
  const run = (breakIt) => {
    EL4.clear();
    const hen = EL4.spawn('chicken', 10, 64, 10);
    const kid = EL4.spawn('zombie', 10, 64, 10, { growAge: -24000 });
    const cow = EL4.spawn('cow', 30, 64, 30);   // a mob riding NOTHING must stay unmounted
    M4.Undead.mountJockey(kid, hen);
    M4.Passive.setChickenJockey ? M4.Passive.setChickenJockey(hen, true) : (hen.hasJockey = true);
    const realSer = Mb4.serializeAll;
    if (breakIt) Mb4.serializeAll = () => realSer().map((r) => { delete r.vehicleIdx; return r; });
    S4.save(false);
    Mb4.serializeAll = realSer;
    EL4.clear(); S4.load(); Mb4.restoreAll(S4.mobRecords);
    const c = EL4.list.find((e) => e.type === 'chicken');
    const z = EL4.list.find((e) => e.type === 'zombie');
    const w = EL4.list.find((e) => e.type === 'cow');
    return { c, z, w };
  };
  const good = run(false);
  ok(good.c && good.z && good.z.vehicle === good.c && good.c.passenger === good.z,
     'D-590: a saved chicken jockey reloads MOUNTED (rider.vehicle === the chicken)');
  ok(good.c && good.c.hasJockey === true, 'D-590: the chicken reloads with hasJockey (IsChickenJockey) true');
  ok(good.z && good.c && Math.abs(good.z.x - good.c.x) < 1e-9 && good.z.y > good.c.y,
     'D-590: the rider is re-seated on the chicken (same x, above it)', good.z && good.c && JSON.stringify([good.z.x,good.z.y,good.c.x,good.c.y]));
  ok(good.w && !good.w.vehicle && !good.w.riding, 'D-590: a mob that rode nothing reloads unmounted');
  const bad = run(true);
  okAv(bad.z && !bad.z.vehicle, 'with vehicleIdx dropped from the records, the jockey reloads UNMOUNTED — the check sees it');
}

{ // #3000: ShulkerEntity AttachFace/Peek survive save/load
  const M5 = freshMCL();
  const EL5 = M5.EntityList, Mb5 = M5.MobNbt, S5 = M5.Save;
  const run = (breakIt) => {
    EL5.clear();
    const sh = EL5.spawn('shulker', 10, 64, 10);
    sh.shulkerFace = 2; sh.shulkerPeek = 30; sh.shulkerArmorMod = true;
    const realSer = Mb5.serializeAll;
    if (breakIt) Mb5.serializeAll = () => realSer().map((r) => { delete r.shulkerFace; delete r.shulkerPeek; delete r.shulkerArmorMod; return r; });
    S5.save(false);
    Mb5.serializeAll = realSer;
    EL5.clear(); S5.load(); Mb5.restoreAll(S5.mobRecords);
    return EL5.list.find((e) => e.type === 'shulker');
  };
  const g = run(false);
  ok(g && g.shulkerFace === 2 && g.shulkerPeek === 30, '#3000: shulker reloads with AttachFace and Peek', g && JSON.stringify([g.shulkerFace, g.shulkerPeek]));
  ok(g && g.shulkerArmorMod === true, '#4513: closed shulker keeps Covered armor bonus (+20) after reload', g && g.shulkerArmorMod);
  const b = run(true);
  okAv(b && !(b.shulkerFace === 2 && b.shulkerPeek === 30), 'with face/peek dropped from the records, the shulker reloads reset — the check sees it');
}

{ // #3648: WitherEntity "Invul" survives save/load
  const M6 = freshMCL();
  const EL6 = M6.EntityList, Mb6 = M6.MobNbt, S6 = M6.Save;
  const run = (breakIt) => {
    EL6.clear();
    const w = EL6.spawn('wither', 10, 64, 10);
    w.invulTimer = 123;
    const realSer = Mb6.serializeAll;
    if (breakIt) Mb6.serializeAll = () => realSer().map((r) => { delete r.invulTimer; return r; });
    S6.save(false);
    Mb6.serializeAll = realSer;
    EL6.clear(); S6.load(); Mb6.restoreAll(S6.mobRecords);
    return EL6.list.find((e) => e.type === 'wither');
  };
  const g = run(false);
  ok(g && g.invulTimer === 123, '#3648: wither reloads with its Invul timer', g && g.invulTimer);
  const b = run(true);
  okAv(b && b.invulTimer !== 123, 'with invulTimer dropped from the records, the wither reloads with 0 — the check sees it');
}

{   // #4219: a chest minecart's Items / LootTable survive the save records
  const run = (breakIt) => {
    const M = freshMCL();
    const a = M.EntityList.spawn('chest_minecart', 5.5, 70, 5.5, {}); a.inventory[2] = { item: 'dirt', count: 4 };
    M.EntityList.spawn('chest_minecart', 8.5, 70, 5.5, { LootTable: 'minecraft:chests/simple_dungeon', LootTableSeed: 9 });
    const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    if (breakIt) recs.forEach((r) => { delete r.cartNbt; });
    M.EntityList.list.length = 0; M.MobNbt.restoreAll(recs);
    const c = M.EntityList.list.filter((x) => x.type === 'chest_minecart');
    return c.length === 2 && c[0].inventory[2] && c[0].inventory[2].count === 4 && c[1].lootTable === 'minecraft:chests/simple_dungeon' && c[1].lootTableSeed === 9;
  };
  ok(run(false), '#4219: chest carts reload with their items and loot table');
  okAv(!run(true), 'with cartNbt dropped from the records, the carts reload empty — the check sees it');
}

{   // #5482: ExperienceOrbEntity Value / Age survive save/load
  const run = (breakIt) => {
    const M = freshMCL();
    if (M.Xp && M.Xp.init) M.Xp.init();
    const o = M.EntityList.spawn('experience_orb', 5.5, 70, 5.5, {});
    o.value = 17; o.orbAge = 5900; o.pickingCount = 1;
    const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    if (breakIt) recs.forEach((r) => { delete r.value; delete r.orbAge; });
    M.EntityList.list.length = 0; M.MobNbt.restoreAll(recs);
    const n = M.EntityList.list.find((x) => x.type === 'experience_orb');
    if (!n) return false;
    if (n.value !== 17 || n.orbAge !== 5900) return false;
    for (let i = 0; i < 99; i++) M.Xp.tick(n);
    if (n.removed) return false;
    M.Xp.tick(n);
    if (!n.removed) return false;
    return true;
  };
  ok(run(false), '#5482: orb reloads with Value 17, Age 5900 and despawns 100 ticks later');
  okAv(!run(true), 'with value/orbAge dropped from the records, the orb reloads fresh — the check sees it');
}

{ // #5487: a ghast fireball in flight survives save/load and explodes with its ExplosionPower
  const run = (breakIt) => {
    const M = freshMCL();
    const EL7 = M.EntityList, Mb7 = M.MobNbt;
    EL7.clear();
    const gh = EL7.spawn('ghast', 0, 70, 0);
    const f = EL7.spawn('fireball', 5, 70, 5, { shooter: gh, power: [1, 0, 2], explosionPower: 2 });
    f.vx = 0.3; f.vy = -0.1; f.vz = 0.6; f.age = 7;
    const want = [f.powerX, f.powerY, f.powerZ];
    let recs = JSON.parse(JSON.stringify(Mb7.serializeAll()));
    if (breakIt) recs = recs.filter((r) => r.type !== 'fireball');
    EL7.clear(); Mb7.restoreAll(recs);
    const g = EL7.list.find((e) => e.type === 'fireball');
    if (!g) return false;
    const same = g.explosionPower === 2 && g.vx === 0.3 && g.vy === -0.1 && g.vz === 0.6 && g.age === 7 &&
      g.powerX === want[0] && g.powerY === want[1] && g.powerZ === want[2] && g.shooter && g.shooter.type === 'ghast';
    let radius = null;
    const E = M.Explosion, real = E.explode;
    E.ready = true; E.explode = function (a, x, y, z, r) { radius = r; };
    g.onGround = true; M.Ghast.tickFireball(g);
    E.explode = real;
    return same && radius === 2;
  };
  ok(run(false), '#5487: fireball reloads with power, velocity, owner and ExplosionPower 2');
  okAv(!run(true), 'with the fireball record dropped, nothing reloads — the check sees it');
}

{   // #5570: command_block_minecart Command/SuccessCount/TrackOutput and spawner_minecart SpawnData survive the save records
  const run = (breakIt) => {
    const M = freshMCL();
    const c = M.EntityList.spawn('command_block_minecart', 5.5, 70, 5.5, { Command: 'say hi', SuccessCount: 3, TrackOutput: false });
    M.EntityList.spawn('spawner_minecart', 8.5, 70, 5.5, { SpawnData: { entity: { id: 'minecraft:cow' } }, Delay: 77 });
    const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    if (breakIt) recs.forEach((r) => { delete r.cartNbt; });
    M.EntityList.list.length = 0; M.MobNbt.restoreAll(recs);
    const a = M.EntityList.list.find((x) => x.type === 'command_block_minecart'), b = M.EntityList.list.find((x) => x.type === 'spawner_minecart');
    return !!a && !!b && a.command === 'say hi' && a.successCount === 3 && a.trackOutput === false && b.spawnerLogic.entity === 'cow' && b.spawnerLogic.delay === 77;
  };
  ok(run(false), '#5570: command/spawner carts reload with command, SuccessCount, SpawnData and Delay');
  okAv(!run(true), 'with cartNbt dropped from the records, the carts reload default — the check sees it');
}

{   // #5568: a disabled hopper minecart keeps Enabled, its slots and position
  const run = (breakIt) => {
    const M = freshMCL();
    const h = M.EntityList.spawn('hopper_minecart', 6.5, 70, 7.5, {});
    h.inventory[4] = { item: 'stone', count: 9 }; h.inventory[0] = { item: 'dirt', count: 2 }; h.hopperEnabled = false;
    const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    if (breakIt) recs.forEach((r) => { delete r.cartNbt; });
    M.EntityList.list.length = 0; M.MobNbt.restoreAll(recs);
    const c = M.EntityList.list.filter((x) => x.type === 'hopper_minecart');
    return c.length === 1 && c[0].hopperEnabled === false && c[0].inventory[4] && c[0].inventory[4].count === 9 &&
      c[0].inventory[0] && c[0].inventory[0].item === 'dirt' && !c[0].inventory[1] && c[0].x === 6.5 && c[0].z === 7.5;
  };
  ok(run(false), '#5568: hopper carts reload disabled with their slots and position');
  okAv(!run(true), 'with cartNbt dropped, the hopper cart reloads enabled and empty — the check sees it');
}

{   // #5682: a lingering cloud keeps Radius/Age/Duration/effects through save/load and keeps applying them
  const run = (breakIt) => {
    const M = freshMCL();
    const c = M.EntityList.spawn('area_effect_cloud', 5.5, 70, 5.5, { radius: 2.4, waitTime: 10, duration: 600, radiusGrowth: -0.004,
      custom: [{ effect: 'speed', duration: 200, amplifier: 1 }] });
    c.age = 37;
    const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    if (breakIt) recs.forEach((x) => { x.type = 'cow'; });
    M.EntityList.list.length = 0; M.MobNbt.restoreAll(recs);
    const g = M.EntityList.list.find((x) => x.type === 'area_effect_cloud');
    if (!g || g.age !== 37 || g.radius !== 2.4 || g.duration !== 600 || g.custom[0].effect !== 'speed') return false;
    const cow = M.EntityList.spawn('cow', 5.5, 70, 5.5, {});
    g.age = 40; M.Potion.tickCloud(g);
    return !g.removed && g.radius < 2.4 && !!g.affected[cow.id];
  };
  ok(run(false), '#5682: cloud reloads with age 37, radius 2.4, its effects, and ticks on to affect an entity inside');
  okAv(!run(true), 'with the cloud row broken, no cloud survives reload — the check sees it');
}

{   // #5488: a rocket in flight keeps Life/LifeTime/FireworksItem through save/load
  const run = (breakIt) => {
    const M = freshMCL();
    const r = M.EntityList.spawn('firework_rocket', 5.5, 70, 5.5, { tag: { Fireworks: { Flight: 2, Explosions: [{ Type: 0, Colors: [1] }] } } });
    r.life = 10; r.lifeTime = 27;
    const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    if (breakIt) recs.forEach((x) => { x.type = 'cow'; });
    M.EntityList.list.length = 0; M.MobNbt.restoreAll(recs);
    const g = M.EntityList.list.find((x) => x.type === 'firework_rocket');
    return !!g && g.life === 10 && g.lifeTime === 27 && g.tag.Fireworks.Explosions.length === 1 && g.tag.Fireworks.Flight === 2;
  };
  ok(run(false), '#5488: rocket reloads with life 10, lifeTime 27 (not rerolled) and its explosion list');
  okAv(!run(true), 'with the rocket row broken, the rocket is lost — the check sees it');
}
// #5683: a llama_spit mid-flight keeps its owner, LeftOwner and flight across save/load.
{
  const run = (breakIt) => {
    const M = freshMCL();
    const ll = M.EntityList.spawn('llama', 0.5, 70, 0.5, {});
    const tg = M.EntityList.spawn('sheep', 8.5, 70, 0.5, {});
    if (!ll || !tg) return false;
    M.Player.dead = true;   // the headless Player stub has no position; keep it out of the spit's target list
    const sp = M.EntityList.spawn('llama_spit', 1.0, 70.5, 0.5, { vx: 0.5, vy: 0, vz: 0, shooter: ll });
    sp.leftOwner = false;
    const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    if (breakIt) recs.splice(recs.findIndex((r) => r.type === 'llama_spit'), 1);
    M.EntityList.list.length = 0; M.MobNbt.restoreAll(recs);
    const s2 = M.EntityList.list.find((x) => x.type === 'llama_spit');
    const l2 = M.EntityList.list.find((x) => x.type === 'llama'), t2 = M.EntityList.list.find((x) => x.type === 'sheep');
    if (!s2 || s2.shooter !== l2 || s2.leftOwner !== false || !(s2.vx > 0)) return false;
    const h0 = t2.health, lh = l2.health, x0 = s2.x;
    for (let i = 0; i < 40 && !s2.removed && t2.health === h0; i++) { s2.x += s2.vx; M.Llama.tick(s2); }
    
    return s2.x > x0 && t2.health === h0 - 1 && l2.health === lh;
  };
  ok(run(false), '#5683: reloaded llama spit keeps owner, travels, hits the target for 1, spares its llama');
  okAv(!run(true), 'with the llama_spit record dropped the reloaded world has no spit — the check sees it');
}

{   // #5490: a splash potion of healing mid-flight survives save/load and lands on the same tick as an unsaved twin
  const run = (saveAt, breakIt) => {
    const M = freshMCL();
    const L = M.EntityList;
    if (breakIt) { const real = M.MobNbt.fieldsFor; M.MobNbt.fieldsFor = (t) => real(t).filter((f) => f !== 'potionId' && f !== 'vx'); }
    const floor = () => {
      for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
        if (!M.World.chunks.get(M.World.key(cx, cz))) { const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c); }
      }
      for (let x = 8; x <= 13; x++) for (let z = 8; z <= 13; z++) M.World.setBlock(x, 4, z, M.States.stateOf('stone') | 0);
    };
    M.Player.x = 1e4; M.Player.y = 200; M.Player.z = 1e4; floor();
    const cow = L.spawn('cow', 10.5, 5, 10.5); cow.health = 2;
    const pot = L.spawn('potion', 10.5, 12, 10.5, { vx: 0.1, vy: 0, vz: 0, potionId: 'healing', lingering: false, item: 5 });
    let landed = -1;
    for (let t = 1; t <= 80 && landed < 0; t++) {
      if (t === saveAt) {
        M.Save.save(false);
        L.clear(); M.Save.load(); floor(); M.MobNbt.restoreAll(M.Save.mobRecords);
      }
      L.tick();
      if (!L.list.some((x) => x.type === 'potion')) landed = t;
    }
    const c = L.list.find((x) => x.type === 'cow');
    return { landed, health: c && c.health };
  };
  const twin = run(0, false), saved = run(3, false);
  ok(twin.landed > 3, '#5490: unsaved potion lands after tick 3 ' + JSON.stringify(twin));
  ok(saved.landed === twin.landed && saved.health === twin.health, '#5490: saved/loaded healing potion lands on the same tick with the same effect',
     JSON.stringify([twin, saved]));
  const bad = run(3, true);
  okAv(bad.landed !== twin.landed || bad.health !== twin.health, 'with potionId/vx dropped from MobNbt rows, the reloaded potion differs from the twin — the check sees it', JSON.stringify(bad));
}
// #5479: a primed TNT keeps its fuse and igniter across save/load and explodes on exactly that tick.
{
  const run = (breakIt) => {
    const M = freshMCL();
    M.Explosion.ready = true; M.Tnt.init();
    const real = M.Explosion.explode; let blasts = 0;
    M.Explosion.explode = () => { blasts++; };
    M.EntityList.spawn('tnt', 5.5, 70, 5.5, { fuse: 37, igniter: M.Player });
    const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    if (breakIt) recs.forEach((r) => { if (r.type === 'tnt') delete r.fuse; });
    M.EntityList.list.length = 0; M.MobNbt.restoreAll(recs);
    const t = M.EntityList.list.find((x) => x.type === 'tnt');
    if (!t) { M.Explosion.explode = real; return false; }
    const credit = t.igniter === M.Player;
    let early = false;
    for (let i = 1; i <= 36; i++) { M.Tnt.tick(t); if (blasts) early = true; }
    M.Tnt.tick(t);
    M.Explosion.explode = real;
    return credit && !early && blasts === 1;
  };
  ok(run(false), '#5479: primed TNT explodes on exactly tick 37 after reload, igniter credit kept');
  okAv(!run(true), 'with Fuse dropped from the record, the reloaded TNT fires on the wrong tick — the check sees it');
}

{   // #5484: a boat's Type and its rider survive save/load; location state does not
  const run = (mode) => {
    const M = freshMCL();
    const b = M.EntityList.spawn('boat', 5.5, 70, 5.5, { boatType: 'birch' });
    const z = M.EntityList.spawn('villager', 5.5, 70, 5.5, {});
    M.Raid.startRiding(z, b); b.passengers.push(z); b.vx = 0.3;
    const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    if (mode === 'drop') for (let i = recs.length; i--;) if (recs[i].type === 'boat') recs.splice(i, 1);
    if (mode === 'type') recs.forEach((r) => { delete r.boatType; });
    M.EntityList.list.length = 0; M.MobNbt.restoreAll(recs);
    const nb = M.EntityList.list.filter((x) => x.type === 'boat')[0];
    const nz = M.EntityList.list.filter((x) => x.type === 'villager')[0];
    return !!nb && nb.boatType === 'birch' && nz && nz.vehicle === nb && nb.passengers.indexOf(nz) >= 0 && nb.vx === 0.3;   // Motion persists (#5680, vanilla Entity.saveWithoutId)
  };
  ok(run(''), '#5484: boat reloads as birch with its rider re-mounted and its Motion kept (#5680)');
  okAv(!run('drop'), 'with the boat row removed, no boat reloads — the check sees it');
  okAv(!run('type'), 'with boatType dropped, the boat reloads oak — the check sees it');
}

{   // #5485: a stuck arrow survives save/load, can be picked up, and falls when its block is mined
  const run = (breakIt) => {
    const M = freshMCL(); const EL = M.EntityList, Cb = M.Combat;
    const stone = M.States.defaultState ? null : null;
    EL.clear();
    const a = EL.spawn('arrow', 5.5, 70.5, 5.5, {});
    a.pickupType = 'allowed'; a.pickupItem = 'arrow'; a.critical = true;
    Cb.embedArrow(a, { state: 1, cx: 5, cy: 70, cz: 6 });
    a.shake = 0; a.groundTicks = 77;
    let recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    if (breakIt) recs = recs.filter((r) => r.type !== 'arrow');
    EL.clear(); M.MobNbt.restoreAll(recs);
    const b = EL.list.find((x) => x.type === 'arrow');
    return b && b.stuck && b.pickupType === 'allowed' && b.groundTicks === 77 && b.critical === true && b.groundState === 1 && b.vx === 0;
  };
  ok(run(false), '#5485: stuck arrow reloads inGround with pickup=allowed, life, crit, inBlockState');
  okAv(!run(true), 'with the arrow record dropped, no stuck arrow reloads — the check sees it');
}

{   // #5775: a Loyalty trident stuck in a wall keeps its stack tag, dealtDamage and return state across save/load
  const run = (breakIt) => {
    const M = freshMCL(); const EL = M.EntityList, Cb = M.Combat;
    EL.clear();
    const t = EL.spawn('trident', 5.5, 70.5, 5.5, { shooter: M.Player });
    const tag = { ench: [{ id: 'loyalty', lvl: 2 }] };
    t.loyalty = 2; t.pickupType = 'allowed'; t.pickupItem = 'trident'; t.pickupTag = tag; t.pickupDamage = 7;
    Cb.embedArrow(t, { state: 1, cx: 5, cy: 70, cz: 6 });
    t.dealtDamage = true; t.inGroundTime = 9;
    let recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    if (breakIt) recs = recs.filter((r) => r.type !== 'trident');
    EL.clear(); M.MobNbt.restoreAll(recs);
    const b = EL.list.find((x) => x.type === 'trident');
    return !!b && b.stuck && b.loyalty === 2 && b.dealtDamage === true && b.pickupDamage === 7 && b.pickupType === 'allowed' &&
      JSON.stringify(b.pickupTag) === JSON.stringify(tag) && b.shooter === M.Player;
  };
  ok(run(false), '#5775: stuck Loyalty trident reloads with Enchantments tag, dealtDamage, pickup, thrower');
  okAv(!run(true), 'with the trident row dropped, no trident reloads — the check sees it');
}

{   // #5481: a falling block mid-fall survives save/load (FallingBlockEntity BlockState/Time/DropItem/HurtEntities/FallHurtAmount/FallHurtMax)
  const run = (breakIt) => {
    const M = freshMCL();
    const gravel = M.States.stateOf('gravel') | 0, anvil = M.States.stateOf('anvil') | 0;
    const a = M.EntityList.spawn('falling_block', 5.5, 90, 5.5, { state: gravel });
    a.timeFalling = 11; a.dropItem = false;
    const b = M.EntityList.spawn('falling_block', 8.5, 90, 5.5, { state: anvil });
    b.hurtEntities = true; b.fallHurtAmount = 2.0; b.fallDamageMax = 40;
    if (breakIt) M.MobNbt.fieldsFor = (t) => ['yaw'];
    const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    M.EntityList.list.length = 0; M.MobNbt.restoreAll(recs);
    const c = M.EntityList.list.filter((x) => x.type === 'falling_block');
    return c.length === 2 && c[0].state === gravel && c[0].timeFalling === 11 && c[0].dropItem === false &&
      c[1].state === anvil && c[1].hurtEntities === true && c[1].fallHurtAmount === 2.0 && c[1].fallDamageMax === 40;
  };
  ok(run(false), '#5481: falling blocks reload with state, time, dropItem and anvil hurt fields');
  okAv(!run(true), 'with the falling_block row gone, the falling blocks are lost or reset — the check sees it');
}

{   // #5478: dropped item entities keep Item / Age / PickupDelay
  const run = (breakIt) => {
    const M = freshMCL();
    const d = M.EntityList.dropStack(5.5, 70, 5.5, 'dirt', 7, { pickupDelay: 17 }); d.age = 1234;
    const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    if (breakIt) recs.forEach((r) => { if (r.type === 'item') { delete r.age; delete r.pickupDelay; } });
    M.EntityList.list.length = 0; M.MobNbt.restoreAll(recs);
    const e = M.EntityList.list.find((x) => x.type === 'item');
    return !!e && e.item === 'dirt' && e.count === 7 && e.age === 1234 && e.pickupDelay === 17;
  };
  ok(run(false), '#5478: dropped item reloads with item/count/age/pickupDelay');
  okAv(!run(true), 'with age/pickupDelay dropped from the records, the item reloads fresh — the check sees it');
}

{   // #5777: item Owner/Thrower/Health survive save/load; the owner rule still holds
  const run = (breakIt) => {
    const M = freshMCL();
    const d = M.EntityList.dropStack(5.5, 70, 5.5, 'dirt', 7, { pickupDelay: 0 }); d.itemOwner = 'owner-uuid'; d.thrower = 'thrower-uuid';
    M.EntityList.hurtItem(d, 2, { fire: true });
    const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    if (breakIt) recs.forEach((r) => { if (r.type === 'item') { delete r.health; delete r.itemOwner; delete r.thrower; } });
    M.EntityList.list.length = 0; M.MobNbt.restoreAll(recs);
    const e = M.EntityList.list.find((x) => x.type === 'item');
    return !!e && e.health === 3 && e.itemOwner === 'owner-uuid' && e.thrower === 'thrower-uuid';
  };
  ok(run(false), '#5777: item reloads with health 3, owner and thrower');
  okAv(!run(true), 'with health/owner/thrower dropped from the records, the item reloads reset — the check sees it');
}

{   // #5569: furnace_minecart Fuel/PushX/PushZ and tnt_minecart TNTFuse survive save/load
  const run = (breakIt) => {
    const M = freshMCL();
    const f = M.EntityList.spawn('furnace_minecart', 5.5, 70, 5.5, {}); f.fuel = 3000; f.pushX = 0.5; f.pushZ = -0.25; f.cartLit = true;
    const t = M.EntityList.spawn('tnt_minecart', 8.5, 70, 5.5, {}); t.cartFuse = 40;
    const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    if (breakIt) recs.forEach((r) => { if (r.cartNbt) { delete r.cartNbt.Fuel; delete r.cartNbt.PushX; delete r.cartNbt.PushZ; delete r.cartNbt.TNTFuse; } });
    M.EntityList.list.length = 0; M.MobNbt.restoreAll(recs);
    const a = M.EntityList.list.find((x) => x.type === 'furnace_minecart'), b = M.EntityList.list.find((x) => x.type === 'tnt_minecart');
    return !!a && !!b && a.fuel === 3000 && a.pushX === 0.5 && a.pushZ === -0.25 && a.cartLit === true && b.cartFuse === 40;
  };
  ok(run(false), '#5569: furnace cart keeps Fuel/Push, tnt cart keeps its fuse');
  okAv(!run(true), 'with the cart fields dropped from the records, the carts reload unlit — the check sees it');
}

{
  // #5680: Entity base NBT (Fire, Air, FallDistance, Motion, OnGround) through a real save/load
  const run = (breakIt) => {
    const M = freshMCL();
    const z = M.EntityList.spawn('zombie', 0.5, 70, 0.5, {});
    z.remainingFireTicks = 100; z.air = 120; z.fallDistance = 6.5; z.vx = 0.1; z.vy = -0.4; z.vz = 0.2; z.onGround = true;
    if (breakIt) { const f = M.MobNbt.fieldsFor; M.MobNbt.fieldsFor = (t) => f(t).filter((n) => !['remainingFireTicks', 'air', 'fallDistance', 'vx', 'vy', 'vz', 'onGround'].includes(n)); }
    M.Save.save(false);
    M.EntityList.clear(); M.Save.load(); M.MobNbt.restoreAll(M.Save.mobRecords);
    const r = M.EntityList.list.find((x) => x.type === 'zombie');
    return !!r && r.remainingFireTicks === 100 && r.air === 120 && r.fallDistance === 6.5 && r.vx === 0.1 && r.vy === -0.4 && r.vz === 0.2 && r.onGround === true;
  };
  ok(run(false), '#5680: zombie keeps Fire/Air/FallDistance/Motion/OnGround across S.save()/S.load()');
  okAv(!run(true), '#5680: with the base fields struck from fieldsFor the zombie reloads cool, airy and at rest');
}

{
  // #5795: leash holder (fence knot / trader) survives save/load; a gone holder drops a lead
  const run = (breakIt) => {
    const M = freshMCL();
    const h = M.EntityList.spawn('horse', 4.5, 70, 4.5, {}), tr = M.EntityList.spawn('wandering_trader', 10.5, 70, 10.5, {});
    const ll = M.EntityList.spawn('trader_llama', 11.5, 70, 10.5, {}), orphan = M.EntityList.spawn('cow', 20.5, 70, 20.5, {});
    const gone = M.EntityList.spawn('wandering_trader', 30.5, 70, 30.5, {});
    h.leashHolder = { kind: 'knot', knot: M.Tame.getOrCreateKnot(5, 70, 5) };
    ll.leashHolder = { kind: 'entity', entity: tr };
    orphan.leashHolder = { kind: 'entity', entity: gone }; gone.removed = true;
    const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
    if (breakIt) recs.forEach((r) => { delete r.leashKnot; delete r.leashIdx; delete r.leashLost; });
    M.EntityList.list.length = 0; M.Tame.knots = [];
    M.MobNbt.restoreAll(recs);
    const L = M.EntityList.list, H = L.find((x) => x.type === 'horse'), LL = L.find((x) => x.type === 'trader_llama');
    const T = L.find((x) => x.type === 'wandering_trader'), C = L.find((x) => x.type === 'cow');
    const lead = M.Items.of(M.Tame.LEASH_ITEM);
    const drops = L.filter((x) => x.type === 'item' || x.itemIdx === lead || x.stack).length;
    if (!(H && LL && T && C && H.leashHolder && H.leashHolder.kind === 'knot' && H.leashHolder.knot.bx === 5 && M.Tame.knots.length === 1 &&
          LL.leashHolder && LL.leashHolder.entity === T && !C.leashHolder && drops >= 1)) return false;
    LL.x = T.x + 8; LL.vx = 0; M.Tame.updateLeash(LL);   // 6 < dist <= 10 pulls toward the holder
    return LL.vx < 0;
  };
  ok(run(false), '#5795: horse keeps its fence knot, llama its trader, orphaned cow comes back unleashed with a lead; the lead still pulls');
  okAv(!run(true), '#5795: with the Leash fields struck from the records, nothing stays leashed — the check sees it');
}

// ── § 5 -- #5784 villager Brain memories (HOME/JOB_SITE/POTENTIAL_JOB_SITE/MEETING_POINT) ──
{
  const run = (breakIt) => {
    const M = freshMCL();
    const tick = {};
    const k = (p) => p.x + ',' + p.y + ',' + p.z;
    M.Poi = { reserveTicket: (p) => { if (tick[k(p)]) return false; tick[k(p)] = 1; return true; }, isOccupied: (p) => !!tick[k(p)] };
    M.Profession.claimed = M.Profession.claimed || {};
    const v = M.EntityList.spawn('villager', 0, 64, 0);
    v.profession = 'mason'; v.vbHome = { x: 3, y: 64, z: 4 }; v.vbMeeting = { x: 9, y: 64, z: 9 };
    v.vbPotentialJob = { x: 5, y: 64, z: 5 }; v.workstation = { x: 1, y: 64, z: 1 };
    if (breakIt) { const f = M.MobNbt.fieldsFor; M.MobNbt.fieldsFor = (t) => f(t).filter((n) => !n.startsWith('vb') && n !== 'workstation'); }
    M.Save.save(false);
    M.EntityList.clear(); M.Profession.claimed = {};
    M.Save.load(); M.MobNbt.restoreAll(M.Save.mobRecords);
    const r = M.EntityList.list.find((x) => x.type === 'villager');
    return !!r && r.vbHome && r.vbHome.x === 3 && r.vbMeeting.x === 9 && r.vbPotentialJob.x === 5 && r.profession === 'mason'
      && M.Poi.isOccupied({ x: 3, y: 64, z: 4 }) && M.Profession.claimed['1,64,1'] === r.id;
  };
  ok(run(false), '#5784: villager keeps vbHome/meeting/potential job, re-reserves Poi tickets and its workstation claim');
  okAv(!run(true), '#5784: with the memory fields struck, the reloaded villager has no bed ticket or claim');
}

// ── #5782: mob equipment survives save/load ──
{
  const run = (strike) => {
    const M = freshMCL();
    if (strike) { const f = M.MobNbt.fieldsFor; M.MobNbt.fieldsFor = (t) => f(t).filter((n) => n !== 'equip'); }
    const z = M.EntityList.spawn('zombie', 1, 64, 1);
    const ih = M.Items.idOf ? M.Items.idOf('iron_helmet') : null;
    z.equip = []; z.equip[3] = { i: ih, n: 1, d: 0, t: [{ id: 'protection', lvl: 2 }] };
    z.equipDropChance = []; z.equipDropChance[3] = 0.5;
    const sk = M.EntityList.spawn('skeleton', 3, 64, 3);
    sk.equip = []; sk.equip[0] = { i: ih, n: 1, d: 0, t: [{ id: 'power', lvl: 3 }] };
    const want = JSON.stringify([z.equip, sk.equip]);
    M.Save.save(false);
    M.EntityList.clear(); M.Save.load(); M.MobNbt.restoreAll(M.Save.mobRecords);
    const a = M.EntityList.list.find((x) => x.type === 'zombie'), b = M.EntityList.list.find((x) => x.type === 'skeleton');
    return !!a && !!b && JSON.stringify([a.equip, b.equip]) === want && a.equipDropChance[3] === 0.5;
  };
  ok(run(false), '#5782: zombie armour + skeleton bow (enchants) and drop chances survive save/load with no re-roll');
  okAv(!run(true), '#5782: with equip struck from fieldsFor the gear is lost');
}

console.log('\n' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
process.exit(0);
